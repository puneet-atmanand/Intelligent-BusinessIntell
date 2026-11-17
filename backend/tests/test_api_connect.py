"""Comprehensive test suite for API Connect engine, normalization, materialization, and REST endpoints."""
import pytest
import textwrap
import uuid
import duckdb
import pandas as pd
from sqlalchemy import select

from app.core.config import settings
from app.core.errors import ValidationError
from app.core.security import decrypt_secret
from app.db.models import Dataset, DatasetColumn
from app.db.models.api_connect import (
    ApiConnection,
    ApiCredential,
    ApiDatasetCollection,
    ApiDatasetTable,
)
from app.services.api_connect.ssrf_guard import is_ip_blocked, validate_url_safe
from app.services.api_connect.normalizer import (
    flatten_record,
    infer_duckdb_type,
    navigate_path,
    normalize_api_data,
)
from app.services.api_connect.openapi_importer import OpenApiParser, parse_openapi_content
from app.services.api_connect.materializer import materialize_api_table


def test_ssrf_guard_blocks_private_and_loopback():
    blocked_ips = (
        "127.0.0.1",
        "127.0.0.100",
        "10.0.0.5",
        "192.168.1.1",
        "172.16.0.1",
        "169.254.169.254",
        "::1",
    )
    for ip in blocked_ips:
        assert is_ip_blocked(ip) is True

    assert is_ip_blocked("8.8.8.8") is False
    assert is_ip_blocked("1.1.1.1") is False


def test_ssrf_guard_blocks_dangerous_urls():
    for bad_url in [
        "file:///etc/passwd",
        "ftp://example.com/test",
        "http://localhost:8000/api",
        "http://127.0.0.1:3000",
        "http://169.254.169.254/computeMetadata/v1/",
    ]:
        with pytest.raises(ValidationError):
            validate_url_safe(bad_url)


def test_normalizer_navigate_path():
    payload = {
        "status": "success",
        "data": {
            "items": [
                {"id": 1, "name": "Alpha"},
                {"id": 2, "name": "Beta"},
            ]
        },
    }
    extracted = navigate_path(payload, "data.items")
    assert isinstance(extracted, list)
    assert len(extracted) == 2
    assert extracted[0]["name"] == "Alpha"

    auto = navigate_path(payload, None)
    assert isinstance(auto, list)
    assert len(auto) == 2


def test_normalizer_flatten_record():
    nested = {
        "id": 101,
        "customer": {
            "name": "Alice",
            "contact": {
                "email": "alice@example.com",
                "phone": "555-1234",
            },
        },
        "tags": ["vip", "active"],
    }
    flattened = flatten_record(nested)
    assert flattened["id"] == 101
    assert flattened["customer_name"] == "Alice"
    assert flattened["customer_contact_email"] == "alice@example.com"
    assert flattened["customer_contact_phone"] == "555-1234"
    assert "tags" in flattened


def test_normalizer_infer_duckdb_type():
    assert infer_duckdb_type([1, 2, 3]) == "BIGINT"
    assert infer_duckdb_type([1.5, 2.7, 3.0]) == "DOUBLE"
    assert infer_duckdb_type([True, False, True]) == "BOOLEAN"
    assert infer_duckdb_type(["2026-01-01", "2026-02-15 12:00:00"]) == "TIMESTAMP"
    assert infer_duckdb_type(["hello", "world", "abc"]) == "VARCHAR"


def test_normalize_api_data_end_to_end():
    raw_response = {
        "results": [
            {
                "product_id": 1,
                "title": "Laptop",
                "price": 999.99,
                "available": True,
                "created_at": "2026-03-01T10:00:00",
            },
            {
                "product_id": 2,
                "title": "Mouse",
                "price": 29.50,
                "available": True,
                "created_at": "2026-03-02T11:00:00",
            },
        ]
    }
    records, schema_types, df = normalize_api_data(
        raw_response, response_path="results"
    )
    assert len(records) == 2
    assert schema_types["product_id"] == "BIGINT"
    assert schema_types["price"] == "DOUBLE"
    assert schema_types["available"] == "BOOLEAN"
    assert schema_types["created_at"] == "TIMESTAMP"
    assert schema_types["title"] == "VARCHAR"
    assert len(df) == 2


