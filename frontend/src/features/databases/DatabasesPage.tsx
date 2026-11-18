import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Database,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Trash2,
  Layers,
  Table,
  ChevronDown,
  ChevronRight,
  Search,
  Eye,
  GitMerge,
  Key,
  Link2,
  Loader2,
} from "lucide-react";
import {
  api,
  DatabaseConnection,
  ConnectionTestResult,
  BulkDatasetCreateResponse,
  AutoVisualizeResponse,
  RowsByKeyResponse,
} from "@/app/api";
import { JoinAssistantModal } from "./JoinAssistantModal";

interface IndeterminateCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}

const IndeterminateCheckbox: React.FC<IndeterminateCheckboxProps> = ({
  checked,
  indeterminate,
  onChange,
  className = "",
  disabled,
  title,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      type="checkbox"
      ref={ref}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      title={title}
      className={`rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer ${className}`}
    />
  );
};

const DIALECTS = [
  { value: "postgresql", label: "PostgreSQL", defaultPort: 5432 },
  { value: "mysql", label: "MySQL / MariaDB", defaultPort: 3306 },
  { value: "sqlite", label: "SQLite", defaultPort: null },
  { value: "duckdb", label: "DuckDB (Embedded)", defaultPort: null },
  { value: "clickhouse", label: "ClickHouse", defaultPort: 8123 },
  { value: "mssql", label: "Microsoft SQL Server", defaultPort: 1433 },
];

