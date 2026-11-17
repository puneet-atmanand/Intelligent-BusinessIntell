import { useState, FormEvent } from "react";
import { FolderPlus, X, Loader2 } from "lucide-react";
import { api } from "@/app/api";

interface CreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (collectionId: string) => void;
}

export function CreateCollectionModal({ isOpen, onClose, onSuccess }: CreateCollectionModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Collection name is required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const created = await api.createApiCollection({
        name: name.trim(),
        description: description.trim() || undefined,
        tags,
      });

      setName("");
      setDescription("");
      setTagsInput("");
      onSuccess(created.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to create collection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl bg-card border border-border/80 shadow-2xl p-6 overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground">Create Dataset Collection</h3>
              <p className="text-xs text-muted-foreground">Group multiple API endpoints into a unified domain</p>
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
          <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Collection Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Store Analytics, Stripe Billing"
              className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border/80 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Description (Optional)</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the APIs grouped under this collection"
              className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border/80 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Tags (Comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. sales, inventory, rest, production"
              className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border/80 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition"
            />
          </div>

          <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-2">
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
              Create Collection
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
