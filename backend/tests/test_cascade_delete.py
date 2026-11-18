"""Unit and Integration Tests for Cascade Deletion Service.

Verifies that deleting a Dataset, Database Connection, API Connection, or Upload
completely cleans up all associated charts and dashboards, preventing any orphaned records.
"""
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import (
    Chart,
    Dashboard,
    DashboardChart,
    DatabaseConnection,
    Dataset,
    DatasetColumn,
    UploadedFile,
    User,
)
from app.db.models.api_connect import ApiConnection, ApiDatasetCollection, ApiDatasetTable
from app.services.cascade_delete_service import (
    cleanup_orphaned_records,
    delete_api_connection_cascade,
    delete_api_table_cascade,
    delete_database_cascade,
    delete_dataset_cascade,
    delete_upload_cascade,
)


@pytest.fixture
async def admin_user(db_session: AsyncSession) -> User:
    """Retrieve default admin user."""
    res = await db_session.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
    return res.scalar_one()


@pytest.fixture
async def sample_db_conn(db_session: AsyncSession, admin_user: User) -> DatabaseConnection:
    """Create test SQLite database connection."""
    conn = DatabaseConnection(
        name=f"Cascade Test DB {uuid.uuid4().hex[:6]}",
        dialect="sqlite",
        database_name=":memory:",
        is_system=False,
        allow_dml=False,
        created_by_id=admin_user.id,
    )
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)
    return conn


@pytest.mark.asyncio
async def test_dataset_cascade_delete_removes_charts_and_dashboards(
    db_session: AsyncSession,
    sample_db_conn: DatabaseConnection,
    admin_user: User,
):
    """Deleting a dataset must remove all its charts and its dedicated dashboard."""
    # 1. Create a dataset
    dataset = Dataset(
        name="sales_records",
        table_name="sales_records",
        schema_name="main",
        database_id=sample_db_conn.id,
        is_virtual=False,
        created_by_id=admin_user.id,
    )
    db_session.add(dataset)
    await db_session.flush()

    col = DatasetColumn(dataset_id=dataset.id, name="revenue", data_type="FLOAT", is_dimension=False)
    db_session.add(col)
    await db_session.flush()

    # 2. Create charts for this dataset
    chart1 = Chart(
        title="Revenue Bar Chart",
        dataset_id=dataset.id,
        viz_type="bar",
        created_by_id=admin_user.id,
    )
    chart2 = Chart(
        title="Revenue Line Chart",
        dataset_id=dataset.id,
        viz_type="line",
        created_by_id=admin_user.id,
    )
    db_session.add_all([chart1, chart2])
    await db_session.flush()

    # 3. Create dedicated dashboard for this dataset
    dashboard = Dashboard(
        title="Sales Records Dashboard",
        slug="sales-records-overview",
        created_by_id=admin_user.id,
    )
    db_session.add(dashboard)
    await db_session.flush()

    # 4. Attach charts to dashboard
    dc1 = DashboardChart(dashboard_id=dashboard.id, chart_id=chart1.id, position={"x": 0, "y": 0, "w": 6, "h": 4})
    dc2 = DashboardChart(dashboard_id=dashboard.id, chart_id=chart2.id, position={"x": 6, "y": 0, "w": 6, "h": 4})
    db_session.add_all([dc1, dc2])
    await db_session.commit()

    # Verify they exist
    assert (await db_session.get(Dataset, dataset.id)) is not None
    assert (await db_session.get(Chart, chart1.id)) is not None
    assert (await db_session.get(Dashboard, dashboard.id)) is not None

    # Execute cascade delete
    result = await delete_dataset_cascade(session=db_session, dataset_id=dataset.id)
    assert result["status"] == "success"
    assert result["deleted_charts_count"] == 2
    assert result["deleted_dashboards_count"] == 1

    # Verify everything was deleted
    assert (await db_session.get(Dataset, dataset.id)) is None
    assert (await db_session.get(Chart, chart1.id)) is None
    assert (await db_session.get(Chart, chart2.id)) is None
    assert (await db_session.get(Dashboard, dashboard.id)) is None


