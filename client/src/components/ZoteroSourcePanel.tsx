import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, Download, FileText, Loader2, MessageSquareText, RefreshCw, Send, Trash2, Unlink } from 'lucide-react';
import {
  deleteZoteroNote,
  downloadZoteroExport,
  exportAttachmentToZotero,
  exportSourceToZotero,
  fetchZoteroCollections,
  fetchZoteroFulltext,
  importZoteroAttachment,
  saveZoteroNote,
  unlinkZoteroSource,
} from '../lib/zotero';
import type { SourceLibraryItem } from '../pages/ThesisPage';

type ZoteroSourcePanelProps = {
  source: SourceLibraryItem;
  connected: boolean;
  onSourcesUpdated: (sources: SourceLibraryItem[]) => void;
  onSourceUpdated: (source: SourceLibraryItem) => void;
};

export default function ZoteroSourcePanel({
  source,
  connected,
  onSourcesUpdated,
  onSourceUpdated,
}: ZoteroSourcePanelProps) {
  const [noteText, setNoteText] = useState('');
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Array<{ key: string; name: string }>>([]);
  const link = source.zoteroLink;
  const linkItemKey = link?.itemKey;
  const notes = source.zoteroNotes ?? [];
  const attachments = useMemo(() => source.zoteroAttachments ?? [], [source.zoteroAttachments]);
  const annotations = source.zoteroAnnotations ?? [];
  const fulltextAttachment = useMemo(
    () => attachments.find((attachment) => /pdf/i.test(attachment.contentType || '') || /\.pdf$/i.test(attachment.filename || ''))
      ?? attachments[0],
    [attachments],
  );

  useEffect(() => {
    if (!connected || !linkItemKey) return;
    let cancelled = false;
    void fetchZoteroCollections()
      .then((result) => {
        if (!cancelled) setCollections(result.collections.map((collection) => ({
          key: collection.key,
          name: collection.data.name || 'Untitled collection',
        })));
      })
      .catch(() => {
        // Collection editing is supplemental to the linked-source controls.
      });
    return () => { cancelled = true; };
  }, [connected, linkItemKey]);

  const run = async (label: string, action: () => Promise<void>) => {
    setPending(label);
    setError(null);
    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Zotero action failed.');
    } finally {
      setPending(null);
    }
  };

  const updateSources = (value: unknown[]) => {
    onSourcesUpdated(value as SourceLibraryItem[]);
  };

  const downloadExport = async (format: 'bibtex' | 'biblatex' | 'ris' | 'csljson') => {
    if (!link) return;
    const content = await downloadZoteroExport([link.itemKey], format);
    const extension = format === 'bibtex' || format === 'biblatex' ? 'bib' : format === 'csljson' ? 'json' : 'ris';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${source.citeKey || link.itemKey}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (!link) {
    if (!connected) return null;
    return (
      <section className="border border-border bg-surface2/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-semibold text-heading"><BookOpen size={13} /> Zotero</h4>
            <p className="mt-1 text-xs text-muted">Create this source in your personal Zotero library and keep its citation metadata synchronized.</p>
          </div>
          <button type="button" onClick={() => { void run('export-source', async () => {
            const result = await exportSourceToZotero(source.id);
            onSourceUpdated(result.source as SourceLibraryItem);
          }); }}
            disabled={Boolean(pending)}
            className="inline-flex items-center gap-1.5 border border-accent px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-accent hover:bg-accent/5 disabled:opacity-50">
            {pending === 'export-source' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send to Zotero
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>
    );
  }

  const openUrl = `https://www.zotero.org/users/${encodeURIComponent(link.libraryId)}/items/${encodeURIComponent(link.itemKey)}`;

  return (
    <section className="space-y-4 border border-border bg-surface2/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-heading"><BookOpen size={13} /> Zotero</h4>
            <span className={`border px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.12em] ${
              link.syncStatus === 'conflict' || link.syncStatus === 'removed_remote'
                ? 'border-danger/40 text-danger'
                : link.syncStatus === 'synced'
                  ? 'border-accent3/40 text-accent3'
                  : 'border-accent2/40 text-accent2'
            }`}>{link.syncStatus.replace(/_/g, ' ')}</span>
          </div>
          <p className="mt-1 text-[10px] font-mono text-muted">Item {link.itemKey} · version {link.itemVersion}</p>
          {link.lastError && <p className="mt-1 text-xs text-danger">{link.lastError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={openUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 border border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-heading">
            <ArrowUpRight size={11} /> Open Zotero
          </a>
          <button type="button" onClick={() => { void run('unlink', async () => {
            const result = await unlinkZoteroSource(source.id);
            onSourceUpdated(result.source as SourceLibraryItem);
          }); }}
            disabled={Boolean(pending)}
            className="inline-flex items-center gap-1.5 border border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-heading disabled:opacity-50">
            {pending === 'unlink' ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />} Unlink
          </button>
        </div>
      </div>

      {source.citation && (
        <div className="border border-border bg-surface px-3 py-2">
          <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted">Zotero formatted bibliography</p>
          <p className="mt-1 text-xs leading-relaxed text-heading">{source.citation}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted">Export</span>
        {(['bibtex', 'biblatex', 'ris', 'csljson'] as const).map((format) => (
          <button key={format} type="button" onClick={() => { void run(`export-${format}`, () => downloadExport(format)); }}
            disabled={Boolean(pending)}
            className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-muted hover:text-heading disabled:opacity-50">
            <Download size={9} /> {format}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
              <MessageSquareText size={11} /> Zotero notes
            </p>
            <span className="text-[10px] text-muted">{notes.length}</span>
          </div>
          <div className="max-h-40 space-y-2 overflow-y-auto">
            {notes.map((note) => (
              <div key={note.key} className="border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-heading">
                <p>{note.text || 'Empty note'}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => { setEditingNoteKey(note.key); setNoteText(note.html || note.text); }}
                    className="text-[9px] font-mono uppercase tracking-wider text-accent hover:underline">Edit</button>
                  <button type="button" onClick={() => { void run(`delete-note-${note.key}`, async () => {
                    const result = await deleteZoteroNote(source.id, note.key, note.version);
                    updateSources(result.sources);
                    if (editingNoteKey === note.key) { setEditingNoteKey(null); setNoteText(''); }
                  }); }} disabled={Boolean(pending)}
                    className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-danger hover:underline disabled:opacity-50">
                    <Trash2 size={9} /> Delete
                  </button>
                </div>
              </div>
            ))}
            {notes.length === 0 && <p className="text-xs text-muted">No child notes in Zotero.</p>}
          </div>
          <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3}
            placeholder="Add a note to this Zotero item"
            className="w-full resize-y border border-border bg-surface px-3 py-2 text-xs text-heading outline-none placeholder:text-muted focus:border-accent" />
          <button type="button" onClick={() => { void run('note', async () => {
            const editingNote = notes.find((note) => note.key === editingNoteKey);
            const result = await saveZoteroNote(source.id, {
              html: noteText,
              ...(editingNote ? { noteKey: editingNote.key, version: editingNote.version } : {}),
            });
            updateSources(result.sources);
            setNoteText('');
            setEditingNoteKey(null);
          }); }}
            disabled={!noteText.trim() || Boolean(pending)}
            className="inline-flex items-center gap-1.5 border border-accent/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent disabled:opacity-50">
            {pending === 'note' && <Loader2 size={10} className="animate-spin" />} {editingNoteKey ? 'Update Zotero note' : 'Add Zotero note'}
          </button>
          {editingNoteKey && (
            <button type="button" onClick={() => { setEditingNoteKey(null); setNoteText(''); }}
              className="ml-2 text-[9px] font-mono uppercase tracking-wider text-muted hover:text-heading">Cancel edit</button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
              <FileText size={11} /> Attachments
            </p>
            <span className="text-[10px] text-muted">{attachments.length}</span>
          </div>
          <div className="max-h-44 space-y-2 overflow-y-auto">
            {attachments.map((attachment) => (
              <div key={attachment.key} className="flex items-center justify-between gap-3 border border-border bg-surface px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-heading">{attachment.filename || attachment.title || attachment.key}</p>
                  <p className="mt-0.5 text-[10px] text-muted">{attachment.contentType || attachment.linkMode}</p>
                </div>
                {attachment.linkMode !== 'linked_url' && (
                  <button type="button" onClick={() => { void run(`import-${attachment.key}`, async () => {
                    const confirmed = source.verification !== 'restricted'
                      || window.confirm('This source is marked restricted. Confirm that it may be copied into Odyssey.');
                    if (!confirmed) return;
                    const result = await importZoteroAttachment(source.id, attachment.key, confirmed);
                    onSourceUpdated(result.source as SourceLibraryItem);
                  }); }}
                    disabled={Boolean(pending)}
                    className="inline-flex shrink-0 items-center gap-1 border border-border px-2 py-1 text-[9px] uppercase tracking-wider text-muted hover:text-heading disabled:opacity-50">
                    {pending === `import-${attachment.key}` ? <Loader2 size={9} className="animate-spin" /> : <Download size={9} />} Import
                  </button>
                )}
              </div>
            ))}
            {attachments.length === 0 && <p className="text-xs text-muted">No Zotero attachments.</p>}
          </div>
          {source.attachmentStoragePath && (
            <button type="button" onClick={() => { void run('export-attachment', async () => {
              const confirmed = source.verification !== 'restricted'
                || window.confirm('This source is marked restricted. Confirm that it may be uploaded to Zotero.');
              if (!confirmed) return;
              const result = await exportAttachmentToZotero(source.id, {
                storagePath: source.attachmentStoragePath,
                filename: source.attachmentName,
                mimeType: source.attachmentMimeType,
                confirmedRestricted: confirmed,
              });
              updateSources(result.sources);
            }); }}
              disabled={Boolean(pending)}
              className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-heading disabled:opacity-50">
              {pending === 'export-attachment' ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />} Send Odyssey copy to Zotero
            </button>
          )}
        </div>
      </div>

      {collections.length > 0 && (
        <label className="block border-t border-border pt-3">
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Zotero collections</span>
          <select
            multiple
            value={source.zoteroCollectionKeys ?? link.collectionKeys}
            onChange={(event) => {
              const collectionKeys = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
              onSourceUpdated({
                ...source,
                zoteroCollectionKeys: collectionKeys,
                zoteroLink: { ...link, collectionKeys, syncStatus: 'local_pending' },
              });
            }}
            className="mt-2 min-h-24 w-full border border-border bg-surface px-3 py-2 text-xs text-heading outline-none focus:border-accent"
          >
            {collections.map((collection) => (
              <option key={collection.key} value={collection.key}>{collection.name}</option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] text-muted">Use Ctrl/Cmd to select more than one collection.</span>
        </label>
      )}

      {(fulltextAttachment || source.zoteroFulltextEnabled) && (
        <div className="border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Thesis AI access</p>
              <p className="mt-1 text-xs text-muted">
                {source.zoteroFulltextEnabled
                  ? 'An explicitly approved full-text excerpt is available to Thesis AI.'
                  : 'Zotero full text stays outside Thesis AI until you explicitly enable it.'}
              </p>
            </div>
            {source.zoteroFulltextEnabled ? (
              <button type="button" onClick={() => onSourceUpdated({
                ...source,
                zoteroFulltextEnabled: false,
                zoteroFulltextPreview: '',
                zoteroFulltextStats: undefined,
              })}
                className="border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-heading">
                Remove from Thesis AI
              </button>
            ) : fulltextAttachment ? (
              <button type="button" onClick={() => { void run('fulltext', async () => {
                const result = await fetchZoteroFulltext(fulltextAttachment.key);
                if (!result.content?.trim()) throw new Error('Zotero has not indexed full text for this attachment.');
                onSourceUpdated({
                  ...source,
                  zoteroFulltextEnabled: true,
                  zoteroFulltextPreview: result.content.slice(0, 20_000),
                  zoteroFulltextStats: {
                    indexedPages: result.indexedPages,
                    totalPages: result.totalPages,
                    indexedChars: result.indexedChars,
                    totalChars: result.totalChars,
                  },
                });
              }); }}
                disabled={Boolean(pending)}
                className="inline-flex items-center gap-1.5 border border-accent/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent disabled:opacity-50">
                {pending === 'fulltext' ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Use with Thesis AI
              </button>
            ) : null}
          </div>
          {source.zoteroFulltextEnabled && source.zoteroFulltextPreview && (
            <p className="mt-2 max-h-24 overflow-y-auto border border-border bg-surface px-3 py-2 text-[10px] leading-relaxed text-muted">
              {source.zoteroFulltextPreview.slice(0, 900)}…
            </p>
          )}
        </div>
      )}

      {annotations.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Evidence from Zotero annotations</p>
          <div className="grid gap-2 md:grid-cols-2">
            {annotations.slice(0, 8).map((annotation) => (
              <div key={annotation.key} className="border-l-2 border-accent bg-surface px-3 py-2">
                <p className="text-xs leading-relaxed text-heading">{annotation.text || annotation.comment || 'Annotation'}</p>
                <p className="mt-1 text-[9px] font-mono uppercase tracking-wider text-muted">
                  {annotation.pageLabel ? `Page ${annotation.pageLabel}` : 'Page not recorded'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
