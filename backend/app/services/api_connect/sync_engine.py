"""Synchronization Engine for API Datasets."""
from datetime import datetime, timezone
import logging
import time
from typing import Any, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppException
from app.db.models import User
from app.db.models.api_connect import ApiConnection, ApiDatasetTable, ApiEndpoint, ApiSyncRun
from app.services.api_connect.client import ApiConnectClient
from app.services.api_connect.materializer import materialize_api_table
from app.services.api_connect.normalizer import normalize_api_data
from app.services.api_connect.paginator import ApiPaginator

logger = logging.getLogger(__name__)


async def execute_sync_for_table(
    session: AsyncSession,
    table_id: Any,
    user: Optional[User] = None,
    allow_local: bool = False,
) -> Dict[str, Any]:
    """Execute full ingestion, normalization, and materialization sync run for an API table."""
    table = await session.get(ApiDatasetTable, table_id)
    if not table:
        raise AppException(f"API Dataset Table {table_id} not found")

    connection = await session.get(ApiConnection, table.connection_id)
    if not connection:
        raise AppException(f"API Connection {table.connection_id} not found")

    endpoint = None
    if table.endpoint_id:
        endpoint = await session.get(ApiEndpoint, table.endpoint_id)

    start_time = time.time()
    sync_run = ApiSyncRun(
        table_id=table.id,
        status="RUNNING",
        started_at=datetime.now(timezone.utc),
    )
    session.add(sync_run)
    table.materialization_status = "syncing"
    await session.commit()

    try:
        encrypted_secret = None
        if connection.credentials:
            encrypted_secret = connection.credentials[0].encrypted_secret

        client = ApiConnectClient(
            base_url=connection.base_url,
            auth_type=connection.auth_type,
            auth_config=connection.auth_config,
            encrypted_secret=encrypted_secret,
            default_headers=connection.default_headers,
            timeout_seconds=connection.timeout_seconds,
            max_retries=connection.max_retries,
            verify_ssl=connection.verify_ssl,
            allow_local=allow_local,
        )

        path = endpoint.path if endpoint else ""
        method = endpoint.method if endpoint else "GET"
        headers = endpoint.headers if endpoint else {}
        query_params = endpoint.query_params if endpoint else {}
        body = endpoint.body if endpoint else None
        pagination_config = endpoint.pagination_config if endpoint else {}
        response_path = endpoint.response_path if endpoint else None

        paginator = ApiPaginator(client=client, pagination_config=pagination_config)
        raw_records, responses = await paginator.fetch_all_pages(
            path_or_url=path,
            method=method,
            headers=headers,
            query_params=query_params,
            body=body,
            response_path=response_path,
        )

        if not raw_records:
            err = responses[-1].error_message if responses else "No records returned from API"
            raise AppException(f"Failed to fetch records: {err}")

        records, schema_types, df = normalize_api_data(
            raw_data=raw_records,
            response_path=None,
            flatten_nested=True,
        )

        if df.empty:
            raise AppException("Normalized dataset contains 0 rows.")

        mat_result = await materialize_api_table(
            session=session,
            table=table,
            df=df,
            user=user,
        )

        duration_ms = int((time.time() - start_time) * 1000)
        sync_run.status = "SUCCESS"
        sync_run.records_fetched = len(raw_records)
        sync_run.records_written = len(df)
        sync_run.execution_duration_ms = duration_ms
        sync_run.snapshot_path = mat_result.get("snapshot_path")
        sync_run.completed_at = datetime.now(timezone.utc)
        await session.commit()

        return {
            "success": True,
            "run_id": str(sync_run.id),
            "status": "SUCCESS",
            "records_fetched": len(raw_records),
            "records_written": len(df),
            "duration_ms": duration_ms,
            "materialization": mat_result,
        }

    except Exception as exc:
        duration_ms = int((time.time() - start_time) * 1000)
        err_msg = str(exc)
        logger.error(f"Sync failed for table {table.id}: {err_msg}", exc_info=True)
        sync_run.status = "FAILED"
        sync_run.error_message = err_msg
        sync_run.execution_duration_ms = duration_ms
        sync_run.completed_at = datetime.now(timezone.utc)
        table.materialization_status = "error"
        table.last_error = err_msg
        await session.commit()

        return {
            "success": False,
            "run_id": str(sync_run.id),
            "status": "FAILED",
            "error_message": err_msg,
            "duration_ms": duration_ms,
        }
