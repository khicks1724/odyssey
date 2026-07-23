import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import {
  fetchZoteroCollections,
  fetchZoteroItems,
  importZoteroItems,
  ZOTERO_CSL_STYLE_BY_FORMAT,
  type ZoteroCollection,
  type ZoteroItem,
} from '../lib/zotero';

type ZoteroLibraryModalProps = {
  bibliographyFormat: string;
  onClose: () => void;
  onImported: (sources: unknown[]) => void;
};

function creatorLabel(item: ZoteroItem) {
  return (item.data.creators ?? [])
    .map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ');
}

function collectionDepth(collection: ZoteroCollection, byKey: Map<string, ZoteroCollection>) {
  let depth = 0;
  let parent = collection.data.parentCollection;
  const visited = new Set<string>();
  while (typeof parent === 'string' && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    parent = byKey.get(parent)?.data.parentCollection;
  }
  return depth;
}

export default function ZoteroLibraryModal({
  bibliographyFormat,
  onClose,
  onImported,
}: ZoteroLibraryModalProps) {
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [collectionKey, setCollectionKey] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [keepSynced, setKeepSynced] = useState(true);
  const [start, setStart] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 40;

  useEffect(() => {
    let cancelled = false;
    void fetchZoteroCollections()
      .then((result) => {
        if (!cancelled) setCollections(result.collections);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Failed to load Zotero collections.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetchZoteroItems({
        query: query.trim() || undefined,
        collectionKey: collectionKey || undefined,
        start,
        limit,
        style: ZOTERO_CSL_STYLE_BY_FORMAT[bibliographyFormat] ?? 'apa',
      })
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setTotal(result.total);
        })
        .catch((nextError) => {
          if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Failed to load Zotero items.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [bibliographyFormat, collectionKey, query, start]);

  const collectionOptions = useMemo(() => {
    const byKey = new Map(collections.map((collection) => [collection.key, collection]));
    return [...collections].sort((left, right) => {
      const leftDepth = collectionDepth(left, byKey);
      const rightDepth = collectionDepth(right, byKey);
      return leftDepth - rightDepth || (left.data.name ?? '').localeCompare(right.data.name ?? '');
    }).map((collection) => ({
      ...collection,
      depth: collectionDepth(collection, byKey),
    }));
  }, [collections]);

  const toggleItem = (itemKey: string) => {
    setSelectedKeys((current) => (
      current.includes(itemKey)
        ? current.filter((key) => key !== itemKey)
        : [...current, itemKey]
    ));
  };

  const handleImport = async () => {
    if (selectedKeys.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const result = await importZoteroItems({
        itemKeys: selectedKeys,
        ...(keepSynced ? {
          selectedCollectionKeys: collectionKey ? [collectionKey] : [],
          syncAll: !collectionKey,
        } : {}),
      });
      if (result.importedCount < 1) {
        throw new Error('Zotero did not return an importable source for the selected item.');
      }
      onImported(result.sources);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to import Zotero items.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4" onMouseDown={onClose}>
      <div className="flex h-[min(820px,92vh)] w-[min(1120px,96vw)] flex-col border border-border bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-accent">Personal library</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-heading">
              <BookOpen size={17} /> Import from Zotero
            </h2>
            <p className="mt-1 text-xs text-muted">Search metadata and Zotero-indexed full text, then import one or more sources.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-muted hover:text-heading" aria-label="Close Zotero library">
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-3 border-b border-border bg-surface2/60 px-5 py-3 md:grid-cols-[260px_1fr]">
          <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
            Collection
            <select value={collectionKey} onChange={(event) => { setCollectionKey(event.target.value); setStart(0); }}
              className="mt-1.5 h-9 w-full border border-border bg-surface px-2 text-xs normal-case tracking-normal text-heading outline-none focus:border-accent">
              <option value="">All personal library</option>
              {collectionOptions.map((collection) => (
                <option key={collection.key} value={collection.key}>
                  {`${'— '.repeat(collection.depth)}${collection.data.name || 'Untitled collection'}`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
            Search
            <span className="relative mt-1.5 block">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setStart(0); }}
                placeholder="Title, creator, metadata, or indexed full text"
                className="h-9 w-full border border-border bg-surface pl-9 pr-3 text-xs normal-case tracking-normal text-heading outline-none placeholder:text-muted focus:border-accent" />
            </span>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Loading Zotero library…
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">No Zotero items matched this view.</div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => {
                const selected = selectedKeys.includes(item.key);
                const creators = creatorLabel(item);
                return (
                  <label key={item.key} className={`flex cursor-pointer gap-3 px-5 py-3 transition-colors hover:bg-surface2 ${selected ? 'bg-accent/5' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleItem(item.key)}
                      className="mt-1 accent-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-heading">{item.data.title || 'Untitled source'}</span>
                      <span className="mt-1 block text-xs text-muted">
                        {[creators, item.data.date, item.data.publicationTitle || item.data.proceedingsTitle || item.data.bookTitle].filter(Boolean).join(' · ') || item.data.itemType}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        <span className="border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-muted">{item.data.itemType || 'item'}</span>
                        {(item.data.tags ?? []).slice(0, 4).map((tag) => tag.tag && (
                          <span key={tag.tag} className="border border-border/70 px-1.5 py-0.5 text-[9px] text-muted">{tag.tag}</span>
                        ))}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={keepSynced} onChange={(event) => setKeepSynced(event.target.checked)}
                className="accent-[var(--color-accent)]" />
              Keep {collectionKey ? 'this collection' : 'the personal library'} synchronized
            </label>
            <span className="text-[10px] font-mono text-muted">{selectedKeys.length} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStart(Math.max(0, start - limit))} disabled={start === 0}
              className="p-2 text-muted hover:text-heading disabled:opacity-30" aria-label="Previous Zotero page">
              <ChevronLeft size={15} />
            </button>
            <span className="text-[10px] font-mono text-muted">{total === 0 ? 0 : start + 1}–{Math.min(start + limit, total)} of {total}</span>
            <button type="button" onClick={() => setStart(start + limit)} disabled={start + limit >= total}
              className="p-2 text-muted hover:text-heading disabled:opacity-30" aria-label="Next Zotero page">
              <ChevronRight size={15} />
            </button>
            <button type="button" onClick={onClose}
              className="border border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-heading">Cancel</button>
            <button type="button" onClick={() => { void handleImport(); }} disabled={selectedKeys.length === 0 || importing}
              className="inline-flex items-center gap-1.5 border border-accent bg-accent px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-fg)] disabled:opacity-50">
              {importing && <Loader2 size={11} className="animate-spin" />} Import sources
            </button>
          </div>
        </div>
        {error && <div className="border-t border-danger/30 bg-danger/5 px-5 py-2 text-xs text-danger">{error}</div>}
      </div>
    </div>
  );
}
