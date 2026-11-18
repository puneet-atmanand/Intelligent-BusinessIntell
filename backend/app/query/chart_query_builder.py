"""Chart Query Builder (ADR-003 and Phase 2).

Constructs safe SQL queries for charts from semantic datasets, dimensions,
metrics, time grains, ad-hoc filters, and limits without raw string concatenation.
"""
import re
import logging
from typing import Any, Dict, List, Optional
import sqlglot
from sqlglot import exp

from app.core.errors import AppException, ValidationError
from app.db.models import Dataset, DatasetMetric
from app.query.validator import validate_and_format_sql

logger = logging.getLogger("askyourdata.query_builder")


TIME_GRAIN_MAP = {
    "hour": "hour",
    "day": "day",
    "week": "week",
    "month": "month",
    "quarter": "quarter",
    "year": "year",
}


RESERVED_KEYWORDS = {
    "select", "from", "where", "group", "order", "by", "limit", "as", "join",
    "on", "in", "is", "not", "null", "and", "or", "case", "when", "then",
    "else", "end", "table", "user", "primary", "foreign", "key", "check"
}


def quote_identifier(ident: str) -> str:
    """Safely quote a SQL identifier (column/table) only when needed."""
    cleaned = ident.strip()
    if not cleaned or cleaned == "*":
        return cleaned
    if cleaned.startswith('"') and cleaned.endswith('"'):
        return cleaned
    if "(" in cleaned or " " in cleaned and any(kw in cleaned.upper() for kw in ("AS ", "OVER ", "CASE ", "THEN ", "ELSE ", "END")):
        # It's an expression or complex clause, do not quote
        return cleaned
    if "." in cleaned:
        parts = cleaned.split(".")
        return ".".join(quote_identifier(p) for p in parts)
    # If it's a standard alphanumeric identifier and not a reserved keyword, leave unquoted
    if re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", cleaned) and cleaned.lower() not in RESERVED_KEYWORDS:
        return cleaned
    safe = cleaned.replace('"', '""')
    return f'"{safe}"'


