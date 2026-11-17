"""Materialization Engine for API Connect.

Stores versioned Parquet snapshots on disk, creates/updates DuckDB analytical tables
under write lock, and synchronizes the semantic Dataset registry.
"""
from datetime import datetime, timezone
import logging
import os
from typing import Any, Dict, List, Optional
import duckdb
import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.connectors.duckdb_connector import duckdb_write_lock
from app.core.config import settings
from app.core.errors import AppException
from app.db.models import DatabaseConnection, Dataset, DatasetColumn, User
from app.db.models.api_connect import ApiDatasetCollection, ApiDatasetTable, ApiSnapshot
from app.services.api_connect.normalizer import sanitize_field_name

logger = logging.getLogger(__name__)


def get_snapshots_directory(collection_id: Any, table_name: str) -> str:
    """Resolve durable storage path for Parquet snapshots."""
    data_dir = os.path.dirname(os.path.abspath(settings.DUCKDB_DATABASE_PATH))
    base_dir = os.path.join(
        data_dir,
        "snapshots",
        str(collection_id),
        sanitize_field_name(table_name),
    )
    os.makedirs(base_dir, exist_ok=True)
    return base_dir


async def get_or_create_duckdb_connection(session: AsyncSession, user: Optional[User] = None) -> DatabaseConnection:
    """Locate or register DuckDB DatabaseConnection entity."""
    stmt = (
        select(DatabaseConnection)
        .where(
            DatabaseConnection.name == "Uploads",
            DatabaseConnection.dialect == "duckdb",
        )
        .order_by(DatabaseConnection.created_at.asc())
    )
    res = await session.execute(stmt)
    db_conn = res.scalars().first()

    if not db_conn:
        db_conn = DatabaseConnection(
            name="Uploads",
            description="Internal DuckDB analytical store for files and API datasets",
            dialect="duckdb",
            is_system=True,
            allow_dml=False,
            allow_file_uploads=True,
            allow_sqllab=True,
            row_limit=settings.DEFAULT_ROW_LIMIT,
            statement_timeout_seconds=settings.STATEMENT_TIMEOUT_SECONDS,
            ai_allowed_schemas=["main"],
            created_by_id=user.id if user else None,
        )
        session.add(db_conn)
        await session.flush()

    return db_conn


