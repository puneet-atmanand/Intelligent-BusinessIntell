"""Pydantic Schemas for AI Assistant."""
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class AIChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    conversation_id: Optional[uuid.UUID] = None
    dataset_id: Optional[uuid.UUID] = None
    database_id: Optional[uuid.UUID] = None
    dashboard_id: Optional[uuid.UUID] = None


class AIChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    result_id: Optional[str] = None
    answer: str
    sql: Optional[str] = None
    columns: List[str] = Field(default_factory=list)
    column_types: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)
    row_count: int = 0
    duration_ms: int = 0
    grounding: Dict[str, Any] = Field(default_factory=dict)
    recommended_chart: Dict[str, Any] = Field(default_factory=dict)
    steps: List[Dict[str, Any]] = Field(default_factory=list)
    latency_ms: int = 0


class CreateAISnapshotRequest(BaseModel):
    message_id: Optional[str] = None
    dataset_id: Optional[str] = None
    dataset_name: Optional[str] = None
    question: str
    sql: Optional[str] = None
    columns: List[str] = Field(default_factory=list)
    column_types: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)
    row_count: int = 0
    duration_ms: int = 0
    recommended_chart: Optional[Dict[str, Any]] = None


class AISnapshotResponse(BaseModel):
    id: str
    source_type: str = "ai_query_result"
    message_id: Optional[str] = None
    dataset_id: Optional[str] = None
    dataset_name: Optional[str] = None
    question: str
    sql: Optional[str] = None
    columns: List[str] = Field(default_factory=list)
    column_types: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)
    row_count: int = 0
    duration_ms: int = 0
    recommended_chart: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class AIVerifyRequest(BaseModel):
    text: str
    rows: List[List[Any]] = Field(default_factory=list)
    columns: Optional[List[str]] = None


class AIStatusResponse(BaseModel):
    enabled: bool
    provider: Optional[str] = None
    model: Optional[str] = None
    has_api_key: bool = False

