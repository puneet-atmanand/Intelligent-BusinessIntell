"""Database Connections API Endpoints."""
import logging
import uuid
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_db_session, require_permission
from app.connectors.duckdb_connector import DuckDBConnector
from app.connectors.factory import get_connector
from app.connectors.sql_connector import SQLAlchemyConnector
from app.core.errors import AppException, ConflictError, NotFoundError, PermissionDeniedError
from app.core.security import encrypt_secret

logger = logging.getLogger(__name__)
from app.db.models import DatabaseConnection, User
from app.schemas.database import (
    AutoVisualizeRequest,
    AutoVisualizeResponse,
    ConnectionTestRequest,
    ConnectionTestResponse,
    DatabaseConnectionCreate,
    DatabaseConnectionOut,
    DatabaseConnectionUpdate,
    DatabaseInventoryResponse,
    DatabaseKeysResponse,
    JoinBuildSqlRequest,
    JoinBuildSqlResponse,
    JoinRunRequest,
    JoinRunResponse,
    JoinSuggestionsResponse,
    RowsByKeyResponse,
)
from app.services.cascade_delete_service import delete_database_cascade
from app.services.database_dashboard_builder import build_unified_database_dashboard
from app.services.table_join_service import (
    build_join_sql,
    execute_join_query,
    get_database_keys,
    get_join_suggestions,
    get_rows_by_key,
)

router = APIRouter(prefix="/databases", tags=["Databases"])


def _mask_connection(conn: DatabaseConnection) -> DatabaseConnectionOut:
    """Mask credentials and return safe DTO."""
    return DatabaseConnectionOut(
        id=conn.id,
        name=conn.name,
        description=conn.description,
        dialect=conn.dialect,
        host=conn.host,
        port=conn.port,
        database_name=conn.database_name,
        username=conn.username,
        ssl_mode=conn.ssl_mode,
        allow_dml=conn.allow_dml,
        allow_file_uploads=conn.allow_file_uploads,
        allow_sqllab=conn.allow_sqllab,
        row_limit=conn.row_limit,
        statement_timeout_seconds=conn.statement_timeout_seconds,
        cache_timeout_seconds=conn.cache_timeout_seconds,
        is_system=conn.is_system,
        ai_allowed_schemas=conn.ai_allowed_schemas or [],
        ai_allowed_tables=conn.ai_allowed_tables or [],
        extra_params=conn.extra_params or {},
        has_encrypted_password=bool(conn.password_encrypted or conn.sqlalchemy_uri_encrypted),
    )


