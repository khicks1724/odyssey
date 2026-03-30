import React from 'react';
import {
  Users,
  UserPlus,
  Github,
  Sparkles,
  Plus,
  Trash2,
  Clock,
  Search,
  Link,
  Loader2,
  CheckCircle,
  X,
  Settings,
  Folder,
  ClipboardList,
  ChevronRight,
  Pencil,
  RefreshCw,
  Download,
  Table,
  Copy,
  Lock,
  Globe,
  LogOut,
  FileText,
  Check,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import LabelColorPicker from '../LabelColorPicker';
import { generateProjectCode, sanitizeProjectCode, PROJECT_CODE_LENGTH } from '../../lib/project-code';
import { DEFAULT_PROMPTS } from '../../lib/defaultPrompts';
import { PROMPT_LABELS, type PromptFeature } from '../../hooks/useProjectPrompts';
import { supabase } from '../../lib/supabase';
import { fetchOneDriveFiles, useMicrosoftIntegration } from '../../hooks/useMicrosoftIntegration';
import type { OdysseyEvent } from '../../types';

interface MemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  profile?: { display_name: string | null; avatar_url: string | null; email?: string | null };
}

interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
  github_id: number;
}

interface JoinRequest {
  id: string;
  user_id: string;
  created_at: string;
  profile?: { display_name: string | null; avatar_url: string | null } | null;
}

// ── GitLab repo section ───────────────────────────────────────────────────────
function GitLabSection({ projectId, onReposChanged }: { projectId: string; onReposChanged?: (repos: string[]) => void }) {
  const [linkedRepos, setLinkedRepos] = React.useState<string[]>([]);
  const [repoInput, setRepoInput] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle()
      .then(({ data }) => {
        if (data?.config) {
          const cfg = data.config as { repos?: string[]; repo?: string };
          setLinkedRepos(cfg.repos ?? (cfg.repo ? [cfg.repo] : []));
        }
      });
  }, [projectId]);

  const handleLink = async () => {
    const raw = repoInput.trim();
    if (!raw) return;
    const path = raw.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '');
    if (linkedRepos.includes(path)) { setError('This repo is already linked.'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Not signed in — please refresh.'); return; }
      const res = await fetch('/api/gitlab/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId, repo: path }),
      });
      const data = await res.json() as { repos?: string[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to link repo');
      } else {
        const updated = data.repos ?? [...linkedRepos, path];
        setLinkedRepos(updated);
        setRepoInput('');
        onReposChanged?.(updated);
      }
    } catch {
      setError('Network error — check server is running');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async (repo: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/gitlab/link?projectId=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json() as { repos?: string[] };
      const updated = data.repos ?? linkedRepos.filter((r) => r !== repo);
      setLinkedRepos(updated);
      onReposChanged?.(updated);
    } catch { /* ignore */ }
  };

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-6">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className="text-[#FC6D26]">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51 1.22 3.78a.84.84 0 01-.3.92z"/>
        </svg>
        <h3 className="font-sans text-sm font-bold text-heading">GitLab Repositories</h3>
        <span className="text-[9px] px-1.5 py-0.5 border border-border text-muted rounded font-mono">NPS</span>
        {linkedRepos.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#FC6D26]/10 text-[#FC6D26] rounded font-mono">{linkedRepos.length} linked</span>
        )}
      </div>

      {linkedRepos.length > 0 && (
        <div className="space-y-2 mb-5">
          {linkedRepos.map((repo) => (
            <div key={repo} className="flex items-center gap-3 p-3 border border-[#FC6D26]/20 bg-[#FC6D26]/5 rounded">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading font-mono truncate">{repo}</div>
              </div>
              <button type="button" onClick={() => handleUnlink(repo)}
                className="px-2.5 py-1 border border-danger/30 text-danger text-[10px] tracking-wider uppercase hover:bg-danger/5 transition-colors rounded shrink-0">
                Disconnect
              </button>
            </div>
          ))}
          <p className="text-[11px] text-muted">Commits and READMEs from all repos are included in AI insights and chat context.</p>
        </div>
      )}

      <div className="space-y-3">
        {linkedRepos.length === 0 && (
          <p className="text-xs text-muted">Link your NPS GitLab repositories. Paste a full URL or project path.</p>
        )}
        <div className="flex gap-2 max-w-lg">
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLink()}
            placeholder="group/project-name or full URL"
            title="GitLab repository path or URL"
            className="flex-1 px-4 py-2.5 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-[#FC6D26]/50 transition-colors rounded"
          />
          <button type="button" onClick={handleLink} disabled={saving || !repoInput.trim()}
            className="px-4 py-2.5 bg-[#FC6D26]/10 border border-[#FC6D26]/30 text-[#FC6D26] text-xs font-semibold tracking-wider uppercase hover:bg-[#FC6D26]/20 transition-colors rounded disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
            {linkedRepos.length > 0 ? 'Add' : 'Connect'}
          </button>
        </div>
        {error && <p className="text-xs text-danger font-mono">{error}</p>}
        <p className="text-[10px] text-muted">Must be on the NPS network or VPN for the server to reach gitlab.nps.edu</p>
      </div>
    </div>
  );
}

