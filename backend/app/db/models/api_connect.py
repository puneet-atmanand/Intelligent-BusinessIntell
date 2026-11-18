"""API Connect Entity Models.

Manages external REST API connections, credentials, dataset collections,
endpoints, materialized DuckDB tables, snapshots, and sync runs.
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import BaseModel


class ApiConnection(BaseModel):
    """External REST service or API provider."""
    __tablename__ = "api_connections"

    owner_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    auth_type: Mapped[str] = mapped_column(String(50), default="none", nullable=False)
    auth_config: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    default_headers: Mapped[Dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    verify_ssl: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)
    last_tested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_test_result: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Relationships
    credentials: Mapped[List["ApiCredential"]] = relationship(
        "ApiCredential",
        back_populates="connection",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    endpoints: Mapped[List["ApiEndpoint"]] = relationship(
        "ApiEndpoint",
        back_populates="connection",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    tables: Mapped[List["ApiDatasetTable"]] = relationship(
        "ApiDatasetTable",
        back_populates="connection",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ApiCredential(BaseModel):
    """Encrypted authentication secret storage for an API connection."""
    __tablename__ = "api_credentials"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_connections.id", ondelete="CASCADE"),
        nullable=False,
    )
    encrypted_secret: Mapped[str] = mapped_column(Text, nullable=False)
    key_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    connection: Mapped["ApiConnection"] = relationship(
        "ApiConnection",
        back_populates="credentials",
    )


class ApiDatasetCollection(BaseModel):
    """Logical grouping of related API endpoint tables into an analytical domain."""
    __tablename__ = "api_dataset_collections"

    owner_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)

    tables: Mapped[List["ApiDatasetTable"]] = relationship(
        "ApiDatasetTable",
        back_populates="collection",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ApiEndpoint(BaseModel):
    """Saved API endpoint specification belonging to a connection."""
    __tablename__ = "api_endpoints"

    connection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_connections.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    method: Mapped[str] = mapped_column(String(10), default="GET", nullable=False)
    headers: Mapped[Dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    query_params: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    body: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    pagination_config: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    response_path: Mapped[Optional[str]] = mapped_column(String(255), default="", nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    connection: Mapped["ApiConnection"] = relationship(
        "ApiConnection",
        back_populates="endpoints",
    )
    tables: Mapped[List["ApiDatasetTable"]] = relationship(
        "ApiDatasetTable",
        back_populates="endpoint",
        lazy="selectin",
    )


class ApiDatasetTable(BaseModel):
    """Materialized endpoint table in DuckDB belonging to a collection."""
    __tablename__ = "api_dataset_tables"

    collection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_dataset_collections.id", ondelete="CASCADE"),
        nullable=False,
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_connections.id", ondelete="CASCADE"),
        nullable=False,
    )
    endpoint_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_endpoints.id", ondelete="SET NULL"),
        nullable=True,
    )
    semantic_dataset_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("datasets.id", ondelete="SET NULL"),
        nullable=True,
    )
    display_name: Mapped[str] = mapped_column(String(150), nullable=False)
    table_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    storage_mode: Mapped[str] = mapped_column(String(20), default="materialized", nullable=False)
    schema_metadata: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    materialization_status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    collection: Mapped["ApiDatasetCollection"] = relationship(
        "ApiDatasetCollection",
        back_populates="tables",
    )
    connection: Mapped["ApiConnection"] = relationship(
        "ApiConnection",
        back_populates="tables",
    )
    endpoint: Mapped[Optional["ApiEndpoint"]] = relationship(
        "ApiEndpoint",
        back_populates="tables",
    )
    sync_jobs: Mapped[List["ApiSyncJob"]] = relationship(
        "ApiSyncJob",
        back_populates="table",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    sync_runs: Mapped[List["ApiSyncRun"]] = relationship(
        "ApiSyncRun",
        back_populates="table",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    snapshots: Mapped[List["ApiSnapshot"]] = relationship(
        "ApiSnapshot",
        back_populates="table",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ApiSyncJob(BaseModel):
    """Scheduled sync job configuration for an API table."""
    __tablename__ = "api_sync_jobs"

    table_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_dataset_tables.id", ondelete="CASCADE"),
        nullable=False,
    )
    schedule_type: Mapped[str] = mapped_column(String(50), default="manual", nullable=False)
    cron_expression: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    table: Mapped["ApiDatasetTable"] = relationship(
        "ApiDatasetTable",
        back_populates="sync_jobs",
    )
    runs: Mapped[List["ApiSyncRun"]] = relationship(
        "ApiSyncRun",
        back_populates="job",
        lazy="selectin",
    )


class ApiSyncRun(BaseModel):
    """Historical audit run log for an API table sync execution."""
    __tablename__ = "api_sync_runs"

    table_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_dataset_tables.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_sync_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(50), default="PENDING", nullable=False)
    records_fetched: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    records_written: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    execution_duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    snapshot_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    table: Mapped["ApiDatasetTable"] = relationship(
        "ApiDatasetTable",
        back_populates="sync_runs",
    )
    job: Mapped[Optional["ApiSyncJob"]] = relationship(
        "ApiSyncJob",
        back_populates="runs",
    )


class ApiSnapshot(BaseModel):
    """Immutable, versioned Parquet data snapshot on disk."""
    __tablename__ = "api_snapshots"

    table_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("api_dataset_tables.id", ondelete="CASCADE"),
        nullable=False,
    )
    snapshot_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    parquet_path: Mapped[str] = mapped_column(String(500), nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    table: Mapped["ApiDatasetTable"] = relationship(
        "ApiDatasetTable",
        back_populates="snapshots",
    )
