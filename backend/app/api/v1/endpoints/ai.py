"""AI Assistant API Endpoints (ADR-004 & Phase 4)."""
import os
from typing import Any, Dict, List
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.guardrails.grounding import GroundingGuardrail
from app.ai.orchestrator import AIOrchestrator
from app.api.v1.deps import get_db_session, require_permission
from app.core.config import settings
from app.db.models import AIConversation, AIMessage, Dashboard, Dataset, User, AIResultSnapshot
from app.schemas.ai import (
    AIChatRequest,
    AIChatResponse,
    AIStatusResponse,
    AIVerifyRequest,
    CreateAISnapshotRequest,
    AISnapshotResponse,
)

router = APIRouter(prefix="/ai", tags=["AI Assistant"])


@router.get("/status", response_model=AIStatusResponse)
async def get_ai_status(
    current_user: User = Depends(require_permission("ai:use")),
) -> Any:
    """Return whether the AI Assistant is enabled and configured."""
    has_key = bool(
        os.getenv("GROQ_API_KEY")
        or settings.GROQ_API_KEY
        or os.getenv("GEMINI_API_KEY")
        or settings.GEMINI_API_KEY
        or os.getenv("OPENAI_API_KEY")
        or settings.OPENAI_API_KEY
        or os.getenv("ANTHROPIC_API_KEY")
        or settings.ANTHROPIC_API_KEY
    )
    return AIStatusResponse(
        enabled=settings.AI_ENABLED,
        provider=os.getenv("LLM_PROVIDER") or settings.LLM_PROVIDER,
        model=os.getenv("LLM_MODEL") or settings.LLM_MODEL,
        has_api_key=has_key,
    )


@router.post("/chat", response_model=AIChatResponse)
async def chat_with_ai(
    payload: AIChatRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("ai:use")),
) -> Any:
    """Execute grounded natural language question against connected business data."""
    if not settings.AI_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="AI Assistant is disabled. Enable AI_ENABLED=true in settings.",
        )

    # 1. Validate dataset_id exists and is active when provided
    if payload.dataset_id:
        ds_stmt = select(Dataset).where(
            Dataset.id == payload.dataset_id,
            Dataset.deleted_at.is_(None),
        )
        ds_res = await session.execute(ds_stmt)
        dataset = ds_res.scalar_one_or_none()
        if not dataset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dataset '{payload.dataset_id}' not found or is inaccessible.",
            )
        # All authenticated users with ai:use permission can query any dataset via AI.
        # Ownership restriction only applies to write/delete operations, not reads/AI queries.

    # 2. Validate dashboard_id exists and is active when provided
    if payload.dashboard_id:
        dash_stmt = select(Dashboard).where(
            Dashboard.id == payload.dashboard_id,
            Dashboard.deleted_at.is_(None),
        )
        dash_res = await session.execute(dash_stmt)
        dashboard = dash_res.scalar_one_or_none()
        if not dashboard:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Dashboard '{payload.dashboard_id}' not found or is inaccessible.",
            )

    orchestrator = AIOrchestrator()
    result = await orchestrator.run(
        session=session,
        user=current_user,
        prompt=payload.prompt,
        conversation_id=payload.conversation_id,
        dataset_id=payload.dataset_id,
        database_id=payload.database_id,
        dashboard_id=payload.dashboard_id,
    )

    # Automatically create an AI query result snapshot for Explore as Chart if data was returned
    if result.get("rows"):
        try:
            ds_name = dataset.name if (payload.dataset_id and "dataset" in locals() and dataset) else None
            if not ds_name and payload.dataset_id:
                ds_lookup = await session.execute(
                    select(Dataset.name).where(Dataset.id == payload.dataset_id)
                )
                ds_name = ds_lookup.scalar_one_or_none()

            msg_uuid = None
            if result.get("message_id"):
                try:
                    msg_uuid = uuid.UUID(str(result["message_id"]))
                except Exception:
                    pass

            snapshot = AIResultSnapshot(
                user_id=current_user.id,
                message_id=msg_uuid,
                dataset_id=payload.dataset_id,
                dataset_name=ds_name,
                question=payload.prompt,
                sql=result.get("sql"),
                columns=result.get("columns", []),
                column_types=result.get("column_types", []),
                rows=result.get("rows", []),
                row_count=result.get("row_count", 0),
                duration_ms=result.get("duration_ms", 0),
                recommended_chart=result.get("recommended_chart") or {},
            )
            session.add(snapshot)
            await session.commit()
            result["result_id"] = str(snapshot.id)
        except Exception as snap_err:
            # Non-blocking snapshot fallback
            pass

    return AIChatResponse(**result)


