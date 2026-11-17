import { useState, useEffect, useMemo } from "react";
import {
  Globe,
  Plus,
  FolderPlus,
  Folder,
  FileCode2,
  Layers,
  Database,
  Terminal,
  BarChart3,
  RefreshCw,
  Trash2,
  Edit2,
  Search,
  ExternalLink,
  History,
  GitMerge,
  Loader2,
  Shield,
  Play,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  api,
  ApiConnection,
  ApiDatasetCollection,
  ApiDatasetTable,
  OpenApiEndpoint,
} from "@/app/api";
import { ApiConnectionModal } from "./ApiConnectionModal";
import { OpenApiImporterModal } from "./OpenApiImporterModal";
import { ApiExplorerModal } from "./ApiExplorerModal";
import { DatasetCreatorModal } from "./DatasetCreatorModal";
import { CollectionDetailsModal } from "./CollectionDetailsModal";
import { CreateCollectionModal } from "./CreateCollectionModal";
import { SyncHistoryModal } from "./SyncHistoryModal";

export function ApiConnectionsPage() {
  const navigate = useNavigate();

  // Primary Data State
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [collections, setCollections] = useState<ApiDatasetCollection[]>([]);
  const [allTables, setAllTables] = useState<
    Array<ApiDatasetTable & { collectionName: string }>
  >([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Active Tab: 'collections' | 'connections' | 'tables'
  const [activeTab, setActiveTab] = useState<"collections" | "connections" | "tables">("collections");

  // Modals visibility state
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
  const [connectionToEdit, setConnectionToEdit] = useState<ApiConnection | null>(null);

  const [isOpenApiModalOpen, setIsOpenApiModalOpen] = useState(false);

  const [isExplorerModalOpen, setIsExplorerModalOpen] = useState(false);
  const [explorerInitialEndpoint, setExplorerInitialEndpoint] = useState<{
    endpoint?: Partial<OpenApiEndpoint>;
    baseUrl?: string;
    connectionId?: string;
  } | null>(null);

  const [isCreatorModalOpen, setIsCreatorModalOpen] = useState(false);
  const [creatorInitialState, setCreatorInitialState] = useState<any>(null);

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [isCollectionDetailsOpen, setIsCollectionDetailsOpen] = useState(false);

  const [isCreateCollectionOpen, setIsCreateCollectionOpen] = useState(false);

  const [syncHistoryTable, setSyncHistoryTable] = useState<ApiDatasetTable | null>(null);
  const [isSyncHistoryOpen, setIsSyncHistoryOpen] = useState(false);

  // Table action loaders
  const [syncingTableId, setSyncingTableId] = useState<string | null>(null);
  const [testingConnId, setTestingConnId] = useState<string | null>(null);
  const [visualizingTableId, setVisualizingTableId] = useState<string | null>(null);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [conns, cols] = await Promise.all([
        api.getApiConnections(),
        api.getApiCollections(),
      ]);
      setConnections(conns);
      setCollections(cols);

      // Fetch all tables across collections
      const detailedCols = await Promise.all(
        cols.map((c) => api.getApiCollection(c.id).catch(() => null))
      );

      const tablesAgg: Array<ApiDatasetTable & { collectionName: string }> = [];
      for (const dc of detailedCols) {
        if (dc && dc.tables) {
          for (const tbl of dc.tables) {
            tablesAgg.push({
              ...tbl,
              collectionName: dc.name,
            });
          }
        }
      }
      setAllTables(tablesAgg);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  // KPIs
  const totalCollections = collections.length;
  const totalTables = allTables.length;
  const totalRecords = allTables.reduce((sum, t) => sum + (t.record_count || 0), 0);

  // Filtered Items
  const filteredCollections = useMemo(() => {
    if (!searchQuery.trim()) return collections;
    const q = searchQuery.toLowerCase();
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [collections, searchQuery]);

  const filteredConnections = useMemo(() => {
    if (!searchQuery.trim()) return connections;
    const q = searchQuery.toLowerCase();
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.base_url.toLowerCase().includes(q) ||
        c.auth_type.toLowerCase().includes(q)
    );
  }, [connections, searchQuery]);

  const filteredTables = useMemo(() => {
    if (!searchQuery.trim()) return allTables;
    const q = searchQuery.toLowerCase();
    return allTables.filter(
      (t) =>
        t.display_name.toLowerCase().includes(q) ||
        t.table_name.toLowerCase().includes(q) ||
        t.collectionName.toLowerCase().includes(q)
    );
  }, [allTables, searchQuery]);

  // Handlers
  const handleTestConnection = async (connId: string) => {
    try {
      setTestingConnId(connId);
      await api.testSavedApiConnection(connId);
      const updated = await api.getApiConnections();
      setConnections(updated);
    } catch {
      // ignore
    } finally {
      setTestingConnId(null);
    }
  };

  const handleDeleteConnection = async (connId: string) => {
    if (!confirm("Are you sure you want to delete this connection?")) return;
    try {
      await api.deleteApiConnection(connId);
      await loadAllData();
    } catch {
      // ignore
    }
  };

  const handleDeleteCollection = async (colId: string) => {
    if (!confirm("Are you sure you want to delete this collection and its tables?")) return;
    try {
      await api.deleteApiCollection(colId);
      await loadAllData();
    } catch {
      // ignore
    }
  };

  const handleRefreshTable = async (tableId: string) => {
    try {
      setSyncingTableId(tableId);
      await api.refreshApiTable(tableId);
      await loadAllData();
    } catch {
      // ignore
    } finally {
      setSyncingTableId(null);
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!confirm("Are you sure you want to delete this table?")) return;
    try {
      await api.deleteApiTable(tableId);
      await loadAllData();
    } catch {
      // ignore
    }
  };

  const handleCreateChart = async (tbl: ApiDatasetTable) => {
    try {
      setVisualizingTableId(tbl.id);
      const res = await api.visualizeApiTable(tbl.id);
      const targetDatasetId = res.dataset_id || tbl.semantic_dataset_id;
      const targetChartId = res.primary_chart_id;
      if (targetChartId) {
        navigate(`/charts?dataset=${targetDatasetId}&chart_id=${targetChartId}`);
      } else if (targetDatasetId) {
        navigate(`/charts?dataset=${targetDatasetId}`);
      } else {
        navigate("/charts");
      }
    } catch (err: any) {
      console.error("Failed to auto-generate chart visualizations:", err);
      if (tbl.semantic_dataset_id) {
        navigate(`/charts?dataset=${tbl.semantic_dataset_id}`);
      } else {
        navigate("/charts");
      }
    } finally {
      setVisualizingTableId(null);
    }
  };

  const getTablePhysicalName = (tbl: ApiDatasetTable & { collectionName?: string }) => {
    const colSlug = (tbl.collectionName || "api")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const tblSlug = tbl.table_name
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `api_${colSlug}_${tblSlug}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">API Connect</h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
              Multi-Endpoint Collections & REST
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Connect external REST APIs, organize multiple endpoints into dataset collections, and execute analytical SQL joins in DuckDB.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsCreateCollectionOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted text-foreground transition shadow-sm"
          >
            <FolderPlus className="h-3.5 w-3.5 text-primary" />
            New Collection
          </button>

          <button
            type="button"
            onClick={() => setIsOpenApiModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted text-foreground transition shadow-sm"
          >
            <FileCode2 className="h-3.5 w-3.5 text-primary" />
            Import OpenAPI
          </button>

          <button
            type="button"
            onClick={() => {
              setExplorerInitialEndpoint(null);
              setIsExplorerModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted text-foreground transition shadow-sm"
          >
            <Play className="h-3 w-3 text-primary fill-primary" />
            API Explorer
          </button>

          <button
            type="button"
            onClick={() => {
              setConnectionToEdit(null);
              setIsConnectionModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Connect API
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl border border-border/80 bg-card shadow-sm flex items-start justify-between">
          <div>
            <p className="text-xs font-normal text-muted-foreground">Dataset Collections</p>
            <h3 className="text-2xl font-bold text-foreground mt-2">{totalCollections}</h3>
            <p className="text-xs text-emerald-500 font-medium mt-1">Logical Endpoint Groups</p>
          </div>
          <div className="p-2 text-blue-500">
            <Folder className="h-5 w-5" />
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-border/80 bg-card shadow-sm flex items-start justify-between">
          <div>
            <p className="text-xs font-normal text-muted-foreground">Endpoint Tables</p>
            <h3 className="text-2xl font-bold text-foreground mt-2">{totalTables}</h3>
            <p className="text-xs text-muted-foreground mt-1">Materialized DuckDB Tables</p>
          </div>
          <div className="p-2 text-emerald-500">
            <Layers className="h-5 w-5" />
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-border/80 bg-card shadow-sm flex items-start justify-between">
          <div>
            <p className="text-xs font-normal text-muted-foreground">Total Ingested Records</p>
            <h3 className="text-2xl font-bold text-foreground mt-2">{totalRecords.toLocaleString()}</h3>
            <p className="text-xs text-muted-foreground mt-1">Stored in Parquet Snapshots</p>
          </div>
          <div className="p-2 text-blue-500">
            <Database className="h-5 w-5" />
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-border/80 bg-card shadow-sm flex items-start justify-between">
          <div>
            <p className="text-xs font-normal text-muted-foreground">SQL Lab Cross-Joins</p>
            <div className="flex items-center gap-1.5 text-emerald-500 font-bold text-xl mt-2">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              <span>Operational</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Multi-Endpoint Join Ready</p>
          </div>
          <div className="p-2 text-emerald-500">
            <Shield className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Navigation Tabs & Search Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl">
          {(
            [
              { id: "collections", label: `Dataset Collections (${collections.length})` },
              { id: "connections", label: `API Connections (${connections.length})` },
              { id: "tables", label: `All Endpoint Tables (${allTables.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 text-xs rounded-lg transition ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm font-semibold border border-border/40"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeTab === "collections" ? "collections" : activeTab === "connections" ? "connections" : "tables"}...`}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 focus:border-primary outline-none"
          />
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Tab 1: Dataset Collections */}
      {activeTab === "collections" && (
        <div className="space-y-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-xs">Loading collections...</p>
            </div>
          ) : filteredCollections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCollections.map((col) => (
                <div
                  key={col.id}
                  className="rounded-xl border border-border/80 bg-card p-5 shadow-sm hover:border-primary/50 transition flex flex-col justify-between group"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                          <Layers className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-foreground group-hover:text-primary transition line-clamp-1">
                            {col.name}
                          </h4>
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {col.table_count || 0} endpoint tables
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteCollection(col.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 min-h-[32px]">
                      {col.description || "No description provided."}
                    </p>

                    {col.tags && col.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {col.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 text-[10px] rounded-md bg-muted text-muted-foreground font-medium"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-4 mt-4 border-t border-border/60 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCollectionId(col.id);
                        setIsCollectionDetailsOpen(true);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      View Collection <ExternalLink className="h-3 w-3" />
                    </button>

                    {(col.table_count || 0) >= 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCollectionId(col.id);
                          setIsCollectionDetailsOpen(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-purple-500/10 text-purple-600 hover:bg-purple-500 hover:text-white transition"
                      >
                        <GitMerge className="h-3 w-3" /> Join Tables
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground border border-dashed border-border/80 rounded-2xl p-8">
              <Layers className="h-10 w-10 text-muted-foreground/60 mx-auto mb-3" />
              <h3 className="font-semibold text-sm text-foreground">No Dataset Collections Found</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
                Collections group related REST endpoints (such as Products, Customers, Inventory) into a unified relational domain.
              </p>
              <button
                type="button"
                onClick={() => setIsCreateCollectionOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Create First Collection
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: API Connections */}
      {activeTab === "connections" && (
        <div className="space-y-4">
          <div className="border border-border/80 rounded-xl overflow-hidden bg-card shadow-sm">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-muted/40 text-muted-foreground font-semibold border-b border-border/80">
                <tr>
                  <th className="py-3 px-4 font-semibold">Connection Name</th>
                  <th className="py-3 px-4 font-semibold">Base URL</th>
                  <th className="py-3 px-4 font-semibold">Auth Type</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Last Tested</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredConnections.map((conn) => {
                  const isTesting = testingConnId === conn.id;
                  const isConnected = conn.status === "connected" || conn.status === "active";
                  return (
                    <tr key={conn.id} className="hover:bg-muted/30 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-500 flex items-center justify-center flex-shrink-0">
                            <Globe className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-xs text-foreground">{conn.name}</div>
                            {conn.description && (
                              <div className="text-[11px] text-muted-foreground line-clamp-1">{conn.description}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground max-w-xs truncate">
                        {conn.base_url}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 text-[10px] font-mono font-medium rounded bg-muted text-muted-foreground uppercase">
                          {conn.auth_type}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-xs text-foreground">
                          <span
                            className={`h-2 w-2 rounded-full flex-shrink-0 ${
                              isConnected
                                ? "bg-emerald-500"
                                : conn.status === "error"
                                ? "bg-destructive"
                                : "bg-amber-400"
                            }`}
                          />
                          <span className="capitalize text-xs font-normal">
                            {isConnected
                              ? "Active"
                              : conn.status === "error"
                              ? "Error"
                              : "Untested"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">
                        {conn.last_tested_at ? (
                          <div className="flex items-start gap-1 font-mono text-[11px]">
                            <Clock className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="leading-tight">
                              <div>{new Date(conn.last_tested_at).toLocaleDateString()}</div>
                              <div className="text-[10px] opacity-80">{new Date(conn.last_tested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">Never</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={isTesting}
                            onClick={() => handleTestConnection(conn.id)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border/80 hover:bg-muted text-foreground transition disabled:opacity-50"
                          >
                            {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setExplorerInitialEndpoint({
                                endpoint: {
                                  path: "",
                                  method: "GET",
                                  summary: `Explore ${conn.name}`,
                                },
                                baseUrl: conn.base_url,
                                connectionId: conn.id,
                              });
                              setIsExplorerModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
                          >
                            <Play className="h-3 w-3 fill-current" />
                            Explore
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setConnectionToEdit(conn);
                              setIsConnectionModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteConnection(conn.id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredConnections.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground italic">
                      No API connections configured. Click "Connect API" to connect an upstream REST service.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: All Endpoint Tables */}
      {activeTab === "tables" && (
        <div className="space-y-4">
          <div className="border border-border/80 rounded-xl overflow-hidden bg-card">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-muted/60 text-muted-foreground font-medium border-b border-border">
                <tr>
                  <th className="py-3 px-4">Display Name</th>
                  <th className="py-3 px-4">DuckDB SQL Identifier</th>
                  <th className="py-3 px-4">Collection</th>
                  <th className="py-3 px-4">Storage Mode</th>
                  <th className="py-3 px-4">Records</th>
                  <th className="py-3 px-4">Columns</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Last Synced</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredTables.map((tbl) => {
                  const phys = getTablePhysicalName(tbl);
                  const isSyncing = syncingTableId === tbl.id || tbl.materialization_status === "syncing";
                  return (
                    <tr key={tbl.id} className="hover:bg-muted/30 transition">
                      <td className="py-3 px-4 font-semibold text-foreground">{tbl.display_name}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-primary font-bold">{phys}</td>
                      <td className="py-3 px-4 text-muted-foreground">
                        <span className="px-2 py-0.5 text-[10px] rounded bg-muted text-foreground font-medium">
                          {tbl.collectionName}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-primary/10 text-primary border border-primary/20">
                          {tbl.storage_mode}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">
                        {tbl.record_count.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">{tbl.column_count}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                            tbl.materialization_status === "ready"
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : tbl.materialization_status === "syncing"
                              ? "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse"
                              : "bg-destructive/10 text-destructive border-destructive/20"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              tbl.materialization_status === "ready"
                                ? "bg-emerald-500"
                                : tbl.materialization_status === "syncing"
                                ? "bg-blue-500"
                                : "bg-destructive"
                            }`}
                          />
                          {tbl.materialization_status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                        {tbl.last_synced_at ? new Date(tbl.last_synced_at).toLocaleString() : "Never"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              navigate("/sqllab", {
                                state: { initialSql: `SELECT * FROM ${phys} LIMIT 50;` },
                              });
                            }}
                            title="Query in SQL Lab"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <Terminal className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={visualizingTableId === tbl.id}
                            onClick={() => handleCreateChart(tbl)}
                            title="Create Chart"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {visualizingTableId === tbl.id ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                            ) : (
                              <BarChart3 className="h-3.5 w-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => handleRefreshTable(tbl.id)}
                            title="Refresh / Sync"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin text-primary" : ""}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSyncHistoryTable(tbl);
                              setIsSyncHistoryOpen(true);
                            }}
                            title="View Sync History & Logs"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <History className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteTable(tbl.id)}
                            title="Delete Table"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredTables.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-xs text-muted-foreground italic">
                      No endpoint tables registered yet. Use "Explore & Sandbox" to discover and materialize tables.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Dialogs */}
      <ApiConnectionModal
        isOpen={isConnectionModalOpen}
        onClose={() => {
          setIsConnectionModalOpen(false);
          setConnectionToEdit(null);
        }}
        connectionToEdit={connectionToEdit}
        onSuccess={loadAllData}
      />

      <OpenApiImporterModal
        isOpen={isOpenApiModalOpen}
        onClose={() => setIsOpenApiModalOpen(false)}
        onSelectEndpointForExplore={(ep, baseUrl) => {
          setExplorerInitialEndpoint({ endpoint: ep, baseUrl });
          setIsExplorerModalOpen(true);
        }}
      />

      <ApiExplorerModal
        isOpen={isExplorerModalOpen}
        onClose={() => {
          setIsExplorerModalOpen(false);
          setExplorerInitialEndpoint(null);
        }}
        connections={connections}
        initialEndpoint={explorerInitialEndpoint}
        onSaveAsTable={(state) => {
          setCreatorInitialState(state);
          setIsCreatorModalOpen(true);
        }}
      />

      <DatasetCreatorModal
        isOpen={isCreatorModalOpen}
        onClose={() => {
          setIsCreatorModalOpen(false);
          setCreatorInitialState(null);
        }}
        connections={connections}
        collections={collections}
        initialEndpointState={creatorInitialState}
        onOpenCreateCollection={() => setIsCreateCollectionOpen(true)}
        onSuccess={() => {
          loadAllData();
        }}
      />

      <CreateCollectionModal
        isOpen={isCreateCollectionOpen}
        onClose={() => setIsCreateCollectionOpen(false)}
        onSuccess={() => {
          loadAllData();
        }}
      />

      <CollectionDetailsModal
        isOpen={isCollectionDetailsOpen}
        onClose={() => {
          setIsCollectionDetailsOpen(false);
          setSelectedCollectionId(null);
        }}
        collectionId={selectedCollectionId}
        onRefreshCollectionList={loadAllData}
        onOpenExplorerForCollection={() => {
          setIsCollectionDetailsOpen(false);
          setIsCreatorModalOpen(true);
        }}
      />

      <SyncHistoryModal
        isOpen={isSyncHistoryOpen}
        onClose={() => {
          setIsSyncHistoryOpen(false);
          setSyncHistoryTable(null);
        }}
        table={syncHistoryTable}
      />
    </div>
  );
}
