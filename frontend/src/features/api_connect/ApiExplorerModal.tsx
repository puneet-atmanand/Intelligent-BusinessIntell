import { useState, useEffect } from "react";
import {
  Send,
  X,
  Loader2,
  Table as TableIcon,
  Code2,
  Binary,
  Plus,
  Trash2,
  Sparkles,
  Save,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";
import { api, ApiConnection, ApiExploreResponse, OpenApiEndpoint } from "@/app/api";

interface ApiExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  connections: ApiConnection[];
  initialEndpoint?: {
    endpoint?: Partial<OpenApiEndpoint>;
    baseUrl?: string;
    connectionId?: string;
  } | null;
  onSaveAsTable: (state: {
    connectionId?: string;
    path: string;
    method: string;
    headers: Record<string, string>;
    queryParams: Record<string, any>;
    body?: string;
    responsePath?: string;
    detectedSchema: Record<string, string>;
    previewRecords: Record<string, any>[];
  }) => void;
}

export function ApiExplorerModal({
  isOpen,
  onClose,
  connections,
  initialEndpoint,
  onSaveAsTable,
}: ApiExplorerModalProps) {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [method, setMethod] = useState<string>("GET");
  const [pathOrUrl, setPathOrUrl] = useState<string>("");

  // Request subtabs: 'params' | 'headers' | 'body' | 'envelope'
  const [requestTab, setRequestTab] = useState<"params" | "headers" | "body" | "envelope">("params");
  const [queryRows, setQueryRows] = useState<Array<{ key: string; value: string }>>([]);
  const [headerRows, setHeaderRows] = useState<Array<{ key: string; value: string }>>([]);
  const [requestBody, setRequestBody] = useState<string>("");
  const [responsePath, setResponsePath] = useState<string>("");

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [exploreResult, setExploreResult] = useState<ApiExploreResponse | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Response inspector subtabs: 'table' | 'schema' | 'raw'
  const [responseTab, setResponseTab] = useState<"table" | "schema" | "raw">("table");

  useEffect(() => {
    if (initialEndpoint) {
      if (initialEndpoint.endpoint?.method) {
        setMethod(initialEndpoint.endpoint.method.toUpperCase());
      }
      if (initialEndpoint.endpoint?.path !== undefined) {
        setPathOrUrl(initialEndpoint.endpoint.path);
      }
      if (initialEndpoint.endpoint?.query_params) {
        setQueryRows(
          Object.entries(initialEndpoint.endpoint.query_params).map(([k, v]) => ({
            key: k,
            value: String(v ?? ""),
          }))
        );
      }
      if (initialEndpoint.endpoint?.headers) {
        setHeaderRows(
          Object.entries(initialEndpoint.endpoint.headers).map(([k, v]) => ({
            key: k,
            value: String(v ?? ""),
          }))
        );
      }
      if (initialEndpoint.connectionId) {
        setSelectedConnectionId(initialEndpoint.connectionId);
      } else if (initialEndpoint.baseUrl) {
        const match = connections.find(
          (c) => c.base_url.toLowerCase() === initialEndpoint.baseUrl?.toLowerCase()
        );
        if (match) {
          setSelectedConnectionId(match.id);
        }
      }
    }
  }, [initialEndpoint, connections]);

  if (!isOpen) return null;

  const buildHeaders = (): Record<string, string> => {
    const res: Record<string, string> = {};
    for (const r of headerRows) {
      if (r.key.trim()) res[r.key.trim()] = r.value;
    }
    return res;
  };

  const buildQueryParams = (): Record<string, any> => {
    const res: Record<string, any> = {};
    for (const r of queryRows) {
      if (r.key.trim()) res[r.key.trim()] = r.value;
    }
    return res;
  };

  const handleSend = async () => {
    if (!pathOrUrl.trim()) {
      setExecutionError("Path or URL is required.");
      return;
    }

    try {
      setExecuting(true);
      setExecutionError(null);
      const headers = buildHeaders();
      const query_params = buildQueryParams();

      const res = await api.exploreApiEndpoint({
        connection_id: selectedConnectionId || undefined,
        path_or_url: pathOrUrl.trim(),
        method,
        headers,
        query_params,
        body: method !== "GET" && requestBody.trim() ? requestBody.trim() : undefined,
        response_path: responsePath.trim() || undefined,
        sample_limit: 50,
      });

      setExploreResult(res);
      if (!res.success && res.error_message) {
        setExecutionError(res.error_message);
      }
    } catch (err: any) {
      setExecutionError(err?.message || "Execution failed.");
    } finally {
      setExecuting(false);
    }
  };

  const handleFormatJson = () => {
    try {
      if (!requestBody.trim()) return;
      const parsed = JSON.parse(requestBody);
      setRequestBody(JSON.stringify(parsed, null, 2));
    } catch {
      // invalid json, skip
    }
  };

  const handleSaveAsTableClick = () => {
    if (!exploreResult) return;
    onSaveAsTable({
      connectionId: selectedConnectionId || undefined,
      path: pathOrUrl.trim(),
      method,
      headers: buildHeaders(),
      queryParams: buildQueryParams(),
      body: method !== "GET" && requestBody.trim() ? requestBody.trim() : undefined,
      responsePath: responsePath.trim() || undefined,
      detectedSchema: exploreResult.detected_schema || {},
      previewRecords: exploreResult.preview_records || [],
    });
    onClose();
  };

  const previewRecords = exploreResult?.preview_records || [];
  const detectedSchema = exploreResult?.detected_schema || {};
  const schemaEntries = Object.entries(detectedSchema);
  const columnKeys = previewRecords.length > 0 ? Object.keys(previewRecords[0]) : schemaEntries.map(([k]) => k);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl rounded-2xl bg-card border border-border/80 shadow-2xl p-6 overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border/60 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground">API Sandbox & Explorer</h3>
              <p className="text-xs text-muted-foreground">
                Construct HTTP requests, sandbox payloads, inspect flattened tabular schemas, and normalize into DuckDB
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

        {/* Request URL Bar */}
        <div className="py-3 flex flex-wrap sm:flex-nowrap items-center gap-2 border-b border-border/60 flex-shrink-0">
          <select
            value={selectedConnectionId}
            onChange={(e) => setSelectedConnectionId(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg bg-background border border-border/80 font-medium text-foreground outline-none max-w-[200px]"
          >
            <option value="">(Standalone URL)</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="px-3 py-2 text-xs font-bold rounded-lg bg-background border border-border/80 text-foreground outline-none uppercase"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>

          <input
            type="text"
            value={pathOrUrl}
            onChange={(e) => setPathOrUrl(e.target.value)}
            placeholder={
              selectedConnectionId
                ? "/users/octocat/repos or /v1/products"
                : "https://api.github.com/users/octocat/repos"
            }
            className="flex-1 px-3 py-2 text-xs font-mono rounded-lg bg-background border border-border/80 focus:border-primary outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={executing || !pathOrUrl.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow transition disabled:opacity-50"
          >
            {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send
          </button>
        </div>

        {/* Two-Pane Body: Request Config & Response Inspector */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-4 py-3 min-h-[380px]">
          {/* Left Pane: Request Config */}
          <div className="flex flex-col border border-border/80 rounded-xl overflow-hidden bg-background">
            <div className="flex items-center border-b border-border/60 bg-muted/30 px-3">
              {(
                [
                  { id: "params", label: `Query Params (${queryRows.length})` },
                  { id: "headers", label: `Headers (${headerRows.length})` },
                  { id: "body", label: "Request Body" },
                  { id: "envelope", label: "Envelope Path" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setRequestTab(tab.id)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 transition ${
                    requestTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 p-3 overflow-y-auto">
              {requestTab === "params" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">URL Query Parameters</span>
                    <button
                      type="button"
                      onClick={() => setQueryRows([...queryRows, { key: "", value: "" }])}
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                    >
                      <Plus className="h-3 w-3" /> Add Param
                    </button>
                  </div>
                  {queryRows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={r.key}
                        onChange={(e) => {
                          const next = [...queryRows];
                          next[i].key = e.target.value;
                          setQueryRows(next);
                        }}
                        placeholder="Key"
                        className="flex-1 px-2.5 py-1 text-xs rounded bg-muted/40 border border-border outline-none font-mono"
                      />
                      <input
                        type="text"
                        value={r.value}
                        onChange={(e) => {
                          const next = [...queryRows];
                          next[i].value = e.target.value;
                          setQueryRows(next);
                        }}
                        placeholder="Value"
                        className="flex-1 px-2.5 py-1 text-xs rounded bg-muted/40 border border-border outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setQueryRows(queryRows.filter((_, idx) => idx !== i))}
                        className="p-1 text-muted-foreground hover:text-destructive rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {queryRows.length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic py-4 text-center">
                      No query parameters configured.
                    </p>
                  )}
                </div>
              )}

              {requestTab === "headers" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">Custom Request Headers</span>
                    <button
                      type="button"
                      onClick={() => setHeaderRows([...headerRows, { key: "", value: "" }])}
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                    >
                      <Plus className="h-3 w-3" /> Add Header
                    </button>
                  </div>
                  {headerRows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={r.key}
                        onChange={(e) => {
                          const next = [...headerRows];
                          next[i].key = e.target.value;
                          setHeaderRows(next);
                        }}
                        placeholder="Header"
                        className="flex-1 px-2.5 py-1 text-xs rounded bg-muted/40 border border-border outline-none font-mono"
                      />
                      <input
                        type="text"
                        value={r.value}
                        onChange={(e) => {
                          const next = [...headerRows];
                          next[i].value = e.target.value;
                          setHeaderRows(next);
                        }}
                        placeholder="Value"
                        className="flex-1 px-2.5 py-1 text-xs rounded bg-muted/40 border border-border outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setHeaderRows(headerRows.filter((_, idx) => idx !== i))}
                        className="p-1 text-muted-foreground hover:text-destructive rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {headerRows.length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic py-4 text-center">
                      No custom headers. Upstream default headers apply automatically.
                    </p>
                  )}
                </div>
              )}

              {requestTab === "body" && (
                <div className="h-full flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">JSON Body Payload</span>
                    <button
                      type="button"
                      onClick={handleFormatJson}
                      className="text-[11px] text-primary hover:underline font-medium"
                    >
                      Format JSON
                    </button>
                  </div>
                  <textarea
                    rows={10}
                    value={requestBody}
                    onChange={(e) => setRequestBody(e.target.value)}
                    placeholder='{ "title": "New Item", "status": "active" }'
                    className="flex-1 w-full p-2.5 text-xs font-mono rounded bg-muted/20 border border-border focus:border-primary outline-none resize-none"
                  />
                </div>
              )}

              {requestTab === "envelope" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      JSONPath / Dotted Path Selector
                    </label>
                    <input
                      type="text"
                      value={responsePath}
                      onChange={(e) => setResponsePath(e.target.value)}
                      placeholder="e.g. data.items, results, records"
                      className="w-full px-3 py-1.5 text-xs font-mono rounded bg-muted/40 border border-border outline-none"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Specifies where the list of records resides within the upstream response envelope. If left empty,
                      the system auto-discovers arrays under common keys (<code className="text-primary font-mono">data</code>, <code className="text-primary font-mono">items</code>, <code className="text-primary font-mono">results</code>).
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Pane: Live Response Inspector */}
          <div className="flex flex-col border border-border/80 rounded-xl overflow-hidden bg-background">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 flex-shrink-0">
              <div className="flex items-center">
                {(
                  [
                    { id: "table", label: "Table Preview", icon: TableIcon },
                    { id: "schema", label: "Schema Inspector", icon: Binary },
                    { id: "raw", label: "Raw JSON", icon: Code2 },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setResponseTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition ${
                        responseTab === tab.id
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Telemetry badges */}
              {exploreResult && (
                <div className="flex items-center gap-1.5 py-1">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                      exploreResult.success
                        ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                        : "bg-destructive/10 text-destructive border border-destructive/20"
                    }`}
                  >
                    {exploreResult.status_code || "ERR"}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-muted text-muted-foreground">
                    {exploreResult.duration_ms || 0}ms
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground">
                    {previewRecords.length} rows
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 p-3 overflow-y-auto">
              {executionError && (
                <div className="p-3 mb-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{executionError}</span>
                </div>
              )}

              {!exploreResult && !executing && (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                  <FileText className="h-8 w-8 stroke-[1.5] mb-2 text-muted-foreground/60" />
                  <p className="text-xs font-medium">No request executed yet.</p>
                  <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                    Click "Send" above to execute the request and inspect the inferred schema.
                  </p>
                </div>
              )}

              {executing && (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                  <Loader2 className="h-7 w-7 animate-spin text-primary mb-2" />
                  <p className="text-xs font-medium">Fetching & normalizing payload...</p>
                </div>
              )}

              {exploreResult && !executing && (
                <>
                  {responseTab === "table" && (
                    <div className="border border-border/70 rounded-lg overflow-x-auto max-h-[300px]">
                      {previewRecords.length > 0 ? (
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-muted/70 text-muted-foreground font-mono text-[11px] sticky top-0 border-b border-border">
                            <tr>
                              {columnKeys.map((k) => (
                                <th key={k} className="py-1.5 px-2.5 whitespace-nowrap">
                                  {k}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60 font-mono text-[11px]">
                            {previewRecords.map((row: Record<string, any>, idx: number) => (
                              <tr key={idx} className="hover:bg-muted/40 transition">
                                {columnKeys.map((k) => {
                                  const val = row[k];
                                  return (
                                    <td key={k} className="py-1.5 px-2.5 whitespace-nowrap max-w-xs truncate">
                                      {val === null || val === undefined ? (
                                        <span className="text-muted-foreground/50 italic font-sans text-[10px]">
                                          null
                                        </span>
                                      ) : typeof val === "boolean" ? (
                                        <span
                                          className={`px-1.5 py-0.2 rounded text-[10px] ${
                                            val ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                                          }`}
                                        >
                                          {String(val)}
                                        </span>
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
                      ) : (
                        <p className="p-4 text-xs text-muted-foreground text-center italic">
                          No tabular records detected from the response. Try adjusting the Envelope Path.
                        </p>
                      )}
                    </div>
                  )}

                  {responseTab === "schema" && (
                    <div className="border border-border/70 rounded-lg overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-muted/70 text-muted-foreground font-medium text-[11px] border-b border-border">
                          <tr>
                            <th className="py-2 px-3">SQL Column</th>
                            <th className="py-2 px-3">Inferred Type</th>
                            <th className="py-2 px-3">Sample Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {schemaEntries.map(([col, typ]) => {
                            const sample = previewRecords[0]?.[col];
                            return (
                              <tr key={col} className="hover:bg-muted/30">
                                <td className="py-1.5 px-3 font-mono text-foreground font-medium">{col}</td>
                                <td className="py-1.5 px-3">
                                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-primary/10 text-primary border border-primary/20">
                                    {typ}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 text-muted-foreground font-mono text-[11px] truncate max-w-xs">
                                  {sample !== undefined && sample !== null ? String(sample) : "null"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {responseTab === "raw" && (
                    <pre className="p-3 rounded-lg bg-muted/20 border border-border text-xs font-mono overflow-auto max-h-[300px] text-foreground">
                      {JSON.stringify(exploreResult.raw_json, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-border/60 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            {exploreResult?.success ? (
              <span className="flex items-center gap-1.5 text-emerald-500 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Ready for DuckDB materialization
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSaveAsTableClick}
              disabled={!exploreResult?.success || previewRecords.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow transition disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              Save as Dataset Table...
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
