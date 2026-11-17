"""AI Assistant Tools (ADR-004 & Phase 4).

Standard tool interfaces and implementations for schema inspection and safe SQL execution.
"""
from typing import Any, Dict, List, Optional
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.guardrails.sql_guard import AISQLGuard
from app.connectors.duckdb_connector import DuckDBConnector
from app.connectors.factory import get_connector
from app.core.config import settings
from app.db.models import DatabaseConnection, Dataset, DatasetColumn, DatasetMetric, User


# Tool definitions in standard JSON Schema format compatible with OpenAI and Claude
AI_TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "list_datasets_and_tables",
            "description": "Lists all available semantic datasets and database tables accessible to the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {
                        "type": "string",
                        "description": "Optional search filter string for dataset or table names.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_table_schema",
            "description": "Retrieves the detailed column schema, data types, descriptions, and pre-defined metrics for a table or dataset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {
                        "type": "string",
                        "description": "The exact name of the table to inspect (e.g. 'global_sales').",
                    },
                    "dataset_id": {
                        "type": "string",
                        "description": "Optional UUID of the dataset if known.",
                    },
                },
                "required": ["table_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_sql_query",
            "description": "Executes a safe, read-only SELECT query against the user's data and returns the resulting rows, column headers, and execution metrics. IMPORTANT: For aggregate questions (totals, averages, counts per category), ALWAYS use SQL aggregations (COUNT, SUM, AVG, GROUP BY) rather than pulling raw unaggregated rows.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "The read-only SELECT SQL query to execute.",
                    },
                    "database_id": {
                        "type": "string",
                        "description": "Optional UUID of the database connection. If omitted, queries the internal DuckDB analytics engine.",
                    },
                },
                "required": ["sql"],
            },
        },
    },
]


