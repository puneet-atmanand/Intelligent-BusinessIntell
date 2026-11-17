import { useState, useEffect } from "react";
import { History, X, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { api, ApiSyncRun, ApiDatasetTable } from "@/app/api";

interface SyncHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: ApiDatasetTable | null;
}

export function SyncHistoryModal({ isOpen, onClose, table }: SyncHistoryModalProps) {
  const [runs, setRuns] = useState<ApiSyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);

  useEffect(() => {
    if (table && isOpen) {
      loadRuns();
    } else {
      setRuns([]);
      setSelectedError(null);
    }
  }, [table, isOpen]);

  const loadRuns = async () => {
    if (!table) return;
    try {
      setLoading(true);
      const res = await api.getApiTableSyncRuns(table.id);
      setRuns(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !table) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-card border border-border/80 shadow-2xl p-6 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border/60 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground">Sync History & Audit Runs</h3>
              <p className="text-xs text-muted-foreground">
                Execution telemetry for <span className="font-medium text-foreground">{table.display_name}</span> ({table.table_name})
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
          {loading && runs.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-primary mb-2" />
              <p className="text-xs">Loading execution audit history...</p>
            </div>
          ) : runs.length > 0 ? (
            <div className="border border-border/80 rounded-xl overflow-hidden bg-background">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-muted/60 text-muted-foreground font-medium border-b border-border">
                  <tr>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Started</th>
                    <th className="py-2.5 px-3">Fetched</th>
                    <th className="py-2.5 px-3">Written</th>
                    <th className="py-2.5 px-3">Duration</th>
                    <th className="py-2.5 px-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {runs.map((r) => {
                    const isSuccess = r.status.toUpperCase() === "SUCCESS";
                    const isFailed = r.status.toUpperCase() === "FAILED";
                    return (
                      <tr key={r.id} className="hover:bg-muted/30 transition">
                        <td className="py-2 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                              isSuccess
                                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                : isFailed
                                ? "bg-destructive/10 text-destructive border-destructive/20"
                                : "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse"
                            }`}
                          >
                            {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : isFailed ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground font-mono text-[11px]">
                          {new Date(r.started_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 font-mono text-muted-foreground">
                          {r.records_fetched?.toLocaleString() ?? 0}
                        </td>
                        <td className="py-2 px-3 font-mono text-foreground font-medium">
                          {r.records_written?.toLocaleString() ?? 0}
                        </td>
                        <td className="py-2 px-3 font-mono text-muted-foreground">
                          {r.execution_duration_ms}ms
                        </td>
                        <td className="py-2 px-3 text-right">
                          {r.error_message ? (
                            <button
                              type="button"
                              onClick={() => setSelectedError(r.error_message || null)}
                              className="text-[11px] text-destructive hover:underline font-medium"
                            >
                              View Error
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/60">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground italic">
              No historical sync runs found for this table.
            </p>
          )}

          {selectedError && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive space-y-1">
              <div className="flex items-center justify-between font-semibold">
                <span>Error Diagnostic Log:</span>
                <button
                  type="button"
                  onClick={() => setSelectedError(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">{selectedError}</pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-border/60 flex items-center justify-end flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
