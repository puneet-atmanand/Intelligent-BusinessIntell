"""Tests for Unified Database Dashboard Builder and Auto-Visualize API."""
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Chart, Dashboard, DashboardChart, DatabaseConnection, Dataset, DatasetColumn, User
from app.services.database_dashboard_builder import build_unified_database_dashboard


@pytest.fixture
async def test_db_conn(db_session: AsyncSession) -> DatabaseConnection:
    """Fixture creating a test SQLite database connection."""
    conn = DatabaseConnection(
        name=f"Test Analytics DB {uuid.uuid4().hex[:6]}",
        dialect="sqlite",
        database_name=":memory:",
        is_system=False,
        allow_dml=False,
    )
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)
    return conn


@pytest.fixture
async def admin_user(db_session: AsyncSession) -> User:
    """Retrieve default admin user."""
    res = await db_session.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
    return res.scalar_one()


@pytest.mark.asyncio
async def test_unified_dashboard_column_type_mapping(db_session: AsyncSession, test_db_conn: DatabaseConnection, admin_user: User):
    """Verify column classification and chart generation across all column types."""
    # Create test dataset with multiple column types
    dataset = Dataset(
        name="metrics_test",
        table_name="metrics_test",
        schema_name="main",
        database_id=test_db_conn.id,
        is_virtual=False,
        created_by_id=admin_user.id,
    )
    db_session.add(dataset)
    await db_session.flush()

    cols = [
        DatasetColumn(dataset_id=dataset.id, name="record_id", data_type="INTEGER", is_dimension=True),
        DatasetColumn(dataset_id=dataset.id, name="full_name", data_type="VARCHAR", is_dimension=True),
        DatasetColumn(dataset_id=dataset.id, name="category", data_type="VARCHAR", is_dimension=True),
        DatasetColumn(dataset_id=dataset.id, name="score", data_type="FLOAT", is_dimension=False),
        DatasetColumn(dataset_id=dataset.id, name="created_at", data_type="TIMESTAMP", is_datetime=True, is_dimension=True),
        DatasetColumn(dataset_id=dataset.id, name="is_active", data_type="BOOLEAN", is_dimension=True),
    ]
    for c in cols:
        db_session.add(c)
    await db_session.commit()

    # Build unified dashboard
    res = await build_unified_database_dashboard(
        session=db_session,
        database_id=test_db_conn.id,
        user=admin_user,
        tables=[{"schema_name": "main", "table_name": "metrics_test"}],
        per_table_dashboards=True,
        unified_dashboard=True,
    )

    assert res["unified_dashboard_slug"] is not None
    assert "full-dashboard" in res["unified_dashboard_slug"]
    assert res["charts_count"] > 0
    assert "main.metrics_test" in res["columns_visualized"]

    dash = (await db_session.execute(select(Dashboard).where(Dashboard.slug == res["unified_dashboard_slug"]))).scalar_one()
    dash_charts = (await db_session.execute(select(DashboardChart).where(DashboardChart.dashboard_id == dash.id))).scalars().all()
    assert len(dash_charts) == res["charts_count"]

    # Check chart titles and types
    chart_ids = [dc.chart_id for dc in dash_charts]
    charts = (await db_session.execute(select(Chart).where(Chart.id.in_(chart_ids)))).scalars().all()
    viz_types = {c.viz_type for c in charts}
    assert "header" in viz_types
    assert "big_number" in viz_types
    assert "bar" in viz_types


