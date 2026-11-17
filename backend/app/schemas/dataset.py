"""Dataset Schemas."""
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DatasetColumnBase(BaseModel):
    name: str
    verbose_name: Optional[str] = None
    data_type: str
    description: Optional[str] = None
    is_datetime: bool = False
    is_dimension: bool = True
    is_filterable: bool = True
    is_groupable: bool = True
    is_hidden_from_ai: bool = False


class DatasetColumnOut(DatasetColumnBase):
    id: uuid.UUID
    dataset_id: uuid.UUID

    model_config = {"from_attributes": True}


class DatasetMetricBase(BaseModel):
    name: str
    verbose_name: Optional[str] = None
    sql_expression: str
    metric_type: str = "aggregate"
    number_format: Optional[str] = None
    description: Optional[str] = None


class DatasetMetricOut(DatasetMetricBase):
    id: uuid.UUID
    dataset_id: uuid.UUID

    model_config = {"from_attributes": True}


class RLSRuleBase(BaseModel):
    role_id: uuid.UUID
    clause: str
    description: Optional[str] = None
    is_active: bool = True


class RLSRuleOut(RLSRuleBase):
    id: uuid.UUID
    dataset_id: uuid.UUID

    model_config = {"from_attributes": True}


class DatasetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = None
    database_id: uuid.UUID
    schema_name: Optional[str] = None
    table_name: Optional[str] = None
    is_virtual: bool = False
    sql_expression: Optional[str] = None


class DatasetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    schema_name: Optional[str] = None
    table_name: Optional[str] = None
    sql_expression: Optional[str] = None


class DatasetOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    database_id: uuid.UUID
    database_name: Optional[str] = None
    schema_name: Optional[str] = None
    table_name: Optional[str] = None
    is_virtual: bool
    sql_expression: Optional[str] = None
    columns: List[DatasetColumnOut] = []
    metrics: List[DatasetMetricOut] = []
    rls_rules: List[RLSRuleOut] = []

    model_config = {"from_attributes": True}


class BulkDatasetItem(BaseModel):
    schema_name: Optional[str] = None
    table_name: str


class BulkDatasetCreateRequest(BaseModel):
    database_id: uuid.UUID
    items: List[BulkDatasetItem]
    create_dashboards: bool = True


class BulkDatasetItemResult(BaseModel):
    model_config = {"populate_by_name": True}
    schema_: Optional[str] = Field(None, alias="schema")
    table: str
    schema_name: Optional[str] = None
    table_name: Optional[str] = None
    status: str  # "created" | "skipped_existing" | "failed"
    dataset_id: Optional[str] = None
    dashboard_slug: Optional[str] = None
    error: Optional[str] = None

    def __init__(self, **data):
        if "schema" in data and "schema_" not in data:
            data["schema_"] = data["schema"]
        elif "schema_name" in data and "schema_" not in data:
            data["schema_"] = data["schema_name"]
        if "table" in data and "table_name" not in data:
            data["table_name"] = data["table"]
        elif "table_name" in data and "table" not in data:
            data["table"] = data["table_name"]
        super().__init__(**data)


class BulkDatasetCreateResponse(BaseModel):
    total_requested: int
    created_count: int
    skipped_count: int
    failed_count: int
    results: List[BulkDatasetItemResult]


class DatasetFromJoinRequest(BaseModel):
    database_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=150)
    sql: str
    description: Optional[str] = None
    left_table: Optional[str] = None
    right_table: Optional[str] = None
    join_type: Optional[str] = None
    create_dashboard: bool = True


class DatasetFromJoinResponse(BaseModel):
    dataset_id: uuid.UUID
    name: str
    sql_expression: str
    columns_count: int
    dashboard_slug: Optional[str] = None
    dashboard_id: Optional[uuid.UUID] = None
    message: str = "Dataset created successfully from join query."