export const DatabasesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  // Schema browser state
  const [browserDb, setBrowserDb] = useState<DatabaseConnection | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<string>("main");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [isCreatingDataset, setIsCreatingDataset] = useState(false);
  const [datasetCreatedMsg, setDatasetCreatedMsg] = useState<string | null>(null);

  // Bulk creation & Tree view state
  const [tableFilter, setTableFilter] = useState("");
  const [selectedTableKeys, setSelectedTableKeys] = useState<Set<string>>(new Set());
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [isBulkCreating, setIsBulkCreating] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkDatasetCreateResponse | null>(null);
  const [autoVizResult, setAutoVizResult] = useState<AutoVisualizeResponse | null>(null);
  const [dashboardMode, setDashboardMode] = useState<"both" | "unified" | "per_table">("both");

  // Table Join Assistant state
  const [joinAssistantDb, setJoinAssistantDb] = useState<DatabaseConnection | null>(null);
  const [joinAssistantLeftTable, setJoinAssistantLeftTable] = useState<string | undefined>(undefined);
  const [joinAssistantRightTable, setJoinAssistantRightTable] = useState<string | undefined>(undefined);

  // PK Lookup in Schema Browser state
  const [pkLookupValue, setPkLookupValue] = useState<string>("");
  const [pkLookupResult, setPkLookupResult] = useState<RowsByKeyResponse | null>(null);
  const [isPkLookingUp, setIsPkLookingUp] = useState<boolean>(false);
  const [pkLookupError, setPkLookupError] = useState<string | null>(null);
  const [tableDisplayLimits, setTableDisplayLimits] = useState<Record<string, number>>({});

  // Query inventory for browserDb
  const {
    data: inventoryData,
    isLoading: isInventoryLoading,
    refetch: refetchInventory,
  } = useQuery({
    queryKey: ["database-inventory", browserDb?.id],
    queryFn: () => (browserDb ? api.getDatabaseInventory(browserDb.id) : Promise.resolve({ schemas: [] })),
    enabled: Boolean(browserDb),
  });

  // When inventory loads, auto-expand all schemas if none expanded
  useEffect(() => {
    if (inventoryData?.schemas && inventoryData.schemas.length > 0) {
      setExpandedSchemas(new Set(inventoryData.schemas.map((s) => s.name)));
    }
  }, [inventoryData]);

  const getTableKey = (schema: string, table: string) => `${schema}:::${table}`;
  const parseTableKey = (key: string) => {
    const idx = key.indexOf(":::");
    if (idx === -1) return { schema: "", table: key };
    return { schema: key.substring(0, idx), table: key.substring(idx + 3) };
  };

  const allInventoryTables: Array<{ schema: string; table: string; type: string; row_count_estimate?: number | null }> = [];
  (inventoryData?.schemas || []).forEach((s) => {
    s.tables.forEach((t) => {
      allInventoryTables.push({
        schema: s.name,
        table: t.name,
        type: t.type,
        row_count_estimate: t.row_count_estimate,
      });
    });
  });

  const totalDbTablesCount = allInventoryTables.length;
  const selectedCount = selectedTableKeys.size;
  const selectedSchemasCount = new Set(
    Array.from(selectedTableKeys).map((k) => parseTableKey(k).schema)
  ).size;

  const isMasterChecked = totalDbTablesCount > 0 && selectedCount === totalDbTablesCount;
  const isMasterIndeterminate = selectedCount > 0 && selectedCount < totalDbTablesCount;

  const handleToggleMasterCheckbox = () => {
    if (isMasterChecked) {
      setSelectedTableKeys(new Set());
    } else {
      const allKeys = new Set(allInventoryTables.map((t) => getTableKey(t.schema, t.table)));
      setSelectedTableKeys(allKeys);
    }
  };

  const handleToggleSchemaCheckbox = (schemaName: string, tables: Array<{ name: string }>) => {
    const schemaKeys = tables.map((t) => getTableKey(schemaName, t.name));
    const allSelected = schemaKeys.length > 0 && schemaKeys.every((k) => selectedTableKeys.has(k));

    setSelectedTableKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        schemaKeys.forEach((k) => next.delete(k));
      } else {
        schemaKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const handleToggleTableCheckbox = (schema: string, table: string) => {
    const key = getTableKey(schema, table);
    setSelectedTableKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSchemaExpand = (schemaName: string) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schemaName)) {
        next.delete(schemaName);
      } else {
        next.add(schemaName);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    if (inventoryData?.schemas) {
      setExpandedSchemas(new Set(inventoryData.schemas.map((s) => s.name)));
    }
  };

  const handleCollapseAll = () => {
    setExpandedSchemas(new Set());
  };

  const handleExecuteBulkCreate = async (itemsToCreate?: Array<{ schema_name?: string; table_name: string }>) => {
    if (!browserDb) return;
    setIsBulkCreating(true);
    setShowBulkConfirm(false);
    try {
      const items =
        itemsToCreate ||
        Array.from(selectedTableKeys).map((k) => {
          const { schema, table } = parseTableKey(k);
          return { schema_name: schema, table_name: table };
        });

      const res = await api.autoVisualizeDatabase(browserDb.id, {
        tables: items,
        per_table_dashboards: dashboardMode === "both" || dashboardMode === "per_table",
        unified_dashboard: dashboardMode === "both" || dashboardMode === "unified",
      });

      setAutoVizResult(res);

      const bulkMapped: BulkDatasetCreateResponse = {
        total_requested: items.length,
        created_count: res.per_table_dashboards_created,
        skipped_count: res.per_table_dashboards.filter((r) => r.status === "skipped_existing").length,
        failed_count: res.per_table_dashboards.filter((r) => r.status === "failed").length,
        results: res.per_table_dashboards.map((r) => ({
          schema: r.schema,
          table: r.table,
          schema_name: r.schema,
          table_name: r.table,
          status: (r.status as any) || "created",
          dataset_id: r.dataset_id,
          dashboard_slug: r.dashboard_slug || res.unified_dashboard_slug,
          error: r.error,
        })),
      };
      setBulkResults(bulkMapped);
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      refetchInventory();
    } catch (err: any) {
      alert(`Auto-visualization failed: ${err.message}`);
    } finally {
      setIsBulkCreating(false);
    }
  };

  const handleRetryFailed = () => {
    if (!bulkResults) return;
    const failedItems = bulkResults.results
      .filter((r) => r.status === "failed")
      .map((r) => ({
        schema_name: r.schema_name || r.schema,
        table_name: r.table_name || r.table,
      }));
    if (failedItems.length > 0) {
      handleExecuteBulkCreate(failedItems);
    }
  };

  const handleCreateDatasetFromTable = async () => {
    if (!browserDb || !selectedTable) return;
    setIsCreatingDataset(true);
    setDatasetCreatedMsg(null);
    try {
      await api.createDataset({
        name: selectedTable.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        database_id: browserDb.id,
        table_name: selectedTable,
        schema_name: selectedSchema || (browserDb.dialect === "postgresql" || browserDb.dialect === "postgres" ? "public" : "main"),
        is_virtual: false,
      });
      setDatasetCreatedMsg("Created!");
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      setTimeout(() => {
        setDatasetCreatedMsg(null);
        navigate("/datasets");
      }, 1000);
    } catch (e: any) {
      alert(`Failed to create dataset: ${e.message}`);
    } finally {
      setIsCreatingDataset(false);
    }
  };

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    dialect: "postgresql",
    host: "localhost",
    port: 5432,
    database_name: "",
    username: "",
    password: "",
    raw_uri: "",
    use_raw_uri: false,
    ssl_mode: "prefer",
    allow_dml: false,
    allow_file_uploads: false,
    allow_sqllab: true,
    row_limit: 10000,
    statement_timeout_seconds: 30,
    cache_timeout_seconds: 300,
  });

  const [formTestStatus, setFormTestStatus] = useState<ConnectionTestResult | null>(null);
  const [isTestingForm, setIsTestingForm] = useState(false);

  // Query databases
  const { data: databases = [], isLoading, refetch } = useQuery({
    queryKey: ["databases"],
    queryFn: api.getDatabases,
  });

  // Query columns for selectedTable
  const { data: columns = [] } = useQuery({
    queryKey: ["columns", browserDb?.id, selectedSchema, selectedTable],
    queryFn: () =>
      browserDb && selectedTable
        ? api.getDatabaseColumns(browserDb.id, selectedTable, selectedSchema)
        : Promise.resolve([]),
    enabled: Boolean(browserDb && selectedTable),
  });

  const columnList: any[] = Array.isArray(columns)
    ? columns
    : (columns as any)?.data || [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => api.createDatabase(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["databases"] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDatabase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["databases"] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      queryClient.invalidateQueries({ queryKey: ["charts"] });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      dialect: "postgresql",
      host: "localhost",
      port: 5432,
      database_name: "",
      username: "",
      password: "",
      raw_uri: "",
      use_raw_uri: false,
      ssl_mode: "prefer",
      allow_dml: false,
      allow_file_uploads: false,
      allow_sqllab: true,
      row_limit: 10000,
      statement_timeout_seconds: 30,
      cache_timeout_seconds: 300,
    });
    setFormTestStatus(null);
  };

  const handleDialectChange = (dialect: string) => {
    const selected = DIALECTS.find((d) => d.value === dialect);
    setFormData((prev) => ({
      ...prev,
      dialect,
      port: selected?.defaultPort ?? 5432,
    }));
  };

  const handleTestDatabase = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await api.testDatabaseById(id);
      setTestResult({ id, success: res.success, message: res.message });
    } catch (err: any) {
      setTestResult({ id, success: false, message: err.message || "Connection failed" });
    } finally {
      setTestingId(null);
    }
  };

  const handleTestFormData = async () => {
    setIsTestingForm(true);
    setFormTestStatus(null);
    try {
      const payload: any = {
        name: formData.name || "Test Connection",
        dialect: formData.dialect,
        ssl_mode: formData.ssl_mode,
        allow_dml: formData.allow_dml,
        allow_file_uploads: formData.allow_file_uploads,
        allow_sqllab: formData.allow_sqllab,
        row_limit: formData.row_limit,
        statement_timeout_seconds: formData.statement_timeout_seconds,
        cache_timeout_seconds: formData.cache_timeout_seconds,
      };

      if (formData.use_raw_uri) {
        payload.raw_uri = formData.raw_uri;
      } else {
        payload.host = formData.host;
        payload.port = formData.port;
        payload.database_name = formData.database_name;
        payload.username = formData.username;
        payload.password = formData.password;
      }

      const res = await api.testDatabaseLive(payload);
      setFormTestStatus(res);
    } catch (err: any) {
      setFormTestStatus({ success: false, message: err.message || "Connection test failed." });
    } finally {
      setIsTestingForm(false);
    }
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      name: formData.name,
      description: formData.description,
      dialect: formData.dialect,
      ssl_mode: formData.ssl_mode,
      allow_dml: formData.allow_dml,
      allow_file_uploads: formData.allow_file_uploads,
      allow_sqllab: formData.allow_sqllab,
      row_limit: formData.row_limit,
      statement_timeout_seconds: formData.statement_timeout_seconds,
      cache_timeout_seconds: formData.cache_timeout_seconds,
    };

    if (formData.use_raw_uri) {
      payload.raw_uri = formData.raw_uri;
    } else {
      payload.host = formData.host;
      payload.port = formData.port;
      payload.database_name = formData.database_name;
      payload.username = formData.username;
      payload.password = formData.password;
    }

    createMutation.mutate(payload);
  };

  const filteredDbs = databases.filter(
    (db) =>
      db.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      db.dialect.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Database Connections</h1>
          <p className="text-sm text-slate-500">
            Connect your relational, analytical or embedded databases with encrypted credentials.
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
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Add Connection
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 flex items-center justify-between gap-4">
        <input
          type="text"
          placeholder="Filter connections by name or dialect..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-sm px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="text-xs text-slate-500">
          Showing {filteredDbs.length} of {databases.length} connections
        </div>
      </div>

      {/* Database Cards List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredDbs.map((db) => {
          const isTesting = testingId === db.id;
          const result = testResult?.id === db.id ? testResult : null;

          return (
            <div
              key={db.id}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                        {db.name}
                        {db.is_system && (
                          <span className="px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider bg-purple-100 text-purple-700 rounded">
                            System
                          </span>
                        )}
                      </h3>
                      <span className="inline-block px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 rounded mt-0.5">
                        {db.dialect.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {!db.is_system && (
                    <button
                      onClick={() => {
                        if (confirm(`Are you sure you want to delete connection '${db.name}'?`)) {
                          deleteMutation.mutate(db.id);
                        }
                      }}
                      className="text-slate-400 hover:text-red-600 transition p-1"
                      title="Delete connection"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {db.description && (
                  <p className="text-xs text-slate-500 mt-3 line-clamp-2">{db.description}</p>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Endpoint:</span>
                    <span className="font-mono text-slate-700 truncate max-w-[200px]">
                      {db.host ? `${db.host}:${db.port || ""}` : "Embedded Local"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Database:</span>
                    <span className="font-mono text-slate-700">{db.database_name || "default"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">SQL Lab:</span>
                    <span className={db.allow_sqllab ? "text-green-600 font-medium" : "text-slate-400"}>
                      {db.allow_sqllab ? "Allowed" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Uploads Target:</span>
                    <span className={db.allow_file_uploads ? "text-green-600 font-medium" : "text-slate-400"}>
                      {db.allow_file_uploads ? "Allowed" : "Disabled"}
                    </span>
                  </div>
                </div>

                {result && (
                  <div
                    className={`mt-3 p-2.5 rounded text-xs flex items-center gap-2 ${
                      result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                    }`}
                  >
                    {result.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                    <span className="truncate">{result.message}</span>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleTestDatabase(db.id)}
                  disabled={isTesting}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1.5 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? "animate-spin" : ""}`} />
                  {isTesting ? "Testing..." : "Test Connection"}
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setJoinAssistantDb(db);
                      setJoinAssistantLeftTable(undefined);
                      setJoinAssistantRightTable(undefined);
                    }}
                    className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded flex items-center gap-1 transition shadow-sm"
                    title="Open Table Join Assistant"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    Join Assistant
                  </button>

                  <button
                    onClick={() => {
                      setBrowserDb(db);
                      setSelectedSchema(db.dialect === "postgresql" || db.dialect === "postgres" ? "public" : "main");
                      setSelectedTable(null);
                      setSelectedTableKeys(new Set());
                      setBulkResults(null);
                      setShowBulkConfirm(false);
                      setTableFilter("");
                      setPkLookupResult(null);
                      setPkLookupValue("");
                      setPkLookupError(null);
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded flex items-center gap-1 transition"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Explore Schema
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Schema Browser Modal */}
      {browserDb && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-600" />
                  Schema Browser: {browserDb.name}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select multiple schemas and tables to bulk-create datasets and auto-generated dashboards, or inspect individual tables.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setJoinAssistantDb(browserDb);
                    if (selectedTable) {
                      setJoinAssistantLeftTable(`${selectedSchema}.${selectedTable}`);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition"
                  title="Open Table Join Assistant for this database"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  Join Assistant
                </button>
                <button
                  onClick={() => {
                    setBrowserDb(null);
                    setBulkResults(null);
                    setShowBulkConfirm(false);
                    setPkLookupResult(null);
                    setPkLookupValue("");
                    setPkLookupError(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 rounded hover:bg-slate-200 transition"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            {bulkResults ? (
              /* Bulk Results View */
              <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      Bulk Dataset & Dashboard Creation Results
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Review created datasets, auto-provisioned dashboards, and any skipped or failed tables.
                    </p>
                  </div>
                </div>

                {/* Hero Card for Unified Dashboard if generated */}
                {autoVizResult?.unified_dashboard_slug && (
                  <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow">
                        <Layers className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{autoVizResult.unified_dashboard_title}</h4>
                        <p className="text-xs text-slate-600">
                          {autoVizResult.charts_count} charts across {autoVizResult.sections_count} sections visualising all selected tables & columns
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/dashboards/${autoVizResult.unified_dashboard_slug}`)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Open Full Database Dashboard ↗
                    </button>
                  </div>
                )}

                {/* Metric Summary Cards */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-slate-500 font-medium">Total Requested</span>
                    <p className="text-xl font-bold text-slate-800">{bulkResults.total_requested}</p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-green-700 font-medium">Created</span>
                    <p className="text-xl font-bold text-green-800">{bulkResults.created_count}</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-amber-700 font-medium">Skipped (Existing)</span>
                    <p className="text-xl font-bold text-amber-800">{bulkResults.skipped_count}</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <span className="text-xs text-red-700 font-medium">Failed</span>
                    <p className="text-xl font-bold text-red-800">{bulkResults.failed_count}</p>
                  </div>
                </div>

                {/* Results Table */}
                <div className="flex-1 border border-slate-200 rounded-lg overflow-hidden flex flex-col">
                  <div className="overflow-y-auto max-h-[45vh]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold sticky top-0">
                        <tr>
                          <th className="px-4 py-2.5">Table</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Links / Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bulkResults.results.map((res, idx) => {
                          const tableName = `${res.schema || res.schema_name || "public"}.${res.table || res.table_name}`;
                          return (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="px-4 py-2.5 font-mono font-medium text-slate-800">
                                {tableName}
                              </td>
                              <td className="px-4 py-2.5">
                                {res.status === "created" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    <CheckCircle2 className="w-3 h-3" /> Created
                                  </span>
                                )}
                                {res.status === "skipped_existing" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                    Already Exists
                                  </span>
                                )}
                                {res.status === "failed" && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                    <XCircle className="w-3 h-3" /> Failed
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {res.dashboard_slug && (
                                    <button
                                      onClick={() => navigate(`/dashboards/${res.dashboard_slug}`)}
                                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                                    >
                                      <Layers className="w-3 h-3" /> Dashboard ↗
                                    </button>
                                  )}
                                  {res.dataset_id && (
                                    <button
                                      onClick={() => navigate(`/datasets/${res.dataset_id}`)}
                                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 hover:underline"
                                    >
                                      <Table className="w-3 h-3" /> Dataset ↗
                                    </button>
                                  )}
                                  {res.error && (
                                    <span className="text-red-600 font-mono text-[11px] truncate max-w-[280px]" title={res.error}>
                                      {res.error}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Results Action Footer */}
                <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                  <div>
                    {bulkResults.failed_count > 0 && (
                      <button
                        onClick={handleRetryFailed}
                        disabled={isBulkCreating}
                        className="px-3.5 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded shadow-sm flex items-center gap-1.5 transition"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isBulkCreating ? "animate-spin" : ""}`} />
                        Retry Failed ({bulkResults.failed_count})
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setBulkResults(null);
                        refetchInventory();
                      }}
                      className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition"
                    >
                      Back to Schema Browser
                    </button>
                    <button
                      onClick={() => {
                        setBrowserDb(null);
                        setBulkResults(null);
                        navigate("/datasets");
                      }}
                      className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded shadow-sm flex items-center gap-1 transition"
                    >
                      View All Datasets ↗
                    </button>
                  </div>
                </div>
              </div>
            ) : showBulkConfirm ? (
              /* Confirmation Prompt */
              <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col items-center text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Bulk-Create Datasets & Dashboards
                  </h3>
                  <p className="text-xs text-slate-600 max-w-md mt-0.5">
                    You have selected <span className="font-bold text-slate-900">{selectedCount} table{selectedCount !== 1 ? "s" : ""}</span> across{" "}
                    <span className="font-bold text-slate-900">{selectedSchemasCount} schema{selectedSchemasCount !== 1 ? "s" : ""}</span> in{" "}
                    <span className="font-bold text-blue-700">{browserDb.name}</span>.
                  </p>
                </div>

                <div className="w-full max-w-xl bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-left max-h-24 overflow-y-auto">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Selected Tables ({selectedCount}):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(selectedTableKeys).map((k) => {
                      const { schema, table } = parseTableKey(k);
                      return (
                        <span
                          key={k}
                          className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs font-mono text-slate-700"
                        >
                          {schema}.{table}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Dashboard Mode Selection */}
                <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg p-3 text-left space-y-2">
                  <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                    Visualization Mode:
                  </p>
                  <div className="space-y-1.5">
                    <label className={`flex items-start gap-2.5 p-2 rounded-md border cursor-pointer transition ${dashboardMode === "both" ? "bg-blue-50/50 border-blue-400" : "hover:bg-slate-50 border-slate-200"}`}>
                      <input
                        type="radio"
                        name="dashboardMode"
                        value="both"
                        checked={dashboardMode === "both"}
                        onChange={() => setDashboardMode("both")}
                        className="mt-0.5 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">
                          Separate dashboard per table + one unified dashboard (Recommended)
                        </span>
                        <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                          Creates {selectedCount} per-table dashboards plus 1 comprehensive database-wide dashboard (~{selectedCount * 7 + 6} charts).
                        </span>
                      </div>
                    </label>

                    <label className={`flex items-start gap-2.5 p-2 rounded-md border cursor-pointer transition ${dashboardMode === "unified" ? "bg-blue-50/50 border-blue-400" : "hover:bg-slate-50 border-slate-200"}`}>
                      <input
                        type="radio"
                        name="dashboardMode"
                        value="unified"
                        checked={dashboardMode === "unified"}
                        onChange={() => setDashboardMode("unified")}
                        className="mt-0.5 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">
                          Unified dashboard only
                        </span>
                        <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                          Creates datasets and 1 consolidated database overview dashboard visualising all columns (~{selectedCount * 7 + 6} charts).
                        </span>
                      </div>
                    </label>

                    <label className={`flex items-start gap-2.5 p-2 rounded-md border cursor-pointer transition ${dashboardMode === "per_table" ? "bg-blue-50/50 border-blue-400" : "hover:bg-slate-50 border-slate-200"}`}>
                      <input
                        type="radio"
                        name="dashboardMode"
                        value="per_table"
                        checked={dashboardMode === "per_table"}
                        onChange={() => setDashboardMode("per_table")}
                        className="mt-0.5 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">
                          Separate dashboards per table only
                        </span>
                        <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                          Creates {selectedCount} separate table dashboards without a unified database overview.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-3 pt-3 pb-1 sticky bottom-0 bg-white/95 backdrop-blur w-full border-t border-slate-100 z-10">
                  <button
                    onClick={() => setShowBulkConfirm(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleExecuteBulkCreate()}
                    className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm flex items-center gap-2 transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Confirm & Create ({selectedCount})
                  </button>
                </div>
              </div>
            ) : isBulkCreating ? (
              /* Bulk Creation Progress State */
              <div className="flex-1 p-12 flex flex-col items-center justify-center text-center space-y-4">
                <RefreshCw className="w-10 h-10 text-blue-600 animate-spin" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Creating Datasets and Dashboards...
                  </h3>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    Processing {selectedCount} tables across {selectedSchemasCount} schemas.
                    Inspecting schemas and auto-generating charts. Please wait...
                  </p>
                </div>
              </div>
            ) : (
              /* Tree View + Column Inspector */
              <>
                <div className="flex-1 flex overflow-hidden">
                  {/* Left Column: Schemas & Tables Tree View */}
                  <div className="w-5/12 border-r border-slate-200 flex flex-col overflow-hidden bg-slate-50/50">
                    {/* Search & Collapse Controls */}
                    <div className="p-3 border-b border-slate-200 bg-white space-y-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Filter tables or schemas..."
                          value={tableFilter}
                          onChange={(e) => setTableFilter(e.target.value)}
                          className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <IndeterminateCheckbox
                            checked={isMasterChecked}
                            indeterminate={isMasterIndeterminate}
                            onChange={handleToggleMasterCheckbox}
                            title="Select all schemas & tables"
                          />
                          <span className="font-medium text-slate-700">
                            Select All ({totalDbTablesCount})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleExpandAll}
                            className="hover:text-blue-600 transition"
                          >
                            Expand All
                          </button>
                          <span>•</span>
                          <button
                            onClick={handleCollapseAll}
                            className="hover:text-blue-600 transition"
                          >
                            Collapse All
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Schemas & Tables Tree List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                      {isInventoryLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center text-slate-400 text-xs">
                          <RefreshCw className="w-5 h-5 animate-spin mb-2 text-blue-500" />
                          Loading schema inventory...
                        </div>
                      ) : (
                        (inventoryData?.schemas || [])
                          .map((schema) => {
                            const matchingTables = schema.tables.filter((t) =>
                              tableFilter
                                ? t.name.toLowerCase().includes(tableFilter.toLowerCase()) ||
                                  schema.name.toLowerCase().includes(tableFilter.toLowerCase())
                                : true
                            );
                            return {
                              ...schema,
                              visibleTables: matchingTables,
                            };
                          })
                          .filter((schema) => (tableFilter ? schema.visibleTables.length > 0 : true))
                          .map((schema) => {
                            const isExpanded = expandedSchemas.has(schema.name);
                            const schemaTableKeys = schema.tables.map((t) => getTableKey(schema.name, t.name));
                            const selectedInSchema = schemaTableKeys.filter((k) => selectedTableKeys.has(k)).length;
                            const isSchemaAllSelected = schemaTableKeys.length > 0 && selectedInSchema === schemaTableKeys.length;
                            const isSchemaIndeterminate = selectedInSchema > 0 && selectedInSchema < schemaTableKeys.length;

                            // Handle display limit (200 rows cap per schema)
                            const displayLimit = tableDisplayLimits[schema.name] || 200;
                            const tablesToShow = schema.visibleTables.slice(0, displayLimit);
                            const hasMoreTables = schema.visibleTables.length > displayLimit;

                            return (
                              <div key={schema.name} className="border border-slate-200 bg-white rounded-md overflow-hidden">
                                {/* Schema Header Row */}
                                <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-100/70 hover:bg-slate-100 transition">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <button
                                      onClick={() => toggleSchemaExpand(schema.name)}
                                      className="text-slate-500 hover:text-slate-700 p-0.5 rounded transition"
                                      title={isExpanded ? "Collapse" : "Expand"}
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    <IndeterminateCheckbox
                                      checked={isSchemaAllSelected}
                                      indeterminate={isSchemaIndeterminate}
                                      onChange={() => handleToggleSchemaCheckbox(schema.name, schema.tables)}
                                      title={`Select all tables in ${schema.name}`}
                                    />
                                    <span
                                      onClick={() => toggleSchemaExpand(schema.name)}
                                      className="text-xs font-semibold text-slate-800 truncate cursor-pointer select-none"
                                    >
                                      {schema.name}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 bg-slate-200/80 text-slate-600 rounded-full">
                                    {schema.tables.length}
                                  </span>
                                </div>

                                {/* Schema Tables Sublist */}
                                {isExpanded && (
                                  <div className="divide-y divide-slate-100 bg-white">
                                    {tablesToShow.map((table) => {
                                      const isTableSelected = selectedTableKeys.has(getTableKey(schema.name, table.name));
                                      const isCurrentPreview = selectedTable === table.name && selectedSchema === schema.name;

                                      return (
                                        <div
                                          key={table.name}
                                          className={`flex items-center justify-between pl-7 pr-2.5 py-1.5 transition text-xs ${
                                            isCurrentPreview
                                              ? "bg-blue-50 text-blue-900 font-medium"
                                              : "hover:bg-slate-50 text-slate-700"
                                          }`}
                                        >
                                          <div className="flex items-center gap-2 min-w-0">
                                            <input
                                              type="checkbox"
                                              checked={isTableSelected}
                                              onChange={() => handleToggleTableCheckbox(schema.name, table.name)}
                                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                            />
                                            <button
                                              onClick={() => {
                                                setSelectedSchema(schema.name);
                                                setSelectedTable(table.name);
                                                setPkLookupResult(null);
                                                setPkLookupValue("");
                                                setPkLookupError(null);
                                              }}
                                              className="flex items-center gap-1.5 truncate text-left hover:text-blue-600"
                                              title="Click to inspect columns"
                                            >
                                              <Table className="w-3 h-3 text-slate-400 flex-shrink-0" />
                                              <span className="truncate">{table.name}</span>
                                            </button>
                                          </div>

                                          <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {table.row_count_estimate !== null && table.row_count_estimate !== undefined && (
                                              <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                                ~{table.row_count_estimate.toLocaleString()}
                                              </span>
                                            )}
                                            <button
                                              onClick={() => {
                                                setSelectedSchema(schema.name);
                                                setSelectedTable(table.name);
                                                setPkLookupResult(null);
                                                setPkLookupValue("");
                                                setPkLookupError(null);
                                              }}
                                              className={`p-1 rounded transition ${
                                                isCurrentPreview
                                                  ? "text-blue-600"
                                                  : "text-slate-300 hover:text-slate-600"
                                              }`}
                                              title="Inspect columns"
                                            >
                                              <Eye className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}

                                    {/* Pagination / Show more when > 200 rows */}
                                    {hasMoreTables && (
                                      <div className="px-4 py-2 bg-slate-50 text-center">
                                        <button
                                          onClick={() =>
                                            setTableDisplayLimits((prev) => ({
                                              ...prev,
                                              [schema.name]: displayLimit + 200,
                                            }))
                                          }
                                          className="text-xs text-blue-600 hover:underline font-medium"
                                        >
                                          Show 200 more (of {schema.visibleTables.length})
                                        </button>
                                      </div>
                                    )}

                                    {schema.visibleTables.length === 0 && (
                                      <div className="py-2 text-center text-slate-400 text-[11px]">
                                        No matching tables.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                      )}
                    </div>

                    {/* Bottom Selection Count Summary */}
                    <div className="p-2.5 bg-slate-100/70 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                      <span className="font-medium">
                        {selectedCount} table{selectedCount !== 1 ? "s" : ""} selected
                      </span>
                      <span className="text-[11px] text-slate-500">
                        across {selectedSchemasCount} schema{selectedSchemasCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Column Metadata Preview */}
                  <div className="w-7/12 p-5 overflow-y-auto">
                    {selectedTable ? (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                              <Table className="w-4 h-4 text-blue-600" />
                              Columns in <span className="font-mono text-blue-700">{selectedSchema}.{selectedTable}</span>
                            </h3>
                            <p className="text-[11px] text-slate-500">
                              Inspecting table schema from schema <span className="font-medium text-slate-700">{selectedSchema}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setJoinAssistantDb(browserDb);
                                setJoinAssistantLeftTable(`${selectedSchema}.${selectedTable}`);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 shadow-sm transition"
                              title="Open Table Join Assistant with this table"
                            >
                              <GitMerge className="h-3.5 w-3.5" />
                              Join Assistant
                            </button>
                            <button
                              onClick={handleCreateDatasetFromTable}
                              disabled={isCreatingDataset}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded shadow-sm flex items-center gap-1.5 transition"
                            >
                            {isCreatingDataset ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Creating...
                              </>
                            ) : datasetCreatedMsg ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-300" />
                                {datasetCreatedMsg}
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                Create Dataset & Dashboard
                              </>
                            )}
                          </button>
                          </div>
                        </div>

                        {/* Column Table */}
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                              <tr>
                                <th className="px-3 py-2">Column Name</th>
                                <th className="px-3 py-2">Data Type</th>
                                <th className="px-3 py-2">Nullable</th>
                                <th className="px-3 py-2">Primary Key</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {columnList.map((col: any) => (
                                <tr key={col.name} className="hover:bg-slate-50">
                                  <td className="px-3 py-2 font-mono font-medium text-slate-800">
                                    {col.name}
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 font-mono">
                                    {col.data_type}
                                  </td>
                                  <td className="px-3 py-2 text-slate-500">
                                    {col.nullable ? "Yes" : "No"}
                                  </td>
                                  <td className="px-3 py-2 text-slate-500">
                                    {col.is_primary_key ? (
                                      <span className="text-amber-600 font-bold">PK</span>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {columnList.length === 0 && (
                                <tr>
                                  <td colSpan={4} className="py-8 text-center text-slate-400">
                                    No columns found or inspecting table...
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Lookup Record by Primary Key Section */}
                        <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700">
                              <Key className="h-4 w-4" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-slate-900">
                                Lookup Record by Primary Key
                              </h4>
                              <p className="text-[11px] text-slate-500">
                                Fetch row and inspect foreign key parents and child records across other tables
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={pkLookupValue}
                              onChange={(e) => setPkLookupValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && browserDb && selectedTable && pkLookupValue.trim()) {
                                  const pkCol = columnList.find((c: any) => c.is_primary_key)?.name ||
                                    columnList.find((c: any) => c.name.toLowerCase().endsWith("_id") || c.name.toLowerCase() === "id")?.name ||
                                    columnList[0]?.name || "id";
                                  setIsPkLookingUp(true);
                                  setPkLookupError(null);
                                  api.getRowsByKey(browserDb.id, `${selectedSchema}.${selectedTable}`, pkCol, pkLookupValue.trim())
                                    .then((res) => setPkLookupResult(res))
                                    .catch((err) => setPkLookupError(err?.message || "Lookup failed."))
                                    .finally(() => setIsPkLookingUp(false));
                                }
                              }}
                              placeholder={`Enter ${columnList.find((c: any) => c.is_primary_key)?.name || "PK"} value (e.g. 1)`}
                              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono outline-none shadow-sm"
                            />
                            <button
                              type="button"
                              disabled={isPkLookingUp || !pkLookupValue.trim() || !browserDb || !selectedTable}
                              onClick={() => {
                                if (!browserDb || !selectedTable || !pkLookupValue.trim()) return;
                                const pkCol = columnList.find((c: any) => c.is_primary_key)?.name ||
                                  columnList.find((c: any) => c.name.toLowerCase().endsWith("_id") || c.name.toLowerCase() === "id")?.name ||
                                  columnList[0]?.name || "id";
                                setIsPkLookingUp(true);
                                setPkLookupError(null);
                                api.getRowsByKey(browserDb.id, `${selectedSchema}.${selectedTable}`, pkCol, pkLookupValue.trim())
                                  .then((res) => setPkLookupResult(res))
                                  .catch((err) => setPkLookupError(err?.message || "Lookup failed."))
                                  .finally(() => setIsPkLookingUp(false));
                              }}
                              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-1.5 shadow-sm"
                            >
                              {isPkLookingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                              Lookup
                            </button>
                          </div>

                          {pkLookupError && (
                            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                              {pkLookupError}
                            </div>
                          )}

                          {pkLookupResult && (
                            <div className="pt-2 border-t border-slate-200/60 space-y-3">
                              {pkLookupResult.row ? (
                                <>
                                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs">
                                    <div className="font-semibold text-slate-800 mb-1.5 flex items-center justify-between">
                                      <span>Matched Row:</span>
                                      <span className="font-mono text-[10px] text-slate-400">
                                        {pkLookupResult.key_columns.join(",")} = {pkLookupResult.key_values.join(",")}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                                      {Object.entries(pkLookupResult.row).map(([k, v]) => (
                                        <div key={k} className="truncate">
                                          <span className="text-slate-400">{k}:</span>{" "}
                                          <span className="text-slate-800 font-semibold">{v === null ? "null" : String(v)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {pkLookupResult.parents && pkLookupResult.parents.length > 0 && (
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-bold text-slate-600 uppercase flex items-center gap-1">
                                        <Link2 className="h-3 w-3 text-blue-500" />
                                        Referenced Parents ({pkLookupResult.parents.length}):
                                      </div>
                                      <div className="space-y-1">
                                        {pkLookupResult.parents.map((p, idx) => (
                                          <div key={idx} className="p-2 rounded bg-white border border-slate-200 text-xs flex items-center justify-between">
                                            <span className="font-mono text-blue-700 font-semibold">{p.parent_table}</span>
                                            <span className="text-[10px] text-slate-400 font-mono">
                                              via {p.fk_columns.join(",")}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {pkLookupResult.children && pkLookupResult.children.length > 0 && (
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-bold text-slate-600 uppercase flex items-center gap-1">
                                        <Database className="h-3 w-3 text-purple-500" />
                                        Referencing Child Tables:
                                      </div>
                                      <div className="grid grid-cols-2 gap-1.5">
                                        {pkLookupResult.children.map((c, idx) => (
                                          <div key={idx} className="p-2 rounded bg-white border border-slate-200 text-xs flex items-center justify-between">
                                            <span className="font-mono text-slate-800">{c.child_table}</span>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                              c.count > 0 ? "bg-purple-100 text-purple-800" : "bg-slate-100 text-slate-500"
                                            }`}>
                                              {c.count} row{c.count !== 1 ? "s" : ""}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                                  No record found in {pkLookupResult.table} with primary key = {pkLookupValue}.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs space-y-2">
                        <Table className="w-10 h-10 text-slate-300" />
                        <p className="font-medium text-slate-600">No table selected</p>
                        <p className="max-w-xs text-center text-slate-400">
                          Click any table name in the schema tree on the left to inspect its columns and data types.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Modal Footer with Bulk Action */}
                <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">{selectedCount}</span> table{selectedCount !== 1 ? "s" : ""} selected across{" "}
                    <span className="font-semibold text-slate-800">{selectedSchemasCount}</span> schema{selectedSchemasCount !== 1 ? "s" : ""}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setBrowserDb(null);
                        setBulkResults(null);
                        setShowBulkConfirm(false);
                      }}
                      className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 transition"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => setShowBulkConfirm(true)}
                      disabled={selectedCount === 0 || isBulkCreating}
                      className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-sm flex items-center gap-1.5 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Create Datasets & Dashboards ({selectedCount})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Connection Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add Database Connection</h2>
                <p className="text-xs text-slate-500">
                  Credentials are encrypted at rest with AES-256 Fernet keys.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Display Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Production Analytics"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Database Dialect *
                  </label>
                  <select
                    value={formData.dialect}
                    onChange={(e) => handleDialectChange(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    {DIALECTS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Optional notes about this data source"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Mode switch: Form vs URI */}
              <div className="flex items-center gap-4 pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="uri_mode"
                    checked={!formData.use_raw_uri}
                    onChange={() => setFormData({ ...formData, use_raw_uri: false })}
                  />
                  Standard Host & Port
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="uri_mode"
                    checked={formData.use_raw_uri}
                    onChange={() => setFormData({ ...formData, use_raw_uri: true })}
                  />
                  Raw SQLAlchemy URI
                </label>
              </div>

              {formData.use_raw_uri ? (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    SQLAlchemy Connection URI *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="postgresql://user:pass@host:5432/dbname"
                    value={formData.raw_uri}
                    onChange={(e) => setFormData({ ...formData, raw_uri: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Example: postgresql://readonly:secret@db.company.com:5432/warehouse
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Host *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. localhost or 10.0.0.1"
                      value={formData.host}
                      onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Port</label>
                    <input
                      type="number"
                      value={formData.port || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, port: parseInt(e.target.value) || 0 })
                      }
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Database Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. analytics"
                      value={formData.database_name}
                      onChange={(e) => setFormData({ ...formData, database_name: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. read_only_user"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Password (encrypted)
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••••••"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* Safety & Execution Settings */}
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Security & Limits
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_sqllab}
                      onChange={(e) => setFormData({ ...formData, allow_sqllab: e.target.checked })}
                    />
                    <span>Allow SQL Lab Execution</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_dml}
                      onChange={(e) => setFormData({ ...formData, allow_dml: e.target.checked })}
                    />
                    <span className="text-amber-700">Allow DML (Default: Off)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_file_uploads}
                      onChange={(e) =>
                        setFormData({ ...formData, allow_file_uploads: e.target.checked })
                      }
                    />
                    <span>Target for File Uploads</span>
                  </label>
                </div>
              </div>

              {formTestStatus && (
                <div
                  className={`p-3 rounded text-xs flex items-center gap-2 ${
                    formTestStatus.success
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {formTestStatus.success ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span>{formTestStatus.message}</span>
                </div>
              )}

              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleTestFormData}
                  disabled={isTestingForm}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1.5 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingForm ? "animate-spin" : ""}`} />
                  {isTestingForm ? "Testing..." : "Test Connection"}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition shadow-sm"
                  >
                    {createMutation.isPending ? "Saving..." : "Save Connection"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Table Join Assistant Modal */}
      {joinAssistantDb && (
        <JoinAssistantModal
          isOpen={Boolean(joinAssistantDb)}
          onClose={() => {
            setJoinAssistantDb(null);
            setJoinAssistantLeftTable(undefined);
            setJoinAssistantRightTable(undefined);
          }}
          database={joinAssistantDb}
          initialLeftTable={joinAssistantLeftTable}
          initialRightTable={joinAssistantRightTable}
        />
      )}
    </div>
  );
};
export default DatabasesPage;
