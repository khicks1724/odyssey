import { useState, useEffect, useCallback } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  FileText,
  Folder,
  BookOpen,
  Search,
  Download,
  Sparkles,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { OneNoteNotebook, OneNoteSection, OneNotePage, OneDriveItem } from '../types';
import {
  fetchOneNoteNotebooks,
  fetchOneNoteSections,
  fetchOneNotePages,
  fetchOneNotePageContent,
  fetchOneDriveFiles,
  fetchOneDriveFileContent,
  importToProject,
} from '../hooks/useMicrosoftIntegration';

const API_BASE = '/api';

interface AnalysisResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  projectRelevance: string;
  provider: string;
}

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onImported: () => void;
}

type ActiveTab = 'onenote' | 'onedrive';

// ── OneNote browser ──────────────────────────────────────────────────────────
function OneNoteBrowser({
  projectId,
  projectName,
  onImported,
}: {
  projectId: string;
  projectName: string;
  onImported: () => void;
}) {
  const [notebooks, setNotebooks] = useState<OneNoteNotebook[]>([]);
  const [sections, setSections] = useState<OneNoteSection[]>([]);
  const [pages, setPages] = useState<OneNotePage[]>([]);
  const [selectedNotebook, setSelectedNotebook] = useState<OneNoteNotebook | null>(null);
  const [selectedSection, setSelectedSection] = useState<OneNoteSection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [analysisPageId, setAnalysisPageId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, AnalysisResult>>({});

  useEffect(() => {
    fetchOneNoteNotebooks().then((data) => {
      setNotebooks(data as OneNoteNotebook[]);
      setLoading(false);
    }).catch(() => {
      setError('Failed to load notebooks');
      setLoading(false);
    });
  }, []);

  const openNotebook = useCallback(async (nb: OneNoteNotebook) => {
    setSelectedNotebook(nb);
    setSelectedSection(null);
    setSections([]);
    setPages([]);
    setLoading(true);
    const data = await fetchOneNoteSections(nb.id);
    setSections(data as OneNoteSection[]);
    setLoading(false);
  }, []);

  const openSection = useCallback(async (sec: OneNoteSection) => {
    setSelectedSection(sec);
    setPages([]);
    setLoading(true);
    const data = await fetchOneNotePages(sec.id);
    setPages(data as OneNotePage[]);
    setLoading(false);
  }, []);

  const handleImport = useCallback(async (page: OneNotePage) => {
    setImportingId(page.id);
    const content = await fetchOneNotePageContent(page.id);
    await importToProject({
      projectId,
      source: 'onenote',
      itemId: page.id,
      title: page.title,
      content: content?.text,
    });
    setImportingId(null);
    onImported();
  }, [projectId, onImported]);

  const handleAnalyze = useCallback(async (page: OneNotePage) => {
    setAnalysisPageId(page.id);
    const content = await fetchOneNotePageContent(page.id);
    if (!content?.text) { setAnalysisPageId(null); return; }

    try {
      const res = await fetch(`${API_BASE}/ai/analyze-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: page.title,
          content: content.text,
          projectName,
        }),
      });
      if (res.ok) {
        const data: AnalysisResult = await res.json();
        setAnalysis((prev) => ({ ...prev, [page.id]: data }));
      }
    } catch { /* ignore */ }
    setAnalysisPageId(null);
  }, [projectName]);

  if (loading && notebooks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={18} className="animate-spin text-accent" />
        <span className="ml-2 text-xs text-muted">Loading notebooks…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-8 text-danger text-xs">
        <AlertCircle size={14} /> {error}
      </div>
    );
  }

  // Breadcrumb back navigation
  const BreadcrumbNav = () => (
    <div className="flex items-center gap-1 text-[11px] text-muted mb-3 font-mono">
      <button
        onClick={() => { setSelectedNotebook(null); setSelectedSection(null); setPages([]); setSections([]); }}
        className="hover:text-heading"
      >
        Notebooks
      </button>
      {selectedNotebook && (
        <>
          <ChevronRight size={10} />
          <button
            onClick={() => { setSelectedSection(null); setPages([]); }}
            className="hover:text-heading"
          >
            {selectedNotebook.displayName}
          </button>
        </>
      )}
      {selectedSection && (
        <>
          <ChevronRight size={10} />
          <span className="text-heading">{selectedSection.displayName}</span>
        </>
      )}
    </div>
  );

  // Notebook list
  if (!selectedNotebook) {
    return (
      <div>
        <p className="text-[11px] text-muted mb-3">Select a notebook to browse its sections and pages.</p>
        <div className="space-y-px border border-border bg-border">
          {notebooks.map((nb) => (
            <button
              key={nb.id}
              onClick={() => openNotebook(nb)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface2 transition-colors text-left"
            >
              <BookOpen size={14} className="text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading font-medium truncate">{nb.displayName}</div>
                <div className="text-[10px] text-muted">
                  Last modified {new Date(nb.lastModifiedDateTime).toLocaleDateString()}
                </div>
              </div>
              <ChevronRight size={12} className="text-muted" />
            </button>
          ))}
          {notebooks.length === 0 && (
            <div className="bg-surface px-4 py-6 text-xs text-muted text-center">No notebooks found</div>
          )}
        </div>
      </div>
    );
  }

  // Section list
  if (!selectedSection) {
    return (
      <div>
        <BreadcrumbNav />
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted">
            <Loader2 size={12} className="animate-spin" /> Loading sections…
          </div>
        ) : (
          <div className="space-y-px border border-border bg-border">
            {sections.map((sec) => (
              <button
                key={sec.id}
                onClick={() => openSection(sec)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface2 transition-colors text-left"
              >
                <FileText size={13} className="text-accent2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium truncate">{sec.displayName}</div>
                </div>
                <ChevronRight size={12} className="text-muted" />
              </button>
            ))}
            {sections.length === 0 && (
              <div className="bg-surface px-4 py-6 text-xs text-muted text-center">No sections found</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Page list
  return (
    <div>
      <BreadcrumbNav />
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Loading pages…
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <div key={page.id} className="border border-border bg-surface p-3">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={13} className="text-accent3 shrink-0" />
                <span className="text-xs text-heading font-medium flex-1 truncate">{page.title}</span>
                <span className="text-[10px] text-muted">
                  {new Date(page.lastModifiedDateTime).toLocaleDateString()}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAnalyze(page)}
                  disabled={analysisPageId === page.id}
                  className="flex items-center gap-1 px-2 py-1 border border-accent/30 text-accent text-[10px] tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                >
                  {analysisPageId === page.id
                    ? <Loader2 size={10} className="animate-spin" />
                    : <Sparkles size={10} />
                  }
                  Analyze
                </button>
                <button
                  onClick={() => handleImport(page)}
                  disabled={importingId === page.id}
                  className="flex items-center gap-1 px-2 py-1 border border-accent2/30 text-accent2 text-[10px] tracking-wider uppercase hover:bg-accent2/5 transition-colors rounded disabled:opacity-50"
                >
                  {importingId === page.id
                    ? <Loader2 size={10} className="animate-spin" />
                    : <Download size={10} />
                  }
                  Import
                </button>
              </div>
              {analysis[page.id] && (
                <div className="mt-3 space-y-2 text-xs border-t border-border pt-3">
                  <p className="text-muted">{analysis[page.id].summary}</p>
                  {analysis[page.id].keyPoints.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-accent3 mb-1">Key Points</div>
                      <ul className="space-y-0.5">
                        {analysis[page.id].keyPoints.map((pt, i) => (
                          <li key={i} className="text-heading flex items-start gap-1">
                            <span className="text-accent3 mt-0.5">·</span> {pt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysis[page.id].actionItems.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-accent2 mb-1">Action Items</div>
                      <ul className="space-y-0.5">
                        {analysis[page.id].actionItems.map((item, i) => (
                          <li key={i} className="text-heading flex items-start gap-1">
                            <span className="text-accent2 mt-0.5">·</span> {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {pages.length === 0 && (
            <div className="border border-border px-4 py-6 text-xs text-muted text-center">No pages in this section</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── OneDrive browser ─────────────────────────────────────────────────────────
function OneDriveBrowser({
  projectId,
  projectName,
  onImported,
}: {
  projectId: string;
  projectName: string;
  onImported: () => void;
}) {
  const [files, setFiles] = useState<OneDriveItem[]>([]);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [analysisItemId, setAnalysisItemId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, AnalysisResult>>({});

  const loadFiles = useCallback(async (folderId?: string, searchTerm?: string) => {
    setLoading(true);
    const data = await fetchOneDriveFiles({ folderId, search: searchTerm });
    setFiles(data as OneDriveItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const currentFolder = folderStack[folderStack.length - 1];
    loadFiles(currentFolder?.id, search || undefined);
  }, [folderStack, loadFiles]); // eslint-disable-line

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setFolderStack([]);
    loadFiles(undefined, search || undefined);
  }, [search, loadFiles]);

  const openFolder = useCallback((item: OneDriveItem) => {
    setFolderStack((prev) => [...prev, { id: item.id, name: item.name }]);
  }, []);

  const goBack = useCallback(() => {
    setFolderStack((prev) => prev.slice(0, -1));
  }, []);

  const handleImport = useCallback(async (item: OneDriveItem) => {
    setImportingId(item.id);
    const content = await fetchOneDriveFileContent(item.id);
    await importToProject({
      projectId,
      source: 'onedrive',
      itemId: item.id,
      title: item.name,
      webUrl: item.webUrl,
      content: content?.text,
    });
    setImportingId(null);
    onImported();
  }, [projectId, onImported]);

  const handleAnalyze = useCallback(async (item: OneDriveItem) => {
    setAnalysisItemId(item.id);
    const content = await fetchOneDriveFileContent(item.id);
    if (!content?.text) { setAnalysisItemId(null); return; }

    try {
      const res = await fetch(`${API_BASE}/ai/analyze-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.name,
          content: content.text,
          projectName,
        }),
      });
      if (res.ok) {
        const data: AnalysisResult = await res.json();
        setAnalysis((prev) => ({ ...prev, [item.id]: data }));
      }
    } catch { /* ignore */ }
    setAnalysisItemId(null);
  }, [projectName]);

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const BreadcrumbNav = () => (
    <div className="flex items-center gap-1 text-[11px] text-muted mb-3 font-mono">
      <button onClick={() => setFolderStack([])} className="hover:text-heading">My Drive</button>
      {folderStack.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1">
          <ChevronRight size={10} />
          <button
            onClick={() => setFolderStack((prev) => prev.slice(0, i + 1))}
            className="hover:text-heading"
          >
            {f.name}
          </button>
        </span>
      ))}
    </div>
  );

  return (
    <div>
      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search OneDrive files…"
          className="flex-1 px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
        />
        <button
          type="submit"
          className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] tracking-wider uppercase hover:bg-accent/5 transition-colors rounded flex items-center gap-1"
        >
          <Search size={10} /> Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFolderStack([]); loadFiles(); }}
            className="px-3 py-1.5 border border-border text-muted text-[10px] tracking-wider uppercase hover:bg-surface2 transition-colors rounded"
          >
            Clear
          </button>
        )}
      </form>

      <BreadcrumbNav />

      {folderStack.length > 0 && (
        <button
          onClick={goBack}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-heading mb-3 transition-colors"
        >
          <ChevronLeft size={12} /> Back
        </button>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Loading files…
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((item) => {
            const isFolder = !!item.folder;
            return (
              <div key={item.id} className="border border-border bg-surface p-3">
                <div className="flex items-center gap-2 mb-2">
                  {isFolder
                    ? <Folder size={13} className="text-accent shrink-0" />
                    : <FileText size={13} className="text-accent3 shrink-0" />
                  }
                  <span className="text-xs text-heading font-medium flex-1 truncate">{item.name}</span>
                  <span className="text-[10px] text-muted shrink-0">
                    {isFolder
                      ? `${item.folder?.childCount ?? 0} items`
                      : formatSize(item.size)
                    }
                  </span>
                </div>
                {isFolder ? (
                  <button
                    onClick={() => openFolder(item)}
                    className="flex items-center gap-1 px-2 py-1 border border-border text-muted text-[10px] tracking-wider uppercase hover:bg-surface2 transition-colors rounded"
                  >
                    <ChevronRight size={10} /> Open folder
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAnalyze(item)}
                      disabled={analysisItemId === item.id}
                      className="flex items-center gap-1 px-2 py-1 border border-accent/30 text-accent text-[10px] tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                    >
                      {analysisItemId === item.id
                        ? <Loader2 size={10} className="animate-spin" />
                        : <Sparkles size={10} />
                      }
                      Analyze
                    </button>
                    <button
                      onClick={() => handleImport(item)}
                      disabled={importingId === item.id}
                      className="flex items-center gap-1 px-2 py-1 border border-accent2/30 text-accent2 text-[10px] tracking-wider uppercase hover:bg-accent2/5 transition-colors rounded disabled:opacity-50"
                    >
                      {importingId === item.id
                        ? <Loader2 size={10} className="animate-spin" />
                        : <Download size={10} />
                      }
                      Import
                    </button>
                    {item.webUrl && (
                      <a
                        href={item.webUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2 py-1 border border-border text-muted text-[10px] tracking-wider uppercase hover:bg-surface2 transition-colors rounded"
                      >
                        Open
                      </a>
                    )}
                  </div>
                )}
                {analysis[item.id] && (
                  <div className="mt-3 space-y-2 text-xs border-t border-border pt-3">
                    <p className="text-muted">{analysis[item.id].summary}</p>
                    {analysis[item.id].keyPoints.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-accent3 mb-1">Key Points</div>
                        <ul className="space-y-0.5">
                          {analysis[item.id].keyPoints.map((pt, i) => (
                            <li key={i} className="text-heading flex items-start gap-1">
                              <span className="text-accent3 mt-0.5">·</span> {pt}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis[item.id].actionItems.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-accent2 mb-1">Action Items</div>
                        <ul className="space-y-0.5">
                          {analysis[item.id].actionItems.map((item2, i) => (
                            <li key={i} className="text-heading flex items-start gap-1">
                              <span className="text-accent2 mt-0.5">·</span> {item2}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {files.length === 0 && (
            <div className="border border-border px-4 py-6 text-xs text-muted text-center">
              {search ? 'No files matched your search' : 'No files in this location'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function OfficeFilePicker({ projectId, projectName, onClose, onImported }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('onenote');
  const [importCount, setImportCount] = useState(0);

  const handleImported = useCallback(() => {
    setImportCount((c) => c + 1);
    onImported();
  }, [onImported]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-sans text-sm font-bold text-heading">Microsoft 365 Files</h2>
            <p className="text-[11px] text-muted font-mono">Browse and import files into {projectName}</p>
          </div>
          <div className="flex items-center gap-3">
            {importCount > 0 && (
              <span className="text-[10px] text-accent3 font-mono">
                {importCount} imported
              </span>
            )}
            <button onClick={onClose} className="text-muted hover:text-heading transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-px border-b border-border bg-border">
          {(['onenote', 'onedrive'] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 bg-surface text-[11px] tracking-wider uppercase transition-colors ${
                activeTab === tab ? 'text-heading bg-surface2 font-medium' : 'text-muted hover:text-heading hover:bg-surface2'
              }`}
            >
              {tab === 'onenote' ? 'OneNote' : 'OneDrive'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'onenote' ? (
            <OneNoteBrowser
              projectId={projectId}
              projectName={projectName}
              onImported={handleImported}
            />
          ) : (
            <OneDriveBrowser
              projectId={projectId}
              projectName={projectName}
              onImported={handleImported}
            />
          )}
        </div>
      </div>
    </div>
  );
}
