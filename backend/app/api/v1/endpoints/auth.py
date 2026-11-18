"""Authentication API Endpoints (Login, Super-Login, Register, Logout, Me, Refresh)."""
from datetime import datetime, timezone
import re
from typing import Any, List
from fastapi import APIRouter, Cookie, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.deps import get_current_active_user, get_db_session
from app.core.config import settings
from app.core.errors import AuthenticationError, ValidationError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.models import AuditLog, Role, User, UserRole
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    SuperLoginRequest,
    TokenResponse,
    UserProfileOut,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _extract_user_permissions(user: User) -> List[str]:
    """Helper to compile flat list of unique permission codes for a user."""
    perms = set()
    for role in (user.roles or []):
        for perm in (role.permissions or []):
            perms.add(perm.code)
    return sorted(list(perms))


def _build_user_out(user: User) -> UserProfileOut:
    """Helper to convert User model into UserProfileOut schema."""
    return UserProfileOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_verified=getattr(user, "is_verified", True),
        role=user.role,
        last_login=getattr(user, "last_login", None),
        created_at=getattr(user, "created_at", None),
        roles=user.roles or [],
        permissions=_extract_user_permissions(user),
    )


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    """Set secure httpOnly authentication cookies."""
    cookie_kwargs = {
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "path": "/",
    }
    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        **cookie_kwargs,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        **cookie_kwargs,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    response: Response,
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Public self-service user registration. Automatically assigns USER role."""
    # 1. Validate passwords match
    if payload.password != payload.confirm_password:
        raise ValidationError("Passwords do not match. Please ensure both fields are identical.")

    # 2. Enforce strong password requirements
    if len(payload.password) < 8:
        raise ValidationError("Password must be at least 8 characters long.")

    # 3. Normalize email
    clean_email = payload.email.strip().lower()
    email_regex = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    if not re.match(email_regex, clean_email):
        raise ValidationError("Please provide a valid email address.")

    # 4. Check if email already exists
    existing_stmt = select(User).where(User.email == clean_email, User.deleted_at.is_(None))
    existing_res = await session.execute(existing_stmt)
    if existing_res.scalar_one_or_none():
        raise ValidationError("An account with this email address already exists. Please sign in.")

    # 5. Create new User with default USER role (never SUPERADMIN)
    now = datetime.now(timezone.utc)
    new_user = User(
        email=clean_email,
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        is_active=True,
        is_superuser=False,
        is_verified=True,
        last_login=now,
    )
    session.add(new_user)
    await session.flush()

    # 6. Assign default role ("User" or fallback "Editor")
    role_stmt = select(Role).where(Role.name.in_(["User", "Editor"]))
    role_res = await session.execute(role_stmt)
    default_role = role_res.scalars().first()
    if default_role:
        session.add(UserRole(user_id=new_user.id, role_id=default_role.id))
        await session.flush()

    # Re-fetch user with loaded relationships
    user_stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == new_user.id)
    )
    fetched_user = (await session.execute(user_stmt)).scalar_one()

    # 7. Record audit log
    session.add(
        AuditLog(
            user_id=fetched_user.id,
            action="register",
            resource_type="user",
            resource_id=str(fetched_user.id),
            details={"email": fetched_user.email, "role": fetched_user.role},
        )
    )
    await session.commit()

    # 8. Issue JWT tokens
    token_data = {"sub": str(fetched_user.id), "email": fetched_user.email}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    _set_auth_cookies(response, access_token, refresh_token)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=_build_user_out(fetched_user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: LoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Authenticate client user with email and password."""
    clean_email = credentials.email.strip().lower()
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.email == clean_email, User.deleted_at.is_(None))
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(credentials.password, user.hashed_password):
        raise AuthenticationError("Invalid email or password")

    if not user.is_active:
        raise AuthenticationError("Your account has been deactivated. Please contact an administrator.")

    # Update last login timestamp
    user.last_login = datetime.now(timezone.utc)

    # Generate tokens
    token_data = {"sub": str(user.id), "email": user.email}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    _set_auth_cookies(response, access_token, refresh_token)

    # Record login audit log
    audit_entry = AuditLog(
        user_id=user.id,
        action="login",
        resource_type="user",
        resource_id=str(user.id),
        details={"email": user.email, "portal": "client"},
    )
    session.add(audit_entry)
    await session.commit()

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=_build_user_out(user),
    )


@router.post("/super-login", response_model=TokenResponse)
async def super_login(
    credentials: SuperLoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Dedicated Super Administrator portal authentication endpoint.
    Strictly verifies user has SUPERADMIN permissions before granting access.
    """
    clean_email = credentials.email.strip().lower()
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.email == clean_email, User.deleted_at.is_(None))
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(credentials.password, user.hashed_password):
        raise AuthenticationError("Invalid administrator credentials")

    # Strictly verify user is an authorized administrator
    is_admin = user.is_superuser or any(
        r.name in ["Admin", "Superadmin"] for r in (user.roles or [])
    )
    if not is_admin:
        raise AuthenticationError("Access denied: Administrator privileges required to access the Super Admin Portal.")

    if not user.is_active:
        raise AuthenticationError("Administrator account is inactive. Please contact system support.")

    # Update last login timestamp
    user.last_login = datetime.now(timezone.utc)

    # Generate tokens
    token_data = {"sub": str(user.id), "email": user.email, "is_superuser": True}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    _set_auth_cookies(response, access_token, refresh_token)

    # Audit log
    session.add(
        AuditLog(
            user_id=user.id,
            action="super_login",
            resource_type="user",
            resource_id=str(user.id),
            details={"email": user.email, "portal": "superadmin"},
        )
    )
    await session.commit()

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=_build_user_out(user),
    )


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(response: Response) -> dict[str, str]:
    """Clear authentication cookies."""
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")
    return {"message": "Successfully logged out"}


@router.get("/me", response_model=UserProfileOut)
async def get_my_profile(
    current_user: User = Depends(get_current_active_user),
) -> UserProfileOut:
    """Return profile, normalized role, and granular permissions for currently authenticated user."""
    return _build_user_out(current_user)


@router.post("/refresh")
async def refresh_token(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Issue a new access token using a valid refresh token cookie."""
    if not refresh_token:
        raise AuthenticationError("Refresh token missing")

    payload = decode_token(refresh_token)
    if payload.get("type") != "refresh":
        raise AuthenticationError("Invalid token type for refresh")

    user_id = payload.get("sub")
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user_id, User.deleted_at.is_(None))
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise AuthenticationError("User not found or inactive")

    new_access_token = create_access_token({"sub": str(user.id), "email": user.email})

    response.set_cookie(
        key="access_token",
        value=new_access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )

    return {"message": "Token refreshed successfully"}
