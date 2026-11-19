"""Unified Database Dashboard Builder Service.

Generates a unified full-database dashboard visualizing every column of every table
across connected SQL databases, alongside existing per-table dashboards.
Strictly read-only against the target database (allow_dml stays False).
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import delete, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.connectors.factory import get_connector
from app.core.config import settings
from app.core.errors import NotFoundError, ValidationError
from app.db.models import (
    Chart,
    Dashboard,
    DashboardChart,
    DatabaseConnection,
    Dataset,
    DatasetColumn,
    User,
)
from app.query.chart_query_builder import quote_identifier
from app.services.dataset_provisioner import provision_dataset_dashboard
from app.uploads.dashboard_generator import (
    _is_id_like,
    _is_numeric_col,
    _is_numeric_measure,
    _rank_dimension_cols,
    _rank_numeric_cols,
)

logger = logging.getLogger("askyourdata.database_dashboard_builder")


def _clean_slug(name: str) -> str:
    """Produce a safe, lowercase, hyphenated slug string."""
    return re.sub(r"[^a-zA-Z0-9]+", "-", name.lower()).strip("-")


def _profile_table(
    connector: Any,
    schema_name: Optional[str],
    table_name: str,
    columns: List[DatasetColumn],
    dialect: str,
) -> Dict[str, Any]:
    """Profile table columns with a single aggregate query."""
    schema_prefix = f"{quote_identifier(schema_name)}." if schema_name else ""
    from_clause = f"{schema_prefix}{quote_identifier(table_name)}"

    select_items = ["COUNT(*) AS total_rows"]
    col_alias_map: Dict[str, Dict[str, Any]] = {}

    for idx, c in enumerate(columns):
        safe_col = quote_identifier(c.name)
        c_type = (c.data_type or "").upper()
        is_num = _is_numeric_measure(c)
        is_dt = c.is_datetime or "DATE" in c_type or "TIME" in c_type

        nn_alias = f"nn_{idx}"
        dist_alias = f"dist_{idx}"
        select_items.append(f"COUNT({safe_col}) AS {nn_alias}")
        select_items.append(f"COUNT(DISTINCT {safe_col}) AS {dist_alias}")

        min_alias = f"min_{idx}" if (is_num or is_dt) else None
        max_alias = f"max_{idx}" if (is_num or is_dt) else None
        avg_alias = f"avg_{idx}" if is_num else None

        if is_num or is_dt:
            select_items.append(f"MIN({safe_col}) AS {min_alias}")
            select_items.append(f"MAX({safe_col}) AS {max_alias}")
        if is_num:
            select_items.append(f"AVG({safe_col}) AS {avg_alias}")

        col_alias_map[c.name] = {
            "nn": nn_alias,
            "dist": dist_alias,
            "min": min_alias,
            "max": max_alias,
            "avg": avg_alias,
            "is_num": is_num,
            "is_dt": is_dt,
            "data_type": c.data_type,
        }

    agg_sql = f"SELECT {', '.join(select_items)} FROM {from_clause}"
    try:
        agg_res = connector.execute_query(agg_sql, limit=1)
    except Exception as e:
        logger.warning(f"Profiling failed for {schema_name}.{table_name}: {e}")
        return {"total_rows": 0, "columns": {}}

    total_rows = 0
    row_dict: Dict[str, Any] = {}
    if agg_res.rows:
        row_dict = dict(zip(agg_res.columns, agg_res.rows[0]))
        total_rows = int(row_dict.get("total_rows", 0) or 0)

    col_stats: Dict[str, Dict[str, Any]] = {}
    for c in columns:
        meta = col_alias_map.get(c.name, {})
        non_null = int(row_dict.get(meta.get("nn", ""), 0) or 0)
        null_count = max(0, total_rows - non_null)
        null_pct = round((null_count / total_rows * 100), 2) if total_rows > 0 else 0.0
        distinct_cnt = int(row_dict.get(meta.get("dist", ""), 0) or 0)

        min_val = row_dict.get(meta.get("min")) if meta.get("min") else None
        max_val = row_dict.get(meta.get("max")) if meta.get("max") else None
        avg_val = row_dict.get(meta.get("avg")) if meta.get("avg") else None
        if avg_val is not None:
            avg_val = round(float(avg_val), 2)

        col_stats[c.name] = {
            "name": c.name,
            "data_type": c.data_type,
            "null_count": null_count,
            "null_pct": null_pct,
            "distinct_count": distinct_cnt,
            "min": min_val,
            "max": max_val,
            "avg": avg_val,
        }

    return {"total_rows": total_rows, "columns": col_stats}


async def _get_or_create_dataset_for_table(
    session: AsyncSession,
    db_conn: DatabaseConnection,
    schema_name: Optional[str],
    table_name: str,
    connector: Any,
    user: Optional[User],
) -> Dataset:
    """Ensure a Dataset record with columns exists for the given table."""
    dialect = (db_conn.dialect or "").lower()
    is_postgres = dialect in ("postgres", "postgresql")
    eff_schema = schema_name or ("public" if is_postgres else "main")

    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(
            Dataset.database_id == db_conn.id,
            Dataset.table_name == table_name,
            Dataset.schema_name == eff_schema,
            Dataset.deleted_at.is_(None),
        )
    )
    res = await session.execute(stmt)
    dataset = res.scalars().first()
    if dataset:
        return dataset

    # Fallback lookup ignoring schema case
    stmt_all = (
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(
            Dataset.database_id == db_conn.id,
            Dataset.table_name.ilike(table_name),
            Dataset.deleted_at.is_(None),
        )
    )
    res_all = await session.execute(stmt_all)
    candidates = res_all.scalars().all()
    for cand in candidates:
        if (cand.schema_name or "").lower() == eff_schema.lower():
            return cand

    # Create dataset
    display_name = f"{eff_schema}.{table_name}" if eff_schema.lower() not in ("public", "main") else table_name
    dataset = Dataset(
        name=display_name,
        description=f"Auto-created from {eff_schema}.{table_name}",
        database_id=db_conn.id,
        schema_name=eff_schema,
        table_name=table_name,
        is_virtual=False,
        created_by_id=user.id if user else None,
    )
    session.add(dataset)
    await session.flush()

    try:
        cols = connector.get_columns(table_name=table_name, schema_name=eff_schema)
        for c in cols:
            c_name = c.name
            c_type = (c.data_type or "").upper()
            is_dt = "TIME" in c_type or "DATE" in c_type
            is_id = (
                bool(c.is_primary_key)
                or c_name.lower().endswith("_id")
                or c_name.lower().startswith("id_")
                or c_name.lower() in ("id", "uuid", "guid", "row_id", "sl_no", "index", "code", "key")
                or (c_name.lower().endswith("id") and len(c_name) <= 6)
            )
            is_numeric = any(t in c_type for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC"))
            is_dim = (not is_numeric) or is_id
            col_record = DatasetColumn(
                dataset_id=dataset.id,
                name=c.name,
                verbose_name=c.name.replace("_", " ").title(),
                data_type=c.data_type,
                is_datetime=is_dt,
                is_dimension=is_dim,
                is_filterable=True,
                is_groupable=True,
                is_hidden_from_ai=False,
            )
            session.add(col_record)
        await session.flush()
    except Exception as err:
        logger.warning(f"Column inspection failed for {table_name}: {err}")

    await session.refresh(dataset)
    return dataset


async def _get_or_create_overview_dataset(
    session: AsyncSession,
    db_conn: DatabaseConnection,
    table_summaries: List[Dict[str, Any]],
    user: Optional[User],
) -> Dataset:
    """Create or update a virtual dataset powering the top Database Overview charts."""
    clean_name = _clean_slug(db_conn.name)
    ds_name = f"{db_conn.name} Overview Virtual Source"
    tbl_name = f"__{clean_name}_inventory__"

    stmt = select(Dataset).where(
        Dataset.database_id == db_conn.id,
        Dataset.table_name == tbl_name,
        Dataset.deleted_at.is_(None),
    )
    res = await session.execute(stmt)
    dataset = res.scalars().first()

    # Build UNION ALL SQL
    union_parts: List[str] = []
    for item in table_summaries:
        sch = item.get("schema") or "public"
        tbl = item.get("table") or ""
        full = f"{sch}.{tbl}"
        rows = int(item.get("row_count") or 0)
        cols = int(item.get("col_count") or 0)
        union_parts.append(
            f"SELECT '{sch}' AS schema_name, '{tbl}' AS table_name, '{full}' AS full_table_name, "
            f"{rows} AS row_count, {cols} AS column_count"
        )

    if not union_parts:
        union_parts.append(
            "SELECT 'public' AS schema_name, 'none' AS table_name, 'public.none' AS full_table_name, 0 AS row_count, 0 AS column_count"
        )

    sql_expr = " UNION ALL ".join(union_parts)

    if dataset:
        dataset.sql_expression = sql_expr
        await session.flush()
        return dataset

    dataset = Dataset(
        name=ds_name,
        description=f"Auto-generated virtual inventory for {db_conn.name}",
        database_id=db_conn.id,
        schema_name=None,
        table_name=tbl_name,
        is_virtual=True,
        sql_expression=sql_expr,
        created_by_id=user.id if user else None,
    )
    session.add(dataset)
    await session.flush()

    col_defs = [
        ("schema_name", "VARCHAR", True, False),
        ("table_name", "VARCHAR", True, False),
        ("full_table_name", "VARCHAR", True, False),
        ("row_count", "BIGINT", False, False),
        ("column_count", "INTEGER", False, False),
    ]
    for c_name, c_type, is_dim, is_dt in col_defs:
        session.add(
            DatasetColumn(
                dataset_id=dataset.id,
                name=c_name,
                verbose_name=c_name.replace("_", " ").title(),
                data_type=c_type,
                is_datetime=is_dt,
                is_dimension=is_dim,
                is_filterable=True,
                is_groupable=True,
                is_hidden_from_ai=False,
            )
        )
    await session.flush()
    await session.refresh(dataset)
    return dataset


async def build_unified_database_dashboard(
    session: AsyncSession,
    database_id: uuid.UUID,
    user: Optional[User] = None,
    schemas: Optional[List[str]] = None,
    tables: Optional[List[Dict[str, str]]] = None,
    per_table_dashboards: bool = True,
    unified_dashboard: bool = True,
) -> Dict[str, Any]:
    """Build unified dashboard and per-table dashboards for connected database."""
    db_conn = await session.get(DatabaseConnection, database_id)
    if not db_conn or db_conn.deleted_at is not None:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(db_conn)
    dialect = (db_conn.dialect or "").lower()
    is_postgres = dialect in ("postgres", "postgresql")
    default_schema = "public" if is_postgres else "main"

    # 1. Gather all schemas and tables
    inventory = connector.get_inventory()
    all_table_items: List[Tuple[str, str, int]] = []
    for s in inventory:
        s_name = s.get("name") if isinstance(s, dict) else getattr(s, "name", None)
        s_name = s_name or default_schema
        if schemas and s_name.lower() not in [sc.lower() for sc in schemas]:
            continue
        s_tables = s.get("tables", []) if isinstance(s, dict) else getattr(s, "tables", [])
        for t in s_tables:
            t_name = t.get("name") if isinstance(t, dict) else getattr(t, "name", "")
            t_rows = t.get("row_count_estimate") if isinstance(t, dict) else getattr(t, "row_count_estimate", None)
            if tables:
                matched = any(
                    item.get("table_name", "").lower() == t_name.lower()
                    and (
                        not item.get("schema_name")
                        or item.get("schema_name", "").lower() == s_name.lower()
                    )
                    for item in tables
                )
                if not matched:
                    continue
            est_rows = t_rows if t_rows is not None else 0
            all_table_items.append((s_name, t_name, est_rows))

    # If specific tables were requested that weren't in physical inventory (e.g. test datasets), add them
    if tables:
        for t_spec in tables:
            t_tbl = t_spec.get("table_name", "")
            t_sch = t_spec.get("schema_name") or default_schema
            if t_tbl and not any(item[0].lower() == t_sch.lower() and item[1].lower() == t_tbl.lower() for item in all_table_items):
                all_table_items.append((t_sch, t_tbl, 0))

    # Sort tables by schema, then table name
    all_table_items.sort(key=lambda x: (x[0].lower(), x[1].lower()))

    # 2. Ensure datasets exist for all selected tables
    table_datasets: Dict[Tuple[str, str], Dataset] = {}
    table_summaries: List[Dict[str, Any]] = []

    for s_name, t_name, est_rows in all_table_items:
        ds = await _get_or_create_dataset_for_table(
            session=session,
            db_conn=db_conn,
            schema_name=s_name,
            table_name=t_name,
            connector=connector,
            user=user,
        )
        table_datasets[(s_name, t_name)] = ds
        col_count = len(ds.columns or [])
        table_summaries.append({
            "schema": s_name,
            "table": t_name,
            "row_count": est_rows,
            "col_count": col_count,
        })

    # 3. Optional: provision separate per-table dashboards
    per_table_results: List[Dict[str, Any]] = []
    if per_table_dashboards:
        for (s_name, t_name), ds in table_datasets.items():
            try:
                p_dash = await provision_dataset_dashboard(
                    session=session,
                    dataset=ds,
                    user=user,
                )
                if p_dash:
                    per_table_results.append({
                        "schema": s_name,
                        "table": t_name,
                        "dashboard_slug": p_dash.slug,
                        "title": p_dash.title,
                        "status": "created",
                        "dataset_id": str(ds.id),
                        "error": None,
                    })
            except Exception as e:
                logger.warning(f"Per-table dashboard provisioning failed for {s_name}.{t_name}: {e}")
                per_table_results.append({
                    "schema": s_name,
                    "table": t_name,
                    "dashboard_slug": None,
                    "title": None,
                    "status": "failed",
                    "dataset_id": str(ds.id),
                    "error": str(e),
                })

    if not unified_dashboard:
        return {
            "database_id": db_conn.id,
            "database_name": db_conn.name,
            "per_table_dashboards_created": len([r for r in per_table_results if r["status"] == "created"]),
            "per_table_dashboards": per_table_results,
            "unified_dashboard_slug": None,
            "unified_dashboard_title": None,
            "sections_count": 0,
            "charts_count": 0,
            "columns_visualized": {},
            "columns_trimmed": {},
            "summary": f"Created {len(per_table_results)} per-table dashboards.",
        }

    # 4. Construct Unified Full Database Dashboard
    clean_conn = _clean_slug(db_conn.name)
    dash_slug = f"{clean_conn}-full-dashboard"
    dash_title = f"{db_conn.name} - Full Database Dashboard"
    dash_desc = f"Consolidated automated dashboard visualising all schemas and tables in {db_conn.name}."

    overview_ds = await _get_or_create_overview_dataset(
        session=session,
        db_conn=db_conn,
        table_summaries=table_summaries,
        user=user,
    )

    owner_list = [user.email] if user else []
    created_by = user.id if user else None

    # Idempotent dashboard lookup
    dash_stmt = (
        select(Dashboard)
        .options(selectinload(Dashboard.charts))
        .where(Dashboard.slug == dash_slug, Dashboard.deleted_at.is_(None))
    )
    dash_res = await session.execute(dash_stmt)
    dashboard = dash_res.scalars().first()

    if dashboard:
        # Clear existing charts belonging specifically to this unified dashboard
        old_chart_ids = [dc.chart_id for dc in (dashboard.charts or [])]
        await session.execute(delete(DashboardChart).where(DashboardChart.dashboard_id == dashboard.id))
        if old_chart_ids:
            await session.execute(delete(Chart).where(Chart.id.in_(old_chart_ids)))
        await session.flush()
        dashboard.title = dash_title
        dashboard.description = dash_desc
        dashboard.created_at = datetime.now(timezone.utc)
        dashboard.updated_at = datetime.now(timezone.utc)
    else:
        dashboard = Dashboard(
            title=dash_title,
            description=dash_desc,
            slug=dash_slug,
            is_published=True,
            layout={"auto_generated": True, "type": "unified_database"},
            owners=owner_list,
            created_by_id=created_by,
        )
        session.add(dashboard)
        await session.flush()

    count_metric = {
        "name": "count",
        "label": "Total Records",
        "expression": "COUNT(*)",
        "column": "count",
        "agg": "COUNT",
    }

    # Grid builder helpers
    grid_charts: List[Tuple[Dict[str, Any], int, int]] = []  # (spec, width, height)
    sections_count = 0
    columns_visualized: Dict[str, List[str]] = {}
    columns_trimmed: Dict[str, List[str]] = {}

    max_charts_per_table = getattr(settings, "FULL_DASHBOARD_MAX_CHARTS_PER_TABLE", 14)
    max_total_charts = getattr(settings, "FULL_DASHBOARD_MAX_TOTAL_CHARTS", 200)
    auto_rel_max = getattr(settings, "AUTO_RELATIONSHIP_MAX", 10)

    # ----------------------------------------------------
    # SECTION A: Top Section - Database Overview
    # ----------------------------------------------------
    sections_count += 1
    grid_charts.append((
        {
            "title": "Database Overview",
            "viz_type": "header",
            "dataset_id": overview_ds.id,
            "params": {
                "section_id": "overview",
                "is_section_header": True,
                "subtitle": f"Overview of {db_conn.name} schemas, tables and row counts",
            },
        },
        12,
        2,
    ))

    # 4 KPI tiles
    grid_charts.append((
        {
            "title": "Total Schemas",
            "viz_type": "big_number",
            "dataset_id": overview_ds.id,
            "params": {
                "dimensions": [],
                "primary_metric_col": "schema_name",
                "primary_metric_agg": "COUNT_DISTINCT",
                "metrics": [
                    {
                        "name": "total_schemas",
                        "label": "Schemas",
                        "expression": "COUNT(DISTINCT schema_name)",
                        "column": "schema_name",
                        "agg": "COUNT_DISTINCT",
                    }
                ],
                "metrics_config": [{"id": "m-0", "column": "schema_name", "agg": "COUNT_DISTINCT"}],
                "row_limit": 1,
            },
        },
        3,
        3,
    ))
    grid_charts.append((
        {
            "title": "Total Tables",
            "viz_type": "big_number",
            "dataset_id": overview_ds.id,
            "params": {
                "dimensions": [],
                "primary_metric_col": "count",
                "primary_metric_agg": "COUNT",
                "metrics": [
                    {
                        "name": "total_tables",
                        "label": "Tables",
                        "expression": "COUNT(*)",
                        "column": "count",
                        "agg": "COUNT",
                    }
                ],
                "metrics_config": [{"id": "m-0", "column": "count", "agg": "COUNT"}],
                "row_limit": 1,
            },
        },
        3,
        3,
    ))
    grid_charts.append((
        {
            "title": "Estimated Total Rows",
            "viz_type": "big_number",
            "dataset_id": overview_ds.id,
            "params": {
                "dimensions": [],
                "primary_metric_col": "row_count",
                "primary_metric_agg": "SUM",
                "metrics": [
                    {
                        "name": "total_rows",
                        "label": "Total Rows",
                        "expression": "SUM(row_count)",
                        "column": "row_count",
                        "agg": "SUM",
                    }
                ],
                "metrics_config": [{"id": "m-0", "column": "row_count", "agg": "SUM"}],
                "row_limit": 1,
            },
        },
        3,
        3,
    ))
    grid_charts.append((
        {
            "title": "Total Columns",
            "viz_type": "big_number",
            "dataset_id": overview_ds.id,
            "params": {
                "dimensions": [],
                "primary_metric_col": "column_count",
                "primary_metric_agg": "SUM",
                "metrics": [
                    {
                        "name": "total_cols",
                        "label": "Total Columns",
                        "expression": "SUM(column_count)",
                        "column": "column_count",
                        "agg": "SUM",
                    }
                ],
                "metrics_config": [{"id": "m-0", "column": "column_count", "agg": "SUM"}],
                "row_limit": 1,
            },
        },
        3,
        3,
    ))

    # Bar chart of rows per table
    grid_charts.append((
        {
            "title": "Estimated Rows per Table",
            "viz_type": "bar",
            "dataset_id": overview_ds.id,
            "params": {
                "dimensions": ["full_table_name"],
                "primary_metric_col": "row_count",
                "primary_metric_agg": "SUM",
                "metrics": [
                    {
                        "name": "row_count",
                        "label": "Rows",
                        "expression": "SUM(row_count)",
                        "column": "row_count",
                        "agg": "SUM",
                    }
                ],
                "metrics_config": [{"id": "m-0", "column": "row_count", "agg": "SUM"}],
                "row_limit": 50,
            },
        },
        12,
        4,
    ))

    # ----------------------------------------------------
    # SECTION B: Per-Table Visualizations
    # ----------------------------------------------------
    for s_name, t_name, est_rows in all_table_items:
        if len(grid_charts) >= max_total_charts:
            break

        table_key = f"{s_name}.{t_name}"
        ds = table_datasets[(s_name, t_name)]
        cols = list(ds.columns or [])

        # Profile table
        profile = _profile_table(
            connector=connector,
            schema_name=s_name,
            table_name=t_name,
            columns=cols,
            dialect=dialect,
        )
        total_rows = profile.get("total_rows", est_rows)
        stats = profile.get("columns", {})

        sections_count += 1
        sec_id = f"{_clean_slug(s_name)}-{_clean_slug(t_name)}"

        # Table section header
        grid_charts.append((
            {
                "title": f"{s_name}.{t_name}",
                "viz_type": "header",
                "dataset_id": ds.id,
                "params": {
                    "section_id": sec_id,
                    "is_section_header": True,
                    "subtitle": f"Column distributions and metrics for {s_name}.{t_name} ({total_rows:,} records)",
                },
            },
            12,
            2,
        ))

        table_chart_specs: List[Tuple[Dict[str, Any], int, int, int]] = []  # (spec, w, h, priority)

        # 1. Total Records Tile (Priority 1)
        table_chart_specs.append((
            {
                "title": f"Total {t_name}",
                "viz_type": "big_number",
                "dataset_id": ds.id,
                "params": {
                    "dimensions": [],
                    "metrics": [count_metric],
                    "row_limit": 1,
                    "options": {"subheader": f"Table: {s_name}.{t_name}"},
                },
            },
            4,
            3,
            1,
        ))

        visualized_cols: List[str] = []
        low_card_dims: List[DatasetColumn] = []

        # Classify and plan visualizations for each column
        for c in cols:
            safe_col = quote_identifier(c.name)
            col_label = c.verbose_name or c.name.replace("_", " ").title()
            c_stat = stats.get(c.name, {})
            dist_cnt = c_stat.get("distinct_count", 0)
            null_cnt = c_stat.get("null_count", 0)
            null_pct = c_stat.get("null_pct", 0.0)
            min_val = c_stat.get("min")
            max_val = c_stat.get("max")
            avg_val = c_stat.get("avg")

            c_type = (c.data_type or "").upper()
            is_id = _is_id_like(c)
            is_num = _is_numeric_measure(c)
            is_dt = c.is_datetime or "DATE" in c_type or "TIME" in c_type
            is_bool = "BOOL" in c_type

            # Rule 1: ID / Key Column
            if is_id:
                sub_text = f"Min: {min_val} | Max: {max_val}" if min_val is not None else f"Total: {total_rows}"
                table_chart_specs.append((
                    {
                        "title": f"{col_label} (Key / ID)",
                        "viz_type": "big_number",
                        "dataset_id": ds.id,
                        "params": {
                            "dimensions": [],
                            "primary_metric_col": c.name,
                            "primary_metric_agg": "COUNT_DISTINCT",
                            "metrics": [
                                {
                                    "name": f"dist_{c.name}",
                                    "label": f"Distinct {col_label}",
                                    "expression": f"COUNT(DISTINCT {safe_col})",
                                    "column": c.name,
                                    "agg": "COUNT_DISTINCT",
                                }
                            ],
                            "metrics_config": [{"id": "m-0", "column": c.name, "agg": "COUNT_DISTINCT"}],
                            "row_limit": 1,
                            "options": {"subheader": sub_text},
                        },
                    },
                    4,
                    3,
                    5,
                ))
                visualized_cols.append(c.name)
                continue

            # Rule 2: Boolean
            if is_bool or dist_cnt == 2 and any(t in c_type for t in ("BIT", "BOOL")):
                table_chart_specs.append((
                    {
                        "title": f"{t_name} by {col_label}",
                        "viz_type": "pie",
                        "dataset_id": ds.id,
                        "params": {
                            "dimensions": [c.name],
                            "metrics": [count_metric],
                            "row_limit": 10,
                            "options": {"isDonut": True},
                        },
                    },
                    4,
                    3,
                    2,
                ))
                visualized_cols.append(c.name)
                continue

            # Rule 3: Date / Timestamp
            if is_dt:
                is_pure_time = "TIME" in c_type and not any(t in c_type for t in ("DATE", "DATETIME", "TIMESTAMP"))
                t_grain = "hour" if is_pure_time else "month"
                table_chart_specs.append((
                    {
                        "title": f"{t_name} Trend Over {col_label}",
                        "viz_type": "line",
                        "dataset_id": ds.id,
                        "params": {
                            "dimensions": [],
                            "time_column": c.name,
                            "time_grain": t_grain,
                            "metrics": [count_metric],
                            "row_limit": 200,
                            "options": {"smooth": True},
                        },
                    },
                    6,
                    4,
                    4,
                ))
                visualized_cols.append(c.name)
                continue

            # Rule 4: Numeric Measure
            if is_num:
                # 4a: Histogram (WIDTH_BUCKET SQL expression)
                if min_val is not None and max_val is not None and float(max_val) > float(min_val):
                    f_min = float(min_val)
                    f_max = float(max_val)
                    step = (f_max - f_min) / 10.0
                    case_whens = []
                    for b_idx in range(1, 11):
                        b_start = f_min + (b_idx - 1) * step
                        b_end = f_min + b_idx * step
                        case_whens.append(f"WHEN {b_idx} THEN '{b_start:.1f}-{b_end:.1f}'")

                    if dialect in ("mssql", "tsql"):
                        hist_dim = (
                            f"CASE WHEN {safe_col} >= {f_max} THEN '{f_min + 9 * step:.1f}-{f_max:.1f}' "
                            f"WHEN {safe_col} < {f_min} THEN 'Other' "
                            f"ELSE CASE CAST(FLOOR(({safe_col} - {f_min}) / {step}) + 1 AS INT) "
                            f"{' '.join(case_whens)} ELSE 'Other' END END"
                        )
                    else:
                        hist_dim = (
                            f"CASE WIDTH_BUCKET({safe_col}, {f_min}, {f_max + 0.0001}, 10) "
                            f"{' '.join(case_whens)} ELSE 'Other' END"
                        )
                    table_chart_specs.append((
                        {
                            "title": f"{col_label} Distribution (Histogram)",
                            "viz_type": "bar",
                            "dataset_id": ds.id,
                            "params": {
                                "dimensions": [hist_dim],
                                "metrics": [count_metric],
                                "row_limit": 15,
                            },
                        },
                        6,
                        4,
                        3,
                    ))
                else:
                    table_chart_specs.append((
                        {
                            "title": f"{col_label} Values",
                            "viz_type": "bar",
                            "dataset_id": ds.id,
                            "params": {
                                "dimensions": [c.name],
                                "metrics": [count_metric],
                                "row_limit": 15,
                            },
                        },
                        6,
                        4,
                        3,
                    ))

                # 4b: Min / Avg / Max KPI Tile
                sub_info = f"Min: {min_val} | Max: {max_val}"
                table_chart_specs.append((
                    {
                        "title": f"Average {col_label}",
                        "viz_type": "big_number",
                        "dataset_id": ds.id,
                        "params": {
                            "dimensions": [],
                            "primary_metric_col": c.name,
                            "primary_metric_agg": "AVG",
                            "metrics": [
                                {
                                    "name": f"avg_{c.name}",
                                    "label": f"AVG({col_label})",
                                    "expression": f"AVG({safe_col})",
                                    "column": c.name,
                                    "agg": "AVG",
                                }
                            ],
                            "metrics_config": [{"id": "m-0", "column": c.name, "agg": "AVG"}],
                            "row_limit": 1,
                            "options": {"subheader": sub_info},
                        },
                    },
                    4,
                    3,
                    3,
                ))
                visualized_cols.append(c.name)
                continue

            # Rule 5: Low-cardinality categorical (distinct <= 30)
            if 0 < dist_cnt <= 30:
                low_card_dims.append(c)
                if dist_cnt <= 6:
                    table_chart_specs.append((
                        {
                            "title": f"{t_name} by {col_label}",
                            "viz_type": "pie",
                            "dataset_id": ds.id,
                            "params": {
                                "dimensions": [c.name],
                                "metrics": [count_metric],
                                "row_limit": 15,
                                "options": {"isDonut": True},
                            },
                        },
                        4,
                        3,
                        2,
                    ))
                else:
                    table_chart_specs.append((
                        {
                            "title": f"{t_name} by {col_label}",
                            "viz_type": "bar",
                            "dataset_id": ds.id,
                            "params": {
                                "dimensions": [c.name],
                                "metrics": [count_metric],
                                "row_limit": 25,
                            },
                        },
                        6,
                        4,
                        2,
                    ))
                visualized_cols.append(c.name)
                continue

            # Rule 6: High-cardinality text (distinct > 30)
            sub_text = f"Nulls: {null_cnt} ({null_pct}%) | Total: {total_rows:,}"
            table_chart_specs.append((
                {
                    "title": f"{col_label} Unique Count",
                    "viz_type": "big_number",
                    "dataset_id": ds.id,
                    "params": {
                        "dimensions": [],
                        "primary_metric_col": c.name,
                        "primary_metric_agg": "COUNT_DISTINCT",
                        "metrics": [
                            {
                                "name": f"dist_{c.name}",
                                "label": f"Distinct {col_label}",
                                "expression": f"COUNT(DISTINCT {safe_col})",
                                "column": c.name,
                                "agg": "COUNT_DISTINCT",
                            }
                        ],
                        "metrics_config": [{"id": "m-0", "column": c.name, "agg": "COUNT_DISTINCT"}],
                        "row_limit": 1,
                        "options": {"subheader": sub_text},
                    },
                },
                4,
                3,
                5,
            ))
            # Top 10 bar ONLY if not unique per row
            if 0 < dist_cnt < total_rows:
                table_chart_specs.append((
                    {
                        "title": f"Top 10 {col_label}",
                        "viz_type": "bar",
                        "dataset_id": ds.id,
                        "params": {
                            "dimensions": [c.name],
                            "metrics": [count_metric],
                            "row_limit": 10,
                        },
                    },
                    6,
                    4,
                    5,
                ))
            visualized_cols.append(c.name)

        # Average measure by best low-cardinality dimension for first 1-2 measures
        num_cols = _rank_numeric_cols(cols)
        if low_card_dims and num_cols:
            best_dim = low_card_dims[0]
            best_dim_label = best_dim.verbose_name or best_dim.name.replace("_", " ").title()
            for m_col in num_cols[:2]:
                m_label = m_col.verbose_name or m_col.name.replace("_", " ").title()
                table_chart_specs.append((
                    {
                        "title": f"Average {m_label} by {best_dim_label}",
                        "viz_type": "bar",
                        "dataset_id": ds.id,
                        "params": {
                            "dimensions": [best_dim.name],
                            "primary_metric_col": m_col.name,
                            "primary_metric_agg": "AVG",
                            "metrics": [
                                {
                                    "name": f"avg_{m_col.name}",
                                    "label": f"AVG({m_label})",
                                    "expression": f"AVG({quote_identifier(m_col.name)})",
                                    "column": m_col.name,
                                    "agg": "AVG",
                                }
                            ],
                            "metrics_config": [{"id": "m-0", "column": m_col.name, "agg": "AVG"}],
                            "row_limit": 25,
                        },
                    },
                    6,
                    4,
                    3,
                ))

        # Enforce table cap: FULL_DASHBOARD_MAX_CHARTS_PER_TABLE
        columns_visualized[table_key] = sorted(list(set(visualized_cols)))
        if len(table_chart_specs) > max_charts_per_table:
            # Sort by priority ascending (1 highest, 5 lowest)
            table_chart_specs.sort(key=lambda x: x[3])
            kept = table_chart_specs[:max_charts_per_table]
            trimmed = table_chart_specs[max_charts_per_table:]
            trimmed_col_names = [t[0]["title"] for t in trimmed]
            columns_trimmed[table_key] = trimmed_col_names
            table_chart_specs = kept
        else:
            columns_trimmed[table_key] = []

        for spec, w, h, _ in table_chart_specs:
            if len(grid_charts) < max_total_charts:
                grid_charts.append((spec, w, h))

    # ----------------------------------------------------
    # SECTION C: Relationships & Foreign Keys
    # ----------------------------------------------------
    try:
        engine = connector._get_engine()
        insp = inspect(engine)
        fk_charts: List[Tuple[Dict[str, Any], int, int]] = []

        for s_name, t_name, _ in all_table_items:
            if len(fk_charts) >= auto_rel_max:
                break
            child_ds = table_datasets.get((s_name, t_name))
            if not child_ds:
                continue
            fks = insp.get_foreign_keys(t_name, schema=s_name)
            for fk in fks:
                if len(fk_charts) >= auto_rel_max:
                    break
                constrained = fk.get("constrained_columns", [])
                ref_tbl = fk.get("referred_table", "")
                if not constrained or not ref_tbl:
                    continue
                fk_col = constrained[0]
                fk_charts.append((
                    {
                        "title": f"{t_name} by {ref_tbl} ({fk_col})",
                        "viz_type": "bar",
                        "dataset_id": child_ds.id,
                        "params": {
                            "dimensions": [fk_col],
                            "metrics": [count_metric],
                            "row_limit": 20,
                        },
                    },
                    6,
                    4,
                ))

        if fk_charts and len(grid_charts) < max_total_charts:
            sections_count += 1
            grid_charts.append((
                {
                    "title": "Relationships & Foreign Keys",
                    "viz_type": "header",
                    "dataset_id": overview_ds.id,
                    "params": {
                        "section_id": "relationships",
                        "is_section_header": True,
                        "subtitle": "Cross-table foreign key distributions and relationships",
                    },
                },
                12,
                2,
            ))
            for f_spec, f_w, f_h in fk_charts:
                if len(grid_charts) < max_total_charts:
                    grid_charts.append((f_spec, f_w, f_h))

    except Exception as fk_err:
        logger.warning(f"Foreign key inspection failed: {fk_err}")

    # ----------------------------------------------------
    # Compute Stacked 12-Column Grid Coordinates
    # ----------------------------------------------------
    current_x = 0
    current_y = 0
    current_row_max_h = 0

    for spec, w, h in grid_charts:
        if spec.get("viz_type") == "header":
            # Headers always start on a fresh row
            if current_x > 0:
                current_y += current_row_max_h
                current_x = 0
                current_row_max_h = 0

            pos = {"x": 0, "y": current_y, "w": 12, "h": h}
            current_y += h
            current_x = 0
            current_row_max_h = 0
        else:
            if current_x + w > 12:
                current_y += current_row_max_h
                current_x = 0
                current_row_max_h = 0

            pos = {"x": current_x, "y": current_y, "w": w, "h": h}
            current_x += w
            current_row_max_h = max(current_row_max_h, h)

            if current_x >= 12:
                current_y += current_row_max_h
                current_x = 0
                current_row_max_h = 0

        # Create Chart and DashboardChart records
        chart = Chart(
            title=spec["title"],
            description=f"Auto-generated for {db_conn.name}",
            dataset_id=spec["dataset_id"],
            viz_type=spec["viz_type"],
            params=spec["params"],
            query_context={"unified_dashboard": True, "database_id": str(db_conn.id)},
            owners=owner_list,
            created_by_id=created_by,
        )
        session.add(chart)
        await session.flush()

        session.add(
            DashboardChart(
                dashboard_id=dashboard.id,
                chart_id=chart.id,
                position=pos,
            )
        )

    await session.commit()
    await session.refresh(dashboard)

    summary = (
        f"Visualized {len(all_table_items)} tables across {len(set(t[0] for t in all_table_items))} schemas "
        f"with {len(grid_charts)} charts in unified dashboard '{dash_title}'."
    )
    logger.info(summary)

    # When per_table_dashboards is False (Unified dashboard only mode),
    # populate per_table_results so frontend receives all visualized tables and their created datasets
    if not per_table_dashboards:
        for (s_name, t_name), ds in table_datasets.items():
            per_table_results.append({
                "schema": s_name,
                "table": t_name,
                "dashboard_slug": dashboard.slug,
                "title": f"{dashboard.title} ({s_name}.{t_name})",
                "status": "created",
                "dataset_id": str(ds.id),
                "error": None,
            })

    return {
        "database_id": db_conn.id,
        "database_name": db_conn.name,
        "per_table_dashboards_created": len([r for r in per_table_results if r["status"] == "created"]),
        "per_table_dashboards": per_table_results,
        "unified_dashboard_slug": dashboard.slug,
        "unified_dashboard_title": dashboard.title,
        "sections_count": sections_count,
        "charts_count": len(grid_charts),
        "columns_visualized": columns_visualized,
        "columns_trimmed": columns_trimmed,
        "summary": summary,
    }