def build_chart_sql(
    dataset: Dataset,
    dimensions: List[str],
    metrics: List[Dict[str, Any]],
    filters: Optional[List[Dict[str, Any]]] = None,
    time_column: Optional[str] = None,
    time_grain: Optional[str] = None,
    time_range: Optional[Dict[str, str]] = None,
    order_by: Optional[List[Dict[str, str]]] = None,
    row_limit: int = 1000,
    dialect: str = "duckdb",
) -> str:
    """Build a validated SELECT query for chart visualizations with column validation."""
    source_table = dataset.table_name or "data_source"

    # If dataset is virtual (saved SQL expression), wrap in subquery
    if dataset.is_virtual and dataset.sql_expression:
        from_clause = f"({dataset.sql_expression}) AS virtual_source"
    else:
        schema_prefix = f"{quote_identifier(dataset.schema_name)}." if dataset.schema_name else ""
        from_clause = f"{schema_prefix}{quote_identifier(source_table)}"

    col_lookup: Dict[str, str] = {c.name.lower(): c.name for c in (dataset.columns or [])}
    predefined_metrics_map: Dict[str, str] = {
        (m.name or "").lower(): m.sql_expression for m in (dataset.metrics or []) if m.sql_expression
    }

    select_items: List[str] = []
    group_by_items: List[str] = []

    # 1. Handle Time Dimension with grain
    if time_column and time_grain:
        norm_grain = TIME_GRAIN_MAP.get(time_grain.lower(), "day")
        time_col_name = col_lookup.get(time_column.lower(), time_column)
        time_col_quoted = quote_identifier(time_col_name)
        clean_time_alias = re.sub(r"[^a-zA-Z0-9_]+", "_", str(time_col_name)).strip("_").lower() or "time_col"
        alias = f"{clean_time_alias}_{norm_grain}"
        time_expr = f"date_trunc('{norm_grain}', {time_col_quoted}) AS {quote_identifier(alias)}"
        select_items.append(time_expr)
        group_by_items.append(quote_identifier(alias))
    elif time_column:
        time_col_name = col_lookup.get(time_column.lower(), time_column)
        time_col_quoted = quote_identifier(time_col_name)
        select_items.append(time_col_quoted)
        group_by_items.append(time_col_quoted)

    # 2. Add regular dimensions (validating against dataset schema)
    for dim in dimensions:
        if not dim or not str(dim).strip():
            continue
        clean_dim = str(dim).strip()
        if col_lookup:
            if clean_dim.lower() in col_lookup:
                actual_dim = col_lookup[clean_dim.lower()]
            else:
                logger.warning("Dimension '%s' not found in dataset '%s' schema. Skipping to prevent binder error.", clean_dim, dataset.name)
                continue
        else:
            actual_dim = clean_dim

        dim_quoted = quote_identifier(actual_dim)
        if dim_quoted not in select_items and actual_dim not in select_items:
            select_items.append(dim_quoted)
            group_by_items.append(dim_quoted)

    # 3. Add metrics (aggregations)
    resolved_metric_aliases: List[str] = []
    for m in (metrics or []):
        if not isinstance(m, dict):
            continue

        raw_col = m.get("column")
        raw_agg = (m.get("agg") or "").upper()
        raw_expr = (m.get("expression") or m.get("sql_expression") or "").strip()
        raw_name = m.get("name") or m.get("label") or "metric"

        clean_alias = re.sub(r"[^a-zA-Z0-9_]+", "_", str(raw_name)).strip("_").lower() or "metric"

        # Check if Count of Rows
        if raw_col == "count" or raw_name == "count" or "COUNT(*)" in raw_expr.upper():
            select_items.append(f"COUNT(*) AS {quote_identifier(clean_alias or 'count')}")
            resolved_metric_aliases.append(clean_alias or "count")
            continue

        # Check predefined semantic layer metric
        if raw_name.lower() in predefined_metrics_map:
            sql_expr = predefined_metrics_map[raw_name.lower()]
            select_items.append(f"{sql_expr} AS {quote_identifier(clean_alias)}")
            resolved_metric_aliases.append(clean_alias)
            continue

        # Resolve physical column name
        physical_col: Optional[str] = None
        detected_agg = raw_agg or "SUM"

        # 3a. Check raw_col against col_lookup
        if raw_col and col_lookup:
            if raw_col.lower() in col_lookup:
                physical_col = col_lookup[raw_col.lower()]
            else:
                for pfx in ("avg_", "sum_", "min_", "max_", "count_distinct_", "count_"):
                    if raw_col.lower().startswith(pfx):
                        rem = raw_col.lower()[len(pfx):]
                        if rem in col_lookup:
                            physical_col = col_lookup[rem]
                            if not raw_agg:
                                detected_agg = "COUNT_DISTINCT" if pfx == "count_distinct_" else pfx.rstrip("_").upper()
                            break

        # 3b. Check raw_expr if column not yet resolved
        if not physical_col and raw_expr:
            match = re.search(r"\b(AVG|SUM|MIN|MAX|COUNT)\s*\(\s*(?:DISTINCT\s+)?[\"']?([a-zA-Z0-9_]+)[\"']?\s*\)", raw_expr, re.I)
            if match:
                fn_name = match.group(1).upper()
                col_in_expr = match.group(2)
                if "DISTINCT" in raw_expr.upper():
                    detected_agg = "COUNT_DISTINCT"
                elif not raw_agg:
                    detected_agg = fn_name

                if col_lookup:
                    if col_in_expr.lower() in col_lookup:
                        physical_col = col_lookup[col_in_expr.lower()]
                    else:
                        for pfx in ("avg_", "sum_", "min_", "max_", "count_"):
                            if col_in_expr.lower().startswith(pfx):
                                rem = col_in_expr.lower()[len(pfx):]
                                if rem in col_lookup:
                                    physical_col = col_lookup[rem]
                                    if not raw_agg:
                                        detected_agg = pfx.rstrip("_").upper()
                                    break
                else:
                    physical_col = col_in_expr

        # 3c. Check raw_name if column not yet resolved
        if not physical_col and col_lookup:
            if raw_name.lower() in col_lookup:
                physical_col = col_lookup[raw_name.lower()]
            else:
                for pfx in ("avg_", "sum_", "min_", "max_", "count_"):
                    if raw_name.lower().startswith(pfx):
                        rem = raw_name.lower()[len(pfx):]
                        if rem in col_lookup:
                            physical_col = col_lookup[rem]
                            if not raw_agg:
                                detected_agg = pfx.rstrip("_").upper()
                            break

        if physical_col:
            if detected_agg == "COUNT_DISTINCT":
                final_expr = f"COUNT(DISTINCT {quote_identifier(physical_col)})"
            elif detected_agg in ("AVG", "SUM", "MIN", "MAX", "COUNT"):
                final_expr = f"{detected_agg}({quote_identifier(physical_col)})"
            else:
                final_expr = f"SUM({quote_identifier(physical_col)})"

            if clean_alias == "metric":
                clean_alias = f"{detected_agg.lower()}_{physical_col}"

            select_items.append(f"{final_expr} AS {quote_identifier(clean_alias)}")
            resolved_metric_aliases.append(clean_alias)
        elif raw_expr:
            select_items.append(f"{raw_expr} AS {quote_identifier(clean_alias)}")
            resolved_metric_aliases.append(clean_alias)
        elif col_lookup:
            invalid_ref = raw_col or raw_name
            avail = ", ".join(list(col_lookup.values())[:10])
            raise ValidationError(
                f"Metric '{raw_name}' references column '{invalid_ref}' which does not exist in dataset '{dataset.name}'. "
                f"Available columns: {avail}."
            )

    # Fallback if no select items
    if not select_items:
        select_items.append("*")

    # 4. Build WHERE clauses from filters
    where_clauses: List[str] = []

    # Time range filter
    if time_column and time_range:
        time_col_name = col_lookup.get(time_column.lower(), time_column) if col_lookup else time_column
        time_col_quoted = quote_identifier(time_col_name)
        start_date = time_range.get("start")
        end_date = time_range.get("end")
        if start_date:
            where_clauses.append(f"{time_col_quoted} >= '{start_date}'")
        if end_date:
            where_clauses.append(f"{time_col_quoted} <= '{end_date}'")

    # Ad-hoc filters
    if filters:
        for f in filters:
            col = f.get("col")
            op = (f.get("op") or "==").strip()
            val = f.get("val")

            if not col:
                continue

            actual_filter_col = col_lookup.get(col.lower(), col) if col_lookup else col
            col_quoted = quote_identifier(actual_filter_col)

            if op in ("==", "="):
                if isinstance(val, (int, float)):
                    where_clauses.append(f"{col_quoted} = {val}")
                else:
                    where_clauses.append(f"{col_quoted} = '{val}'")
            elif op == "!=":
                if isinstance(val, (int, float)):
                    where_clauses.append(f"{col_quoted} != {val}")
                else:
                    where_clauses.append(f"{col_quoted} != '{val}'")
            elif op in (">", ">=", "<", "<="):
                where_clauses.append(f"{col_quoted} {op} {val}")
            elif op.upper() == "IN" and isinstance(val, list):
                val_list = ", ".join(f"'{v}'" if isinstance(v, str) else str(v) for v in val)
                where_clauses.append(f"{col_quoted} IN ({val_list})")
            elif op.upper() == "NOT IN" and isinstance(val, list):
                val_list = ", ".join(f"'{v}'" if isinstance(v, str) else str(v) for v in val)
                where_clauses.append(f"{col_quoted} NOT IN ({val_list})")
            elif op.upper() == "LIKE":
                where_clauses.append(f"{col_quoted} LIKE '{val}'")
            elif op.upper() == "IS NULL":
                where_clauses.append(f"{col_quoted} IS NULL")
            elif op.upper() == "IS NOT NULL":
                where_clauses.append(f"{col_quoted} IS NOT NULL")

    # 5. Assemble SQL string
    query_parts = [f"SELECT {', '.join(select_items)}", f"FROM {from_clause}"]

    if where_clauses:
        query_parts.append(f"WHERE {' AND '.join(where_clauses)}")

    if group_by_items and resolved_metric_aliases:
        query_parts.append(f"GROUP BY {', '.join(group_by_items)}")

    # 6. ORDER BY
    if order_by:
        order_clauses = [
            f"{quote_identifier(col_lookup.get(o.get('col', '1').lower(), o.get('col', '1'))) if not o.get('col', '1').isdigit() else o.get('col', '1')} {o.get('direction', 'ASC').upper()}"
            for o in order_by
            if o.get("col")
        ]
        if order_clauses:
            query_parts.append(f"ORDER BY {', '.join(order_clauses)}")
    elif resolved_metric_aliases:
        first_alias = resolved_metric_aliases[0]
        query_parts.append(f"ORDER BY {quote_identifier(first_alias)} DESC")

    raw_sql = " ".join(query_parts)

    # 7. Validate and format through AST guardrail
    safe_sql = validate_and_format_sql(
        raw_sql=raw_sql,
        dialect=dialect,
        allow_dml=False,
        row_limit=row_limit,
    )
    return safe_sql

