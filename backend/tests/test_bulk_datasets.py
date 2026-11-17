"""Tests for Bulk Dataset Creation and Inventory endpoints."""
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import DatabaseConnection, Dataset, DatasetColumn, DashboardChart
from app.uploads.dashboard_generator import generate_dashboard_for_dataset


@pytest.mark.asyncio
async def test_inventory_endpoint(client: AsyncClient, db_session: AsyncSession):
    # Register a local sqlite database
    db_conn = DatabaseConnection(
        name="Test Inventory DB",
        dialect="sqlite",
        database_name=":memory:",
        allow_dml=False,
    )
    db_session.add(db_conn)
    await db_session.commit()
    await db_session.refresh(db_conn)

    # Test inventory endpoint via POST and GET
    res_post = await client.post(f"/api/v1/databases/{db_conn.id}/inventory")
    assert res_post.status_code == 200
    data_post = res_post.json()
    assert "schemas" in data_post
    assert isinstance(data_post["schemas"], list)

    res_get = await client.get(f"/api/v1/databases/{db_conn.id}/inventory")
    assert res_get.status_code == 200
    assert "schemas" in res_get.json()


@pytest.mark.asyncio
async def test_bulk_dataset_cap_limit(client: AsyncClient, db_session: AsyncSession):
    db_conn = DatabaseConnection(
        name="Cap Limit DB",
        dialect="sqlite",
        database_name=":memory:",
        allow_dml=False,
    )
    db_session.add(db_conn)
    await db_session.commit()
    await db_session.refresh(db_conn)

    # Exceed cap
    items = [{"schema_name": "main", "table_name": f"tbl_{i}"} for i in range(settings.BULK_DATASET_MAX_TABLES + 1)]
    res = await client.post(
        "/api/v1/datasets/bulk",
        json={"database_id": str(db_conn.id), "items": items, "create_dashboards": False},
    )
    assert res.status_code == 400
    data = res.json()
    err_msg = data.get("message", "") or data.get("error", {}).get("message", "") or data.get("detail", "")
    assert "exceed maximum allowed limit" in err_msg


@pytest.mark.asyncio
async def test_dashboard_generator_junction_table(db_session: AsyncSession):
    """Verify junction tables (only ID columns, no numeric measures) produce Total Records and Summary Table."""
    db_conn = DatabaseConnection(
        name="Junction DB",
        dialect="sqlite",
        database_name=":memory:",
        allow_dml=False,
    )
    db_session.add(db_conn)
    await db_session.commit()
    await db_session.refresh(db_conn)

    dataset = Dataset(
        name="Student Courses",
        database_id=db_conn.id,
        schema_name="main",
        table_name="student_courses",
        is_virtual=False,
    )
    db_session.add(dataset)
    await db_session.commit()
    await db_session.refresh(dataset)

    col1 = DatasetColumn(
        dataset_id=dataset.id,
        name="student_id",
        verbose_name="Student Id",
        data_type="INTEGER",
        is_dimension=True,
    )
    col2 = DatasetColumn(
        dataset_id=dataset.id,
        name="course_id",
        verbose_name="Course Id",
        data_type="INTEGER",
        is_dimension=True,
    )
    db_session.add(col1)
    db_session.add(col2)
    await db_session.commit()

    # Generate dashboard for junction table
    dashboard = await generate_dashboard_for_dataset(
        session=db_session,
        dataset=dataset,
        columns=[col1, col2],
        user=None,
        filename="student_courses",
    )
    assert dashboard is not None
    assert dashboard.slug == "student-courses-overview"
    # Should contain exactly 2 charts: Total Records + Summary Table
    charts_res = await db_session.execute(select(DashboardChart).where(DashboardChart.dashboard_id == dashboard.id))
    charts = charts_res.scalars().all()
    assert len(charts) == 2


@pytest.mark.asyncio
async def test_bulk_dataset_create_and_skip_existing(client: AsyncClient, db_session: AsyncSession):
    """Test bulk creating multiple tables, naming, and rerun skipping existing."""
    db_conn = DatabaseConnection(
        name="Bulk Test DB",
        dialect="sqlite",
        database_name=":memory:",
        allow_dml=False,
    )
    db_session.add(db_conn)
    await db_session.commit()
    await db_session.refresh(db_conn)

    # 1. Bulk create 2 tables: users, logs
    items = [
        {"schema_name": "main", "table_name": "users"},
        {"schema_name": "main", "table_name": "logs"},
    ]
    res = await client.post(
        "/api/v1/datasets/bulk",
        json={"database_id": str(db_conn.id), "items": items, "create_dashboards": False},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["total_requested"] == 2
    assert data["created_count"] == 2
    assert data["skipped_count"] == 0
    assert data["failed_count"] == 0
    assert len(data["results"]) == 2
    assert data["results"][0]["status"] == "created"
    assert data["results"][1]["status"] == "created"

    # 2. Rerun exact same request - should return skipped_existing
    res_rerun = await client.post(
        "/api/v1/datasets/bulk",
        json={"database_id": str(db_conn.id), "items": items, "create_dashboards": False},
    )
    assert res_rerun.status_code == 201
    data_rerun = res_rerun.json()
    assert data_rerun["total_requested"] == 2
    assert data_rerun["created_count"] == 0
    assert data_rerun["skipped_count"] == 2
    assert data_rerun["failed_count"] == 0
    assert data_rerun["results"][0]["status"] == "skipped_existing"
    assert data_rerun["results"][1]["status"] == "skipped_existing"


@pytest.mark.asyncio
async def test_bulk_dataset_cross_schema_naming(client: AsyncClient, db_session: AsyncSession):
    """Verify tables with the same name across different schemas are named '<schema>.<table>'."""
    db_conn = DatabaseConnection(
        name="Multi-Schema DB",
        dialect="sqlite",
        database_name=":memory:",
        allow_dml=False,
    )
    db_session.add(db_conn)
    await db_session.commit()
    await db_session.refresh(db_conn)

    # Two items with the same table name 'logs' across two schemas
    items = [
        {"schema_name": "academics", "table_name": "logs"},
        {"schema_name": "exams", "table_name": "logs"},
        {"schema_name": "finance", "table_name": "fees"},
    ]
    res = await client.post(
        "/api/v1/datasets/bulk",
        json={"database_id": str(db_conn.id), "items": items, "create_dashboards": False},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["created_count"] == 3

    # Check dataset names in database
    ds_res = await db_session.execute(select(Dataset).where(Dataset.database_id == db_conn.id))
    datasets = {d.table_name + "_" + (d.schema_name or ""): d.name for d in ds_res.scalars().all()}
    assert datasets["logs_academics"] == "academics.logs"
    assert datasets["logs_exams"] == "exams.logs"
    # 'fees' only appears in one schema, so its name is 'fees'
    assert datasets["fees_finance"] == "fees"

