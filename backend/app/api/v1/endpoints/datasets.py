"""Datasets Semantic Layer API Endpoints."""
from collections import defaultdict
import logging
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.deps import get_db_session, require_permission
from app.connectors.factory import get_connector
from app.core.config import settings
from app.core.errors import NotFoundError, AppException, ValidationError, PermissionDeniedError
from app.db.models import (
    DatabaseConnection,
    Dataset,
    DatasetColumn,
    DatasetMetric,
    RLSRule,
    User,
)
from app.query.cache import QueryResultCache
from app.query.chart_query_builder import quote_identifier
from app.query.validator import validate_and_format_sql
from app.schemas.dataset import (
    BatchDeleteDatasetsRequest,
    BulkDatasetCreateRequest,
    BulkDatasetCreateResponse,
    BulkDatasetItemResult,
    DatasetColumnBase,
    DatasetCreate,
    DatasetFromJoinRequest,
    DatasetFromJoinResponse,
    DatasetMetricBase,
    DatasetOut,
    DatasetUpdate,
    RLSRuleBase,
)
from app.services.cascade_delete_service import delete_dataset_cascade
from app.services.dataset_provisioner import provision_dataset_dashboard

logger = logging.getLogger("askyourdata.datasets")

router = APIRouter(prefix="/datasets", tags=["Datasets"])


async def _repair_postgres_datasets_schema(session: AsyncSession) -> None:
    """Ensure any postgres datasets saved with 'main' schema are updated to 'public'."""
    try:
        pg_res = await session.execute(
            select(DatabaseConnection.id).where(
                DatabaseConnection.dialect.in_(["postgres", "postgresql"]),
                DatabaseConnection.deleted_at.is_(None),
            )
        )
        pg_ids = pg_res.scalars().all()
        if pg_ids:
            await session.execute(
                update(Dataset)
                .where(
                    Dataset.database_id.in_(pg_ids),
                    Dataset.schema_name == "main",
                )
                .values(schema_name="public")
            )
            await session.commit()
    except Exception:
        pass


def _check_dataset_access(dataset: Dataset, user: User, write: bool = False) -> None:
    """Enforce dataset ownership and access isolation."""
    if user.is_superuser:
        return
    # Read access is permitted for all authenticated users with datasets:read permission
    if not write:
        return
    # Write / delete operations are restricted to dataset creator, explicit owners, or superadmin
    if dataset.created_by_id and dataset.created_by_id == user.id:
        return
    if dataset.owners and user.email in dataset.owners:
        return
    raise PermissionDeniedError(
        f"Access denied: You do not have permission to modify or delete this dataset.",
        details={"dataset_id": str(dataset.id), "user_id": str(user.id)},
    )


