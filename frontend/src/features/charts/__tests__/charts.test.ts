import { describe, it, expect } from "vitest";
import { isTemporalColumn, isNumericColumn, parseMetricExpression } from "../utils";

describe("Chart Builder Column Validation", () => {
  it("strictly validates temporal date/time columns and excludes numeric/incompatible columns", () => {
    // job_rate (DOUBLE) MUST NOT be considered temporal
    expect(isTemporalColumn({ name: "job_rate", data_type: "DOUBLE", is_datetime: false })).toBe(false);
    expect(isTemporalColumn({ name: "annual_salary", data_type: "BIGINT", is_datetime: false })).toBe(false);
    expect(isTemporalColumn({ name: "years", data_type: "BIGINT", is_datetime: false })).toBe(false);
    expect(isTemporalColumn({ name: "department", data_type: "VARCHAR", is_datetime: false })).toBe(false);

    // start_date (TIMESTAMP) MUST be recognized as temporal
    expect(isTemporalColumn({ name: "start_date", data_type: "TIMESTAMP", is_datetime: true })).toBe(true);
    expect(isTemporalColumn({ name: "order_date", data_type: "DATE", is_datetime: false })).toBe(true);
    expect(isTemporalColumn({ name: "created_at", data_type: "TIMESTAMPTZ", is_datetime: false })).toBe(true);
  });

  it("identifies numeric measure columns for metrics and aggregations", () => {
    expect(isNumericColumn({ name: "annual_salary", data_type: "BIGINT" })).toBe(true);
    expect(isNumericColumn({ name: "monthly_salary", data_type: "BIGINT" })).toBe(true);
    expect(isNumericColumn({ name: "job_rate", data_type: "DOUBLE" })).toBe(true);
    expect(isNumericColumn({ name: "years", data_type: "BIGINT" })).toBe(true);
    expect(isNumericColumn({ name: "total_revenue", data_type: "DECIMAL(10,2)" })).toBe(true);

    expect(isNumericColumn({ name: "department", data_type: "VARCHAR" })).toBe(false);
    expect(isNumericColumn({ name: "country", data_type: "VARCHAR" })).toBe(false);
    expect(isNumericColumn({ name: "start_date", data_type: "TIMESTAMP" })).toBe(false);
  });

  it("sanitizes metric expressions and prevents incompatible aggregations on text columns", () => {
    const columns = [
      { name: "schema_name", data_type: "VARCHAR" },
      { name: "table_name", data_type: "VARCHAR" },
      { name: "row_count", data_type: "BIGINT" },
      { name: "column_count", data_type: "INT" },
    ];

    // Text column with SUM must automatically sanitize to COUNT_DISTINCT
    const textSum = parseMetricExpression({ column: "schema_name", agg: "SUM" }, columns);
    expect(textSum).toEqual({ column: "schema_name", agg: "COUNT_DISTINCT" });

    // Text column with AVG must automatically sanitize to COUNT_DISTINCT
    const textAvg = parseMetricExpression({ column: "table_name", agg: "AVG" }, columns);
    expect(textAvg).toEqual({ column: "table_name", agg: "COUNT_DISTINCT" });

    // Numeric column keeps SUM and AVG
    const numSum = parseMetricExpression({ column: "row_count", agg: "SUM" }, columns);
    expect(numSum).toEqual({ column: "row_count", agg: "SUM" });

    const numAvg = parseMetricExpression({ column: "row_count", agg: "AVG" }, columns);
    expect(numAvg).toEqual({ column: "row_count", agg: "AVG" });

    // Alias mapping: total_rows -> row_count
    const aliasMetric = parseMetricExpression({ name: "total_rows", expression: "SUM(row_count)" }, columns);
    expect(aliasMetric).toEqual({ column: "row_count", agg: "SUM" });

    // Formula parsing: SUM("row_count")
    const formulaMetric = parseMetricExpression({ expression: 'SUM("row_count")' }, columns);
    expect(formulaMetric).toEqual({ column: "row_count", agg: "SUM" });

    // Formula with text: SUM("schema_name") must sanitize to COUNT_DISTINCT
    const textFormula = parseMetricExpression({ expression: 'SUM("schema_name")' }, columns);
    expect(textFormula).toEqual({ column: "schema_name", agg: "COUNT_DISTINCT" });
  });
});


