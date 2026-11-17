"""Database Connection Schemas."""
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DatabaseConnectionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)
    dialect: str = Field(..., max_length=50)

    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    username: Optional[str] = None

    ssl_mode: str = "prefer"
    allow_dml: bool = False
    allow_file_uploads: bool = False
    allow_sqllab: bool = True
    row_limit: int = 10000
    statement_timeout_seconds: int = 30
    cache_timeout_seconds: int = 300

    ai_allowed_schemas: List[str] = []
    ai_allowed_tables: List[str] = []
    extra_params: Dict[str, Any] = {}


class DatabaseConnectionCreate(DatabaseConnectionBase):
    password: Optional[str] = None
    raw_uri: Optional[str] = None


class DatabaseConnectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    raw_uri: Optional[str] = None

    ssl_mode: Optional[str] = None
    allow_dml: Optional[bool] = None
    allow_file_uploads: Optional[bool] = None
    allow_sqllab: Optional[bool] = None
    row_limit: Optional[int] = None
    statement_timeout_seconds: Optional[int] = None
    cache_timeout_seconds: Optional[int] = None

    ai_allowed_schemas: Optional[List[str]] = None
    ai_allowed_tables: Optional[List[str]] = None


class DatabaseConnectionOut(DatabaseConnectionBase):
    id: uuid.UUID
    is_system: bool
    has_encrypted_password: bool = False

    model_config = {"from_attributes": True}


class ConnectionTestRequest(BaseModel):
    dialect: str
    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    raw_uri: Optional[str] = None


class ConnectionTestResponse(BaseModel):
    success: bool
    message: str


class TableInventoryItem(BaseModel):
    name: str
    type: str = "table"
    row_count_estimate: Optional[int] = None


class SchemaInventoryItem(BaseModel):
    name: str
    tables: List[TableInventoryItem] = []


class DatabaseInventoryResponse(BaseModel):
    database_id: Optional[uuid.UUID] = None
    database_name: Optional[str] = None
    schemas: List[SchemaInventoryItem] = []


class AutoVisualizeTableItem(BaseModel):
    schema_name: Optional[str] = None
    table_name: str


class AutoVisualizeRequest(BaseModel):
    schemas: Optional[List[str]] = None
    tables: Optional[List[AutoVisualizeTableItem]] = None
    per_table_dashboards: bool = True
    unified_dashboard: bool = True


class PerTableDashboardSummary(BaseModel):
    schema_name: Optional[str] = Field(None, alias="schema")
    table_name: str = Field(..., alias="table")
    dashboard_slug: Optional[str] = None
    title: Optional[str] = None
    status: str = "created"
    dataset_id: Optional[str] = None
    error: Optional[str] = None

    model_config = {"populate_by_name": True}


class AutoVisualizeResponse(BaseModel):
    database_id: uuid.UUID
    database_name: str
    per_table_dashboards_created: int = 0
    per_table_dashboards: List[PerTableDashboardSummary] = []
    unified_dashboard_slug: Optional[str] = None
    unified_dashboard_title: Optional[str] = None
    sections_count: int = 0
    charts_count: int = 0
    columns_visualized: Dict[str, List[str]] = {}
    columns_trimmed: Dict[str, List[str]] = {}
    summary: str = ""


# --- Table Join Assistant Schemas ---

class ForeignKeyInfo(BaseModel):
    constraint_name: str
    columns: List[str]
    referred_schema: str
    referred_table: str
    referred_columns: List[str]


class TableColumnInfo(BaseModel):
    name: str
    data_type: str


class TableKeyInfo(BaseModel):
    schema_name: str = Field(..., alias="schema")
    table_name: str = Field(..., alias="table")
    primary_key: List[str] = []
    foreign_keys: List[ForeignKeyInfo] = []
    columns: List[TableColumnInfo] = []

    model_config = {"populate_by_name": True}


class DatabaseKeysResponse(BaseModel):
    database_id: Optional[uuid.UUID] = None
    tables: List[TableKeyInfo] = []


class JoinSuggestion(BaseModel):
    left_columns: List[str]
    right_columns: List[str]
    source: str  # "foreign_key" | "name_match"
    confidence: float
    description: Optional[str] = None


class JoinSuggestionsResponse(BaseModel):
    suggestions: List[JoinSuggestion] = []


class JoinCondition(BaseModel):
    left_col: str
    right_col: str


class JoinColumnSelect(BaseModel):
    table: str = "t1"  # "t1" | "t2"
    column: str
    alias: Optional[str] = None


class JoinBuildSqlRequest(BaseModel):
    left: str
    right: str
    join_type: str = "INNER"
    conditions: Optional[List[JoinCondition]] = None
    columns: Optional[List[JoinColumnSelect]] = None
    select_all: bool = False
    where: Optional[str] = None
    limit: Optional[int] = 100
    offset: Optional[int] = 0
    include_limit: bool = True


class JoinBuildSqlResponse(BaseModel):
    sql: str
    dialect: str
    is_emulated: bool = False
    notes: Optional[str] = None


class JoinRunRequest(BaseModel):
    left: str
    right: str
    join_type: str = "INNER"
    conditions: Optional[List[JoinCondition]] = None
    columns: Optional[List[JoinColumnSelect]] = None
    select_all: bool = False
    where: Optional[str] = None
    limit: int = 100
    offset: int = 0
    custom_sql: Optional[str] = None


class JoinRunResponse(BaseModel):
    columns: List[str] = []
    column_types: Any = []
    rows: List[List[Any]] = []
    row_count: int = 0
    limit: int = 100
    offset: int = 0
    is_truncated: bool = False
    execution_duration_ms: float = 0.0
    sql: str


class ParentRowInfo(BaseModel):
    constraint_name: str
    parent_table: str
    fk_columns: List[str]
    referred_columns: List[str]
    row: Optional[Dict[str, Any]] = None


class ChildRowsInfo(BaseModel):
    child_table: str
    fk_columns: List[str]
    referred_columns: List[str]
    count: int = 0
    columns: List[str] = []
    rows: List[List[Any]] = []


class RowsByKeyResponse(BaseModel):
    table: str
    key_columns: List[str]
    key_values: List[Any]
    row: Optional[Dict[str, Any]] = None
    columns: List[str] = []
    parents: List[ParentRowInfo] = []
    children: List[ChildRowsInfo] = []


