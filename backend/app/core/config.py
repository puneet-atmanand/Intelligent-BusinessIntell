"""Application Configuration Module."""
import os
import secrets
from pathlib import Path
from typing import List, Union
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = (BACKEND_DIR / "data").resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SQLITE_PATH = (DATA_DIR / "intelligent_business.db").resolve().as_posix()
DEFAULT_SQLITE_URL = f"sqlite+aiosqlite:///{DEFAULT_SQLITE_PATH}"
DEFAULT_SQLITE_SYNC_URL = f"sqlite:///{DEFAULT_SQLITE_PATH}"
DEFAULT_DUCKDB_PATH = (DATA_DIR / "askyourdata.duckdb").resolve().as_posix()

ENV_FILE_PATH = BACKEND_DIR / ".env"
ROOT_ENV_FILE_PATH = BACKEND_DIR.parent / ".env"


class Settings(BaseSettings):
    """Global configuration settings for Ask Your Data backend."""

    model_config = SettingsConfigDict(
        env_file=(str(ROOT_ENV_FILE_PATH), str(ENV_FILE_PATH)),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    PROJECT_NAME: str = "Ask Your Data"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Security
    SECRET_KEY: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    # 32-byte Fernet key base64 urlsafe encoded
    ENCRYPTION_KEY: str = "dGhpcy1pcy1hLTMyLWJ5dGUtZmVybmV0LWtleS0xMjM="
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    COOKIE_SECURE: bool = False  # Set to True in production (HTTPS)
    COOKIE_SAMESITE: str = "lax"
    AUTH_REQUIRED: bool = True  # Enforce mandatory authentication gate

    # Metadata Database (Default to local SQLite with aiosqlite for standalone dev)
    METADATA_DATABASE_URL: str = DEFAULT_SQLITE_URL
    METADATA_DATABASE_SYNC_URL: str = DEFAULT_SQLITE_SYNC_URL

    # Redis Cache & Broker
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # DuckDB Internal Columnar Storage
    DUCKDB_DATABASE_PATH: str = DEFAULT_DUCKDB_PATH

    # CORS
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]

    @field_validator("METADATA_DATABASE_URL", "METADATA_DATABASE_SYNC_URL", mode="after")
    @classmethod
    def resolve_sqlite_url(cls, v: str) -> str:
        if "sqlite" in v and ":///" in v:
            prefix, path = v.split(":///", 1)
            path = path.replace("\\", "/")
            if not os.path.isabs(path) and not (len(path) > 1 and path[1] == ":"):
                clean_path = path.lstrip("./")
                resolved = (BACKEND_DIR / clean_path).resolve()
            else:
                resolved = Path(path).resolve()
            resolved.parent.mkdir(parents=True, exist_ok=True)
            return f"{prefix}:///{resolved.as_posix()}"
        return v

    @field_validator("DUCKDB_DATABASE_PATH", mode="after")
    @classmethod
    def resolve_duckdb_path(cls, v: str) -> str:
        v = v.replace("\\", "/")
        if not os.path.isabs(v) and not (len(v) > 1 and v[1] == ":"):
            clean_path = v.lstrip("./")
            resolved = (BACKEND_DIR / clean_path).resolve()
        else:
            resolved = Path(v).resolve()
        resolved.parent.mkdir(parents=True, exist_ok=True)
        return resolved.as_posix()

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, list):
            return v
        return ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"]

    # Super Administrator Configuration (environment-driven)
    SUPERADMIN_EMAIL: str = "admin@askyourdata.local"
    SUPERADMIN_PASSWORD: str = "admin123456"
    SUPERADMIN_NAME: str = "Super Administrator"

    # Backward compatibility aliases
    ADMIN_EMAIL: str = "admin@askyourdata.local"
    ADMIN_PASSWORD: str = "admin123456"

    @model_validator(mode="after")
    def harmonize_superadmin_credentials(self) -> "Settings":
        # If SUPERADMIN_EMAIL was customized and ADMIN_EMAIL is default, sync them
        if self.SUPERADMIN_EMAIL != "admin@askyourdata.local" and self.ADMIN_EMAIL == "admin@askyourdata.local":
            self.ADMIN_EMAIL = self.SUPERADMIN_EMAIL
        elif self.ADMIN_EMAIL != "admin@askyourdata.local" and self.SUPERADMIN_EMAIL == "admin@askyourdata.local":
            self.SUPERADMIN_EMAIL = self.ADMIN_EMAIL

        if self.SUPERADMIN_PASSWORD != "admin123456" and self.ADMIN_PASSWORD == "admin123456":
            self.ADMIN_PASSWORD = self.SUPERADMIN_PASSWORD
        elif self.ADMIN_PASSWORD != "admin123456" and self.SUPERADMIN_PASSWORD == "admin123456":
            self.SUPERADMIN_PASSWORD = self.ADMIN_PASSWORD
        return self

    # Limits and Guardrails
    MAX_UPLOAD_SIZE_MB: int = 200
    STATEMENT_TIMEOUT_SECONDS: int = 30
    DEFAULT_ROW_LIMIT: int = 10000
    AI_MAX_ROWS: int = 2000
    BULK_DATASET_MAX_TABLES: int = 100
    FULL_DASHBOARD_MAX_CHARTS_PER_TABLE: int = 14
    FULL_DASHBOARD_MAX_TOTAL_CHARTS: int = 200
    AUTO_RELATIONSHIP_MAX: int = 10

    # AI Configuration
    AI_ENABLED: bool = True
    LLM_PROVIDER: str = "groq"
    LLM_MODEL: str = "openai/gpt-oss-120b"
    GROQ_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    SEND_SAMPLE_ROWS_TO_LLM: bool = False


settings = Settings()