@pytest.mark.asyncio
async def test_database_cascade_delete_removes_all_datasets_charts_dashboards(
    db_session: AsyncSession,
    sample_db_conn: DatabaseConnection,
    admin_user: User,
):
    """Deleting a database must delete all its datasets, charts, unified dashboard and table dashboards."""
    # Create two datasets in this database
    ds1 = Dataset(name="table_alpha", table_name="table_alpha", database_id=sample_db_conn.id, created_by_id=admin_user.id)
    ds2 = Dataset(name="table_beta", table_name="table_beta", database_id=sample_db_conn.id, created_by_id=admin_user.id)
    db_session.add_all([ds1, ds2])
    await db_session.flush()

    # Create charts
    ch1 = Chart(title="Alpha Chart", dataset_id=ds1.id, viz_type="bar", created_by_id=admin_user.id)
    ch2 = Chart(title="Beta Chart", dataset_id=ds2.id, viz_type="line", created_by_id=admin_user.id)
    db_session.add_all([ch1, ch2])
    await db_session.flush()

    # Create Unified Dashboard and per-table dashboards
    import re
    clean_conn = re.sub(r"[^a-zA-Z0-9]+", "-", sample_db_conn.name.lower()).strip("-")
    unified_dash = Dashboard(
        title=f"{sample_db_conn.name} - Full Database Dashboard",
        slug=f"{clean_conn}-full-dashboard",
        created_by_id=admin_user.id,
    )
    table_dash = Dashboard(
        title="table_alpha Dashboard",
        slug="table-alpha-overview",
        created_by_id=admin_user.id,
    )
    db_session.add_all([unified_dash, table_dash])
    await db_session.flush()

    db_session.add(DashboardChart(dashboard_id=unified_dash.id, chart_id=ch1.id))
    db_session.add(DashboardChart(dashboard_id=unified_dash.id, chart_id=ch2.id))
    db_session.add(DashboardChart(dashboard_id=table_dash.id, chart_id=ch1.id))
    await db_session.commit()

    # Execute cascade delete on database
    res = await delete_database_cascade(session=db_session, database_id=sample_db_conn.id)
    assert res["status"] == "success"
    assert res["deleted_datasets_count"] == 2
    assert res["deleted_charts_count"] == 2
    assert res["deleted_dashboards_count"] >= 2

    # Verify everything is gone
    assert (await db_session.get(DatabaseConnection, sample_db_conn.id)) is None
    assert (await db_session.get(Dataset, ds1.id)) is None
    assert (await db_session.get(Dataset, ds2.id)) is None
    assert (await db_session.get(Chart, ch1.id)) is None
    assert (await db_session.get(Chart, ch2.id)) is None
    assert (await db_session.get(Dashboard, unified_dash.id)) is None
    assert (await db_session.get(Dashboard, table_dash.id)) is None


@pytest.mark.asyncio
async def test_api_connection_cascade_delete(
    db_session: AsyncSession,
    sample_db_conn: DatabaseConnection,
    admin_user: User,
):
    """Deleting an API connection must drop DuckDB tables and cascade delete semantic datasets, charts, and dashboards."""
    # 1. Create API connection
    api_conn = ApiConnection(
        name=f"Weather API {uuid.uuid4().hex[:6]}",
        base_url="https://api.example.com",
        auth_type="none",
        owner_id=admin_user.id,
    )
    db_session.add(api_conn)
    await db_session.flush()

    # 2. Create Collection and Table
    col = ApiDatasetCollection(name=f"Weather Col {uuid.uuid4().hex[:6]}", owner_id=admin_user.id)
    db_session.add(col)
    await db_session.flush()

    # 3. Create semantic dataset
    ds = Dataset(name="weather_forecast", table_name="api_weather_forecast", database_id=sample_db_conn.id, created_by_id=admin_user.id)
    db_session.add(ds)
    await db_session.flush()

    tbl = ApiDatasetTable(
        collection_id=col.id,
        connection_id=api_conn.id,
        semantic_dataset_id=ds.id,
        display_name="Forecast Table",
        table_name=f"forecast_{uuid.uuid4().hex[:6]}",
    )
    db_session.add(tbl)
    await db_session.flush()

    # 4. Create chart and dashboard
    chart = Chart(title="Forecast Chart", dataset_id=ds.id, viz_type="bar", created_by_id=admin_user.id)
    db_session.add(chart)
    await db_session.flush()

    dash = Dashboard(title="Forecast Dashboard", slug="forecast-overview", created_by_id=admin_user.id)
    db_session.add(dash)
    await db_session.flush()

    db_session.add(DashboardChart(dashboard_id=dash.id, chart_id=chart.id))
    await db_session.commit()

    # Execute cascade delete
    res = await delete_api_connection_cascade(session=db_session, connection_id=api_conn.id)
    assert res["status"] == "success"
    assert res["deleted_datasets_count"] >= 1

    # Verify everything is gone
    assert (await db_session.get(ApiConnection, api_conn.id)) is None
    assert (await db_session.get(Dataset, ds.id)) is None
    assert (await db_session.get(Chart, chart.id)) is None
    assert (await db_session.get(Dashboard, dash.id)) is None


@pytest.mark.asyncio
async def test_cleanup_orphaned_records(
    db_session: AsyncSession,
    sample_db_conn: DatabaseConnection,
    admin_user: User,
):
    """Verify cleanup_orphaned_records identifies and removes leftover charts with non-existent dataset IDs."""
    fake_dataset_id = uuid.uuid4()

    # Create orphaned chart pointing to non-existent dataset
    orphan_chart = Chart(
        title="Ghost Chart",
        dataset_id=fake_dataset_id,
        viz_type="bar",
        created_by_id=admin_user.id,
    )
    db_session.add(orphan_chart)
    await db_session.flush()

    orphan_dash = Dashboard(
        title="Ghost Dashboard",
        slug="ghost-overview",
        created_by_id=admin_user.id,
    )
    db_session.add(orphan_dash)
    await db_session.flush()

    db_session.add(DashboardChart(dashboard_id=orphan_dash.id, chart_id=orphan_chart.id))
    await db_session.commit()

    # Run cleanup
    clean_res = await cleanup_orphaned_records(session=db_session)
    assert clean_res["orphaned_charts_deleted"] >= 1
    assert clean_res["empty_dashboards_deleted"] >= 1

    # Verify both are purged
    assert (await db_session.get(Chart, orphan_chart.id)) is None
    assert (await db_session.get(Dashboard, orphan_dash.id)) is None
