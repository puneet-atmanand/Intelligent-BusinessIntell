"""Pytest test configuration and fixtures."""
import os
import tempfile
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.deps import get_db_session
from app.core.config import settings
from app.db.base import Base
from app.db.init_db import init_system_data
from app.main import app

# Set testing environment so lifespan does not attempt connection to default postgres
settings.ENVIRONMENT = "testing"

# Isolate DuckDB path and snapshots to temp directory so test data never pollutes DB
_test_duckdb_dir = tempfile.mkdtemp(prefix="test_duckdb_")
settings.DUCKDB_DATABASE_PATH = os.path.join(_test_duckdb_dir, "test.duckdb")

# Use in-memory SQLite with StaticPool so all async connections share the same memory DB
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestAsyncSession = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh database for each test."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestAsyncSession() as session:
        await init_system_data(session)
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client(
    db_session: AsyncSession, request: pytest.FixtureRequest
) -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP test client with overridden database dependency."""
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db_session] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        if not request.module.__name__.endswith("test_auth"):
            resp = await ac.post(
                "/api/v1/auth/login",
                json={
                    "email": settings.ADMIN_EMAIL,
                    "password": settings.ADMIN_PASSWORD,
                },
            )
            assert resp.status_code == 200
            token = resp.json()["access_token"]
            ac.headers["Authorization"] = f"Bearer {token}"
        yield ac

    app.dependency_overrides.clear()