@router.get("/")
async def list_datasets(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:read")),
) -> Any:
    """List physical and virtual datasets accessible to current user."""
    await _repair_postgres_datasets_schema(session)

    stmt = (
        select(Dataset)
        .options(
            selectinload(Dataset.columns),
            selectinload(Dataset.metrics),
            selectinload(Dataset.rls_rules),
        )
        .where(Dataset.deleted_at.is_(None))
        .order_by(Dataset.created_at.desc())
    )
    result = await session.execute(stmt)
    datasets = result.scalars().all()

    # Preload database names
    db_ids = {d.database_id for d in datasets}
    db_stmt = select(DatabaseConnection).where(DatabaseConnection.id.in_(db_ids))
    db_res = await session.execute(db_stmt)
    db_map = {d.id: d.name for d in db_res.scalars().all()}

    output = []
    for d in datasets:
        d_dict = {
            "id": str(d.id),
            "name": d.name,
            "description": d.description,
            "database_id": str(d.database_id),
            "database_name": db_map.get(d.database_id, "Unknown"),
            "schema_name": d.schema_name,
            "table_name": d.table_name,
            "is_virtual": d.is_virtual,
            "sql_expression": d.sql_expression,
            "columns": [
                {
                    "id": str(c.id),
                    "name": c.name,
                    "column_name": c.name,
                    "verbose_name": c.verbose_name or c.name,
                    "data_type": c.data_type,
                    "is_datetime": c.is_datetime,
                    "is_dimension": c.is_dimension,
                    "is_filterable": c.is_filterable,
                    "is_groupable": c.is_groupable,
                    "is_hidden_from_ai": c.is_hidden_from_ai,
                    "description": c.description,
                }
                for c in (d.columns or [])
            ],
            "metrics": [
                {
                    "id": str(m.id),
                    "name": m.name,
                    "metric_name": m.name,
                    "verbose_name": m.verbose_name or m.name,
                    "sql_expression": m.sql_expression,
                    "metric_type": m.metric_type,
                    "number_format": m.number_format,
                    "description": m.description,
                }
                for m in (d.metrics or [])
            ],
            "columns_count": len(d.columns or []),
            "metrics_count": len(d.metrics or []),
            "rls_rules_count": len(d.rls_rules or []),
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        output.append(d_dict)

    return output


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_dataset(
    payload: DatasetCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Any:
    """Create a dataset. If physical, automatically inspects source table to populate columns and provision dashboard."""
    conn_stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == payload.database_id,
        DatabaseConnection.deleted_at.is_(None),
    )
    conn_res = await session.execute(conn_stmt)
    db_conn = conn_res.scalar_one_or_none()
    if not db_conn:
        raise NotFoundError("Associated database connection not found.")

    dialect = (db_conn.dialect or "").lower()
    is_mssql = dialect in ("mssql", "tsql")
    default_schema = "public" if dialect in ("postgres", "postgresql") else ("dbo" if is_mssql else ("main" if dialect in ("duckdb", "sqlite") else None))

    effective_schema = payload.schema_name
    if not effective_schema or (effective_schema.lower() == "main" and dialect in ("postgres", "postgresql")):
        effective_schema = default_schema

    raw_sql = (payload.sql_expression or getattr(payload, "sql_query", None) or "").strip()
    is_virtual = payload.is_virtual or bool(raw_sql)
    saved_sql = None

    if is_virtual and raw_sql:
        clean_sql = raw_sql.rstrip(";")
        try:
            saved_sql = validate_and_format_sql(
                raw_sql=clean_sql,
                dialect=dialect,
                allow_dml=False,
            )
        except Exception:
            saved_sql = clean_sql

    dataset = Dataset(
        name=payload.name,
        description=payload.description,
        database_id=payload.database_id,
        schema_name=effective_schema,
        table_name=payload.table_name,
        is_virtual=is_virtual,
        sql_expression=saved_sql,
        created_by_id=current_user.id,
    )
    session.add(dataset)
    await session.flush()

    # If physical table, auto-populate columns from source schema
    if not is_virtual and payload.table_name:
        try:
            connector = get_connector(db_conn)
            cols = connector.get_columns(
                table_name=payload.table_name,
                schema_name=effective_schema,
            )
            for c in cols:
                c_name = c.name
                c_type = c.data_type.upper()
                is_dt = "TIME" in c_type or "DATE" in c_type
                is_id_like = (
                    bool(c.is_primary_key)
                    or c_name.lower().endswith("_id")
                    or c_name.lower().startswith("id_")
                    or c_name.lower() in ("id", "uuid", "guid", "row_id", "sl_no", "index", "code", "key")
                    or (c_name.lower().endswith("id") and len(c_name) <= 6)
                )
                is_numeric = any(t in c_type for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC"))
                is_dim = (not is_numeric) or is_id_like
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
        except Exception as e:
            # Continue even if automatic inspection encounters an issue
            pass

    # If virtual dataset, probe columns from SQL expression and populate DatasetColumn records
    elif is_virtual and saved_sql:
        try:
            connector = get_connector(db_conn)
            probe_sql = (
                f"SELECT TOP 1 * FROM ({saved_sql}) AS _virtual_probe"
                if is_mssql
                else f"SELECT * FROM ({saved_sql}) AS _virtual_probe LIMIT 1"
            )
            try:
                sample_res = connector.execute_query(probe_sql, limit=1)
                col_names = sample_res.columns
                col_types = sample_res.column_types
            except Exception as e:
                logger.warning(f"Could not probe columns with subquery wrapper ({e}), falling back to direct query")
                sample_res = connector.execute_query(saved_sql, limit=1)
                col_names = sample_res.columns
                col_types = sample_res.column_types

            for idx, c_name in enumerate(col_names):
                if isinstance(col_types, dict):
                    raw_type = col_types.get(c_name, "VARCHAR")
                elif isinstance(col_types, list) and idx < len(col_types):
                    raw_type = str(col_types[idx])
                else:
                    raw_type = "VARCHAR"
                c_type = (raw_type or "VARCHAR").upper()
                is_dt = "TIME" in c_type or "DATE" in c_type
                is_id_like = (
                    c_name.lower().endswith("_id")
                    or c_name.lower().startswith("id_")
                    or c_name.lower() in ("id", "uuid", "guid", "row_id", "sl_no", "index", "code", "key")
                    or (c_name.lower().endswith("id") and len(c_name) <= 6)
                )
                is_numeric = any(t in c_type for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC"))
                is_dim = (not is_numeric) or is_id_like
                col_record = DatasetColumn(
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
                session.add(col_record)

            # Auto-provision default row count metric
            count_metric = DatasetMetric(
                dataset_id=dataset.id,
                name="count",
                verbose_name="Count of Rows",
                metric_type="count",
                sql_expression="COUNT(*)",
            )
            session.add(count_metric)
        except Exception as e:
            logger.error(f"Failed to probe columns for virtual dataset '{dataset.name}': {e}", exc_info=True)

    await session.commit()
    await session.refresh(dataset)

    # Auto-provision dashboard & charts for physical table
    if not payload.is_virtual and payload.table_name:
        await provision_dataset_dashboard(session=session, dataset=dataset, user=current_user)

    return {"message": "Dataset created successfully.", "id": str(dataset.id), "name": dataset.name}


@router.post("/from-join", response_model=DatasetFromJoinResponse, status_code=status.HTTP_201_CREATED)
async def create_dataset_from_join(
    payload: DatasetFromJoinRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Any:
    """Save a validated SQL join query as a virtual dataset with auto-provisioned columns and dashboard."""
    conn_stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == payload.database_id,
        DatabaseConnection.deleted_at.is_(None),
    )
    conn_res = await session.execute(conn_stmt)
    db_conn = conn_res.scalar_one_or_none()
    if not db_conn:
        raise NotFoundError("Associated database connection not found.")

    dialect = (db_conn.dialect or "postgresql").lower()

    # 1. Validate SQL via AST safety guardrails
    safe_sql = validate_and_format_sql(
        raw_sql=payload.sql,
        dialect=dialect,
        allow_dml=False,
        row_limit=None,
    )

    # 2. Probe column names and types by running a 1-row probe query
    connector = get_connector(db_conn)
    try:
        probe_sql = validate_and_format_sql(
            raw_sql=f"SELECT * FROM ({safe_sql}) AS _join_probe",
            dialect=dialect,
            allow_dml=False,
            row_limit=1,
            force_limit=True,
        )
        sample_result = connector.execute_query(probe_sql, limit=1)
        col_names = sample_result.columns
        col_types = sample_result.column_types
    except Exception as e:
        logger.warning(f"Could not probe columns with subquery wrapper ({e}), falling back to direct probe")
        sample_result = connector.execute_query(safe_sql, limit=1)
        col_names = sample_result.columns
        col_types = sample_result.column_types

    # 3. Create virtual dataset entity
    default_schema = "public" if dialect in ("postgres", "postgresql") else "main"
    desc = payload.description or f"Virtual dataset from join query between {payload.left_table or 'left table'} and {payload.right_table or 'right table'}"

    dataset = Dataset(
        name=payload.name,
        description=desc,
        database_id=payload.database_id,
        schema_name=default_schema,
        table_name=None,
        is_virtual=True,
        sql_expression=safe_sql,
        created_by_id=current_user.id,
    )
    session.add(dataset)
    await session.flush()

    # 4. Populate dataset columns in semantic layer
    for idx, col_name in enumerate(col_names):
        if isinstance(col_types, dict):
            raw_type = col_types.get(col_name, "VARCHAR")
        elif isinstance(col_types, list) and idx < len(col_types):
            raw_type = str(col_types[idx])
        else:
            raw_type = "VARCHAR"
        col_type = (raw_type or "VARCHAR").upper()
        is_dt = "TIME" in col_type or "DATE" in col_type
        is_id_like = (
            col_name.lower().endswith("_id")
            or col_name.lower().startswith("id_")
            or col_name.lower() in ("id", "uuid", "guid", "row_id", "sl_no", "index", "code", "key")
            or (col_name.lower().endswith("id") and len(col_name) <= 6)
        )
        is_numeric = any(t in col_type for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC"))
        is_dim = (not is_numeric) or is_id_like
        col_record = DatasetColumn(
            dataset_id=dataset.id,
            name=col_name,
            verbose_name=col_name.replace("_", " ").title(),
            data_type=col_type,
            is_datetime=is_dt,
            is_dimension=is_dim,
            is_filterable=True,
            is_groupable=True,
            is_hidden_from_ai=False,
        )
        session.add(col_record)

    await session.commit()
    await session.refresh(dataset)

    # 5. Optionally auto-provision dashboard & charts
    dashboard_slug = None
    dashboard_id = None
    if payload.create_dashboard:
        dash = await provision_dataset_dashboard(session=session, dataset=dataset, user=current_user)
        if dash:
            dashboard_slug = dash.slug
            dashboard_id = dash.id

    return DatasetFromJoinResponse(
        dataset_id=dataset.id,
        name=dataset.name,
        sql_expression=dataset.sql_expression or safe_sql,
        columns_count=len(col_names),
        dashboard_slug=dashboard_slug,
        dashboard_id=dashboard_id,
        message=f"Virtual dataset '{dataset.name}' created with {len(col_names)} columns."
        + (f" Dashboard created at /dashboards/{dashboard_slug}" if dashboard_slug else ""),
    )



@router.post("/bulk", response_model=BulkDatasetCreateResponse, status_code=status.HTTP_201_CREATED)
async def bulk_create_datasets(
    payload: BulkDatasetCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Any:
    """Bulk create datasets and provision dashboards for multiple tables across schemas."""
    # 1. Cap validation
    max_cap = settings.BULK_DATASET_MAX_TABLES
    if len(payload.items) > max_cap:
        raise ValidationError(
            f"Requested tables ({len(payload.items)}) exceed maximum allowed limit of {max_cap} per bulk request.",
        )

    # 2. Database connection validation
    conn_stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == payload.database_id,
        DatabaseConnection.deleted_at.is_(None),
    )
    conn_res = await session.execute(conn_stmt)
    db_conn = conn_res.scalar_one_or_none()
    if not db_conn:
        raise NotFoundError("Associated database connection not found.")

    dialect = (db_conn.dialect or "").lower()
    is_postgres = dialect in ("postgres", "postgresql")
    default_schema = "public" if is_postgres else ("main" if dialect in ("duckdb", "sqlite") else None)

    # 3. Fetch existing datasets for this database
    existing_stmt = select(Dataset).where(
        Dataset.database_id == payload.database_id,
        Dataset.deleted_at.is_(None),
    )
    existing_res = await session.execute(existing_stmt)
    existing_datasets = list(existing_res.scalars().all())

    def normalize_schema(s: Optional[str]) -> str:
        if not s:
            return default_schema or ""
        if s.lower() == "main" and is_postgres:
            return "public"
        return s

    existing_lookup: Dict[tuple[str, str], Dataset] = {}
    for d in existing_datasets:
        if d.table_name:
            sch = normalize_schema(d.schema_name).lower()
            tbl = d.table_name.lower()
            existing_lookup[(sch, tbl)] = d

    # 4. Determine naming collisions: count schemas per table name across all items and existing datasets
    table_schemas_map: Dict[str, set[str]] = defaultdict(set)
    for d in existing_datasets:
        if d.table_name:
            table_schemas_map[d.table_name.lower()].add(normalize_schema(d.schema_name).lower())
    for item in payload.items:
        eff_s = normalize_schema(item.schema_name).lower()
        table_schemas_map[item.table_name.lower()].add(eff_s)

    connector = get_connector(db_conn)
    current_user_id = current_user.id if current_user else None

    results: List[BulkDatasetItemResult] = []
    created_count = 0
    skipped_count = 0
    failed_count = 0

    # 5. Process items sequentially
    for item in payload.items:
        effective_schema = normalize_schema(item.schema_name)
        schema_key = effective_schema.lower() if effective_schema else ""
        table_key = item.table_name.lower()

        # Check if already exists
        if (schema_key, table_key) in existing_lookup:
            existing_d = existing_lookup[(schema_key, table_key)]
            results.append(BulkDatasetItemResult(
                schema=effective_schema,
                table=item.table_name,
                schema_name=effective_schema,
                table_name=item.table_name,
                status="skipped_existing",
                dataset_id=str(existing_d.id),
                dashboard_slug=None,
                error=None,
            ))
            skipped_count += 1
            continue

        # Choose dataset name: "<schema>.<table>" if table name appears in several schemas, else "<table>"
        if len(table_schemas_map[table_key]) > 1:
            dataset_name = f"{effective_schema}.{item.table_name}"
        else:
            dataset_name = item.table_name

        try:
            new_dataset = Dataset(
                name=dataset_name,
                description=f"Auto-created from table {item.table_name}",
                database_id=payload.database_id,
                schema_name=effective_schema,
                table_name=item.table_name,
                is_virtual=False,
                created_by_id=current_user_id,
            )
            session.add(new_dataset)
            await session.flush()

            # Inspect columns safely (failures don't block dataset creation)
            try:
                cols = connector.get_columns(table_name=item.table_name, schema_name=effective_schema)
                for c in cols:
                    c_name = c.name
                    c_type = c.data_type.upper()
                    is_dt = "TIME" in c_type or "DATE" in c_type
                    is_id_like = (
                        bool(c.is_primary_key)
                        or c_name.lower().endswith("_id")
                        or c_name.lower().startswith("id_")
                        or c_name.lower() in ("id", "uuid", "guid", "row_id", "sl_no", "index", "code", "key")
                        or (c_name.lower().endswith("id") and len(c_name) <= 6)
                    )
                    is_numeric = any(t in c_type for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC"))
                    is_dim = (not is_numeric) or is_id_like
                    col_record = DatasetColumn(
                        dataset_id=new_dataset.id,
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
            except Exception as insp_err:
                logger.warning(f"Column inspection skipped for {item.table_name}: {insp_err}")

            await session.commit()
            await session.refresh(new_dataset)

            # Keep track in existing_lookup to avoid duplicates in the same request
            existing_lookup[(schema_key, table_key)] = new_dataset

            # Provision dashboard
            dashboard_slug = None
            if payload.create_dashboards:
                try:
                    dashboard = await provision_dataset_dashboard(
                        session=session,
                        dataset=new_dataset,
                        user=current_user,
                    )
                    if dashboard:
                        dashboard_slug = dashboard.slug
                except Exception as dash_err:
                    logger.warning(f"Dashboard provisioning failed for {item.table_name}: {dash_err}")

            results.append(BulkDatasetItemResult(
                schema=effective_schema,
                table=item.table_name,
                schema_name=effective_schema,
                table_name=item.table_name,
                status="created",
                dataset_id=str(new_dataset.id),
                dashboard_slug=dashboard_slug,
                error=None,
            ))
            created_count += 1

        except Exception as item_err:
            await session.rollback()
            logger.error(f"Failed to create dataset for {effective_schema}.{item.table_name}: {item_err}")
            results.append(BulkDatasetItemResult(
                schema=effective_schema,
                table=item.table_name,
                schema_name=effective_schema,
                table_name=item.table_name,
                status="failed",
                dataset_id=None,
                dashboard_slug=None,
                error=str(item_err),
            ))
            failed_count += 1

    return BulkDatasetCreateResponse(
        total_requested=len(payload.items),
        created_count=created_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        results=results,
    )


@router.get("/{id}")
async def get_dataset(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:read")),
) -> Any:
    """Get complete dataset definition with columns, metrics, and RLS rules."""
    stmt = (
        select(Dataset)
        .options(
            selectinload(Dataset.columns),
            selectinload(Dataset.metrics),
            selectinload(Dataset.rls_rules),
        )
        .where(Dataset.id == id, Dataset.deleted_at.is_(None))
    )
    result = await session.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise NotFoundError("Dataset not found.")

    _check_dataset_access(dataset, current_user, write=False)

    conn_stmt = select(DatabaseConnection).where(DatabaseConnection.id == dataset.database_id)
    conn_res = await session.execute(conn_stmt)
    db_conn = conn_res.scalar_one_or_none()

    return {
        "id": str(dataset.id),
        "name": dataset.name,
        "description": dataset.description,
        "database_id": str(dataset.database_id),
        "database_name": db_conn.name if db_conn else "Unknown",
        "schema_name": dataset.schema_name,
        "table_name": dataset.table_name,
        "is_virtual": dataset.is_virtual,
        "sql_expression": dataset.sql_expression,
        "columns": [
            {
                "id": str(c.id),
                "name": c.name,
                "verbose_name": c.verbose_name,
                "data_type": c.data_type,
                "is_datetime": c.is_datetime,
                "is_dimension": c.is_dimension,
                "is_filterable": c.is_filterable,
                "is_groupable": c.is_groupable,
                "is_hidden_from_ai": c.is_hidden_from_ai,
                "description": c.description,
            }
            for c in dataset.columns
        ],
        "metrics": [
            {
                "id": str(m.id),
                "name": m.name,
                "verbose_name": m.verbose_name,
                "sql_expression": m.sql_expression,
                "metric_type": m.metric_type,
                "number_format": m.number_format,
                "description": m.description,
            }
            for m in dataset.metrics
        ],
        "rls_rules": [
            {
                "id": str(r.id),
                "role_id": str(r.role_id),
                "clause": r.clause,
                "description": r.description,
                "is_active": r.is_active,
            }
            for r in dataset.rls_rules
        ],
    }


@router.post("/batch-delete")
async def batch_delete_datasets(
    payload: BatchDeleteDatasetsRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Dict[str, Any]:
    """Batch delete multiple datasets and cascade to their charts and dashboards."""
    total_deleted = 0
    total_charts = 0
    total_dashboards = 0
    for ds_id in payload.ids:
        try:
            res = await delete_dataset_cascade(session=session, dataset_id=ds_id)
            total_deleted += 1
            total_charts += res.get("deleted_charts_count", 0)
            total_dashboards += res.get("deleted_dashboards_count", 0)
        except Exception as e:
            logger.warning(f"Failed to cascade delete dataset {ds_id}: {e}")
    return {
        "message": f"{total_deleted} dataset(s) deleted successfully.",
        "deleted_count": total_deleted,
        "deleted_charts_count": total_charts,
        "deleted_dashboards_count": total_dashboards,
    }


@router.delete("/{id}")
async def delete_dataset(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Dict[str, Any]:
    """Delete a semantic dataset and cascade to all its charts and dashboards."""
    stmt = select(Dataset).where(Dataset.id == id, Dataset.deleted_at.is_(None))
    result = await session.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise NotFoundError("Dataset not found.")

    _check_dataset_access(dataset, current_user, write=True)

    res = await delete_dataset_cascade(session=session, dataset_id=id)
    return {
        "message": "Dataset deleted successfully.",
        "deleted_charts_count": res.get("deleted_charts_count", 0),
        "deleted_dashboards_count": res.get("deleted_dashboards_count", 0),
    }


@router.post("/{id}/metrics", status_code=status.HTTP_201_CREATED)
async def add_dataset_metric(
    id: uuid.UUID,
    payload: DatasetMetricBase,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Dict[str, Any]:
    """Add a calculated aggregation metric to the dataset."""
    stmt = select(Dataset).where(Dataset.id == id, Dataset.deleted_at.is_(None))
    result = await session.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise NotFoundError("Dataset not found.")

    metric = DatasetMetric(
        dataset_id=dataset.id,
        name=payload.name,
        verbose_name=payload.verbose_name or payload.name.replace("_", " ").title(),
        sql_expression=payload.sql_expression,
        metric_type=payload.metric_type,
        number_format=payload.number_format,
        description=payload.description,
    )
    session.add(metric)
    await session.commit()
    await session.refresh(metric)
    return {"message": "Metric created successfully.", "id": str(metric.id)}


@router.delete("/{id}/metrics/{metric_id}")
async def delete_dataset_metric(
    id: uuid.UUID,
    metric_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Dict[str, str]:
    """Delete a metric from a dataset."""
    stmt = select(DatasetMetric).where(
        DatasetMetric.id == metric_id,
        DatasetMetric.dataset_id == id,
    )
    result = await session.execute(stmt)
    metric = result.scalar_one_or_none()
    if not metric:
        raise NotFoundError("Metric not found.")

    await session.delete(metric)
    await session.commit()
    return {"message": "Metric deleted successfully."}


@router.post("/{id}/rls", status_code=status.HTTP_201_CREATED)
async def add_dataset_rls_rule(
    id: uuid.UUID,
    payload: RLSRuleBase,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:write")),
) -> Dict[str, Any]:
    """Add a row-level security rule to the dataset."""
    stmt = select(Dataset).where(Dataset.id == id, Dataset.deleted_at.is_(None))
    result = await session.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise NotFoundError("Dataset not found.")

    rule = RLSRule(
        dataset_id=dataset.id,
        role_id=payload.role_id,
        clause=payload.clause,
        description=payload.description,
        is_active=payload.is_active,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return {"message": "RLS rule created successfully.", "id": str(rule.id)}


@router.get("/{id}/profile")
async def get_dataset_profile(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:read")),
) -> Dict[str, Any]:
    """Lightweight statistical profile of dataset columns."""
    cache_key = f"dataset_profile:{id}"
    cached = QueryResultCache.get(cache_key)
    if cached:
        return cached

    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == id, Dataset.deleted_at.is_(None))
    )
    result = await session.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise NotFoundError("Dataset not found.")

    _check_dataset_access(dataset, current_user, write=False)

    db_conn = await session.get(DatabaseConnection, dataset.database_id)
    if not db_conn or db_conn.deleted_at is not None:
        raise NotFoundError("Associated database connection not found.")

    connector = get_connector(db_conn)
    dialect = (db_conn.dialect or "").lower()
    is_mssql = dialect in ("mssql", "tsql")

    if dataset.is_virtual and dataset.sql_expression:
        clean_expr = dataset.sql_expression.strip().rstrip(";")
        if is_mssql and "LIMIT" in clean_expr.upper():
            try:
                clean_expr = validate_and_format_sql(clean_expr, dialect="mssql", allow_dml=False)
            except Exception:
                pass
        from_clause = f"({clean_expr}) AS virtual_source"
    else:
        schema = dataset.schema_name or ("public" if dialect in ("postgres", "postgresql") else ("dbo" if is_mssql else None))
        if is_mssql:
            schema_prefix = f"[{schema}]." if schema else ""
            from_clause = f"{schema_prefix}[{dataset.table_name or 'source'}]"
        else:
            schema_prefix = f"{quote_identifier(schema)}." if schema else ""
            from_clause = f"{schema_prefix}{quote_identifier(dataset.table_name or 'source')}"

    columns = dataset.columns or []
    if not columns:
        return {
            "dataset_id": str(dataset.id),
            "dataset_name": dataset.name,
            "table_name": dataset.table_name,
            "total_rows": 0,
            "columns": [],
        }

    # Build single aggregate query for total_rows and per-column stats
    select_items = ["COUNT(*) AS total_rows"]
    col_alias_map = {}

    for idx, c in enumerate(columns):
        safe_col = quote_identifier(c.name)
        c_type = (c.data_type or "").upper()
        is_num = any(t in c_type for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC")) and not (
            c.name.lower().endswith("_id") or c.name.lower() in ("id", "code", "key", "sl_no")
        )

        nn_alias = f"nn_{idx}"
        dist_alias = f"dist_{idx}"
        select_items.append(f"COUNT({safe_col}) AS {nn_alias}")
        select_items.append(f"COUNT(DISTINCT {safe_col}) AS {dist_alias}")

        min_alias = f"min_{idx}" if is_num else None
        max_alias = f"max_{idx}" if is_num else None
        avg_alias = f"avg_{idx}" if is_num else None

        if is_num:
            select_items.append(f"MIN({safe_col}) AS {min_alias}")
            select_items.append(f"MAX({safe_col}) AS {max_alias}")
            select_items.append(f"AVG({safe_col}) AS {avg_alias}")

        col_alias_map[c.name] = {
            "nn": nn_alias,
            "dist": dist_alias,
            "min": min_alias,
            "max": max_alias,
            "avg": avg_alias,
            "is_num": is_num,
            "data_type": c.data_type,
        }

    agg_sql = f"SELECT {', '.join(select_items)} FROM {from_clause}"
    agg_res = connector.execute_query(agg_sql, limit=1)

    total_rows = 0
    row_dict = {}
    if agg_res.rows:
        row_dict = dict(zip(agg_res.columns, agg_res.rows[0]))
        total_rows = int(row_dict.get("total_rows", 0) or 0)

    # Process each column's metrics
    col_profiles = []
    for idx, c in enumerate(columns):
        meta = col_alias_map[c.name]
        non_null_count = int(row_dict.get(meta["nn"], 0) or 0)
        null_count = max(0, total_rows - non_null_count)
        null_pct = round((null_count / total_rows * 100), 2) if total_rows > 0 else 0.0
        distinct_count = int(row_dict.get(meta["dist"], 0) or 0)

        min_val = row_dict.get(meta["min"]) if meta["is_num"] else None
        max_val = row_dict.get(meta["max"]) if meta["is_num"] else None
        avg_val = row_dict.get(meta["avg"]) if meta["is_num"] else None
        if avg_val is not None:
            avg_val = round(float(avg_val), 2)

        # Top 5 values for low-cardinality columns
        top_values = None
        if 0 < distinct_count <= 50 and total_rows > 0:
            safe_col = f"[{c.name}]" if is_mssql else quote_identifier(c.name)
            if is_mssql:
                top_sql = (
                    f"SELECT TOP 5 {safe_col} AS val, COUNT(*) AS cnt "
                    f"FROM {from_clause} "
                    f"WHERE {safe_col} IS NOT NULL "
                    f"GROUP BY {safe_col} "
                    f"ORDER BY cnt DESC"
                )
            else:
                top_sql = (
                    f"SELECT {safe_col} AS val, COUNT(*) AS cnt "
                    f"FROM {from_clause} "
                    f"WHERE {safe_col} IS NOT NULL "
                    f"GROUP BY {safe_col} "
                    f"ORDER BY cnt DESC LIMIT 5"
                )
            try:
                top_res = connector.execute_query(top_sql, limit=5)
                top_values = [
                    {"value": str(r[0]) if r[0] is not None else "(null)", "count": int(r[1])}
                    for r in top_res.rows
                ]
            except Exception:
                top_values = None

        col_profiles.append({
            "name": c.name,
            "verbose_name": c.verbose_name or c.name,
            "data_type": c.data_type,
            "is_dimension": c.is_dimension,
            "is_datetime": c.is_datetime,
            "total_rows": total_rows,
            "null_count": null_count,
            "null_percentage": null_pct,
            "distinct_count": distinct_count,
            "min": min_val,
            "max": max_val,
            "avg": avg_val,
            "top_values": top_values,
        })

    profile_data = {
        "dataset_id": str(dataset.id),
        "dataset_name": dataset.name,
        "table_name": dataset.table_name,
        "total_rows": total_rows,
        "columns": col_profiles,
    }
    QueryResultCache.set(cache_key, profile_data, ttl_seconds=300)
    return profile_data


@router.get("/{id}/rows")
async def get_dataset_rows(
    id: uuid.UUID,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    order_by: Optional[str] = Query(None),
    order_dir: Optional[str] = Query("asc"),
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("datasets:read")),
) -> Dict[str, Any]:
    """Retrieve paginated rows from dataset with server-side offset, limit, and sorting."""
    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == id, Dataset.deleted_at.is_(None))
    )
    result = await session.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise NotFoundError("Dataset not found.")

    _check_dataset_access(dataset, current_user, write=False)

    db_conn = await session.get(DatabaseConnection, dataset.database_id)
    if not db_conn or db_conn.deleted_at is not None:
        raise NotFoundError("Associated database connection not found.")

    connector = get_connector(db_conn)
    dialect = (db_conn.dialect or "").lower()
    is_mssql = dialect in ("mssql", "tsql")

    if dataset.is_virtual and dataset.sql_expression:
        clean_expr = dataset.sql_expression.strip().rstrip(";")
        if is_mssql and "LIMIT" in clean_expr.upper():
            try:
                clean_expr = validate_and_format_sql(clean_expr, dialect="mssql", allow_dml=False)
            except Exception:
                pass
        from_clause = f"({clean_expr}) AS virtual_source"
    else:
        schema = dataset.schema_name or ("public" if dialect in ("postgres", "postgresql") else ("dbo" if is_mssql else None))
        if is_mssql:
            schema_prefix = f"[{schema}]." if schema else ""
            from_clause = f"{schema_prefix}[{dataset.table_name or 'source'}]"
        else:
            schema_prefix = f"{quote_identifier(schema)}." if schema else ""
            from_clause = f"{schema_prefix}{quote_identifier(dataset.table_name or 'source')}"

    # 1. Total count query
    count_sql = f"SELECT COUNT(*) AS total FROM {from_clause}"
    count_res = connector.execute_query(count_sql, limit=1)
    total_count = int(count_res.rows[0][0]) if count_res.rows else 0

    # 2. Sort order
    order_clause = ""
    valid_col_names = {c.name for c in (dataset.columns or [])}
    if order_by:
        if order_by not in valid_col_names:
            raise ValidationError(f"Column '{order_by}' is not valid for sorting.")
        direction = "DESC" if (order_dir or "").lower() == "desc" else "ASC"
        order_clause = f" ORDER BY {quote_identifier(order_by)} {direction}"

    # 3. Paginated query
    if is_mssql:
        if not order_clause:
            first_col = (dataset.columns[0].name) if dataset.columns else None
            order_clause = f" ORDER BY [{first_col}] ASC" if first_col else " ORDER BY (SELECT NULL)"
        query_sql = f"SELECT * FROM {from_clause}{order_clause} OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"
        safe_sql = query_sql
    else:
        query_sql = f"SELECT * FROM {from_clause}{order_clause} LIMIT {limit} OFFSET {offset}"
        safe_sql = validate_and_format_sql(
            raw_sql=query_sql,
            dialect=dialect,
            allow_dml=False,
            row_limit=max(limit + offset, 10000),
        )

    query_res = connector.execute_query(safe_sql, limit=limit)

    total_pages = ((total_count + limit - 1) // limit) if total_count > 0 else 1
    current_page = (offset // limit) + 1

    return {
        "dataset_id": str(dataset.id),
        "total": total_count,
        "limit": limit,
        "offset": offset,
        "page": current_page,
        "total_pages": total_pages,
        "columns": query_res.columns,
        "column_types": query_res.column_types,
        "rows": query_res.rows,
        "duration_ms": query_res.duration_ms,
    }
