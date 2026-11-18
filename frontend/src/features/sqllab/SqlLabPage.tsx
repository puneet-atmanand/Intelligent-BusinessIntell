import React, { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Play,
  Square,
  Save,
  Download,
  Copy,
  Plus,
  X,
  History,
  Bookmark,
  Table,
  AlertCircle,
  Clock,
  BarChart3,
  Layers,
  Search,
  Trash2,
  ExternalLink,
  Check,
} from "lucide-react";
import { api, SqlQueryResult } from "@/app/api";

interface SqlTab {
  id: string;
  title: string;
  sql: string;
  databaseId: string;
  result: SqlQueryResult | null;
  error: string | null;
  isLoading: boolean;
}

export const SqlLabPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as
    | { initialSql?: string; databaseId?: string; title?: string }
    | undefined;
  const initialHandledRef = useRef(false);

  // Active databases
  const { data: databases = [] } = useQuery({
    queryKey: ["databases"],
    queryFn: api.getDatabases,
  });

  // Query history & saved queries
  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ["sqlHistory"],
    queryFn: api.getQueryHistory,
  });

  const { data: savedQueries = [], refetch: refetchSavedQueries } = useQuery({
    queryKey: ["savedQueries"],
    queryFn: api.getSavedQueries,
  });

  const historyList: any[] = Array.isArray(history) ? history : (history as any)?.data || [];
  const savedQueriesList: any[] = Array.isArray(savedQueries) ? savedQueries : (savedQueries as any)?.data || [];

  // Active database for left browser
  const [selectedDbId, setSelectedDbId] = useState<string>(locationState?.databaseId || "");
  const [selectedSchema, setSelectedSchema] = useState<string>("main");
  const [tableSearch, setTableSearch] = useState<string>("");

  // Tabs state
  const [tabs, setTabs] = useState<SqlTab[]>([
    {
      id: "tab-1",
      title: locationState?.title || "Query 1",
      sql:
        locationState?.initialSql ||
        "-- Run queries against your connected database or DuckDB uploads\nSELECT * FROM information_schema.tables LIMIT 20;",
      databaseId: locationState?.databaseId || "",
      result: null,
      error: null,
      isLoading: false,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("tab-1");
  const [rowLimit, setRowLimit] = useState<number>(1000);
  const [resultSearch, setResultSearch] = useState<string>("");
  const [sideDrawer, setSideDrawer] = useState<"history" | "saved" | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [savedSearch, setSavedSearch] = useState<string>("");

  // Save query modal
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [isSavingQuery, setIsSavingQuery] = useState(false);

  // Create virtual dataset modal
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [datasetModalMode, setDatasetModalMode] = useState<"save" | "explore">("save");
  const [datasetName, setDatasetName] = useState("");
  const [isCreatingDataset, setIsCreatingDataset] = useState(false);

  // Sync state if coming from Table Join Assistant or external link
  useEffect(() => {
    if (initialHandledRef.current) return;
    if (locationState?.initialSql) {
      initialHandledRef.current = true;
      const targetDbId = locationState.databaseId || selectedDbId;
      if (targetDbId) {
        setSelectedDbId(targetDbId);
      }
      setTabs([
        {
          id: "tab-1",
          title: locationState.title || "Join Query",
          sql: locationState.initialSql,
          databaseId: targetDbId,
          result: null,
          error: null,
          isLoading: false,
        },
      ]);
      setActiveTabId("tab-1");
      setToastMessage({
        text: `Loaded join query for ${locationState.title || "selected tables"}.`,
        type: "success",
      });
      setTimeout(() => setToastMessage(null), 3500);
      window.history.replaceState({}, document.title);
    }
  }, [locationState, selectedDbId]);

  // Update default database once loaded
  useEffect(() => {
    if (databases.length > 0 && !selectedDbId) {
      const defaultDb =
        (locationState?.databaseId && databases.find((d) => d.id === locationState.databaseId)) ||
        databases.find((d) => d.is_system) ||
        databases[0];
      setSelectedDbId(defaultDb.id);
      setTabs((prev) =>
        prev.map((t) => (t.databaseId ? t : { ...t, databaseId: defaultDb.id }))
      );
    }
  }, [databases, selectedDbId, locationState]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Schema queries for left panel
  const { data: schemas = [] } = useQuery({
    queryKey: ["schemas", selectedDbId],
    queryFn: () => (selectedDbId ? api.getDatabaseSchemas(selectedDbId) : Promise.resolve([])),
    enabled: Boolean(selectedDbId),
  });

  // Ensure selectedSchema is synchronized when database or schemas change
  useEffect(() => {
    if (schemas.length > 0 && !schemas.includes(selectedSchema)) {
      setSelectedSchema(
        schemas.includes("dbo")
          ? "dbo"
          : schemas.includes("public")
          ? "public"
          : schemas[0]
      );
    }
  }, [schemas, selectedSchema]);

  const { data: tables = [] } = useQuery({
    queryKey: ["tables", selectedDbId, selectedSchema],
    queryFn: () =>
      selectedDbId ? api.getDatabaseTables(selectedDbId, selectedSchema) : Promise.resolve([]),
    enabled: Boolean(selectedDbId),
  });

  // Global Ctrl+Enter / Cmd+Enter shortcut to run active query
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleRunQuery();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab]);

  // Execute query mutation
  const executeMutation = useMutation({
    mutationFn: (tab: SqlTab) =>
      api.executeSql({
        database_id: tab.databaseId || selectedDbId,
        sql: tab.sql,
        limit: rowLimit,
      }),
    onSuccess: (data) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, result: data, error: null, isLoading: false }
            : t
        )
      );
      refetchHistory();
    },
    onError: (err: any) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, error: err.message || "Query failed", result: null, isLoading: false }
            : t
        )
      );
      refetchHistory();
    },
  });

  const handleRunQuery = () => {
    if (!activeTab.sql.trim()) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: true, error: null } : t))
    );
    executeMutation.mutate(activeTab);
  };

  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: SqlTab = {
      id: newId,
      title: `Query ${tabs.length + 1}`,
      sql: "SELECT 1;",
      databaseId: selectedDbId,
      result: null,
      error: null,
      isLoading: false,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[0].id);
      if (remaining[0].databaseId) {
        setSelectedDbId(remaining[0].databaseId);
      }
    }
  };

  const handleRowLimitChange = (newLimit: number) => {
    setRowLimit(newLimit);
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        // If current query text contains LIMIT <number>, update it so editor and query execution match
        const updatedSql = tab.sql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${newLimit}`);
        return { ...tab, sql: updatedSql };
      })
    );
  };

  const handleSaveQuery = async () => {
    if (!saveTitle.trim()) return;
    setIsSavingQuery(true);
    try {
      await api.saveQuery({
        database_id: activeTab.databaseId || selectedDbId,
        title: saveTitle.trim(),
        description: saveDescription.trim(),
        sql: activeTab.sql,
      });
      const savedTitle = saveTitle.trim();
      setIsSaveModalOpen(false);
      setSaveTitle("");
      setSaveDescription("");
      await queryClient.invalidateQueries({ queryKey: ["savedQueries"] });
      refetchSavedQueries();
      setSideDrawer("saved");
      setToastMessage({
        text: `Query "${savedTitle}" saved successfully!`,
        type: "success",
      });
      setTimeout(() => setToastMessage(null), 4500);
    } catch (err: any) {
      setToastMessage({
        text: err?.response?.data?.message || err?.message || "Failed to save query",
        type: "error",
      });
    } finally {
      setIsSavingQuery(false);
    }
  };

  const handleDeleteSavedQuery = async (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete saved query "${title}"?`)) return;
    try {
      await api.deleteSavedQuery(id);
      await queryClient.invalidateQueries({ queryKey: ["savedQueries"] });
      refetchSavedQueries();
      setToastMessage({
        text: `Saved query "${title}" deleted.`,
        type: "success",
      });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setToastMessage({
        text: err?.message || "Failed to delete saved query",
        type: "error",
      });
    }
  };

  const handleLoadSavedQuery = (s: any, inNewTab: boolean = false) => {
    if (inNewTab) {
      const newId = `tab-${Date.now()}`;
      const newTab: SqlTab = {
        id: newId,
        title: s.title || `Query ${tabs.length + 1}`,
        sql: s.sql,
        databaseId: s.database_id || selectedDbId,
        result: null,
        error: null,
        isLoading: false,
      };
      setTabs([...tabs, newTab]);
      setActiveTabId(newId);
      if (s.database_id) {
        setSelectedDbId(s.database_id);
      }
    } else {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? {
                ...tab,
                title: s.title || tab.title,
                sql: s.sql,
                databaseId: s.database_id || tab.databaseId || selectedDbId,
              }
            : tab
        )
      );
      if (s.database_id) {
        setSelectedDbId(s.database_id);
      }
    }
    setToastMessage({
      text: `Loaded saved query "${s.title}" into editor.`,
      type: "success",
    });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleOpenDatasetModal = (mode: "save" | "explore") => {
    setDatasetModalMode(mode);
    const defaultName =
      mode === "explore"
        ? activeTab.title
          ? `${activeTab.title} Explore`
          : "Explore View"
        : activeTab.title
        ? `${activeTab.title} Dataset`
        : "Virtual Dataset";
    setDatasetName(defaultName);
    setIsDatasetModalOpen(true);
  };

  const handleCreateVirtualDataset = async (redirectToExplore: boolean = false) => {
    if (!datasetName.trim()) return;
    setIsCreatingDataset(true);
    try {
      const cleanSql = activeTab.sql.trim().replace(/;+\s*$/, "");
      const res = await api.createDataset({
        name: datasetName.trim(),
        database_id: activeTab.databaseId || selectedDbId,
        schema_name: selectedSchema || "dbo",
        is_virtual: true,
        sql_expression: cleanSql,
        sql_query: cleanSql,
      });
      setIsDatasetModalOpen(false);
      setDatasetName("");
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      if (redirectToExplore && res?.id) {
        navigate(`/charts?dataset=${res.id}`);
      } else {
        navigate("/datasets");
      }
    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message || "Failed to create dataset");
    } finally {
      setIsCreatingDataset(false);
    }
  };

  const handleCopyResults = () => {
    if (!activeTab.result) return;
    const { columns, rows } = activeTab.result;
    const tsv = [
      columns.join("\t"),
      ...rows.map((row) => row.map((cell) => (cell === null ? "" : cell)).join("\t")),
    ].join("\n");
    navigator.clipboard.writeText(tsv);
    alert("Results copied to clipboard as TSV.");
  };

  const handleDownloadCsv = () => {
    if (!activeTab.result) return;
    const { columns, rows } = activeTab.result;
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [
        columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(","),
        ...rows.map((row) =>
          row
            .map((val) => {
              if (val === null || val === undefined) return "";
              const str = String(val).replace(/"/g, '""');
              return `"${str}"`;
            })
            .join(",")
        ),
      ].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `query_result_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredTables = tables.filter((t) =>
    t.toLowerCase().includes(tableSearch.toLowerCase())
  );

  const filteredRows = activeTab.result?.rows.filter((row) => {
    if (!resultSearch.trim()) return true;
    return row.some((val) =>
      val !== null && String(val).toLowerCase().includes(resultSearch.toLowerCase())
    );
  }) || [];

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 overflow-hidden">
      {/* Left Sidebar: Schema Browser */}
      <div className="w-64 border-r border-slate-200 bg-white flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-slate-200">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Database
          </label>
          <select
            value={selectedDbId}
            onChange={(e) => {
              setSelectedDbId(e.target.value);
              setTabs((prev) =>
                prev.map((t) => (t.id === activeTabId ? { ...t, databaseId: e.target.value } : t))
              );
            }}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded font-medium focus:ring-1 focus:ring-blue-500 bg-white"
          >
            {databases.map((db) => (
              <option key={db.id} value={db.id}>
                {db.name} ({db.dialect})
              </option>
            ))}
          </select>

          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-3 mb-1">
            Schema
          </label>
          <select
            value={selectedSchema}
            onChange={(e) => setSelectedSchema(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
          >
            {schemas.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Table Search */}
        <div className="p-2 border-b border-slate-100">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search tables..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full pl-8 pr-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Tables List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTables.map((t) => (
            <button
              key={t}
              onClick={() => {
                const tableRef = selectedSchema && selectedSchema !== "main" && selectedSchema !== "public" ? `${selectedSchema}.${t}` : t;
                const appendSql = `\nSELECT * FROM ${tableRef} LIMIT ${rowLimit};`;
                setTabs((prev) =>
                  prev.map((tab) =>
                    tab.id === activeTabId ? { ...tab, sql: tab.sql + appendSql } : tab
                  )
                );
              }}
              className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center justify-between group transition"
              title="Click to append SELECT query"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Table className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600" />
                <span className="font-mono text-[11px] truncate">{t}</span>
              </span>
              <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">
                +query
              </span>
            </button>
          ))}
          {filteredTables.length === 0 && (
            <div className="text-center py-6 text-[11px] text-slate-400">
              No tables found.
            </div>
          )}
        </div>

        {/* Drawer Toggles */}
        <div className="p-2 border-t border-slate-200 bg-slate-50 flex items-center justify-around text-xs">
          <button
            onClick={() => setSideDrawer(sideDrawer === "history" ? null : "history")}
            className={`flex items-center gap-1 px-2 py-1 rounded transition ${
              sideDrawer === "history" ? "bg-blue-100 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            History ({historyList.length})
          </button>
          <button
            onClick={() => setSideDrawer(sideDrawer === "saved" ? null : "saved")}
            className={`flex items-center gap-1 px-2 py-1 rounded transition ${
              sideDrawer === "saved" ? "bg-blue-100 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            Saved ({savedQueriesList.length})
          </button>
        </div>
      </div>

      {/* Main Work Area: Tabs, Editor & Results */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Tabs Bar */}
        <div className="bg-slate-100 border-b border-slate-200 flex items-center justify-between px-3 pt-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => {
                  setActiveTabId(tab.id);
                  if (tab.databaseId && tab.databaseId !== selectedDbId) {
                    setSelectedDbId(tab.databaseId);
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-t-md cursor-pointer transition border-t border-x ${
                  activeTabId === tab.id
                    ? "bg-white text-blue-600 border-slate-200 shadow-sm"
                    : "bg-slate-200/70 text-slate-600 border-transparent hover:bg-slate-200"
                }`}
              >
                <span>{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    className="hover:text-red-500 rounded p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={handleAddTab}
              className="p-1 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-200 ml-1 transition"
              title="Add query tab"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 pb-1.5">
            <span className="text-[11px] text-slate-500 font-medium">Row limit:</span>
            <select
              value={rowLimit}
              onChange={(e) => handleRowLimitChange(Number(e.target.value))}
              className="px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value={100}>100</option>
              <option value={1000}>1,000</option>
              <option value={5000}>5,000</option>
              <option value={10000}>10,000</option>
            </select>
          </div>
        </div>

        {/* Editor Action Bar */}
        <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunQuery}
              disabled={activeTab.isLoading}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md shadow-sm transition"
              title="Run Query (Ctrl+Enter)"
            >
              {activeTab.isLoading ? (
                <>
                  <Square className="w-3.5 h-3.5 animate-pulse text-red-300" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Run (Ctrl+↵)
                </>
              )}
            </button>

            <button
              onClick={() => setIsSaveModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition"
              title="Save current query"
            >
              <Save className="w-3.5 h-3.5 text-slate-600" />
              Save Query
            </button>

            <button
              onClick={() => setSideDrawer(sideDrawer === "saved" ? null : "saved")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition border ${
                sideDrawer === "saved"
                  ? "bg-blue-50 text-blue-700 border-blue-300 font-semibold shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
              title="View saved queries"
            >
              <Bookmark className="w-3.5 h-3.5 text-blue-600" />
              Saved Queries ({savedQueriesList.length})
            </button>

            <button
              onClick={() => setSideDrawer(sideDrawer === "history" ? null : "history")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition border ${
                sideDrawer === "history"
                  ? "bg-blue-50 text-blue-700 border-blue-300 font-semibold shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
              title="View query history"
            >
              <History className="w-3.5 h-3.5 text-slate-500" />
              History ({historyList.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab.result && (
              <>
                <button
                  onClick={() => handleOpenDatasetModal("save")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-md transition"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Create Virtual Dataset
                </button>

                <button
                  onClick={() => handleOpenDatasetModal("explore")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Explore Chart
                </button>
              </>
            )}
          </div>
        </div>

        {/* Feedback / Notification Banner */}
        {toastMessage && (
          <div
            className={`px-4 py-2 text-xs font-medium flex items-center justify-between transition-all ${
              toastMessage.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-b border-emerald-200"
                : "bg-red-50 text-red-800 border-b border-red-200"
            }`}
          >
            <span className="flex items-center gap-2">
              {toastMessage.type === "success" ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
              )}
              {toastMessage.text}
            </span>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold ml-4"
            >
              ✕
            </button>
          </div>
        )}

        {/* Monaco Editor Pane */}
        <div className="h-56 border-b border-slate-200 bg-white">
          <Editor
            height="100%"
            defaultLanguage="sql"
            value={activeTab.sql}
            onMount={(editor, monaco) => {
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                handleRunQuery();
              });
            }}
            onChange={(val) => {
              setTabs((prev) =>
                prev.map((t) => (t.id === activeTabId ? { ...t, sql: val || "" } : t))
              );
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </div>

        {/* Results Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {/* Result Status Header */}
          <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-700">Results</span>
              {activeTab.result && (
                <div className="flex items-center gap-2 text-slate-500">
                  <span className="font-mono font-medium text-slate-800">
                    {activeTab.result.row_count} rows
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {activeTab.result.duration_ms} ms
                  </span>
                  {activeTab.result.truncated && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded">
                      Limit Reached ({rowLimit})
                    </span>
                  )}
                </div>
              )}
            </div>

            {activeTab.result && (
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Filter results..."
                  value={resultSearch}
                  onChange={(e) => setResultSearch(e.target.value)}
                  className="px-2 py-0.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleCopyResults}
                  className="text-slate-600 hover:text-slate-900 flex items-center gap-1 transition"
                  title="Copy as TSV"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </button>
                <button
                  onClick={handleDownloadCsv}
                  className="text-slate-600 hover:text-slate-900 flex items-center gap-1 transition"
                  title="Download CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </button>
              </div>
            )}
          </div>

          {/* Result Content */}
          <div className="flex-1 overflow-auto">
            {activeTab.error && (
              <div className="p-4 bg-red-50 text-red-700 text-xs border-l-4 border-red-500 m-4 rounded flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold">Query Execution Error</span>
                  <p className="font-mono text-[11px] whitespace-pre-wrap">{activeTab.error}</p>
                </div>
              </div>
            )}

            {!activeTab.result && !activeTab.error && !activeTab.isLoading && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs py-10">
                <Play className="w-8 h-8 mb-2 opacity-30" />
                Write SQL above and press "Run" or hit Ctrl+Enter to execute.
              </div>
            )}

            {activeTab.isLoading && (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-10">
                <Clock className="w-8 h-8 mb-2 animate-spin text-blue-600" />
                Executing query on database...
              </div>
            )}

            {activeTab.result && (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 w-10 text-slate-400 text-[10px] font-mono">#</th>
                    {activeTab.result.columns.map((col, idx) => (
                      <th key={col} className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">
                        <div>{col}</div>
                        <div className="text-[9px] text-slate-400 font-normal">
                          {activeTab.result?.column_types[idx] || "string"}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {filteredRows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-blue-50/50 transition">
                      <td className="px-3 py-1.5 text-slate-400 text-[10px]">{rIdx + 1}</td>
                      {row.map((val, cIdx) => (
                        <td key={cIdx} className="px-3 py-1.5 whitespace-nowrap text-slate-800">
                          {val === null || val === undefined ? (
                            <span className="text-slate-300 italic">null</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Side Drawer: History & Saved Queries */}
      {sideDrawer && (
        <div className="w-88 border-l border-slate-200 bg-white flex flex-col flex-shrink-0 z-10 shadow-sm" style={{ width: "22rem" }}>
          <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              {sideDrawer === "history" ? (
                <>
                  <History className="w-4 h-4 text-blue-600" />
                  Execution History ({historyList.length})
                </>
              ) : (
                <>
                  <Bookmark className="w-4 h-4 text-blue-600" />
                  Saved Queries ({savedQueriesList.length})
                </>
              )}
            </h3>
            <button
              onClick={() => setSideDrawer(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold p-1 rounded hover:bg-slate-200"
            >
              ✕
            </button>
          </div>

          {sideDrawer === "saved" && (
            <div className="p-2 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search saved queries..."
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                  className="w-full pl-8 pr-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {sideDrawer === "history" &&
              historyList.map((h) => (
                <div
                  key={h.id}
                  onClick={() => {
                    setTabs((prev) =>
                      prev.map((tab) =>
                        tab.id === activeTabId ? { ...tab, sql: h.sql } : tab
                      )
                    );
                    setToastMessage({
                      text: "Loaded query from history.",
                      type: "success",
                    });
                    setTimeout(() => setToastMessage(null), 3000);
                  }}
                  className="p-2.5 bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded-lg cursor-pointer transition text-xs space-y-1.5 group"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                        h.status === "success"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {h.status.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {h.duration_ms ? `${h.duration_ms}ms` : h.execution_duration_ms ? `${h.execution_duration_ms}ms` : "—"}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-slate-800 line-clamp-2">{h.sql}</p>
                </div>
              ))}

            {sideDrawer === "saved" &&
              savedQueriesList
                .filter((s) => {
                  if (!savedSearch.trim()) return true;
                  const q = savedSearch.toLowerCase();
                  return (
                    (s.title || "").toLowerCase().includes(q) ||
                    (s.description || "").toLowerCase().includes(q) ||
                    (s.sql || "").toLowerCase().includes(q)
                  );
                })
                .map((s) => {
                  const dbName = databases.find((d) => d.id === s.database_id)?.name;
                  return (
                    <div
                      key={s.id}
                      className="p-3 bg-white hover:bg-blue-50/40 border border-slate-200 rounded-lg transition text-xs space-y-2 shadow-xs group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5 flex-1 min-w-0">
                          <h4 className="font-semibold text-slate-900 truncate text-xs">{s.title}</h4>
                          {dbName && (
                            <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 text-slate-600 rounded">
                              {dbName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                          <button
                            onClick={(e) => handleDeleteSavedQuery(s.id, s.title, e)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition"
                            title="Delete saved query"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {s.description && (
                        <p className="text-[11px] text-slate-500 line-clamp-2">{s.description}</p>
                      )}

                      <div className="p-2 bg-slate-50 rounded border border-slate-100 font-mono text-[10px] text-slate-700 line-clamp-3 overflow-hidden">
                        {s.sql}
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                        <button
                          onClick={() => handleLoadSavedQuery(s, false)}
                          className="flex-1 py-1 px-2 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition text-center"
                        >
                          Load in Tab
                        </button>
                        <button
                          onClick={() => handleLoadSavedQuery(s, true)}
                          className="py-1 px-2 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition flex items-center gap-1"
                          title="Open in new tab"
                        >
                          <ExternalLink className="w-3 h-3" />
                          + Tab
                        </button>
                      </div>
                    </div>
                  );
                })}

            {sideDrawer === "saved" && savedQueriesList.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-xs px-4">
                <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-30 text-blue-500" />
                <p className="font-semibold text-slate-600">No saved queries yet</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Write a query in the editor and click "Save Query" to save and access it here anytime.
                </p>
              </div>
            )}

            {sideDrawer === "history" && historyList.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-xs px-4">
                <History className="w-8 h-8 mx-auto mb-2 opacity-30 text-slate-500" />
                <p className="font-semibold text-slate-600">No query history yet</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Run a query to view execution history.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Query Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">Save Query</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Title *</label>
              <input
                type="text"
                autoFocus
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && saveTitle.trim() && !isSavingQuery) {
                    handleSaveQuery();
                  }
                }}
                placeholder="e.g. Monthly Revenue Breakdown"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <input
                type="text"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="Optional notes"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                disabled={isSavingQuery}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveQuery}
                disabled={!saveTitle.trim() || isSavingQuery}
                className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded shadow-sm disabled:opacity-50"
              >
                {isSavingQuery ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Explore Virtual Dataset Modal */}
      {isDatasetModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">
              {datasetModalMode === "explore" ? "Explore in Chart Builder" : "Create Virtual Dataset"}
            </h3>
            <p className="text-xs text-slate-500">
              {datasetModalMode === "explore"
                ? "Save this SQL query as a virtual dataset to open it directly in the Chart edit/explore section."
                : "Save this SQL query as a reusable semantic dataset for charts and AI exploration."}
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Dataset Name *
              </label>
              <input
                type="text"
                autoFocus
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && datasetName.trim() && !isCreatingDataset) {
                    handleCreateVirtualDataset(datasetModalMode === "explore");
                  }
                }}
                placeholder="e.g. Active Customers View"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsDatasetModalOpen(false)}
                disabled={isCreatingDataset}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
              >
                Cancel
              </button>

              {datasetModalMode === "save" ? (
                <>
                  <button
                    onClick={() => handleCreateVirtualDataset(false)}
                    disabled={!datasetName.trim() || isCreatingDataset}
                    className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition"
                  >
                    {isCreatingDataset ? "Saving..." : "Save Dataset"}
                  </button>
                  <button
                    onClick={() => handleCreateVirtualDataset(true)}
                    disabled={!datasetName.trim() || isCreatingDataset}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded shadow-sm transition flex items-center gap-1.5"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    {isCreatingDataset ? "Saving..." : "Save & Explore"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleCreateVirtualDataset(true)}
                  disabled={!datasetName.trim() || isCreatingDataset}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded shadow-sm transition flex items-center gap-1.5"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  {isCreatingDataset ? "Opening Builder..." : "Explore in Charts →"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default SqlLabPage;
