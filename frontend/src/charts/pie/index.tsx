import React from "react";
import ReactECharts from "echarts-for-react";
import { ChartPlugin, ChartMetadata, ControlPanelSchema, ChartQueryPayload } from "../types";

export interface PieChartProps {
  option: any;
  height?: number | string;
}

const metadata: ChartMetadata = {
  id: "pie",
  name: "Pie / Donut Chart",
  description: "Display proportion and composition of a whole.",
  tier: 1,
  category: "composition",
  iconName: "PieChart",
  supportedDataTypes: { dimensions: 1, metrics: 1 },
};

const controlPanel: ControlPanelSchema = {
  dimensions: { label: "Category / Slice", multi: false, required: true },
  metrics: { label: "Metric / Value", multi: false, required: true },
  options: {
    donut: { type: "boolean", label: "Donut Mode (Hollow Center)", default: true },
    roseType: { type: "boolean", label: "Nightingale Rose Style", default: false },
    showLegend: { type: "boolean", label: "Show Legend", default: true },
  },
};

const buildQuery = (formValues: Record<string, any>): ChartQueryPayload => {
  return {
    dataset_id: formValues.dataset_id,
    dimensions: formValues.dimension ? [formValues.dimension] : [],
    metrics: formValues.metrics || [],
    filters: formValues.filters || [],
    row_limit: formValues.row_limit || 20,
  };
};

const transformProps = (
  queryResult: { columns: string[]; rows: any[][] },
  options: Record<string, any> = {}
): PieChartProps => {
  const { columns, rows } = queryResult;
  if (!rows || rows.length === 0 || columns.length < 2) {
    return { option: { title: { text: "No data available", left: "center", top: "center" } } };
  }

  // Find metric column index: last column or column matching options.metrics
  let metricIdx = -1;
  if (Array.isArray(options.metrics) && options.metrics.length > 0) {
    const mNames = options.metrics.map((m: any) =>
      (typeof m === "string" ? m : m.name || m.label || m.column || "").toLowerCase()
    );
    metricIdx = columns.findIndex((c) => mNames.includes(c.toLowerCase()));
  }

  // Fallback: look for a numeric column or default to last column
  if (metricIdx === -1) {
    for (let i = columns.length - 1; i >= 0; i--) {
      const val = rows[0]?.[i];
      if (typeof val === "number" || (!isNaN(Number(val)) && val !== null && val !== "" && typeof val !== "boolean")) {
        metricIdx = i;
        break;
      }
    }
    if (metricIdx === -1) metricIdx = columns.length - 1;
  }

  // Dimension indices: all columns other than metricIdx
  const dimIndices = columns.map((_, i) => i).filter((i) => i !== metricIdx);

  const pieData = rows.map((r) => {
    const sliceLabel = dimIndices
      .map((i) => (r[i] === null || r[i] === undefined ? "null" : String(r[i])))
      .join(" - ");
    const rawVal = r[metricIdx];
    const numVal = typeof rawVal === "number" ? rawVal : Number(rawVal);
    return {
      name: sliceLabel || "Slice",
      value: isNaN(numVal) ? 0 : numVal,
    };
  });

  const isDonut = options.donut !== false;
  const radius = isDonut ? ["38%", "68%"] : "68%";

  const option = {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend:
      options.showLegend !== false
        ? {
            type: "scroll",
            orient: "vertical",
            right: 16,
            top: 24,
            bottom: 24,
            pageButtonPosition: "end",
            textStyle: { fontSize: 11, color: "#475569" },
          }
        : undefined,
    series: [
      {
        name: columns[metricIdx] || "Metric",
        type: "pie",
        radius,
        center: options.showLegend !== false ? ["40%", "50%"] : ["50%", "50%"],
        roseType: options.roseType ? "radius" : undefined,
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: rows.length <= 15,
          formatter: "{b}: {d}%",
        },
        data: pieData,
      },
    ],
  };

  return { option };
};

const Renderer: React.FC<PieChartProps> = ({ option, height = 400 }) => {
  return (
    <div style={{ height, width: "100%", minHeight: 350 }}>
      <ReactECharts
        option={option}
        style={{ height: "100%", width: "100%" }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
};

export const pieChartPlugin: ChartPlugin<PieChartProps> = {
  metadata,
  controlPanel,
  buildQuery,
  transformProps,
  Renderer,
};
export default pieChartPlugin;