async def tool_list_datasets_and_tables(
    session: AsyncSession,
    user: User,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute list_datasets_and_tables tool."""
    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.columns), selectinload(Dataset.metrics))
        .where(Dataset.deleted_at.is_(None))
    )
    res = await session.execute(stmt)
    datasets = res.scalars().all()

    items = []
    for d in datasets:
        if search and search.lower() not in d.name.lower() and search.lower() not in (d.table_name or "").lower():
            continue
        items.append({
            "dataset_id": str(d.id),
            "name": d.name,
            "table_name": d.table_name,
            "database_id": str(d.database_id),
            "schema_name": d.schema_name,
            "description": d.description,
            "is_virtual": d.is_virtual,
            "columns": [c.name for c in d.columns if not c.is_hidden_from_ai],
            "metrics": [{"name": m.name, "expression": m.sql_expression} for m in d.metrics],
        })

    # Also check duckdb tables
    duckdb_connector = DuckDBConnector()
    raw_tables = duckdb_connector.get_tables()

    return {
        "datasets": items,
        "internal_duckdb_tables": raw_tables,
        "count": len(items),
    }


async def tool_get_table_schema(
    session: AsyncSession,
    table_name: str,
    dataset_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute get_table_schema tool."""
    # 1. First check if a registered Dataset exists for this table
    stmt = (
        select(Dataset)
        .options(selectinload(Dataset.columns), selectinload(Dataset.metrics))
        .where(Dataset.deleted_at.is_(None))
    )
    if dataset_id:
        try:
            uid = uuid.UUID(dataset_id)
            stmt = stmt.where(Dataset.id == uid)
        except ValueError:
            stmt = stmt.where(Dataset.table_name == table_name)
    else:
        stmt = stmt.where(Dataset.table_name == table_name)

    res = await session.execute(stmt)
    dataset = res.scalars().first()

    if dataset:
        return {
            "found": True,
            "source_type": "semantic_dataset",
            "dataset_id": str(dataset.id),
            "database_id": str(dataset.database_id),
            "schema_name": dataset.schema_name,
            "table_name": dataset.table_name,
            "name": dataset.name,
            "description": dataset.description,
            "columns": [
                {
                    "name": c.name,
                    "type": c.data_type,
                    "is_datetime": c.is_datetime,
                    "is_numeric": any(t in (c.data_type or "").upper() for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC")),
                    "description": c.description,
                }
                for c in dataset.columns
                if not c.is_hidden_from_ai
            ],
            "predefined_metrics": [
                {
                    "name": m.name,
                    "label": m.verbose_name or m.name,
                    "sql_expression": m.sql_expression,
                    "number_format": m.number_format,
                    "description": m.description,
                }
                for m in dataset.metrics
            ],
        }

    # 2. Fall back to inspecting DuckDB table directly
    try:
        duckdb_connector = DuckDBConnector()
        cols = duckdb_connector.get_columns(table_name)
        return {
            "found": True,
            "source_type": "physical_table",
            "table_name": table_name,
            "columns": [{"name": c.name, "type": c.data_type, "nullable": c.nullable} for c in cols],
            "predefined_metrics": [],
        }
    except Exception as e:
        return {
            "found": False,
            "error": f"Table '{table_name}' not found: {str(e)}",
        }


async def tool_execute_sql_query(
    session: AsyncSession,
    sql: str,
    database_id: Optional[str] = None,
    max_rows: Optional[int] = None,
) -> Dict[str, Any]:
    """Execute execute_sql_query tool with full AST security guardrails."""
    effective_max_rows = max_rows or getattr(settings, "AI_MAX_ROWS", 2000)

    # 1. Resolve target Database Connection
    db_conn: Optional[DatabaseConnection] = None
    if database_id:
        try:
            db_uid = uuid.UUID(str(database_id))
            db_res = await session.execute(
                select(DatabaseConnection).where(
                    DatabaseConnection.id == db_uid,
                    DatabaseConnection.deleted_at.is_(None),
                )
            )
            db_conn = db_res.scalar_one_or_none()
            if not db_conn:
                # Check if database_id passed was actually a Dataset ID
                ds_res = await session.execute(
                    select(Dataset).where(
                        Dataset.id == db_uid,
                        Dataset.deleted_at.is_(None),
                    )
                )
                ds_match = ds_res.scalar_one_or_none()
                if ds_match:
                    db_res2 = await session.execute(
                        select(DatabaseConnection).where(
                            DatabaseConnection.id == ds_match.database_id,
                            DatabaseConnection.deleted_at.is_(None),
                        )
                    )
                    db_conn = db_res2.scalar_one_or_none()
        except Exception:
            pass

    # If still not resolved, check if table in SQL belongs to a registered dataset
    if not db_conn:
        try:
            all_ds_res = await session.execute(
                select(Dataset).where(Dataset.deleted_at.is_(None))
            )
            for d_rec in all_ds_res.scalars().all():
                if d_rec.table_name and (
                    f'"{d_rec.table_name.lower()}"' in sql.lower()
                    or f" {d_rec.table_name.lower()} " in sql.lower()
                    or f".{d_rec.table_name.lower()} " in sql.lower()
                    or sql.lower().strip().endswith(d_rec.table_name.lower())
                ):
                    db_res3 = await session.execute(
                        select(DatabaseConnection).where(
                            DatabaseConnection.id == d_rec.database_id,
                            DatabaseConnection.deleted_at.is_(None),
                        )
                    )
                    candidate_conn = db_res3.scalar_one_or_none()
                    if candidate_conn and not candidate_conn.is_system:
                        db_conn = candidate_conn
                        break
        except Exception:
            pass

    dialect = (db_conn.dialect or "duckdb").lower() if db_conn else "duckdb"
    if dialect in ("postgresql", "postgres"):
        dialect = "postgres"

    # 2. Enforce AST security constraints
    try:
        validated_sql = AISQLGuard.validate_and_constrain(
            sql=sql,
            dialect=dialect,
            max_rows=effective_max_rows,
        )
    except Exception as e:
        return {
            "success": False,
            "error": f"Security Guardrail Violation: {str(e)}",
            "sql": sql,
        }

    # 3. Execute on resolved database connection or fallback to internal DuckDB
    try:
        if db_conn:
            connector = get_connector(db_conn)
        else:
            connector = DuckDBConnector()

        result = connector.execute_query(
            sql=validated_sql,
            limit=effective_max_rows,
            timeout_seconds=settings.STATEMENT_TIMEOUT_SECONDS,
        )

        return {
            "success": True,
            "sql": validated_sql,
            "columns": result.columns,
            "column_types": result.column_types,
            "rows": result.rows,
            "row_count": result.row_count,
            "duration_ms": result.duration_ms,
            "truncated": result.truncated,
        }
    except Exception as e:
        return {
            "success": False,
            "sql": validated_sql,
            "error": f"Execution Error: {str(e)}",
        }