async def materialize_api_table(
    session: AsyncSession,
    table: ApiDatasetTable,
    df: pd.DataFrame,
    user: Optional[User] = None,
) -> Dict[str, Any]:
    """Materialize DataFrame into versioned Parquet snapshot, register DuckDB table, and sync semantic catalog."""
    collection = table.collection
    if not collection and table.collection_id:
        c_stmt = select(ApiDatasetCollection).where(ApiDatasetCollection.id == table.collection_id)
        c_res = await session.execute(c_stmt)
        collection = c_res.scalars().first()

    collection_name = collection.name if collection else "api"
    clean_collection = sanitize_field_name(collection_name)
    clean_table = sanitize_field_name(table.table_name)
    physical_table_name = f"api_{clean_collection}_{clean_table}"

    snapshots_dir = get_snapshots_directory(table.collection_id, table.table_name)

    ver_stmt = (
        select(ApiSnapshot.snapshot_version)
        .where(ApiSnapshot.table_id == table.id)
        .order_by(ApiSnapshot.snapshot_version.desc())
    )
    ver_res = await session.execute(ver_stmt)
    latest_ver = ver_res.scalars().first()
    current_version = (latest_ver or 0) + 1

    snapshot_filename = f"v{current_version}.parquet"
    snapshot_path = os.path.join(snapshots_dir, snapshot_filename)

    df.to_parquet(snapshot_path, index=False)
    file_size = os.path.getsize(snapshot_path)

    snapshot_record = ApiSnapshot(
        table_id=table.id,
        snapshot_version=current_version,
        record_count=len(df),
        file_size_bytes=file_size,
        parquet_path=snapshot_path,
    )
    session.add(snapshot_record)

    duckdb_path = getattr(settings, "DUCKDB_PATH", settings.DUCKDB_DATABASE_PATH)
    normalized_parquet_path = snapshot_path.replace("\\", "/")

    with duckdb_write_lock:
        write_conn = duckdb.connect(duckdb_path)
        try:
            write_conn.execute(
                f"CREATE OR REPLACE TABLE {physical_table_name} AS SELECT * FROM read_parquet('{normalized_parquet_path}')"
            )
            cols_info = write_conn.execute(f"PRAGMA table_info('{physical_table_name}')").fetchall()
        finally:
            write_conn.close()

    duckdb_conn = await get_or_create_duckdb_connection(session, user)

    dataset: Optional[Dataset] = None
    if table.semantic_dataset_id:
        ds_stmt = select(Dataset).where(Dataset.id == table.semantic_dataset_id)
        ds_res = await session.execute(ds_stmt)
        dataset = ds_res.scalars().first()

    if not dataset:
        ds_stmt = select(Dataset).where(
            Dataset.database_id == duckdb_conn.id,
            Dataset.schema_name == "main",
            Dataset.table_name == physical_table_name,
        )
        ds_res = await session.execute(ds_stmt)
        dataset = ds_res.scalars().first()

    if not dataset:
        dataset = Dataset(
            name=f"{collection.name if collection else 'API'} - {table.display_name}",
            description=f"Materialized API endpoint dataset for {table.display_name}",
            database_id=duckdb_conn.id,
            schema_name="main",
            table_name=physical_table_name,
            is_virtual=False,
            created_by_id=user.id if user else (collection.owner_id if collection else None),
        )
        session.add(dataset)
        await session.flush()

    table.semantic_dataset_id = dataset.id

    await session.execute(
        delete(DatasetColumn).where(DatasetColumn.dataset_id == dataset.id)
    )
    await session.flush()

    for col_row in cols_info:
        col_name = str(col_row[1])
        col_type = str(col_row[2]).upper()
        is_dt = ("TIME" in col_type) or ("DATE" in col_type)
        is_num = any(t in col_type for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC", "HUGEINT"))

        dataset_col = DatasetColumn(
            dataset_id=dataset.id,
            name=col_name,
            verbose_name=col_name.replace("_", " ").title(),
            data_type=col_type,
            is_datetime=is_dt,
            is_dimension=True,
            is_filterable=True,
            is_groupable=True,
        )
        session.add(dataset_col)

    table.record_count = len(df)
    table.column_count = len(df.columns)
    table.last_synced_at = datetime.now(timezone.utc)
    table.materialization_status = "ready"
    table.last_error = None
    table.schema_metadata = {str(r[1]): str(r[2]) for r in cols_info}

    await session.flush()

    # Automatically provision complete visualizations (all chart types) + dashboard
    dashboard_id = None
    dashboard_slug = None
    try:
        from app.uploads.dashboard_generator import generate_dashboard_for_dataset
        cols_stmt = select(DatasetColumn).where(DatasetColumn.dataset_id == dataset.id)
        cols_res = await session.execute(cols_stmt)
        saved_cols = list(cols_res.scalars().all())

        dash = await generate_dashboard_for_dataset(
            session=session,
            dataset=dataset,
            columns=saved_cols,
            user=user,
            filename=table.display_name,
        )
        if dash:
            dashboard_id = str(dash.id)
            dashboard_slug = dash.slug
        await session.flush()
    except Exception as e:
        import logging
        logging.getLogger("askyourdata.api_connect.materializer").warning(
            f"Failed to auto-generate dashboard for API dataset '{dataset.name}': {e}",
            exc_info=True,
        )

    return {
        "status": "ready",
        "physical_table_name": physical_table_name,
        "dataset_id": str(dataset.id),
        "dashboard_id": dashboard_id,
        "dashboard_slug": dashboard_slug,
        "record_count": len(df),
        "column_count": len(df.columns),
        "snapshot_version": current_version,
        "snapshot_path": snapshot_path,
    }
