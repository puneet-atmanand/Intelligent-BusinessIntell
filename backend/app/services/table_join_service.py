"""Table Join Assistant Service.

Provides:
1. Primary key & foreign key metadata inspection and caching per database connection.
2. Ranked join suggestions (foreign keys, PK-to-name match, compatible name matches).
3. Secure AST-validated SQL generation for all join types (INNER, LEFT, RIGHT, FULL OUTER,
   CROSS, LEFT_ANTI, RIGHT_ANTI) with dialect emulation (e.g. MySQL FULL OUTER JOIN).
4. Safe parameterized execution of join queries with pagination and LIMIT enforcement.
5. Row-by-key lookup with parent (foreign key references) and child (incoming references) traversal.
"""
import logging
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple
from sqlalchemy import inspect, text

from app.connectors.base import BaseConnector
from app.connectors.sql_connector import SQLAlchemyConnector
from app.core.errors import AppException, NotFoundError, ValidationError
from app.query.validator import validate_and_format_sql

logger = logging.getLogger("askyourdata.table_join_service")

# In-memory cache for database keys: connection_id -> { "timestamp": float, "data": dict }
_KEYS_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes


def _find_table_info(tables_list: List[Dict[str, Any]], table_ident: str) -> Optional[Dict[str, Any]]:
    """Find table info matching 'schema.table' or bare 'table' across known schemas."""
    clean = table_ident.strip()
    parts = clean.split(".", 1)
    if len(parts) == 2:
        schema, table = parts[0].strip().lower(), parts[1].strip().lower()
        for t in tables_list:
            if t["schema"].lower() == schema and t["table"].lower() == table:
                return t
        for t in tables_list:
            if t["table"].lower() == table:
                return t
    else:
        table = parts[0].strip().lower()
        for t in tables_list:
            if t["table"].lower() == table:
                return t
    return None


def _quote_ident(ident: str, dialect: str = "postgresql") -> str:
    """Safely quote an SQL identifier according to the database dialect."""
    clean = ident.replace('"', "").replace("`", "").replace("'", "").strip()
    d = (dialect or "postgresql").lower()
    if d in ("mysql", "mariadb"):
        return f"`{clean}`"
    return f'"{clean}"'


