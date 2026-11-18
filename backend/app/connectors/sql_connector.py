"""Generic SQLAlchemy Database Connector (Postgres, MySQL, SQLite, MSSQL, ClickHouse)."""
import decimal
import time
from typing import Any, List, Optional, Tuple
from sqlalchemy import bindparam, create_engine, inspect, text
from sqlalchemy.engine import Engine

from app.connectors.base import BaseConnector, ColumnMetadata, QueryResult
from app.core.errors import AppException


class SQLAlchemyConnector(BaseConnector):
    """Connector using SQLAlchemy Engine and Inspector for generic relational engines."""

    def __init__(self, uri: str, statement_timeout_seconds: int = 30):
        self.uri = uri
        self.timeout_seconds = statement_timeout_seconds
        self._engine: Optional[Engine] = None

    def _get_engine(self) -> Engine:
        if self._engine is None:
            engine_args: dict[str, Any] = {
                "pool_pre_ping": True,
            }
            if "sqlite" in self.uri:
                engine_args["connect_args"] = {"check_same_thread": False}
            self._engine = create_engine(self.uri, **engine_args)
        return self._engine

    def test_connection(self) -> Tuple[bool, str]:
        try:
            engine = self._get_engine()
            with engine.connect() as conn:
                res = conn.execute(text("SELECT 1"))
                if res.scalar() == 1:
                    return True, "Connection successful."
            return False, "Database connected but test query returned unexpected result."
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    def _resolve_schema(self, inspector: Any, schema_name: Optional[str] = None) -> Optional[str]:
        """Resolve schema name intelligently across different database dialects."""
        try:
            available_schemas = inspector.get_schema_names()
        except Exception:
            available_schemas = []

        is_postgres = "postgres" in (self.uri or "").lower()
        is_mssql = "mssql" in (self.uri or "").lower()
        clean_schema = schema_name.strip() if schema_name else None

        if clean_schema:
            # Check for exact or case-insensitive match
            if clean_schema in available_schemas:
                return clean_schema
            for s in available_schemas:
                if s.lower() == clean_schema.lower():
                    return s

            # If schema_name is "main" (the frontend's default state):
            # For Postgres, "main" does not exist, so map to "public"
            # For MSSQL, map "main" to "dbo"
            if clean_schema.lower() == "main":
                if is_postgres:
                    return "public" if ("public" in available_schemas or not available_schemas) else (available_schemas[0] if available_schemas else "public")
                elif is_mssql:
                    return "dbo" if ("dbo" in available_schemas or not available_schemas) else (available_schemas[0] if available_schemas else "dbo")
                elif "default" in available_schemas:
                    return "default"
                elif "dbo" in available_schemas:
                    return "dbo"
                elif available_schemas:
                    return available_schemas[0]
                return None

            # If schema was specified but not found in available_schemas:
            if is_postgres and "public" in available_schemas:
                return "public"
            if is_mssql and "dbo" in available_schemas:
                return "dbo"
            return clean_schema

        # If schema_name is None or empty:
        if is_postgres:
            return "public" if ("public" in available_schemas or not available_schemas) else available_schemas[0]
        if is_mssql:
            return "dbo" if ("dbo" in available_schemas or not available_schemas) else (available_schemas[0] if available_schemas else "dbo")
        return None

    def get_schemas(self) -> List[str]:
        try:
            is_mssql = "mssql" in (self.uri or "").lower()
            if is_mssql:
                engine = self._get_engine()
                with engine.connect() as conn:
                    res = conn.execute(text("""
                        SELECT DISTINCT s.name AS schema_name
                        FROM sys.schemas s
                        JOIN sys.objects o ON s.schema_id = o.schema_id
                        WHERE o.type IN ('U', 'V')
                          AND s.name NOT IN (
                            'sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner',
                            'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
                            'db_backupoperator', 'db_datareader', 'db_datawriter',
                            'db_denydatareader', 'db_denydatawriter'
                          )
                        ORDER BY s.name
                    """))
                    return [r[0] for r in res.fetchall()]

            engine = self._get_engine()
            inspector = inspect(engine)
            schemas = inspector.get_schema_names()
            # Filter standard system schemas
            filtered = [
                s for s in schemas
                if s not in ("information_schema", "pg_catalog", "pg_toast")
            ]
            if filtered:
                return filtered
            if "sqlite" in self.uri.lower():
                return ["main"]
            if "postgres" in self.uri.lower():
                return ["public"]
            return ["default"]
        except Exception as e:
            if "sqlite" in self.uri.lower():
                return ["main"]
            return ["public"]

    def get_tables(self, schema_name: Optional[str] = None) -> List[str]:
        try:
            engine = self._get_engine()
            inspector = inspect(engine)
            schema = self._resolve_schema(inspector, schema_name)
            tables = inspector.get_table_names(schema=schema)
            views = inspector.get_view_names(schema=schema)

            # Fallback for PostgreSQL or other engines if nothing found in schema
            if not tables and not views and "postgres" in (self.uri or "").lower() and schema != "public":
                tables = inspector.get_table_names(schema="public")
                views = inspector.get_view_names(schema="public")
            if not tables and not views and schema is not None:
                tables = inspector.get_table_names(schema=None)
                views = inspector.get_view_names(schema=None)

            return sorted(list(set(tables + views)))
        except Exception as e:
            raise AppException(f"Failed to fetch tables: {str(e)}")

    def get_inventory(self) -> List[dict[str, Any]]:
        """Return all accessible non-system schemas with their tables/views and estimated row counts."""
        try:
            raw_schemas = self.get_schemas()
            system_schemas = {
                "information_schema", "pg_catalog", "pg_toast", "sys",
                "performance_schema", "mysql", "guest",
            }
            schemas = [
                s for s in raw_schemas
                if s.lower() not in system_schemas
                and not s.lower().startswith("pg_temp")
                and not s.lower().startswith("pg_toast")
            ]

            if not schemas:
                return []

            engine = self._get_engine()
            is_postgres = "postgres" in (self.uri or "").lower()

            if is_postgres:
                try:
                    stmt = text("""
                        SELECT 
                            n.nspname AS schema_name,
                            c.relname AS table_name,
                            CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END AS table_type,
                            CASE WHEN c.reltuples < 0 THEN 0 ELSE round(c.reltuples)::bigint END AS row_count_estimate
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname IN :schemas AND c.relkind IN ('r', 'p', 'v', 'm')
                        ORDER BY n.nspname, c.relname
                    """).bindparams(bindparam("schemas", expanding=True))

                    with engine.connect() as conn:
                        res = conn.execute(stmt, {"schemas": schemas})
                        rows = res.fetchall()

                    schema_map: dict[str, list[dict[str, Any]]] = {s: [] for s in schemas}
                    for r in rows:
                        s_name = r[0]
                        t_name = r[1]
                        t_type = r[2]
                        r_est = int(r[3]) if r[3] is not None else 0
                        if s_name in schema_map:
                            schema_map[s_name].append({
                                "name": t_name,
                                "type": t_type,
                                "row_count_estimate": r_est,
                            })
                    return [{"name": s, "tables": schema_map[s]} for s in schemas]
                except Exception:
                    # Fallback to generic inspector if pg_class query fails
                    pass

            is_mssql = "mssql" in (self.uri or "").lower()
            if is_mssql:
                try:
                    stmt = text("""
                        SELECT 
                            s.name AS schema_name,
                            t.name AS table_name,
                            'table' AS table_type,
                            ISNULL(SUM(p.row_count), 0) AS row_count_estimate
                        FROM sys.tables t
                        JOIN sys.schemas s ON t.schema_id = s.schema_id
                        LEFT JOIN sys.dm_db_partition_stats p 
                            ON t.object_id = p.object_id AND p.index_id IN (0, 1)
                        WHERE s.name NOT IN (
                            'sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner',
                            'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
                            'db_backupoperator', 'db_datareader', 'db_datawriter',
                            'db_denydatareader', 'db_denydatawriter'
                        )
                        GROUP BY s.name, t.name
                        UNION ALL
                        SELECT 
                            s.name AS schema_name,
                            v.name AS table_name,
                            'view' AS table_type,
                            0 AS row_count_estimate
                        FROM sys.views v
                        JOIN sys.schemas s ON v.schema_id = s.schema_id
                        WHERE s.name NOT IN (
                            'sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner',
                            'db_accessadmin', 'db_securityadmin', 'db_ddladmin',
                            'db_backupoperator', 'db_datareader', 'db_datawriter',
                            'db_denydatareader', 'db_denydatawriter'
                        )
                        ORDER BY schema_name, table_name
                    """)
                    with engine.connect() as conn:
                        res = conn.execute(stmt)
                        rows = res.fetchall()

                    schema_map: dict[str, list[dict[str, Any]]] = {}
                    for r in rows:
                        s_name = r[0]
                        t_name = r[1]
                        t_type = r[2]
                        r_est = int(r[3]) if r[3] is not None else 0
                        if s_name not in schema_map:
                            schema_map[s_name] = []
                        schema_map[s_name].append({
                            "name": t_name,
                            "type": t_type,
                            "row_count_estimate": r_est,
                        })

                    return [
                        {"name": s, "tables": schema_map[s]}
                        for s in sorted(schema_map.keys())
                        if len(schema_map[s]) > 0
                    ]
                except Exception:
                    pass

            # Generic fallback for MySQL, SQLite, MSSQL, or if PG query fails
            inspector = inspect(engine)
            inventory: list[dict[str, Any]] = []
            for s in schemas:
                resolved_s = self._resolve_schema(inspector, s)
                try:
                    t_names = inspector.get_table_names(schema=resolved_s)
                except Exception:
                    t_names = []
                try:
                    v_names = inspector.get_view_names(schema=resolved_s)
                except Exception:
                    v_names = []

                tables_list = [{"name": t, "type": "table", "row_count_estimate": None} for t in sorted(t_names)]
                views_list = [{"name": v, "type": "view", "row_count_estimate": None} for v in sorted(v_names)]
                inventory.append({"name": s, "tables": tables_list + views_list})
            return inventory
        except Exception as e:
            raise AppException(f"Failed to fetch database inventory: {str(e)}")

    def get_columns(self, table_name: str, schema_name: Optional[str] = None) -> List[ColumnMetadata]:
        try:
            engine = self._get_engine()
            inspector = inspect(engine)
            schema = self._resolve_schema(inspector, schema_name)

            columns = None
            try:
                columns = inspector.get_columns(table_name, schema=schema)
            except Exception:
                if "postgres" in (self.uri or "").lower() and schema != "public":
                    try:
                        columns = inspector.get_columns(table_name, schema="public")
                    except Exception:
                        pass
                if columns is None and schema is not None:
                    try:
                        columns = inspector.get_columns(table_name, schema=None)
                    except Exception:
                        pass

            if columns is None:
                columns = inspector.get_columns(table_name, schema=schema)

            pk_cols = set()
            try:
                pk_constraint = inspector.get_pk_constraint(table_name, schema=schema)
                if pk_constraint and "constrained_columns" in pk_constraint:
                    pk_cols = set(pk_constraint["constrained_columns"])
            except Exception:
                pass

            return [
                ColumnMetadata(
                    name=col["name"],
                    data_type=str(col["type"]),
                    nullable=col.get("nullable", True),
                    is_primary_key=bool(col.get("primary_key", False) or (col["name"] in pk_cols)),
                )
                for col in columns
            ]
        except Exception as e:
            raise AppException(f"Failed to inspect columns for table '{table_name}': {str(e)}")

    def execute_query(
        self,
        sql: str,
        limit: int = 10000,
        timeout_seconds: int = 30,
    ) -> QueryResult:
        start_time = time.time()
        try:
            engine = self._get_engine()
            with engine.connect() as conn:
                result = conn.execute(text(sql))
                columns = list(result.keys()) if result.returns_rows else []
                raw_rows = result.fetchmany(limit + 1) if result.returns_rows else []

            truncated = len(raw_rows) > limit
            rows = raw_rows[:limit]

            # Format rows for JSON serialization
            formatted_rows: List[List[Any]] = []
            for row in rows:
                formatted_row = []
                for val in row:
                    if hasattr(val, "isoformat"):
                        formatted_row.append(val.isoformat())
                    elif val is None or isinstance(val, (int, float, str, bool)):
                        formatted_row.append(val)
                    elif isinstance(val, decimal.Decimal):
                        formatted_row.append(float(val) if ("." in str(val) or "e" in str(val).lower()) else int(val))
                    else:
                        formatted_row.append(str(val))
                formatted_rows.append(formatted_row)

            duration_ms = int((time.time() - start_time) * 1000)
            return QueryResult(
                columns=columns,
                column_types=[str(type(rows[0][i]).__name__) if rows and rows[0][i] is not None else "string" for i in range(len(columns))],
                rows=formatted_rows,
                row_count=len(formatted_rows),
                duration_ms=duration_ms,
                sql=sql,
                truncated=truncated,
            )
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            raise AppException(
                f"Query execution failed: {str(e)}",
                code="QUERY_EXECUTION_ERROR",
                details={"sql": sql, "duration_ms": duration_ms},
            )
