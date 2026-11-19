"""Automatic Dynamic Dashboard & Chart Generator for Datasets."""
import re
from typing import Any, Dict, List, Optional
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Chart, Dashboard, DashboardChart, Dataset, DatasetColumn, User
from app.query.chart_query_builder import quote_identifier

NUMERIC_TYPES = ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC")
ID_LIKE_NAMES = {"id", "no", "sl_no", "sl_number", "row_id", "index", "code", "key"}
HIGH_CARDINALITY_HINTS = (
    "email", "mail", "phone", "mobile", "first_name", "last_name", "full_name",
    "address", "street", "url", "uuid", "guid", "description", "comment", "notes",
    "password", "token", "hash", "name"
)
CATEGORICAL_HINTS = (
    "course", "city", "country", "state", "status", "category", "type", "department",
    "dept", "gender", "role", "segment", "group", "region", "tier", "level", "branch",
    "grade", "division", "genre", "plan"
)


def _is_numeric_col(col: DatasetColumn) -> bool:
    return any(t in (col.data_type or "").upper() for t in NUMERIC_TYPES)


def _is_id_like(col: DatasetColumn) -> bool:
    n = col.name.lower()
    return (
        n in ID_LIKE_NAMES
        or n.endswith("_id")
        or n.startswith("id_")
        or (n.endswith("id") and len(n) <= 6)
        or "uuid" in n
        or "guid" in n
    )


def _is_numeric_measure(col: DatasetColumn) -> bool:
    """True only if numeric AND not an identifier/key."""
    return _is_numeric_col(col) and not _is_id_like(col)


def _rank_dimension_cols(cols: List[DatasetColumn]) -> List[DatasetColumn]:
    """Order dimension columns so low/medium-cardinality grouping columns come first."""
    dims = [c for c in cols if c.is_dimension and not c.is_datetime and not _is_numeric_measure(c)]

    def score(c: DatasetColumn) -> int:
        n = c.name.lower()
        if _is_id_like(c):
            return 100
        if any(h in n for h in HIGH_CARDINALITY_HINTS):
            return 50
        if any(cat in n for cat in CATEGORICAL_HINTS):
            return -10
        return 0

    return sorted(dims, key=score)


def _rank_numeric_cols(cols: List[DatasetColumn]) -> List[DatasetColumn]:
    """Only return genuine numeric measures, never row IDs or keys."""
    nums = [c for c in cols if _is_numeric_measure(c)]
    return nums


