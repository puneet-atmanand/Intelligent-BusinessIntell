"""Pydantic schemas for API Connect endpoints."""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ApiConnectionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    base_url: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    auth_type: str = Field(default="none", pattern="^(none|api_key|bearer|basic|oauth2)$")
    auth_config: Dict[str, Any] = Field(default_factory=dict)
    default_headers: Dict[str, str] = Field(default_factory=dict)
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    max_retries: int = Field(default=3, ge=0, le=5)
    verify_ssl: bool = True


class ApiConnectionCreate(ApiConnectionBase):
    secret: Optional[str] = None


class ApiConnectionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    base_url: Optional[str] = Field(default=None, min_length=1, max_length=500)
    description: Optional[str] = None
    auth_type: Optional[str] = Field(default=None, pattern="^(none|api_key|bearer|basic|oauth2)$")
    auth_config: Optional[Dict[str, Any]] = None
    secret: Optional[str] = None
    default_headers: Optional[Dict[str, str]] = None
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=120)
    max_retries: Optional[int] = Field(default=None, ge=0, le=5)
    verify_ssl: Optional[bool] = None


class ApiConnectionOut(ApiConnectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: Optional[uuid.UUID] = None
    status: str
    last_tested_at: Optional[datetime] = None
    last_test_result: Optional[Dict[str, Any]] = None
    endpoint_count: int = 0
    table_count: int = 0
    created_at: datetime
    updated_at: datetime


class ApiConnectionTestRequest(BaseModel):
    base_url: str
    auth_type: str = "none"
    auth_config: Dict[str, Any] = Field(default_factory=dict)
    secret: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)
    verify_ssl: bool = True


class ApiConnectionTestResponse(BaseModel):
    success: bool
    status_code: int
    message: str
    duration_ms: int
    details: Optional[Dict[str, Any]] = None


class ApiExploreRequest(BaseModel):
    connection_id: Optional[uuid.UUID] = None
    path_or_url: str
    method: str = "GET"
    headers: Dict[str, str] = Field(default_factory=dict)
    query_params: Dict[str, Any] = Field(default_factory=dict)
    body: Optional[Any] = None
    pagination_config: Dict[str, Any] = Field(default_factory=dict)
    response_path: Optional[str] = None
    sample_limit: int = Field(default=50, ge=1, le=500)


class ApiExploreResponse(BaseModel):
    success: bool
    status_code: int
    duration_ms: int
    content_type: str
    error_message: Optional[str] = None
    raw_json: Optional[Any] = None
    preview_records: List[Dict[str, Any]] = Field(default_factory=list)
    detected_schema: Dict[str, str] = Field(default_factory=dict)
    total_records_extracted: int = 0


class ApiCollectionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class ApiCollectionCreate(ApiCollectionBase):
    pass


class ApiCollectionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    description: Optional[str] = None
    tags: Optional[List[str]] = None


class ApiCollectionOut(ApiCollectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: Optional[uuid.UUID] = None
    table_count: int = 0
    created_at: datetime
    updated_at: datetime


class ApiEndpointSpec(BaseModel):
    name: str = "Default Endpoint"
    path: str
    method: str = "GET"
    headers: Dict[str, str] = Field(default_factory=dict)
    query_params: Dict[str, Any] = Field(default_factory=dict)
    body: Optional[str] = None
    pagination_config: Dict[str, Any] = Field(default_factory=dict)
    response_path: Optional[str] = None


class ApiTableCreate(BaseModel):
    collection_id: uuid.UUID
    connection_id: uuid.UUID
    display_name: str = Field(..., min_length=1, max_length=150)
    table_name: str = Field(..., min_length=1, max_length=100)
    storage_mode: str = Field(default="materialized", pattern="^(materialized|live)$")
    endpoint_id: Optional[uuid.UUID] = None
    endpoint_spec: Optional[ApiEndpointSpec] = None
    auto_materialize: bool = True
    cron_schedule: Optional[str] = None


class ApiTableUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    table_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    cron_schedule: Optional[str] = None


class ApiTableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    collection_id: uuid.UUID
    connection_id: uuid.UUID
    endpoint_id: Optional[uuid.UUID] = None
    semantic_dataset_id: Optional[uuid.UUID] = None
    dashboard_id: Optional[uuid.UUID] = None
    dashboard_slug: Optional[str] = None
    display_name: str
    table_name: str
    storage_mode: str
    record_count: int
    column_count: int
    schema_metadata: Dict[str, Any] = Field(default_factory=dict)
    last_synced_at: Optional[datetime] = None
    materialization_status: str
    last_error: Optional[str] = None
    # Endpoint metadata for display
    endpoint_path: Optional[str] = None
    endpoint_method: Optional[str] = None
    parquet_size_bytes: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class ApiCollectionWithTablesOut(ApiCollectionOut):
    tables: List[ApiTableOut] = Field(default_factory=list)


class OpenApiImportRequest(BaseModel):
    url: Optional[str] = None
    spec_content: Optional[str] = None


class OpenApiEndpointOut(BaseModel):
    name: str
    path: str
    method: str
    summary: str = ""
    description: str = ""
    operation_id: str = ""
    tags: List[str] = Field(default_factory=list)
    query_params: Dict[str, Any] = Field(default_factory=dict)
    headers: Dict[str, str] = Field(default_factory=dict)


class OpenApiImportResponse(BaseModel):
    title: str
    description: str
    version: str
    base_url: str
    endpoints: List[OpenApiEndpointOut] = Field(default_factory=list)


class ApiSyncRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    table_id: uuid.UUID
    job_id: Optional[uuid.UUID] = None
    status: str
    records_fetched: int
    records_written: int
    execution_duration_ms: int
    error_message: Optional[str] = None
    snapshot_path: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
