"""Cascade Deletion Service.

Centralized service ensuring that deleting a Dataset, Database Connection, API Connection,
API Table, API Collection, or File Upload completely cascades and deletes all associated
charts and auto-generated / dedicated dashboards, leaving no orphaned charts or zombie dashboards.
"""
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Set
import duckdb
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.connectors.duckdb_connector import duckdb_write_lock
from app.core.config import settings
from app.core.errors import NotFoundError, PermissionDeniedError
from app.db.models import (
    Chart,
    Dashboard,
    DashboardChart,
    DashboardFilter,
    DatabaseConnection,
    Dataset,
    DatasetColumn,
    DatasetMetric,
    RLSRule,
    UploadedFile,
)
from app.db.models.api_connect import (
    ApiConnection,
    ApiDatasetCollection,
    ApiDatasetTable,
    ApiSnapshot,
)
from app.services.api_connect.normalizer import sanitize_field_name

logger = logging.getLogger("askyourdata.cascade_delete")


def _clean_slug(name: str) -> str:
    """Produce a safe, lowercase, hyphenated slug string."""
    return re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").lower()).strip("-")


def drop_duckdb_table_if_exists(table_name: str) -> None:
    """Drop a DuckDB table if it exists under the write lock."""
    if not table_name:
        return
    try:
        with duckdb_write_lock:
            conn = duckdb.connect(settings.DUCKDB_DATABASE_PATH, read_only=False)
            try:
                conn.execute(f"DROP TABLE IF EXISTS {table_name}")
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Could not drop DuckDB table '{table_name}': {e}")


async def delete_dataset_cascade(session: AsyncSession, dataset_id: uuid.UUID) -> Dict[str, Any]:
    """Delete a dataset and cascade to all its charts, dedicated dashboards, and empty dashboards."""
    stmt = select(Dataset).where(Dataset.id == dataset_id, Dataset.deleted_at.is_(None))
    result = await session.execute(stmt)
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise NotFoundError("Dataset not found.")

    # 1. Fetch all charts belonging to this dataset
    ch_stmt = select(Chart).where(Chart.dataset_id == dataset_id, Chart.deleted_at.is_(None))
    ch_res = await session.execute(ch_stmt)
    dataset_charts = list(ch_res.scalars().all())
    chart_ids = [c.id for c in dataset_charts]

    # 2. Build dedicated dashboard slug candidates for this dataset
    clean_table = _clean_slug(dataset.table_name or dataset.name)
    clean_name = _clean_slug(dataset.name)
    schema_prefix = ""
    if dataset.schema_name and dataset.schema_name.lower() not in ("public", "main"):
        schema_prefix = f"{_clean_slug(dataset.schema_name)}-"

    dedicated_slugs = {
        f"{schema_prefix}{clean_table}-overview",
        f"{clean_table}-overview",
        f"{clean_name}-overview",
    }

    # If this is an overview virtual source dataset for a database, its slug is the unified dashboard
    if (
        dataset.name.endswith("Overview Virtual Source")
        or (dataset.table_name and dataset.table_name.startswith("__") and dataset.table_name.endswith("_inventory__"))
    ):
        db_conn = await session.get(DatabaseConnection, dataset.database_id)
        if db_conn:
            dedicated_slugs.add(f"{_clean_slug(db_conn.name)}-full-dashboard")

    # 3. Collect dashboards to delete
    dashboards_to_delete: Set[uuid.UUID] = set()

    # Find dashboards by dedicated slug
    if dedicated_slugs:
        slug_stmt = select(Dashboard).where(Dashboard.slug.in_(dedicated_slugs), Dashboard.deleted_at.is_(None))
        slug_dashboards = (await session.execute(slug_stmt)).scalars().all()
        for d in slug_dashboards:
            dashboards_to_delete.add(d.id)

    # Inspect dashboards that place any of this dataset's charts
    if chart_ids:
        dc_stmt = select(DashboardChart).where(DashboardChart.chart_id.in_(chart_ids))
        placements = (await session.execute(dc_stmt)).scalars().all()
        placed_dashboard_ids = {p.dashboard_id for p in placements}

        for d_id in placed_dashboard_ids:
            if d_id in dashboards_to_delete:
                continue
            dash = await session.get(Dashboard, d_id)
            if not dash or dash.deleted_at:
                continue

            # Check all placements in this dashboard
            all_dc_stmt = select(DashboardChart).where(DashboardChart.dashboard_id == d_id)
            all_dcs = (await session.execute(all_dc_stmt)).scalars().all()
            remaining_charts = [p for p in all_dcs if p.chart_id not in chart_ids]

            if not remaining_charts:
                # Dashboard will be empty without these charts!
                dashboards_to_delete.add(d_id)
            else:
                # Remove deleted charts from this dashboard
                await session.execute(
                    delete(DashboardChart).where(
                        DashboardChart.dashboard_id == d_id,
                        DashboardChart.chart_id.in_(chart_ids),
                    )
                )

    # 4. Delete dashboards marked for deletion
    deleted_dashboard_titles = []
    for d_id in dashboards_to_delete:
        dash = await session.get(Dashboard, d_id)
        if dash:
            deleted_dashboard_titles.append(dash.title)
            await session.execute(delete(DashboardChart).where(DashboardChart.dashboard_id == d_id))
            await session.execute(delete(DashboardFilter).where(DashboardFilter.dashboard_id == d_id))
            await session.delete(dash)

    # 5. Delete charts and placements
    if chart_ids:
        await session.execute(delete(DashboardChart).where(DashboardChart.chart_id.in_(chart_ids)))
        await session.execute(delete(Chart).where(Chart.id.in_(chart_ids)))

    # 6. Unlink any ApiDatasetTable referencing this dataset
    api_tbl_stmt = select(ApiDatasetTable).where(ApiDatasetTable.semantic_dataset_id == dataset_id)
    api_tables = (await session.execute(api_tbl_stmt)).scalars().all()
    for api_tbl in api_tables:
        api_tbl.semantic_dataset_id = None

    # 7. Delete dataset (cascades DatasetColumn, DatasetMetric, RLSRule)
    await session.delete(dataset)
    await session.commit()

    return {
        "status": "success",
        "deleted_dataset_id": str(dataset_id),
        "deleted_charts_count": len(chart_ids),
        "deleted_dashboards_count": len(deleted_dashboard_titles),
        "deleted_dashboards": deleted_dashboard_titles,
    }


