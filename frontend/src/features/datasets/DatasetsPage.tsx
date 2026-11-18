import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Layers,
  Plus,
  Search,
  BarChart3,
  Trash2,
  Calendar,
  Sparkles,
  RefreshCw,
  Check,
  Activity,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Key,
  Link2,
  Database,
  X,
  Loader2,
} from "lucide-react";
import { api, DatasetItem, RowsByKeyResponse } from "@/app/api";

export const DatasetsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id: paramId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const targetId = paramId || searchParams.get("id");

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDataset, setSelectedDataset] = useState<DatasetItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<"columns" | "metrics" | "profile" | "data">("columns");
  const [pageSize, setPageSize] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortCol, setSortCol] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Key navigation & Related Records Drawer state
  const [inspectingKeyRow, setInspectingKeyRow] = useState<RowsByKeyResponse | null>(null);
  const [isLoadingKeyRow, setIsLoadingKeyRow] = useState<boolean>(false);
  const [activeChildTableTab, setActiveChildTableTab] = useState<string>("");

  const handleInspectKey = async (colName: string, val: any) => {
    if (!selectedDataset?.database_id || val === null || val === undefined) return;
    const tableIdent = selectedDataset.table_name
      ? `${selectedDataset.schema_name || "public"}.${selectedDataset.table_name}`
      : selectedDataset.name;
    try {
      setIsLoadingKeyRow(true);
      const res = await api.getRowsByKey(
        selectedDataset.database_id,
        tableIdent,
        colName,
        String(val)
      );
      setInspectingKeyRow(res);
      if (res.children && res.children.length > 0) {
        setActiveChildTableTab(res.children[0].child_table);
      } else {
        setActiveChildTableTab("");
      }
    } catch (err: any) {
      alert(`Could not fetch related records: ${err?.message || err}`);
    } finally {
      setIsLoadingKeyRow(false);
    }
  };

  // New metric form state
  const [isAddingMetric, setIsAddingMetric] = useState(false);
  const [metricForm, setMetricForm] = useState({
    metric_name: "",
    verbose_name: "",
    metric_type: "aggregate",
    sql_expression: "SUM(amount)",
    number_format: "$,.2f",
    description: "",
  });

  // Query datasets
  const { data: datasets = [], isLoading, refetch } = useQuery({
    queryKey: ["datasets"],
    queryFn: api.getDatasets,
  });

  // Query dataset profile
  const {
    data: profileData,
    isLoading: isProfileLoading,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ["datasetProfile", selectedDataset?.id],
    queryFn: () => (selectedDataset ? api.getDatasetProfile(selectedDataset.id) : Promise.resolve(null)),
    enabled: Boolean(selectedDataset && activeTab === "profile"),
  });

  // Query dataset paginated rows
  const {
    data: rowsData,
    isLoading: isRowsLoading,
  } = useQuery({
    queryKey: ["datasetRows", selectedDataset?.id, pageSize, currentPage, sortCol, sortDir],
    queryFn: () =>
      selectedDataset
        ? api.getDatasetRows(selectedDataset.id, {
            limit: pageSize,
            offset: (currentPage - 1) * pageSize,
            order_by: sortCol,
            order_dir: sortDir,
          })
        : Promise.resolve(null),
    enabled: Boolean(selectedDataset && activeTab === "data"),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDataset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      if (selectedDataset) setSelectedDataset(null);
    },
  });

  // Add metric mutation
  const addMetricMutation = useMutation({
    mutationFn: (metric: any) => {
      if (!selectedDataset) throw new Error("No dataset selected");
      return api.addDatasetMetric(selectedDataset.id, metric);
    },
    onSuccess: (newMetric) => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      if (selectedDataset) {
        setSelectedDataset({
          ...selectedDataset,
          metrics: [...(selectedDataset.metrics || []), newMetric],
        });
      }
      setIsAddingMetric(false);
      setMetricForm({
        metric_name: "",
        verbose_name: "",
        metric_type: "aggregate",
        sql_expression: "SUM(amount)",
        number_format: "$,.2f",
        description: "",
      });
    },
  });

  const handleCreateMetric = (e: React.FormEvent) => {
    e.preventDefault();
    addMetricMutation.mutate(metricForm);
  };

  const datasetList: DatasetItem[] = Array.isArray(datasets)
    ? datasets
    : (datasets as any)?.data || [];

  // Synchronize URL parameter :id or ?id= with selectedDataset modal
  useEffect(() => {
    if (!targetId || datasetList.length === 0) return;
    const match = datasetList.find(
      (d) => d.id === targetId || d.name === targetId || d.table_name === targetId
    );
    if (match) {
      setSelectedDataset(match);
    }
  }, [targetId, datasetList]);

  const filteredDatasets = datasetList.filter(
    (d) =>
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.table_name && d.table_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const isAllSelected =
    filteredDatasets.length > 0 &&
    filteredDatasets.every((d) => selectedIds.has(d.id));

  const isIndeterminate =
    selectedIds.size > 0 && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredDatasets.forEach((d) => next.delete(d.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredDatasets.forEach((d) => next.add(d.id));
        return next;
      });
    }
  };

  const handleToggleSelect = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const confirmMessage =
      count === 1
        ? "Are you sure you want to delete this dataset? This will also remove any charts created from it."
        : `Are you sure you want to delete all ${count} selected datasets? This will also remove any charts created from them.`;
    if (!window.confirm(confirmMessage)) return;

    setIsBatchDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      await api.batchDeleteDatasets(idsToDelete);
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      await queryClient.invalidateQueries({ queryKey: ["charts"] });
      if (selectedDataset && selectedIds.has(selectedDataset.id)) {
        setSelectedDataset(null);
      }
    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message || "Failed to batch delete datasets");
    } finally {
      setIsBatchDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Datasets</h1>
          <p className="text-sm text-slate-500">
            Semantic layer defining physical tables, virtual queries, dimensions, metrics, and AI permissions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => navigate("/sqllab")}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Create Virtual Dataset
          </button>
        </div>
      </div>

      {/* Filter & Bulk Actions Bar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search datasets by name or table..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg animate-in fade-in">
              <span className="text-xs font-semibold text-red-800">
                {selectedIds.size} selected
              </span>
              <button
                onClick={handleBatchDelete}
                disabled={isBatchDeleting}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm transition disabled:opacity-50"
                title="Delete all selected datasets"
              >
                {isBatchDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {selectedIds.size === filteredDatasets.length && filteredDatasets.length > 1
                  ? `Delete All (${selectedIds.size})`
                  : `Delete Selected (${selectedIds.size})`}
              </button>
              <button
                onClick={handleDeselectAll}
                className="text-xs text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-red-100/60"
              >
                Clear
              </button>
            </div>
          )}

          <div className="text-xs text-slate-500">
            Showing {filteredDatasets.length} of {datasetList.length} datasets
          </div>
        </div>
      </div>

      {/* Datasets Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
            <tr>
              <th className="px-3 py-3 w-12 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                    title={isAllSelected ? "Deselect all" : "Select all datasets"}
                  />
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleBatchDelete}
                      disabled={isBatchDeleting}
                      className="p-1 text-red-600 hover:text-red-700 hover:bg-red-100 rounded transition"
                      title={`Delete ${selectedIds.size} selected dataset(s)`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </th>
              <th className="px-4 py-3">Dataset Name</th>
              <th className="px-4 py-3">Source Table / Query</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Columns</th>
              <th className="px-4 py-3">Metrics</th>
              <th className="px-4 py-3">AI Allowed</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredDatasets.map((dataset) => {
              const isSelected = selectedIds.has(dataset.id);
              return (
                <tr
                  key={dataset.id}
                  className={`transition ${isSelected ? "bg-blue-50/70 hover:bg-blue-50" : "hover:bg-slate-50"}`}
                >
                  <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(dataset.id)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      title={isSelected ? "Deselect dataset" : "Select dataset"}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <button
                      onClick={() => setSelectedDataset(dataset)}
                      className="hover:text-blue-600 text-left font-semibold flex items-center gap-2"
                    >
                      <Layers className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <span>{dataset.name}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {dataset.is_virtual ? "Virtual SQL" : dataset.table_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                        dataset.is_virtual
                          ? "bg-purple-100 text-purple-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {dataset.is_virtual ? "Virtual" : "Physical"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {dataset.columns?.length || 0}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {dataset.metrics?.length || 0}
                  </td>
                  <td className="px-4 py-3">
                    {dataset.is_ai_enabled ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-green-700 font-medium">
                        <Sparkles className="w-3 h-3 text-green-600" />
                        Enabled
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedDataset(dataset)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded transition"
                      >
                        Detail
                      </button>
                      <button
                        onClick={() => navigate(`/charts?dataset=${dataset.id}`)}
                        className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition flex items-center gap-1"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        Explore
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete dataset '${dataset.name}'?`)) {
                            deleteMutation.mutate(dataset.id);
                          }
                        }}
                        className="text-slate-400 hover:text-red-600 p-1 rounded transition"
                        title="Delete dataset"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredDatasets.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-xs">
                  No datasets found. Import a file or register a table in SQL Lab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dataset Detail Drawer / Modal */}
      {selectedDataset && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-blue-600" />
                  Dataset: {selectedDataset.name}
                </h2>
                <p className="text-xs text-slate-500">
                  Target: {selectedDataset.table_name || "Virtual SQL"} • Schema: {selectedDataset.schema_name || "main"}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedDataset(null);
                  if (paramId) navigate("/datasets");
                }}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="px-6 pt-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab("columns")}
                  className={`pb-2 text-xs font-semibold border-b-2 transition ${
                    activeTab === "columns"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Columns ({selectedDataset.columns?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("metrics")}
                  className={`pb-2 text-xs font-semibold border-b-2 transition ${
                    activeTab === "metrics"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Custom Metrics ({selectedDataset.metrics?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("profile")}
                  className={`pb-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                    activeTab === "profile"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Profile
                </button>
                <button
                  onClick={() => {
                    setActiveTab("data");
                    setCurrentPage(1);
                  }}
                  className={`pb-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                    activeTab === "data"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <TableIcon className="w-3.5 h-3.5" />
                  Data
                </button>
              </div>

              {activeTab === "metrics" && (
                <button
                  onClick={() => setIsAddingMetric(true)}
                  className="mb-2 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Metric
                </button>
              )}
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === "columns" && (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                      <tr>
                        <th className="px-3 py-2">Column</th>
                        <th className="px-3 py-2">Data Type</th>
                        <th className="px-3 py-2">Datetime</th>
                        <th className="px-3 py-2">Filterable</th>
                        <th className="px-3 py-2">Groupable</th>
                        <th className="px-3 py-2">Hidden from AI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedDataset.columns?.map((col) => (
                        <tr key={col.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono font-medium text-slate-800">
                            {col.column_name}
                          </td>
                          <td className="px-3 py-2 text-slate-600 font-mono">{col.data_type}</td>
                          <td className="px-3 py-2">
                            {col.is_datetime ? (
                              <Calendar className="w-3.5 h-3.5 text-blue-600" />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {col.is_filterable ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {col.is_groupable ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {col.is_hidden_from_ai ? (
                              <span className="px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 font-bold rounded">
                                Hidden
                              </span>
                            ) : (
                              <span className="text-green-600">Visible</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === "metrics" && (
                <div className="space-y-4">
                  {isAddingMetric && (
                    <form
                      onSubmit={handleCreateMetric}
                      className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3"
                    >
                      <h4 className="text-xs font-bold text-blue-900 uppercase">
                        Define SQL Aggregate Metric
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-blue-800 mb-1">
                            Metric Identifier *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. total_revenue"
                            value={metricForm.metric_name}
                            onChange={(e) =>
                              setMetricForm({ ...metricForm, metric_name: e.target.value })
                            }
                            className="w-full px-2.5 py-1 text-xs border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-blue-800 mb-1">
                            Display Label
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Total Revenue ($)"
                            value={metricForm.verbose_name}
                            onChange={(e) =>
                              setMetricForm({ ...metricForm, verbose_name: e.target.value })
                            }
                            className="w-full px-2.5 py-1 text-xs border border-blue-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[11px] font-medium text-blue-800 mb-1">
                            SQL Expression *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. SUM(amount * quantity)"
                            value={metricForm.sql_expression}
                            onChange={(e) =>
                              setMetricForm({ ...metricForm, sql_expression: e.target.value })
                            }
                            className="w-full px-2.5 py-1 text-xs border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-blue-800 mb-1">
                            Format String
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. $,0.2f"
                            value={metricForm.number_format}
                            onChange={(e) =>
                              setMetricForm({ ...metricForm, number_format: e.target.value })
                            }
                            className="w-full px-2.5 py-1 text-xs border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setIsAddingMetric(false)}
                          className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={addMetricMutation.isPending}
                          className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded shadow-sm"
                        >
                          {addMetricMutation.isPending ? "Saving..." : "Save Metric"}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                        <tr>
                          <th className="px-3 py-2">Metric Name</th>
                          <th className="px-3 py-2">SQL Expression</th>
                          <th className="px-3 py-2">Format</th>
                          <th className="px-3 py-2">Verbose Name</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedDataset.metrics?.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono font-medium text-slate-800">
                              {m.metric_name}
                            </td>
                            <td className="px-3 py-2 font-mono text-blue-700">
                              {m.sql_expression}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-600">
                              {m.number_format || "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {m.verbose_name || "—"}
                            </td>
                          </tr>
                        ))}
                        {(!selectedDataset.metrics || selectedDataset.metrics.length === 0) && (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-slate-400 text-xs">
                              No metrics defined yet. Click "Add Metric" to define calculated aggregates.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Profile Tab */}
              {activeTab === "profile" && (
                <div className="space-y-4">
                  {isProfileLoading ? (
                    <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                      <p className="text-sm font-medium">Computing statistical profile across records...</p>
                    </div>
                  ) : profileData ? (
                    <div className="space-y-4">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase block">Total Records</span>
                          <span className="text-xl font-bold text-slate-900 font-mono">
                            {profileData.total_rows.toLocaleString()}
                          </span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <span className="text-[11px] font-semibold text-slate-500 uppercase block">Total Columns</span>
                          <span className="text-xl font-bold text-slate-900 font-mono">
                            {profileData.columns.length}
                          </span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase block">Profile Cache</span>
                            <span className="text-xs text-green-700 font-medium">Active (300s TTL)</span>
                          </div>
                          <button
                            onClick={() => refetchProfile()}
                            className="px-2 py-1 text-xs bg-white border border-slate-200 rounded hover:bg-slate-100 flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Refresh
                          </button>
                        </div>
                      </div>

                      {/* Columns Profile Table */}
                      <div className="border border-slate-200 rounded-lg overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                            <tr>
                              <th className="px-3 py-2">Column</th>
                              <th className="px-3 py-2">Type</th>
                              <th className="px-3 py-2">Nulls</th>
                              <th className="px-3 py-2">Distinct</th>
                              <th className="px-3 py-2">Min / Max / Avg</th>
                              <th className="px-3 py-2">Top 5 Values</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {profileData.columns.map((col) => (
                              <tr key={col.name} className="hover:bg-slate-50">
                                <td className="px-3 py-2.5 font-mono font-medium text-slate-800">
                                  {col.name}
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                                    {col.data_type}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                                      col.null_count === 0
                                        ? "bg-green-50 text-green-700"
                                        : "bg-amber-50 text-amber-700"
                                    }`}
                                  >
                                    {col.null_count.toLocaleString()} ({col.null_percentage}%)
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 font-mono text-slate-700">
                                  {col.distinct_count.toLocaleString()}
                                </td>
                                <td className="px-3 py-2.5 font-mono text-slate-600">
                                  {col.min !== null || col.max !== null || col.avg !== null ? (
                                    <div className="space-y-0.5 text-[11px]">
                                      <div>Min: <span className="text-slate-900 font-semibold">{col.min}</span></div>
                                      <div>Max: <span className="text-slate-900 font-semibold">{col.max}</span></div>
                                      <div>Avg: <span className="text-blue-700 font-semibold">{col.avg}</span></div>
                                    </div>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5">
                                  {col.top_values && col.top_values.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 max-w-xs">
                                      {col.top_values.map((tv, idx) => (
                                        <span
                                          key={idx}
                                          className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px]"
                                        >
                                          <span className="font-medium truncate max-w-[100px]">{tv.value}</span>
                                          <span className="text-slate-400 font-mono">({tv.count})</span>
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      Failed to load statistical profile.
                    </div>
                  )}
                </div>
              )}

              {/* Data Tab (Server-side Paginated Rows) */}
              {activeTab === "data" && (
                <div className="space-y-4">
                  {/* Data Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500 font-medium">Rows per page:</label>
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white font-medium"
                      >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={500}>500</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">
                        {rowsData && rowsData.total > 0 ? (
                          <>
                            Showing{" "}
                            <span className="font-medium text-slate-800">
                              {((currentPage - 1) * pageSize + 1).toLocaleString()}
                            </span>{" "}
                            –{" "}
                            <span className="font-medium text-slate-800">
                              {Math.min(rowsData.total, currentPage * pageSize).toLocaleString()}
                            </span>{" "}
                            of{" "}
                            <span className="font-medium text-slate-800 font-mono">
                              {rowsData.total.toLocaleString()}
                            </span>{" "}
                            rows
                          </>
                        ) : (
                          "0 rows"
                        )}
                      </span>

                      {/* Pagination buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage <= 1 || isRowsLoading}
                          className="p-1 text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Previous page"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-medium px-2 text-slate-700">
                          Page {currentPage} of {rowsData?.total_pages || 1}
                        </span>
                        <button
                          onClick={() =>
                            setCurrentPage((p) => Math.min(rowsData?.total_pages || 1, p + 1))
                          }
                          disabled={!rowsData || currentPage >= rowsData.total_pages || isRowsLoading}
                          className="p-1 text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Next page"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Table Grid */}
                  {isRowsLoading ? (
                    <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                      <p className="text-sm font-medium">Fetching page data...</p>
                    </div>
                  ) : rowsData && rowsData.rows && rowsData.rows.length > 0 ? (
                    <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-[50vh]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold sticky top-0 shadow-sm z-10">
                          <tr>
                            <th className="px-3 py-2 text-slate-400 font-mono text-[10px]">#</th>
                            {rowsData.columns.map((colName) => (
                              <th
                                key={colName}
                                onClick={() => {
                                  if (sortCol === colName) {
                                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                                  } else {
                                    setSortCol(colName);
                                    setSortDir("asc");
                                  }
                                }}
                                className="px-3 py-2 cursor-pointer hover:bg-slate-100 transition select-none"
                              >
                                <div className="flex items-center gap-1">
                                  <span>{colName}</span>
                                  <ArrowUpDown
                                    className={`w-3 h-3 ${
                                      sortCol === colName ? "text-blue-600" : "text-slate-300"
                                    }`}
                                  />
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rowsData.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-blue-50/50 transition">
                              <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400">
                                {((currentPage - 1) * pageSize + rIdx + 1).toLocaleString()}
                              </td>
                              {row.map((val, cIdx) => {
                                const colName = rowsData.columns[cIdx] || "";
                                const isKeyCol =
                                  selectedDataset &&
                                  !selectedDataset.is_virtual &&
                                  selectedDataset.table_name &&
                                  (colName.toLowerCase().endsWith("_id") ||
                                    colName.toLowerCase().startsWith("id_") ||
                                    colName.toLowerCase() === "id" ||
                                    colName.toLowerCase() === "key" ||
                                    colName.toLowerCase() === "code");

                                return (
                                  <td
                                    key={cIdx}
                                    className="px-3 py-1.5 font-mono text-slate-700 truncate max-w-[200px]"
                                    title={String(val ?? "")}
                                  >
                                    {val === null || val === undefined ? (
                                      <span className="text-slate-300 italic">null</span>
                                    ) : isKeyCol ? (
                                      <button
                                        type="button"
                                        onClick={() => handleInspectKey(colName, val)}
                                        title={`Lookup record and related foreign key rows for ${colName}=${val}`}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-900 border border-blue-200 transition"
                                      >
                                        <Link2 className="h-2.5 w-2.5 text-blue-600" />
                                        {String(val)}
                                      </button>
                                    ) : (
                                      String(val)
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      No rows returned for this dataset.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                onClick={() => {
                  if (confirm(`Delete dataset '${selectedDataset.name}'?`)) {
                    deleteMutation.mutate(selectedDataset.id);
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Dataset
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/charts?dataset=${selectedDataset.id}`)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition flex items-center gap-1.5 shadow-sm"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Explore in Chart Builder
                </button>
                <button
                  onClick={() => {
                    setSelectedDataset(null);
                    if (paramId) navigate("/datasets");
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Related Records Inspector Drawer */}
      {inspectingKeyRow && (
        <div className="fixed inset-y-0 right-0 z-60 w-full max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1 rounded bg-blue-100 text-blue-700">
                  <Database className="h-4 w-4" />
                </span>
                <h4 className="font-bold text-sm text-slate-900">
                  {inspectingKeyRow.table} Record Inspector
                </h4>
                {isLoadingKeyRow && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                Key: {inspectingKeyRow.key_columns.join(", ")} = {inspectingKeyRow.key_values.join(", ")}
              </p>
            </div>
            <button
              onClick={() => setInspectingKeyRow(null)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Target Row Record */}
            <div>
              <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5 text-amber-500" />
                Target Row Details
              </h5>
              {inspectingKeyRow.row ? (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(inspectingKeyRow.row).map(([col, val]) => (
                        <tr key={col} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5 font-semibold text-slate-600 bg-slate-50/50 w-1/3 font-mono text-[11px]">
                            {col}
                          </td>
                          <td className="px-3 py-1.5 text-slate-800 font-mono text-[11px] break-all">
                            {val === null || val === undefined ? (
                              <span className="text-slate-300 italic">NULL</span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-amber-50 text-amber-800 text-xs">
                  No row found with {inspectingKeyRow.key_columns.join(", ")} = {inspectingKeyRow.key_values.join(", ")}
                </div>
              )}
            </div>

            {/* Parent Records */}
            {inspectingKeyRow.parents && inspectingKeyRow.parents.length > 0 && (
              <div>
                <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-blue-500" />
                  Parent Referenced Records ({inspectingKeyRow.parents.length})
                </h5>
                <div className="space-y-2">
                  {inspectingKeyRow.parents.map((p, idx) => (
                    <div key={idx} className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-semibold text-slate-800">
                        <span className="font-mono text-blue-700">{p.parent_table}</span>
                        <span className="text-[10px] text-slate-400 font-normal font-mono">
                          via {p.fk_columns.join(",")} -&gt; {p.referred_columns.join(",")}
                        </span>
                      </div>
                      {p.row ? (
                        <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono bg-white p-2 rounded border border-slate-200/80">
                          {Object.entries(p.row).slice(0, 6).map(([k, v]) => (
                            <div key={k} className="truncate">
                              <span className="text-slate-400">{k}:</span> <span className="text-slate-700 font-semibold">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic">No referenced record found.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Child Records */}
            {inspectingKeyRow.children && inspectingKeyRow.children.length > 0 && (
              <div>
                <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-purple-500" />
                  Related Child Records ({inspectingKeyRow.children.reduce((s, c) => s + c.count, 0)})
                </h5>

                <div className="flex items-center gap-1 border-b border-slate-200 mb-2 overflow-x-auto">
                  {inspectingKeyRow.children.map((child) => (
                    <button
                      key={child.child_table}
                      type="button"
                      onClick={() => setActiveChildTableTab(child.child_table)}
                      className={`px-3 py-1.5 text-xs font-medium border-b-2 whitespace-nowrap transition ${
                        activeChildTableTab === child.child_table
                          ? "border-blue-600 text-blue-600 bg-blue-50/50 font-bold"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {child.child_table} ({child.count})
                    </button>
                  ))}
                </div>

                {(() => {
                  const activeChild = inspectingKeyRow.children.find((c) => c.child_table === activeChildTableTab);
                  if (!activeChild) return null;
                  if (activeChild.count === 0) {
                    return (
                      <p className="p-3 rounded-lg bg-slate-50 text-slate-400 text-xs italic">
                        0 related records found in {activeChild.child_table}.
                      </p>
                    );
                  }
                  return (
                    <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-52">
                      <table className="w-full text-left text-[11px] font-mono">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            {activeChild.columns.map((c) => (
                              <th key={c} className="px-2.5 py-1.5 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {activeChild.rows.map((r, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50">
                              {r.map((v, cIdx) => (
                                <td key={cIdx} className="px-2.5 py-1 whitespace-nowrap text-slate-700">
                                  {v === null ? <span className="text-slate-300 italic">NULL</span> : String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
            <button
              type="button"
              onClick={() => setInspectingKeyRow(null)}
              className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default DatasetsPage;