@pytest.mark.asyncio
async def test_unified_dashboard_idempotency(db_session: AsyncSession, test_db_conn: DatabaseConnection, admin_user: User):
    """Running auto-visualize multiple times refreshes in-place with no duplicate records."""
    dataset = Dataset(
        name="sales_data",
        table_name="sales_data",
        schema_name="main",
        database_id=test_db_conn.id,
        is_virtual=False,
        created_by_id=admin_user.id,
    )
    db_session.add(dataset)
    await db_session.flush()

    cols = [
        DatasetColumn(dataset_id=dataset.id, name="id", data_type="INTEGER", is_dimension=True),
        DatasetColumn(dataset_id=dataset.id, name="amount", data_type="NUMERIC", is_dimension=False),
        DatasetColumn(dataset_id=dataset.id, name="region", data_type="VARCHAR", is_dimension=True),
    ]
    for c in cols:
        db_session.add(c)
    await db_session.commit()

    # First run
    res1 = await build_unified_database_dashboard(
        session=db_session,
        database_id=test_db_conn.id,
        user=admin_user,
        tables=[{"schema_name": "main", "table_name": "sales_data"}],
        per_table_dashboards=True,
        unified_dashboard=True,
    )

    # Second run
    res2 = await build_unified_database_dashboard(
        session=db_session,
        database_id=test_db_conn.id,
        user=admin_user,
        tables=[{"schema_name": "main", "table_name": "sales_data"}],
        per_table_dashboards=True,
        unified_dashboard=True,
    )

    assert res1["unified_dashboard_slug"] == res2["unified_dashboard_slug"]
    assert res1["charts_count"] == res2["charts_count"]

    # Assert only 1 unified dashboard exists in DB
    dashboards = (
        await db_session.execute(
            select(Dashboard).where(Dashboard.slug == res1["unified_dashboard_slug"], Dashboard.deleted_at.is_(None))
        )
    ).scalars().all()
    assert len(dashboards) == 1

    # Assert per-table dashboard also exists without duplicates
    per_table_dashboards = (
        await db_session.execute(
            select(Dashboard).where(Dashboard.slug == "sales-data-overview", Dashboard.deleted_at.is_(None))
        )
    ).scalars().all()
    assert len(per_table_dashboards) == 1


@pytest.mark.asyncio
async def test_auto_visualize_api_endpoint(client: AsyncClient, db_session: AsyncSession, test_db_conn: DatabaseConnection):
    """Test POST /api/v1/databases/{id}/auto-visualize HTTP endpoint."""
    dataset = Dataset(
        name="items",
        table_name="items",
        schema_name="main",
        database_id=test_db_conn.id,
        is_virtual=False,
    )
    db_session.add(dataset)
    await db_session.flush()

    db_session.add(DatasetColumn(dataset_id=dataset.id, name="item_id", data_type="INTEGER", is_dimension=True))
    db_session.add(DatasetColumn(dataset_id=dataset.id, name="category", data_type="VARCHAR", is_dimension=True))
    await db_session.commit()

    payload = {
        "tables": [{"schema_name": "main", "table_name": "items"}],
        "per_table_dashboards": True,
        "unified_dashboard": True,
    }

    response = await client.post(
        f"/api/v1/databases/{test_db_conn.id}/auto-visualize",
        json=payload,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["database_id"] == str(test_db_conn.id)
    assert data["unified_dashboard_slug"] is not None
    assert data["sections_count"] >= 2  # Overview + items
    assert data["charts_count"] > 0
    assert len(data["per_table_dashboards"]) == 1
    assert data["per_table_dashboards"][0]["table"] == "items"


@pytest.mark.asyncio
async def test_auto_visualize_unified_only_endpoint(client: AsyncClient, db_session: AsyncSession, test_db_conn: DatabaseConnection):
    """Test POST /api/v1/databases/{id}/auto-visualize with unified_dashboard=True and per_table_dashboards=False."""
    dataset = Dataset(
        name="inventory",
        table_name="inventory",
        schema_name="main",
        database_id=test_db_conn.id,
        is_virtual=False,
    )
    db_session.add(dataset)
    await db_session.flush()

    db_session.add(DatasetColumn(dataset_id=dataset.id, name="prod_id", data_type="INTEGER", is_dimension=True))
    db_session.add(DatasetColumn(dataset_id=dataset.id, name="qty", data_type="INTEGER", is_dimension=False))
    await db_session.commit()

    payload = {
        "tables": [{"schema_name": "main", "table_name": "inventory"}],
        "per_table_dashboards": False,
        "unified_dashboard": True,
    }

    response = await client.post(
        f"/api/v1/databases/{test_db_conn.id}/auto-visualize",
        json=payload,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["database_id"] == str(test_db_conn.id)
    assert data["unified_dashboard_slug"] is not None
    assert data["per_table_dashboards_created"] == 1
    assert len(data["per_table_dashboards"]) == 1
    assert data["per_table_dashboards"][0]["table"] == "inventory"
    assert data["per_table_dashboards"][0]["status"] == "created"
    assert data["per_table_dashboards"][0]["dashboard_slug"] == data["unified_dashboard_slug"]
