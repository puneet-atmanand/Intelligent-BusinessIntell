import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  BarChart3,
  Plus,
  Play,
  Save,
  Trash2,
  Edit2,
  RefreshCw,
  ChevronLeft,
  Clock,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { api, ChartItem, DatasetItem, ChartDataResponse, AISnapshotItem } from "@/app/api";
import { chartRegistry, ChartPlugin } from "@/charts";
import { isTemporalColumn, isNumericColumn } from "./utils";
import { AIDrawer } from "@/features/ai/AIDrawer";

/**
 * Robustly parse existing metric configuration objects into valid column + aggregation pairs,
 * preventing derived aliases like "avg_credits" from being treated as physical column names.
 */
function parseMetricItem(
  m: any,
  idx: number,
  datasetCols: any[]
): { id: string; column: string; agg: string } {
  if (!m) {
    return { id: `m-${idx}`, column: "count", agg: "COUNT" };
  }

  // 1. Direct match when column exists in datasetCols
  if (m.column && m.column !== "avg_credits" && m.column !== "sum_credits") {
    if (m.column === "count") {
      return { id: m.id || `m-${idx}`, column: "count", agg: "COUNT" };
    }
    const direct = datasetCols.find(
      (c) => (c.column_name || c.name || "").toLowerCase() === String(m.column).toLowerCase()
    );
    if (direct) {
      return {
        id: m.id || `m-${idx}`,
        column: direct.column_name || direct.name,
        agg: (m.agg || "SUM").toUpperCase(),
      };
    }
  }

  // 2. Parse from expression e.g. AVG(credits), SUM("credits"), COUNT(*)
  const expr = (m.expression || m.sql_expression || "").trim();
  if (expr) {
    if (expr.toUpperCase() === "COUNT(*)") {
      return { id: m.id || `m-${idx}`, column: "count", agg: "COUNT" };
    }
    const match = expr.match(/^([a-zA-Z_]+)\(\s*(?:DISTINCT\s+)?["'`]?([^"')`]+)["'`]?\s*\)$/i);
    if (match) {
      let agg = match[1].toUpperCase();
      if (expr.toUpperCase().includes("DISTINCT")) {
        agg = "COUNT_DISTINCT";
      }
      const rawCol = match[2].trim();
      const matched = datasetCols.find(
        (c) => (c.column_name || c.name || "").toLowerCase() === rawCol.toLowerCase()
      );
      if (matched) {
        return { id: m.id || `m-${idx}`, column: matched.column_name || matched.name, agg };
      }
      for (const pfx of ["avg_", "sum_", "min_", "max_", "count_"]) {
        if (rawCol.toLowerCase().startsWith(pfx)) {
          const rem = rawCol.toLowerCase().slice(pfx.length);
          const remMatch = datasetCols.find(
            (c) => (c.column_name || c.name || "").toLowerCase() === rem
          );
          if (remMatch) {
            return {
              id: m.id || `m-${idx}`,
              column: remMatch.column_name || remMatch.name,
              agg: agg || pfx.replace("_", "").toUpperCase(),
            };
          }
        }
      }
      return { id: m.id || `m-${idx}`, column: rawCol, agg };
    }
  }

  // 3. Check m.column if it carried a prefix alias like avg_credits
  if (m.column) {
    const colLower = String(m.column).toLowerCase();
    for (const pfx of ["avg_", "sum_", "min_", "max_", "count_"]) {
      if (colLower.startsWith(pfx)) {
        const rem = colLower.slice(pfx.length);
        const remMatch = datasetCols.find(
          (c) => (c.column_name || c.name || "").toLowerCase() === rem
        );
        if (remMatch) {
          return {
            id: m.id || `m-${idx}`,
            column: remMatch.column_name || remMatch.name,
            agg: pfx.replace("_", "").toUpperCase(),
          };
        }
      }
    }
  }

  // 4. Check m.name
  const rawName = (m.name || m.label || "").trim();
  if (rawName.toLowerCase() === "count" || rawName.toLowerCase() === "total_rows") {
    return { id: m.id || `m-${idx}`, column: "count", agg: "COUNT" };
  }
  const nameLower = rawName.toLowerCase();
  for (const pfx of ["avg_", "sum_", "min_", "max_", "count_"]) {
    if (nameLower.startsWith(pfx)) {
      const rem = nameLower.slice(pfx.length);
      const remMatch = datasetCols.find(
        (c) => (c.column_name || c.name || "").toLowerCase() === rem
      );
      if (remMatch) {
        return {
          id: m.id || `m-${idx}`,
          column: remMatch.column_name || remMatch.name,
          agg: pfx.replace("_", "").toUpperCase(),
        };
      }
    }
  }

  // 5. Direct name match
  const nameMatch = datasetCols.find(
    (c) => (c.column_name || c.name || "").toLowerCase() === nameLower
  );
  if (nameMatch) {
    return {
      id: m.id || `m-${idx}`,
      column: nameMatch.column_name || nameMatch.name,
      agg: (m.agg || "SUM").toUpperCase(),
    };
  }

  return {
    id: m.id || `m-${idx}`,
    column: m.column || rawName || "count",
    agg: (m.agg || "SUM").toUpperCase(),
  };
}

/**
 * Projects and formats AI Query Result rows to match the user's selected dimensions, metrics,
 * and sorting in the Analytics Workspace without executing full database queries.
 */
function projectSnapshotData(
  snapshot: AISnapshotItem,
  selectedDims: string[],
  selectedMetrics: Array<{ column: string; agg?: string }>,
  sortCol?: string,
  sortDir?: "ASC" | "DESC"
): ChartDataResponse {
  const origCols = snapshot.columns || [];
  const origRows = snapshot.rows || [];

  // Determine dimension column names (fallback to first column if empty)
  const dims = selectedDims.filter(Boolean);
  const effectiveDims = dims.length > 0 ? dims : (origCols.length > 0 ? [origCols[0]] : []);

  // Determine metric column names (fallback to first non-dim column or count)
  let metricColNames = selectedMetrics
    .map((m) => m.column)
    .filter((col) => col && col !== "count" && origCols.includes(col));

  if (metricColNames.length === 0) {
    const candidate = origCols.find((c) => !effectiveDims.includes(c)) || (origCols.length > 1 ? origCols[1] : origCols[0]);
    if (candidate) metricColNames.push(candidate);
  }

  // Final projected columns: dimensions first, then metrics
  const projectedCols = [...effectiveDims, ...metricColNames];
  // Deduplicate columns while maintaining order
  const uniqueCols = Array.from(new Set(projectedCols));
  const colIndices = uniqueCols.map((c) => origCols.indexOf(c));

  // Map rows to new projected column order
  let projectedRows = origRows.map((row) =>
    colIndices.map((idx) => (idx >= 0 ? row[idx] : null))
  );

  // Apply sorting if sortCol is specified
  if (sortCol && uniqueCols.includes(sortCol)) {
    const sortIdx = uniqueCols.indexOf(sortCol);
    projectedRows = [...projectedRows].sort((a, b) => {
      const valA = a[sortIdx];
      const valB = b[sortIdx];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      const numA = Number(valA);
      const numB = Number(valB);
      const cmp = !isNaN(numA) && !isNaN(numB) ? numA - numB : String(valA).localeCompare(String(valB));
      return sortDir === "ASC" ? cmp : -cmp;
    });
  }

  return {
    columns: uniqueCols,
    column_types: uniqueCols.map((c) => {
      const origIdx = origCols.indexOf(c);
      return origIdx >= 0 ? snapshot.column_types?.[origIdx] || "VARCHAR" : "VARCHAR";
    }),
    rows: projectedRows,
    row_count: projectedRows.length,
    sql: snapshot.sql || "",
    duration_ms: snapshot.duration_ms || 0,
  };
}

/**
 * Intelligent automatic chart selector for AI query results.
 */
function autoConfigureAIChart(snapshot: AISnapshotItem): {
  vizType: string;
  dimension: string;
  metric: string;
  timeColumn: string;
  chartTitle: string;
} {
  const cols = snapshot.columns || [];
  const rows = snapshot.rows || [];

  // 1. Identify temporal columns
  const timeCol =
    cols.find((c) => {
      const lower = c.toLowerCase();
      return (
        lower.includes("date") ||
        lower.includes("time") ||
        lower.includes("year") ||
        lower.includes("month") ||
        lower.includes("day")
      );
    }) || "";

  // 2. Identify numeric columns
  const numCols = cols.filter((_c, idx) => {
    const sample = rows[0]?.[idx];
    return (
      typeof sample === "number" ||
      (!isNaN(Number(sample)) && sample !== "" && sample !== null && sample !== undefined)
    );
  });

  // 3. Identify categorical columns
  const catCols = cols.filter((c) => !numCols.includes(c) && c !== timeCol);

  // 4. Determine vizType
  let vizType = "bar";
  const recViz = snapshot.recommended_chart?.viz_type;
  if (
    recViz &&
    ["bar", "line", "pie", "big_number", "table", "area", "scatter", "histogram"].includes(recViz)
  ) {
    vizType = recViz;
  } else if (snapshot.row_count === 1 && numCols.length >= 1) {
    vizType = "big_number";
  } else if (timeCol && numCols.length >= 1) {
    vizType = "line";
  } else if (catCols.length >= 1 && numCols.length >= 1) {
    const qLower = (snapshot.question || "").toLowerCase();
    if (
      snapshot.row_count <= 6 &&
      (qLower.includes("share") ||
        qLower.includes("percent") ||
        qLower.includes("proportion") ||
        qLower.includes("distribution"))
    ) {
      vizType = "pie";
    } else {
      vizType = "bar";
    }
  } else if (numCols.length >= 2) {
    vizType = "bar";
  } else {
    vizType = "table";
  }

  const dimension = timeCol || catCols[0] || cols[0] || "";
  const metric = numCols[0] || cols.find((c) => c !== dimension) || cols[0] || "count";

  // Clean title
  let chartTitle = (snapshot.question || "").trim();
  if (chartTitle.endsWith("?") || chartTitle.endsWith(".")) {
    chartTitle = chartTitle.slice(0, -1);
  }
  if (chartTitle.length > 0) {
    chartTitle = chartTitle.charAt(0).toUpperCase() + chartTitle.slice(1);
  } else {
    chartTitle = "AI Analysis Chart";
  }

  return {
    vizType,
    dimension,
    metric,
    timeColumn: timeCol,
    chartTitle,
  };
}

export const ChartsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Mode: "list" or "explore"
  const [mode, setMode] = useState<"list" | "explore">("list");
  const [editingChartId, setEditingChartId] = useState<string | null>(null);

  // Workspace Source Mode: "ORIGINAL_DATASET" or "AI_QUERY_RESULT"
  const [workspaceSourceType, setWorkspaceSourceType] = useState<"ORIGINAL_DATASET" | "AI_QUERY_RESULT">(
    "ORIGINAL_DATASET"
  );
  const [aiSnapshot, setAiSnapshot] = useState<AISnapshotItem | null>(null);

  // Queries
  const { data: charts = [], isLoading: isLoadingCharts, refetch: refetchCharts } = useQuery({
    queryKey: ["charts"],
    queryFn: api.getCharts,
  });

  const { data: datasets = [], isLoading: isLoadingDatasets, refetch: refetchDatasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: api.getDatasets,
  });

  const { data: dashboards = [] } = useQuery({
    queryKey: ["dashboards"],
    queryFn: api.getDashboards,
  });

  const chartList: ChartItem[] = Array.isArray(charts)
    ? (charts as ChartItem[])
    : (charts as any)?.data || [];
  const datasetList: DatasetItem[] = Array.isArray(datasets)
    ? (datasets as DatasetItem[])
    : (datasets as any)?.data || [];
  const dashboardList = Array.isArray(dashboards)
    ? dashboards
    : (dashboards as any)?.data || [];

  // List Filter State
  const [listDatasetFilter, setListDatasetFilter] = useState<string>("all");

  // Explore Builder State
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [selectedVizType, setSelectedVizType] = useState<string>("bar");

  // X-Axis (Dimension / Category)
  const [selectedDimension, setSelectedDimension] = useState<string>("");
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([]);

  // Y-Axis (Metric / Measure & Aggregation)
  const [metricsList, setMetricsList] = useState<Array<{ id: string; column: string; agg: string }>>([
    { id: "m-0", column: "count", agg: "COUNT" },
  ]);
  const [primaryMetricCol, setPrimaryMetricCol] = useState<string>("count");
  const [primaryMetricAgg, setPrimaryMetricAgg] = useState<string>("COUNT");

  // Temporal Axis
  const [timeColumn, setTimeColumn] = useState<string>("");
  const [timeGrain, setTimeGrain] = useState<string>("month");

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>("");
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("DESC");

  // Chart Options & Limits
  const [chartOptions, setChartOptions] = useState<Record<string, any>>({});
  const [rowLimit, setRowLimit] = useState<number>(100);

  // Filters state
  const [filters, setFilters] = useState<any[]>([]);
  const [newFilterCol, setNewFilterCol] = useState<string>("");
  const [newFilterOp, setNewFilterOp] = useState<string>("==");
  const [newFilterVal, setNewFilterVal] = useState<string>("");

  // Query Execution State
  const [chartData, setChartData] = useState<ChartDataResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<"chart" | "data" | "sql">("chart");
  const queryRequestIdRef = useRef<number>(0);

  // Save Modal State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [chartTitle, setChartTitle] = useState("");
  const [chartDescription, setChartDescription] = useState("");
  const [targetDashboardId, setTargetDashboardId] = useState<string>("auto");
  const [isDatasetAIDrawerOpen, setIsDatasetAIDrawerOpen] = useState(false);

  // Fallback direct query for active dataset to ensure columns/schema load immediately
  const { data: directDataset, isLoading: isLoadingDirectDataset } = useQuery({
    queryKey: ["dataset", selectedDatasetId],
    queryFn: () => api.getDataset(selectedDatasetId),
    enabled: !!selectedDatasetId,
    staleTime: 60000,
  });

  // Effective dataset list combining list with any directly fetched dataset
  const effectiveDatasetList: DatasetItem[] = useMemo(() => {
    if (!directDataset || !directDataset.id) return datasetList;
    if (datasetList.some((d) => d.id === directDataset.id)) return datasetList;
    return [directDataset, ...datasetList];
  }, [datasetList, directDataset]);

  // Resolved Dataset & Columns
  const currentDataset: DatasetItem | undefined = useMemo(() => {
    if (!selectedDatasetId) return datasetList[0];
    const fromList = datasetList.find((d: DatasetItem) => d.id === selectedDatasetId);
    if (fromList && fromList.columns && fromList.columns.length > 0) {
      return fromList;
    }
    if (directDataset && directDataset.id === selectedDatasetId) {
      return directDataset;
    }
    return fromList || directDataset || datasetList[0];
  }, [datasetList, selectedDatasetId, directDataset]);

  const currentColumns: any[] = useMemo(() => currentDataset?.columns || [], [currentDataset]);
  const currentPredefinedMetrics: any[] = useMemo(() => currentDataset?.metrics || [], [currentDataset]);

  // Synthetic schema derived from AI result snapshot when in AI_QUERY_RESULT mode
  const aiResultColumns = useMemo(() => {
    if (!aiSnapshot || !aiSnapshot.columns) return [];
    return aiSnapshot.columns.map((colName, idx) => {
      const rawType = aiSnapshot.column_types?.[idx] || "";
      const sampleVal = aiSnapshot.rows?.[0]?.[idx];
      const isNum =
        typeof sampleVal === "number" ||
        (!isNaN(Number(sampleVal)) && sampleVal !== "" && sampleVal !== null && sampleVal !== undefined);
      const isTime =
        typeof sampleVal === "string" &&
        (colName.toLowerCase().includes("date") ||
          colName.toLowerCase().includes("time") ||
          colName.toLowerCase().includes("year") ||
          colName.toLowerCase().includes("month"));
      return {
        name: colName,
        column_name: colName,
        data_type: rawType || (isNum ? "DOUBLE" : isTime ? "TIMESTAMP" : "VARCHAR"),
        is_dimension: !isNum,
        is_numeric: isNum,
        is_datetime: isTime,
      };
    });
  }, [aiSnapshot]);

  // Active columns used for control panels and axis configuration
  const effectiveColumns: any[] = useMemo(() => {
    if (workspaceSourceType === "AI_QUERY_RESULT" && aiSnapshot) {
      return aiResultColumns;
    }
    return currentColumns;
  }, [workspaceSourceType, aiSnapshot, aiResultColumns, currentColumns]);

  // Validated column subsets by type
  const validTimeColumns = useMemo(() => effectiveColumns.filter(isTemporalColumn), [effectiveColumns]);
  const numericColumns = useMemo(() => effectiveColumns.filter(isNumericColumn), [effectiveColumns]);
  const dimensionColumns = useMemo(
    () => effectiveColumns.filter((c) => c.is_dimension || !isTemporalColumn(c)),
    [effectiveColumns]
  );

  // Sync initial dataset ID
  useEffect(() => {
    const datasetParam = searchParams.get("dataset") || searchParams.get("dataset_id");
    if (datasetParam) {
      return; // Do not auto-select first dataset when a specific dataset is requested via URL
    }
    if (datasetList.length > 0 && !selectedDatasetId) {
      setSelectedDatasetId(datasetList[0].id);
    }
  }, [datasetList, selectedDatasetId, searchParams]);

  // Helper to compute initial sensible defaults for a dataset
  const initializeDatasetSelections = useCallback(
    (ds: DatasetItem) => {
      const cols: any[] = ds.columns || [];
      const timeCols = cols.filter(isTemporalColumn);
      const numCols = cols.filter(isNumericColumn);

      // Best dimension: categorical column (not email, mobile, id)
      const bestDim =
        cols.find((c) => {
          const n = (c.column_name || c.name || "").toLowerCase();
          return (
            (c.is_dimension || !isTemporalColumn(c)) &&
            !isNumericColumn(c) &&
            (n.includes("dept") ||
              n.includes("category") ||
              n.includes("country") ||
              n.includes("gender") ||
              n.includes("region") ||
              n.includes("status"))
          );
        }) ||
        cols.find((c) => !isTemporalColumn(c) && !isNumericColumn(c)) ||
        cols[0];

      const bestDimName = bestDim ? bestDim.column_name || bestDim.name : "";
      setSelectedDimension(bestDimName);
      setSelectedDimensions(bestDimName ? [bestDimName] : []);

      // Time column: default to first valid temporal column only
      if (timeCols.length > 0) {
        const dtCol = timeCols[0];
        setTimeColumn(dtCol.column_name || dtCol.name);
      } else {
        setTimeColumn("");
      }

      // Metric: if numeric columns exist, pick the first one
      if (numCols.length > 0) {
        const firstNum = numCols[0];
        const numName = firstNum.column_name || firstNum.name;
        setPrimaryMetricCol(numName);
        setPrimaryMetricAgg("SUM");
        setMetricsList([{ id: "m-0", column: numName, agg: "SUM" }]);
      } else if (ds.metrics && ds.metrics.length > 0) {
        const firstM = ds.metrics[0];
        const mName = firstM.metric_name || (firstM as any).name;
        setPrimaryMetricCol(mName);
        setPrimaryMetricAgg("SUM");
        setMetricsList([{ id: "m-0", column: mName, agg: "SUM" }]);
      } else {
        setPrimaryMetricCol("count");
        setPrimaryMetricAgg("COUNT");
        setMetricsList([{ id: "m-0", column: "count", agg: "COUNT" }]);
      }

      setFilters([]);
      setSortColumn("");
      setChartData(null);
      setQueryError(null);
    },
    []
  );

  // Explicit dataset change handler: resets all previous selections and query results
  const handleDatasetChange = (newDatasetId: string) => {
    setWorkspaceSourceType("ORIGINAL_DATASET");
    setAiSnapshot(null);
    setSelectedDatasetId(newDatasetId);
    setChartData(null);
    setQueryError(null);
    setFilters([]);
    setSortColumn("");

    const newDs = effectiveDatasetList.find((d) => d.id === newDatasetId);
    if (newDs && newDs.columns && newDs.columns.length > 0) {
      initializeDatasetSelections(newDs);
    } else {
      setSelectedDimension("");
      setSelectedDimensions([]);
      setTimeColumn("");
      setMetricsList([{ id: "m-0", column: "count", agg: "COUNT" }]);
    }
  };

  // Synchronize and sanitize selections whenever effectiveColumns changes
  // Ensures columns from previously selected dataset or query result never linger
  useEffect(() => {
    if (!effectiveColumns || effectiveColumns.length === 0) return;
    const validColNames = new Set(
      effectiveColumns.map((c) => (c.column_name || c.name || "").toLowerCase())
    );

    // 1. Sanitize dimensions: remove any dimension that doesn't exist in effectiveColumns
    setSelectedDimensions((prev) => {
      const filtered = prev.filter((col) => validColNames.has(col.toLowerCase()));
      if (filtered.length > 0) return filtered;
      const candidate =
        effectiveColumns.find((c) => c.is_dimension || !isTemporalColumn(c)) ||
        effectiveColumns[0];
      const bestName = candidate ? candidate.column_name || candidate.name : "";
      return bestName ? [bestName] : [];
    });

    // 2. Sanitize metrics: remove any metric whose column doesn't exist in effectiveColumns
    setMetricsList((prev) => {
      const valid = prev.filter(
        (m) => m.column === "count" || validColNames.has((m.column || "").toLowerCase())
      );
      if (valid.length > 0) return valid;
      const numCol = effectiveColumns.find(isNumericColumn);
      if (numCol) {
        const colName = numCol.column_name || numCol.name;
        return [{ id: "m-0", column: colName, agg: "SUM" }];
      }
      return [{ id: "m-0", column: "count", agg: "COUNT" }];
    });

    // 3. Sanitize time column
    setTimeColumn((prev) => {
      if (!prev) return "";
      const isStillValid = effectiveColumns.some(
        (c) => isTemporalColumn(c) && (c.column_name || c.name || "").toLowerCase() === prev.toLowerCase()
      );
      return isStillValid ? prev : "";
    });

    // 4. Sanitize filters
    setFilters((prev) => {
      return prev.filter((f) => validColNames.has((f.col || "").toLowerCase()));
    });

    // 5. Sanitize sorting
    setSortColumn((prev) => {
      if (!prev) return "";
      return validColNames.has(prev.toLowerCase()) ? prev : "";
    });
  }, [effectiveColumns]);

  // Build active metrics payload with verified physical column bindings
  const activeMetrics = useMemo(() => {
    const list: any[] = [];
    for (const m of metricsList) {
      if (!m.column) continue;
      if (m.column === "count") {
        list.push({
          name: "count",
          label: "Count of Rows",
          expression: "COUNT(*)",
          column: "count",
          agg: "COUNT",
        });
      } else {
        const predefined = currentPredefinedMetrics.find(
          (pm: any) => (pm.metric_name || pm.name) === m.column
        );
        if (predefined) {
          list.push({
            name: predefined.metric_name || predefined.name,
            label: predefined.verbose_name || predefined.metric_name || predefined.name,
            expression: predefined.sql_expression,
            column: m.column,
            agg: "EXPR",
          });
        } else {
          // Resolve real physical column name
          let actualCol = m.column;
          const foundCol = currentColumns.find(
            (c) => (c.column_name || c.name || "").toLowerCase() === actualCol.toLowerCase()
          );
          if (foundCol) {
            actualCol = foundCol.column_name || foundCol.name;
          } else {
            for (const pfx of ["avg_", "sum_", "min_", "max_", "count_"]) {
              if (actualCol.toLowerCase().startsWith(pfx)) {
                const rem = actualCol.toLowerCase().slice(pfx.length);
                const matched = currentColumns.find(
                  (c) => (c.column_name || c.name || "").toLowerCase() === rem
                );
                if (matched) {
                  actualCol = matched.column_name || matched.name;
                  break;
                }
              }
            }
          }

          const agg = (m.agg || "SUM").toUpperCase();
          const expr =
            agg === "COUNT_DISTINCT"
              ? `COUNT(DISTINCT "${actualCol}")`
              : `${agg}("${actualCol}")`;
          const mName = `${agg.toLowerCase()}_${actualCol}`;
          const label = `${agg}(${actualCol})`;
          list.push({
            name: mName,
            label,
            expression: expr,
            column: actualCol,
            agg,
          });
        }
      }
    }
    if (list.length === 0) {
      list.push({
        name: "count",
        label: "Count of Rows",
        expression: "COUNT(*)",
        column: "count",
        agg: "COUNT",
      });
    }
    return list;
  }, [metricsList, currentPredefinedMetrics, currentColumns]);

  // Execute chart query mutation
  const runQueryMutation = useMutation({
    mutationFn: async () => {
      // If working with an AI Query Result, project from snapshot data in-memory without DuckDB queries
      if (workspaceSourceType === "AI_QUERY_RESULT" && aiSnapshot) {
        const thisRequestId = ++queryRequestIdRef.current;
        const projected = projectSnapshotData(
          aiSnapshot,
          selectedDimensions.length > 0 ? selectedDimensions : selectedDimension ? [selectedDimension] : [],
          metricsList,
          sortColumn,
          sortDirection
        );
        return { result: projected, requestId: thisRequestId };
      }

      if (!selectedDatasetId) throw new Error("Please select a dataset.");

      let dims: string[] = selectedDimensions.filter(Boolean);
      if (dims.length === 0 && selectedDimension) {
        dims = [selectedDimension];
      }

      // For big_number KPI, dimensions are not required
      if (selectedVizType === "big_number") {
        dims = [];
      } else if (dims.length === 0 && !timeColumn) {
        // Fallback to first available dimension
        const fallbackCol = dimensionColumns[0] || effectiveColumns[0];
        if (fallbackCol) {
          dims = [fallbackCol.column_name || fallbackCol.name];
        }
      }

      // Enforce valid time column: only pass if valid in dataset
      const safeTimeCol = validTimeColumns.some(
        (c) => (c.column_name || c.name) === timeColumn
      )
        ? timeColumn
        : undefined;

      const orderPayload = sortColumn
        ? [{ col: sortColumn, direction: sortDirection }]
        : undefined;

      const payload = {
        dataset_id: selectedDatasetId,
        viz_type: selectedVizType,
        dimensions: dims,
        metrics: activeMetrics,
        filters,
        time_column: safeTimeCol,
        time_grain: safeTimeCol ? timeGrain : undefined,
        order_by: orderPayload,
        row_limit: rowLimit,
      };

      const thisRequestId = ++queryRequestIdRef.current;
      const result = await api.getChartData(payload);
      return { result, requestId: thisRequestId };
    },
    onMutate: () => {
      // Clear previous error on new execution
      setQueryError(null);
    },
    onSuccess: ({ result, requestId }) => {
      // Prevent stale asynchronous responses from overwriting newer query results
      if (requestId === queryRequestIdRef.current) {
        setChartData(result);
        setQueryError(null);
      }
    },
    onError: (err: any) => {
      // On failure: do NOT represent stale chart data as new results
      setChartData(null);
      setQueryError(err?.message || "Query execution failed. Please verify axis configuration.");
    },
  });

  // Auto-run query when explore mode loads or critical axes change
  const lastQueryKeyRef = useRef<string>("");
  useEffect(() => {
    if (mode !== "explore") return;

    // In AI Query Result mode: project snapshot in-memory
    if (workspaceSourceType === "AI_QUERY_RESULT" && aiSnapshot) {
      const projected = projectSnapshotData(
        aiSnapshot,
        selectedDimensions.length > 0 ? selectedDimensions : selectedDimension ? [selectedDimension] : [],
        metricsList,
        sortColumn,
        sortDirection
      );
      setChartData(projected);
      setQueryError(null);
      return;
    }

    if (!selectedDatasetId || !currentDataset) return;

    const currentKey = JSON.stringify({
      ds: selectedDatasetId,
      viz: selectedVizType,
      dims: selectedDimensions,
      mList: metricsList,
      tc: timeColumn,
      tg: timeGrain,
      f: filters,
      lim: rowLimit,
      sort: sortColumn,
      sortDir: sortDirection,
    });

    if (lastQueryKeyRef.current !== currentKey) {
      lastQueryKeyRef.current = currentKey;
      runQueryMutation.mutate();
    }
  }, [
    mode,
    workspaceSourceType,
    aiSnapshot,
    selectedDatasetId,
    currentDataset,
    selectedVizType,
    selectedDimension,
    selectedDimensions,
    metricsList,
    timeColumn,
    timeGrain,
    filters,
    rowLimit,
    sortColumn,
    sortDirection,
  ]);

  // Save chart mutation
  const saveChartMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: chartTitle.trim(),
        description: chartDescription.trim(),
        dataset_id: selectedDatasetId,
        viz_type: selectedVizType,
        dashboard_id: targetDashboardId && targetDashboardId !== "auto" && targetDashboardId !== "none" ? targetDashboardId : undefined,
        params: {
          dimension: selectedDimensions[0] || selectedDimension,
          dimensions: selectedDimensions.filter(Boolean),
          primary_metric_col: metricsList[0]?.column || primaryMetricCol,
          primary_metric_agg: metricsList[0]?.agg || primaryMetricAgg,
          metrics: activeMetrics,
          metrics_config: metricsList,
          additional_metrics: metricsList.slice(1),
          time_column: timeColumn,
          time_grain: timeGrain,
          order_by: sortColumn ? [{ col: sortColumn, direction: sortDirection }] : undefined,
          options: chartOptions,
          filters,
          row_limit: rowLimit,
          source_type: workspaceSourceType,
          ai_snapshot_id: aiSnapshot?.id,
          question: aiSnapshot?.question,
          cached_query_result: workspaceSourceType === "AI_QUERY_RESULT" ? chartData : undefined,
        },
      };

      if (editingChartId) {
        return api.updateChart(editingChartId, payload);
      } else {
        return api.createChart(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      setIsSaveModalOpen(false);
      setEditingChartId(null);
      setMode("list");
    },
  });

  // Delete chart mutation
  const deleteChartMutation = useMutation({
    mutationFn: (id: string) => api.deleteChart(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["charts"] });
    },
  });

  const loadAISnapshotIntoWorkspace = useCallback((snap: AISnapshotItem) => {
    setWorkspaceSourceType("AI_QUERY_RESULT");
    setAiSnapshot(snap);
    setEditingChartId(null);

    if (snap.dataset_id) {
      setSelectedDatasetId(snap.dataset_id);
    }

    const autoConfig = autoConfigureAIChart(snap);
    setSelectedVizType(autoConfig.vizType);
    setSelectedDimension(autoConfig.dimension);
    setSelectedDimensions(autoConfig.dimension ? [autoConfig.dimension] : []);
    setTimeColumn(autoConfig.timeColumn);
    setMetricsList([
      {
        id: "m-0",
        column: autoConfig.metric,
        agg: autoConfig.metric === "count" ? "COUNT" : "SUM",
      },
    ]);
    setPrimaryMetricCol(autoConfig.metric);
    setPrimaryMetricAgg(autoConfig.metric === "count" ? "COUNT" : "SUM");
    setChartTitle(autoConfig.chartTitle);
    setChartDescription(`Generated from AI Analyst query: "${snap.question}"`);
    setSortColumn("");
    setSortDirection("DESC");
    setFilters([]);

    // Project and render exact query result rows immediately
    const projected = projectSnapshotData(
      snap,
      autoConfig.dimension ? [autoConfig.dimension] : [],
      [{ column: autoConfig.metric, agg: "SUM" }]
    );
    setChartData(projected);
    setQueryError(null);
    setMode("explore");
  }, []);

  const handleOpenExplore = (chartToEdit?: ChartItem) => {
    if (chartToEdit) {
      setEditingChartId(chartToEdit.id);
      setChartTitle(chartToEdit.title);
      setChartDescription(chartToEdit.description || "");
      setSelectedDatasetId(chartToEdit.dataset_id);
      setSelectedVizType(chartToEdit.viz_type);
      const p = chartToEdit.params || {};

      const dims = p.dimensions || (p.dimension ? [p.dimension] : []);
      setSelectedDimension(dims[0] || "");
      setSelectedDimensions(dims);

      const targetDs = effectiveDatasetList.find((d) => d.id === chartToEdit.dataset_id);
      const colsForParsing = targetDs?.columns || [];

      if (p.source_type === "ai_query_result" && p.cached_query_result) {
        setWorkspaceSourceType("AI_QUERY_RESULT");
        setAiSnapshot({
          id: p.ai_snapshot_id || chartToEdit.id,
          source_type: "ai_query_result",
          dataset_id: chartToEdit.dataset_id,
          dataset_name: targetDs?.name || "",
          question: p.question || chartToEdit.title,
          sql: p.cached_query_result.sql || "",
          columns: p.cached_query_result.columns || [],
          column_types: p.cached_query_result.column_types || [],
          rows: p.cached_query_result.rows || [],
          row_count: p.cached_query_result.row_count || 0,
          duration_ms: p.cached_query_result.duration_ms || 0,
          recommended_chart: { viz_type: chartToEdit.viz_type },
        });
        setChartData(p.cached_query_result);
      } else {
        setWorkspaceSourceType("ORIGINAL_DATASET");
        setAiSnapshot(null);
      }

      if (p.metrics_config && Array.isArray(p.metrics_config) && p.metrics_config.length > 0) {
        const parsedList = p.metrics_config.map((mc: any, idx: number) => parseMetricItem(mc, idx, colsForParsing));
        setMetricsList(parsedList);
        setPrimaryMetricCol(parsedList[0]?.column || "count");
        setPrimaryMetricAgg(parsedList[0]?.agg || "COUNT");
      } else if (p.metrics && p.metrics.length > 0) {
        const mappedList = p.metrics.map((m: any, idx: number) => parseMetricItem(m, idx, colsForParsing));
        setMetricsList(mappedList);
        setPrimaryMetricCol(mappedList[0]?.column || "count");
        setPrimaryMetricAgg(mappedList[0]?.agg || "COUNT");
      } else if (p.primary_metric_col) {
        const parsed = parseMetricItem({ column: p.primary_metric_col, agg: p.primary_metric_agg || "SUM" }, 0, colsForParsing);
        setPrimaryMetricCol(parsed.column);
        setPrimaryMetricAgg(parsed.agg);
        setMetricsList([parsed]);
      } else {
        setPrimaryMetricCol("count");
        setPrimaryMetricAgg("COUNT");
        setMetricsList([{ id: "m-0", column: "count", agg: "COUNT" }]);
      }

      if (p.order_by && Array.isArray(p.order_by) && p.order_by.length > 0) {
        setSortColumn(p.order_by[0].col || "");
        setSortDirection((p.order_by[0].direction as "ASC" | "DESC") || "DESC");
      } else {
        setSortColumn("");
        setSortDirection("DESC");
      }

      setTimeColumn(p.time_column || "");
      setTimeGrain(p.time_grain || "month");
      setChartOptions(p.options || {});
      setFilters(p.filters || []);
      setRowLimit(p.row_limit || 100);
      if (!p.cached_query_result) {
        setChartData(null);
      }
      setQueryError(null);
    } else {
      setWorkspaceSourceType("ORIGINAL_DATASET");
      setAiSnapshot(null);
      setEditingChartId(null);
      setChartTitle("New Chart");
      setChartDescription("");
      if (currentDataset) {
        initializeDatasetSelections(currentDataset);
      }
    }
    setMode("explore");
  };

  // Handle URL params ?ai_result_id=... or ?chart_id=... or ?dataset=...
  const handledUrlParamRef = useRef<string>("");

  useEffect(() => {
    const aiResultIdParam = searchParams.get("ai_result_id") || searchParams.get("ai_snapshot_id");
    const chartIdParam = searchParams.get("chart_id") || searchParams.get("chart");
    const datasetParam = searchParams.get("dataset") || searchParams.get("dataset_id");

    const paramSignature = `${aiResultIdParam || ""}:${chartIdParam || ""}:${datasetParam || ""}`;
    if (!paramSignature || paramSignature === "::") return;
    if (handledUrlParamRef.current === paramSignature) return;

    if (aiResultIdParam) {
      handledUrlParamRef.current = paramSignature;

      let loadedFromCache = false;
      try {
        const cachedRaw = sessionStorage.getItem("active_ai_snapshot");
        if (cachedRaw) {
          const cachedSnap: AISnapshotItem = JSON.parse(cachedRaw);
          if (cachedSnap && (cachedSnap.id === aiResultIdParam || !cachedSnap.id)) {
            loadedFromCache = true;
            loadAISnapshotIntoWorkspace(cachedSnap);
          }
        }
      } catch {
        // Fall back to server fetch
      }

      api
        .getAISnapshot(aiResultIdParam)
        .then((serverSnap) => {
          try {
            sessionStorage.setItem("active_ai_snapshot", JSON.stringify(serverSnap));
          } catch {}
          if (!loadedFromCache) {
            loadAISnapshotIntoWorkspace(serverSnap);
          }
        })
        .catch((err) => {
          if (!loadedFromCache) {
            setQueryError(`Failed to load AI query result: ${err?.message || "Snapshot not found"}`);
            setMode("explore");
          }
        });
      return;
    }

    if (chartIdParam && chartList.length > 0) {
      const matchChart = chartList.find((c) => c.id === chartIdParam);
      if (matchChart) {
        handledUrlParamRef.current = paramSignature;
        handleOpenExplore(matchChart);
        return;
      }
    }

    if (datasetParam) {
      const match = datasetList.find((d) => d.id === datasetParam);
      if (match) {
        handledUrlParamRef.current = paramSignature;
        const datasetCharts = chartList.filter((c) => c.dataset_id === match.id);
        const barChart = datasetCharts.find((c) => c.viz_type === "bar") || datasetCharts[0];
        if (barChart) {
          handleOpenExplore(barChart);
        } else {
          handleDatasetChange(match.id);
          setMode("explore");
        }
      } else if (!isLoadingDatasets) {
        // Newly imported dataset might not yet be in datasetList cache
        api
          .getDataset(datasetParam)
          .then((ds) => {
            if (ds && ds.id) {
              handledUrlParamRef.current = paramSignature;
              queryClient.setQueryData(["datasets"], (old: any) => {
                const oldList = Array.isArray(old) ? old : (old?.data || []);
                if (oldList.some((d: any) => d.id === ds.id)) return old;
                return [ds, ...oldList];
              });
              setSelectedDatasetId(ds.id);
              initializeDatasetSelections(ds);
              setMode("explore");
              queryClient.invalidateQueries({ queryKey: ["charts"] });
            }
          })
          .catch(() => {
            refetchDatasets();
            refetchCharts();
          });
      }
    }
  }, [
    searchParams,
    chartList,
    datasetList,
    isLoadingDatasets,
    refetchDatasets,
    refetchCharts,
    queryClient,
    initializeDatasetSelections,
    loadAISnapshotIntoWorkspace,
  ]);

  const handleAddFilter = () => {
    if (!newFilterCol) return;
    setFilters([...filters, { col: newFilterCol, op: newFilterOp, val: newFilterVal }]);
    setNewFilterCol("");
    setNewFilterVal("");
  };

  const handleRemoveFilter = (index: number) => {
    setFilters(filters.filter((_, idx) => idx !== index));
  };

  // Render chart using Plugin Registry
  const plugin: ChartPlugin | undefined = chartRegistry.get(selectedVizType);
  const chartProps =
    plugin && chartData
      ? plugin.transformProps(chartData, {
          ...chartOptions,
          dimensions: selectedDimensions.filter(Boolean),
          metrics: activeMetrics,
        })
      : null;

  return (
    <div className="space-y-6">
      {/* ==================== LIST MODE VIEW ==================== */}
      {mode === "list" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Charts</h1>
              <p className="text-sm text-slate-500">
                Explore datasets, configure dynamic dimensions & metrics, and assemble ECharts visualizations.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => refetchCharts()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingCharts ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <button
                onClick={() => handleOpenExplore()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                Create Chart
              </button>
            </div>
          </div>

          {/* Dataset Filter Dropdown */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                DATASET
              </label>
              <select
                value={listDatasetFilter}
                onChange={(e) => setListDatasetFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm min-w-[240px]"
              >
                <option value="all">All Datasets ({chartList.length} charts)</option>
                {effectiveDatasetList.map((ds: DatasetItem) => {
                  const count = chartList.filter((c) => c.dataset_id === ds.id).length;
                  return (
                    <option key={ds.id} value={ds.id}>
                      {ds.name} ({ds.table_name || "Virtual"}) — {count} charts
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="text-xs text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-800">
                {listDatasetFilter === "all"
                  ? chartList.length
                  : chartList.filter((c) => c.dataset_id === listDatasetFilter).length}
              </span>{" "}
              of {chartList.length} charts
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {chartList
              .filter((chart: ChartItem) =>
                listDatasetFilter === "all" ? true : chart.dataset_id === listDatasetFilter
              )
              .map((chart: ChartItem) => {
                const ds = datasetList.find((d: DatasetItem) => d.id === chart.dataset_id);
                return (
                  <div
                    key={chart.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
                            <BarChart3 className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-slate-900 text-sm">{chart.title}</h3>
                            <span className="inline-block px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider bg-slate-100 text-slate-700 rounded mt-0.5">
                              {chart.viz_type}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (confirm(`Delete chart '${chart.title}'?`)) {
                              deleteChartMutation.mutate(chart.id);
                            }
                          }}
                          className="text-slate-400 hover:text-red-600 transition p-1"
                          title="Delete chart"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {chart.description && (
                        <p className="text-xs text-slate-500 mt-2 line-clamp-2">{chart.description}</p>
                      )}

                      <div className="mt-4 pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Dataset:</span>
                          <span className="font-medium text-slate-800 truncate max-w-[180px]">
                            {ds?.name || "Dataset"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Created:</span>
                          <span className="text-slate-600">
                            {chart.created_at ? new Date(chart.created_at).toLocaleDateString() : "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenExplore(chart)}
                        className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded flex items-center gap-1.5 transition"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Explore / Edit
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>

          {chartList.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center space-y-3">
              <div className="inline-flex p-3 rounded-full bg-blue-50 text-blue-600">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">No Charts Created Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Explore connected datasets, choose from Apache ECharts visualizations, and save charts to assemble dashboards.
              </p>
              <button
                onClick={() => handleOpenExplore()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                Build Your First Chart
              </button>
            </div>
          )}
        </div>
      )}

      {/* ==================== EXPLORE MODE VIEW ==================== */}
      {mode === "explore" && (
        <div className="flex flex-col h-[calc(100vh-4rem)] -m-6 overflow-hidden bg-slate-50">
          {/* Top Navbar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setMode("list");
                  setWorkspaceSourceType("ORIGINAL_DATASET");
                  setAiSnapshot(null);
                  setSearchParams({});
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 font-medium px-2 py-1 rounded hover:bg-slate-100 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Charts
              </button>
              <div className="h-4 w-px bg-slate-200" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    {chartTitle || "Explore Chart"}
                  </h2>
                  {workspaceSourceType === "AI_QUERY_RESULT" && aiSnapshot && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-2xs">
                      <Sparkles className="w-3 h-3 text-indigo-600" />
                      AI Query Result | {aiSnapshot.row_count} Rows
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span>
                    Original Dataset:{" "}
                    <strong className="text-slate-700">
                      {aiSnapshot?.dataset_name || currentDataset?.name || (isLoadingDatasets || isLoadingDirectDataset ? "Loading..." : "None")}
                    </strong>
                    {" "}({effectiveColumns.length} columns)
                  </span>
                  {workspaceSourceType === "AI_QUERY_RESULT" && (
                    <button
                      onClick={() => {
                        setWorkspaceSourceType("ORIGINAL_DATASET");
                        setAiSnapshot(null);
                        setSearchParams({});
                        if (currentDataset) initializeDatasetSelections(currentDataset);
                      }}
                      className="text-blue-600 hover:underline font-medium text-[10px] ml-1"
                    >
                      (Switch to Full Dataset)
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => runQueryMutation.mutate()}
                disabled={runQueryMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded shadow-sm transition"
              >
                {runQueryMutation.isPending ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Running Query...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Run Query
                  </>
                )}
              </button>

              <button
                onClick={() => setIsSaveModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded shadow-sm transition"
              >
                <Save className="w-3.5 h-3.5" />
                Save Chart
              </button>
            </div>
          </div>

          {/* Main Explore Layout: Controls Sidebar on Left, Visualization Canvas on Right */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Controls Sidebar */}
            <div className="w-84 border-r border-slate-200 bg-white overflow-y-auto p-4 space-y-5 flex-shrink-0">
              {/* 1. Dataset Selection */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Dataset Source
                  </label>
                  {workspaceSourceType === "AI_QUERY_RESULT" && (
                    <span className="text-[10px] text-indigo-700 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                      AI Result Snapshot
                    </span>
                  )}
                </div>
                {workspaceSourceType === "AI_QUERY_RESULT" && aiSnapshot ? (
                  <div className="p-2.5 bg-indigo-50/50 border border-indigo-200 rounded text-xs space-y-1">
                    <div className="font-semibold text-indigo-900 truncate flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      {aiSnapshot.dataset_name || "AI Analysis Dataset"}
                    </div>
                    <div className="text-[11px] text-indigo-700">
                      {aiSnapshot.row_count} rows &middot; {aiSnapshot.columns.length} columns
                    </div>
                  </div>
                ) : (
                  <select
                    value={selectedDatasetId}
                    onChange={(e) => handleDatasetChange(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded font-medium focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                  >
                    {isLoadingDatasets && effectiveDatasetList.length === 0 ? (
                      <option value="" disabled>
                        Loading datasets...
                      </option>
                    ) : effectiveDatasetList.length === 0 ? (
                      <option value="" disabled>
                        No datasets available
                      </option>
                    ) : (
                      effectiveDatasetList.map((d: DatasetItem) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.table_name || "Virtual"})
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              {/* 2. Visualization Type Picker */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Visualization Type
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {chartRegistry.getAllMetadata().map((meta) => (
                    <button
                      key={meta.id}
                      onClick={() => setSelectedVizType(meta.id)}
                      className={`px-2 py-1.5 text-left text-xs rounded border transition flex items-center justify-between ${
                        selectedVizType === meta.id
                          ? "border-blue-600 bg-blue-50 text-blue-900 font-semibold ring-1 ring-blue-500"
                          : "border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{meta.name}</span>
                      <span className="text-[9px] text-slate-400 capitalize shrink-0 ml-1">
                        {meta.category}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. X-Axis (Dimensions / Categories) */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    X-Axis (Category / Dimension)
                  </label>
                  <span className="text-[10px] text-blue-600 font-medium">
                    {selectedDimensions.length} selected
                  </span>
                </div>

                <div className="space-y-1.5">
                  {selectedDimensions.map((dim, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="w-5 text-[11px] font-bold text-slate-400 font-mono text-center">
                        {idx + 1}.
                      </span>
                      <select
                        value={dim}
                        onChange={(e) => {
                          const updated = [...selectedDimensions];
                          updated[idx] = e.target.value;
                          setSelectedDimensions(updated);
                          if (idx === 0) setSelectedDimension(e.target.value);
                        }}
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-medium focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Choose X-Axis Column --</option>
                        {effectiveColumns.length === 0 ? (
                          <option value="" disabled>
                            Loading columns...
                          </option>
                        ) : (
                          effectiveColumns.map((c) => {
                            const colName = c.column_name || c.name;
                            return (
                              <option key={colName} value={colName}>
                                {colName} ({c.data_type || "VARCHAR"})
                              </option>
                            );
                          })
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedDimensions.length > 1) {
                            const updated = selectedDimensions.filter((_, i) => i !== idx);
                            setSelectedDimensions(updated);
                            if (idx === 0 && updated.length > 0) {
                              setSelectedDimension(updated[0]);
                            }
                          } else {
                            setSelectedDimensions([]);
                            setSelectedDimension("");
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                        title="Delete this dimension"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const candidate = effectiveColumns.find(
                      (c) => !selectedDimensions.includes(c.column_name || c.name)
                    );
                    const colToAdd = candidate
                      ? candidate.column_name || candidate.name
                      : effectiveColumns[0]?.column_name || effectiveColumns[0]?.name || "";
                    if (colToAdd) {
                      const updated = [...selectedDimensions, colToAdd];
                      setSelectedDimensions(updated);
                      if (!selectedDimension) setSelectedDimension(colToAdd);
                    }
                  }}
                  disabled={selectedDimensions.length >= effectiveColumns.length}
                  className="mt-1 flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Dimension (Group By)
                </button>
              </div>

              {/* 4. Y-Axis (Metrics & Aggregations) */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Y-Axis (Metrics & Measures)
                  </label>
                  <span className="text-[10px] text-blue-600 font-medium">
                    {metricsList.length} measure{metricsList.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="space-y-2">
                  {metricsList.map((m, idx) => (
                    <div key={m.id || idx} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1.5">
                      <div className="flex gap-1.5 items-center">
                        <select
                          value={m.agg}
                          onChange={(e) => {
                            const updated = [...metricsList];
                            updated[idx] = { ...updated[idx], agg: e.target.value };
                            setMetricsList(updated);
                            if (idx === 0) setPrimaryMetricAgg(e.target.value);
                          }}
                          disabled={m.column === "count"}
                          className="w-24 px-1.5 py-1 text-xs border border-slate-300 rounded bg-white font-mono font-semibold text-blue-800 disabled:opacity-50"
                        >
                          <option value="SUM">SUM</option>
                          <option value="AVG">AVG</option>
                          <option value="MIN">MIN</option>
                          <option value="MAX">MAX</option>
                          <option value="COUNT">COUNT</option>
                          <option value="COUNT_DISTINCT">DIST</option>
                        </select>

                        <select
                          value={m.column}
                          onChange={(e) => {
                            const updated = [...metricsList];
                            updated[idx] = { ...updated[idx], column: e.target.value };
                            setMetricsList(updated);
                            if (idx === 0) setPrimaryMetricCol(e.target.value);
                          }}
                          className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-medium text-slate-800"
                        >
                          <option value="count">Count of Rows (COUNT(*))</option>
                          {numericColumns.length > 0 && (
                            <optgroup label="Numeric Measures">
                              {numericColumns.map((c) => {
                                const colName = c.column_name || c.name;
                                return (
                                  <option key={colName} value={colName}>
                                    {colName} ({c.data_type || "NUMERIC"})
                                  </option>
                                );
                              })}
                            </optgroup>
                          )}
                          {effectiveColumns.filter((c) => !isNumericColumn(c)).length > 0 && (
                            <optgroup label="All Columns (COUNT / DISTINCT)">
                              {effectiveColumns
                                .filter((c) => !isNumericColumn(c))
                                .map((c) => {
                                  const colName = c.column_name || c.name;
                                  return (
                                    <option key={colName} value={colName}>
                                      {colName} ({c.data_type || "VARCHAR"})
                                    </option>
                                  );
                                })}
                            </optgroup>
                          )}
                        </select>

                        <button
                          type="button"
                          onClick={() => {
                            if (metricsList.length > 1) {
                              const updated = metricsList.filter((_, i) => i !== idx);
                              setMetricsList(updated);
                              if (idx === 0 && updated.length > 0) {
                                setPrimaryMetricCol(updated[0].column);
                                setPrimaryMetricAgg(updated[0].agg);
                              }
                            } else {
                              setMetricsList([{ id: "m-0", column: "count", agg: "COUNT" }]);
                              setPrimaryMetricCol("count");
                              setPrimaryMetricAgg("COUNT");
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                          title="Delete this metric"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-500 font-mono bg-white px-2 py-1 rounded border border-slate-200 flex items-center justify-between">
                        <span className="text-slate-400">SQL Expression:</span>
                        <span className="font-semibold text-blue-600 truncate ml-2">
                          {m.column === "count" ? "COUNT(*)" : `${m.agg}("${m.column}")`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const candidate = numericColumns.find(
                      (c) => !metricsList.some((m) => m.column === (c.column_name || c.name))
                    );
                    const colToAdd = candidate ? candidate.column_name || candidate.name : "count";
                    setMetricsList([
                      ...metricsList,
                      { id: `m-${Date.now()}-${Math.random()}`, column: colToAdd, agg: "SUM" },
                    ]);
                  }}
                  className="mt-1 flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Metric (Measure)
                </button>
              </div>

              {/* 5. Temporal Axis & Time Grain (Strictly Validated for DATE / TIMESTAMP) */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Time Column & Grain
                  </label>
                  {validTimeColumns.length === 0 && (
                    <span className="text-[10px] text-amber-600 font-medium">None in schema</span>
                  )}
                </div>

                {validTimeColumns.length > 0 ? (
                  <div className="space-y-2">
                    <select
                      value={timeColumn}
                      onChange={(e) => setTimeColumn(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-medium"
                    >
                      <option value="">None (Categorical X-Axis)</option>
                      {validTimeColumns.map((c) => {
                        const colName = c.column_name || c.name;
                        return (
                          <option key={colName} value={colName}>
                            {colName} ({c.data_type})
                          </option>
                        );
                      })}
                    </select>

                    {timeColumn && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 whitespace-nowrap">Grain:</span>
                        <select
                          value={timeGrain}
                          onChange={(e) => setTimeGrain(e.target.value)}
                          className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono"
                        >
                          <option value="hour">Hour</option>
                          <option value="day">Day</option>
                          <option value="week">Week</option>
                          <option value="month">Month</option>
                          <option value="quarter">Quarter</option>
                          <option value="year">Year</option>
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-500 italic">
                    This dataset has no detected DATE or TIMESTAMP columns. Time-based date_trunc grouping is disabled.
                  </div>
                )}
              </div>

              {/* 6. Ad-Hoc Filters */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Filters ({filters.length})
                </label>

                {filters.length > 0 && (
                  <div className="space-y-1">
                    {filters.map((f, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs bg-slate-100 p-1.5 rounded font-mono"
                      >
                        <span className="truncate">
                          {f.col} {f.op} {String(f.val)}
                        </span>
                        <button
                          onClick={() => handleRemoveFilter(idx)}
                          className="text-slate-400 hover:text-red-600 text-xs px-1"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 pt-1">
                  <select
                    value={newFilterCol}
                    onChange={(e) => setNewFilterCol(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                  >
                    <option value="">+ Add Column Filter...</option>
                    {effectiveColumns.map((c) => {
                      const colName = c.column_name || c.name;
                      return (
                        <option key={colName} value={colName}>
                          {colName} ({c.data_type})
                        </option>
                      );
                    })}
                  </select>

                  {newFilterCol && (
                    <div className="flex gap-1">
                      <select
                        value={newFilterOp}
                        onChange={(e) => setNewFilterOp(e.target.value)}
                        className="w-16 px-1 py-1 text-xs border border-slate-300 rounded bg-white font-mono"
                      >
                        <option value="==">=</option>
                        <option value="!=">!=</option>
                        <option value=">">&gt;</option>
                        <option value=">=">&gt;=</option>
                        <option value="<">&lt;</option>
                        <option value="<=">&lt;=</option>
                        <option value="LIKE">LIKE</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Filter value..."
                        value={newFilterVal}
                        onChange={(e) => setNewFilterVal(e.target.value)}
                        className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded"
                      />
                      <button
                        type="button"
                        onClick={handleAddFilter}
                        className="px-2.5 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 7. Sorting & Row Limits */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Sorting & Limits
                </label>
                <div className="space-y-1.5">
                  <div className="flex gap-1.5 items-center">
                    <select
                      value={sortColumn}
                      onChange={(e) => setSortColumn(e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-medium text-slate-800"
                    >
                      <option value="">Default Sort (First Metric)</option>
                      {effectiveColumns.map((c) => {
                        const colName = c.column_name || c.name;
                        return (
                          <option key={colName} value={colName}>
                            Sort by: {colName}
                          </option>
                        );
                      })}
                    </select>
                    <select
                      value={sortDirection}
                      onChange={(e) => setSortDirection(e.target.value as "ASC" | "DESC")}
                      className="w-20 px-1.5 py-1 text-xs border border-slate-300 rounded bg-white font-mono font-semibold"
                    >
                      <option value="DESC">DESC</option>
                      <option value="ASC">ASC</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="text-[11px] font-medium text-slate-500">Row Limit:</span>
                    <select
                      value={rowLimit}
                      onChange={(e) => setRowLimit(Number(e.target.value))}
                      className="w-24 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono"
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="250">250</option>
                      <option value="500">500</option>
                      <option value="1000">1000</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 8. Chart Customization Options */}
              {plugin?.controlPanel.options && (
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Chart Customization
                  </label>
                  {Object.entries(plugin.controlPanel.options).map(
                    ([optKey, optConfig]: [string, any]) => (
                      <div key={optKey} className="text-xs">
                        {optConfig.type === "boolean" && (
                          <label className="flex items-center gap-2 cursor-pointer text-slate-700 hover:text-slate-900">
                            <input
                              type="checkbox"
                              checked={chartOptions[optKey] ?? optConfig.default}
                              onChange={(e) =>
                                setChartOptions({ ...chartOptions, [optKey]: e.target.checked })
                              }
                              className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span>{optConfig.label}</span>
                          </label>
                        )}
                        {optConfig.type === "select" && (
                          <div>
                            <label className="block text-[11px] text-slate-600 mb-1">
                              {optConfig.label}
                            </label>
                            <select
                              value={chartOptions[optKey] ?? optConfig.default}
                              onChange={(e) =>
                                setChartOptions({ ...chartOptions, [optKey]: e.target.value })
                              }
                              className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded bg-white font-medium"
                            >
                              {optConfig.options.map((o: string) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Right Canvas / Visualization Area */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              {/* Tab Navigation: Visualization / Data Preview / SQL */}
              <div className="px-4 pt-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex gap-4">
                  <button
                    onClick={() => setActiveViewTab("chart")}
                    className={`pb-2 text-xs font-semibold border-b-2 transition ${
                      activeViewTab === "chart"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Visualization
                  </button>
                  <button
                    onClick={() => setActiveViewTab("data")}
                    className={`pb-2 text-xs font-semibold border-b-2 transition ${
                      activeViewTab === "data"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Data Preview ({chartData?.row_count ?? 0})
                  </button>
                  <button
                    onClick={() => setActiveViewTab("sql")}
                    className={`pb-2 text-xs font-semibold border-b-2 transition ${
                      activeViewTab === "sql"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Generated Dialect SQL
                  </button>
                </div>

                {chartData && (
                  <div className="flex items-center gap-2 pb-1.5 text-[11px] text-slate-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{chartData.duration_ms} ms</span>
                  </div>
                )}
              </div>

              {/* View Content Canvas */}
              <div className="flex-1 overflow-auto p-4 flex flex-col justify-center relative">
                {/* 1. Visualization Tab */}
                {activeViewTab === "chart" && (
                  <div className="h-full w-full flex flex-col justify-center relative">
                    {/* Error Banner: When query fails, display error clearly without rendering stale charts */}
                    {queryError && (
                      <div className="m-4 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-3 shadow-sm">
                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <h4 className="font-bold text-red-900">Query Execution Error</h4>
                          <p className="leading-relaxed">{queryError}</p>
                        </div>
                      </div>
                    )}

                    {/* Loading State: Prevents stale data from masquerading as fresh query result */}
                    {runQueryMutation.isPending && (
                      <div className="absolute inset-0 bg-white/80 backdrop-blur-xs z-20 flex flex-col items-center justify-center text-slate-600 text-xs">
                        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-3" />
                        <span className="font-semibold text-slate-800">
                          Executing Query Against DuckDB...
                        </span>
                        <span className="text-slate-400 mt-1">Generating live visualization</span>
                      </div>
                    )}

                    {/* Chart Render */}
                    {!queryError && plugin && chartProps ? (
                      <div className="h-full w-full">
                        <plugin.Renderer {...chartProps} />
                      </div>
                    ) : !queryError ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-16 px-4">
                        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 mb-4 border border-blue-100 shadow-sm">
                          <BarChart3 className="w-7 h-7" />
                        </div>
                        <h3 className="text-base font-semibold text-slate-800 mb-1">
                          Ready to Explore {currentDataset?.name || "Dataset"}
                        </h3>
                        <p className="text-slate-500 max-w-md text-center mb-6 leading-relaxed">
                          Selected chart:{" "}
                          <span className="font-semibold text-slate-700">
                            {plugin?.metadata.name || selectedVizType}
                          </span>
                          .
                          {selectedDimensions.length > 0 && (
                            <>
                              {" "}
                              Grouping by{" "}
                              <span className="font-semibold text-blue-700 font-mono bg-blue-50 px-1.5 py-0.5 rounded">
                                {selectedDimensions.join(", ")}
                              </span>
                              .
                            </>
                          )}
                        </p>
                        <button
                          onClick={() => runQueryMutation.mutate()}
                          disabled={runQueryMutation.isPending}
                          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow transition hover:shadow-md disabled:opacity-50"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Run Query & Generate Chart
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 2. Data Preview Tab */}
                {activeViewTab === "data" && (
                  <div className="h-full overflow-auto border border-slate-200 rounded-lg flex flex-col">
                    {workspaceSourceType === "AI_QUERY_RESULT" && aiSnapshot && (
                      <div className="p-3 bg-indigo-50/80 border-b border-indigo-100 flex items-center justify-between text-xs text-indigo-900 shrink-0">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span>
                            Displaying <strong>{chartData?.row_count ?? aiSnapshot.row_count} records</strong> returned by AI Analyst for: <em>"{aiSnapshot.question}"</em>
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200 shrink-0">
                          AI Query Result Snapshot
                        </span>
                      </div>
                    )}
                    <div className="flex-1 overflow-auto">
                      {chartData && chartData.rows.length > 0 ? (
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200 font-semibold">
                            <tr>
                              {chartData.columns.map((col) => (
                                <th key={col} className="px-3 py-2 whitespace-nowrap">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-[11px]">
                            {chartData.rows.map((row, rIdx) => (
                              <tr key={rIdx} className="hover:bg-slate-50">
                                {row.map((val, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className="px-3 py-1.5 whitespace-nowrap text-slate-800"
                                  >
                                    {val !== null && val !== undefined ? String(val) : "null"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="p-8 text-center text-slate-400 text-xs">
                          {queryError ? "Query failed. No records to display." : "No query results to display. Click 'Run Query'."}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. SQL Tab */}
                {activeViewTab === "sql" && (
                  <div className="h-full overflow-auto bg-slate-900 text-slate-100 p-4 rounded-lg font-mono text-xs space-y-3">
                    {workspaceSourceType === "AI_QUERY_RESULT" && (
                      <div className="p-2.5 bg-slate-800 border border-indigo-500/30 rounded flex items-center justify-between text-indigo-300 text-xs">
                        <span className="flex items-center gap-1.5 font-sans font-semibold">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                          AI Analyst Grounded SQL Query
                        </span>
                        <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-700 px-2 py-0.5 rounded">
                          Exact Execution
                        </span>
                      </div>
                    )}
                    {chartData?.sql ? (
                      <pre className="whitespace-pre-wrap">{chartData.sql}</pre>
                    ) : (
                      <div className="text-slate-500">Run query to view generated dialect SQL.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Save Chart Modal */}
          {isSaveModalOpen && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
                <h3 className="font-bold text-base text-slate-900">
                  {editingChartId ? "Update Chart" : "Save Chart"}
                </h3>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Chart Title *
                  </label>
                  <input
                    type="text"
                    value={chartTitle}
                    onChange={(e) => setChartTitle(e.target.value)}
                    placeholder="e.g. Salary Distribution by Department"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={chartDescription}
                    onChange={(e) => setChartDescription(e.target.value)}
                    placeholder="Optional notes or insights"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Add to Dashboard
                  </label>
                  <select
                    value={targetDashboardId}
                    onChange={(e) => setTargetDashboardId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="auto">
                      Auto-link to {currentDataset?.name ? `${currentDataset.name} Dashboard` : "Dataset Dashboard"} (Recommended)
                    </option>
                    {dashboardList.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                    <option value="none">Do not add to any dashboard</option>
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Your chart will instantly reflect as a tile in the selected dashboard.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsSaveModalOpen(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => saveChartMutation.mutate()}
                    disabled={!chartTitle.trim() || saveChartMutation.isPending}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded shadow-sm disabled:opacity-50"
                  >
                    {saveChartMutation.isPending ? "Saving..." : "Save Chart"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Floating AI Button at bottom-right dedicated to the open dataset */}
          <div className="fixed bottom-6 right-6 z-40 flex items-center">
            <button
              onClick={() => setIsDatasetAIDrawerOpen(true)}
              className="group relative flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 ring-4 ring-blue-500/20"
              title={`Ask AI about ${currentDataset?.name || "this dataset"}`}
            >
              <Sparkles className="w-5 h-5 animate-pulse text-amber-300" />
              <span className="text-xs font-bold tracking-wide">
                Ask AI: {currentDataset?.name ? currentDataset.name.slice(0, 20) : "Dataset"}
              </span>
            </button>
          </div>

          {/* Dedicated AI Drawer bound specifically to the current open dataset with key-based unmount/isolation */}
          <AIDrawer
            key={selectedDatasetId || currentDataset?.id || "empty-dataset"}
            isOpen={isDatasetAIDrawerOpen}
            onClose={() => setIsDatasetAIDrawerOpen(false)}
            datasetId={selectedDatasetId || currentDataset?.id}
            datasetName={currentDataset?.name}
          />
        </div>
      )}
    </div>
  );
};

export default ChartsPage;