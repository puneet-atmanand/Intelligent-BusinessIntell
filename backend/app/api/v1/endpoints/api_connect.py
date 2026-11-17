"""API Connect REST endpoints."""
import time
import uuid
from typing import Any, Dict, List, Optional
import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.deps import get_current_user, get_db_session, require_permission
from app.connectors.duckdb_connector import duckdb_write_lock
from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import encrypt_secret
from app.db.models import Chart, Dashboard, DashboardChart, Dataset, DatasetColumn, User
from app.db.models.api_connect import (
    ApiConnection,
    ApiCredential,
    ApiDatasetCollection,
    ApiDatasetTable,
    ApiEndpoint,
    ApiSyncJob,
    ApiSyncRun,
)
from app.schemas.api_connect import (
    ApiCollectionCreate,
    ApiCollectionOut,
    ApiCollectionUpdate,
    ApiCollectionWithTablesOut,
    ApiConnectionCreate,
    ApiConnectionOut,
    ApiConnectionTestRequest,
    ApiConnectionTestResponse,
    ApiConnectionUpdate,
    ApiExploreRequest,
    ApiExploreResponse,
    ApiSyncRunOut,
    ApiTableCreate,
    ApiTableOut,
    ApiTableUpdate,
    OpenApiImportRequest,
    OpenApiImportResponse,
)
from app.services.api_connect.client import ApiConnectClient
from app.services.api_connect.normalizer import normalize_api_data, sanitize_field_name
from app.services.api_connect.openapi_importer import OpenApiParser, parse_openapi_content
from app.services.api_connect.paginator import ApiPaginator
from app.services.api_connect.sync_engine import execute_sync_for_table

router = APIRouter(prefix="/api-connect", tags=["API Connect"])


