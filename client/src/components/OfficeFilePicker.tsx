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
import { Users } from 'lucide-react';
import type { OneNoteNotebook, OneNoteSection, OneNotePage, OneDriveItem } from '../types';
import {
  fetchOneNoteNotebooks,
  fetchOneNoteSections,
  fetchOneNotePages,
  fetchOneNotePageContent,
  fetchOneDriveFiles,
  fetchOneDriveFileContent,
  fetchTeams,
  fetchTeamChannels,
  fetchTeamChannelFiles,
  fetchTeamFileContent,
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

type ActiveTab = 'onenote' | 'onedrive' | 'teams';

interface TeamItem { id: string; displayName: string; description?: string }
interface ChannelItem { id: string; displayName: string; description?: string }
interface TeamsFileItem {
  id: string;
  name: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  size?: number;
  lastModifiedDateTime: string;
  webUrl?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  parentReference?: { driveId?: string };
}

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
    const groupId = (nb as unknown as { groupId?: string }).groupId;
    const data = await fetchOneNoteSections(nb.id, groupId);
    setSections(data as OneNoteSection[]);
    setLoading(false);
  }, []);

  const openSection = useCallback(async (sec: OneNoteSection) => {
    setSelectedSection(sec);
    setPages([]);
    setLoading(true);
    const groupId = selectedNotebook ? (selectedNotebook as unknown as { groupId?: string }).groupId : undefined;
    const data = await fetchOneNotePages(sec.id, groupId);
    setPages(data as OneNotePage[]);
    setLoading(false);
  }, [selectedNotebook]);

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
        <p className="text-[11px] text-muted mb-3">Select a notebook to browse its sections and pages. Team notebooks are marked with a badge.</p>
        <div className="space-y-px border border-border bg-border">
          {notebooks.map((nb) => {
            const isTeam = !!(nb as unknown as { isTeam?: boolean }).isTeam;
            const groupName = (nb as unknown as { groupName?: string }).groupName;
            return (
            <button
              key={nb.id}
              onClick={() => openNotebook(nb)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface2 transition-colors text-left"
            >
              <BookOpen size={14} className={isTeam ? 'text-accent2 shrink-0' : 'text-accent shrink-0'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-heading font-medium truncate">{nb.displayName}</span>
                  {isTeam && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 bg-accent2/10 text-accent2 border border-accent2/20 rounded font-mono uppercase tracking-wide">
                      {groupName ?? 'Team'}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted">
                  Last modified {new Date(nb.lastModifiedDateTime).toLocaleDateString()}
                </div>
              </div>
              <ChevronRight size={12} className="text-muted" />
            </button>
          );
          })}
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

// ── Teams channel files browser ──────────────────────────────────────────────
function TeamsBrowser({
  projectId,
  projectName,
  onImported,
}: {
  projectId: string;
  projectName: string;
  onImported: () => void;
}) {
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [files, setFiles] = useState<TeamsFileItem[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamItem | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelItem | null>(null);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string; driveId: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [analysisItemId, setAnalysisItemId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, AnalysisResult>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTeams().then((data) => {
      setTeams(data as TeamItem[]);
      setLoading(false);
    }).catch(() => {
      setError('Failed to load Teams. Make sure you have granted Team.ReadBasic.All permission — reconnect your Microsoft account if needed.');
      setLoading(false);
    });
  }, []);

  const openTeam = useCallback(async (team: TeamItem) => {
    setSelectedTeam(team);
    setSelectedChannel(null);
    setChannels([]);
    setFiles([]);
    setFolderStack([]);
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTeamChannels(team.id);
      setChannels(data as ChannelItem[]);
    } catch {
      setError('Failed to load channels');
    }
    setLoading(false);
  }, []);

  const openChannel = useCallback(async (channel: ChannelItem) => {
    if (!selectedTeam) return;
    setSelectedChannel(channel);
    setFiles([]);
    setFolderStack([]);
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTeamChannelFiles(selectedTeam.id, channel.id);
      setFiles(data as TeamsFileItem[]);
    } catch {
      setError('Failed to load channel files');
    }
    setLoading(false);
  }, [selectedTeam]);

  const openFolder = useCallback(async (item: TeamsFileItem) => {
    if (!selectedTeam || !selectedChannel) return;
    const driveId = item.parentReference?.driveId ?? '';
    setFolderStack((prev) => [...prev, { id: item.id, name: item.name, driveId }]);
    setLoading(true);
    const data = await fetchTeamChannelFiles(selectedTeam.id, selectedChannel.id, { folderId: item.id, driveId });
    setFiles(data as TeamsFileItem[]);
    setLoading(false);
  }, [selectedTeam, selectedChannel]);

  const goUpFolder = useCallback(async () => {
    if (!selectedTeam || !selectedChannel) return;
    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);
    setLoading(true);
    const parent = newStack[newStack.length - 1];
    const data = await fetchTeamChannelFiles(selectedTeam.id, selectedChannel.id, parent ? { folderId: parent.id, driveId: parent.driveId } : {});
    setFiles(data as TeamsFileItem[]);
    setLoading(false);
  }, [selectedTeam, selectedChannel, folderStack]);

  const handleImport = useCallback(async (item: TeamsFileItem) => {
    setImportingId(item.id);
    const driveId = item.parentReference?.driveId ?? '';
    let text: string | undefined;
    if (driveId) {
      const content = await fetchTeamFileContent(driveId, item.id);
      text = content?.text;
    }
    await importToProject({
      projectId,
      source: 'onedrive',
      itemId: item.id,
      title: item.name,
      webUrl: item.webUrl,
      content: text,
    });
    setImportingId(null);
    onImported();
  }, [projectId, onImported]);

  const handleAnalyze = useCallback(async (item: TeamsFileItem) => {
    setAnalysisItemId(item.id);
    const driveId = item.parentReference?.driveId ?? '';
    if (!driveId) { setAnalysisItemId(null); return; }
    const content = await fetchTeamFileContent(driveId, item.id);
    if (!content?.text || content.text.startsWith('[')) { setAnalysisItemId(null); return; }

    try {
      const res = await fetch(`${API_BASE}/ai/analyze-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.name, content: content.text, projectName }),
      });
      if (res.ok) {
        const data: AnalysisResult = await res.json();
        setAnalysis((prev) => ({ ...prev, [item.id]: data }));
      }
    } catch { /* ignore */ }
    setAnalysisItemId(null);
  }, [projectName]);

  if (loading && teams.length === 0 && !selectedTeam) {
    return <div className="flex items-center gap-2 py-12 text-xs text-muted"><Loader2 size={14} className="animate-spin" /> Loading Teams…</div>;
  }

  if (error) {
    return <div className="flex items-center gap-2 py-8 text-danger text-xs"><AlertCircle size={14} /> {error}</div>;
  }

  // Breadcrumb
  const BreadcrumbNav = () => (
    <div className="flex items-center gap-1 text-[11px] text-muted mb-3 font-mono flex-wrap">
      <button type="button" onClick={() => { setSelectedTeam(null); setSelectedChannel(null); setChannels([]); setFiles([]); setFolderStack([]); }} className="hover:text-heading">Teams</button>
      {selectedTeam && (
        <>
          <ChevronRight size={10} />
          <button type="button" onClick={() => { setSelectedChannel(null); setFiles([]); setFolderStack([]); }} className="hover:text-heading">{selectedTeam.displayName}</button>
        </>
      )}
      {selectedChannel && (
        <>
          <ChevronRight size={10} />
          <button type="button" onClick={() => { setFolderStack([]); openChannel(selectedChannel); }} className="hover:text-heading">{selectedChannel.displayName}</button>
        </>
      )}
      {folderStack.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1">
          <ChevronRight size={10} />
          <button type="button" onClick={async () => {
            const newStack = folderStack.slice(0, i + 1);
            setFolderStack(newStack);
            if (selectedTeam && selectedChannel) {
              setLoading(true);
              const data = await fetchTeamChannelFiles(selectedTeam.id, selectedChannel.id, { folderId: f.id, driveId: f.driveId });
              setFiles(data as TeamsFileItem[]);
              setLoading(false);
            }
          }} className="hover:text-heading">{f.name}</button>
        </span>
      ))}
    </div>
  );

  // Teams list
  if (!selectedTeam) {
    return (
      <div>
        <p className="text-[11px] text-muted mb-3">Select a Team to browse its channels and files.</p>
        {loading ? <div className="flex items-center gap-2 py-4 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Loading…</div> : (
          <div className="space-y-px border border-border bg-border">
            {teams.map((team) => (
              <button type="button" key={team.id} onClick={() => openTeam(team)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface2 transition-colors text-left">
                <Users size={14} className="text-accent2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium truncate">{team.displayName}</div>
                  {team.description && <div className="text-[10px] text-muted truncate">{team.description}</div>}
                </div>
                <ChevronRight size={12} className="text-muted" />
              </button>
            ))}
            {teams.length === 0 && <div className="bg-surface px-4 py-6 text-xs text-muted text-center">No Teams found</div>}
          </div>
        )}
      </div>
    );
  }

  // Channel list
  if (!selectedChannel) {
    return (
      <div>
        <BreadcrumbNav />
        {loading ? <div className="flex items-center gap-2 py-4 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Loading channels…</div> : (
          <div className="space-y-px border border-border bg-border">
            {channels.map((ch) => (
              <button type="button" key={ch.id} onClick={() => openChannel(ch)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface2 transition-colors text-left">
                <Folder size={13} className="text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium truncate">{ch.displayName}</div>
                </div>
                <ChevronRight size={12} className="text-muted" />
              </button>
            ))}
            {channels.length === 0 && <div className="bg-surface px-4 py-6 text-xs text-muted text-center">No channels found</div>}
          </div>
        )}
      </div>
    );
  }

  // Files list
  return (
    <div>
      <BreadcrumbNav />
      {folderStack.length > 0 && (
        <button type="button" onClick={goUpFolder} className="flex items-center gap-1 text-[11px] text-muted hover:text-heading mb-3 transition-colors">
          <ChevronLeft size={12} /> Back
        </button>
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Loading files…</div>
      ) : (
        <div className="space-y-2">
          {files.map((item) => {
            const isFolder = !!item.folder;
            const modifiedBy = item.lastModifiedBy?.user?.displayName;
            return (
              <div key={item.id} className="border border-border bg-surface p-3">
                <div className="flex items-center gap-2 mb-2">
                  {isFolder ? <Folder size={13} className="text-accent shrink-0" /> : <FileText size={13} className="text-accent3 shrink-0" />}
                  <span className="text-xs text-heading font-medium flex-1 truncate">{item.name}</span>
                  <div className="text-right shrink-0">
                    {modifiedBy && <div className="text-[9px] text-muted">{modifiedBy}</div>}
                    <div className="text-[9px] text-muted">{new Date(item.lastModifiedDateTime).toLocaleDateString()}</div>
                  </div>
                </div>
                {isFolder ? (
                  <button type="button" onClick={() => openFolder(item)}
                    className="flex items-center gap-1 px-2 py-1 border border-border text-muted text-[10px] tracking-wider uppercase hover:bg-surface2 transition-colors rounded">
                    <ChevronRight size={10} /> Open folder
                  </button>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => handleAnalyze(item)} disabled={analysisItemId === item.id}
                      className="flex items-center gap-1 px-2 py-1 border border-accent/30 text-accent text-[10px] tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50">
                      {analysisItemId === item.id ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      Analyze
                    </button>
                    <button type="button" onClick={() => handleImport(item)} disabled={importingId === item.id}
                      className="flex items-center gap-1 px-2 py-1 border border-accent2/30 text-accent2 text-[10px] tracking-wider uppercase hover:bg-accent2/5 transition-colors rounded disabled:opacity-50">
                      {importingId === item.id ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                      Import
                    </button>
                    {item.webUrl && (
                      <a href={item.webUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2 py-1 border border-border text-muted text-[10px] tracking-wider uppercase hover:bg-surface2 transition-colors rounded">
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
                            <li key={i} className="text-heading flex items-start gap-1"><span className="text-accent3 mt-0.5">·</span> {pt}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {files.length === 0 && <div className="border border-border px-4 py-6 text-xs text-muted text-center">No files in this location</div>}
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
            <button type="button" onClick={onClose} className="text-muted hover:text-heading transition-colors" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-px border-b border-border bg-border">
          {([
            { id: 'onenote', label: 'OneNote' },
            { id: 'onedrive', label: 'OneDrive' },
            { id: 'teams', label: 'Teams' },
          ] as { id: ActiveTab; label: string }[]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 bg-surface text-[11px] tracking-wider uppercase transition-colors ${
                activeTab === tab.id ? 'text-heading bg-surface2 font-medium' : 'text-muted hover:text-heading hover:bg-surface2'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'onenote' && (
            <OneNoteBrowser projectId={projectId} projectName={projectName} onImported={handleImported} />
          )}
          {activeTab === 'onedrive' && (
            <OneDriveBrowser projectId={projectId} projectName={projectName} onImported={handleImported} />
          )}
          {activeTab === 'teams' && (
            <TeamsBrowser projectId={projectId} projectName={projectName} onImported={handleImported} />
          )}
        </div>
      </div>
    </div>
  );
}
