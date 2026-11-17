import { useState, useEffect, FormEvent } from "react";
import { Globe, X, Loader2, CheckCircle2, AlertCircle, ShieldAlert, Key, Plus, Trash2 } from "lucide-react";
import { api, ApiConnection } from "@/app/api";

interface ApiConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connectionToEdit?: ApiConnection | null;
}

export function ApiConnectionModal({
  isOpen,
  onClose,
  onSuccess,
  connectionToEdit,
}: ApiConnectionModalProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [description, setDescription] = useState("");
  const [authType, setAuthType] = useState<"none" | "api_key" | "bearer" | "basic" | "oauth2">("none");
  const [secret, setSecret] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);
  const [maxRetries, setMaxRetries] = useState(3);
  const [verifySsl, setVerifySsl] = useState(true);

  // Auth config fields
  const [apiKeyName, setApiKeyName] = useState("X-API-Key");
  const [apiKeyIn, setApiKeyIn] = useState<"header" | "query">("header");
  const [basicUsername, setBasicUsername] = useState("");
  const [oauthTokenUrl, setOauthTokenUrl] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthScope, setOauthScope] = useState("");

  // Default headers
  const [headerRows, setHeaderRows] = useState<Array<{ key: string; value: string }>>([]);

  // Testing & Saving state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    statusCode?: number;
    durationMs?: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connectionToEdit) {
      setName(connectionToEdit.name);
      setBaseUrl(connectionToEdit.base_url);
      setDescription(connectionToEdit.description || "");
      setAuthType(connectionToEdit.auth_type as any);
      setTimeoutSeconds(connectionToEdit.timeout_seconds);
      setMaxRetries(connectionToEdit.max_retries);
      setVerifySsl(connectionToEdit.verify_ssl);
      setSecret("");

      const ac = connectionToEdit.auth_config || {};
      if (connectionToEdit.auth_type === "api_key") {
        setApiKeyName(ac.key_name || "X-API-Key");
        setApiKeyIn(ac.in || "header");
      } else if (connectionToEdit.auth_type === "basic") {
        setBasicUsername(ac.username || "");
      } else if (connectionToEdit.auth_type === "oauth2") {
        setOauthTokenUrl(ac.token_url || "");
        setOauthClientId(ac.client_id || "");
        setOauthScope(ac.scope || "");
      }

      if (connectionToEdit.default_headers) {
        setHeaderRows(
          Object.entries(connectionToEdit.default_headers).map(([k, v]) => ({ key: k, value: v }))
        );
      } else {
        setHeaderRows([]);
      }
    } else {
      setName("");
      setBaseUrl("");
      setDescription("");
      setAuthType("none");
      setSecret("");
      setTimeoutSeconds(30);
      setMaxRetries(3);
      setVerifySsl(true);
      setApiKeyName("X-API-Key");
      setApiKeyIn("header");
      setBasicUsername("");
      setOauthTokenUrl("");
      setOauthClientId("");
      setOauthScope("");
      setHeaderRows([]);
    }
    setTestResult(null);
    setError(null);
  }, [connectionToEdit, isOpen]);

  if (!isOpen) return null;

  const buildAuthConfig = (): Record<string, any> => {
    if (authType === "api_key") {
      return { key_name: apiKeyName, in: apiKeyIn };
    }
    if (authType === "basic") {
      return { username: basicUsername };
    }
    if (authType === "oauth2") {
      return {
        token_url: oauthTokenUrl,
        client_id: oauthClientId,
        scope: oauthScope,
      };
    }
    return {};
  };

  const buildDefaultHeaders = (): Record<string, string> => {
    const res: Record<string, string> = {};
    for (const r of headerRows) {
      if (r.key.trim()) {
        res[r.key.trim()] = r.value;
      }
    }
    return res;
  };

  const handleTestConnection = async () => {
    if (!baseUrl.trim()) {
      setError("Base URL is required to test connection.");
      return;
    }
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);

      const headers = buildDefaultHeaders();
      const auth_config = buildAuthConfig();

      const res = await api.testAdhocApiConnection({
        base_url: baseUrl.trim(),
        auth_type: authType,
        auth_config,
        secret: secret.trim() || undefined,
        headers,
        verify_ssl: verifySsl,
      });

      setTestResult({
        success: res.success,
        message: res.message,
        statusCode: res.status_code,
        durationMs: res.duration_ms,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || "Failed to reach target host.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) {
      setError("Connection name and Base URL are required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const auth_config = buildAuthConfig();
      const default_headers = buildDefaultHeaders();

      if (connectionToEdit) {
        await api.updateApiConnection(connectionToEdit.id, {
          name: name.trim(),
          base_url: baseUrl.trim(),
          description: description.trim() || undefined,
          auth_type: authType,
          auth_config,
          secret: secret.trim() || undefined,
          default_headers,
          timeout_seconds: Number(timeoutSeconds),
          max_retries: Number(maxRetries),
          verify_ssl: verifySsl,
        });
      } else {
        await api.createApiConnection({
          name: name.trim(),
          base_url: baseUrl.trim(),
          description: description.trim() || undefined,
          auth_type: authType,
          auth_config,
          secret: secret.trim() || undefined,
          default_headers,
          timeout_seconds: Number(timeoutSeconds),
          max_retries: Number(maxRetries),
          verify_ssl: verifySsl,
        });
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save connection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-card border border-border/80 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border/60 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground">
                {connectionToEdit ? "Edit API Connection" : "Connect New REST API"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Configure upstream REST service endpoints with secure authentication and SSL verification
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

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
          {error && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Core Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Connection Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GitHub API, Stripe Billing"
                className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border/80 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Base URL <span className="text-destructive">*</span>
              </label>
              <input
                type="url"
                required
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border/80 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Internal notes or upstream service documentation link"
              className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border/80 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition"
            />
          </div>

          {/* Authentication Schemes */}
          <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-4">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Authentication Scheme
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(
                [
                  { id: "none", label: "None" },
                  { id: "api_key", label: "API Key" },
                  { id: "bearer", label: "Bearer Token" },
                  { id: "basic", label: "Basic Auth" },
                  { id: "oauth2", label: "OAuth 2.0" },
                ] as const
              ).map((scheme) => (
                <button
                  key={scheme.id}
                  type="button"
                  onClick={() => setAuthType(scheme.id)}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border transition text-center ${
                    authType === scheme.id
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-background text-muted-foreground border-border/80 hover:bg-muted/80"
                  }`}
                >
                  {scheme.label}
                </button>
              ))}
            </div>

            {/* Scheme specific parameters */}
            {authType === "api_key" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Header/Param Name</label>
                  <input
                    type="text"
                    value={apiKeyName}
                    onChange={(e) => setApiKeyName(e.target.value)}
                    placeholder="X-API-Key"
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Send In</label>
                  <select
                    value={apiKeyIn}
                    onChange={(e) => setApiKeyIn(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                  >
                    <option value="header">HTTP Header</option>
                    <option value="query">Query Parameter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">API Key Value</label>
                  <input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={connectionToEdit ? "Leave blank to keep existing" : "Secret value"}
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                  />
                </div>
              </div>
            )}

            {authType === "bearer" && (
              <div className="pt-2">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Bearer Token Secret
                </label>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={connectionToEdit ? "Leave blank to keep existing token" : "eyJhbGciOi..."}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none font-mono"
                />
              </div>
            )}

            {authType === "basic" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Username</label>
                  <input
                    type="text"
                    value={basicUsername}
                    onChange={(e) => setBasicUsername(e.target.value)}
                    placeholder="api_user"
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Password</label>
                  <input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={connectionToEdit ? "Leave blank to keep existing" : "Secret password"}
                    className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                  />
                </div>
              </div>
            )}

            {authType === "oauth2" && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Token URL</label>
                    <input
                      type="url"
                      value={oauthTokenUrl}
                      onChange={(e) => setOauthTokenUrl(e.target.value)}
                      placeholder="https://oauth.example.com/oauth/token"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Client ID</label>
                    <input
                      type="text"
                      value={oauthClientId}
                      onChange={(e) => setOauthClientId(e.target.value)}
                      placeholder="client_123456"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Client Secret</label>
                    <input
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder={connectionToEdit ? "Leave blank to keep existing" : "Secret client token"}
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Scope (Optional)</label>
                    <input
                      type="text"
                      value={oauthScope}
                      onChange={(e) => setOauthScope(e.target.value)}
                      placeholder="read write"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Default Headers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-foreground">Default Headers (Optional)</label>
              <button
                type="button"
                onClick={() => setHeaderRows([...headerRows, { key: "", value: "" }])}
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <Plus className="h-3 w-3" /> Add Header
              </button>
            </div>
            {headerRows.length > 0 ? (
              <div className="space-y-2">
                {headerRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) => {
                        const next = [...headerRows];
                        next[idx].key = e.target.value;
                        setHeaderRows(next);
                      }}
                      placeholder="Header Key (e.g. Accept, User-Agent)"
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                    />
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => {
                        const next = [...headerRows];
                        next[idx].value = e.target.value;
                        setHeaderRows(next);
                      }}
                      placeholder="Header Value"
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setHeaderRows(headerRows.filter((_, i) => i !== idx))}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground italic">No default headers configured.</p>
            )}
          </div>

          {/* Network Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border/60">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Timeout (Seconds)
              </label>
              <input
                type="number"
                min={1}
                max={120}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Max Retries</label>
              <input
                type="number"
                min={0}
                max={5}
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
              />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="verifySsl"
                checked={verifySsl}
                onChange={(e) => setVerifySsl(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="verifySsl" className="text-xs text-foreground select-none cursor-pointer">
                Verify SSL Certificates
              </label>
            </div>
          </div>

          {/* Live Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border flex items-center justify-between text-xs animate-in fade-in duration-150 ${
                testResult.success
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
              {testResult.durationMs !== undefined && (
                <span className="font-mono text-[11px] opacity-80">{testResult.durationMs}ms</span>
              )}
            </div>
          )}
        </form>

        {/* Modal Footer with Actions */}
        <div className="pt-4 border-t border-border/60 flex items-center justify-between flex-shrink-0">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !baseUrl.trim()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border/80 hover:bg-muted text-foreground transition disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            Test Connection
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow transition disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {connectionToEdit ? "Update Connection" : "Save Connection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