def _to_connection_out(conn: ApiConnection) -> ApiConnectionOut:
    """Format connection model into safe output DTO with masked secrets."""
    safe_auth_config: Dict[str, Any] = {}
    if conn.auth_config:
        for k, v in conn.auth_config.items():
            if any(s in k.lower() for s in ("secret", "token", "password")):
                safe_auth_config[k] = "********"
            else:
                safe_auth_config[k] = v

    return ApiConnectionOut(
        id=conn.id,
        owner_id=conn.owner_id,
        name=conn.name,
        base_url=conn.base_url,
        description=conn.description,
        auth_type=conn.auth_type,
        auth_config=safe_auth_config,
        default_headers=conn.default_headers or {},
        timeout_seconds=conn.timeout_seconds,
        max_retries=conn.max_retries,
        verify_ssl=conn.verify_ssl,
        status=conn.status,
        last_tested_at=conn.last_tested_at,
        last_test_result=conn.last_test_result,
        endpoint_count=len(conn.endpoints) if conn.endpoints else 0,
        table_count=len(conn.tables) if conn.tables else 0,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


@router.get("/connections", response_model=List[ApiConnectionOut])
async def list_connections(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """List all configured API connections."""
    stmt = (
        select(ApiConnection)
        .options(
            selectinload(ApiConnection.endpoints),
            selectinload(ApiConnection.tables),
        )
        .where(ApiConnection.deleted_at.is_(None))
        .order_by(ApiConnection.created_at.desc())
    )
    res = await session.execute(stmt)
    connections = res.scalars().all()
    return [_to_connection_out(c) for c in connections]


@router.post("/connections", response_model=ApiConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_connection(
    payload: ApiConnectionCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("database:create")),
):
    """Create a new API connection and optionally encrypt credentials."""
    conn = ApiConnection(
        owner_id=current_user.id,
        name=payload.name,
        base_url=payload.base_url.rstrip("/"),
        description=payload.description,
        auth_type=payload.auth_type,
        auth_config=payload.auth_config,
        default_headers=payload.default_headers,
        timeout_seconds=payload.timeout_seconds,
        max_retries=payload.max_retries,
        verify_ssl=payload.verify_ssl,
    )
    session.add(conn)
    await session.flush()

    if payload.secret:
        encrypted = encrypt_secret(payload.secret)
        cred = ApiCredential(connection_id=conn.id, encrypted_secret=encrypted)
        session.add(cred)

    await session.commit()
    await session.refresh(conn, ["endpoints", "tables", "credentials"])
    return _to_connection_out(conn)


@router.get("/connections/{conn_id}", response_model=ApiConnectionOut)
async def get_connection(
    conn_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Get single API connection details."""
    conn = await session.get(ApiConnection, conn_id)
    if not conn or conn.deleted_at:
        raise NotFoundError(f"Connection {conn_id} not found")
    return _to_connection_out(conn)


@router.put("/connections/{conn_id}", response_model=ApiConnectionOut)
async def update_connection(
    conn_id: uuid.UUID,
    payload: ApiConnectionUpdate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("database:update")),
):
    """Update API connection details."""
    conn = await session.get(ApiConnection, conn_id)
    if not conn or conn.deleted_at:
        raise NotFoundError(f"Connection {conn_id} not found")

    if payload.name is not None:
        conn.name = payload.name
    if payload.base_url is not None:
        conn.base_url = payload.base_url.rstrip("/")
    if payload.description is not None:
        conn.description = payload.description
    if payload.auth_type is not None:
        conn.auth_type = payload.auth_type
    if payload.auth_config is not None:
        conn.auth_config = payload.auth_config
    if payload.default_headers is not None:
        conn.default_headers = payload.default_headers
    if payload.timeout_seconds is not None:
        conn.timeout_seconds = payload.timeout_seconds
    if payload.max_retries is not None:
        conn.max_retries = payload.max_retries
    if payload.verify_ssl is not None:
        conn.verify_ssl = payload.verify_ssl

    if payload.secret is not None:
        await session.execute(
            delete(ApiCredential).where(ApiCredential.connection_id == conn.id)
        )
        if payload.secret:
            encrypted = encrypt_secret(payload.secret)
            cred = ApiCredential(connection_id=conn.id, encrypted_secret=encrypted)
            session.add(cred)

    await session.commit()
    await session.refresh(conn, ["endpoints", "tables", "credentials"])
    return _to_connection_out(conn)


@router.delete("/connections/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    conn_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("database:delete")),
):
    """Delete an API connection."""
    conn = await session.get(ApiConnection, conn_id)
    if not conn or conn.deleted_at:
        raise NotFoundError(f"Connection {conn_id} not found")
    await session.delete(conn)
    await session.commit()


@router.post("/connections/test", response_model=ApiConnectionTestResponse)
async def test_adhoc_connection(
    payload: ApiConnectionTestRequest,
    current_user: User = Depends(get_current_user),
):
    """Test API connection reachability and authentication without saving."""
    client = ApiConnectClient(
        base_url=payload.base_url,
        auth_type=payload.auth_type,
        auth_config=payload.auth_config,
        plain_secret=payload.secret,
        default_headers=payload.headers,
        verify_ssl=payload.verify_ssl,
        timeout_seconds=15,
        max_retries=1,
    )
    resp = await client.execute("", method="GET")
    is_success = resp.success or (200 <= resp.status_code < 400)
    if is_success:
        msg = "Connection successful!" if resp.status_code in (200, 201, 204) else f"Connection successful! (HTTP {resp.status_code})"
    else:
        msg = resp.error_message or f"HTTP {resp.status_code}"

    return ApiConnectionTestResponse(
        success=is_success,
        status_code=resp.status_code,
        message=msg,
        duration_ms=resp.duration_ms,
        details={"content_type": resp.content_type},
    )


@router.post("/connections/{conn_id}/test", response_model=ApiConnectionTestResponse)
async def test_saved_connection(
    conn_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Test saved connection reachability."""
    conn = await session.get(ApiConnection, conn_id)
    if not conn or conn.deleted_at:
        raise NotFoundError(f"Connection {conn_id} not found")

    encrypted = conn.credentials[0].encrypted_secret if conn.credentials else None
    client = ApiConnectClient(
        base_url=conn.base_url,
        auth_type=conn.auth_type,
        auth_config=conn.auth_config,
        encrypted_secret=encrypted,
        default_headers=conn.default_headers,
        timeout_seconds=conn.timeout_seconds,
        max_retries=1,
        verify_ssl=conn.verify_ssl,
    )
    resp = await client.execute("", method="GET")

    is_success = resp.success or (200 <= resp.status_code < 400)
    conn.status = "connected" if is_success else "error"
    conn.last_test_result = {
        "status_code": resp.status_code,
        "duration_ms": resp.duration_ms,
        "success": is_success,
    }
    await session.commit()

    if is_success:
        msg = "Connection OK" if resp.status_code in (200, 201, 204) else f"Connection OK (HTTP {resp.status_code})"
    else:
        msg = resp.error_message or f"HTTP {resp.status_code}"

    return ApiConnectionTestResponse(
        success=is_success,
        status_code=resp.status_code,
        message=msg,
        duration_ms=resp.duration_ms,
        details={"content_type": resp.content_type},
    )


@router.post("/explore", response_model=ApiExploreResponse)
async def explore_endpoint(
    payload: ApiExploreRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Interactive Postman-style request executor with preview and schema detection."""
    base_url = ""
    auth_type = "none"
    auth_config: Dict[str, Any] = {}
    encrypted_secret: Optional[str] = None
    default_headers: Dict[str, str] = {}
    verify_ssl = True

    if payload.connection_id:
        conn = await session.get(ApiConnection, payload.connection_id)
        if conn and not conn.deleted_at:
            base_url = conn.base_url
            auth_type = conn.auth_type
            auth_config = conn.auth_config
            default_headers = conn.default_headers or {}
            verify_ssl = conn.verify_ssl
            if conn.credentials:
                encrypted_secret = conn.credentials[0].encrypted_secret

    client = ApiConnectClient(
        base_url=base_url,
        auth_type=auth_type,
        auth_config=auth_config,
        encrypted_secret=encrypted_secret,
        default_headers=default_headers,
        verify_ssl=verify_ssl,
        timeout_seconds=30,
        max_retries=1,
    )

    resp = await client.execute(
        payload.path_or_url,
        method=payload.method,
        headers=payload.headers,
        query_params=payload.query_params,
        body=payload.body,
    )

    if not resp.success:
        return ApiExploreResponse(
            success=False,
            status_code=resp.status_code,
            duration_ms=resp.duration_ms,
            content_type=resp.content_type,
            error_message=resp.error_message,
            raw_json=resp.data,
            preview_records=[],
            detected_schema={},
            total_records_extracted=0,
        )

    preview_records, detected_schema, _ = normalize_api_data(
        raw_data=resp.data,
        response_path=payload.response_path,
        flatten_nested=True,
        sample_limit=payload.sample_limit,
    )

    return ApiExploreResponse(
        success=True,
        status_code=resp.status_code,
        duration_ms=resp.duration_ms,
        content_type=resp.content_type,
        error_message=None,
        raw_json=resp.data,
        preview_records=preview_records,
        detected_schema=detected_schema,
        total_records_extracted=len(preview_records),
    )


@router.post("/openapi/import", response_model=OpenApiImportResponse)
async def import_openapi_specification(
    payload: OpenApiImportRequest,
    current_user: User = Depends(get_current_user),
):
    """Parse OpenAPI 3.0/3.1 or Swagger 2.0 specification from URL or YAML/JSON string."""
    if payload.url:
        spec_dict = await OpenApiParser.load_from_url(payload.url)
    elif payload.spec_content:
        spec_dict = parse_openapi_content(payload.spec_content)
    else:
        raise ValidationError("Must provide either 'url' or 'spec_content'.")

    parsed = OpenApiParser.parse_specification(spec_dict)
    return OpenApiImportResponse(
        title=parsed["title"],
        description=parsed["description"],
        version=parsed["version"],
        base_url=parsed["base_url"],
        endpoints=parsed["endpoints"],
    )


@router.get("/collections", response_model=List[ApiCollectionOut])
async def list_collections(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """List all Dataset Collections with real endpoint/table counts."""
    stmt = (
        select(ApiDatasetCollection)
        .options(selectinload(ApiDatasetCollection.tables))
        .where(ApiDatasetCollection.deleted_at.is_(None))
        .order_by(ApiDatasetCollection.created_at.desc())
    )
    res = await session.execute(stmt)
    collections = res.scalars().all()

    return [
        ApiCollectionOut(
            id=c.id,
            owner_id=c.owner_id,
            name=c.name,
            description=c.description,
            tags=c.tags or [],
            table_count=len(c.tables) if c.tables else 0,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in collections
    ]


@router.post("/collections", response_model=ApiCollectionOut, status_code=status.HTTP_201_CREATED)
async def create_collection(
    payload: ApiCollectionCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("dataset:create")),
):
    """Create a new dataset collection to group multiple API endpoints."""
    dup_stmt = select(ApiDatasetCollection).where(
        ApiDatasetCollection.name == payload.name,
        ApiDatasetCollection.deleted_at.is_(None),
    )
    dup_res = await session.execute(dup_stmt)
    if dup_res.scalars().first():
        raise ConflictError(f"A collection named '{payload.name}' already exists.")

    col = ApiDatasetCollection(
        owner_id=current_user.id,
        name=payload.name,
        description=payload.description,
        tags=payload.tags,
    )
    session.add(col)
    await session.commit()
    await session.refresh(col, ["tables"])

    return ApiCollectionOut(
        id=col.id,
        owner_id=col.owner_id,
        name=col.name,
        description=col.description,
        tags=col.tags or [],
        table_count=0,
        created_at=col.created_at,
        updated_at=col.updated_at,
    )


@router.get("/collections/{col_id}", response_model=ApiCollectionWithTablesOut)
async def get_collection(
    col_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Get single collection along with all its endpoint tables."""
    col = await session.get(ApiDatasetCollection, col_id)
    if not col or col.deleted_at:
        raise NotFoundError(f"Collection {col_id} not found")

    tables_out: List[ApiTableOut] = []
    if col.tables:
        for t in col.tables:
            # Fetch endpoint metadata for display (path, method)
            ep_path = None
            ep_method = None
            if t.endpoint_id:
                from app.db.models.api_connect import ApiEndpoint as _ApiEP
                ep = await session.get(_ApiEP, t.endpoint_id)
                if ep:
                    ep_path = ep.path
                    ep_method = ep.method

            # Sum parquet snapshot sizes
            parquet_bytes = sum(s.file_size_bytes for s in (t.snapshots or []) if s.file_size_bytes) or None

            tables_out.append(
                ApiTableOut(
                    id=t.id,
                    collection_id=t.collection_id,
                    connection_id=t.connection_id,
                    endpoint_id=t.endpoint_id,
                    semantic_dataset_id=t.semantic_dataset_id,
                    display_name=t.display_name,
                    table_name=t.table_name,
                    storage_mode=t.storage_mode,
                    record_count=t.record_count,
                    column_count=t.column_count,
                    schema_metadata=t.schema_metadata or {},
                    last_synced_at=t.last_synced_at,
                    materialization_status=t.materialization_status,
                    last_error=t.last_error,
                    endpoint_path=ep_path,
                    endpoint_method=ep_method,
                    parquet_size_bytes=parquet_bytes,
                    created_at=t.created_at,
                    updated_at=t.updated_at,
                )
            )

    return ApiCollectionWithTablesOut(
        id=col.id,
        owner_id=col.owner_id,
        name=col.name,
        description=col.description,
        tags=col.tags or [],
        table_count=len(tables_out),
        tables=tables_out,
        created_at=col.created_at,
        updated_at=col.updated_at,
    )


@router.put("/collections/{col_id}", response_model=ApiCollectionOut)
async def update_collection(
    col_id: uuid.UUID,
    payload: ApiCollectionUpdate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("dataset:update")),
):
    """Update dataset collection."""
    col = await session.get(ApiDatasetCollection, col_id)
    if not col or col.deleted_at:
        raise NotFoundError(f"Collection {col_id} not found")

    if payload.name is not None:
        col.name = payload.name
    if payload.description is not None:
        col.description = payload.description
    if payload.tags is not None:
        col.tags = payload.tags

    await session.commit()
    await session.refresh(col, ["tables"])

    return ApiCollectionOut(
        id=col.id,
        owner_id=col.owner_id,
        name=col.name,
        description=col.description,
        tags=col.tags or [],
        table_count=len(col.tables) if col.tables else 0,
        created_at=col.created_at,
        updated_at=col.updated_at,
    )


@router.delete("/collections/{col_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(
    col_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("dataset:delete")),
):
    """Delete a dataset collection and all its tables."""
    col = await session.get(ApiDatasetCollection, col_id)
    if not col or col.deleted_at:
        raise NotFoundError(f"Collection {col_id} not found")
    await session.delete(col)
    await session.commit()


@router.post("/tables", response_model=ApiTableOut, status_code=status.HTTP_201_CREATED)
async def create_table(
    payload: ApiTableCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("dataset:create")),
):
    """Save an API endpoint into a collection as an independent table and optionally materialize."""
    collection = await session.get(ApiDatasetCollection, payload.collection_id)
    if not collection or collection.deleted_at:
        raise NotFoundError(f"Collection {payload.collection_id} not found")

    connection = await session.get(ApiConnection, payload.connection_id)
    if not connection or connection.deleted_at:
        raise NotFoundError(f"Connection {payload.connection_id} not found")

    dup_stmt = select(ApiDatasetTable).where(
        ApiDatasetTable.collection_id == payload.collection_id,
        ApiDatasetTable.table_name == payload.table_name,
        ApiDatasetTable.deleted_at.is_(None),
    )
    dup_res = await session.execute(dup_stmt)
    if dup_res.scalars().first():
        raise ConflictError(
            f"A table named '{payload.table_name}' already exists in collection '{collection.name}'."
        )

    endpoint_id = payload.endpoint_id
    if payload.endpoint_spec:
        ep = ApiEndpoint(
            connection_id=payload.connection_id,
            name=payload.endpoint_spec.name,
            path=payload.endpoint_spec.path,
            method=payload.endpoint_spec.method,
            headers=payload.endpoint_spec.headers,
            query_params=payload.endpoint_spec.query_params,
            body=payload.endpoint_spec.body,
            pagination_config=payload.endpoint_spec.pagination_config,
            response_path=payload.endpoint_spec.response_path,
        )
        session.add(ep)
        await session.flush()
        endpoint_id = ep.id

    table = ApiDatasetTable(
        collection_id=payload.collection_id,
        connection_id=payload.connection_id,
        endpoint_id=endpoint_id,
        display_name=payload.display_name,
        table_name=payload.table_name,
        storage_mode=payload.storage_mode,
        materialization_status="pending",
    )
    session.add(table)
    await session.flush()

    if payload.cron_schedule:
        job = ApiSyncJob(
            table_id=table.id,
            schedule_type="cron",
            cron_expression=payload.cron_schedule,
            is_enabled=True,
        )
        session.add(job)

    await session.commit()
    await session.refresh(table, ["collection", "connection", "endpoint", "snapshots"])

    if payload.auto_materialize:
        await execute_sync_for_table(session, table.id, user=current_user)
        await session.refresh(table)

    dash_id = None
    dash_slug = None
    if table.semantic_dataset_id:
        ds = await session.get(Dataset, table.semantic_dataset_id)
        if ds:
            import re
            table_slug = re.sub(r"[^a-zA-Z0-9]+", "-", (ds.table_name or ds.name).lower()).strip("-")
            d_slug = f"{table_slug}-overview"
            d_res = await session.execute(
                select(Dashboard).where(Dashboard.slug == d_slug, Dashboard.deleted_at.is_(None))
            )
            d_obj = d_res.scalar_one_or_none()
            if d_obj:
                dash_id = d_obj.id
                dash_slug = d_obj.slug

    return ApiTableOut(
        id=table.id,
        collection_id=table.collection_id,
        connection_id=table.connection_id,
        endpoint_id=table.endpoint_id,
        semantic_dataset_id=table.semantic_dataset_id,
        dashboard_id=dash_id,
        dashboard_slug=dash_slug,
        display_name=table.display_name,
        table_name=table.table_name,
        storage_mode=table.storage_mode,
        record_count=table.record_count,
        column_count=table.column_count,
        schema_metadata=table.schema_metadata or {},
        last_synced_at=table.last_synced_at,
        materialization_status=table.materialization_status,
        last_error=table.last_error,
        created_at=table.created_at,
        updated_at=table.updated_at,
    )


@router.delete("/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_table(
    table_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("dataset:delete")),
):
    """Delete an API table, dropping its DuckDB table and semantic dataset."""
    table = await session.get(ApiDatasetTable, table_id)
    if not table or table.deleted_at:
        raise NotFoundError(f"Table {table_id} not found")

    collection = await session.get(ApiDatasetCollection, table.collection_id)
    clean_col = sanitize_field_name(collection.name if collection else "api")
    clean_tbl = sanitize_field_name(table.table_name)
    physical_name = f"api_{clean_col}_{clean_tbl}"

    try:
        with duckdb_write_lock:
            wconn = duckdb.connect(settings.DUCKDB_DATABASE_PATH, read_only=False)
            wconn.execute(f"DROP TABLE IF EXISTS {physical_name}")
            wconn.close()
    except Exception:
        pass

    if table.semantic_dataset_id:
        ds = await session.get(Dataset, table.semantic_dataset_id)
        if ds:
            await session.delete(ds)

    await session.delete(table)
    await session.commit()


