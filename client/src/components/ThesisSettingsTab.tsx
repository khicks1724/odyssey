import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, FileText, Github, Loader2, Save, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getGitLabRepoPaths, type GitLabIntegrationConfig } from '../lib/gitlab';
import {
  deleteThesisRepoLink,
  fetchThesisSettings,
  saveThesisRepoLink,
  type ThesisRepoLink,
  type ThesisRepoProvider,
} from '../lib/thesis-paper';

interface ThesisSettingsTabProps {
  paperSnapshotUpdatedAt: number;
  linkedProjects: Array<{
    id: string;
    name: string;
  }>;
  workspaceFiles: Array<{
    id: string;
    path: string;
  }>;
}

type LinkedGitLabRepoOption = {
  id: string;
  projectId: string;
  projectName: string;
  host: string;
  repoPath: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not yet saved';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not yet saved';
  return parsed.toLocaleString();
}

function providerLabel(provider: ThesisRepoProvider) {
  return provider === 'github' ? 'GitHub' : 'GitLab';
}

function providerHint(provider: ThesisRepoProvider) {
  return provider === 'github'
    ? 'Use a GitHub PAT with repository contents write access.'
    : 'Use a GitLab PAT with repository write access.';
}

function normalizeFilePathList(paths: string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}

export default function ThesisSettingsTab({ paperSnapshotUpdatedAt, linkedProjects, workspaceFiles }: ThesisSettingsTabProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [documentUpdatedAt, setDocumentUpdatedAt] = useState<string | null>(null);
  const [repoSyncStatus, setRepoSyncStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [repoSyncError, setRepoSyncError] = useState<string | null>(null);
  const [repoSyncedAt, setRepoSyncedAt] = useState<string | null>(null);
  const [repoLink, setRepoLink] = useState<ThesisRepoLink | null>(null);
  const [provider, setProvider] = useState<ThesisRepoProvider>('github');
  const [repository, setRepository] = useState('');
  const [host, setHost] = useState('https://gitlab.com');
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [syncAllWorkspaceFiles, setSyncAllWorkspaceFiles] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [token, setToken] = useState('');
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [linkedGitLabRepos, setLinkedGitLabRepos] = useState<LinkedGitLabRepoOption[]>([]);
  const [linkedGitLabReposLoading, setLinkedGitLabReposLoading] = useState(false);
  const [linkedGitLabReposError, setLinkedGitLabReposError] = useState<string | null>(null);

  const workspaceDocumentPaths = useMemo(
    () => normalizeFilePathList(workspaceFiles.map((file) => file.path)),
    [workspaceFiles],
  );

  const syncTone = useMemo(() => {
    if (repoSyncStatus === 'saved') return 'text-accent2';
    if (repoSyncStatus === 'error') return 'text-danger';
    return 'text-muted';
  }, [repoSyncStatus]);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchThesisSettings();
      setDocumentUpdatedAt(payload.document?.updatedAt ?? null);
      setRepoSyncStatus(payload.document?.repoSyncStatus ?? 'idle');
      setRepoSyncError(payload.document?.repoSyncError ?? null);
      setRepoSyncedAt(payload.document?.repoSyncedAt ?? null);
      setRepoLink(payload.repoLink);

      if (payload.repoLink) {
        setProvider(payload.repoLink.provider);
        setRepository(payload.repoLink.repo);
        setHost(payload.repoLink.host ?? 'https://gitlab.com');
        setSelectedFilePaths(payload.repoLink.filePaths);
        setSyncAllWorkspaceFiles(payload.repoLink.syncAllWorkspaceFiles);
        setAutosaveEnabled(payload.repoLink.autosaveEnabled);
      } else {
        setSyncAllWorkspaceFiles(false);
        setSelectedFilePaths(workspaceDocumentPaths);
        setAutosaveEnabled(true);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load thesis settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!paperSnapshotUpdatedAt) return;
    const timeout = window.setTimeout(() => {
      void loadSettings();
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [paperSnapshotUpdatedAt]);

  useEffect(() => {
    let cancelled = false;

    const loadLinkedGitLabRepos = async () => {
      if (linkedProjects.length === 0) {
        setLinkedGitLabRepos([]);
        setLinkedGitLabReposError(null);
        return;
      }

      setLinkedGitLabReposLoading(true);
      setLinkedGitLabReposError(null);
      try {
        const { data, error: integrationError } = await supabase
          .from('integrations')
          .select('project_id, config')
          .in('project_id', linkedProjects.map((project) => project.id))
          .eq('type', 'gitlab');

        if (integrationError) throw integrationError;

        const projectNameById = new Map(linkedProjects.map((project) => [project.id, project.name]));
        const nextRepos = new Map<string, LinkedGitLabRepoOption>();

        for (const entry of data ?? []) {
          const projectId = typeof entry.project_id === 'string' ? entry.project_id : '';
          if (!projectId) continue;
          const config = entry.config as GitLabIntegrationConfig | null;
          const repoHost = config?.host?.trim().replace(/\/+$/, '') || 'https://gitlab.com';
          for (const repoPath of getGitLabRepoPaths(config)) {
            const normalizedRepoPath = repoPath.trim();
            if (!normalizedRepoPath) continue;
            const id = `${projectId}::${repoHost}::${normalizedRepoPath}`;
            nextRepos.set(id, {
              id,
              projectId,
              projectName: projectNameById.get(projectId) ?? 'Linked project',
              host: repoHost,
              repoPath: normalizedRepoPath,
            });
          }
        }

        if (!cancelled) {
          setLinkedGitLabRepos(
            [...nextRepos.values()].sort((left, right) => (
              left.projectName.localeCompare(right.projectName) || left.repoPath.localeCompare(right.repoPath)
            )),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setLinkedGitLabRepos([]);
          setLinkedGitLabReposError(loadError instanceof Error ? loadError.message : 'Failed to load linked GitLab repositories.');
        }
      } finally {
        if (!cancelled) setLinkedGitLabReposLoading(false);
      }
    };

    void loadLinkedGitLabRepos();

    return () => {
      cancelled = true;
    };
  }, [linkedProjects]);

  useEffect(() => {
    setSelectedFilePaths((current) => {
      const availableFileSet = new Set(workspaceDocumentPaths);
      const sanitizedCurrent = normalizeFilePathList(current.filter((path) => availableFileSet.has(path)));
      const savedPaths = normalizeFilePathList((repoLink?.filePaths ?? []).filter((path) => availableFileSet.has(path)));

      if (savedPaths.length > 0) return savedPaths;
      if (sanitizedCurrent.length > 0) return sanitizedCurrent;
      return workspaceDocumentPaths;
    });
  }, [workspaceDocumentPaths, repoLink?.filePaths, repoLink?.id, repoLink?.updatedAt]);

  const selectedLinkedGitLabRepoId = useMemo(() => {
    if (provider !== 'gitlab') return '';
    const normalizedHost = host.trim().replace(/\/+$/, '') || 'https://gitlab.com';
    const normalizedRepository = repository.trim();
    if (!normalizedRepository) return '';
    return linkedGitLabRepos.find((option) => (
      option.host === normalizedHost && option.repoPath === normalizedRepository
    ))?.id ?? '';
  }, [host, linkedGitLabRepos, provider, repository]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const nextFilePaths = normalizeFilePathList(selectedFilePaths);
      if (!syncAllWorkspaceFiles && nextFilePaths.length === 0) {
        throw new Error('Select at least one document from the thesis file explorer.');
      }

      const payload = await saveThesisRepoLink({
        provider,
        repository,
        host: provider === 'gitlab' ? host : null,
        filePaths: nextFilePaths,
        syncAllWorkspaceFiles,
        autosaveEnabled,
        token: token || null,
      });
      setRepoLink(payload.repoLink);
      setToken('');
      setSaveMessage('Repository autosave target saved.');
      await loadSettings();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save thesis repo settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    setSaveMessage(null);
    try {
      await deleteThesisRepoLink();
      setRepoLink(null);
      setRepository('');
      setSelectedFilePaths(workspaceDocumentPaths);
      setSyncAllWorkspaceFiles(false);
      setToken('');
      setSaveMessage('Repository autosave target removed.');
      await loadSettings();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to remove thesis repo settings.');
    } finally {
      setRemoving(false);
    }
  };

  const inputClass = 'w-full border border-border bg-surface2 px-4 py-2.5 text-sm text-heading placeholder:text-muted/60 focus:outline-none focus:border-accent/40';
  const selectedFileLabel = syncAllWorkspaceFiles
    ? workspaceDocumentPaths.length === 0
      ? 'All current and new explorer documents will sync automatically'
      : workspaceDocumentPaths.length === 1
      ? `${workspaceDocumentPaths[0]} and any new explorer files`
      : `${workspaceDocumentPaths.length} documents sync automatically`
    : selectedFilePaths.length === 0
      ? 'Select documents'
      : selectedFilePaths.length === 1
        ? selectedFilePaths[0]
        : `${selectedFilePaths.length} documents selected`;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 border border-border bg-surface px-6 py-16 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" />
        Loading thesis settings…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 xl:grid-cols-[0.85fr_1.15fr] gap-8">
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <ShieldCheck size={14} className="text-accent2" />
            <h2 className="font-sans text-sm font-bold text-heading">Thesis Autosave</h2>
          </div>

          <div className="space-y-4 text-sm">
            <div className="border border-border bg-surface2/50 p-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted mb-2">Odyssey Cloud Save</p>
              <p className="text-sm font-semibold text-heading">The LaTeX draft autosaves to the thesis workspace backend.</p>
              <p className="text-xs text-muted mt-2">Last successful backend save: {formatDateTime(documentUpdatedAt)}</p>
            </div>

            <div className="border border-border bg-surface2/50 p-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted mb-2">Repository Mirror</p>
              <p className={`text-sm font-semibold ${syncTone}`}>
                {repoSyncStatus === 'saved'
                  ? 'Repository mirror is healthy.'
                  : repoSyncStatus === 'error'
                    ? 'Repository autosave needs attention.'
                    : repoLink
                      ? 'Repository mirror is configured.'
                      : 'No repository mirror configured.'}
              </p>
              <p className="text-xs text-muted mt-2">
                {repoLink
                  ? `Last repo sync: ${formatDateTime(repoSyncedAt)}`
                  : 'Add a GitHub or GitLab target if you want Odyssey to keep a repository copy of your explorer documents.'}
              </p>
              {repoSyncError && (
                <p className="text-xs text-danger mt-3">{repoSyncError}</p>
              )}
            </div>
          </div>
        </div>

        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            {provider === 'github' ? <Github size={14} className="text-heading" /> : <Settings2 size={14} className="text-[#FC6D26]" />}
            <h2 className="font-sans text-sm font-bold text-heading">Repository Target</h2>
          </div>

          {repoLink && (
            <div className="mb-5 border border-accent/20 bg-accent/5 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-heading">{providerLabel(repoLink.provider)} · {repoLink.repo}</p>
                  <p className="text-xs text-muted mt-1">
                    {repoLink.provider === 'gitlab' && repoLink.host ? `${repoLink.host}/` : ''}
                    {repoLink.syncAllWorkspaceFiles
                      ? 'all explorer documents, including new files'
                      : repoLink.filePaths.length === 1
                      ? repoLink.filePaths[0]
                      : `${repoLink.filePaths.length} selected documents`} on the default branch
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-accent2">
                  <CheckCircle2 size={11} />
                  linked
                </span>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Provider</span>
                <select value={provider} onChange={(event) => setProvider(event.target.value as ThesisRepoProvider)} className={inputClass}>
                  <option value="github">GitHub</option>
                  <option value="gitlab">GitLab</option>
                </select>
              </label>

              {provider === 'gitlab' && (
                <label className="block">
                  <span className="mb-2 block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">GitLab Host</span>
                  <input value={host} onChange={(event) => setHost(event.target.value)} placeholder="https://gitlab.com" className={inputClass} />
                </label>
              )}
            </div>

            {provider === 'gitlab' && (
              <div className="space-y-2 border border-border bg-surface2/35 p-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Linked Project Repo</span>
                  <select
                    value={selectedLinkedGitLabRepoId}
                    onChange={(event) => {
                      const nextOption = linkedGitLabRepos.find((option) => option.id === event.target.value);
                      if (!nextOption) return;
                      setProvider('gitlab');
                      setHost(nextOption.host);
                      setRepository(nextOption.repoPath);
                    }}
                    className={inputClass}
                    disabled={linkedGitLabReposLoading || linkedGitLabRepos.length === 0}
                  >
                    <option value="">
                      {linkedGitLabReposLoading
                        ? 'Loading linked GitLab repos…'
                        : linkedGitLabRepos.length > 0
                          ? 'Choose a GitLab repo from a linked project'
                          : 'No GitLab repos found on linked thesis projects'}
                    </option>
                    {linkedGitLabRepos.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.projectName} · {option.repoPath}
                      </option>
                    ))}
                  </select>
                </label>

                {linkedGitLabReposError ? (
                  <p className="text-xs text-danger">{linkedGitLabReposError}</p>
                ) : linkedGitLabRepos.length > 0 ? (
                  <p className="text-xs text-muted">Selecting a linked project repo fills the GitLab host and repository fields below.</p>
                ) : (
                  <p className="text-xs text-muted">Link a project with a GitLab integration to surface its repositories here.</p>
                )}
              </div>
            )}

            <label className="block">
              <span className="mb-2 block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Repository</span>
              <input
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder={provider === 'github' ? 'owner/repo or https://github.com/owner/repo' : 'https://gitlab.example.com/group/project or group/project'}
                className={inputClass}
              />
            </label>

            <div className="border border-border bg-surface2/35">
              <button
                type="button"
                onClick={() => setFilePickerOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <span className="mb-1 block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">Documents</span>
                  <span className="block truncate text-sm text-heading">{selectedFileLabel}</span>
                </div>
                <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${filePickerOpen ? 'rotate-180' : ''}`} />
              </button>

              {filePickerOpen && (
                <div className="border-t border-border px-4 py-3">
                  {workspaceDocumentPaths.length > 0 ? (
                    <>
                      <p className="mb-3 text-xs text-muted">Choose which explorer documents should be mirrored into the repository, or enable automatic inclusion for new files created later.</p>
                      <label className="mb-3 flex items-center gap-3 border border-border bg-surface2/40 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={syncAllWorkspaceFiles}
                          onChange={(event) => setSyncAllWorkspaceFiles(event.target.checked)}
                        />
                        <span className="text-sm text-heading">Automatically include all current and new explorer files in this sync target.</span>
                      </label>
                      <div className="mb-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedFilePaths(workspaceDocumentPaths)}
                          disabled={syncAllWorkspaceFiles}
                          className="border border-border px-2.5 py-1 text-[11px] font-medium text-heading transition-colors hover:border-accent/40 hover:text-accent"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedFilePaths([])}
                          disabled={syncAllWorkspaceFiles}
                          className="border border-border px-2.5 py-1 text-[11px] font-medium text-heading transition-colors hover:border-accent/40 hover:text-accent"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="space-y-2">
                        {workspaceDocumentPaths.map((path) => {
                          const checked = selectedFilePaths.includes(path);
                          return (
                            <label key={path} className="flex items-start gap-3 border border-border/70 bg-surface px-3 py-2 text-sm text-heading">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={syncAllWorkspaceFiles}
                                onChange={(event) => {
                                  setSelectedFilePaths((current) => (
                                    event.target.checked
                                      ? normalizeFilePathList([...current, path])
                                      : current.filter((value) => value !== path)
                                  ));
                                }}
                                className="mt-1"
                              />
                              <span className="flex min-w-0 items-center gap-2">
                                <FileText size={14} className="shrink-0 text-muted" />
                                <span className="truncate">{path}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted">No documents are available in the thesis file explorer yet.</p>
                  )}
                </div>
              )}
            </div>

            <label className="block">
              <span className="mb-2 block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                Personal Access Token {repoLink?.tokenSaved ? <span className="normal-case text-accent2">(saved, enter a new token to replace it)</span> : null}
              </span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={repoLink?.tokenSaved ? '••••••••••••••••' : provider === 'github' ? 'GitHub PAT' : 'GitLab PAT'}
                className={inputClass}
              />
              <p className="mt-2 text-[11px] text-muted">{providerHint(provider)}</p>
            </label>

            <label className="flex items-center gap-3 border border-border bg-surface2/40 px-4 py-3">
              <input type="checkbox" checked={autosaveEnabled} onChange={(event) => setAutosaveEnabled(event.target.checked)} />
              <span className="text-sm text-heading">Mirror each autosave to this repository target.</span>
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}
            {saveMessage && <p className="text-sm text-accent2">{saveMessage}</p>}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || removing || !repository.trim() || (!syncAllWorkspaceFiles && selectedFilePaths.length === 0)}
                className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save Repo Target
              </button>

              {repoLink && (
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={saving || removing}
                  className="inline-flex items-center gap-2 border border-danger/30 bg-danger/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                >
                  {removing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Remove Target
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