async def generate_dashboard_for_dataset(
    session: AsyncSession,
    dataset: Dataset,
    columns: List[DatasetColumn],
    user: Optional[User],
    filename: str = "",
) -> Dashboard:
    """Create (or refresh) a dynamic Dashboard + Charts tailored to the dataset's schema."""
    table_slug = re.sub(r"[^a-zA-Z0-9]+", "-", (dataset.table_name or dataset.name).lower()).strip("-")
    schema_prefix = ""
    if dataset.schema_name and dataset.schema_name.lower() not in ("public", "main"):
        clean_schema = re.sub(r"[^a-zA-Z0-9]+", "-", dataset.schema_name.lower()).strip("-")
        schema_prefix = f"{clean_schema}-"
    slug = f"{schema_prefix}{table_slug}-overview"

    # Remove existing auto-generated dashboard with the same slug so re-uploads stay fresh
    existing_stmt = select(Dashboard).where(Dashboard.slug == slug, Dashboard.deleted_at.is_(None))
    existing_res = await session.execute(existing_stmt)
    existing_dash = existing_res.scalar_one_or_none()
    if existing_dash:
        old_chart_ids = [dc.chart_id for dc in (existing_dash.charts or [])]
        await session.delete(existing_dash)
        await session.flush()
        if old_chart_ids:
            await session.execute(delete(Chart).where(Chart.id.in_(old_chart_ids)))
            await session.flush()

    dt_cols = [c for c in columns if c.is_datetime]
    dim_cols = _rank_dimension_cols(columns)
    genuine_dims = [c for c in dim_cols if not _is_id_like(c)]
    num_cols = _rank_numeric_cols(columns)

    def _make_metric(col: DatasetColumn, agg: str = "AVG") -> Dict[str, Any]:
        return {
            "name": f"{agg.lower()}_{col.name}",
            "column": col.name,
            "agg": agg,
            "label": f"{agg}({col.name})",
            "expression": f"{agg}({quote_identifier(col.name)})",
        }

    count_metric = {"name": "count", "column": "count", "agg": "COUNT", "label": "Total Rows", "expression": "COUNT(*)"}
    primary_num = num_cols[0] if num_cols else None
    secondary_num = num_cols[1] if len(num_cols) > 1 else None

    chart_specs: List[Dict[str, Any]] = []

    # Handle edge case: Pure junction tables (e.g. only ID columns and no numeric measures)
    # create minimal 2 charts: Total Records + Summary Table
    is_junction_table = not genuine_dims and not num_cols
    if is_junction_table:
        chart_specs.append({
            "title": f"Total {dataset.name}",
            "viz_type": "big_number",
            "params": {
                "dimensions": [],
                "metrics": [count_metric],
                "metrics_config": [{"id": "m-0", "column": "count", "agg": "COUNT"}],
                "primary_metric_col": "count",
                "primary_metric_agg": "COUNT",
                "row_limit": 1,
                "options": {},
            },
            "position": {"x": 0, "y": 0, "w": 12, "h": 3},
        })
        table_dims = [c.name for c in columns[:4]] if columns else []
        chart_specs.append({
            "title": f"{dataset.name} Summary Table",
            "viz_type": "table",
            "params": {
                "dimensions": table_dims,
                "metrics": [count_metric],
                "metrics_config": [{"id": "m-0", "column": "count", "agg": "COUNT"}],
                "primary_metric_col": "count",
                "primary_metric_agg": "COUNT",
                "row_limit": 50,
                "options": {},
            },
            "position": {"x": 0, "y": 3, "w": 12, "h": 5},
        })
    else:
        # 1. Row 0: Top KPI Row (Big Numbers)
        if primary_num and secondary_num:
            chart_specs.append({
                "title": f"Total {dataset.name}",
                "viz_type": "big_number",
                "params": {
                    "dimensions": [],
                    "metrics": [count_metric],
                    "metrics_config": [{"id": "m-0", "column": "count", "agg": "COUNT"}],
                    "primary_metric_col": "count",
                    "primary_metric_agg": "COUNT",
                    "row_limit": 1,
                    "options": {},
                },
                "position": {"x": 0, "y": 0, "w": 4, "h": 3},
            })
            m_prim = _make_metric(primary_num, "AVG")
            chart_specs.append({
                "title": f"Average {primary_num.verbose_name or primary_num.name}",
                "viz_type": "big_number",
                "params": {
                    "dimensions": [],
                    "metrics": [m_prim],
                    "metrics_config": [{"id": "m-0", "column": primary_num.name, "agg": "AVG"}],
                    "primary_metric_col": primary_num.name,
                    "primary_metric_agg": "AVG",
                    "row_limit": 1,
                    "options": {},
                },
                "position": {"x": 4, "y": 0, "w": 4, "h": 3},
            })
            m_sec = _make_metric(secondary_num, "AVG")
            chart_specs.append({
                "title": f"Average {secondary_num.verbose_name or secondary_num.name}",
                "viz_type": "big_number",
                "params": {
                    "dimensions": [],
                    "metrics": [m_sec],
                    "metrics_config": [{"id": "m-0", "column": secondary_num.name, "agg": "AVG"}],
                    "primary_metric_col": secondary_num.name,
                    "primary_metric_agg": "AVG",
                    "row_limit": 1,
                    "options": {},
                },
                "position": {"x": 8, "y": 0, "w": 4, "h": 3},
            })
        elif primary_num:
            chart_specs.append({
                "title": f"Total {dataset.name}",
                "viz_type": "big_number",
                "params": {
                    "dimensions": [],
                    "metrics": [count_metric],
                    "metrics_config": [{"id": "m-0", "column": "count", "agg": "COUNT"}],
                    "primary_metric_col": "count",
                    "primary_metric_agg": "COUNT",
                    "row_limit": 1,
                    "options": {},
                },
                "position": {"x": 0, "y": 0, "w": 6, "h": 3},
            })
            m_prim = _make_metric(primary_num, "AVG")
            chart_specs.append({
                "title": f"Average {primary_num.verbose_name or primary_num.name}",
                "viz_type": "big_number",
                "params": {
                    "dimensions": [],
                    "metrics": [m_prim],
                    "metrics_config": [{"id": "m-0", "column": primary_num.name, "agg": "AVG"}],
                    "primary_metric_col": primary_num.name,
                    "primary_metric_agg": "AVG",
                    "row_limit": 1,
                    "options": {},
                },
                "position": {"x": 6, "y": 0, "w": 6, "h": 3},
            })
        else:
            chart_specs.append({
                "title": f"Total {dataset.name}",
                "viz_type": "big_number",
                "params": {"dimensions": [], "metrics": [count_metric], "row_limit": 1, "options": {}},
                "position": {"x": 0, "y": 0, "w": 12, "h": 3},
            })

        d1 = genuine_dims[0] if genuine_dims else columns[0]
        d1_label = d1.verbose_name or d1.name
        d2 = genuine_dims[1] if len(genuine_dims) > 1 else d1
        d2_label = d2.verbose_name or d2.name

        # 2. Row 1: Bar Chart & Donut Chart (viz_type: bar, pie)
        chart_specs.append({
            "title": f"{dataset.name} by {d1_label}",
            "viz_type": "bar",
            "params": {
                "dimensions": [d1.name],
                "metrics": [count_metric],
                "row_limit": 25,
                "options": {},
            },
            "position": {"x": 0, "y": 3, "w": 6, "h": 4},
        })

        chart_specs.append({
            "title": f"Distribution by {d2_label}",
            "viz_type": "pie",
            "params": {
                "dimensions": [d2.name],
                "metrics": [count_metric],
                "row_limit": 15,
                "options": {"isDonut": True},
            },
            "position": {"x": 6, "y": 3, "w": 6, "h": 4},
        })

        # 3. Row 2: Line Chart & Area Chart (viz_type: line, area)
        primary_metric_expr = (
            _make_metric(primary_num, "AVG")
            if primary_num
            else count_metric
        )

        if dt_cols:
            dt = dt_cols[0]
            dt_label = dt.verbose_name or dt.name
            chart_specs.append({
                "title": f"{dataset.name} Trend Over {dt_label}",
                "viz_type": "line",
                "params": {
                    "dimensions": [],
                    "time_column": dt.name,
                    "time_grain": "month",
                    "metrics": [primary_metric_expr],
                    "row_limit": 200,
                    "options": {"smooth": True, "showMarkers": True},
                },
                "position": {"x": 0, "y": 7, "w": 6, "h": 4},
            })
            chart_specs.append({
                "title": f"Cumulative Volume Over {dt_label}",
                "viz_type": "area",
                "params": {
                    "dimensions": [],
                    "time_column": dt.name,
                    "time_grain": "month",
                    "metrics": [count_metric],
                    "row_limit": 200,
                    "options": {"stacked": True, "opacity": 0.45},
                },
                "position": {"x": 6, "y": 7, "w": 6, "h": 4},
            })
        else:
            chart_specs.append({
                "title": f"{dataset.name} Trend by {d1_label}",
                "viz_type": "line",
                "params": {
                    "dimensions": [d1.name],
                    "metrics": [primary_metric_expr],
                    "row_limit": 30,
                    "options": {"smooth": True, "showMarkers": True},
                },
                "position": {"x": 0, "y": 7, "w": 6, "h": 4},
            })
            chart_specs.append({
                "title": f"Volume Area by {d1_label}",
                "viz_type": "area",
                "params": {
                    "dimensions": [d1.name],
                    "metrics": [count_metric],
                    "row_limit": 30,
                    "options": {"stacked": False, "opacity": 0.45},
                },
                "position": {"x": 6, "y": 7, "w": 6, "h": 4},
            })

        # 4. Row 3: Scatter Plot & Histogram (viz_type: scatter, histogram)
        scatter_metrics = []
        if primary_num and secondary_num:
            scatter_metrics = [
                _make_metric(primary_num, "AVG"),
                _make_metric(secondary_num, "AVG"),
            ]
        elif primary_num:
            scatter_metrics = [
                _make_metric(primary_num, "AVG"),
                {"name": "record_count", "column": "count", "agg": "COUNT", "label": "Record Count", "expression": "COUNT(*)"},
            ]
        else:
            scatter_metrics = [
                {"name": "record_count", "column": "count", "agg": "COUNT", "label": "Record Count", "expression": "COUNT(*)"},
                {"name": "total_records", "column": "count", "agg": "COUNT", "label": "Total Records", "expression": "COUNT(*)"},
            ]

        chart_specs.append({
            "title": f"{dataset.name} Correlation Scatter Plot",
            "viz_type": "scatter",
            "params": {
                "dimensions": [d1.name],
                "metrics": scatter_metrics,
                "row_limit": 100,
                "options": {"symbolSize": 10},
            },
            "position": {"x": 0, "y": 11, "w": 6, "h": 4},
        })

        if primary_num:
            chart_specs.append({
                "title": f"{primary_num.verbose_name or primary_num.name} Distribution Histogram",
                "viz_type": "histogram",
                "params": {
                    "dimensions": [primary_num.name],
                    "metrics": [],
                    "row_limit": 1000,
                    "options": {"bins": 10},
                },
                "position": {"x": 6, "y": 11, "w": 6, "h": 4},
            })
        else:
            chart_specs.append({
                "title": f"Frequency Breakdown by {d2_label}",
                "viz_type": "bar",
                "params": {
                    "dimensions": [d2.name],
                    "metrics": [count_metric],
                    "row_limit": 25,
                    "options": {},
                },
                "position": {"x": 6, "y": 11, "w": 6, "h": 4},
            })

        # 5. Row 4: Summary Table (viz_type: table)
        table_dims = [c.name for c in genuine_dims[:3]] if genuine_dims else [c.name for c in columns if not c.is_datetime][:4]
        if not table_dims and columns:
            table_dims = [columns[0].name]

        table_metrics = [count_metric]
        if primary_num:
            table_metrics.append(_make_metric(primary_num, "AVG"))
        if secondary_num:
            table_metrics.append(_make_metric(secondary_num, "AVG"))

        chart_specs.append({
            "title": f"{dataset.name} Summary Table",
            "viz_type": "table",
            "params": {
                "dimensions": table_dims,
                "metrics": table_metrics,
                "row_limit": 50,
                "options": {},
            },
            "position": {"x": 0, "y": 15, "w": 12, "h": 5},
        })

    owner_list = [user.email] if user else []
    created_by = user.id if user else None

    dashboard = Dashboard(
        title=f"{dataset.name} Dashboard",
        description=f"Auto-generated dynamic dashboard from '{filename or dataset.table_name}'",
        slug=slug,
        is_published=True,
        layout={"auto_generated": True},
        owners=owner_list,
        created_by_id=created_by,
    )
    session.add(dashboard)
    await session.flush()

    for spec in chart_specs:
        chart = Chart(
            title=spec["title"],
            description=f"Auto-generated from {dataset.name}",
            dataset_id=dataset.id,
            viz_type=spec["viz_type"],
            params=spec["params"],
            query_context={},
            owners=owner_list,
            created_by_id=created_by,
        )
        session.add(chart)
        await session.flush()

        session.add(DashboardChart(
            dashboard_id=dashboard.id,
            chart_id=chart.id,
            position=spec["position"],
        ))

    await session.flush()
    return dashboard