@router.post("/tables/{table_id}/refresh")
async def refresh_table_data(
    table_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("dataset:update")),
):
    """Manually trigger ingestion and DuckDB materialization sync for this table."""
    result = await execute_sync_for_table(session, table_id, user=current_user)
    return result


@router.get("/tables/{table_id}/runs", response_model=List[ApiSyncRunOut])
async def list_table_sync_runs(
    table_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Get audit logs of all synchronization runs for this table."""
    stmt = (
        select(ApiSyncRun)
        .where(ApiSyncRun.table_id == table_id)
        .order_by(ApiSyncRun.started_at.desc())
        .limit(50)
    )
    res = await session.execute(stmt)
    return list(res.scalars().all())


@router.post("/tables/{table_id}/visualize")
async def visualize_table_data(
    table_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Ensure complete visualizations (all chart types) + dashboard exist for this table, and return dashboard info."""
    table = await session.get(ApiDatasetTable, table_id)
    if not table or table.deleted_at:
        raise NotFoundError("API Dataset Table not found")

    # If table has no semantic dataset or has not been materialized yet, sync it first
    if not table.semantic_dataset_id or table.materialization_status != "ready":
        await execute_sync_for_table(session, table.id, user=current_user)
        await session.refresh(table)

    if not table.semantic_dataset_id:
        raise ValidationError("Could not materialize table into DuckDB for visualization.")

    dataset = await session.get(Dataset, table.semantic_dataset_id)
    if not dataset:
        raise NotFoundError("Underlying dataset for table not found.")

    cols_stmt = select(DatasetColumn).where(DatasetColumn.dataset_id == dataset.id)
    cols_res = await session.execute(cols_stmt)
    dataset_cols = list(cols_res.scalars().all())

    from app.uploads.dashboard_generator import generate_dashboard_for_dataset
    dashboard = await generate_dashboard_for_dataset(
        session=session,
        dataset=dataset,
        columns=dataset_cols,
        user=current_user,
        filename=table.display_name,
    )
    await session.commit()

    # Find the primary bar chart (or first chart) created for this dashboard
    primary_chart_id = None
    if dashboard:
        ch_stmt = (
            select(Chart)
            .join(DashboardChart, DashboardChart.chart_id == Chart.id)
            .where(DashboardChart.dashboard_id == dashboard.id, Chart.deleted_at.is_(None))
            .order_by(Chart.created_at.desc())
        )
        ch_res = await session.execute(ch_stmt)
        created_charts = list(ch_res.scalars().all())
        for c in created_charts:
            if c.viz_type == "bar":
                primary_chart_id = str(c.id)
                break
        if not primary_chart_id and created_charts:
            primary_chart_id = str(created_charts[0].id)

    return {
        "status": "success",
        "dashboard_id": str(dashboard.id),
        "dashboard_slug": dashboard.slug,
        "dashboard_title": dashboard.title,
        "dataset_id": str(dataset.id),
        "primary_chart_id": primary_chart_id,
        "charts_count": len(dashboard.charts) if dashboard.charts else 0,
    }
