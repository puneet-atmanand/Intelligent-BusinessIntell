"""JSON Normalization, Path Navigation, Flattening, and Schema Detection for API Connect."""
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd


def navigate_path(data: Any, path: Optional[str]) -> Any:
    """Navigate JSON payload using dot-notation (e.g., 'data.items' or 'results').

    If path is empty or None, attempts to auto-discover the main list of records.
    """
    if not path or not path.strip():
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            common_keys = ("data", "items", "results", "records", "rows", "values", "entries", "content")
            for k in common_keys:
                if k in data:
                    if isinstance(data[k], list):
                        return data[k]
                    if isinstance(data[k], dict):
                        for sub_k in common_keys:
                            if sub_k in data[k] and isinstance(data[k][sub_k], list):
                                return data[k][sub_k]
            list_values = [v for v in data.values() if isinstance(v, list)]
            if len(list_values) == 1:
                return list_values[0]
            return data
        return data

    tokens = [t.strip() for t in path.strip().split(".") if t.strip()]
    curr = data
    for token in tokens:
        if isinstance(curr, dict):
            curr = curr.get(token)
        elif isinstance(curr, list):
            if token.isdigit():
                idx = int(token)
                if 0 <= idx < len(curr):
                    curr = curr[idx]
                else:
                    curr = None
            else:
                curr = [item.get(token) for item in curr if isinstance(item, dict) and token in item]
        else:
            return None
    return curr


def sanitize_field_name(name: str) -> str:
    """Sanitize column name to valid lowercase SQL identifier."""
    if not name:
        return "column"
    clean = re.sub(r"[^a-zA-Z0-9_]+", "_", name)
    clean = re.sub(r"_+", "_", clean).strip("_").lower()
    if not clean:
        clean = "column"
    if clean[0].isdigit():
        clean = f"col_{clean}"
    reserved = frozenset({
        "table", "user", "order", "foreign", "select", "schema",
        "from", "group", "primary", "where", "database", "by"
    })
    if clean in reserved:
        clean = f"{clean}_col"
    return clean


def flatten_record(
    record: Dict[str, Any],
    prefix: str = "",
    separator: str = "_",
    max_depth: int = 4,
) -> Dict[str, Any]:
    """Recursively flatten nested dictionary objects into a single-level dictionary."""
    flat: Dict[str, Any] = {}
    if not isinstance(record, dict) or max_depth <= 0:
        return flat

    for k, v in record.items():
        field_key = f"{prefix}{separator}{k}" if prefix else str(k)
        if isinstance(v, dict):
            child_flat = flatten_record(
                v,
                prefix=field_key,
                separator=separator,
                max_depth=max_depth - 1,
            )
            flat.update(child_flat)
        elif isinstance(v, list):
            if all(isinstance(x, (str, int, float, bool)) for x in v):
                flat[field_key] = json.dumps(v)
            else:
                flat[field_key] = json.dumps(v)
        else:
            flat[field_key] = v

    return flat


def infer_duckdb_type(values: List[Any]) -> str:
    """Infer DuckDB / SQL data type from non-null sample values."""
    non_nulls = [v for v in values if v is not None and v != ""]
    if not non_nulls:
        return "VARCHAR"

    if all(isinstance(v, bool) or str(v).lower() in ("true", "false") for v in non_nulls):
        return "BOOLEAN"

    is_int = True
    try:
        for v in non_nulls:
            val_str = str(v)
            int_val = int(val_str)
            if float(val_str) != int_val:
                is_int = False
                break
        if is_int:
            return "BIGINT"
    except (ValueError, TypeError):
        is_int = False

    is_float = True
    try:
        for v in non_nulls:
            float(str(v))
        if is_float:
            return "DOUBLE"
    except (ValueError, TypeError):
        is_float = False

    is_datetime = True
    try:
        for v in non_nulls:
            val_str = str(v)
            if len(val_str) < 8 or not any(char in val_str for char in ("-", "/", ":", "T")):
                is_datetime = False
                break
            pd.to_datetime(val_str)
        if is_datetime:
            return "TIMESTAMP"
    except Exception:
        is_datetime = False

    return "VARCHAR"


def normalize_api_data(
    raw_data: Any,
    response_path: Optional[str] = None,
    flatten_nested: bool = True,
    sample_limit: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, str], pd.DataFrame]:
    """Normalize raw JSON response into a list of tabular records, column types, and DataFrame.

    Returns:
        (records, schema_types, dataframe)
    """
    extracted = navigate_path(raw_data, response_path)
    if extracted is None:
        extracted = []
    elif isinstance(extracted, dict):
        extracted = [extracted]
    elif not isinstance(extracted, list):
        extracted = [{"value": extracted}]

    if sample_limit and sample_limit > 0:
        records_to_process = extracted[:sample_limit]
    else:
        records_to_process = extracted

    flat_records: List[Dict[str, Any]] = []
    for item in records_to_process:
        if isinstance(item, dict):
            flat = flatten_record(item) if flatten_nested else item
            clean_record = {sanitize_field_name(k): v for k, v in flat.items()}
            flat_records.append(clean_record)
        else:
            flat_records.append({"value": item})

    if not flat_records:
        return [], {}, pd.DataFrame()

    df = pd.DataFrame(flat_records)

    col_mapping: Dict[str, str] = {}
    seen_cols: Dict[str, int] = {}
    for c in df.columns:
        sc = sanitize_field_name(str(c))
        if sc in seen_cols:
            seen_cols[sc] += 1
            sc = f"{sc}_{seen_cols[sc]}"
        else:
            seen_cols[sc] = 0
        col_mapping[c] = sc

    df.rename(columns=col_mapping, inplace=True)

    schema_types: Dict[str, str] = {}
    for col in df.columns:
        col_values = df[col].dropna().tolist()
        dtype = infer_duckdb_type(col_values)
        schema_types[col] = dtype

    for col, dtype in schema_types.items():
        try:
            if dtype == "BIGINT":
                df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
            elif dtype == "DOUBLE":
                df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
            elif dtype == "BOOLEAN":
                df[col] = df[col].astype("boolean")
            elif dtype == "TIMESTAMP":
                df[col] = pd.to_datetime(df[col], errors="coerce")
            else:
                df[col] = df[col].astype(str)
        except Exception:
            pass

    return df.to_dict(orient="records"), schema_types, df
