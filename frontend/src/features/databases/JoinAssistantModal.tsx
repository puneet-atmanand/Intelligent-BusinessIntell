import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  GitMerge,
  Key,
  Link2,
  Terminal,
  BarChart3,
  Copy,
  CheckCircle2,
  Loader2,
  X,
  AlertTriangle,
  Play,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Database,
  Info,
} from "lucide-react";
import {
  api,
  DatabaseConnection,
  TableKeyInfo,
  JoinSuggestion,
  JoinCondition,
  JoinRunResponse,
  RowsByKeyResponse,
} from "@/app/api";

interface JoinAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: DatabaseConnection;
  initialLeftTable?: string;
  initialRightTable?: string;
}

const JOIN_TYPES = [
  { value: "INNER", label: "INNER JOIN", desc: "Rows with matches in both tables" },
  { value: "LEFT", label: "LEFT JOIN", desc: "All left rows + matched right rows" },
  { value: "RIGHT", label: "RIGHT JOIN", desc: "All right rows + matched left rows" },
  { value: "FULL OUTER", label: "FULL OUTER JOIN", desc: "All rows from both tables" },
  { value: "CROSS", label: "CROSS JOIN", desc: "Cartesian product (capped safe limit)" },
  { value: "LEFT_ANTI", label: "LEFT ANTI JOIN", desc: "Left rows with NO matching right row" },
  { value: "RIGHT_ANTI", label: "RIGHT ANTI JOIN", desc: "Right rows with NO matching left row" },
];

