import { useState, useEffect, FormEvent } from "react";
import {
  Database,
  X,
  Loader2,
  FolderPlus,
  CheckCircle2,
  ArrowRight,
  BarChart3,
  Terminal,
  AlertCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ApiConnection, ApiDatasetCollection } from "@/app/api";

interface DatasetCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  connections: ApiConnection[];
  collections: ApiDatasetCollection[];
  onOpenCreateCollection: () => void;
  onSuccess: (newTable: any) => void;
  initialEndpointState?: {
    connectionId?: string;
    path: string;
    method: string;
    headers: Record<string, string>;
    queryParams: Record<string, any>;
    body?: string;
    responsePath?: string;
    detectedSchema: Record<string, string>;
    previewRecords: Record<string, any>[];
  } | null;
}

export function DatasetCreatorModal({
  isOpen,
  onClose,
  connections,
  collections,
  onOpenCreateCollection,
  onSuccess,
  initialEndpointState,
}: DatasetCreatorModalProps) {
  const navigate = useNavigate();

  const [collectionId, setCollectionId] = useState<string>("");
  const [connectionId, setConnectionId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [tableName, setTableName] = useState<string>("");
  const [storageMode, setStorageMode] = useState<"materialized" | "live">("materialized");
  const [autoMaterialize, setAutoMaterialize] = useState<boolean>(true);
  const [cronSchedule, setCronSchedule] = useState<string>("manual");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{
    tableId: string;
    tableName: string;
    physicalTableName: string;
    semanticDatasetId?: string;
    dashboardId?: string;
    recordCount: number;
  } | null>(null);

  useEffect(() => {
    if (initialEndpointState) {
      if (initialEndpointState.connectionId) {
        setConnectionId(initialEndpointState.connectionId);
      } else if (connections.length > 0) {
        setConnectionId(connections[0].id);
      }

      // Infer clean name from path e.g. /v1/products -> Products
      const segments = initialEndpointState.path.split("/").filter(Boolean);
      const lastSeg = segments[segments.length - 1] || "dataset";
      const cleanDisplay = lastSeg.replace(/[^a-zA-Z0-9]+/g, " ").trim();
      const titleDisplay = cleanDisplay
        ? cleanDisplay.charAt(0).toUpperCase() + cleanDisplay.slice(1)
        : "API Table";

      setDisplayName(titleDisplay);
      setTableName(cleanDisplay.toLowerCase().replace(/\s+/g, "_") || "api_table");
    } else {
      if (connections.length > 0) setConnectionId(connections[0].id);
      setDisplayName("");
      setTableName("");
    }
    if (collections.length > 0 && !collectionId) {
      setCollectionId(collections[0].id);
    }
    setCreatedResult(null);
    setError(null);
  }, [initialEndpointState, connections, collections, isOpen]);

  if (!isOpen) return null;

  const sanitizeSlug = (val: string) => {
    return val.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  };

  const handleDisplayNameChange = (val: string) => {
    setDisplayName(val);
    setTableName(sanitizeSlug(val));
  };

  const selectedCol = collections.find((c) => c.id === collectionId);
  const colSlug = sanitizeSlug(selectedCol?.name || "collection");
  const tblSlug = sanitizeSlug(tableName || "table");
  const previewPhysicalName = `api_${colSlug}_${tblSlug}`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!collectionId || !connectionId || !displayName.trim() || !tableName.trim()) {
      setError("Please fill out all required fields.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const endpoint_spec = initialEndpointState
        ? {
            name: displayName.trim(),
            path: initialEndpointState.path,
            method: initialEndpointState.method,
            headers: initialEndpointState.headers,
            query_params: initialEndpointState.queryParams,
            body: initialEndpointState.body,
            response_path: initialEndpointState.responsePath,
          }
        : undefined;

      const res = await api.createApiTable({
        collection_id: collectionId,
        connection_id: connectionId,
        display_name: displayName.trim(),
        table_name: tableName.trim(),
        storage_mode: storageMode,
        endpoint_spec,
        auto_materialize: autoMaterialize,
        cron_schedule: cronSchedule !== "manual" ? cronSchedule : undefined,
      });

      setCreatedResult({
        tableId: res.id,
        tableName: res.table_name,
        physicalTableName: previewPhysicalName,
        semanticDatasetId: res.semantic_dataset_id,
        dashboardId: res.dashboard_id,
        recordCount: res.record_count,
      });
      onSuccess(res);
    } catch (err: any) {
      setError(err?.message || "Failed to create API table.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-card border border-border/80 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground">
                {createdResult ? "Table Materialized Successfully!" : "Save Endpoint to Collection"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {createdResult
                  ? "Columnar Parquet snapshot registered in DuckDB and available platform-wide."
                  : "Organize API data into a managed columnar table under your Dataset Collection"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!createdResult ? (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Collection Dropdown with Inline "+ Create Collection" */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-foreground">
                  Dataset Collection <span className="text-destructive">*</span>
                </label>
                <button
                  type="button"
                  onClick={onOpenCreateCollection}
                  className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  <FolderPlus className="h-3 w-3" /> + New Collection
                </button>
              </div>
              <select
                required
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border/80 outline-none"
              >
                <option value="" disabled>
                  Select a collection...
                </option>
                {collections.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name} ({col.table_count || 0} tables)
                  </option>
                ))}
              </select>
            </div>

            {/* Target Connection */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Upstream API Connection <span className="text-destructive">*</span>
              </label>
              <select
                required
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border/80 outline-none"
              >
                <option value="" disabled>
                  Select an upstream connection...
                </option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.base_url})
                  </option>
                ))}
              </select>
            </div>

            {/* Display Name & Physical Table Slug */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Display Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => handleDisplayNameChange(e.target.value)}
                  placeholder="e.g. Daily Orders"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border/80 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Table Identifier <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={tableName}
                  onChange={(e) => setTableName(sanitizeSlug(e.target.value))}
                  placeholder="e.g. daily_orders"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-background border border-border/80 outline-none"
                />
              </div>
            </div>

            {/* Physical DuckDB Table Preview */}
            <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
              <span className="text-[11px] text-muted-foreground block mb-1">DuckDB SQL Table Identifier:</span>
              <code className="text-xs font-mono text-primary font-bold">{previewPhysicalName}</code>
            </div>

            {/* Storage Mode & Materialization Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Storage Mode</label>
                <select
                  value={storageMode}
                  onChange={(e) => setStorageMode(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border/80 outline-none"
                >
                  <option value="materialized">Materialized (High-Speed Parquet)</option>
                  <option value="live">Live Query Proxy</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Sync Schedule</label>
                <select
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border/80 outline-none"
                >
                  <option value="manual">Manual Refresh Only</option>
                  <option value="*/15 * * * *">Every 15 Minutes</option>
                  <option value="0 * * * *">Hourly</option>
                  <option value="0 */6 * * *">Every 6 Hours</option>
                  <option value="0 0 * * *">Daily (Midnight)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="autoMat"
                checked={autoMaterialize}
                onChange={(e) => setAutoMaterialize(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="autoMat" className="text-xs text-foreground cursor-pointer select-none">
                Immediately fetch and materialize into DuckDB table
              </label>
            </div>

            <div className="pt-4 border-t border-border/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow transition disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save & Register Table
              </button>
            </div>
          </form>
        ) : (
          /* Post-creation Success Action View */
          <div className="mt-4 space-y-5">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-sm">Table Registered Successfully</p>
                <p className="text-foreground">
                  Materialized <span className="font-mono font-bold">{createdResult.recordCount}</span> records into{" "}
                  <code className="font-mono font-bold text-primary">{createdResult.physicalTableName}</code>.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">Explore your data immediately:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate("/sqllab", {
                      state: {
                        initialSql: `SELECT * FROM ${createdResult.physicalTableName} LIMIT 50;`,
                      },
                    });
                  }}
                  className="flex items-center justify-between p-3 rounded-xl border border-border/80 hover:border-primary/50 bg-background hover:bg-muted/40 transition text-left group"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Terminal className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Open in SQL Lab</p>
                      <p className="text-[11px] text-muted-foreground">Run ad-hoc queries & joins</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (createdResult.dashboardId) {
                      navigate(`/dashboards/${createdResult.dashboardId}`);
                    } else if (createdResult.semanticDatasetId) {
                      navigate(`/charts/new?dataset_id=${createdResult.semanticDatasetId}`);
                    } else {
                      navigate("/dashboards");
                    }
                  }}
                  className="flex items-center justify-between p-3 rounded-xl border border-border/80 hover:border-primary/50 bg-background hover:bg-muted/40 transition text-left group"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <BarChart3 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">View Dashboard & Charts</p>
                      <p className="text-[11px] text-muted-foreground">Auto-generated visualizations across all chart types</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition" />
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-border/60 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