@router.post("/snapshots", response_model=AISnapshotResponse)
async def create_ai_snapshot(
    payload: CreateAISnapshotRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("ai:use")),
) -> Any:
    """Explicitly persist an AI query result snapshot."""
    msg_uuid = None
    if payload.message_id:
        try:
            msg_uuid = uuid.UUID(str(payload.message_id))
        except Exception:
            pass

    ds_uuid = None
    if payload.dataset_id:
        try:
            ds_uuid = uuid.UUID(str(payload.dataset_id))
        except Exception:
            pass

    snapshot = AIResultSnapshot(
        user_id=current_user.id,
        message_id=msg_uuid,
        dataset_id=ds_uuid,
        dataset_name=payload.dataset_name,
        question=payload.question,
        sql=payload.sql,
        columns=payload.columns,
        column_types=payload.column_types,
        rows=payload.rows,
        row_count=payload.row_count or len(payload.rows),
        duration_ms=payload.duration_ms,
        recommended_chart=payload.recommended_chart or {},
    )
    session.add(snapshot)
    await session.commit()
    await session.refresh(snapshot)

    return AISnapshotResponse(
        id=str(snapshot.id),
        source_type="ai_query_result",
        message_id=str(snapshot.message_id) if snapshot.message_id else None,
        dataset_id=str(snapshot.dataset_id) if snapshot.dataset_id else None,
        dataset_name=snapshot.dataset_name,
        question=snapshot.question,
        sql=snapshot.sql,
        columns=snapshot.columns,
        column_types=snapshot.column_types or [],
        rows=snapshot.rows,
        row_count=snapshot.row_count,
        duration_ms=snapshot.duration_ms,
        recommended_chart=snapshot.recommended_chart or {},
        created_at=snapshot.created_at.isoformat() if snapshot.created_at else None,
    )


@router.get("/snapshots/{snapshot_id}", response_model=AISnapshotResponse)
async def get_ai_snapshot(
    snapshot_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("ai:use")),
) -> Any:
    """Retrieve an existing AI query result snapshot with strict ownership validation."""
    stmt = select(AIResultSnapshot).where(
        AIResultSnapshot.id == snapshot_id,
        AIResultSnapshot.deleted_at.is_(None),
    )
    res = await session.execute(stmt)
    snapshot = res.scalar_one_or_none()

    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="AI query result snapshot not found or has expired.",
        )

    # Authorization: user must own snapshot or be superuser
    if not current_user.is_superuser and snapshot.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You do not have permission to view this analysis snapshot.",
        )

    return AISnapshotResponse(
        id=str(snapshot.id),
        source_type="ai_query_result",
        message_id=str(snapshot.message_id) if snapshot.message_id else None,
        dataset_id=str(snapshot.dataset_id) if snapshot.dataset_id else None,
        dataset_name=snapshot.dataset_name,
        question=snapshot.question,
        sql=snapshot.sql,
        columns=snapshot.columns,
        column_types=snapshot.column_types or [],
        rows=snapshot.rows,
        row_count=snapshot.row_count,
        duration_ms=snapshot.duration_ms,
        recommended_chart=snapshot.recommended_chart or {},
        created_at=snapshot.created_at.isoformat() if snapshot.created_at else None,
    )


@router.post("/verify")
async def verify_grounding(
    payload: AIVerifyRequest,
    current_user: User = Depends(require_permission("ai:use")),
) -> Dict[str, Any]:
    """Ad-hoc endpoint to verify numeric grounding of text against query rows."""
    res = GroundingGuardrail.verify(
        response_text=payload.text,
        query_rows=payload.rows,
        columns=payload.columns,
    )
    return res.to_dict()


@router.get("/conversations")
async def list_conversations(
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("ai:use")),
) -> List[Dict[str, Any]]:
    """List recent AI conversations for current user."""
    stmt = (
        select(AIConversation)
        .where(AIConversation.user_id == current_user.id, AIConversation.deleted_at.is_(None))
        .order_by(AIConversation.created_at.desc())
        .limit(20)
    )
    res = await session.execute(stmt)
    convs = res.scalars().all()

    return [
        {
            "id": str(c.id),
            "title": c.title,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in convs
    ]


@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(require_permission("ai:use")),
) -> List[Dict[str, Any]]:
    """Get message history for an AI conversation thread."""
    stmt = (
        select(AIMessage)
        .options(selectinload(AIMessage.tool_calls))
        .where(
            AIMessage.conversation_id == conversation_id,
            AIMessage.deleted_at.is_(None),
        )
        .order_by(AIMessage.created_at.asc())
    )
    res = await session.execute(stmt)
    messages = res.scalars().all()

    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "grounding_status": m.grounding_status,
            "ungrounded_numbers": m.ungrounded_numbers or [],
            "chart_spec": m.chart_spec,
            "tool_calls": [
                {
                    "tool_name": tc.tool_name,
                    "arguments": tc.arguments,
                    "success": tc.success,
                    "execution_time_ms": tc.execution_time_ms,
                }
                for tc in m.tool_calls
            ],
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ]