async def delete_database_cascade(session: AsyncSession, database_id: uuid.UUID) -> Dict[str, Any]:
    """Delete a database connection and cascade to all its datasets, charts, unified & per-table dashboards."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == database_id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")
    if conn.is_system:
        raise PermissionDeniedError("System connections (e.g. built-in DuckDB 'Uploads') cannot be deleted.")

    # 1. Find all datasets for this database
    ds_stmt = select(Dataset).where(Dataset.database_id == database_id)
    datasets = list((await session.execute(ds_stmt)).scalars().all())
    dataset_ids = [d.id for d in datasets]

    # 2. Find all charts for all these datasets
    chart_ids: List[uuid.UUID] = []
    if dataset_ids:
        ch_stmt = select(Chart).where(Chart.dataset_id.in_(dataset_ids))
        charts = list((await session.execute(ch_stmt)).scalars().all())
        chart_ids = [c.id for c in charts]

    # 3. Identify all dashboards to delete
    dashboards_to_delete: Set[uuid.UUID] = set()

    # 3a. Unified dashboard for this database
    clean_conn = _clean_slug(conn.name)
    unified_slug = f"{clean_conn}-full-dashboard"
    u_stmt = select(Dashboard).where(Dashboard.slug == unified_slug, Dashboard.deleted_at.is_(None))
    u_dash = (await session.execute(u_stmt)).scalar_one_or_none()
    if u_dash:
        dashboards_to_delete.add(u_dash.id)

    # Any dashboard with title matching database full dashboard
    title_stmt = select(Dashboard).where(
        Dashboard.title.like(f"{conn.name} - Full Database Dashboard%"),
        Dashboard.deleted_at.is_(None),
    )
    for d in (await session.execute(title_stmt)).scalars().all():
        dashboards_to_delete.add(d.id)

    # 3b. Dedicated per-table dashboards for datasets in this database
    dedicated_slugs = set()
    for ds in datasets:
        clean_tbl = _clean_slug(ds.table_name or ds.name)
        clean_ds = _clean_slug(ds.name)
        schema_pfx = f"{_clean_slug(ds.schema_name)}-" if ds.schema_name and ds.schema_name.lower() not in ("public", "main") else ""
        dedicated_slugs.add(f"{schema_pfx}{clean_tbl}-overview")
        dedicated_slugs.add(f"{clean_tbl}-overview")
        dedicated_slugs.add(f"{clean_ds}-overview")

    if dedicated_slugs:
        slug_stmt = select(Dashboard).where(Dashboard.slug.in_(dedicated_slugs), Dashboard.deleted_at.is_(None))
        for d in (await session.execute(slug_stmt)).scalars().all():
            dashboards_to_delete.add(d.id)

    # 3c. Dashboards placing any of these charts
    if chart_ids:
        dc_stmt = select(DashboardChart).where(DashboardChart.chart_id.in_(chart_ids))
        placements = (await session.execute(dc_stmt)).scalars().all()
        placed_dashboard_ids = {p.dashboard_id for p in placements}

        for d_id in placed_dashboard_ids:
            if d_id in dashboards_to_delete:
                continue
            dash = await session.get(Dashboard, d_id)
            if not dash or dash.deleted_at:
                continue

            all_dc_stmt = select(DashboardChart).where(DashboardChart.dashboard_id == d_id)
            all_dcs = (await session.execute(all_dc_stmt)).scalars().all()
            remaining_charts = [p for p in all_dcs if p.chart_id not in chart_ids]

            if not remaining_charts:
                dashboards_to_delete.add(d_id)
            else:
                await session.execute(
                    delete(DashboardChart).where(
                        DashboardChart.dashboard_id == d_id,
                        DashboardChart.chart_id.in_(chart_ids),
                    )
                )

    # 4. Delete identified dashboards
    deleted_dashboard_titles = []
    for d_id in dashboards_to_delete:
        dash = await session.get(Dashboard, d_id)
        if dash:
            deleted_dashboard_titles.append(dash.title)
            await session.execute(delete(DashboardChart).where(DashboardChart.dashboard_id == d_id))
            await session.execute(delete(DashboardFilter).where(DashboardFilter.dashboard_id == d_id))
            await session.delete(dash)

    # 5. Delete charts and placements
    if chart_ids:
        await session.execute(delete(DashboardChart).where(DashboardChart.chart_id.in_(chart_ids)))
        await session.execute(delete(Chart).where(Chart.id.in_(chart_ids)))

    # 6. Clean up any uploaded files targeting this database (if non-system)
    upload_stmt = select(UploadedFile).where(UploadedFile.target_database_id == database_id)
    uploads = list((await session.execute(upload_stmt)).scalars().all())
    for up in uploads:
        drop_duckdb_table_if_exists(up.target_table_name)
        await session.delete(up)

    # 7. Delete datasets
    for ds in datasets:
        # Unlink any ApiDatasetTable
        api_tbl_stmt = select(ApiDatasetTable).where(ApiDatasetTable.semantic_dataset_id == ds.id)
        for api_tbl in (await session.execute(api_tbl_stmt)).scalars().all():
            api_tbl.semantic_dataset_id = None
        await session.delete(ds)

    # 8. Delete the database connection
    await session.delete(conn)
    await session.commit()

    return {
        "status": "success",
        "deleted_database_id": str(database_id),
        "deleted_datasets_count": len(dataset_ids),
        "deleted_charts_count": len(chart_ids),
        "deleted_dashboards_count": len(deleted_dashboard_titles),
        "deleted_dashboards": deleted_dashboard_titles,
    }


async def delete_api_connection_cascade(session: AsyncSession, connection_id: uuid.UUID) -> Dict[str, Any]:
    """Delete an API connection, drop all its materialized DuckDB tables, and cascade delete its datasets, charts & dashboards."""
    conn = await session.get(ApiConnection, connection_id)
    if not conn or conn.deleted_at:
        raise NotFoundError(f"Connection {connection_id} not found")

    # 1. Find all tables for this connection
    tbl_stmt = select(ApiDatasetTable).where(ApiDatasetTable.connection_id == connection_id)
    tables = list((await session.execute(tbl_stmt)).scalars().all())

    semantic_dataset_ids: Set[uuid.UUID] = set()

    for tbl in tables:
        # Drop DuckDB tables
        clean_tbl = sanitize_field_name(tbl.table_name)
        drop_duckdb_table_if_exists(clean_tbl)
        drop_duckdb_table_if_exists(tbl.table_name)
        if tbl.collection_id:
            col = await session.get(ApiDatasetCollection, tbl.collection_id)
            clean_col = sanitize_field_name(col.name if col else "api")
            physical_name = f"api_{clean_col}_{clean_tbl}"
            drop_duckdb_table_if_exists(physical_name)

        # Drop snapshot DuckDB tables
        snap_stmt = select(ApiSnapshot).where(ApiSnapshot.table_id == tbl.id)
        snaps = (await session.execute(snap_stmt)).scalars().all()
        for s in snaps:
            drop_duckdb_table_if_exists(s.snapshot_table_name)

        if tbl.semantic_dataset_id:
            semantic_dataset_ids.add(tbl.semantic_dataset_id)

    # Also look for any datasets matching table names
    for tbl in tables:
        clean_tbl = sanitize_field_name(tbl.table_name)
        ds_find_stmt = select(Dataset).where(Dataset.table_name.in_([tbl.table_name, clean_tbl]))
        for d in (await session.execute(ds_find_stmt)).scalars().all():
            semantic_dataset_ids.add(d.id)

    # 2. Cascade delete all collected semantic datasets (which deletes their charts and dashboards)
    deleted_datasets_count = 0
    deleted_charts_count = 0
    deleted_dashboards_count = 0
    for ds_id in semantic_dataset_ids:
        ds = await session.get(Dataset, ds_id)
        if ds and not ds.deleted_at:
            res = await delete_dataset_cascade(session=session, dataset_id=ds_id)
            deleted_datasets_count += 1
            deleted_charts_count += res.get("deleted_charts_count", 0)
            deleted_dashboards_count += res.get("deleted_dashboards_count", 0)

    # 3. Explicitly delete tables and the ApiConnection
    for tbl in tables:
        await session.delete(tbl)
    await session.delete(conn)
    await session.commit()

    return {
        "status": "success",
        "deleted_connection_id": str(connection_id),
        "deleted_datasets_count": deleted_datasets_count,
        "deleted_charts_count": deleted_charts_count,
        "deleted_dashboards_count": deleted_dashboards_count,
    }


async def delete_api_table_cascade(session: AsyncSession, table_id: uuid.UUID) -> Dict[str, Any]:
    """Delete an API table, drop DuckDB table, and cascade delete its dataset, charts & dashboards."""
    table = await session.get(ApiDatasetTable, table_id)
    if not table or table.deleted_at:
        raise NotFoundError(f"Table {table_id} not found")

    col = await session.get(ApiDatasetCollection, table.collection_id) if table.collection_id else None
    clean_col = sanitize_field_name(col.name if col else "api")
    clean_tbl = sanitize_field_name(table.table_name)
    physical_name = f"api_{clean_col}_{clean_tbl}"

    drop_duckdb_table_if_exists(physical_name)
    drop_duckdb_table_if_exists(clean_tbl)
    drop_duckdb_table_if_exists(table.table_name)

    # Drop snapshot tables
    snap_stmt = select(ApiSnapshot).where(ApiSnapshot.table_id == table.id)
    snaps = (await session.execute(snap_stmt)).scalars().all()
    for s in snaps:
        drop_duckdb_table_if_exists(s.snapshot_table_name)

    semantic_dataset_id = table.semantic_dataset_id
    if not semantic_dataset_id:
        ds_find = await session.execute(
            select(Dataset).where(Dataset.table_name.in_([table.table_name, physical_name, clean_tbl]))
        )
        found_ds = ds_find.scalars().first()
        if found_ds:
            semantic_dataset_id = found_ds.id

    deleted_charts_count = 0
    deleted_dashboards_count = 0
    if semantic_dataset_id:
        ds = await session.get(Dataset, semantic_dataset_id)
        if ds and not ds.deleted_at:
            res = await delete_dataset_cascade(session=session, dataset_id=semantic_dataset_id)
            deleted_charts_count = res.get("deleted_charts_count", 0)
            deleted_dashboards_count = res.get("deleted_dashboards_count", 0)

    await session.delete(table)
    await session.commit()

    return {
        "status": "success",
        "deleted_table_id": str(table_id),
        "deleted_charts_count": deleted_charts_count,
        "deleted_dashboards_count": deleted_dashboards_count,
    }


async def delete_api_collection_cascade(session: AsyncSession, collection_id: uuid.UUID) -> Dict[str, Any]:
    """Delete an API collection and all its tables, dropping DuckDB tables and cascade deleting datasets, charts & dashboards."""
    col = await session.get(ApiDatasetCollection, collection_id)
    if not col or col.deleted_at:
        raise NotFoundError(f"Collection {collection_id} not found")

    tbl_stmt = select(ApiDatasetTable).where(ApiDatasetTable.collection_id == collection_id)
    tables = list((await session.execute(tbl_stmt)).scalars().all())

    for tbl in tables:
        await delete_api_table_cascade(session=session, table_id=tbl.id)

    await session.delete(col)
    await session.commit()

    return {
        "status": "success",
        "deleted_collection_id": str(collection_id),
        "tables_deleted": len(tables),
    }


async def delete_upload_cascade(session: AsyncSession, upload_id: uuid.UUID) -> Dict[str, Any]:
    """Delete an uploaded file record, drop DuckDB table, and cascade delete its dataset, charts & dashboards."""
    stmt = select(UploadedFile).where(UploadedFile.id == upload_id, UploadedFile.deleted_at.is_(None))
    result = await session.execute(stmt)
    file_record = result.scalar_one_or_none()
    if not file_record:
        raise NotFoundError("Upload record not found.")

    table_name = file_record.target_table_name
    drop_duckdb_table_if_exists(table_name)

    # Find associated dataset
    ds_stmt = select(Dataset).where(
        Dataset.database_id == file_record.target_database_id,
        Dataset.table_name == table_name,
        Dataset.deleted_at.is_(None),
    )
    dataset = (await session.execute(ds_stmt)).scalar_one_or_none()
    if not dataset:
        # Fallback by name
        ds_stmt2 = select(Dataset).where(
            Dataset.database_id == file_record.target_database_id,
            Dataset.name.in_([file_record.original_name, table_name]),
            Dataset.deleted_at.is_(None),
        )
        dataset = (await session.execute(ds_stmt2)).scalar_one_or_none()

    deleted_charts_count = 0
    deleted_dashboards_count = 0
    if dataset:
        res = await delete_dataset_cascade(session=session, dataset_id=dataset.id)
        deleted_charts_count = res.get("deleted_charts_count", 0)
        deleted_dashboards_count = res.get("deleted_dashboards_count", 0)

    await session.delete(file_record)
    await session.commit()

    return {
        "status": "success",
        "deleted_upload_id": str(upload_id),
        "table_name": table_name,
        "deleted_charts_count": deleted_charts_count,
        "deleted_dashboards_count": deleted_dashboards_count,
    }


async def cleanup_orphaned_records(session: AsyncSession) -> Dict[str, int]:
    """Clean up any charts, dashboard placements, or dashboards that were orphaned by previous deletions."""
    # 1. Fetch valid dataset IDs
    valid_ds_stmt = select(Dataset.id).where(Dataset.deleted_at.is_(None))
    valid_ds_res = await session.execute(valid_ds_stmt)
    valid_ds_ids = set(valid_ds_res.scalars().all())

    # 2. Find orphaned charts
    all_ch_stmt = select(Chart).where(Chart.deleted_at.is_(None))
    all_ch_res = await session.execute(all_ch_stmt)
    all_charts = all_ch_res.scalars().all()
    orphaned_chart_ids = [c.id for c in all_charts if c.dataset_id not in valid_ds_ids]

    # Delete orphaned chart placements and charts
    if orphaned_chart_ids:
        await session.execute(
            delete(DashboardChart).where(DashboardChart.chart_id.in_(orphaned_chart_ids))
        )
        await session.execute(
            delete(Chart).where(Chart.id.in_(orphaned_chart_ids))
        )

    # 3. Clean up invalid placements (pointing to nonexistent charts or dashboards)
    all_valid_ch_stmt = select(Chart.id).where(Chart.deleted_at.is_(None))
    valid_chart_ids = set((await session.execute(all_valid_ch_stmt)).scalars().all())

    all_valid_dash_stmt = select(Dashboard.id).where(Dashboard.deleted_at.is_(None))
    valid_dash_ids = set((await session.execute(all_valid_dash_stmt)).scalars().all())

    all_dc_stmt = select(DashboardChart)
    all_dcs = (await session.execute(all_dc_stmt)).scalars().all()
    for dc in all_dcs:
        if dc.chart_id not in valid_chart_ids or dc.dashboard_id not in valid_dash_ids:
            await session.delete(dc)

    await session.flush()

    # 4. Check dashboards: if an auto-generated dashboard or any dashboard has 0 charts, delete it!
    dash_stmt = select(Dashboard).where(Dashboard.deleted_at.is_(None))
    all_dashboards = list((await session.execute(dash_stmt)).scalars().all())
    deleted_dashboards_count = 0

    for d in all_dashboards:
        # Check active placements for this dashboard
        dc_count_stmt = select(DashboardChart).where(DashboardChart.dashboard_id == d.id)
        dc_records = (await session.execute(dc_count_stmt)).scalars().all()
        # If it has 0 charts and is auto-generated (overview or full dashboard) or completely empty
        if not dc_records:
            await session.execute(delete(DashboardChart).where(DashboardChart.dashboard_id == d.id))
            await session.execute(delete(DashboardFilter).where(DashboardFilter.dashboard_id == d.id))
            await session.delete(d)
            deleted_dashboards_count += 1

    await session.commit()
    logger.info(
        f"Cleaned up {len(orphaned_chart_ids)} orphaned charts and {deleted_dashboards_count} empty dashboards."
    )
    return {
        "orphaned_charts_deleted": len(orphaned_chart_ids),
        "empty_dashboards_deleted": deleted_dashboards_count,
    }
