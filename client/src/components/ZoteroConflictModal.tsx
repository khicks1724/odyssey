import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  fetchZoteroConflicts,
  resolveZoteroConflict,
  type ZoteroConflict,
} from '../lib/zotero';

type ZoteroConflictModalProps = {
  onClose: () => void;
  onResolved: (sources: unknown[]) => void;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Empty';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export default function ZoteroConflictModal({ onClose, onResolved }: ZoteroConflictModalProps) {
  const [conflicts, setConflicts] = useState<ZoteroConflict[]>([]);
  const [choices, setChoices] = useState<Record<string, Record<string, 'local' | 'remote'>>>({});
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchZoteroConflicts()
      .then((result) => {
        if (!cancelled) setConflicts(result.conflicts);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Failed to load Zotero conflicts.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const resolve = async (conflict: ZoteroConflict) => {
    const selected = choices[conflict.id] ?? {};
    const fields = Object.keys(conflict.fields);
    if (fields.some((field) => !selected[field])) {
      setError('Choose Odyssey or Zotero for every conflicting field.');
      return;
    }
    setResolvingId(conflict.id);
    setError(null);
    try {
      const result = await resolveZoteroConflict(conflict.id, selected);
      onResolved(result.sources);
      setConflicts((current) => current.filter((item) => item.id !== conflict.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to resolve Zotero conflict.');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-[min(980px,96vw)] flex-col border border-border bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-danger">Review required</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-heading">
              <AlertTriangle size={17} /> Zotero sync conflicts
            </h2>
            <p className="mt-1 text-xs text-muted">Non-overlapping edits were already merged. Choose a value only where both sides changed the same field.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-muted hover:text-heading" aria-label="Close conflicts">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" /> Loading conflicts…
            </div>
          ) : conflicts.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted">All Zotero changes are synchronized.</div>
          ) : (
            <div className="space-y-5">
              {conflicts.map((conflict) => (
                <section key={conflict.id} className="border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-surface2 px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-heading">Source {conflict.sourceId}</p>
                      <p className="mt-0.5 text-[10px] font-mono text-muted">Zotero item {conflict.itemKey} · version {conflict.remoteVersion}</p>
                    </div>
                    <button type="button" onClick={() => { void resolve(conflict); }} disabled={resolvingId === conflict.id}
                      className="inline-flex items-center gap-1.5 border border-accent bg-accent px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-fg)] disabled:opacity-50">
                      {resolvingId === conflict.id && <Loader2 size={10} className="animate-spin" />} Apply resolution
                    </button>
                  </div>
                  <div className="divide-y divide-border">
                    {Object.entries(conflict.fields).map(([field, values]) => {
                      const choice = choices[conflict.id]?.[field];
                      return (
                        <div key={field} className="p-4">
                          <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">{field}</p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {(['local', 'remote'] as const).map((side) => (
                              <button key={side} type="button"
                                onClick={() => setChoices((current) => ({
                                  ...current,
                                  [conflict.id]: { ...(current[conflict.id] ?? {}), [field]: side },
                                }))}
                                className={`min-h-20 whitespace-pre-wrap border p-3 text-left text-xs leading-relaxed ${
                                  choice === side ? 'border-accent bg-accent/5 text-heading' : 'border-border text-muted hover:text-heading'
                                }`}>
                                <span className="mb-1 block text-[9px] font-mono uppercase tracking-[0.15em]">
                                  {side === 'local' ? 'Odyssey' : 'Zotero'}
                                </span>
                                {displayValue(values[side])}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        {error && <div className="border-t border-danger/30 bg-danger/5 px-5 py-2 text-xs text-danger">{error}</div>}
      </div>
    </div>
  );
}
