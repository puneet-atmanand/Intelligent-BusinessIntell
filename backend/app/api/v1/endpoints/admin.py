"""Super Administrator Control Panel API Endpoints."""
from datetime import datetime, timezone
from typing import Any, List, Optional
import uuid
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.deps import get_db_session, require_superadmin
from app.core.config import settings
from app.core.errors import NotFoundError, ValidationError
from app.db.models import Chart, DatabaseConnection, Dataset, Role, User
from app.schemas.auth import (
    AdminDashboardStatsOut,
    AdminDatasetItem,
    AdminUserItem,
    AdminUserListResponse,
    UserUpdateStatusRequest,
)

router = APIRouter(prefix="/admin", tags=["Super Admin"])


@router.get("/dashboard", response_model=AdminDashboardStatsOut)
async def get_admin_dashboard(
    current_admin: User = Depends(require_superadmin),
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Retrieve high-level system statistics, health metrics, and recent user signups."""
    # 1. User metrics
    total_users_res = await session.execute(
        select(func.count(User.id)).where(User.deleted_at.is_(None))
    )
    total_users = total_users_res.scalar_one() or 0

    active_users_res = await session.execute(
        select(func.count(User.id)).where(User.deleted_at.is_(None), User.is_active.is_(True))
    )
    active_users = active_users_res.scalar_one() or 0

    inactive_users = total_users - active_users

    # 2. Datasets & Charts metrics
    total_datasets_res = await session.execute(
        select(func.count(Dataset.id)).where(Dataset.deleted_at.is_(None))
    )
    total_datasets = total_datasets_res.scalar_one() or 0

    total_charts_res = await session.execute(
        select(func.count(Chart.id)).where(Chart.deleted_at.is_(None))
    )
    total_charts = total_charts_res.scalar_one() or 0

    # 3. Recent registrations (last 5)
    recent_stmt = (
        select(User)
        .options(selectinload(User.roles))
        .where(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
        .limit(5)
    )
    recent_users = (await session.execute(recent_stmt)).scalars().all()

    recent_items = [
        AdminUserItem(
            id=u.id,
            email=u.email,
            full_name=u.full_name,
            role=u.role,
            is_active=u.is_active,
            is_superuser=u.is_superuser,
            is_verified=getattr(u, "is_verified", True),
            created_at=u.created_at,
            last_login=getattr(u, "last_login", None),
            dataset_count=0,
            chart_count=0,
        )
        for u in recent_users
    ]

    # 4. Safe system status overview (Never exposing secrets or API keys)
    system_status = {
        "database_type": "SQLite (aiosqlite)",
        "database_path": "backend/data/intelligent_business.db",
        "analytical_engine": "DuckDB Columnar Store",
        "llm_provider": settings.LLM_PROVIDER,
        "llm_model": settings.LLM_MODEL,
        "ai_enabled": settings.AI_ENABLED,
        "environment": settings.ENVIRONMENT,
        "superadmin_configured": bool(settings.SUPERADMIN_EMAIL),
        "auth_enforced": settings.AUTH_REQUIRED,
    }

    return AdminDashboardStatsOut(
        total_users=total_users,
        active_users=active_users,
        inactive_users=inactive_users,
        total_datasets=total_datasets,
        total_charts=total_charts,
        recent_registrations=recent_items,
        system_status=system_status,
    )


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    search: Optional[str] = Query(None, description="Search by full name or email"),
    status: Optional[str] = Query("all", description="Filter by status: 'all', 'active', 'inactive'"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_admin: User = Depends(require_superadmin),
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """List registered users with dataset and chart usage stats, search, and filtering."""
    query = (
        select(User)
        .options(selectinload(User.roles))
        .where(User.deleted_at.is_(None))
    )

    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        query = query.where(
            func.lower(User.email).like(term) | func.lower(User.full_name).like(term)
        )

    if status == "active":
        query = query.where(User.is_active.is_(True))
    elif status == "inactive":
        query = query.where(User.is_active.is_(False))

    # Total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_query)).scalar_one() or 0

    # Paginate
    query = query.order_by(User.created_at.desc()).limit(limit).offset(offset)
    users = (await session.execute(query)).scalars().all()

    # Pre-calculate dataset counts per user
    user_ids = [u.id for u in users]
    dataset_counts: dict[uuid.UUID, int] = {}
    if user_ids:
        ds_stmt = (
            select(Dataset.created_by_id, func.count(Dataset.id))
            .where(Dataset.created_by_id.in_(user_ids), Dataset.deleted_at.is_(None))
            .group_by(Dataset.created_by_id)
        )
        ds_res = await session.execute(ds_stmt)
        for uid, cnt in ds_res.all():
            if uid:
                dataset_counts[uid] = cnt

    user_items = [
        AdminUserItem(
            id=u.id,
            email=u.email,
            full_name=u.full_name,
            role=u.role,
            is_active=u.is_active,
            is_superuser=u.is_superuser,
            is_verified=getattr(u, "is_verified", True),
            created_at=u.created_at,
            last_login=getattr(u, "last_login", None),
            dataset_count=dataset_counts.get(u.id, 0),
            chart_count=0,
        )
        for u in users
    ]

    return AdminUserListResponse(total=total, users=user_items)


@router.get("/users/{user_id}", response_model=AdminUserItem)
async def get_user_details(
    user_id: uuid.UUID,
    current_admin: User = Depends(require_superadmin),
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Retrieve full details for a specific user."""
    stmt = (
        select(User)
        .options(selectinload(User.roles))
        .where(User.id == user_id, User.deleted_at.is_(None))
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")

    ds_count_res = await session.execute(
        select(func.count(Dataset.id)).where(Dataset.created_by_id == user.id, Dataset.deleted_at.is_(None))
    )
    dataset_count = ds_count_res.scalar_one() or 0

    return AdminUserItem(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_verified=getattr(user, "is_verified", True),
        created_at=user.created_at,
        last_login=getattr(user, "last_login", None),
        dataset_count=dataset_count,
        chart_count=0,
    )


@router.patch("/users/{user_id}/status", response_model=AdminUserItem)
async def update_user_status(
    user_id: uuid.UUID,
    payload: UserUpdateStatusRequest,
    current_admin: User = Depends(require_superadmin),
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Activate or deactivate a user account with safeguards."""
    if user_id == current_admin.id and not payload.is_active:
        raise ValidationError("Safety Safeguard: You cannot deactivate your own administrative account.")

    stmt = select(User).where(User.id == user_id, User.deleted_at.is_(None))
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")

    if user.is_superuser and not payload.is_active:
        raise ValidationError("Safety Safeguard: Super Administrator accounts cannot be deactivated.")

    user.is_active = payload.is_active
    await session.commit()
    await session.refresh(user)

    return AdminUserItem(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_verified=getattr(user, "is_verified", True),
        created_at=user.created_at,
        last_login=getattr(user, "last_login", None),
        dataset_count=0,
        chart_count=0,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_200_OK)
async def delete_user(
    user_id: uuid.UUID,
    current_admin: User = Depends(require_superadmin),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Soft delete a user account with strict safeguards."""
    if user_id == current_admin.id:
        raise ValidationError("Safety Safeguard: You cannot delete your own administrative account.")

    stmt = select(User).where(User.id == user_id, User.deleted_at.is_(None))
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")

    if user.is_superuser:
        raise ValidationError("Safety Safeguard: Super Administrator accounts cannot be deleted.")

    user.deleted_at = datetime.now(timezone.utc)
    user.is_active = False
    await session.commit()

    return {"message": f"User '{user.email}' has been safely deleted."}


@router.get("/datasets", response_model=List[AdminDatasetItem])
async def list_all_admin_datasets(
    current_admin: User = Depends(require_superadmin),
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Super Admin dataset monitoring: View ownership, schema, and table metadata across all users."""
    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.deleted_at.is_(None))
        .order_by(Dataset.created_at.desc())
    )
    result = await session.execute(stmt)
    datasets = result.scalars().all()

    # Preload database and user maps
    db_ids = {d.database_id for d in datasets}
    db_map = {}
    if db_ids:
        db_res = await session.execute(
            select(DatabaseConnection).where(DatabaseConnection.id.in_(db_ids))
        )
        db_map = {d.id: d.name for d in db_res.scalars().all()}

    user_ids = {d.created_by_id for d in datasets if d.created_by_id}
    user_map = {}
    if user_ids:
        u_res = await session.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {u.id: u for u in u_res.scalars().all()}

    items = []
    for d in datasets:
        owner = user_map.get(d.created_by_id)
        owner_email = owner.email if owner else (d.owners[0] if d.owners else "System")
        owner_name = owner.full_name if owner else "System / Built-in"

        items.append(
            AdminDatasetItem(
                id=d.id,
                name=d.name,
                description=d.description,
                database_name=db_map.get(d.database_id, "DuckDB (Uploads)"),
                table_name=d.table_name,
                schema_name=d.schema_name,
                is_virtual=d.is_virtual,
                owner_email=owner_email,
                owner_name=owner_name,
                created_at=d.created_at,
                column_count=len(d.columns or []),
            )
        )

    return items