export const JoinAssistantModal: React.FC<JoinAssistantModalProps> = ({
  isOpen,
  onClose,
  database,
  initialLeftTable,
  initialRightTable,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Keys & inventory metadata
  const [tablesList, setTablesList] = useState<TableKeyInfo[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);

  // Join configuration state
  const [leftTable, setLeftTable] = useState<string>("");
  const [rightTable, setRightTable] = useState<string>("");
  const [joinType, setJoinType] = useState<string>("INNER");
  const [suggestions, setSuggestions] = useState<JoinSuggestion[]>([]);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState<number>(0);
  const [customConditions, setCustomConditions] = useState<JoinCondition[]>([]);
  const [useCustomConditions, setUseCustomConditions] = useState<boolean>(false);
  const [columnSelectionMode, setColumnSelectionMode] = useState<"prefixed" | "all">("prefixed");
  const [whereClause, setWhereClause] = useState<string>("");

  // SQL Preview state
  const [generatedSql, setGeneratedSql] = useState<string>("");
  const [isEmulated, setIsEmulated] = useState<boolean>(false);
  const [emulationNotes, setEmulationNotes] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Execution state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [execResult, setExecResult] = useState<JoinRunResponse | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Save as dataset state
  const [showSaveDatasetModal, setShowSaveDatasetModal] = useState<boolean>(false);
  const [datasetName, setDatasetName] = useState<string>("");
  const [isSavingDataset, setIsSavingDataset] = useState<boolean>(false);
  const [savedDatasetSuccess, setSavedDatasetSuccess] = useState<{ id: string; name: string; dashboardSlug?: string } | null>(null);

  // Row-by-key inspector drawer state
  const [inspectingRow, setInspectingRow] = useState<RowsByKeyResponse | null>(null);
  const [isLoadingKeyRow, setIsLoadingKeyRow] = useState<boolean>(false);
  const [activeChildTableTab, setActiveChildTableTab] = useState<string>("");

  // Load database keys on open
  useEffect(() => {
    if (isOpen && database?.id) {
      loadKeys();
    }
  }, [isOpen, database?.id]);

  const loadKeys = async () => {
    try {
      setLoadingKeys(true);
      const res = await api.getDatabaseKeys(database.id);
      const tables = res.tables || [];
      setTablesList(tables);

      if (tables.length > 0) {
        let defaultLeft = initialLeftTable;
        let defaultRight = initialRightTable;

        if (!defaultLeft || !defaultRight) {
          // Look for an existing FK relationship to provide an instant intelligent default
          let foundFk = false;
          for (const t of tables) {
            if (t.foreign_keys && t.foreign_keys.length > 0) {
              const fk = t.foreign_keys[0];
              defaultLeft = `${t.schema}.${t.table}`;
              defaultRight = `${fk.referred_schema}.${fk.referred_table}`;
              foundFk = true;
              break;
            }
          }
          if (!foundFk && tables.length >= 2) {
            defaultLeft = `${tables[0].schema}.${tables[0].table}`;
            defaultRight = `${tables[1].schema}.${tables[1].table}`;
          } else if (!foundFk && tables.length === 1) {
            defaultLeft = `${tables[0].schema}.${tables[0].table}`;
            defaultRight = `${tables[0].schema}.${tables[0].table}`;
          }
        }

        if (defaultLeft) setLeftTable(defaultLeft);
        if (defaultRight) setRightTable(defaultRight);
      }
    } catch (err: any) {
      console.error("Failed to load database keys:", err);
    } finally {
      setLoadingKeys(false);
    }
  };

  // Group tables by schema for clean dropdown optgroups
  const tablesBySchema = useMemo(() => {
    const map: Record<string, TableKeyInfo[]> = {};
    for (const t of tablesList) {
      if (!map[t.schema]) map[t.schema] = [];
      map[t.schema].push(t);
    }
    return map;
  }, [tablesList]);

  // Selected table info objects
  const leftTableInfo = useMemo(() => {
    if (!leftTable) return null;
    const parts = leftTable.split(".");
    const schema = parts.length === 2 ? parts[0] : "public";
    const table = parts.length === 2 ? parts[1] : parts[0];
    return tablesList.find(
      (t) => t.schema.toLowerCase() === schema.toLowerCase() && t.table.toLowerCase() === table.toLowerCase()
    );
  }, [leftTable, tablesList]);

  const rightTableInfo = useMemo(() => {
    if (!rightTable) return null;
    const parts = rightTable.split(".");
    const schema = parts.length === 2 ? parts[0] : "public";
    const table = parts.length === 2 ? parts[1] : parts[0];
    return tablesList.find(
      (t) => t.schema.toLowerCase() === schema.toLowerCase() && t.table.toLowerCase() === table.toLowerCase()
    );
  }, [rightTable, tablesList]);

  // Fetch join suggestions whenever leftTable or rightTable changes
  useEffect(() => {
    if (database?.id && leftTable && rightTable) {
      loadSuggestions();
    }
  }, [database?.id, leftTable, rightTable]);

  const loadSuggestions = async () => {
    try {
      const res = await api.getJoinSuggestions(database.id, leftTable, rightTable);
      const suggs = res.suggestions || [];
      setSuggestions(suggs);
      setSelectedSuggestionIdx(0);
      setUseCustomConditions(false);
      setCustomConditions([]);
    } catch {
      setSuggestions([]);
    }
  };

  // Build active conditions
  const activeConditions: JoinCondition[] = useMemo(() => {
    if (useCustomConditions) {
      return customConditions;
    }
    if (suggestions.length > 0 && selectedSuggestionIdx < suggestions.length) {
      const s = suggestions[selectedSuggestionIdx];
      return s.left_columns.map((lc, idx) => ({
        left_col: lc,
        right_col: s.right_columns[idx] || s.right_columns[0],
      }));
    }
    return [];
  }, [useCustomConditions, customConditions, suggestions, selectedSuggestionIdx]);

  // Update live SQL preview
  useEffect(() => {
    if (database?.id && leftTable && rightTable) {
      updateSql();
    }
  }, [database?.id, leftTable, rightTable, joinType, activeConditions, columnSelectionMode, whereClause]);

  const updateSql = async () => {
    try {
      setSqlError(null);
      const res = await api.buildJoinSql(database.id, {
        left: leftTable,
        right: rightTable,
        join_type: joinType,
        conditions: activeConditions.length > 0 ? activeConditions : undefined,
        select_all: columnSelectionMode === "all",
        where: whereClause.trim() || undefined,
        limit: 100,
        offset: 0,
        include_limit: true,
      });
      setGeneratedSql(res.sql);
      setIsEmulated(res.is_emulated);
      setEmulationNotes(res.notes || null);
    } catch (err: any) {
      setSqlError(err?.message || "Could not generate SQL for current join settings.");
    }
  };

  // Run join query
  const handleRunQuery = async (page: number = 1) => {
    if (!database?.id || !leftTable || !rightTable) return;
    try {
      setIsExecuting(true);
      setExecError(null);
      setCurrentPage(page);

      const offset = (page - 1) * pageSize;
      const res = await api.runJoinQuery(database.id, {
        left: leftTable,
        right: rightTable,
        join_type: joinType,
        conditions: activeConditions.length > 0 ? activeConditions : undefined,
        select_all: columnSelectionMode === "all",
        where: whereClause.trim() || undefined,
        limit: pageSize,
        offset: offset,
      });
      setExecResult(res);
    } catch (err: any) {
      setExecError(err?.message || "Failed to execute join query.");
    } finally {
      setIsExecuting(false);
    }
  };

  // Copy SQL
  const handleCopySql = () => {
    if (!generatedSql) return;
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  // Open in SQL Lab
  const handleOpenInSqlLab = () => {
    if (!generatedSql) return;
    onClose();
    const tabTitle = leftTable && rightTable
      ? `${leftTable.split(".").pop()} + ${rightTable.split(".").pop()}`
      : "Join Query";
    navigate("/sqllab", {
      state: {
        initialSql: generatedSql,
        databaseId: database.id,
        title: tabTitle,
      },
    });
  };

  // Save as dataset
  const handleSaveAsDataset = async () => {
    if (!database?.id || !generatedSql) return;
    const name = datasetName.trim() || `${leftTable.split(".").pop()}_joined_${rightTable.split(".").pop()}`;
    try {
      setIsSavingDataset(true);
      // Generate clean query without LIMIT for dataset
      const cleanSqlRes = await api.buildJoinSql(database.id, {
        left: leftTable,
        right: rightTable,
        join_type: joinType,
        conditions: activeConditions.length > 0 ? activeConditions : undefined,
        select_all: columnSelectionMode === "all",
        where: whereClause.trim() || undefined,
        include_limit: false,
      });

      const res = await api.createDatasetFromJoin({
        database_id: database.id,
        name: name,
        sql: cleanSqlRes.sql,
        left_table: leftTable,
        right_table: rightTable,
        join_type: joinType,
        create_dashboard: true,
      });

      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      await queryClient.invalidateQueries({ queryKey: ["charts"] });

      setSavedDatasetSuccess({
        id: res.dataset_id,
        name: res.name,
        dashboardSlug: res.dashboard_slug,
      });
      setShowSaveDatasetModal(false);
    } catch (err: any) {
      alert(`Error saving dataset: ${err?.message || err}`);
    } finally {
      setIsSavingDataset(false);
    }
  };

  // Create chart directly
  const handleCreateChart = async () => {
    if (savedDatasetSuccess?.id) {
      onClose();
      navigate(`/charts?dataset=${savedDatasetSuccess.id}`);
      return;
    }
    // Save first then navigate
    const name = `${leftTable.split(".").pop()}_joined_${rightTable.split(".").pop()}`;
    try {
      setIsSavingDataset(true);
      const cleanSqlRes = await api.buildJoinSql(database.id, {
        left: leftTable,
        right: rightTable,
        join_type: joinType,
        conditions: activeConditions.length > 0 ? activeConditions : undefined,
        select_all: columnSelectionMode === "all",
        where: whereClause.trim() || undefined,
        include_limit: false,
      });

      const res = await api.createDatasetFromJoin({
        database_id: database.id,
        name: name,
        sql: cleanSqlRes.sql,
        left_table: leftTable,
        right_table: rightTable,
        join_type: joinType,
        create_dashboard: true,
      });

      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      await queryClient.invalidateQueries({ queryKey: ["charts"] });

      onClose();
      navigate(`/charts?dataset=${res.dataset_id}`);
    } catch (err: any) {
      alert(`Error creating chart: ${err?.message || err}`);
    } finally {
      setIsSavingDataset(false);
    }
  };

  // Inspect Row by Primary / Foreign Key
  const handleInspectKey = async (tableIdent: string, keyCol: string, val: any) => {
    if (val === null || val === undefined) return;
    try {
      setIsLoadingKeyRow(true);
      const res = await api.getRowsByKey(database.id, tableIdent, keyCol, String(val));
      setInspectingRow(res);
      if (res.children && res.children.length > 0) {
        setActiveChildTableTab(res.children[0].child_table);
      } else {
        setActiveChildTableTab("");
      }
    } catch (err: any) {
      alert(`Could not fetch related rows: ${err?.message || err}`);
    } finally {
      setIsLoadingKeyRow(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden max-h-[94vh] flex flex-col">

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-blue-50/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-sm">
              <GitMerge className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-lg text-slate-900 tracking-tight">
                  Table Join Assistant
                </h3>
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                  {database.name} ({database.dialect})
                </span>
                {isEmulated && (
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Dialect Emulated
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Join tables across schemas with primary & foreign key awareness, AST guardrails, and instant visualization
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loadingKeys ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-2" />
              <p className="text-xs">Inspecting database tables, primary keys, and foreign keys...</p>
            </div>
          ) : (
            <>
              {/* Top Configuration Grid */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Left Table (t1) */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center font-mono font-bold">t1</span>
                      Left Table
                    </label>
                    <select
                      value={leftTable}
                      onChange={(e) => setLeftTable(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium shadow-sm"
                    >
                      {Object.entries(tablesBySchema).map(([schema, tables]) => (
                        <optgroup key={schema} label={`Schema: ${schema}`}>
                          {tables.map((t) => (
                            <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>
                              {t.schema}.{t.table}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>

                    {/* Left Table Key Metadata Badges */}
                    {leftTableInfo && (
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                        {leftTableInfo.primary_key.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-mono">
                            <Key className="h-2.5 w-2.5 text-amber-600" />
                            PK: {leftTableInfo.primary_key.join(", ")}
                          </span>
                        )}
                        {leftTableInfo.foreign_keys.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono">
                            <Link2 className="h-2.5 w-2.5 text-blue-600" />
                            {leftTableInfo.foreign_keys.length} FK{leftTableInfo.foreign_keys.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Join Type */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Join Type</label>
                    <select
                      value={joinType}
                      onChange={(e) => setJoinType(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium shadow-sm"
                    >
                      {JOIN_TYPES.map((jt) => (
                        <option key={jt.value} value={jt.value}>
                          {jt.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      {JOIN_TYPES.find((j) => j.value === joinType)?.desc}
                    </p>
                  </div>

                  {/* Right Table (t2) */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded bg-purple-100 text-purple-700 text-[10px] flex items-center justify-center font-mono font-bold">t2</span>
                      Right Table
                    </label>
                    <select
                      value={rightTable}
                      onChange={(e) => setRightTable(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium shadow-sm"
                    >
                      {Object.entries(tablesBySchema).map(([schema, tables]) => (
                        <optgroup key={schema} label={`Schema: ${schema}`}>
                          {tables.map((t) => (
                            <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>
                              {t.schema}.{t.table}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>

                    {/* Right Table Key Metadata Badges */}
                    {rightTableInfo && (
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                        {rightTableInfo.primary_key.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-mono">
                            <Key className="h-2.5 w-2.5 text-amber-600" />
                            PK: {rightTableInfo.primary_key.join(", ")}
                          </span>
                        )}
                        {rightTableInfo.foreign_keys.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono">
                            <Link2 className="h-2.5 w-2.5 text-blue-600" />
                            {rightTableInfo.foreign_keys.length} FK{rightTableInfo.foreign_keys.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Join Key / Relationship Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-700">Join Key</label>
                      <button
                        type="button"
                        onClick={() => {
                          if (!useCustomConditions) {
                            setUseCustomConditions(true);
                            setCustomConditions(
                              activeConditions.length > 0
                                ? activeConditions
                                : [{ left_col: leftTableInfo?.columns[0]?.name || "id", right_col: rightTableInfo?.columns[0]?.name || "id" }]
                            );
                          } else {
                            setUseCustomConditions(false);
                          }
                        }}
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-medium underline"
                      >
                        {useCustomConditions ? "Use Suggestions" : "+ Custom Pair"}
                      </button>
                    </div>

                    {!useCustomConditions ? (
                      <select
                        value={selectedSuggestionIdx}
                        onChange={(e) => setSelectedSuggestionIdx(Number(e.target.value))}
                        disabled={suggestions.length === 0}
                        className="w-full px-3 py-2 text-xs rounded-lg bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-mono shadow-sm disabled:bg-slate-100"
                      >
                        {suggestions.length > 0 ? (
                          suggestions.map((s, idx) => (
                            <option key={idx} value={idx}>
                              {s.left_columns.join(",")} = {s.right_columns.join(",")} ({s.source === "foreign_key" ? "foreign key" : "name match"})
                            </option>
                          ))
                        ) : (
                          <option value="0">No auto-match found</option>
                        )}
                      </select>
                    ) : (
                      <div className="space-y-1.5">
                        {customConditions.map((cond, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <select
                              value={cond.left_col}
                              onChange={(e) => {
                                const updated = [...customConditions];
                                updated[idx].left_col = e.target.value;
                                setCustomConditions(updated);
                              }}
                              className="w-1/2 px-2 py-1.5 text-xs rounded bg-white border border-slate-300 outline-none font-mono"
                            >
                              {(leftTableInfo?.columns || []).map((c) => (
                                <option key={c.name} value={c.name}>t1.{c.name}</option>
                              ))}
                            </select>
                            <span className="text-xs text-slate-400">=</span>
                            <select
                              value={cond.right_col}
                              onChange={(e) => {
                                const updated = [...customConditions];
                                updated[idx].right_col = e.target.value;
                                setCustomConditions(updated);
                              }}
                              className="w-1/2 px-2 py-1.5 text-xs rounded bg-white border border-slate-300 outline-none font-mono"
                            >
                              {(rightTableInfo?.columns || []).map((c) => (
                                <option key={c.name} value={c.name}>t2.{c.name}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {suggestions.length > 0 && !useCustomConditions && (
                      <p className="mt-1.5 text-[10px] text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {suggestions[selectedSuggestionIdx]?.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Additional Options Bar */}
                <div className="pt-3 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-slate-600">Columns:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="colSelect"
                        checked={columnSelectionMode === "prefixed"}
                        onChange={() => setColumnSelectionMode("prefixed")}
                        className="text-blue-600"
                      />
                      <span>Collision-safe (t1_col, t2_col)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="colSelect"
                        checked={columnSelectionMode === "all"}
                        onChange={() => setColumnSelectionMode("all")}
                        className="text-blue-600"
                      />
                      <span>SELECT t1.*, t2.*</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-medium">WHERE (Optional):</span>
                    <input
                      type="text"
                      value={whereClause}
                      onChange={(e) => setWhereClause(e.target.value)}
                      placeholder="e.g. t1.marks > 70"
                      className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 bg-white font-mono outline-none w-52"
                    />
                  </div>
                </div>
              </div>

              {/* Live SQL Preview Box */}
              <div className="relative rounded-xl border border-slate-200 bg-slate-900 overflow-hidden shadow-inner">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/80">
                  <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
                    <Terminal className="h-3.5 w-3.5 text-blue-400" />
                    <span>Generated SQL Preview ({database.dialect})</span>
                    {isEmulated && (
                      <span className="text-[10px] text-amber-400">({emulationNotes})</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700"
                  >
                    {copiedSql ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedSql ? "Copied" : "Copy SQL"}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed max-h-36">
                  {sqlError ? (
                    <span className="text-red-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" />
                      {sqlError}
                    </span>
                  ) : (
                    generatedSql || "SELECT ... FROM ...;"
                  )}
                </pre>
              </div>

              {/* Action Buttons Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isExecuting || Boolean(sqlError)}
                    onClick={() => handleRunQuery(1)}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition disabled:opacity-50"
                  >
                    {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    {isExecuting ? "Executing..." : "Run Query"}
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenInSqlLab}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-sm"
                  >
                    <Terminal className="h-3.5 w-3.5 text-slate-500" />
                    Open Join in SQL Lab
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDatasetName(`${leftTable.split(".").pop()}_joined_${rightTable.split(".").pop()}`);
                      setShowSaveDatasetModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition shadow-sm"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    Save as Dataset
                  </button>

                  <button
                    type="button"
                    disabled={isSavingDataset}
                    onClick={handleCreateChart}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm disabled:opacity-50"
                  >
                    {isSavingDataset ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
                    Create Chart
                  </button>
                </div>
              </div>

              {/* Saved Dataset Notification */}
              {savedDatasetSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                    <span>
                      Dataset <strong>{savedDatasetSuccess.name}</strong> created successfully!
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {savedDatasetSuccess.dashboardSlug && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate(`/dashboards/${savedDatasetSuccess.dashboardSlug}`);
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 transition"
                      >
                        View Dashboard
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate(`/charts?dataset=${savedDatasetSuccess.id}`);
                      }}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-white text-emerald-700 border border-emerald-300 hover:bg-emerald-50 transition"
                    >
                      Open in Chart Builder
                    </button>
                  </div>
                </div>
              )}

              {/* Query Results Section */}
              {execError && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
                  <span>{execError}</span>
                </div>
              )}

              {execResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-800">
                        {execResult.row_count} rows returned
                      </span>
                      <span>Execution: {execResult.execution_duration_ms}ms</span>
                      {execResult.is_truncated && (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-medium text-[11px]">
                          Truncated to {execResult.limit} rows
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]">Rows per page:</span>
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                        }}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="25">25</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                      </select>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto max-h-72">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold sticky top-0 z-10">
                          <tr>
                            <th className="px-3 py-2 text-[10px] font-mono text-slate-400">#</th>
                            {execResult.columns.map((col) => {
                              // Identify if column is a primary key or foreign key in left or right table
                              const isPk =
                                (leftTableInfo?.primary_key || []).some(
                                  (pk) => col.toLowerCase() === pk.toLowerCase() || col.toLowerCase() === `t1_${pk}`.toLowerCase()
                                ) ||
                                (rightTableInfo?.primary_key || []).some(
                                  (pk) => col.toLowerCase() === pk.toLowerCase() || col.toLowerCase() === `t2_${pk}`.toLowerCase()
                                );

                              const isFk =
                                (leftTableInfo?.foreign_keys || []).some((fk) =>
                                  fk.columns.some((c) => col.toLowerCase() === c.toLowerCase() || col.toLowerCase() === `t1_${c}`.toLowerCase())
                                ) ||
                                (rightTableInfo?.foreign_keys || []).some((fk) =>
                                  fk.columns.some((c) => col.toLowerCase() === c.toLowerCase() || col.toLowerCase() === `t2_${c}`.toLowerCase())
                                );

                              return (
                                <th key={col} className="px-3 py-2 whitespace-nowrap">
                                  <div className="flex items-center gap-1">
                                    {isPk && (
                                      <span title="Primary Key">
                                        <Key className="h-3 w-3 text-amber-500 flex-shrink-0" />
                                      </span>
                                    )}
                                    {isFk && (
                                      <span title="Foreign Key">
                                        <Link2 className="h-3 w-3 text-blue-500 flex-shrink-0" />
                                      </span>
                                    )}
                                    <span className="font-mono">{col}</span>
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {execResult.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-blue-50/40 transition">
                              <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400">
                                {(currentPage - 1) * pageSize + rIdx + 1}
                              </td>
                              {row.map((cellVal, cIdx) => {
                                const colName = execResult.columns[cIdx] || "";
                                // Check if this column is an FK from left or right table to make it a clickable navigation pill
                                let fkRefTable: string | null = null;
                                let fkRefCol: string | null = null;

                                // Check in left table FKs
                                for (const fk of leftTableInfo?.foreign_keys || []) {
                                  for (let i = 0; i < fk.columns.length; i++) {
                                    const origCol = fk.columns[i];
                                    if (
                                      colName.toLowerCase() === origCol.toLowerCase() ||
                                      colName.toLowerCase() === `t1_${origCol}`.toLowerCase()
                                    ) {
                                      fkRefTable = `${fk.referred_schema}.${fk.referred_table}`;
                                      fkRefCol = fk.referred_columns[i];
                                      break;
                                    }
                                  }
                                }

                                // Check in right table FKs
                                if (!fkRefTable) {
                                  for (const fk of rightTableInfo?.foreign_keys || []) {
                                    for (let i = 0; i < fk.columns.length; i++) {
                                      const origCol = fk.columns[i];
                                      if (
                                        colName.toLowerCase() === origCol.toLowerCase() ||
                                        colName.toLowerCase() === `t2_${origCol}`.toLowerCase()
                                      ) {
                                        fkRefTable = `${fk.referred_schema}.${fk.referred_table}`;
                                        fkRefCol = fk.referred_columns[i];
                                        break;
                                      }
                                    }
                                  }
                                }

                                // Check if cell is a PK in left or right table
                                let pkTable: string | null = null;
                                let pkColName: string | null = null;
                                for (const pk of leftTableInfo?.primary_key || []) {
                                  if (colName.toLowerCase() === pk.toLowerCase() || colName.toLowerCase() === `t1_${pk}`.toLowerCase()) {
                                    pkTable = leftTable;
                                    pkColName = pk;
                                    break;
                                  }
                                }
                                if (!pkTable) {
                                  for (const pk of rightTableInfo?.primary_key || []) {
                                    if (colName.toLowerCase() === pk.toLowerCase() || colName.toLowerCase() === `t2_${pk}`.toLowerCase()) {
                                      pkTable = rightTable;
                                      pkColName = pk;
                                      break;
                                    }
                                  }
                                }

                                const isClickableFk = Boolean(fkRefTable && fkRefCol && cellVal !== null);
                                const isClickablePk = Boolean(pkTable && pkColName && cellVal !== null);

                                return (
                                  <td key={cIdx} className="px-3 py-1.5 whitespace-nowrap font-mono text-slate-700">
                                    {isClickableFk ? (
                                      <button
                                        type="button"
                                        onClick={() => handleInspectKey(fkRefTable!, fkRefCol!, cellVal)}
                                        title={`Lookup parent record in ${fkRefTable}`}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-900 border border-blue-200 transition"
                                      >
                                        <Link2 className="h-2.5 w-2.5 text-blue-600" />
                                        {String(cellVal)}
                                      </button>
                                    ) : isClickablePk ? (
                                      <button
                                        type="button"
                                        onClick={() => handleInspectKey(pkTable!, pkColName!, cellVal)}
                                        title={`Lookup relationships for PK in ${pkTable}`}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 transition"
                                      >
                                        <Key className="h-2.5 w-2.5 text-amber-600" />
                                        {String(cellVal)}
                                      </button>
                                    ) : cellVal === null || cellVal === undefined ? (
                                      <span className="text-slate-300 italic text-[11px]">NULL</span>
                                    ) : (
                                      String(cellVal)
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pagination Controls */}
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                    <span>
                      Page {currentPage} of {Math.max(1, Math.ceil(execResult.row_count / pageSize))}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={currentPage <= 1 || isExecuting}
                        onClick={() => handleRunQuery(currentPage - 1)}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" /> Previous
                      </button>
                      <button
                        type="button"
                        disabled={execResult.rows.length < pageSize || isExecuting}
                        onClick={() => handleRunQuery(currentPage + 1)}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
                      >
                        Next <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
          <span className="text-xs text-slate-400">
            Intelligent BI Table Join Assistant • Non-destructive read-only queries with AST security guardrails
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

      {/* Save As Dataset Sub-Modal */}
      {showSaveDatasetModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <BookmarkPlus className="h-4 w-4 text-emerald-600" />
                Save Join as Virtual Dataset
              </h4>
              <button
                onClick={() => setShowSaveDatasetModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Dataset Name
              </label>
              <input
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="e.g. Students With Fees Overview"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                A virtual dataset will be registered in the semantic catalog and auto-provisioned with charts & dashboard.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveDatasetModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingDataset || !datasetName.trim()}
                onClick={handleSaveAsDataset}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSavingDataset && <Loader2 className="h-3 w-3 animate-spin" />}
                {isSavingDataset ? "Saving..." : "Save Dataset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Row-By-Key Navigation Inspector Drawer */}
      {inspectingRow && (
        <div className="fixed inset-y-0 right-0 z-60 w-full max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1 rounded bg-blue-100 text-blue-700">
                  <Database className="h-4 w-4" />
                </span>
                <h4 className="font-bold text-sm text-slate-900">
                  {inspectingRow.table} Record Inspector
                </h4>
                {isLoadingKeyRow && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Key: {inspectingRow.key_columns.join(", ")} = {inspectingRow.key_values.join(", ")}
              </p>
            </div>
            <button
              onClick={() => setInspectingRow(null)}
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
              {inspectingRow.row ? (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(inspectingRow.row).map(([col, val]) => (
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
                  No row found with {inspectingRow.key_columns.join(", ")} = {inspectingRow.key_values.join(", ")}
                </div>
              )}
            </div>

            {/* Parent Records (Foreign Key References) */}
            {inspectingRow.parents && inspectingRow.parents.length > 0 && (
              <div>
                <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-blue-500" />
                  Parent Referenced Records ({inspectingRow.parents.length})
                </h5>
                <div className="space-y-2">
                  {inspectingRow.parents.map((p, idx) => (
                    <div key={idx} className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-semibold text-slate-800">
                        <span className="font-mono text-blue-700">{p.parent_table}</span>
                        <span className="text-[10px] text-slate-400 font-normal">
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

            {/* Child Records (Incoming References) */}
            {inspectingRow.children && inspectingRow.children.length > 0 && (
              <div>
                <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-purple-500" />
                  Related Child Records ({inspectingRow.children.reduce((s, c) => s + c.count, 0)})
                </h5>

                {/* Child table tabs */}
                <div className="flex items-center gap-1 border-b border-slate-200 mb-2 overflow-x-auto">
                  {inspectingRow.children.map((child) => (
                    <button
                      key={child.child_table}
                      type="button"
                      onClick={() => setActiveChildTableTab(child.child_table)}
                      className={`px-3 py-1.5 text-xs font-medium border-b-2 whitespace-nowrap transition ${
                        activeChildTableTab === child.child_table
                          ? "border-blue-600 text-blue-600 bg-blue-50/50"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {child.child_table} ({child.count})
                    </button>
                  ))}
                </div>

                {/* Active Child Table Preview */}
                {(() => {
                  const activeChild = inspectingRow.children.find((c) => c.child_table === activeChildTableTab);
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
              onClick={() => setInspectingRow(null)}
              className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition"
            >
              Close Drawer
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default JoinAssistantModal;
