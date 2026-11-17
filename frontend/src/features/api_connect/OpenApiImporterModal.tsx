import { useState, FormEvent } from "react";
import { FileCode2, X, Loader2, Link2, Sparkles, AlertCircle, ArrowRight } from "lucide-react";
import { api, OpenApiEndpoint, OpenApiImportResponse } from "@/app/api";

interface OpenApiImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEndpointForExplore: (endpoint: OpenApiEndpoint, baseUrl?: string) => void;
}

export function OpenApiImporterModal({
  isOpen,
  onClose,
  onSelectEndpointForExplore,
}: OpenApiImporterModalProps) {
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [specContent, setSpecContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedSpec, setImportedSpec] = useState<OpenApiImportResponse | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  if (!isOpen) return null;

  const handleImport = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "url" && !url.trim()) {
      setError("Please specify a valid OpenAPI/Swagger specification URL.");
      return;
    }
    if (mode === "paste" && !specContent.trim()) {
      setError("Please paste the OpenAPI YAML or JSON specification.");
      return;
    }

    try {
      setLoading(true);
      const res = await api.importOpenApiSpec({
        url: mode === "url" ? url.trim() : undefined,
        spec_content: mode === "paste" ? specContent.trim() : undefined,
      });
      setImportedSpec(res);
    } catch (err: any) {
      setError(err?.message || "Failed to parse specification.");
    } finally {
      setLoading(false);
    }
  };

  const filteredEndpoints = (importedSpec?.endpoints || []).filter((ep) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      ep.path.toLowerCase().includes(q) ||
      ep.method.toLowerCase().includes(q) ||
      ep.summary.toLowerCase().includes(q) ||
      ep.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const getMethodBadgeClass = (method: string) => {
    switch (method.toUpperCase()) {
      case "GET":
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "POST":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "PUT":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "PATCH":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "DELETE":
        return "bg-rose-500/10 text-rose-500 border-rose-500/20";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-2xl bg-card border border-border/80 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border/60 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <FileCode2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground">Import OpenAPI / Swagger Spec</h3>
              <p className="text-xs text-muted-foreground">
                Instantly discover, sandbox, and ingest API endpoints from upstream specifications
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

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!importedSpec ? (
            <form onSubmit={handleImport} className="space-y-4">
              <div className="flex items-center gap-2 border-b border-border/60 pb-3">
                <button
                  type="button"
                  onClick={() => setMode("url")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    mode === "url"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Remote URL
                </button>
                <button
                  type="button"
                  onClick={() => setMode("paste")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    mode === "paste"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Paste YAML / JSON
                </button>
              </div>

              {mode === "url" ? (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    OpenAPI Specification URL
                  </label>
                  <div className="relative">
                    <input
                      type="url"
                      required
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://petstore.swagger.io/v2/swagger.json"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-background border border-border/80 focus:border-primary outline-none"
                    />
                    <Link2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Supports public OpenAPI 3.0/3.1 and Swagger 2.0 URLs.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Raw Specification (YAML or JSON)
                  </label>
                  <textarea
                    rows={12}
                    required
                    value={specContent}
                    onChange={(e) => setSpecContent(e.target.value)}
                    placeholder="openapi: 3.0.0&#10;info:&#10;  title: Sample API&#10;paths: ..."
                    className="w-full p-3 text-xs font-mono rounded-lg bg-background border border-border/80 focus:border-primary outline-none resize-none"
                  />
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow transition disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Parse & Discover Endpoints
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {/* Parsed Meta Banner */}
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-sm text-foreground">{importedSpec.title}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-1">{importedSpec.description || "No description provided."}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-primary/10 text-primary border border-primary/20">
                    v{importedSpec.version}
                  </span>
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-muted text-muted-foreground">
                    {importedSpec.endpoints.length} Operations
                  </span>
                  <button
                    type="button"
                    onClick={() => setImportedSpec(null)}
                    className="text-xs text-primary hover:underline ml-2"
                  >
                    Load Another
                  </button>
                </div>
              </div>

              {/* Search filter */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter operations by path, summary, or HTTP method..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-background border border-border/80 outline-none"
                />
              </div>

              {/* Operations Table */}
              <div className="border border-border/80 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-muted/70 text-muted-foreground font-medium sticky top-0 z-10 border-b border-border/80">
                    <tr>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3">Path</th>
                      <th className="py-2.5 px-3">Summary / Description</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredEndpoints.map((ep, idx) => (
                      <tr key={idx} className="hover:bg-muted/40 transition">
                        <td className="py-2 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded border uppercase ${getMethodBadgeClass(
                              ep.method
                            )}`}
                          >
                            {ep.method}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-xs text-foreground font-medium">
                          {ep.path}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground max-w-xs truncate">
                          {ep.summary || ep.description || ep.operation_id || "—"}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectEndpointForExplore(ep, importedSpec.base_url);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition"
                          >
                            Explore <ArrowRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
