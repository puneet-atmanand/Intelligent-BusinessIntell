import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  X,
  Send,
  ShieldCheck,
  Code,
  Table as TableIcon,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  BarChart3,
  Terminal,
  AlertTriangle,
  Clock,
  Plus,
} from "lucide-react";
import { api, AIChatResponse, AIStatus } from "@/app/api";

interface MessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  data?: AIChatResponse;
  timestamp: Date;
}

const SAMPLE_QUESTIONS = [
  "What is our total revenue breakdown by category?",
  "Show revenue and net profit across all regions",
  "What are our top 5 enterprise customers by revenue?",
  "What is our total gross revenue?",
];

export const AIDrawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  datasetId?: string;
  datasetName?: string;
  dashboardId?: string;
  dashboardName?: string;
}> = ({
  isOpen,
  onClose,
  datasetId,
  datasetName,
  dashboardId,
  dashboardName,
}) => {
  const navigate = useNavigate();
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [expandedSql, setExpandedSql] = useState<Record<string, boolean>>({});
  const [expandedData, setExpandedData] = useState<Record<string, boolean>>({});
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const [navigatingMsgId, setNavigatingMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Active scope key to isolate between dashboards and datasets
  const currentScopeKey = dashboardId
    ? `dashboard:${dashboardId}`
    : datasetId
    ? `dataset:${datasetId}`
    : "global";

  // Active scope reference and session token to prevent race conditions & stale updates
  const activeScopeRef = useRef<string>(currentScopeKey);
  const sessionTokenRef = useRef<number>(0);

  // Detect dataset or dashboard changes immediately and reset entire AI Analyst session
  useEffect(() => {
    if (activeScopeRef.current !== currentScopeKey) {
      activeScopeRef.current = currentScopeKey;
      sessionTokenRef.current += 1;

      // Clear all visible messages, answers, SQL queries, table data, and chart state
      setConversationId(undefined);
      setMessages([]);
      setExpandedSql({});
      setExpandedData({});
      setInputPrompt("");
      setCopiedSql(null);

      // Cancel running mutation
      chatMutation.reset();
    }
  }, [currentScopeKey]);

  const handleNewChat = () => {
    sessionTokenRef.current += 1;
    chatMutation.reset();
    setConversationId(undefined);
    setMessages([]);
    setExpandedSql({});
    setExpandedData({});
    setInputPrompt("");
    setCopiedSql(null);
  };

  // Fetch AI configuration status
  const { data: statusData } = useQuery<AIStatus>({
    queryKey: ["aiStatus"],
    queryFn: api.getAIStatus,
    enabled: isOpen,
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // Chat mutation with race-condition & stale-response protection
  const chatMutation = useMutation({
    mutationFn: async (variables: {
      prompt: string;
      token: number;
      targetDatasetId?: string;
      targetDashboardId?: string;
      targetScope: string;
    }) => {
      const resp = await api.askAI({
        prompt: variables.prompt,
        conversation_id: conversationId,
        dataset_id: variables.targetDatasetId,
        dashboard_id: variables.targetDashboardId,
      });
      return {
        response: resp,
        token: variables.token,
        targetScope: variables.targetScope,
      };
    },
    onSuccess: ({ response, token, targetScope }) => {
      // Discard response if scope changed or session reset while waiting
      if (token !== sessionTokenRef.current || targetScope !== activeScopeRef.current) {
        return;
      }

      if (response.conversation_id) {
        setConversationId(response.conversation_id);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: response.message_id || String(Date.now()),
          role: "assistant",
          content: response.answer,
          data: response,
          timestamp: new Date(),
        },
      ]);
      // Auto-expand SQL for visibility
      setExpandedSql((prev) => ({ ...prev, [response.message_id]: true }));
    },
    onError: (err: any, variables) => {
      // Discard error if scope changed or session reset while waiting
      if (variables.token !== sessionTokenRef.current || variables.targetScope !== activeScopeRef.current) {
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          role: "assistant",
          content: `Unable to complete query: ${err.message || "An unexpected error occurred."}`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  const handleSend = (text?: string) => {
    const q = (text || inputPrompt).trim();
    if (!q || chatMutation.isPending) return;

    // Add user message
    const userMsg: MessageItem = {
      id: String(Date.now()),
      role: "user",
      content: q,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt("");

    const currentToken = sessionTokenRef.current;
    const currentScope = activeScopeRef.current;
    chatMutation.mutate({
      prompt: q,
      token: currentToken,
      targetDatasetId: datasetId,
      targetDashboardId: dashboardId,
      targetScope: currentScope,
    });
  };

  const handleCopySql = (sql: string, id: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedSql(id);
    setTimeout(() => setCopiedSql(null), 2000);
  };

  const handleExploreAsChart = async (m: MessageItem) => {
    if (!m.data || !m.data.rows || m.data.rows.length === 0) {
      alert("Structured query results are required to generate an Explore as Chart workspace.");
      return;
    }

    if (navigatingMsgId) return;
    setNavigatingMsgId(m.id);

    try {
      // Find corresponding user question
      const userMsgIndex = messages.findIndex((msg) => msg.id === m.id);
      let userQuestion = "";
      for (let i = userMsgIndex - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userQuestion = messages[i].content;
          break;
        }
      }
      if (!userQuestion) userQuestion = "AI Query Analysis";

      let resultId = m.data.result_id;
      let snapshotObj: any = null;

      if (resultId) {
        snapshotObj = {
          id: resultId,
          source_type: "ai_query_result",
          message_id: m.data.message_id,
          dataset_id: datasetId,
          dataset_name: datasetName,
          question: userQuestion,
          sql: m.data.sql || "",
          columns: m.data.columns || [],
          column_types: m.data.column_types || [],
          rows: m.data.rows || [],
          row_count: m.data.row_count || m.data.rows.length,
          duration_ms: m.data.duration_ms || 0,
          recommended_chart: m.data.recommended_chart || {},
        };
      } else {
        // Create server snapshot if not already persisted
        const created = await api.createAISnapshot({
          message_id: m.data.message_id,
          dataset_id: datasetId,
          dataset_name: datasetName,
          question: userQuestion,
          sql: m.data.sql || "",
          columns: m.data.columns || [],
          column_types: m.data.column_types || [],
          rows: m.data.rows || [],
          row_count: m.data.row_count || m.data.rows.length,
          duration_ms: m.data.duration_ms || 0,
          recommended_chart: m.data.recommended_chart || {},
        });
        resultId = created.id;
        snapshotObj = created;
      }

      // Cache snapshot in sessionStorage for instantaneous zero-latency workspace initialization
      if (snapshotObj && resultId) {
        try {
          sessionStorage.setItem("active_ai_snapshot", JSON.stringify(snapshotObj));
        } catch {
          // ignore quota issues
        }
      }

      onClose();
      navigate(`/charts?ai_result_id=${resultId}`);
    } catch (err: any) {
      alert(`Could not open Explore as Chart: ${err?.message || "Unknown error"}`);
    } finally {
      setNavigatingMsgId(null);
    }
  };

  if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-50 overflow-hidden">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />

        <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
          <div className="w-screen max-w-2xl bg-white shadow-2xl flex flex-col border-l border-slate-200">
            {/* Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-base font-bold text-slate-900">
                      Grounded AI Analyst
                    </h2>
                    <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      Zero Hallucination
                    </span>
                  </div>
                  {dashboardName ? (
                    <p className="text-xs text-blue-700 font-medium">
                      Focused Dashboard: <span className="underline font-semibold">{dashboardName}</span>
                    </p>
                  ) : datasetName ? (
                    <p className="text-xs text-blue-700 font-medium">
                      Focused Dataset: <span className="underline font-semibold">{datasetName}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {statusData?.provider
                        ? `Provider: ${statusData.provider} (${statusData.model || "standard"})`
                        : "Answers questions strictly by executing safe SQL queries"}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition"
                  title="Start a new chat"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* AI Disabled Alert Banner if AI_ENABLED=false */}
            {statusData && !statusData.enabled && (
              <div className="mx-6 mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <p className="font-semibold mb-1">AI Assistant is currently offline</p>
                  <p>
                    Set <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">AI_ENABLED=true</code> in your backend environment to activate AI queries.
                  </p>
                </div>
              </div>
            )}

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                  <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                    <Sparkles className="w-7 h-7" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800 mb-1">
                    {dashboardName
                      ? "Ask questions about this dashboard's charts and data in plain English"
                      : "Ask questions about your data in plain English"}
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mb-6 leading-relaxed">
                    Every answer writes and executes real SQL against your data. Numbers are strictly verified against executed query rows with zero extrapolation.
                  </p>

                  {/* Sample Prompts */}
                  <div className="w-full max-w-md space-y-2 text-left">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 ml-1">
                      Try asking:
                    </p>
                    {SAMPLE_QUESTIONS.map((q, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSend(q)}
                        className="w-full text-left p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 text-xs font-medium text-slate-700 hover:text-blue-700 transition flex items-center justify-between group"
                      >
                        <span>{q}</span>
                        <Sparkles className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"
                      }`}
                  >
                    {m.role === "user" ? (
                      <div className="max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-xs leading-relaxed shadow-sm">
                        {m.content}
                      </div>
                    ) : (
                      <div className="w-full bg-slate-50/80 border border-slate-200/80 rounded-2xl rounded-tl-sm p-4 space-y-4 shadow-sm">
                        {/* Grounding & Steps Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/60">
                          <div className="flex items-center space-x-2">
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100/70 text-emerald-800 border border-emerald-300/60">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                              <span>
                                {m.data?.grounding?.is_grounded
                                  ? "Verified Grounded in Data"
                                  : "Query Results Attached"}
                              </span>
                            </span>

                            {m.data?.latency_ms ? (
                              <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                                <Clock className="w-3 h-3" />
                                {m.data.latency_ms}ms
                              </span>
                            ) : null}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handleExploreAsChart(m)}
                              disabled={navigatingMsgId === m.id || !m.data?.rows || m.data.rows.length === 0}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition flex items-center gap-1 shadow-2xs ${
                                !m.data?.rows || m.data.rows.length === 0
                                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                  : "bg-white border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                              }`}
                              title={
                                !m.data?.rows || m.data.rows.length === 0
                                  ? "No structured query results available to chart"
                                  : "Open exact query results in Analytics Workspace"
                              }
                            >
                              <BarChart3 className="w-3 h-3 text-blue-600" />
                              {navigatingMsgId === m.id ? "Opening..." : "Explore as Chart"}
                            </button>
                            <button
                              onClick={() => {
                                onClose();
                                navigate("/sqllab");
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-[11px] font-medium hover:bg-slate-100 transition flex items-center gap-1 shadow-2xs"
                            >
                              <Terminal className="w-3 h-3 text-slate-600" />
                              SQL Lab
                            </button>
                          </div>
                        </div>

                        {/* Natural Language Answer */}
                        <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-line font-normal">
                          {m.content}
                        </div>

                        {/* Collapsible Executed SQL */}
                        {m.data?.sql && (
                          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                            <button
                              onClick={() =>
                                setExpandedSql((prev) => ({
                                  ...prev,
                                  [m.id]: !prev[m.id],
                                }))
                              }
                              className="w-full px-3 py-2 bg-slate-100/60 hover:bg-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-700 transition"
                            >
                              <div className="flex items-center space-x-1.5 font-mono">
                                <Code className="w-3.5 h-3.5 text-blue-600" />
                                <span>Executed SQL Query</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                {expandedSql[m.id] ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                )}
                              </div>
                            </button>

                            {expandedSql[m.id] && (
                              <div className="p-3 bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto relative">
                                <button
                                  onClick={() => handleCopySql(m.data!.sql!, m.id)}
                                  className="absolute top-2 right-2 p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                                  title="Copy SQL"
                                >
                                  {copiedSql === m.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <pre className="pr-10">{m.data.sql}</pre>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Collapsible Query Results Data Table */}
                        {m.data?.rows && m.data.rows.length > 0 && (
                          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                            <button
                              onClick={() =>
                                setExpandedData((prev) => ({
                                  ...prev,
                                  [m.id]: !prev[m.id],
                                }))
                              }
                              className="w-full px-3 py-2 bg-slate-100/60 hover:bg-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-700 transition"
                            >
                              <div className="flex items-center space-x-1.5 font-mono">
                                <TableIcon className="w-3.5 h-3.5 text-indigo-600" />
                                <span>
                                  Query Data ({m.data.row_count} rows, {m.data.duration_ms}ms)
                                </span>
                              </div>
                              {expandedData[m.id] ? (
                                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                              )}
                            </button>

                            {expandedData[m.id] && (
                              <div className="overflow-x-auto max-h-56">
                                <table className="w-full text-[11px] border-collapse">
                                  <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-left">
                                      {m.data.columns.map((col, idx) => (
                                        <th
                                          key={idx}
                                          className="py-1.5 px-3 font-semibold uppercase tracking-wider text-[10px]"
                                        >
                                          {col}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {m.data.rows.slice(0, 10).map((row, rIdx) => (
                                      <tr
                                        key={rIdx}
                                        className="border-b border-slate-100 hover:bg-slate-50/50"
                                      >
                                        {row.map((val: any, cIdx: number) => (
                                          <td
                                            key={cIdx}
                                            className="py-1.5 px-3 text-slate-700 whitespace-nowrap"
                                          >
                                            {typeof val === "number"
                                              ? val.toLocaleString()
                                              : String(val ?? "-")}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {m.data.rows.length > 10 && (
                                  <div className="p-2 text-center text-[10px] text-slate-400 bg-slate-50">
                                    Showing first 10 of {m.data.row_count} rows
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Pending state */}
              {chatMutation.isPending && (
                <div className="flex items-start space-x-3 bg-blue-50/60 border border-blue-100 p-4 rounded-2xl rounded-tl-sm animate-pulse">
                  <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-blue-900">
                      Inspecting schema, executing SQL & verifying numbers...
                    </p>
                    <p className="text-[11px] text-blue-700/80">
                      Strict grounding guardrail active. Querying database engine.
                    </p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Footer Input */}
            <div className="p-4 bg-white border-t border-slate-200">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center space-x-2"
              >
                <input
                  type="text"
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  placeholder="Ask about revenue, profits, customers, products..."
                  disabled={chatMutation.isPending}
                  className="flex-1 px-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
                <button
                  type="submit"
                  disabled={!inputPrompt.trim() || chatMutation.isPending}
                  className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center space-x-1.5 shadow-sm shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <span>Ask</span>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  };