// ── Project name / description editor ─────────────────────────────────────────
function ProjectNameForm({
  project,
  updateProject,
  isOwner,
}: {
  project: { name: string; description?: string | null; start_date?: string | null; invite_code?: string | null };
  updateProject: (updates: { name?: string; description?: string; start_date?: string | null; invite_code?: string }) => Promise<unknown>;
  isOwner: boolean;
}) {
  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description ?? '');
  const [startDate, setStartDate] = React.useState(project.start_date ?? '');
  const [inviteCode, setInviteCode] = React.useState(project.invite_code ?? '');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [copiedInviteCode, setCopiedInviteCode] = React.useState(false);

  const dirty = name.trim() !== project.name
    || description.trim() !== (project.description ?? '')
    || startDate !== (project.start_date ?? '')
    || (isOwner && inviteCode !== (project.invite_code ?? ''));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await updateProject({
      name: name.trim(),
      description: description.trim() || undefined,
      start_date: startDate || null,
      invite_code: isOwner ? inviteCode : undefined,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopyInviteCode = async () => {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setCopiedInviteCode(true);
    setTimeout(() => setCopiedInviteCode(false), 1600);
  };

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings size={14} className="text-heading" />
        <h3 className="font-sans text-sm font-bold text-heading">Project Details</h3>
      </div>
      <form onSubmit={handleSave}>
        <div className="flex flex-col xl:flex-row gap-5 items-start">
          <div className="flex flex-col gap-3 w-full xl:w-[26rem] shrink-0">
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                title="Project name"
                placeholder="Project name"
                className="w-full px-3 py-2 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                title="Project start date"
                className="w-full px-3 py-2 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
              />
            </div>
            {isOwner && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-3">
                    <label className="block text-[10px] tracking-[0.2em] uppercase text-muted">Project ID Code</label>
                    <button
                      type="button"
                      onClick={() => setInviteCode(generateProjectCode())}
                      className="text-[10px] font-mono text-accent hover:underline"
                    >
                      Generate
                    </button>
                  </div>
                </div>
                <div className="flex items-stretch gap-2">
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(sanitizeProjectCode(e.target.value))}
                    title="Project ID code"
                    placeholder="Project ID code"
                    className="min-w-0 flex-1 px-3 py-2 bg-surface border border-border text-heading text-sm font-mono tracking-[0.12em] uppercase focus:outline-none focus:border-accent/50 transition-colors rounded"
                  />
                  {inviteCode.trim() && (
                    <button
                      type="button"
                      onClick={handleCopyInviteCode}
                      title="Copy project ID code"
                      className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded"
                    >
                      {copiedInviteCode ? <Check size={11} className="text-accent2" /> : <Copy size={11} />}
                      <span>{copiedInviteCode ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted">
                  {PROJECT_CODE_LENGTH}-character join code. Changing it invalidates the old code immediately.
                </p>
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={7}
              placeholder="What is this project about?"
              className="w-full px-3 py-2 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded resize-none"
            />
          </div>
        </div>
        <div className="mt-3">
          <button
            type="submit"
            disabled={saving || !dirty || !name.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle size={12} /> : null}
            {saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Teams folder picker modal ─────────────────────────────────────────────────
function TeamsFolderPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (folder: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = React.useState<Array<{ id: string; name: string; folder?: unknown; lastModifiedDateTime: string }>>([]);
  const [folderStack, setFolderStack] = React.useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const current = folderStack[folderStack.length - 1];
    setLoading(true);
    fetchOneDriveFiles({ folderId: current?.id }).then((data) => {
      setFiles(data as Array<{ id: string; name: string; folder?: unknown; lastModifiedDateTime: string }>);
      setLoading(false);
    });
  }, [folderStack]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border w-full max-w-lg max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-sans text-sm font-bold text-heading">Select OneDrive / Teams Folder</h2>
            <p className="text-[11px] text-muted font-mono">Choose a folder to link to this project</p>
          </div>
          <button type="button" onClick={onClose} title="Close" className="text-muted hover:text-heading">
            <X size={16} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-border text-[11px] text-muted font-mono">
          <button type="button" onClick={() => setFolderStack([])} className="hover:text-heading">My Drive</button>
          {folderStack.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight size={10} />
              <button type="button" onClick={() => setFolderStack((p) => p.slice(0, i + 1))} className="hover:text-heading">
                {f.name}
              </button>
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-px bg-border">
          {loading ? (
            <div className="bg-surface flex items-center gap-2 p-4 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {folderStack.length > 0 && (
                <div className="bg-surface px-4 py-2 flex items-center justify-between mb-2 border border-accent/20">
                  <span className="text-xs text-accent font-medium">
                    Link "{folderStack[folderStack.length - 1].name}"
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelect(folderStack[folderStack.length - 1])}
                    className="px-3 py-1 border border-accent/30 text-accent text-[10px] tracking-wider uppercase hover:bg-accent/5 rounded"
                  >
                    Select this folder
                  </button>
                </div>
              )}
              {files.filter((f) => !!f.folder).map((item) => (
                <div key={item.id} className="bg-surface flex items-center gap-3 px-4 py-3 hover:bg-surface2 cursor-pointer group"
                  onClick={() => setFolderStack((p) => [...p, { id: item.id, name: item.name }])}
                >
                  <Folder size={13} className="text-accent shrink-0" />
                  <span className="text-xs text-heading flex-1 truncate">{item.name}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSelect({ id: item.id, name: item.name }); }}
                    className="opacity-0 group-hover:opacity-100 px-2 py-0.5 border border-accent/30 text-accent text-[10px] tracking-wider uppercase hover:bg-accent/5 rounded transition-opacity"
                  >
                    Link
                  </button>
                  <ChevronRight size={12} className="text-muted" />
                </div>
              ))}
              {files.filter((f) => !!f.folder).length === 0 && (
                <div className="bg-surface px-4 py-6 text-center text-xs text-muted">No folders here</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export interface SettingsTabProps {
  project: {
    id: string;
    name: string;
    description?: string | null;
    github_repo?: string | null;
    is_private?: boolean;
    invite_code?: string | null;
    start_date?: string | null;
    image_url?: string | null;
  };
  projectId: string;
  isOwner: boolean;
  members: MemberRow[];
  user: { id?: string; user_metadata?: { user_name?: string; avatar_url?: string; email?: string }; email?: string } | null;
  joinRequests: JoinRequest[];
  respondJoinRequest: (id: string, action: 'approve' | 'deny') => Promise<unknown>;
  refetchJoinRequests: () => void;
  inviteRole: 'member' | 'owner';
  setInviteRole: React.Dispatch<React.SetStateAction<'member' | 'owner'>>;
  inviteTab: 'github' | 'email' | 'qr';
  setInviteTab: React.Dispatch<React.SetStateAction<'github' | 'email' | 'qr'>>;
  memberSearch: string;
  setMemberSearch: React.Dispatch<React.SetStateAction<string>>;
  memberResults: GitHubUser[];
  memberSearching: boolean;
  inviting: string | null;
  copySuccess: boolean;
  teamsFolder: { id: string; name: string } | null;
  setTeamsFolder: React.Dispatch<React.SetStateAction<{ id: string; name: string } | null>>;
  teamsFolderPickerOpen: boolean;
  setTeamsFolderPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  teamsFolderSaving: boolean;
  setTeamsFolderSaving: React.Dispatch<React.SetStateAction<boolean>>;
  repoInput: string;
  setRepoInput: React.Dispatch<React.SetStateAction<string>>;
  repoSaving: boolean;
  scanResults: { completed: string[]; suggested: { title: string; reason: string }[] } | null;
  events: OdysseyEvent[];
  auditFrom: string;
  setAuditFrom: React.Dispatch<React.SetStateAction<string>>;
  auditTo: string;
  setAuditTo: React.Dispatch<React.SetStateAction<string>>;
  auditPreset: '2W' | '1M' | '3M' | '6M' | 'Full' | 'custom';
  setAuditPreset: React.Dispatch<React.SetStateAction<'2W' | '1M' | '3M' | '6M' | 'Full' | 'custom'>>;
  auditType: string;
  setAuditType: React.Dispatch<React.SetStateAction<string>>;
  auditPage: number;
  setAuditPage: React.Dispatch<React.SetStateAction<number>>;
  AUDIT_PAGE_SIZE: number;
  imageUploading: boolean;
  newLabelName: string;
  setNewLabelName: React.Dispatch<React.SetStateAction<string>>;
  newLabelColor: string;
  setNewLabelColor: React.Dispatch<React.SetStateAction<string>>;
  newLabelType: 'category' | 'loe';
  setNewLabelType: React.Dispatch<React.SetStateAction<'category' | 'loe'>>;
  projectLabels: { id: string; name: string; color: string; type: 'category' | 'loe' }[];
  editPromptFeature: PromptFeature | null;
  setEditPromptFeature: React.Dispatch<React.SetStateAction<PromptFeature | null>>;
  editPromptText: string;
  setEditPromptText: React.Dispatch<React.SetStateAction<string>>;
  resetPromptsTyped: string;
  setResetPromptsTyped: React.Dispatch<React.SetStateAction<string>>;
  resetPromptsModalOpen: boolean;
  setResetPromptsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  deletingProject: boolean;
  leavingProject: boolean;
  goals: { id: string; title: string }[];
  updateProject: (updates: Record<string, unknown>) => Promise<unknown>;
  updateGoal: (id: string, updates: Record<string, unknown>) => Promise<unknown>;
  createGoal: (data: { title: string }) => Promise<unknown>;
  handleCopyInviteCode: () => void;
  handleSaveRepo: () => void;
  handleRepoScan: () => void;
  scanLoading: boolean;
  handleMemberSearch: () => void;
  handleInviteMember: (ghUser: GitHubUser) => void;
  handleRemoveMember: (userId: string) => void;
  handleImageUpload: (file: File, inputEl?: HTMLInputElement | null) => void;
  handleExportAuditCSV: () => void;
  addLabel: (type: 'category' | 'loe', name: string, color: string) => void;
  deleteLabel: (id: string) => void;
  getPrompt: (feature: PromptFeature) => string | null | undefined;
  savePrompt: (feature: PromptFeature, text: string) => void;
  resetPrompt: (feature: PromptFeature) => void;
  resetAllPrompts: () => void;
  setDeleteModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGitlabRepos: React.Dispatch<React.SetStateAction<string[]>>;
}

function SettingsTab({
  project,
  projectId,
  isOwner,
  members,
  user,
  joinRequests,
  respondJoinRequest,
  refetchJoinRequests,
  inviteRole,
  setInviteRole,
  inviteTab,
  setInviteTab,
  memberSearch,
  setMemberSearch,
  memberResults,
  memberSearching,
  inviting,
  copySuccess,
  teamsFolder,
  setTeamsFolder,
  teamsFolderPickerOpen,
  setTeamsFolderPickerOpen,
  teamsFolderSaving,
  setTeamsFolderSaving,
  repoInput,
  setRepoInput,
  repoSaving,
  scanResults,
  events,
  auditFrom,
  setAuditFrom,
  auditTo,
  setAuditTo,
  auditPreset,
  setAuditPreset,
  auditType,
  setAuditType,
  auditPage,
  setAuditPage,
  AUDIT_PAGE_SIZE,
  imageUploading,
  newLabelName,
  setNewLabelName,
  newLabelColor,
  setNewLabelColor,
  newLabelType,
  setNewLabelType,
  projectLabels,
  editPromptFeature,
  setEditPromptFeature,
  editPromptText,
  setEditPromptText,
  resetPromptsTyped,
  setResetPromptsTyped,
  resetPromptsModalOpen,
  setResetPromptsModalOpen,
  deletingProject,
  leavingProject,
  goals,
  updateProject,
  updateGoal,
  createGoal,
  handleCopyInviteCode,
  handleSaveRepo,
  handleRepoScan,
  scanLoading,
  handleMemberSearch,
  handleInviteMember,
  handleRemoveMember,
  handleImageUpload,
  handleExportAuditCSV,
  addLabel,
  deleteLabel,
  getPrompt,
  savePrompt,
  resetPrompt,
  resetAllPrompts,
  setDeleteModalOpen,
  setGitlabRepos,
}: SettingsTabProps) {
  const { status: msStatus } = useMicrosoftIntegration();

  return (
    <div className="space-y-8">

      {/* Project ID Code + Privacy — owners only */}
      {isOwner && project?.invite_code && (
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Lock size={14} className="text-accent" />
              <h3 className="font-sans text-sm font-bold text-heading">Project Access</h3>
            </div>
            {/* Public / Private toggle */}
            <div className="flex items-center gap-1 border border-border rounded overflow-hidden">
              <button
                type="button"
                onClick={() => updateProject({ is_private: false })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase transition-colors ${!project.is_private ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}
              >
                <Globe size={10} />
                Public
              </button>
              <button
                type="button"
                onClick={() => updateProject({ is_private: true })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase transition-colors ${project.is_private ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}
              >
                <Lock size={10} />
                Private
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted mb-4">
            {project.is_private
              ? 'Private — join requests require owner approval before access is granted.'
              : 'Public — anyone with the project ID code can join instantly.'}
          </p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted mb-1">Project ID Code</p>
              <span className="font-mono text-lg font-bold text-heading tracking-widest">
                {project.invite_code}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopyInviteCode}
              title="Copy project ID code"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded"
            >
              {copySuccess ? <Check size={11} className="text-accent2" /> : <Copy size={11} />}
              {copySuccess ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Team Members + Invite Members to Project — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Team Members — always show current user */}
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-6">
            <Users size={14} className="text-accent2" />
            <h3 className="font-sans text-sm font-bold text-heading">
              Team Members ({1 + members.filter((m) => m.user_id !== user?.id).length})
            </h3>
          </div>
          <div className="space-y-px border border-border bg-border">
            {/* Current user — always rendered first */}
            {user && (() => {
              const myRow = members.find((m) => m.user_id === user.id);
              const myRole = myRow?.role ?? (isOwner ? 'owner' : 'member');
              const myName = user.user_metadata?.user_name ?? user.email ?? 'You';
              const myAvatar = user.user_metadata?.avatar_url ?? null;
              return (
                <div className="flex items-center gap-3 bg-surface px-4 py-3">
                  {myAvatar
                    ? <img src={myAvatar} alt="" className="w-7 h-7 rounded-full" />
                    : <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center"><span className="text-[10px] text-accent font-bold uppercase">{myName[0]}</span></div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium truncate">
                      {myName} <span className="ml-1 text-[9px] text-muted">(you)</span>
                    </div>
                    <div className="text-[10px] text-muted capitalize">{myRole}</div>
                  </div>
                </div>
              );
            })()}
            {/* Other members from DB */}
            {members.filter((m) => m.user_id !== user?.id).map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 bg-surface px-4 py-3 group">
                {m.profile?.avatar_url
                  ? <img src={m.profile.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                  : <div className="w-7 h-7 rounded-full bg-accent2/20 flex items-center justify-center"><span className="text-[10px] text-accent2 font-bold uppercase">{(m.profile?.display_name ?? '?')[0]}</span></div>
                }
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium truncate">{m.profile?.display_name ?? m.user_id}</div>
                  <div className="text-[10px] text-muted capitalize">{m.role}</div>
                </div>
                {isOwner && (
                  <button type="button" onClick={() => handleRemoveMember(m.user_id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger transition-all" title="Remove member">
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Invite Members to Project */}
        {isOwner ? (
          <div className="border border-border bg-surface p-6">
            <div className="flex items-center gap-2 mb-5">
              <UserPlus size={14} className="text-accent" />
              <h3 className="font-sans text-sm font-bold text-heading">Invite Members to Project</h3>
            </div>

            {/* Invite tabs */}
            <div className="flex items-center gap-px border border-border rounded overflow-hidden mb-5 w-fit">
              {(['github', 'email', 'qr'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setInviteTab(tab)}
                  className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase transition-colors ${inviteTab === tab ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}>
                  {tab === 'github' ? 'GitHub' : tab === 'email' ? 'Email' : 'QR Code'}
                </button>
              ))}
            </div>

            {inviteTab === 'github' && (
              <div>
                <p className="text-[11px] text-muted mb-4">
                  Search by GitHub username — they must have signed into Odyssey at least once.
                </p>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[10px] tracking-[0.15em] uppercase text-muted">Invite as</span>
                  <div className="flex items-center gap-px border border-border rounded overflow-hidden">
                    {(['member', 'owner'] as const).map((r) => (
                      <button key={r} type="button" onClick={() => setInviteRole(r)}
                        className={`px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors ${inviteRole === r ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 mb-4">
                  <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleMemberSearch()}
                    placeholder="GitHub username…"
                    className="flex-1 px-3 py-2 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded" />
                  <button type="button" onClick={handleMemberSearch}
                    disabled={memberSearching || memberSearch.trim().length < 2}
                    className="px-3 py-2 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded disabled:opacity-50 flex items-center gap-1.5">
                    {memberSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    Search
                  </button>
                </div>
                {memberResults.length > 0 && (
                  <div className="space-y-px border border-border bg-border">
                    {memberResults.map((u) => (
                      <div key={u.login} className="flex items-center gap-3 bg-surface px-4 py-2.5">
                        <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                        <div className="flex-1 min-w-0">
                          <a href={u.html_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-heading font-medium hover:text-accent transition-colors">{u.login}</a>
                        </div>
                        <button type="button" onClick={() => handleInviteMember(u)} disabled={inviting === u.login}
                          className="text-[10px] px-3 py-1 border border-accent/30 text-accent hover:bg-accent/10 transition-colors rounded disabled:opacity-50 flex items-center gap-1.5">
                          {inviting === u.login ? <Loader2 size={10} className="animate-spin" /> : <UserPlus size={10} />}
                          {inviting === u.login ? 'Adding…' : `Add as ${inviteRole}`}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {inviteTab === 'email' && (
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-center border border-dashed border-border rounded">
                <span className="text-[11px] text-muted">Email invites — coming soon.</span>
                <span className="text-[10px] text-muted/60">Users will receive a link to join directly.</span>
              </div>
            )}

            {inviteTab === 'qr' && projectId && project?.invite_code && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-[11px] text-muted text-center">
                  Share this QR code. Anyone who scans it and authenticates with GitHub will be added
                  {project.is_private ? ' pending owner approval' : ' instantly'}.
                </p>
                <div className="p-4 bg-white rounded-xl shadow-lg">
                  <QRCodeSVG
                    value={`${window.location.origin}/join?code=${project.invite_code}`}
                    size={180}
                    level="H"
                    includeMargin={false}
                    imageSettings={{
                      src: '/favicon.ico',
                      height: 32,
                      width: 32,
                      excavate: true,
                    }}
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-xs text-heading tracking-widest">{project.invite_code}</span>
                  <span className="text-[10px] text-muted">Regenerate the code in Project Details to invalidate this QR</span>
                </div>
              </div>
            )}

            {inviteTab === 'qr' && (!project?.invite_code) && (
              <p className="text-[11px] text-muted text-center py-6">
                Generate an Invite Code in Project Details first to enable QR sharing.
              </p>
            )}
          </div>
        ) : (
          <div className="border border-border bg-surface p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[140px]">
            <Users size={24} className="text-muted/30" />
            <p className="text-xs text-muted">Only project owners can invite new members.</p>
          </div>
        )}
      </div>

      {/* Join Requests — owners only, shown when there are pending requests */}
      {isOwner && joinRequests.length > 0 && (
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={14} className="text-accent2" />
            <h3 className="font-sans text-sm font-bold text-heading">
              Join Requests
              <span className="ml-2 text-[10px] font-mono bg-accent2/10 text-accent2 px-1.5 py-0.5 rounded">
                {joinRequests.length}
              </span>
            </h3>
          </div>
          <div className="space-y-px border border-border bg-border">
            {joinRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                {req.profile?.avatar_url ? (
                  <img src={req.profile.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-accent2/20 flex items-center justify-center">
                    <span className="text-[10px] text-accent2 font-bold uppercase">
                      {(req.profile?.display_name ?? '?')[0]}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium truncate">
                    {req.profile?.display_name ?? req.user_id}
                  </div>
                  <div className="text-[10px] text-muted">
                    {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => respondJoinRequest(req.id, 'approve').then(() => refetchJoinRequests())}
                    className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold border border-accent2/30 text-accent2 hover:bg-accent2/10 transition-colors rounded"
                  >
                    <Check size={10} />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => respondJoinRequest(req.id, 'deny').then(() => refetchJoinRequests())}
                    className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold border border-border text-muted hover:text-danger hover:border-danger/30 transition-colors rounded"
                  >
                    <X size={10} />
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project Name & Description */}
      <ProjectNameForm project={project} updateProject={updateProject} isOwner={isOwner} />

      {/* Microsoft 365 / Teams Folder */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-6">
          <Link size={14} className="text-heading" />
          <h3 className="font-sans text-sm font-bold text-heading">Microsoft 365 / Teams Folder</h3>
        </div>
        <p className="text-xs text-muted mb-5">
          Link a OneDrive or Teams channel folder. Files from this folder will be included in AI insights generation.
        </p>

        {teamsFolder ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 border border-accent/20 bg-accent/5 rounded">
              <Folder size={18} className="text-accent" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-heading font-medium truncate">{teamsFolder.name}</div>
                <div className="text-[10px] text-muted mt-0.5">Linked OneDrive folder</div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await supabase.from('integrations').delete()
                    .eq('project_id', projectId!).eq('type', 'teams');
                  setTeamsFolder(null);
                }}
                className="px-3 py-1.5 border border-danger/30 text-danger text-[10px] tracking-wider uppercase hover:bg-danger/5 transition-colors rounded"
              >
                Unlink
              </button>
            </div>
            <button
              type="button"
              onClick={() => setTeamsFolderPickerOpen(true)}
              className="text-xs text-accent hover:underline"
            >
              Change folder →
            </button>
          </div>
        ) : msStatus?.connected ? (
          <button
            type="button"
            onClick={() => setTeamsFolderPickerOpen(true)}
            disabled={teamsFolderSaving}
            className="flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md disabled:opacity-50"
          >
            {teamsFolderSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Select Folder
          </button>
        ) : (
          <p className="text-xs text-muted">
            Connect your Microsoft 365 account in{' '}
            <a href="/settings" className="text-accent hover:underline">Settings</a>{' '}
            first, then come back to link a folder.
          </p>
        )}
      </div>

      {/* GitHub Repository */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-6">
          <Github size={14} className="text-heading" />
          <h3 className="font-sans text-sm font-bold text-heading">GitHub Repository</h3>
        </div>

        {project.github_repo ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 border border-accent/20 bg-accent/5 rounded">
              <Github size={18} className="text-accent" />
              <div className="flex-1 min-w-0">
                <a
                  href={`https://github.com/${project.github_repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline font-mono"
                >
                  {project.github_repo}
                </a>
                <div className="text-[10px] text-muted mt-0.5">Connected repository</div>
              </div>
              <button
                type="button"
                onClick={() => updateProject({ github_repo: null })}
                className="px-3 py-1.5 border border-danger/30 text-danger text-[10px] tracking-wider uppercase hover:bg-danger/5 transition-colors rounded"
              >
                Disconnect
              </button>
            </div>

            {scanResults && (
              <div className="space-y-3 mt-4 border-t border-border pt-4">
                {scanResults.completed.length > 0 && (
                  <div>
                    <h4 className="text-[10px] tracking-[0.15em] uppercase text-accent3 mb-2">Goals likely completed</h4>
                    <div className="space-y-1">
                      {scanResults.completed.map((id) => {
                        const g = goals.find((gl) => gl.id === id);
                        return g ? (
                          <div key={id} className="flex items-center gap-2 text-xs text-heading p-2 bg-accent3/5 rounded">
                            <CheckCircle size={12} className="text-accent3" />
                            <span>{g.title}</span>
                            <button
                              type="button"
                              onClick={() => updateGoal(id, { status: 'complete', progress: 100 })}
                              className="ml-auto text-[10px] text-accent3 hover:underline"
                            >
                              Mark complete
                            </button>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
                {scanResults.suggested.length > 0 && (
                  <div>
                    <h4 className="text-[10px] tracking-[0.15em] uppercase text-accent2 mb-2">Suggested new goals</h4>
                    <div className="space-y-1">
                      {scanResults.suggested.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-heading p-2 bg-accent2/5 rounded">
                          <Plus size={12} className="text-accent2" />
                          <div className="flex-1">
                            <span>{s.title}</span>
                            <span className="text-[10px] text-muted ml-2">— {s.reason}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => createGoal({ title: s.title })}
                            className="text-[10px] text-accent2 hover:underline"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Connect a GitHub repository to enable AI-powered goal analysis and activity tracking.
            </p>
            <div className="flex gap-2 max-w-md">
              <input
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className="flex-1 px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
              />
              <button
                type="button"
                onClick={handleSaveRepo}
                disabled={repoSaving || !repoInput.trim()}
                className="px-4 py-3 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded disabled:opacity-50 flex items-center gap-2"
              >
                {repoSaving ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
                Connect
              </button>
            </div>
          </div>
        )}
      </div>

      {/* GitLab Repository */}
      <GitLabSection projectId={projectId!} onReposChanged={(repos) => setGitlabRepos(repos)} />

      {/* Audit Log */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ClipboardList size={14} className="text-heading" />
            <h3 className="font-sans text-sm font-bold text-heading">Audit Log</h3>
            <span className="text-[10px] text-muted font-mono">({events.length} events)</span>
          </div>
          <button
            type="button"
            onClick={handleExportAuditCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted text-xs hover:text-heading hover:bg-surface2 transition-colors rounded font-mono"
          >
            <Download size={11} /> Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <input
            type="date"
            value={auditFrom}
            onChange={(e) => { setAuditFrom(e.target.value); setAuditPreset('custom'); }}
            title="From date"
            className="px-2 py-1 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
          />
          <span className="text-[10px] text-muted">to</span>
          <input
            type="date"
            value={auditTo}
            onChange={(e) => { setAuditTo(e.target.value); setAuditPreset('custom'); }}
            title="To date"
            className="px-2 py-1 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
          />
          {/* Presets */}
          {((['2W', '1M', '3M', '6M', 'Full'] as const).map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                const fmt = (d: Date) => d.toISOString().split('T')[0];
                const to = new Date();
                const from = new Date();
                if (label === '2W')        from.setDate(from.getDate() - 14);
                else if (label === '1M')   from.setMonth(from.getMonth() - 1);
                else if (label === '3M')   from.setMonth(from.getMonth() - 3);
                else if (label === '6M')   from.setMonth(from.getMonth() - 6);
                else if (label === 'Full') { setAuditFrom(project?.start_date ?? fmt(from)); setAuditTo(fmt(to)); setAuditPreset('Full'); return; }
                setAuditFrom(fmt(from));
                setAuditTo(fmt(to));
                setAuditPreset(label);
              }}
              className={`px-2.5 py-1 text-[10px] border rounded transition-colors font-mono ${
                auditPreset === label
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                  : 'border-border text-muted hover:text-heading hover:bg-surface2'
              }`}
            >
              {label}
            </button>
          )))}
          <button
            type="button"
            onClick={() => setAuditPreset('custom')}
            className={`px-2.5 py-1 text-[10px] border rounded transition-colors font-mono ${
              auditPreset === 'custom'
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                : 'border-border text-muted hover:text-heading hover:bg-surface2'
            }`}
          >
            Custom
          </button>
          <select
            value={auditType}
            onChange={(e) => setAuditType(e.target.value)}
            title="Filter by event type"
            className="px-2 py-1 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
          >
            <option value="">All types</option>
            {[...new Set(events.map((e) => e.event_type))].sort().map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {auditType && (
            <button type="button" onClick={() => setAuditType('')}
              className="text-[10px] text-muted hover:text-heading transition-colors">
              Clear type
            </button>
          )}
        </div>

        {/* Table */}
        {(() => {
          const filtered = events.filter((e) => {
            if (auditFrom && e.occurred_at < auditFrom) return false;
            if (auditTo && e.occurred_at > auditTo + 'T23:59:59Z') return false;
            if (auditType && e.event_type !== auditType) return false;
            return true;
          });
          const totalPages = Math.ceil(filtered.length / AUDIT_PAGE_SIZE);
          const paginated = filtered.slice(auditPage * AUDIT_PAGE_SIZE, (auditPage + 1) * AUDIT_PAGE_SIZE);

          return (
            <>
              <div className="overflow-x-auto border border-border rounded">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="border-b border-border bg-surface2">
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Timestamp</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Source</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Type</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider">Title</th>
                      <th className="text-left px-3 py-2 text-muted uppercase tracking-wider hidden md:table-cell">Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginated.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No events match the current filters</td></tr>
                    ) : paginated.map((e) => (
                      <tr key={e.id} className="hover:bg-surface2 transition-colors">
                        <td className="px-3 py-2 text-muted whitespace-nowrap">{new Date(e.occurred_at).toLocaleString()}</td>
                        <td className="px-3 py-2 text-accent">{e.source}</td>
                        <td className="px-3 py-2 text-muted">{e.event_type}</td>
                        <td className="px-3 py-2 text-heading truncate max-w-[200px]">{e.title ?? '—'}</td>
                        <td className="px-3 py-2 text-muted truncate max-w-[200px] hidden md:table-cell">{e.summary ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-muted font-mono">
                    {filtered.length} events · page {auditPage + 1}/{totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setAuditPage((p) => Math.max(0, p - 1))} disabled={auditPage === 0}
                      className="text-[10px] px-2 py-1 border border-border rounded hover:bg-surface2 disabled:opacity-40 transition-colors font-mono">
                      ← Prev
                    </button>
                    <button type="button" onClick={() => setAuditPage((p) => Math.min(totalPages - 1, p + 1))} disabled={auditPage >= totalPages - 1}
                      className="text-[10px] px-2 py-1 border border-border rounded hover:bg-surface2 disabled:opacity-40 transition-colors font-mono">
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Project Image */}
      {isOwner && (
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <FileText size={14} className="text-heading" />
            <h3 className="font-sans text-sm font-bold text-heading">Project Image</h3>
          </div>
          <div className="flex items-center gap-5">
            {/* Preview */}
            <div className="w-16 h-16 rounded-lg border border-border bg-surface2 overflow-hidden flex items-center justify-center shrink-0">
              {project.image_url
                ? <img src={project.image_url} alt="Project" className="w-full h-full object-cover" />
                : <span className="text-xl font-bold text-muted/40">{project.name[0]?.toUpperCase()}</span>
              }
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 px-4 py-2 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded cursor-pointer">
                {imageUploading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                {imageUploading ? 'Uploading…' : 'Upload Image'}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(f, e.target);
                }} />
              </label>
              {project.image_url && (
                <button type="button" onClick={() => updateProject({ image_url: null })}
                  className="px-4 py-2 border border-danger/30 text-danger text-[10px] font-semibold tracking-wider uppercase hover:bg-danger/5 transition-colors rounded">
                  Remove
                </button>
              )}
              <p className="text-[10px] text-muted">Displays as a rounded square icon. PNG, JPG, or GIF.</p>
            </div>
          </div>
        </div>
      )}

      {/* Task Labels — Categories & LOEs */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-5">
          <Table size={14} className="text-heading" />
          <h3 className="font-sans text-sm font-bold text-heading">Task Labels</h3>
        </div>
        <p className="text-[11px] text-muted mb-5">
          Define project-specific categories and lines of effort. These appear in the task editor dropdowns.
        </p>

        {/* Add new label */}
        {isOwner && (
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <div className="flex items-center gap-px border border-border rounded overflow-hidden">
              {(['category', 'loe'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setNewLabelType(t)}
                  className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase transition-colors ${newLabelType === t ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}>
                  {t === 'category' ? 'Category' : 'LOE'}
                </button>
              ))}
            </div>
            <input value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { addLabel(newLabelType, newLabelName, newLabelColor); setNewLabelName(''); } }}
              placeholder="Label name…"
              className="px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded w-48" />
            <LabelColorPicker value={newLabelColor} onChange={setNewLabelColor} />
            <button type="button" onClick={() => { addLabel(newLabelType, newLabelName, newLabelColor); setNewLabelName(''); }}
              disabled={!newLabelName.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/10 transition-colors rounded disabled:opacity-40">
              <Plus size={11} /> Add
            </button>
          </div>
        )}

        {/* Existing labels by type */}
        {(['category', 'loe'] as const).map((type) => {
          const typeLabels = projectLabels.filter((l) => l.type === type);
          if (typeLabels.length === 0) return null;
          return (
            <div key={type} className="mb-4">
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted mb-2">
                {type === 'category' ? 'Categories' : 'Lines of Effort'}
              </p>
              <div className="flex flex-wrap gap-2">
                {typeLabels.map((lbl) => (
                  <div key={lbl.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-surface2 group">
                    {/* eslint-disable-next-line react/forbid-dom-props */}
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 block" title={lbl.color}
                      style={{ background: lbl.color }} />
                    <span className="text-xs text-heading font-mono">{lbl.name}</span>
                    {isOwner && (
                      <button type="button" title={`Remove ${lbl.name}`} onClick={() => deleteLabel(lbl.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-all ml-0.5">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {projectLabels.length === 0 && (
          <p className="text-[11px] text-muted/60 italic">No labels yet. Add your first category or line of effort above.</p>
        )}
      </div>

      {/* Customize AI Prompts */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h3 className="font-sans text-sm font-bold text-heading">Customize AI Prompts</h3>
          </div>
          <button type="button" onClick={() => setResetPromptsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-danger hover:border-danger/30 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded">
            <RefreshCw size={10} /> Reset All to Default
          </button>
        </div>
        <p className="text-[11px] text-muted mb-5">
          Edit the system prompt used by each AI feature. Customized prompts are saved to this project only.
        </p>
        <div className="space-y-px border border-border bg-border">
          {(Object.keys(PROMPT_LABELS) as PromptFeature[]).map((feature) => {
            const isCustom = !!getPrompt(feature);
            return (
              <div key={feature} className="flex items-center gap-3 bg-surface px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium">{PROMPT_LABELS[feature]}</div>
                  {isCustom && <div className="text-[10px] text-accent mt-0.5">Custom prompt active</div>}
                  {!isCustom && <div className="text-[10px] text-muted mt-0.5">Using default prompt</div>}
                </div>
                <div className="flex items-center gap-2">
                  {isCustom && (
                    <button type="button" onClick={() => resetPrompt(feature)}
                      className="text-[10px] text-muted hover:text-danger transition-colors flex items-center gap-1">
                      <RefreshCw size={9} /> Reset
                    </button>
                  )}
                  <button type="button"
                    onClick={() => {
                      setEditPromptFeature(feature);
                      setEditPromptText(getPrompt(feature) ?? DEFAULT_PROMPTS[feature]);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 border border-border text-muted hover:text-heading hover:bg-surface2 text-[10px] font-semibold tracking-wider uppercase transition-colors rounded">
                    <Pencil size={9} /> Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="border border-danger/30 bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={14} className="text-danger" />
          <h3 className="font-sans text-sm font-bold text-danger">Danger Zone</h3>
        </div>
        <p className="text-xs text-muted mb-4">
          Remove this project from your view. If you are the only member, Odyssey will prompt you to delete it instead.
        </p>
        <button
          type="button"
          onClick={() => setDeleteModalOpen(true)}
          disabled={deletingProject || leavingProject}
          className="flex items-center gap-2 px-5 py-2 border border-danger/40 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/10 transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {deletingProject || leavingProject ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
          {deletingProject ? 'Deleting...' : leavingProject ? 'Removing...' : 'Remove Project'}
        </button>
      </div>

      {/* Teams Folder Picker modal */}
      {teamsFolderPickerOpen && (
        <TeamsFolderPickerModal
          onSelect={async (folder) => {
            setTeamsFolderSaving(true);
            setTeamsFolderPickerOpen(false);
            await supabase.from('integrations').upsert(
              {
                project_id: projectId,
                type: 'teams',
                config: { folder_id: folder.id, folder_name: folder.name },
              },
              { onConflict: 'project_id,type' },
            );
            setTeamsFolder(folder);
            setTeamsFolderSaving(false);
          }}
          onClose={() => setTeamsFolderPickerOpen(false)}
        />
      )}

      {/* AI Prompt Edit Modal */}
      {editPromptFeature && (() => {
        const defaultText = DEFAULT_PROMPTS[editPromptFeature];
        const customText  = getPrompt(editPromptFeature);
        const isShowingDefault = editPromptText.trim() === defaultText.trim();
        const isCustomActive   = !!customText;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-surface border border-border rounded-lg shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-accent" />
                  <h2 className="font-sans text-sm font-bold text-heading">
                    {PROMPT_LABELS[editPromptFeature]}
                  </h2>
                  <span className={`text-[9px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded ${isCustomActive ? 'bg-accent/10 text-accent' : 'bg-surface2 text-muted'}`}>
                    {isCustomActive ? 'Custom' : 'Default'}
                  </span>
                </div>
                <button type="button" title="Close" onClick={() => setEditPromptFeature(null)}
                  className="p-1 text-muted hover:text-heading transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 flex flex-col gap-4 overflow-y-auto flex-1">

                {/* Status banner */}
                {isCustomActive ? (
                  <div className="flex items-start gap-2 px-3 py-2 bg-accent/5 border border-accent/20 rounded text-[11px] text-accent">
                    <Sparkles size={11} className="mt-px shrink-0" />
                    This project is using a <strong>custom prompt</strong>. Edit below or restore the default.
                  </div>
                ) : (
                  <div className="flex items-start gap-2 px-3 py-2 bg-surface2 border border-border rounded text-[11px] text-muted">
                    <RefreshCw size={11} className="mt-px shrink-0" />
                    Showing the <strong>default prompt</strong>. Edit below to save a custom version for this project.
                  </div>
                )}

                {/* Editable textarea */}
                <div>
                  <label className="block text-[10px] tracking-[0.15em] uppercase text-muted mb-1.5">
                    {isCustomActive ? 'Your Custom Prompt' : 'Prompt (editing default)'}
                  </label>
                  <textarea
                    value={editPromptText}
                    onChange={(e) => setEditPromptText(e.target.value)}
                    rows={14}
                    title="AI prompt text"
                    placeholder="Enter prompt…"
                    className="w-full px-3 py-2.5 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded resize-y"
                  />
                </div>

                {/* Default prompt reference — shown when a custom prompt is active */}
                {isCustomActive && (
                  <details className="group">
                    <summary className="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted cursor-pointer select-none hover:text-heading transition-colors">
                      <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
                      View Default Prompt
                    </summary>
                    <pre className="mt-2 px-3 py-2.5 bg-surface2 border border-border text-muted text-[10px] font-mono rounded overflow-x-auto whitespace-pre-wrap leading-relaxed">
                      {defaultText}
                    </pre>
                  </details>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 justify-between px-6 py-4 border-t border-border shrink-0 flex-wrap">
                <button type="button"
                  onClick={() => {
                    resetPrompt(editPromptFeature);
                    setEditPromptText(defaultText);
                  }}
                  disabled={isShowingDefault && !isCustomActive}
                  className="flex items-center gap-1.5 text-[10px] text-muted hover:text-danger transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  <RefreshCw size={10} /> Restore Default
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditPromptFeature(null)}
                    className="px-4 py-2 border border-border text-muted text-[10px] font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors rounded">
                    Cancel
                  </button>
                  <button type="button"
                    onClick={() => {
                      const trimmed = editPromptText.trim();
                      if (!trimmed || trimmed === defaultText.trim()) {
                        resetPrompt(editPromptFeature);
                      } else {
                        savePrompt(editPromptFeature, trimmed);
                      }
                      setEditPromptFeature(null);
                    }}
                    className="px-4 py-2 bg-accent/10 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded">
                    {isShowingDefault && !isCustomActive ? 'Close' : 'Save Custom Prompt'}
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Reset All Prompts Confirmation Modal */}
      {resetPromptsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={14} className="text-danger" />
              <h2 className="font-sans text-sm font-bold text-heading">Reset All Prompts</h2>
            </div>
            <p className="text-xs text-muted mb-4">
              This will remove all custom prompts for this project and restore every AI feature to its default behavior.
              Type <span className="font-mono text-heading">reset</span> to confirm.
            </p>
            <input
              value={resetPromptsTyped}
              onChange={(e) => setResetPromptsTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && resetPromptsTyped === 'reset') {
                  resetAllPrompts(); setResetPromptsModalOpen(false); setResetPromptsTyped('');
                }
              }}
              placeholder="reset"
              className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-sm font-mono placeholder:text-muted/40 focus:outline-none focus:border-danger/50 transition-colors rounded mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setResetPromptsModalOpen(false); setResetPromptsTyped(''); }}
                className="px-4 py-2 border border-border text-muted text-[10px] font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors rounded">
                Cancel
              </button>
              <button type="button"
                disabled={resetPromptsTyped !== 'reset'}
                onClick={() => { resetAllPrompts(); setResetPromptsModalOpen(false); setResetPromptsTyped(''); }}
                className="px-4 py-2 border border-danger/40 text-danger text-[10px] font-semibold tracking-wider uppercase hover:bg-danger/10 transition-colors rounded disabled:opacity-40">
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(SettingsTab);