def test_openapi_parser():
    sample_spec = textwrap.dedent("""
    openapi: 3.0.0
    info:
      title: Petstore Mock
      version: 1.0.0
      description: Sample petstore API
    servers:
      - url: https://api.petstore.com/v1
    paths:
      /pets:
        get:
          summary: List all pets
          operationId: listPets
          parameters:
            - name: limit
              in: query
              default: 20
        post:
          summary: Create a pet
          operationId: createPet
      /pets/{id}:
        get:
          summary: Get pet details
          operationId: getPet
    """)
    spec_dict = parse_openapi_content(sample_spec)
    parsed = OpenApiParser.parse_specification(spec_dict)
    assert parsed["title"] == "Petstore Mock"
    assert parsed["version"] == "1.0.0"
    assert parsed["base_url"] == "https://api.petstore.com/v1"
    assert len(parsed["endpoints"]) == 3

    get_pets = next(e for e in parsed["endpoints"] if e["method"] == "GET" and e["path"] == "/pets")
    assert get_pets["summary"] == "List all pets"
    assert "limit" in get_pets["query_params"]


@pytest.mark.asyncio
async def test_api_connection_creation_and_encryption(client, db_session):
    payload = {
        "name": "Stripe Payments Test",
        "base_url": "https://api.stripe.com/v1",
        "description": "Stripe test connection",
        "auth_type": "bearer",
        "secret": "sk_test_super_secret_key_12345",
        "default_headers": {"Stripe-Version": "2023-10-16"},
    }
    res = await client.post("/api/v1/api-connect/connections", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Stripe Payments Test"
    assert "secret" not in data

    conn_id = uuid.UUID(data["id"]) if isinstance(data["id"], str) else data["id"]
    cred_stmt = select(ApiCredential).where(ApiCredential.connection_id == conn_id)
    cred_res = await db_session.execute(cred_stmt)
    cred = cred_res.scalars().first()
    assert cred is not None
    assert cred.encrypted_secret != "sk_test_super_secret_key_12345"
    assert decrypt_secret(cred.encrypted_secret) == "sk_test_super_secret_key_12345"

    list_res = await client.get("/api/v1/api-connect/connections")
    assert list_res.status_code == 200
    connections = list_res.json()
    assert any(c["id"] == data["id"] for c in connections)


@pytest.mark.asyncio
async def test_dataset_collections_and_table_management(client, db_session):
    conn_res = await client.post(
        "/api/v1/api-connect/connections",
        json={"name": "GitHub API", "base_url": "https://api.github.com"},
    )
    conn_id = conn_res.json()["id"]

    col_res = await client.post(
        "/api/v1/api-connect/collections",
        json={
            "name": "Dev Metrics",
            "description": "Developer metrics",
            "tags": ["git", "ci"],
        },
    )
    assert col_res.status_code == 201
    col_id = col_res.json()["id"]

    # Duplicate check
    dup_res = await client.post(
        "/api/v1/api-connect/collections",
        json={"name": "Dev Metrics"},
    )
    assert dup_res.status_code == 409

    tbl_res = await client.post(
        "/api/v1/api-connect/tables",
        json={
            "collection_id": col_id,
            "connection_id": conn_id,
            "display_name": "Repository Stars",
            "table_name": "repo_stars",
            "storage_mode": "materialized",
            "auto_materialize": False,
            "endpoint_spec": {
                "path": "/users/octocat/starred",
                "method": "GET",
            },
        },
    )
    assert tbl_res.status_code == 201
    tbl_data = tbl_res.json()
    assert tbl_data["table_name"] == "repo_stars"
    assert tbl_data["collection_id"] == col_id

    # Duplicate table in same collection
    tbl_dup_res = await client.post(
        "/api/v1/api-connect/tables",
        json={
            "collection_id": col_id,
            "connection_id": conn_id,
            "display_name": "Repo Stars Duplicate",
            "table_name": "repo_stars",
            "storage_mode": "materialized",
            "auto_materialize": False,
        },
    )
    assert tbl_dup_res.status_code == 409

    col_get = await client.get(f"/api/v1/api-connect/collections/{col_id}")
    assert col_get.status_code == 200
    col_data = col_get.json()
    assert col_data["table_count"] == 1
    assert len(col_data["tables"]) == 1
    assert col_data["tables"][0]["table_name"] == "repo_stars"


@pytest.mark.asyncio
async def test_materialize_api_table_into_duckdb(db_session):
    col = ApiDatasetCollection(name="Store Test", description="Store Collection")
    conn = ApiConnection(name="Store Conn", base_url="https://api.store.com")
    db_session.add_all([col, conn])
    await db_session.flush()

    tbl = ApiDatasetTable(
        collection_id=col.id,
        connection_id=conn.id,
        display_name="Product Inventory",
        table_name="products",
        storage_mode="materialized",
    )
    db_session.add(tbl)
    await db_session.flush()

    df = pd.DataFrame([
        {"item_id": 1, "item_name": "Keyboard", "price": 49.99, "stock": 120},
        {"item_id": 2, "item_name": "Monitor", "price": 199.50, "stock": 45},
        {"item_id": 3, "item_name": "Desk Lamp", "price": 25.00, "stock": 80},
    ])

    result = await materialize_api_table(session=db_session, table=tbl, df=df)
    assert result["status"] == "ready"
    assert result["record_count"] == 3
    assert result["snapshot_version"] >= 1

    physical_table = result["physical_table_name"]
    duck_conn = duckdb.connect(settings.DUCKDB_DATABASE_PATH, read_only=True)
    query_res = duck_conn.execute(
        f"SELECT COUNT(*) AS cnt, SUM(stock) AS total_stock FROM {physical_table}"
    ).fetchone()
    duck_conn.close()

    assert query_res[0] == 3
    assert query_res[1] == 245

    dataset_stmt = select(Dataset).where(Dataset.id == tbl.semantic_dataset_id)
    ds_res = await db_session.execute(dataset_stmt)
    dataset = ds_res.scalars().first()
    assert dataset is not None
    assert dataset.name == "Store Test - Product Inventory"

    cols_stmt = select(DatasetColumn).where(DatasetColumn.dataset_id == dataset.id)
    cols_res = await db_session.execute(cols_stmt)
    cols = cols_res.scalars().all()
    col_names = {c.name for c in cols}
    assert {"item_id", "item_name", "price", "stock"}.issubset(col_names)


@pytest.mark.asyncio
async def test_client_follows_redirects_and_blocks_ssrf_redirect(monkeypatch):
    import httpx
    import socket
    from app.services.api_connect.client import ApiConnectClient

    # Mock DNS lookup so sandbox without internet can resolve mock domains
    def mock_getaddrinfo(host, port, *args, **kwargs):
        if host in ("example.com", "api.testingapis.com"):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]
        elif host == "169.254.169.254":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", port))]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    def mock_transport_handler(request: httpx.Request):
        url_str = str(request.url)
        if "/redir-safe" in url_str:
            return httpx.Response(302, headers={"Location": "https://example.com/target-data"})
        elif "/redir-ssrf" in url_str:
            return httpx.Response(302, headers={"Location": "http://169.254.169.254/meta-data"})
        elif "/target-data" in url_str:
            return httpx.Response(200, json={"message": "landed safely"})
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(mock_transport_handler)

    orig_async_client = httpx.AsyncClient

    def patched_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return orig_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.api_connect.client.httpx.AsyncClient", patched_async_client)

    client = ApiConnectClient(base_url="https://example.com", allow_local=False)

    # Test 1: Safe redirect followed to 200 OK
    resp_safe = await client.execute("/redir-safe")
    assert resp_safe.status_code == 200
    assert resp_safe.success is True
    assert resp_safe.data == {"message": "landed safely"}

    # Test 2: SSRF redirect blocked by event hook
    resp_ssrf = await client.execute("/redir-ssrf")
    assert resp_ssrf.success is False
    assert "SSRF" in resp_ssrf.error_message or "Request failed" in resp_ssrf.error_message


@pytest.mark.asyncio
async def test_connection_test_302_reachability(client, monkeypatch):
    import httpx
    import socket

    def mock_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(socket, "getaddrinfo", mock_getaddrinfo)

    def mock_transport_handler(request: httpx.Request):
        # Emulate an API endpoint responding with 302 Found
        return httpx.Response(302, text="Redirecting...")

    transport = httpx.MockTransport(mock_transport_handler)
    orig_async_client = httpx.AsyncClient

    def patched_async_client(*args, **kwargs):
        kwargs["transport"] = transport
        return orig_async_client(*args, **kwargs)

    monkeypatch.setattr("app.services.api_connect.client.httpx.AsyncClient", patched_async_client)

    test_res = await client.post(
        "/api/v1/api-connect/connections/test",
        json={
            "name": "Testing API'S",
            "base_url": "https://api.testingapis.com",
            "auth_type": "none",
        },
    )
    assert test_res.status_code == 200
    data = test_res.json()
    assert data["success"] is True
    assert data["status_code"] == 302
    assert "Connection successful!" in data["message"]