@router.get("/", response_model=List[DatabaseConnectionOut])
async def list_databases(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """List all registered database connections."""
    stmt = (
        select(DatabaseConnection)
        .where(DatabaseConnection.deleted_at.is_(None))
        .order_by(DatabaseConnection.is_system.desc(), DatabaseConnection.name.asc())
    )
    result = await session.execute(stmt)
    conns = result.scalars().all()
    return [_mask_connection(c) for c in conns]


@router.post("/", response_model=DatabaseConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_database(
    payload: DatabaseConnectionCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:write")),
) -> Any:
    """Create a new encrypted database connection."""
    existing = await session.execute(
        select(DatabaseConnection).where(
            DatabaseConnection.name == payload.name,
            DatabaseConnection.deleted_at.is_(None),
        )
    )
    if existing.scalar_one_or_none():
        raise ConflictError(f"Database connection with name '{payload.name}' already exists.")

    encrypted_pw = encrypt_secret(payload.password) if payload.password else None
    encrypted_uri = encrypt_secret(payload.raw_uri) if payload.raw_uri else None

    db_conn = DatabaseConnection(
        name=payload.name,
        description=payload.description,
        dialect=payload.dialect.lower(),
        host=payload.host,
        port=payload.port,
        database_name=payload.database_name,
        username=payload.username,
        password_encrypted=encrypted_pw,
        sqlalchemy_uri_encrypted=encrypted_uri,
        ssl_mode=payload.ssl_mode,
        allow_dml=payload.allow_dml,
        allow_file_uploads=payload.allow_file_uploads,
        allow_sqllab=payload.allow_sqllab,
        row_limit=payload.row_limit,
        statement_timeout_seconds=payload.statement_timeout_seconds,
        cache_timeout_seconds=payload.cache_timeout_seconds,
        ai_allowed_schemas=payload.ai_allowed_schemas,
        ai_allowed_tables=payload.ai_allowed_tables,
        extra_params=payload.extra_params,
        created_by_id=current_user.id,
    )
    session.add(db_conn)
    await session.commit()
    await session.refresh(db_conn)
    return _mask_connection(db_conn)


@router.post("/test", response_model=ConnectionTestResponse)
async def test_database_connection(
    payload: ConnectionTestRequest,
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Test connection credentials without saving."""
    dialect = payload.dialect.lower()
    if dialect == "duckdb":
        connector = DuckDBConnector()
        success, msg = connector.test_connection()
        return ConnectionTestResponse(success=success, message=msg)

    # Build transient URI
    if payload.raw_uri:
        uri = payload.raw_uri
    else:
        user = payload.username or ""
        password = payload.password or ""
        auth = f"{user}:{password}@" if user or password else ""
        host = payload.host or "localhost"
        port = f":{payload.port}" if payload.port else ""
        db = payload.database_name or ""

        if dialect in ("postgres", "postgresql"):
            uri = f"postgresql://{auth}{host}{port}/{db}"
        elif dialect == "mysql":
            uri = f"mysql+pymysql://{auth}{host}{port}/{db}"
        elif dialect == "sqlite":
            uri = f"sqlite:///{db or ':memory:'}"
        elif dialect == "clickhouse":
            uri = f"clickhouse+connect://{auth}{host}{port}/{db}"
        elif dialect == "mssql":
            uri = f"mssql+pyodbc://{auth}{host}{port}/{db}?driver=ODBC+Driver+17+for+SQL+Server"
        else:
            uri = f"{dialect}://{auth}{host}{port}/{db}"

    try:
        sql_connector = SQLAlchemyConnector(uri=uri, statement_timeout_seconds=10)
        success, msg = sql_connector.test_connection()
        return ConnectionTestResponse(success=success, message=msg)
    except Exception as e:
        return ConnectionTestResponse(success=False, message=str(e))


@router.post("/{id}/test", response_model=ConnectionTestResponse)
async def test_saved_database_connection(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Test saved database connection by ID."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    try:
        connector = get_connector(conn)
        success, msg = connector.test_connection()
        return ConnectionTestResponse(success=success, message=msg)
    except Exception as e:
        return ConnectionTestResponse(success=False, message=str(e))


@router.get("/{id}", response_model=DatabaseConnectionOut)
async def get_database(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Get connection metadata by ID."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")
    return _mask_connection(conn)


@router.put("/{id}", response_model=DatabaseConnectionOut)
async def update_database(
    id: uuid.UUID,
    payload: DatabaseConnectionUpdate,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:write")),
) -> Any:
    """Update database connection metadata and credentials."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")
    if conn.is_system:
        raise PermissionDeniedError("System connections cannot be modified.")

    update_data = payload.model_dump(exclude_unset=True)
    if "password" in update_data:
        pw = update_data.pop("password")
        if pw:
            conn.password_encrypted = encrypt_secret(pw)
    if "raw_uri" in update_data:
        uri = update_data.pop("raw_uri")
        if uri:
            conn.sqlalchemy_uri_encrypted = encrypt_secret(uri)

    for field, val in update_data.items():
        setattr(conn, field, val)

    await session.commit()
    await session.refresh(conn)
    return _mask_connection(conn)


@router.delete("/{id}", status_code=status.HTTP_200_OK)
async def delete_database(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:write")),
) -> dict:
    """Delete a database connection and cascade to all its datasets, charts & dashboards."""
    res = await delete_database_cascade(session=session, database_id=id)
    return {
        "message": "Database connection deleted successfully.",
        "deleted_datasets_count": res.get("deleted_datasets_count", 0),
        "deleted_charts_count": res.get("deleted_charts_count", 0),
        "deleted_dashboards_count": res.get("deleted_dashboards_count", 0),
    }


@router.get("/{id}/schemas")
async def get_database_schemas(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> List[str]:
    """List schemas in the database."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    return connector.get_schemas()


@router.get("/{id}/tables")
@router.get("/{id}/schemas/{schema}/tables")
async def get_database_tables(
    id: uuid.UUID,
    schema: Optional[str] = None,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> List[str]:
    """List tables and views in a schema."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    return connector.get_tables(schema_name=schema)


@router.get("/{id}/tables/{table}/columns")
@router.get("/{id}/schemas/{schema}/tables/{table}/columns")
async def get_database_columns(
    id: uuid.UUID,
    table: str,
    schema: Optional[str] = None,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> List[dict]:
    """Inspect columns and data types for a table."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    columns = connector.get_columns(table_name=table, schema_name=schema)
    return [c.to_dict() for c in columns]


@router.post("/{id}/inventory", response_model=DatabaseInventoryResponse)
@router.get("/{id}/inventory", response_model=DatabaseInventoryResponse)
async def get_database_inventory(
    id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Return all schemas with their tables, views, and estimated row counts in one call."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    inventory = connector.get_inventory()
    return DatabaseInventoryResponse(
        database_id=conn.id,
        database_name=conn.name,
        schemas=inventory,
    )


@router.post("/{id}/auto-visualize", response_model=AutoVisualizeResponse)
async def auto_visualize_database(
    id: uuid.UUID,
    payload: AutoVisualizeRequest = AutoVisualizeRequest(),
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:write")),
) -> Any:
    """Auto-visualize entire database producing per-table dashboards and/or unified dashboard."""
    raw_tables = None
    if payload.tables:
        raw_tables = [{"schema_name": t.schema_name, "table_name": t.table_name} for t in payload.tables]

    res = await build_unified_database_dashboard(
        session=session,
        database_id=id,
        user=current_user,
        schemas=payload.schemas,
        tables=raw_tables,
        per_table_dashboards=payload.per_table_dashboards,
        unified_dashboard=payload.unified_dashboard,
    )
    return AutoVisualizeResponse(**res)


# --- Table Join Assistant Endpoints ---

@router.get("/{id}/keys", response_model=DatabaseKeysResponse)
async def get_connection_keys(
    id: uuid.UUID,
    refresh: bool = Query(False, description="Force refresh cache"),
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Return primary keys and foreign keys for all schema.tables in the connected database."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    keys_data = get_database_keys(connector=connector, connection_id=conn.id, force_refresh=refresh)
    return DatabaseKeysResponse(
        database_id=conn.id,
        tables=keys_data.get("tables", []),
    )


@router.get("/{id}/join-suggestions", response_model=JoinSuggestionsResponse)
async def get_table_join_suggestions(
    id: uuid.UUID,
    left: str = Query(..., description="Left table identifier (schema.table or table)"),
    right: str = Query(..., description="Right table identifier (schema.table or table)"),
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Return ranked join key suggestions between two tables (FKs, PK match, name match)."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    suggestions = get_join_suggestions(connector=connector, connection_id=conn.id, left=left, right=right)
    return JoinSuggestionsResponse(suggestions=suggestions)


@router.post("/{id}/join-builder/sql", response_model=JoinBuildSqlResponse)
async def generate_table_join_sql(
    id: uuid.UUID,
    payload: JoinBuildSqlRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Build, quote, and AST-validate SQL text for joining two tables."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    conds = [c.model_dump() for c in payload.conditions] if payload.conditions else None
    cols = [c.model_dump() for c in payload.columns] if payload.columns else None

    res = build_join_sql(
        connector=connector,
        connection_id=conn.id,
        left=payload.left,
        right=payload.right,
        join_type=payload.join_type,
        conditions=conds,
        columns=cols,
        select_all=payload.select_all,
        where=payload.where,
        limit=payload.limit or 100,
        offset=payload.offset or 0,
        dialect=conn.dialect or "postgresql",
        include_limit=payload.include_limit,
    )
    return JoinBuildSqlResponse(**res)


@router.post("/{id}/join-builder/run", response_model=JoinRunResponse)
async def run_table_join_query(
    id: uuid.UUID,
    payload: JoinRunRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Execute join query safely through connector with read-only guardrails and pagination."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    conds = [c.model_dump() for c in payload.conditions] if payload.conditions else None
    cols = [c.model_dump() for c in payload.columns] if payload.columns else None

    res = execute_join_query(
        connector=connector,
        connection_id=conn.id,
        left=payload.left,
        right=payload.right,
        join_type=payload.join_type,
        conditions=conds,
        columns=cols,
        select_all=payload.select_all,
        where=payload.where,
        limit=payload.limit or 100,
        offset=payload.offset or 0,
        custom_sql=payload.custom_sql,
        dialect=conn.dialect or "postgresql",
    )
    return JoinRunResponse(**res)


@router.get("/{id}/rows-by-key", response_model=RowsByKeyResponse)
async def get_database_rows_by_key(
    id: uuid.UUID,
    table: str = Query(..., description="Target table (schema.table)"),
    key_col: str = Query(..., description="Key column name (or comma-separated composite)"),
    key_value: str = Query(..., description="Key value (or comma-separated composite)"),
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("databases:read")),
) -> Any:
    """Return single row for a key, its parent rows via FKs, and child records in referencing tables."""
    stmt = select(DatabaseConnection).where(
        DatabaseConnection.id == id,
        DatabaseConnection.deleted_at.is_(None),
    )
    result = await session.execute(stmt)
    conn = result.scalar_one_or_none()
    if not conn:
        raise NotFoundError("Database connection not found.")

    connector = get_connector(conn)
    try:
        res = get_rows_by_key(
            connector=connector,
            connection_id=conn.id,
            table=table,
            key_col=key_col,
            key_value=key_value,
        )
        return RowsByKeyResponse(**res)
    except Exception as e:
        logger.error(
            f"Error in rows-by-key for database {id}, table={table}, key={key_col}={key_value}: {e}",
            exc_info=True,
        )
        if isinstance(e, AppException):
            raise
        raise AppException(f"Failed to lookup row by key: {str(e)}")

