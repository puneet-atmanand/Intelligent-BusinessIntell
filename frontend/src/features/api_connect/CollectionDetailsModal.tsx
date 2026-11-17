import { useState, useEffect } from "react";
import {
  Folder,
  X,
  Terminal,
  BarChart3,
  RefreshCw,
  Trash2,
  GitMerge,
  Loader2,
  CheckCircle2,
  Copy,
  Plus,
  Database,
  AlertCircle,
  CheckCircle,
  Clock,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ApiCollectionWithTables, ApiDatasetTable } from "@/app/api";

interface CollectionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string | null;
  onRefreshCollectionList: () => void;
  onOpenExplorerForCollection?: (colId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function CollectionDetailsModal({
  isOpen,
  onClose,
  collectionId,
  onRefreshCollectionList,
}: CollectionDetailsModalProps) {
  const navigate = useNavigate();

  const [collection, setCollection] = useState<ApiCollectionWithTables | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingTableId, setRefreshingTableId] = useState<string | null>(null);
  const [visualizingTableId, setVisualizingTableId] = useState<string | null>(null);
  const [copiedQuery, setCopiedQuery] = useState(false);

  // Cross-Endpoint Join Assistant state
  const [table1Id, setTable1Id] = useState<string>("");
  const [table2Id, setTable2Id] = useState<string>("");
  const [joinKey, setJoinKey] = useState<string>("");
  const [joinType, setJoinType] = useState<"INNER JOIN" | "LEFT JOIN" | "FULL OUTER JOIN">("INNER JOIN");

  useEffect(() => {
    if (collectionId && isOpen) {
      loadCollection();
    } else {
      setCollection(null);
    }
  }, [collectionId, isOpen]);

  const loadCollection = async () => {
    if (!collectionId) return;
    try {
      setLoading(true);
      const res = await api.getApiCollection(collectionId);
      setCollection(res);
      if (res.tables && res.tables.length >= 2) {
        setTable1Id(res.tables[0].id);
        setTable2Id(res.tables[1].id);
      } else if (res.tables && res.tables.length === 1) {
        setTable1Id(res.tables[0].id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const getTablePhysicalName = (tbl: ApiDatasetTable) => {
    const colSlug = (collection?.name || "api").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    const tblSlug = tbl.table_name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return `api_${colSlug}_${tblSlug}`;
  };

  const handleRefreshTable = async (tableId: string) => {
    try {
      setRefreshingTableId(tableId);
      await api.refreshApiTable(tableId);
      await loadCollection();
      onRefreshCollectionList();
    } catch {
      // ignore
    } finally {
      setRefreshingTableId(null);
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!confirm("Are you sure you want to delete this API table and its DuckDB storage?")) return;
    try {
      await api.deleteApiTable(tableId);
      await loadCollection();
      onRefreshCollectionList();
    } catch {
      // ignore
    }
  };

  const handleCreateChart = async (tbl: ApiDatasetTable) => {
    try {
      setVisualizingTableId(tbl.id);
      const res = await api.visualizeApiTable(tbl.id);
      onClose();
      const targetDatasetId = res.dataset_id || tbl.semantic_dataset_id;
      const targetChartId = res.primary_chart_id;
      if (targetChartId) {
        navigate(`/charts?dataset=${targetDatasetId}&chart_id=${targetChartId}`);
      } else if (targetDatasetId) {
        navigate(`/charts?dataset=${targetDatasetId}`);
      } else {
        navigate("/charts");
      }
    } catch (err) {
      console.error("Failed to create visualizations:", err);
      // Fallback: navigate to chart builder
      onClose();
      if (tbl.semantic_dataset_id) {
        navigate(`/charts?dataset=${tbl.semantic_dataset_id}`);
      } else {
        navigate("/charts");
      }
    } finally {
      setVisualizingTableId(null);
    }
  };

  const handleSqlLab = (tbl: ApiDatasetTable) => {
    const phys = getTablePhysicalName(tbl);
    onClose();
    navigate("/sqllab", {
      state: { initialSql: `SELECT * FROM ${phys} LIMIT 50;` },
    });
  };

  if (!isOpen) return null;

  const tables = collection?.tables || [];
  const t1 = tables.find((t) => t.id === table1Id);
  const t2 = tables.find((t) => t.id === table2Id);

  const t1Cols = Object.keys(t1?.schema_metadata || {});
  const t2Cols = Object.keys(t2?.schema_metadata || {});
  const commonCols = t1Cols.filter((c) => t2Cols.includes(c));
  const activeJoinKey = joinKey || commonCols[0] || (t1Cols.length > 0 ? t1Cols[0] : "id");

  const generatedJoinSql =
    t1 && t2
      ? `SELECT\n  t1.*,\n  t2.*\nFROM ${getTablePhysicalName(t1)} AS t1\n${joinType} ${getTablePhysicalName(t2)} AS t2\n  ON t1.${activeJoinKey} = t2.${activeJoinKey}\nLIMIT 100;`
      : "";

  const handleOpenJoinInSqlLab = () => {
    if (!generatedJoinSql) return;
    onClose();
    navigate("/sqllab", { state: { initialSql: generatedJoinSql } });
  };

  const handleCopySql = () => {
    if (!generatedJoinSql) return;
    navigator.clipboard.writeText(generatedJoinSql);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  // Compute stats
  const totalRows = tables.reduce((sum, t) => sum + (t.record_count || 0), 0);
  const totalParquetBytes = tables.reduce((sum, t) => sum + ((t as any).parquet_size_bytes || 0), 0);
  const hasErrors = tables.some((t) => t.materialization_status === "error");
  const allReady = tables.every((t) => t.materialization_status === "ready");
  const syncHealth = hasErrors ? "Failed" : allReady ? "Healthy" : "Syncing";

  const tableCountLabel = `${tables.length} endpoint ${tables.length === 1 ? "table" : "tables"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-4 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 flex-shrink-0">
              <Folder className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-lg text-slate-900">
                  {collection?.name || "Collection Details"}
                </h3>
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                  {tableCountLabel}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {collection?.description || "Logical collection grouping multiple analytical API endpoints in DuckDB."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <button
              type="button"
              onClick={() => {
                // Open Creator Modal for this collection - close details first
                onClose();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow transition"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Endpoint to Collection
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && !collection ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="h-7 w-7 animate-spin text-primary mb-2" />
              <p className="text-xs">Loading collection...</p>
            </div>
          ) : (
            <>
              {/* Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100 border-b border-slate-100">
                {/* Endpoint Tables */}
                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                    <Database className="h-3.5 w-3.5" />
                    Endpoint Tables
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{tables.length}</div>
                </div>
                {/* Total Rows */}
                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Total Rows
                  </div>
                  <div className="text-2xl font-bold text-slate-900">{totalRows.toLocaleString()}</div>
                </div>
                {/* Parquet Size */}
                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                    <Database className="h-3.5 w-3.5" />
                    Parquet Size
                  </div>
                  <div className="text-2xl font-bold text-slate-900">
                    {totalParquetBytes > 0 ? formatBytes(totalParquetBytes) : "—"}
                  </div>
                </div>
                {/* Sync Health */}
                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
                    {hasErrors ? (
                      <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                    Sync Health
                  </div>
                  <div
                    className={`text-2xl font-bold ${
                      hasErrors ? "text-red-500" : allReady ? "text-emerald-500" : "text-amber-500"
                    }`}
                  >
                    {syncHealth}
                  </div>
                </div>
              </div>

              {/* Endpoint Tables Section */}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <Database className="h-3.5 w-3.5" />
                    Endpoint Tables in this Collection
                  </div>
                  <button
                    type="button"
                    onClick={loadCollection}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </button>
                </div>

                {tables.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl text-xs text-slate-400 italic">
                    No endpoint tables created in this collection yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tables.map((tbl) => {
                      const phys = getTablePhysicalName(tbl);
                      const isRefreshing = refreshingTableId === tbl.id || tbl.materialization_status === "syncing";
                      const isVisualizing = visualizingTableId === tbl.id;
                      const statusOk = tbl.materialization_status === "ready";
                      const statusFail = tbl.materialization_status === "error" || tbl.materialization_status === "failed";

                      return (
                        <div
                          key={tbl.id}
                          className="flex items-start justify-between p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50 transition"
                        >
                          {/* Left: table info */}
                          <div className="flex-1 min-w-0">
                            {/* Row 1: Name + identifiers */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-slate-900">{tbl.display_name}</span>
                              <code className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-blue-50 text-blue-600 border border-blue-100">
                                {phys}
                              </code>
                              {(tbl as any).endpoint_method && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-600 border border-emerald-100">
                                  {(tbl as any).endpoint_method}
                                </span>
                              )}
                            </div>
                            {/* Row 2: path + stats + status + time */}
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {(tbl as any).endpoint_path && (
                                <span className="text-[11px] font-mono text-slate-500 truncate max-w-[200px]">
                                  {(tbl as any).endpoint_path}
                                </span>
                              )}
                              <span className="text-[11px] text-slate-400">•</span>
                              <span className="text-[11px] text-slate-500">
                                {tbl.record_count.toLocaleString()} rows
                              </span>
                              <span className="text-[11px] text-slate-400">•</span>
                              <span
                                className={`text-[11px] font-semibold ${
                                  statusOk ? "text-emerald-600" : statusFail ? "text-red-500" : "text-amber-500"
                                }`}
                              >
                                {statusOk ? "Ready" : statusFail ? "Failed" : tbl.materialization_status}
                              </span>
                              {tbl.last_synced_at && (
                                <>
                                  <span className="text-[11px] text-slate-400">•</span>
                                  <span className="flex items-center gap-1 text-[11px] text-slate-400">
                                    <Clock className="h-3 w-3" />
                                    {new Date(tbl.last_synced_at).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Right: Action buttons */}
                          <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
                            {/* Create Chart (green button) */}
                            <button
                              type="button"
                              disabled={isVisualizing}
                              onClick={() => handleCreateChart(tbl)}
                              title="Create Chart for Dashboard"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 transition shadow-sm"
                            >
                              {isVisualizing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <BarChart3 className="h-3.5 w-3.5" />
                              )}
                              {isVisualizing ? "Generating..." : "Create Chart"}
                            </button>

                            {/* SQL Lab (outlined button) */}
                            <button
                              type="button"
                              onClick={() => handleSqlLab(tbl)}
                              title="Open in SQL Lab"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 hover:border-slate-400 transition"
                            >
                              <Terminal className="h-3.5 w-3.5" />
                              SQL Lab
                            </button>

                            {/* Refresh */}
                            <button
                              type="button"
                              disabled={isRefreshing}
                              onClick={() => handleRefreshTable(tbl.id)}
                              title="Refresh / Sync"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 disabled:opacity-50 transition"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-primary" : ""}`} />
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => handleDeleteTable(tbl.id)}
                              title="Delete Table"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Cross-Endpoint SQL Join Assistant (only when 2+ tables) */}
              {tables.length >= 2 && (
                <div className="mx-5 mb-5 p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                        <GitMerge className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                          Cross-Endpoint SQL Join Assistant
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Join related REST endpoint tables natively in DuckDB
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenJoinInSqlLab}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow transition"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                      Open Join in SQL Lab
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Left Table (t1)</label>
                      <select
                        value={table1Id}
                        onChange={(e) => setTable1Id(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-200 outline-none font-medium"
                      >
                        {tables.map((t) => (
                          <option key={t.id} value={t.id}>{t.display_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Join Type</label>
                      <select
                        value={joinType}
                        onChange={(e) => setJoinType(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-200 outline-none font-medium"
                      >
                        <option value="INNER JOIN">INNER JOIN</option>
                        <option value="LEFT JOIN">LEFT JOIN</option>
                        <option value="FULL OUTER JOIN">FULL OUTER JOIN</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Right Table (t2)</label>
                      <select
                        value={table2Id}
                        onChange={(e) => setTable2Id(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-200 outline-none font-medium"
                      >
                        {tables.map((t) => (
                          <option key={t.id} value={t.id}>{t.display_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Join Key</label>
                      <select
                        value={activeJoinKey}
                        onChange={(e) => setJoinKey(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white border border-slate-200 outline-none font-mono"
                      >
                        {commonCols.map((c) => (
                          <option key={c} value={c}>{c} (auto-matched)</option>
                        ))}
                        {commonCols.length === 0 &&
                          t1Cols.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="relative">
                    <pre className="p-3 rounded-lg bg-white border border-slate-200 text-[11px] font-mono text-slate-700 overflow-x-auto leading-relaxed">
                      {generatedJoinSql}
                    </pre>
                    <button
                      type="button"
                      onClick={handleCopySql}
                      className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition border border-slate-200"
                    >
                      {copiedQuery ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      {copiedQuery ? "Copied" : "Copy SQL"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
          <span className="text-xs text-slate-400">
            {collection?.created_at
              ? `Created ${new Date(collection.created_at).toLocaleDateString()}`
              : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
