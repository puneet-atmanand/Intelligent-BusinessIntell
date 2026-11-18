"""Authentication and User Management Schemas."""
from datetime import datetime
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """User login credential payload."""
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=6)
    remember_me: Optional[bool] = False


class SuperLoginRequest(BaseModel):
    """Super Administrator credential payload."""
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=6)


class RegisterRequest(BaseModel):
    """Client user self-registration payload."""
    full_name: str = Field(..., min_length=2, max_length=150)
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str = Field(..., min_length=8, max_length=128)


class UserUpdateStatusRequest(BaseModel):
    """Request payload to activate or deactivate a user account."""
    is_active: bool


class PermissionOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    resource: str

    model_config = {"from_attributes": True}


class RoleOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    is_system: bool
    permissions: List[PermissionOut] = []

    model_config = {"from_attributes": True}


class UserProfileOut(BaseModel):
    """User profile response with roles, normalized role string, and permissions."""
    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    is_superuser: bool
    is_verified: bool = True
    role: str = "USER"
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    roles: List[RoleOut] = []
    permissions: List[str] = []

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    """Token response returned upon successful authentication."""
    access_token: str
    token_type: str = "bearer"
    user: UserProfileOut


class AdminUserItem(BaseModel):
    """User item returned for administrator user management table."""
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    is_superuser: bool
    is_verified: bool = True
    created_at: datetime
    last_login: Optional[datetime] = None
    dataset_count: int = 0
    chart_count: int = 0

    model_config = {"from_attributes": True}


class AdminUserListResponse(BaseModel):
    """Paginated user listing response for admin."""
    total: int
    users: List[AdminUserItem]


class AdminDatasetItem(BaseModel):
    """Dataset item for administrator dataset monitoring."""
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    database_name: str
    table_name: Optional[str] = None
    schema_name: Optional[str] = None
    is_virtual: bool
    owner_email: Optional[str] = None
    owner_name: Optional[str] = None
    created_at: datetime
    column_count: int = 0


class AdminDashboardStatsOut(BaseModel):
    """High-level statistics overview for Super Admin dashboard."""
    total_users: int
    active_users: int
    inactive_users: int
    total_datasets: int
    total_charts: int
    recent_registrations: List[AdminUserItem]
    system_status: Dict[str, Any]