def get_database_keys(
    connector: BaseConnector,
    connection_id: Any,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Inspect all non-system schemas and tables for primary and foreign keys.
    
    Results are cached per connection ID.
    """
    conn_key = str(connection_id)
    now = time.time()
    if not force_refresh and conn_key in _KEYS_CACHE:
        cached = _KEYS_CACHE[conn_key]
        if now - cached["timestamp"] < CACHE_TTL_SECONDS:
            return cached["data"]

    system_schemas = {
        "information_schema", "pg_catalog", "pg_toast", "sys",
        "performance_schema", "mysql", "guest",
    }

    raw_schemas = connector.get_schemas()
    schemas = [
        s for s in raw_schemas
        if s.lower() not in system_schemas
        and not s.lower().startswith("pg_temp")
        and not s.lower().startswith("pg_toast")
    ]

    engine = None
    if isinstance(connector, SQLAlchemyConnector):
        engine = connector._get_engine()
    elif hasattr(connector, "_get_engine"):
        engine = connector._get_engine()

    if engine is None:
        return {"tables": []}

    inspector = inspect(engine)
    all_known_tables: Dict[str, Set[str]] = {}
    for s in schemas:
        try:
            t_names = inspector.get_table_names(schema=s)
            v_names = inspector.get_view_names(schema=s)
            all_known_tables[s] = set(t_names + v_names)
        except Exception:
            all_known_tables[s] = set()

    tables_key_info: List[Dict[str, Any]] = []

    for s in schemas:
        for t in sorted(list(all_known_tables.get(s, []))):
            pk_cols: List[str] = []
            try:
                pk_res = inspector.get_pk_constraint(t, schema=s)
                pk_cols = pk_res.get("constrained_columns", []) or []
            except Exception as e:
                logger.debug(f"Could not get PK for {s}.{t}: {e}")

            fks_list: List[Dict[str, Any]] = []
            try:
                fks_res = inspector.get_foreign_keys(t, schema=s) or []
                for fk in fks_res:
                    ref_schema = fk.get("referred_schema")
                    ref_table = fk.get("referred_table")
                    # If referred_schema is None (common in Postgres/SQLite), resolve it
                    if not ref_schema and ref_table:
                        if "public" in all_known_tables and ref_table in all_known_tables["public"]:
                            ref_schema = "public"
                        else:
                            for cand_s, t_set in all_known_tables.items():
                                if ref_table in t_set:
                                    ref_schema = cand_s
                                    break
                        if not ref_schema:
                            ref_schema = s

                    fks_list.append({
                        "constraint_name": fk.get("name") or f"{t}_{'_'.join(fk.get('constrained_columns', []))}_fkey",
                        "columns": fk.get("constrained_columns", []),
                        "referred_schema": ref_schema or "public",
                        "referred_table": ref_table,
                        "referred_columns": fk.get("referred_columns", []),
                    })
            except Exception as e:
                logger.debug(f"Could not get FKs for {s}.{t}: {e}")

            # Also fetch column names and types for join suggestions
            columns_info: List[Dict[str, str]] = []
            try:
                cols = inspector.get_columns(t, schema=s)
                for c in cols:
                    columns_info.append({
                        "name": c["name"],
                        "data_type": str(c["type"]),
                    })
            except Exception:
                pass

            tables_key_info.append({
                "schema": s,
                "table": t,
                "primary_key": pk_cols,
                "foreign_keys": fks_list,
                "columns": columns_info,
            })

    result_data = {
        "tables": tables_key_info,
    }
    _KEYS_CACHE[conn_key] = {"timestamp": now, "data": result_data}
    return result_data


def get_join_suggestions(
    connector: BaseConnector,
    connection_id: Any,
    left: str,
    right: str,
) -> List[Dict[str, Any]]:
    """Return ranked possible join keys between left and right tables.
    
    Ranking:
    1. Declared foreign key relationships in either direction (confidence 1.0 or 0.95)
    2. Primary key to same-named column with compatible type (confidence 0.85)
    3. Same-named columns with compatible types (confidence 0.70)
    Supports composite keys.
    """
    keys_data = get_database_keys(connector, connection_id)
    tables_list = keys_data.get("tables", [])

    left_info = _find_table_info(tables_list, left)
    right_info = _find_table_info(tables_list, right)

    if not left_info or not right_info:
        return []

    left_schema, left_table = left_info["schema"], left_info["table"]
    right_schema, right_table = right_info["schema"], right_info["table"]

    suggestions: List[Dict[str, Any]] = []
    seen_pairs: Set[Tuple[Tuple[str, ...], Tuple[str, ...]]] = set()

    # (a) Declared FK relationships: Left -> Right
    for fk in left_info.get("foreign_keys", []):
        if (
            fk.get("referred_schema", "").lower() == right_schema.lower()
            and fk.get("referred_table", "").lower() == right_table.lower()
        ):
            left_cols = fk.get("columns", [])
            right_cols = fk.get("referred_columns", [])
            pair_key = (tuple(left_cols), tuple(right_cols))
            if pair_key not in seen_pairs:
                seen_pairs.add(pair_key)
                desc = (
                    f"{left_schema}.{left_table}.{','.join(left_cols)} -> "
                    f"{right_schema}.{right_table}.{','.join(right_cols)} (foreign key)"
                )
                suggestions.append({
                    "left_columns": left_cols,
                    "right_columns": right_cols,
                    "source": "foreign_key",
                    "confidence": 1.0,
                    "description": desc,
                })

    # (a2) Declared FK relationships: Right -> Left
    for fk in right_info.get("foreign_keys", []):
        if (
            fk.get("referred_schema", "").lower() == left_schema.lower()
            and fk.get("referred_table", "").lower() == left_table.lower()
        ):
            left_cols = fk.get("referred_columns", [])
            right_cols = fk.get("columns", [])
            pair_key = (tuple(left_cols), tuple(right_cols))
            if pair_key not in seen_pairs:
                seen_pairs.add(pair_key)
                desc = (
                    f"{right_schema}.{right_table}.{','.join(right_cols)} -> "
                    f"{left_schema}.{left_table}.{','.join(left_cols)} (foreign key)"
                )
                suggestions.append({
                    "left_columns": left_cols,
                    "right_columns": right_cols,
                    "source": "foreign_key",
                    "confidence": 0.95,
                    "description": desc,
                })

    left_cols_dict = {c["name"].lower(): c for c in left_info.get("columns", [])}
    right_cols_dict = {c["name"].lower(): c for c in right_info.get("columns", [])}

    left_pk = set(c.lower() for c in left_info.get("primary_key", []))
    right_pk = set(c.lower() for c in right_info.get("primary_key", []))

    # (b) PK to same-named column
    for pk_c in left_pk:
        if pk_c in right_cols_dict:
            orig_left_name = next(c["name"] for c in left_info["columns"] if c["name"].lower() == pk_c)
            orig_right_name = right_cols_dict[pk_c]["name"]
            pair_key = ((orig_left_name,), (orig_right_name,))
            if pair_key not in seen_pairs:
                seen_pairs.add(pair_key)
                suggestions.append({
                    "left_columns": [orig_left_name],
                    "right_columns": [orig_right_name],
                    "source": "name_match",
                    "confidence": 0.85,
                    "description": f"{left_schema}.{left_table}.{orig_left_name} (PK) matches {right_schema}.{right_table}.{orig_right_name} (name match)",
                })

    for pk_c in right_pk:
        if pk_c in left_cols_dict:
            orig_right_name = next(c["name"] for c in right_info["columns"] if c["name"].lower() == pk_c)
            orig_left_name = left_cols_dict[pk_c]["name"]
            pair_key = ((orig_left_name,), (orig_right_name,))
            if pair_key not in seen_pairs:
                seen_pairs.add(pair_key)
                suggestions.append({
                    "left_columns": [orig_left_name],
                    "right_columns": [orig_right_name],
                    "source": "name_match",
                    "confidence": 0.85,
                    "description": f"{right_schema}.{right_table}.{orig_right_name} (PK) matches {left_schema}.{left_table}.{orig_left_name} (name match)",
                })

    # (c) Common same-named columns (non-PK)
    for col_name_lower, left_col in left_cols_dict.items():
        if col_name_lower in right_cols_dict:
            orig_left_name = left_col["name"]
            orig_right_name = right_cols_dict[col_name_lower]["name"]
            pair_key = ((orig_left_name,), (orig_right_name,))
            if pair_key not in seen_pairs:
                seen_pairs.add(pair_key)
                suggestions.append({
                    "left_columns": [orig_left_name],
                    "right_columns": [orig_right_name],
                    "source": "name_match",
                    "confidence": 0.70,
                    "description": f"{orig_left_name} = {orig_right_name} (name match)",
                })

    # Sort descending by confidence
    suggestions.sort(key=lambda s: s["confidence"], reverse=True)
    return suggestions


def build_join_sql(
    connector: BaseConnector,
    connection_id: Any,
    left: str,
    right: str,
    join_type: str = "INNER",
    conditions: Optional[List[Dict[str, str]]] = None,
    columns: Optional[List[Dict[str, str]]] = None,
    select_all: bool = False,
    where: Optional[str] = None,
    limit: Optional[int] = 100,
    offset: Optional[int] = 0,
    dialect: str = "postgresql",
    include_limit: bool = True,
) -> Dict[str, Any]:
    """Build, validate and format SQL text for joining two tables across schemas."""
    keys_data = get_database_keys(connector, connection_id)
    tables_list = keys_data.get("tables", [])

    left_info = _find_table_info(tables_list, left)
    if not left_info:
        raise ValidationError(f"Left table '{left}' does not exist in database connection.")

    right_info = _find_table_info(tables_list, right)
    if not right_info:
        raise ValidationError(f"Right table '{right}' does not exist in database connection.")

    left_schema, left_table = left_info["schema"], left_info["table"]
    right_schema, right_table = right_info["schema"], right_info["table"]

    left_col_names = {c["name"].lower(): c["name"] for c in left_info.get("columns", [])}
    right_col_names = {c["name"].lower(): c["name"] for c in right_info.get("columns", [])}

    normalized_join = join_type.strip().upper().replace("_", " ")
    valid_joins = {
        "INNER", "INNER JOIN",
        "LEFT", "LEFT JOIN",
        "RIGHT", "RIGHT JOIN",
        "FULL OUTER", "FULL OUTER JOIN", "FULL", "FULL JOIN",
        "CROSS", "CROSS JOIN",
        "LEFT ANTI", "LEFT ANTI JOIN",
        "RIGHT ANTI", "RIGHT ANTI JOIN",
    }
    if normalized_join not in valid_joins:
        raise ValidationError(f"Invalid join type '{join_type}'. Must be one of INNER, LEFT, RIGHT, FULL OUTER, CROSS, LEFT_ANTI, RIGHT_ANTI.")

    # Validate condition columns exist in respective tables
    cond_list = conditions or []
    if normalized_join not in ("CROSS", "CROSS JOIN") and not cond_list:
        # Fall back to best join suggestion if no condition given
        suggestions = get_join_suggestions(connector, connection_id, left, right)
        if suggestions:
            best = suggestions[0]
            cond_list = [{"left_col": lc, "right_col": rc} for lc, rc in zip(best["left_columns"], best["right_columns"])]
        else:
            raise ValidationError(f"No join condition specified and no automatic relationship found between '{left}' and '{right}'.")

    validated_conds: List[Tuple[str, str]] = []
    for cond in cond_list:
        l_col = cond.get("left_col", "").strip()
        r_col = cond.get("right_col", "").strip()
        if l_col.lower() not in left_col_names:
            raise ValidationError(f"Column '{l_col}' not found in left table '{left}'.")
        if r_col.lower() not in right_col_names:
            raise ValidationError(f"Column '{r_col}' not found in right table '{right}'.")
        validated_conds.append((left_col_names[l_col.lower()], right_col_names[r_col.lower()]))

    # Enforce safe limits
    safe_limit = max(1, min(limit or 100, 10000))
    if normalized_join in ("CROSS", "CROSS JOIN"):
        # Strictly cap Cartesian cross joins to avoid crashes
        safe_limit = min(safe_limit, 1000)
    safe_offset = max(0, offset or 0)

    # Column selection building
    t1_quoted = f"{_quote_ident(left_schema, dialect)}.{_quote_ident(left_table, dialect)}"
    t2_quoted = f"{_quote_ident(right_schema, dialect)}.{_quote_ident(right_table, dialect)}"

    select_items: List[str] = []
    if columns:
        for c in columns:
            tbl_alias = c.get("table", "t1").strip().lower()
            c_name = c.get("column", "").strip()
            alias = c.get("alias", "").strip()
            if tbl_alias == "t1":
                if c_name.lower() not in left_col_names:
                    raise ValidationError(f"Column '{c_name}' not found in left table '{left}'.")
                col_real = left_col_names[c_name.lower()]
            elif tbl_alias == "t2":
                if c_name.lower() not in right_col_names:
                    raise ValidationError(f"Column '{c_name}' not found in right table '{right}'.")
                col_real = right_col_names[c_name.lower()]
            else:
                raise ValidationError(f"Invalid table alias '{tbl_alias}'. Must be 't1' or 't2'.")

            quoted_target = f"{tbl_alias}.{_quote_ident(col_real, dialect)}"
            if alias:
                select_items.append(f"{quoted_target} AS {_quote_ident(alias, dialect)}")
            else:
                select_items.append(quoted_target)
    elif select_all:
        select_items = ["t1.*", "t2.*"]
    else:
        # Default: avoid column collisions by prefixing table alias
        for c in left_info.get("columns", []):
            select_items.append(f"t1.{_quote_ident(c['name'], dialect)} AS {_quote_ident(f't1_{c['name']}', dialect)}")
        for c in right_info.get("columns", []):
            select_items.append(f"t2.{_quote_ident(c['name'], dialect)} AS {_quote_ident(f't2_{c['name']}', dialect)}")

    select_clause = ", ".join(select_items) if select_items else "t1.*, t2.*"

    on_clauses = [
        f"t1.{_quote_ident(lc, dialect)} = t2.{_quote_ident(rc, dialect)}"
        for lc, rc in validated_conds
    ]
    on_clause = " AND ".join(on_clauses) if on_clauses else "1 = 1"

    is_emulated = False
    notes: Optional[str] = None
    generated_sql = ""

    d_lower = dialect.lower()

    limit_clause = f" LIMIT {safe_limit} OFFSET {safe_offset}" if include_limit else ""

    if normalized_join in ("CROSS", "CROSS JOIN"):
        generated_sql = f"SELECT {select_clause} FROM {t1_quoted} AS t1 CROSS JOIN {t2_quoted} AS t2"
        if where and where.strip():
            generated_sql += f" WHERE ({where.strip()})"
        generated_sql += limit_clause

    elif normalized_join in ("LEFT ANTI", "LEFT ANTI JOIN"):
        # Rows in t1 with no matching row in t2
        null_col = validated_conds[0][1] if validated_conds else (right_info.get("primary_key") or ["id"])[0]
        generated_sql = (
            f"SELECT {select_clause} FROM {t1_quoted} AS t1 "
            f"LEFT JOIN {t2_quoted} AS t2 ON {on_clause} "
            f"WHERE t2.{_quote_ident(null_col, dialect)} IS NULL"
        )
        if where and where.strip():
            generated_sql += f" AND ({where.strip()})"
        generated_sql += limit_clause
        is_emulated = True
        notes = "LEFT ANTI join emulated using LEFT JOIN ... WHERE t2.<key> IS NULL"

    elif normalized_join in ("RIGHT ANTI", "RIGHT ANTI JOIN"):
        # Rows in t2 with no matching row in t1
        null_col = validated_conds[0][0] if validated_conds else (left_info.get("primary_key") or ["id"])[0]
        generated_sql = (
            f"SELECT {select_clause} FROM {t1_quoted} AS t1 "
            f"RIGHT JOIN {t2_quoted} AS t2 ON {on_clause} "
            f"WHERE t1.{_quote_ident(null_col, dialect)} IS NULL"
        )
        if where and where.strip():
            generated_sql += f" AND ({where.strip()})"
        generated_sql += limit_clause
        is_emulated = True
        notes = "RIGHT ANTI join emulated using RIGHT JOIN ... WHERE t1.<key> IS NULL"

    elif normalized_join in ("FULL OUTER", "FULL OUTER JOIN", "FULL", "FULL JOIN") and d_lower in ("mysql", "mariadb"):
        # MySQL does not support FULL OUTER JOIN natively; emulate with LEFT JOIN UNION RIGHT JOIN
        null_col = validated_conds[0][0] if validated_conds else (left_info.get("primary_key") or ["id"])[0]
        q1 = f"SELECT {select_clause} FROM {t1_quoted} AS t1 LEFT JOIN {t2_quoted} AS t2 ON {on_clause}"
        q2 = f"SELECT {select_clause} FROM {t1_quoted} AS t1 RIGHT JOIN {t2_quoted} AS t2 ON {on_clause} WHERE t1.{_quote_ident(null_col, dialect)} IS NULL"
        generated_sql = f"({q1}) UNION ALL ({q2}){limit_clause}"
        is_emulated = True
        notes = "FULL OUTER JOIN is unsupported in MySQL/MariaDB; emulated using (LEFT JOIN) UNION ALL (RIGHT JOIN WHERE t1.<key> IS NULL)"

    else:
        # Standard INNER, LEFT, RIGHT, or native FULL OUTER JOIN
        sql_join_kw = "INNER JOIN"
        if "LEFT" in normalized_join:
            sql_join_kw = "LEFT JOIN"
        elif "RIGHT" in normalized_join:
            sql_join_kw = "RIGHT JOIN"
        elif "FULL" in normalized_join:
            sql_join_kw = "FULL OUTER JOIN"

        generated_sql = f"SELECT {select_clause} FROM {t1_quoted} AS t1 {sql_join_kw} {t2_quoted} AS t2 ON {on_clause}"
        if where and where.strip():
            generated_sql += f" WHERE ({where.strip()})"
        generated_sql += limit_clause

    # Enforce AST safety guardrails
    safe_sql = validate_and_format_sql(
        raw_sql=generated_sql,
        dialect=dialect,
        allow_dml=False,
        row_limit=safe_limit if include_limit else None,
    )

    return {
        "sql": safe_sql,
        "dialect": dialect,
        "is_emulated": is_emulated,
        "notes": notes,
    }


def execute_join_query(
    connector: BaseConnector,
    connection_id: Any,
    left: str,
    right: str,
    join_type: str = "INNER",
    conditions: Optional[List[Dict[str, str]]] = None,
    columns: Optional[List[Dict[str, str]]] = None,
    select_all: bool = False,
    where: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    custom_sql: Optional[str] = None,
    dialect: str = "postgresql",
) -> Dict[str, Any]:
    """Execute a validated table join query and return standard paginated result structure."""
    if custom_sql and custom_sql.strip():
        sql_to_run = validate_and_format_sql(
            raw_sql=custom_sql,
            dialect=dialect,
            allow_dml=False,
            row_limit=limit or 100,
        )
    else:
        sql_dict = build_join_sql(
            connector=connector,
            connection_id=connection_id,
            left=left,
            right=right,
            join_type=join_type,
            conditions=conditions,
            columns=columns,
            select_all=select_all,
            where=where,
            limit=limit,
            offset=offset,
            dialect=dialect,
        )
        sql_to_run = sql_dict["sql"]

    # Execute query through connector (read-only, with timeout)
    query_result = connector.execute_query(sql_to_run, limit=limit or 100)

    return {
        "columns": query_result.columns,
        "column_types": query_result.column_types,
        "rows": query_result.rows,
        "row_count": query_result.row_count,
        "limit": limit or 100,
        "offset": offset or 0,
        "is_truncated": query_result.truncated,
        "execution_duration_ms": query_result.duration_ms,
        "sql": sql_to_run,
    }


def get_rows_by_key(
    connector: BaseConnector,
    connection_id: Any,
    table: str,
    key_col: str,
    key_value: Any,
) -> Dict[str, Any]:
    """Fetch single row for a key and its referenced parent & child rows using parameterized queries."""
    keys_data = get_database_keys(connector, connection_id)
    tables_list = keys_data.get("tables", [])

    table_info = _find_table_info(tables_list, table)
    if not table_info:
        raise NotFoundError(f"Table '{table}' not found in database.")

    schema, table_name = table_info["schema"], table_info["table"]

    table_cols = {c["name"].lower(): c["name"] for c in table_info.get("columns", [])}

    # Support composite keys: split comma-separated key_col and key_value
    col_names_raw = [c.strip() for c in str(key_col).split(",") if c.strip()]
    if isinstance(key_value, (list, tuple)):
        val_list = list(key_value)
    else:
        val_list = [v.strip() for v in str(key_value).split(",") if v.strip()]

    # If key_col is missing or not in table_cols, fallback to table's declared primary key
    if not col_names_raw or not all(c.lower() in table_cols for c in col_names_raw):
        pk_cols = table_info.get("primary_key") or []
        if pk_cols and len(pk_cols) == len(val_list):
            col_names_raw = pk_cols

    if len(col_names_raw) != len(val_list):
        raise ValidationError("Number of key columns does not match number of key values provided.")

    real_key_cols: List[str] = []
    param_dict: Dict[str, Any] = {}
    where_parts: List[str] = []

    for idx, raw_c in enumerate(col_names_raw):
        if raw_c.lower() not in table_cols:
            raise ValidationError(f"Key column '{raw_c}' does not exist in table '{table}'.")
        real_c = table_cols[raw_c.lower()]
        real_key_cols.append(real_c)
        param_name = f"p_key_{idx}"
        param_dict[param_name] = val_list[idx]
        where_parts.append(f'"{real_c}" = :{param_name}')

    where_sql = " AND ".join(where_parts)
    target_table_sql = f'"{schema}"."{table_name}"'

    engine = None
    if isinstance(connector, SQLAlchemyConnector):
        engine = connector._get_engine()
    elif hasattr(connector, "_get_engine"):
        engine = connector._get_engine()

    if not engine:
        raise AppException("Could not acquire database engine for connection.")

    # 1. Fetch target row
    query_target = text(f"SELECT * FROM {target_table_sql} WHERE {where_sql} LIMIT 1")
    row_dict: Optional[Dict[str, Any]] = None
    with engine.connect() as db_conn:
        res = db_conn.execute(query_target, param_dict)
        mapping_row = res.mappings().first()
        if mapping_row:
            row_dict = {}
            for k, v in mapping_row.items():
                if hasattr(v, "isoformat"):
                    row_dict[k] = v.isoformat()
                elif hasattr(v, "__float__") and not isinstance(v, (int, float, bool)):
                    row_dict[k] = float(v)
                else:
                    row_dict[k] = v

    if not row_dict:
        return {
            "table": f"{schema}.{table_name}",
            "key_columns": real_key_cols,
            "key_values": val_list,
            "row": None,
            "columns": list(table_cols.values()),
            "parents": [],
            "children": [],
        }

    # 2. Fetch parent rows (tables referenced by this table's foreign keys)
    parents_result: List[Dict[str, Any]] = []
    with engine.connect() as db_conn:
        for fk in table_info.get("foreign_keys", []):
            ref_schema = fk["referred_schema"]
            ref_table = fk["referred_table"]
            fk_cols = fk["columns"]
            ref_cols = fk["referred_columns"]

            # Check if all fk_cols have non-null values in row_dict
            if all(row_dict.get(c) is not None for c in fk_cols):
                parent_params = {}
                parent_where_parts = []
                for p_idx, (fc, rc) in enumerate(zip(fk_cols, ref_cols)):
                    p_name = f"pfk_{p_idx}"
                    parent_params[p_name] = row_dict[fc]
                    parent_where_parts.append(f'"{rc}" = :{p_name}')

                parent_where = " AND ".join(parent_where_parts)
                parent_q = text(f'SELECT * FROM "{ref_schema}"."{ref_table}" WHERE {parent_where} LIMIT 1')
                p_res = db_conn.execute(parent_q, parent_params).mappings().first()
                p_row_dict = None
                if p_res:
                    p_row_dict = {}
                    for k, v in p_res.items():
                        if hasattr(v, "isoformat"):
                            p_row_dict[k] = v.isoformat()
                        elif hasattr(v, "__float__") and not isinstance(v, (int, float, bool)):
                            p_row_dict[k] = float(v)
                        else:
                            p_row_dict[k] = v

                parents_result.append({
                    "constraint_name": fk["constraint_name"],
                    "parent_table": f"{ref_schema}.{ref_table}",
                    "fk_columns": fk_cols,
                    "referred_columns": ref_cols,
                    "row": p_row_dict,
                })

    # 3. Fetch child rows (tables that reference this table)
    children_result: List[Dict[str, Any]] = []
    with engine.connect() as db_conn:
        for cand_t in tables_list:
            c_schema = cand_t["schema"]
            c_table = cand_t["table"]
            for fk in cand_t.get("foreign_keys", []):
                if (
                    fk.get("referred_schema", "").lower() == schema.lower()
                    and fk.get("referred_table", "").lower() == table_name.lower()
                ):
                    fk_cols = fk["columns"]
                    ref_cols = fk["referred_columns"]

                    if all(row_dict.get(rc) is not None for rc in ref_cols):
                        c_params = {}
                        c_where_parts = []
                        for c_idx, (fc, rc) in enumerate(zip(fk_cols, ref_cols)):
                            c_pname = f"cfk_{c_idx}"
                            c_params[c_pname] = row_dict[rc]
                            c_where_parts.append(f'"{fc}" = :{c_pname}')

                        c_where = " AND ".join(c_where_parts)
                        # Count total child records
                        count_q = text(f'SELECT COUNT(*) FROM "{c_schema}"."{c_table}" WHERE {c_where}')
                        c_count = db_conn.execute(count_q, c_params).scalar() or 0

                        # Fetch sample child records (first 50)
                        sample_q = text(f'SELECT * FROM "{c_schema}"."{c_table}" WHERE {c_where} LIMIT 50')
                        sample_res = db_conn.execute(sample_q, c_params)
                        c_columns = list(sample_res.keys()) if sample_res.returns_rows else []
                        c_rows: List[List[Any]] = []
                        for r in sample_res.fetchall():
                            formatted = []
                            for val in r:
                                if hasattr(val, "isoformat"):
                                    formatted.append(val.isoformat())
                                elif hasattr(val, "__float__") and not isinstance(val, (int, float, bool)):
                                    formatted.append(float(val))
                                else:
                                    formatted.append(val)
                            c_rows.append(formatted)

                        children_result.append({
                            "child_table": f"{c_schema}.{c_table}",
                            "fk_columns": fk_cols,
                            "referred_columns": ref_cols,
                            "count": int(c_count),
                            "columns": c_columns,
                            "rows": c_rows,
                        })

    return {
        "table": f"{schema}.{table_name}",
        "key_columns": real_key_cols,
        "key_values": val_list,
        "row": row_dict,
        "columns": list(table_cols.values()),
        "parents": parents_result,
        "children": children_result,
    }
