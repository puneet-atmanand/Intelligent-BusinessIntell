/**
 * Chart Builder Column & Type Utilities
 */

// Helper to determine if a column is a genuine temporal (date/time/timestamp) column
export const isTemporalColumn = (col: any): boolean => {
  if (!col) return false;
  if (col.is_datetime === true || col.is_datetime === 1) return true;
  const t = (col.data_type || "").toUpperCase();
  return (
    t.includes("DATE") ||
    t.includes("TIMESTAMP") ||
    t.includes("DATETIME") ||
    t.includes("TIMESTAMPTZ") ||
    t === "TIME"
  );
};

// Helper to determine if a column is numeric
export const isNumericColumn = (col: any): boolean => {
  if (!col) return false;
  const t = (col.data_type || "").toUpperCase();
  return (
    t.includes("INT") ||
    t.includes("DOUBLE") ||
    t.includes("FLOAT") ||
    t.includes("DECIMAL") ||
    t.includes("NUMERIC") ||
    t.includes("BIGINT") ||
    t.includes("REAL")
  );
};

// Helper to parse metric expressions and resolve the actual underlying column and aggregation
export const parseMetricExpression = (
  m: any,
  datasetColumns: any[] = []
): { column: string; agg: string } => {
  const validColNames = new Set(
    datasetColumns.map((c: any) => c.column_name || c.name).filter(Boolean)
  );

  // If m already explicitly has a valid column name
  if (m?.column && (validColNames.has(m.column) || m.column === "count")) {
    return { column: m.column, agg: m.agg || "SUM" };
  }

  const expr = (m?.expression || m?.sql_expression || "").trim();
  const name = (m?.name || m?.column || "").trim();

  // 1. Try parsing expression (e.g. "COUNT(*)", "SUM(row_count)", "COUNT(DISTINCT schema_name)", "AVG(credits)")
  if (expr) {
    if (/^COUNT\s*\(\s*(\*|1)\s*\)$/i.test(expr)) {
      return { column: "count", agg: "COUNT" };
    }
    const distMatch = expr.match(/^COUNT\s*\(\s*DISTINCT\s+["`[]?([a-zA-Z0-9_]+)["`\]]?\s*\)$/i);
    if (distMatch && distMatch[1]) {
      const col = distMatch[1];
      if (validColNames.has(col) || validColNames.size === 0) {
        return { column: col, agg: "COUNT_DISTINCT" };
      }
    }
    const aggMatch = expr.match(/^(SUM|AVG|MIN|MAX|COUNT)\s*\(\s*["`[]?([a-zA-Z0-9_]+)["`\]]?\s*\)$/i);
    if (aggMatch && aggMatch[2]) {
      const foundAgg = aggMatch[1].toUpperCase();
      const col = aggMatch[2];
      if (validColNames.has(col) || validColNames.size === 0) {
        return { column: col, agg: foundAgg };
      }
    }
  }

  // 2. Try inferring from known names/prefixes
  if (name) {
    if (name === "total_rows" && validColNames.has("row_count")) {
      return { column: "row_count", agg: "SUM" };
    }
    if (name === "total_cols" && validColNames.has("column_count")) {
      return { column: "column_count", agg: "SUM" };
    }
    if (name === "total_schemas" && validColNames.has("schema_name")) {
      return { column: "schema_name", agg: "COUNT_DISTINCT" };
    }
    if (name === "total_tables" || name === "count") {
      return { column: "count", agg: "COUNT" };
    }
    if (name.startsWith("dist_")) {
      const stripped = name.slice(5);
      if (validColNames.has(stripped)) {
        return { column: stripped, agg: "COUNT_DISTINCT" };
      }
    }
    if (name.startsWith("avg_")) {
      const stripped = name.slice(4);
      if (validColNames.has(stripped)) {
        return { column: stripped, agg: "AVG" };
      }
    }
    if (name.startsWith("sum_")) {
      const stripped = name.slice(4);
      if (validColNames.has(stripped)) {
        return { column: stripped, agg: "SUM" };
      }
    }
    if (validColNames.has(name)) {
      return { column: name, agg: m?.agg || "SUM" };
    }
  }

  // 3. Fallback: if m.column is set and is valid
  if (m?.column && validColNames.has(m.column)) {
    return { column: m.column, agg: m.agg || "SUM" };
  }

  // 4. Fallback: if there are numeric columns, use the first numeric column
  const firstNum = datasetColumns.find(isNumericColumn);
  if (firstNum) {
    return { column: firstNum.column_name || firstNum.name, agg: "SUM" };
  }

  return { column: "count", agg: "COUNT" };
};

