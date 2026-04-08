import { Suspense, startTransition, useDeferredValue, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProjectFilePaths, type FileRef } from '../hooks/useProjectFilePaths';
import { getGitLabRepoPaths, type GitLabIntegrationConfig } from '../lib/gitlab';
import './ProjectDetailPage.css';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  Target,
  Github,
  Sparkles,
  BarChart3,
  Plus,
  Trash2,
  ArrowLeft,
  Clock,
  Link,
  Loader2,
  CheckCircle,
  X,
  Settings,
  TrendingUp,
  DollarSign,
  Folder,
  ChevronRight,
  Plug,
  GitBranch,
  FileText,
  ExternalLink,
  ClipboardList,
  Download,
  Table,
  LogOut,
} from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';
import type { SearchPanelHandle } from '../components/SearchPanel';
import type { ReportContent } from '../lib/report-download';
import { useProject, useJoinRequests, deleteProjectCascade, removeSelfFromProjectAccess } from '../hooks/useProjects';
import { useProjectLabels } from '../hooks/useProjectLabels';
import { useProjectPrompts, type PromptFeature } from '../hooks/useProjectPrompts';
import { deleteImportedEvent } from '../hooks/useMicrosoftIntegration';
import { useGoals } from '../hooks/useGoals';
import { useEvents } from '../hooks/useEvents';
import { useSharedProjectPeople } from '../hooks/useSharedProjectPeople';
import { useProjectTimeLogs } from '../hooks/useProjectTimeLogs';
import { useAuth } from '../lib/auth';
import { useAIAgent } from '../lib/ai-agent';
import { useChatPanel } from '../lib/chat-panel';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import Modal, { useModal } from '../components/Modal';
import { getProjectFingerprint } from '../lib/project-fingerprint';
import { getGitHubRepos, getPrimaryGitHubRepo } from '../lib/github';
import { useAIErrorDialog } from '../lib/ai-error';
import { useTabVisibility } from '../hooks/useTabVisibility';
import { lazyWithRetry } from '../lib/lazy-with-retry';
import { pickUnusedProjectLabelColor } from '../lib/project-label-colors';

const OverviewTab = lazyWithRetry(() => import('../components/project-tabs/OverviewTab'), 'project-tab-overview');
const ActivityTab = lazyWithRetry(() => import('../components/project-tabs/ActivityTab'), 'project-tab-activity');
const GoalsTab = lazyWithRetry(() => import('../components/project-tabs/GoalsTab'), 'project-tab-goals');
const CoordinationTab = lazyWithRetry(() => import('../components/project-tabs/CoordinationTab'), 'project-tab-coordination');
const SettingsTab = lazyWithRetry(() => import('../components/project-tabs/SettingsTab'), 'project-tab-settings');
const GoalMetrics = lazyWithRetry(() => import('../components/GoalMetrics'), 'project-goal-metrics');
const ReportsTab = lazyWithRetry(() => import('../components/ReportsTab'), 'project-reports');
const FinancialsTab = lazyWithRetry(() => import('../components/project-tabs/FinancialsTab'), 'project-tab-financials');
const TimelinePage = lazyWithRetry(() => import('../components/TimelinePage'), 'project-timeline');
const FileViewerLazy = lazyWithRetry(() => import('../components/FileViewer'), 'project-file-viewer');
const GoalEditModal = lazyWithRetry(() => import('../components/GoalEditModal'), 'project-goal-edit');
const GoalReportModal = lazyWithRetry(() => import('../components/GoalReportModal'), 'project-goal-report');
const FilePreviewModal = lazyWithRetry(() => import('../components/FilePreviewModal'), 'project-file-preview');
const RepoTreeModal = lazyWithRetry(() => import('../components/RepoTreeModal'), 'project-repo-tree');

let reportDownloadsPromise: Promise<typeof import('../lib/report-download')> | null = null;

function loadReportDownloads() {
  if (!reportDownloadsPromise) {
    reportDownloadsPromise = import('../lib/report-download');
  }
  return reportDownloadsPromise;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read file.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

const tabs = [
  { id: 'overview',      label: 'Overview',      icon: BarChart3 },
  { id: 'timeline',      label: 'Timeline',      icon: Clock },
  { id: 'goals',         label: 'Tasks',         icon: Target },
  { id: 'activity',      label: 'Activity',      icon: Activity },
  { id: 'coordination',  label: 'Coordination',  icon: GitBranch },
  { id: 'metrics',       label: 'Metrics',       icon: TrendingUp },
  { id: 'financials',    label: 'Financials',    icon: DollarSign },
  { id: 'reports',       label: 'Reports',       icon: ClipboardList },
  { id: 'documents',     label: 'Documents',     icon: Link },
  { id: 'integrations',  label: 'Integrations',  icon: Plug },
  { id: 'settings',      label: 'Settings',      icon: Settings },
] as const;

type TabId = (typeof tabs)[number]['id'];

function isTabId(value: string): value is TabId {
  return tabs.some((tab) => tab.id === value);
}

function SuspenseFallback({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-xs text-muted">
      <Loader2 size={14} className="animate-spin mr-2" />
      {label}
    </div>
  );
}

interface MemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  profile?: { display_name: string | null; avatar_url: string | null; email?: string | null; username?: string | null };
}

interface ScanResults {
  completed: string[];
  suggested: { title: string; reason: string }[];
}

const API_BASE = '/api';
const CREATE_NEW_CATEGORY_VALUE = '__create_new_category__';
const CREATE_NEW_LOE_VALUE = '__create_new_loe__';

function emailLocalPart(email?: string | null): string | null {
  if (!email) return null;
  const [localPart] = email.split('@');
  return localPart?.trim() || null;
}

function getProjectMemberDisplayName(member: MemberRow): string {
  return (
    member.profile?.display_name?.trim()
    || member.profile?.username?.trim()
    || emailLocalPart(member.profile?.email)
    || member.user_id
  );
}

function DeleteProjectModal({
  projectName,
  onRemove,
  onDelete,
  busy,
  onClose,
}: {
  projectName: string;
  onRemove: () => Promise<{ result: 'removed' | 'delete_required' }>;
  onDelete: () => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'remove' | 'delete'>('remove');
  const valid = typed.trim().toLowerCase() === mode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setError(null);
    try {
      if (mode === 'remove') {
        const result = await onRemove();
        if (result.result === 'delete_required') {
          setMode('delete');
          setTyped('');
        }
        return;
      }
      await onDelete();
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${mode} project. Please try again.`);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'remove' ? 'Remove Project' : 'Delete Project'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'remove' ? (
          <p className="text-xs text-muted leading-relaxed">
            This will remove <span className="font-semibold text-heading">{projectName}</span> from your project list. The project will remain in Odyssey for any other members.
          </p>
        ) : (
          <p className="text-xs text-muted leading-relaxed">
            You are the only member of <span className="font-semibold text-heading">{projectName}</span>. Deleting it will permanently remove all associated tasks, events, reports, invites, linked repos, and project data.
          </p>
        )}

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
            Type <span className="text-danger font-mono">{mode}</span> to confirm
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            placeholder={mode}
            className="w-full px-4 py-2.5 bg-surface2 border border-border text-heading text-sm font-mono placeholder:text-muted/40 focus:outline-none focus:border-danger/50 transition-colors"
          />
        </div>

        {error && <p className="text-xs text-danger font-mono">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-danger/10 border border-danger/40 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : mode === 'remove' ? <LogOut size={12} /> : <Trash2 size={12} />}
            {busy ? (mode === 'remove' ? 'Removing...' : 'Deleting...') : mode === 'remove' ? 'Remove' : 'Delete'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { agent, providers } = useAIAgent();
  const { showAIError, aiErrorDialog } = useAIErrorDialog(agent, providers);
  const { register, unregister, setIuOpen } = useChatPanel();
  const { project, loading: projectLoading, updateProject } = useProject(projectId);
  const { goals, createGoal, updateGoal, deleteGoal, refetch: refetchGoals } = useGoals(projectId);
  const { events, loading: eventsLoading, refetch: refetchEvents } = useEvents(projectId);
  const { categories: projectCategories, loes: projectLoes, labels: projectLabels, addLabel, deleteLabel } = useProjectLabels(projectId);
  const { getPrompt, savePrompt, resetPrompt, resetAllPrompts } = useProjectPrompts(projectId);
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [leavingProject, setLeavingProject] = useState(false);
  const [inviteRole, setInviteRole] = useState<'member' | 'owner'>('member');
  const [inviteTab, setInviteTab] = useState<'username' | 'nps_email' | 'shared' | 'qr'>('nps_email');
  const [editPromptFeature, setEditPromptFeature] = useState<PromptFeature | null>(null);
  const [editPromptText, setEditPromptText] = useState('');
  const [resetPromptsTyped, setResetPromptsTyped] = useState('');
  const [resetPromptsModalOpen, setResetPromptsModalOpen] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);

  const handleDeleteProject = async () => {
    if (!projectId || !project) return;
    setDeletingProject(true);
    try {
      await deleteProjectCascade(projectId);
      navigate('/projects');
    } catch (err) {
      console.error('Failed to delete project:', err);
      setDeletingProject(false);
      throw err;
    }
  };

  const handleRemoveProject = async () => {
    if (!projectId || !user) return { result: 'removed' as const };
    setLeavingProject(true);
    try {
      const result = await removeSelfFromProjectAccess(projectId, user.id);
      if (result.result === 'removed') {
        navigate('/projects');
      }
      return result;
    } catch (err) {
      console.error('Failed to remove project:', err);
      throw err;
    } finally {
      setLeavingProject(false);
    }
  };

  const handleImageUpload = async (file: File, inputEl?: HTMLInputElement | null) => {
    if (!projectId) return;
    setImageUploading(true);
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please choose an image file.');
      }
      const ext = file.name.split('.').pop() ?? 'jpg';
      const version = Date.now();
      const path = `project-images/${projectId}/avatar-${version}.${ext}`;
      const { error: upErr } = await supabase.storage.from('project-assets').upload(path, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (upErr) {
        const fallbackUrl = await readFileAsDataUrl(file);
        await updateProject({ image_url: fallbackUrl });
      } else {
        const { data: urlData } = supabase.storage.from('project-assets').getPublicUrl(path);
        await updateProject({ image_url: `${urlData.publicUrl}?v=${version}` });
      }
      // Clear file input so the same file can be re-uploaded if needed
      if (inputEl) inputEl.value = '';
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      setImageUploading(false);
    }
  };

  // Join requests
  const { requests: joinRequests, respond: respondJoinRequest, refetch: refetchJoinRequests } = useJoinRequests(projectId);

  // Register this project with the global chat panel; unregister on unmount or project change
  useEffect(() => {
    if (project?.id && project?.name) {
      register(project.id, project.name, refetchGoals);
    }
    return () => { unregister(); };
  }, [project?.id, project?.name, register, unregister, refetchGoals]);

  const [activeTabState, setActiveTab] = useState<TabId>('overview');
  const { visibleTabs, isVisible } = useTabVisibility(projectId);
  const githubRepos = getGitHubRepos(project);
  const primaryGitHubRepo = getPrimaryGitHubRepo(project);
  // If the active tab was hidden, fall back to overview
  const activeTab: TabId = isVisible(activeTabState) ? activeTabState : 'overview';
  const handleTabChange = useCallback((tab: string) => {
    if (!isTabId(tab)) return;
    startTransition(() => {
      setActiveTab(tab);
    });
  }, []);
  const goalModal = useModal();
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');
  const [newGoalCategory, setNewGoalCategory] = useState('');
  const [newGoalCategoryDraft, setNewGoalCategoryDraft] = useState('');
  const [newGoalLoe, setNewGoalLoe] = useState('');
  const [newGoalLoeDraft, setNewGoalLoeDraft] = useState('');
  const [newGoalNotes, setNewGoalNotes] = useState('');
  const [newGoalAssignees, setNewGoalAssignees] = useState<string[]>([]);
  const [goalCreateError, setGoalCreateError] = useState<string | null>(null);
  const [goalCreateNotice, setGoalCreateNotice] = useState<string | null>(null);
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [creatingFromNotes, setCreatingFromNotes] = useState(false);
  const createFromNotesInputRef = useRef<HTMLInputElement>(null);
  const resetNewGoalForm = useCallback(() => {
    setNewGoalTitle('');
    setNewGoalDeadline('');
    setNewGoalCategory('');
    setNewGoalCategoryDraft('');
    setNewGoalLoe('');
    setNewGoalLoeDraft('');
    setNewGoalNotes('');
    setNewGoalAssignees([]);
    setGoalCreateError(null);
    setGoalCreateNotice(null);
  }, []);
  const closeGoalModal = useCallback(() => {
    resetNewGoalForm();
    goalModal.onClose();
  }, [goalModal, resetNewGoalForm]);

  const createProjectLabelIfNeeded = useCallback(async (
    type: 'category' | 'loe',
    rawName: string,
    reservedColors: string[] = [],
  ) => {
    const trimmed = rawName.trim();
    if (!trimmed) {
      throw new Error(type === 'category' ? 'Enter a category name.' : 'Enter a line of effort name.');
    }
    const existing = (type === 'category' ? projectCategories : projectLoes)
      .find((label) => label.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.name;

    const color = pickUnusedProjectLabelColor([
      ...projectLabels.map((label) => label.color),
      ...reservedColors,
    ]);
    reservedColors.push(color);
    const created = await addLabel(type, trimmed, color);
    return created?.name ?? trimmed;
  }, [addLabel, projectCategories, projectLabels, projectLoes]);

  const resolveInlineProjectLabel = useCallback(async (
    type: 'category' | 'loe',
    selectedValue: string,
    draftValue: string,
    reservedColors: string[] = [],
  ) => {
    const isCreateNew = type === 'category'
      ? selectedValue === CREATE_NEW_CATEGORY_VALUE
      : selectedValue === CREATE_NEW_LOE_VALUE;
    if (isCreateNew) {
      return createProjectLabelIfNeeded(type, draftValue, reservedColors);
    }
    return selectedValue.trim();
  }, [createProjectLabelIfNeeded]);

  // Inline project name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  // GitHub repo state
  const [repoInput, setRepoInput] = useState('');
  const [repoSaving, setRepoSaving] = useState(false);

  // AI scan state
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResults | null>(null);

  // AI insights state
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState<{ status: string; nextSteps: string[]; futureFeatures: string[]; codeInsights?: string[]; provider?: string; generatedAt?: string } | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // Standup generator state
  type StandupData = {
    highlights: string;
    accomplished: string[];
    inProgress: string[];
    blockers: string[];
    period: { from: string; to: string };
    commitSummary: { source: 'github' | 'gitlab'; repo: string; count: number }[];
    totalCommits: number;
    provider?: string;
  };
  const [standupLoading, setStandupLoading] = useState(false);
  const [standup, setStandup] = useState<StandupData | null>(null);
  const [standupError, setStandupError] = useState<string | null>(null);

  // Per-task AI guidance state — seeded from DB on load, updated on generate
  const [taskGuidance, setTaskGuidance] = useState<Record<string, { loading: boolean; text: string | null; provider?: string }>>({});
  const [guidanceVisible, setGuidanceVisible] = useState<Record<string, boolean>>({});

  // Seed taskGuidance from saved ai_guidance whenever goals load/change
  useEffect(() => {
    if (goals.length === 0) return;
    setTaskGuidance((prev) => {
      const next = { ...prev };
      for (const g of goals) {
        if (g.ai_guidance && !next[g.id]?.text) {
          next[g.id] = { loading: false, text: g.ai_guidance };
        }
      }
      return next;
    });
  }, [goals]);

  // Office progress sync
  const [syncingProgress, setSyncingProgress] = useState(false);
  const [syncResult, setSyncResult] = useState<{ summary: string; applied: number; provider?: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Deleting imported docs
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  // Document edit/select mode
  const [docEditMode, setDocEditMode] = useState(false);
  const [docSelected, setDocSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // GitLab linked repos (for overview panel)
  const [gitlabRepos, setGitlabRepos] = useState<string[]>([]);

  // File path index for clickable code file links
  const { filePaths, fetchFileContent } = useProjectFilePaths(projectId, githubRepos, gitlabRepos);
  const [previewFileRef, setPreviewFileRef] = useState<FileRef | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [repoTreeTarget, setRepoTreeTarget] = useState<{ repo: string; type: 'github' | 'gitlab'; projectId?: string | null } | null>(null);
  const [, setTeamsFolder] = useState<{ id: string; name: string } | null>(null);

  const handleFileClick = useCallback(async (ref: FileRef) => {
    setPreviewFileRef(ref);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const content = await fetchFileContent(ref);
      setPreviewContent(content);
    } catch (err: any) {
      setPreviewError(err?.message ?? 'Failed to load file');
    } finally {
      setPreviewLoading(false);
    }
  }, [fetchFileContent]);

  const handleRepoClick = useCallback((repo: string, type: 'github' | 'gitlab') => {
    setRepoTreeTarget({ repo, type, projectId: type === 'gitlab' ? projectId : null });
  }, [projectId]);

  // Members state
  const [members, setMembers] = useState<MemberRow[]>([]);
  const currentUserMemberRole = members.find((member) => member.user_id === user?.id)?.role ?? null;
  const isOwner = project?.owner_id === user?.id || currentUserMemberRole === 'owner';

  // Goal edit / report modals
  const [editGoal,        setEditGoal]        = useState<import('../types').Goal | null>(null);
  const [editAutoGuidance, setEditAutoGuidance] = useState(false);
  const [reportGoal, setReportGoal] = useState<import('../types').Goal | null>(null);

  // Report chat history — persists across tab switches
  const [reportMessages, setReportMessages] = useState<{ role: 'user' | 'assistant'; content: string; provider?: string }[]>([]);
  const [savedReportsVersion, setSavedReportsVersion] = useState(0);
  const [hasCommitData, setHasCommitData] = useState(false);

  // Search
  const searchRef = useRef<SearchPanelHandle>(null);

  const [riskAssessing, setRiskAssessing] = useState(false);
  type RiskEntry = { goalId: string; score: number; level: string; factors: string[] };
  type RiskReport = { assessments: RiskEntry[]; generatedAt: string };
  const [riskReport, setRiskReport] = useState<RiskReport | null>(() => {
    try { const raw = localStorage.getItem(`odyssey-risk-${projectId}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [riskPanelOpen, setRiskPanelOpen] = useState(false);
  const [goalDependencies, setGoalDependencies] = useState<import('../types').GoalDependency[]>([]);
  const [auditFrom, setAuditFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [auditTo, setAuditTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [auditPreset, setAuditPreset] = useState<'2W' | '1M' | '3M' | '6M' | 'Full' | 'custom'>('1M');
  const [auditType, setAuditType] = useState('');
  const [auditPage, setAuditPage] = useState(0);
  const AUDIT_PAGE_SIZE = 25;

  // Project-wide time logs
  const { logs: timeLogs } = useProjectTimeLogs(projectId);
  const timeLogTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of timeLogs) m.set(l.goal_id, (m.get(l.goal_id) ?? 0) + l.logged_hours);
    return m;
  }, [timeLogs]);

  // Intelligent Update panel — now lives in the layout right panel via context
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSearching, setMemberSearching] = useState(false);
  const { people: sharedPeopleCandidates, loading: sharedPeopleLoading, refetch: refetchSharedPeople } = useSharedProjectPeople(projectId);
  const invitableSharedPeople = useMemo(() => {
    const existingUserIds = new Set<string>([
      ...(project?.owner_id ? [project.owner_id] : []),
      ...members.map((member) => member.user_id),
    ]);
    return sharedPeopleCandidates.filter((candidate) => !existingUserIds.has(candidate.id));
  }, [members, project?.owner_id, sharedPeopleCandidates]);

  useEffect(() => {
    const navState = location.state as { openTab?: TabId; editGoalId?: string } | null;
    if (!navState) return;

    if (navState.openTab) handleTabChange(navState.openTab);
    if (navState.editGoalId) {
      if (goals.length === 0) return;
      const goal = goals.find((g) => g.id === navState.editGoalId);
      if (!goal) return;
      setEditAutoGuidance(false);
      setEditGoal(goal);
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, goals, handleTabChange]);

  // Load persisted insights + Teams folder on mount
  useEffect(() => {
    if (!projectId) return;

    // Load saved AI insights
    supabase
      .from('project_insights')
      .select('status, next_steps, future_features, provider, generated_at')
      .eq('project_id', projectId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error('Failed to load insights:', error);
        if (data) {
          setInsights({
            status: data.status,
            nextSteps: data.next_steps as string[],
            futureFeatures: data.future_features as string[],
            provider: data.provider,
            generatedAt: data.generated_at,
          });
        }
      });

    // Load saved standup report
    fetch(`${API_BASE}/ai/standup/${projectId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setStandup(data); })
      .catch(() => {});

    // Load GitLab integration (multi-repo)
    supabase
      .from('integrations')
      .select('config')
      .eq('project_id', projectId)
      .eq('type', 'gitlab')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.config) {
          const cfg = data.config as GitLabIntegrationConfig;
          setGitlabRepos(getGitLabRepoPaths(cfg));
        }
      });

    // Load Teams folder integration
    supabase
      .from('integrations')
      .select('config')
      .eq('project_id', projectId)
      .eq('type', 'teams')
      .single()
      .then(({ data }) => {
        if (data?.config) {
          const cfg = data.config as { folder_id: string; folder_name: string };
          setTeamsFolder({ id: cfg.folder_id, name: cfg.folder_name });
        }
      });
  }, [projectId]);

  // Ctrl+K focuses the inline search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Fetch project-level goal dependencies
  useEffect(() => {
    if (!projectId) return;
    supabase.from('goal_dependencies').select('*').eq('project_id', projectId)
      .then(({ data }) => { if (data) setGoalDependencies(data as import('../types').GoalDependency[]); });
  }, [projectId]);

  // Reset audit pagination on filter change
  useEffect(() => { setAuditPage(0); }, [auditFrom, auditTo, auditType]);

  // Fetch members
  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    const { data: memberRows, error: membersError } = await supabase
      .from('project_members')
      .select('user_id, role, joined_at')
      .eq('project_id', projectId);
    if (membersError) {
      console.error('Failed to load project members:', membersError);
      return;
    }

    const uniqueMembers = [...new Map(
      (memberRows ?? []).map((row) => [row.user_id, row]),
    ).values()] as Pick<MemberRow, 'user_id' | 'role' | 'joined_at'>[];

    const { data: profiles, error: profilesError } = uniqueMembers.length
      ? await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, email, username')
        .in('id', uniqueMembers.map((row) => row.user_id))
      : { data: [], error: null };

    if (profilesError) {
      console.error('Failed to load member profiles:', profilesError);
    }

    const profileMap = new Map(
      (profiles ?? []).map((profile) => [profile.id, profile]),
    );

    setMembers(uniqueMembers.map((member) => ({
      ...member,
      profile: profileMap.has(member.user_id)
        ? {
          display_name: profileMap.get(member.user_id)?.display_name ?? null,
          avatar_url: profileMap.get(member.user_id)?.avatar_url ?? null,
          email: profileMap.get(member.user_id)?.email ?? null,
          username: (profileMap.get(member.user_id) as { username?: string | null } | undefined)?.username ?? null,
        }
        : undefined,
    })));
  }, [projectId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`project-members:${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${projectId}` },
        () => {
          fetchMembers();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, fetchMembers]);

  // AI risk assessment
  const handleAssessRisk = async () => {
    if (!projectId) return;
    setRiskAssessing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionData.session?.access_token) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      const res = await fetch(`${API_BASE}/ai/risk-assess`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, agent }),
      });
      if (res.ok) {
        const data = await res.json();
        const report: RiskReport = { assessments: data.assessments ?? [], generatedAt: new Date().toISOString() };
        setRiskReport(report);
        setRiskPanelOpen(true);
        try { localStorage.setItem(`odyssey-risk-${projectId}`, JSON.stringify(report)); } catch {}
      } else {
        const data = await res.json().catch(() => ({}));
        showAIError((data as { error?: string }).error ?? `Error ${res.status}`, res.status);
      }
      await refetchGoals();
    } catch (err) {
      console.error('Risk assessment failed:', err);
      showAIError(err, 502);
    }
    setRiskAssessing(false);
  };

  // Export audit log as CSV
  const handleExportAuditCSV = () => {
    const filtered = events.filter((e) => {
      if (auditFrom && e.occurred_at < auditFrom) return false;
      if (auditTo && e.occurred_at > auditTo + 'T23:59:59Z') return false;
      if (auditType && e.event_type !== auditType) return false;
      return true;
    });
    const header = ['Timestamp', 'Source', 'Type', 'Title', 'Summary'];
    const rows = filtered.map((e) => [
      new Date(e.occurred_at).toISOString(),
      e.source,
      e.event_type,
      (e.title ?? '').replace(/,/g, ';'),
      (e.summary ?? '').replace(/,/g, ';').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Close goal edit modal + refetch dependencies
  const handleGoalEditClose = async () => {
    setEditGoal(null);
    setEditAutoGuidance(false);
    if (projectId) {
      const { data } = await supabase.from('goal_dependencies').select('*').eq('project_id', projectId);
      if (data) setGoalDependencies(data as import('../types').GoalDependency[]);
    }
  };

  // Save GitHub repo — accepts "owner/repo" or full HTTPS clone URL
  const handleSaveRepo = async () => {
    if (!repoInput.trim() || !projectId) return;
    let slug = repoInput.trim();
    // Parse https://github.com/owner/repo.git or https://github.com/owner/repo
    const urlMatch = slug.match(/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/);
    if (urlMatch) slug = urlMatch[1];
    // Strip any trailing .git just in case
    slug = slug.replace(/\.git$/, '');
    setRepoSaving(true);
    try {
      const nextRepos = [...new Set([...githubRepos, slug])];
      await updateProject({ github_repo: nextRepos[0] ?? null, github_repos: nextRepos });
      setRepoInput('');
    } catch (err) {
      console.error('Failed to save repo:', err);
    }
    setRepoSaving(false);
  };

  // AI repo scan
  const handleRepoScan = async () => {
    if (!primaryGitHubRepo || !project) return;
    setScanLoading(true);
    setScanResults(null);
    try {
      const [owner, repo] = primaryGitHubRepo.split('/');
      if (!owner || !repo) throw new Error('GitHub repository must be in owner/repo format');
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (sessionData.session?.access_token) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      // Fetch recent repo data
      const recentRes = await fetch(
        `${API_BASE}/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent?projectId=${encodeURIComponent(projectId ?? '')}`,
        { headers },
      );
      const recentData = await recentRes.json();
      // Send to AI for analysis
      const scanRes = await fetch(`${API_BASE}/ai/repo-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: project.name,
          goals: goals.map((g) => ({ id: g.id, title: g.title, status: g.status })),
          commits: recentData.commits || [],
          readme: recentData.readme || '',
        }),
      });
      const scanData = await scanRes.json();
      if (!scanRes.ok) {
        showAIError(scanData.error ?? `Error ${scanRes.status}`, scanRes.status);
        return;
      }
      setScanResults(scanData);
    } catch (err) {
      console.error('Scan failed:', err);
      showAIError(err, 502);
    }
    setScanLoading(false);
  };

  // Generate AI project insights
  const handleGenerateInsights = async () => {
    if (!projectId) return;
    setInsightsLoading(true);
    setInsights(null);
    setInsightsError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_BASE}/ai/project-insights`, {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({ agent, projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInsightsError(data.error || `AI request failed (${res.status})`);
        showAIError(data.error || `AI request failed (${res.status})`, res.status);
      } else if (!data.status && !data.nextSteps?.length) {
        setInsightsError('AI returned an empty response. Try a different model.');
        showAIError('AI returned an empty response. Try a different model.');
      } else {
        const generatedAt = new Date().toISOString();
        setInsights({ ...data, generatedAt });
        const { error: upsertErr } = await supabase.from('project_insights').upsert(
          {
            project_id: projectId,
            status: data.status,
            next_steps: data.nextSteps,
            future_features: data.futureFeatures,
            provider: data.provider ?? agent,
            generated_at: generatedAt,
          },
          { onConflict: 'project_id' },
        );
        if (upsertErr) console.error('Failed to save insights:', upsertErr);
      }
    } catch (err) {
      console.error('Insights failed:', err);
      setInsightsError('Network error — is the server running?');
      showAIError(err, 502);
    }
    setInsightsLoading(false);
  };

  // Generate 2-week standup
  const handleGenerateStandup = async () => {
    if (!projectId) return;
    setStandupLoading(true);
    setStandup(null);
    setStandupError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_BASE}/ai/standup`, {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({ agent, projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStandupError(data.error || `Failed (${res.status})`);
        showAIError(data.error || `Failed (${res.status})`, res.status);
      } else {
        setStandup(data);
      }
    } catch {
      setStandupError('Network error — is the server running?');
      showAIError('Network error — is the server running?', 502);
    }
    setStandupLoading(false);
  };

  // Fetch (or regenerate) AI guidance for a task — always fetches, always shows result
  const handleTaskGuidance = async (g: { id: string; title: string; status: string; progress: number; category: string | null; loe: string | null }) => {
    setTaskGuidance((prev) => ({ ...prev, [g.id]: { loading: true, text: prev[g.id]?.text ?? null } }));
    setGuidanceVisible((prev) => ({ ...prev, [g.id]: true }));
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_BASE}/ai/task-guidance`, {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({ agent, projectId, taskTitle: g.title, taskStatus: g.status, taskProgress: g.progress, taskCategory: g.category, taskLoe: g.loe }),
      });
      const data = await res.json();
      const text = res.ok ? (data.guidance ?? null) : null;
      const provider = res.ok ? (data.provider ?? undefined) : undefined;
      if (!res.ok) {
        showAIError(data.error ?? `Error ${res.status}`, res.status);
      }
      setTaskGuidance((prev) => ({ ...prev, [g.id]: { loading: false, text, provider } }));
      if (text) updateGoal(g.id, { ai_guidance: text }).catch(() => {});
    } catch {
      setTaskGuidance((prev) => ({ ...prev, [g.id]: { loading: false, text: prev[g.id]?.text ?? null } }));
      showAIError('Network error — is the server running?', 502);
    }
  };

  // Sync goal progress from imported Office documents using AI
  const handleSyncOfficeProgress = async () => {
    if (!projectId) return;
    setSyncingProgress(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_BASE}/ai/analyze-office-progress`, {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({ agent, projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error ?? `Error ${res.status}`);
        showAIError(data.error ?? `Error ${res.status}`, res.status);
      } else {
        setSyncResult({ summary: data.summary, applied: data.applied, provider: data.provider });
        // Refresh goals so UI reflects DB updates
        if (data.applied > 0) {
          // useGoals auto-refreshes via subscription, but trigger refetch via a tiny delay
          setTimeout(() => window.location.reload(), 1200);
        }
      }
    } catch {
      setSyncError('Network error — is the server running?');
      showAIError('Network error — is the server running?', 502);
    }
    setSyncingProgress(false);
  };

  const handleInviteByIdentifier = async () => {
    if (memberSearch.trim().length < 1) throw new Error('Enter a username or email first.');
    if (!projectId) throw new Error('No project selected.');
    if (!isOwner) throw new Error('Only project owners can invite members.');
    if (inviteTab === 'qr') throw new Error('Use the QR tab to share a join code.');
    if (inviteTab === 'shared') throw new Error('Use the shared people picker to invite an existing collaborator.');

    setMemberSearching(true);
    try {
      const method = inviteTab === 'nps_email' ? 'nps_email' : 'username';
      const identifier = memberSearch.trim();

      const { data, error } = await supabase.rpc('invite_project_member_by_identifier', {
        p_project_id: projectId,
        p_role: inviteRole,
        p_method: method,
        p_identifier: identifier,
      });

      if (error) {
        const message = error.message.toLowerCase();
        const missingRpc =
          message.includes('could not find the function public.invite_project_member_by_identifier') ||
          message.includes('schema cache') ||
          message.includes('function public.invite_project_member_by_identifier');

        if (!missingRpc || method !== 'username') throw error;

        const { data: existingProfiles, error: lookupError } = await supabase
          .from('profiles')
          .select('id')
          .ilike('username', identifier)
          .limit(1);
        if (lookupError) throw lookupError;

        const userId = existingProfiles?.[0]?.id;
        if (!userId) throw new Error('No Odyssey account was found for that username.');

        const { data: existingMember, error: existingMemberError } = await supabase
          .from('project_members')
          .select('role')
          .eq('project_id', projectId)
          .eq('user_id', userId)
          .maybeSingle();
        if (existingMemberError) throw existingMemberError;
        if (existingMember?.role) throw new Error(`That user is already a ${existingMember.role} on this project.`);

        const { error: insertError } = await supabase
          .from('project_members')
          .insert({ project_id: projectId, user_id: userId, role: inviteRole });
        if (insertError) throw insertError;
      } else if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) {
        throw new Error(data.error);
      }

      await fetchMembers();
    } finally {
      setMemberSearching(false);
    }
  };

  const handleInviteSharedCollaborator = async (userId: string) => {
    if (!projectId) throw new Error('No project selected.');
    if (!isOwner) throw new Error('Only project owners can invite members.');
    if (!userId) throw new Error('Choose a person first.');
    if (project?.owner_id === userId) throw new Error('That user is already an owner of this project.');

    const existingMember = members.find((member) => member.user_id === userId);
    if (existingMember) throw new Error(`That user is already a ${existingMember.role} on this project.`);

    const { error } = await supabase
      .from('project_members')
      .insert({ project_id: projectId, user_id: userId, role: inviteRole });
    if (error) throw error;

    await fetchMembers();
    await refetchSharedPeople();
  };

  // Remove member
  const handleRemoveMember = async (userId: string) => {
    if (!projectId) return;
    if (!isOwner) return;
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw error;
    await refetchGoals();
    await fetchMembers();
  };

  const handlePromoteMember = async (userId: string) => {
    if (!projectId) return;
    if (!isOwner) return;
    const { data, error } = await supabase.rpc('promote_project_member_to_owner', {
      p_project_id: projectId,
      p_user_id: userId,
    });

    if (error) {
      const message = error.message.toLowerCase();
      const missingRpc =
        message.includes('could not find the function public.promote_project_member_to_owner') ||
        message.includes('schema cache') ||
        message.includes('function public.promote_project_member_to_owner');

      if (!missingRpc) throw error;

      const { error: fallbackError } = await supabase
        .from('project_members')
        .update({ role: 'owner' })
        .eq('project_id', projectId)
        .eq('user_id', userId);
      if (fallbackError) throw fallbackError;
    } else if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error) {
      throw new Error(data.error);
    }

    await fetchMembers();
  };

  if (projectLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto animate-pulse">
        <div className="h-4 bg-border rounded w-32 mb-4" />
        <div className="h-8 bg-border rounded w-64 mb-2" />
        <div className="h-4 bg-border rounded w-96" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 max-w-6xl mx-auto text-center py-20">
        <p className="text-muted text-sm mb-4">Project not found</p>
        <button type="button" onClick={() => navigate('/projects')} className="text-accent text-xs hover:underline">
          ← Back to Projects
        </button>
      </div>
    );
  }

  const activeGoals = goals.filter((g) => g.status === 'active' || g.status === 'at_risk');
  const completedGoals = goals.filter((g) => g.status === 'complete');
  const overallProgress = goals.length > 0
    ? Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / goals.length)
    : 0;

  // Calculate overall project health from deadline vs progress data
  const { projectStatus, statusInsight } = (() => {
    const now = Date.now();
    const incomplete    = goals.filter(g => g.status !== 'complete' && g.deadline);
    const withDeadlines = goals.filter(g => g.deadline).length;
    const total = goals.length;

    if (incomplete.length === 0) {
      const reason = total === 0
        ? 'No tasks yet'
        : goals.every(g => g.status === 'complete')
          ? `All ${total} task${total !== 1 ? 's' : ''} complete`
          : `${total} task${total !== 1 ? 's' : ''} · none with deadlines`;
      return { projectStatus: 'on_plan' as const, statusInsight: reason };
    }

    let missedCount = 0;
    let criticalCount = 0;
    let behindCount = 0;

    for (const g of incomplete) {
      const deadlineMs = new Date(g.deadline!).getTime();
      const createdMs  = new Date(g.created_at).getTime();
      const daysUntil  = (deadlineMs - now) / 86_400_000;

      if (daysUntil < 0) { missedCount++; continue; }

      const totalDuration = deadlineMs - createdMs;
      const elapsed       = now - createdMs;
      const expected      = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;
      const deficit       = expected - g.progress;

      if (daysUntil <= 21 && deficit > 40) criticalCount++;
      else if (daysUntil <= 45 && deficit > 30) behindCount++;
    }

    const status =
      (missedCount >= 1 || criticalCount >= 2) ? 'off_track' as const :
      (criticalCount >= 1 || behindCount >= 2) ? 'at_risk'   as const :
      'on_plan' as const;

    const lines: string[] = [`${withDeadlines} of ${total} tasks have deadlines`];
    if (missedCount)   lines.push(`${missedCount} overdue (past deadline)`);
    if (criticalCount) lines.push(`${criticalCount} critical (≤21 days left, >40pt behind)`);
    if (behindCount)   lines.push(`${behindCount} at risk (≤45 days left, >30pt behind)`);
    if (!missedCount && !criticalCount && !behindCount) lines.push('All deadlines on track');

    return { projectStatus: status, statusInsight: lines.join('\n') };
  })();

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setGoalCreateError(null);
    setGoalCreateNotice(null);
    setCreatingGoal(true);
    try {
      const reservedColors: string[] = [];
      const resolvedCategory = await resolveInlineProjectLabel('category', newGoalCategory, newGoalCategoryDraft, reservedColors);
      const resolvedLoe = await resolveInlineProjectLabel('loe', newGoalLoe, newGoalLoeDraft, reservedColors);
      if (!newGoalTitle.trim() || !newGoalDeadline || !resolvedCategory || !resolvedLoe) {
        throw new Error('Title, deadline, category, and line of effort are required.');
      }

      const newGoal = await createGoal({
        title: newGoalTitle.trim(),
        description: newGoalNotes.trim() || undefined,
        deadline: newGoalDeadline,
        category: resolvedCategory,
        loe: resolvedLoe,
        assignees: newGoalAssignees,
      });
      closeGoalModal();
      // Auto-generate AI guidance in background after creation
      if (newGoal?.id) {
        fetch(`${API_BASE}/ai/task-guidance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent, projectId, taskTitle: newGoal.title, taskStatus: newGoal.status, taskProgress: newGoal.progress, taskCategory: newGoal.category, taskLoe: newGoal.loe }),
        }).then((r) => r.ok ? r.json() : null).then((data) => {
          if (data?.guidance) updateGoal(newGoal.id, { ai_guidance: data.guidance }).catch(() => {});
        }).catch(() => {});
      }
    } catch (err: any) {
      setGoalCreateError(err?.message ?? 'Unable to create task.');
    } finally {
      setCreatingGoal(false);
    }
  };

  const handleCreateTasksFromNotes = async (file: File | null | undefined) => {
    if (!file || !projectId) return;
    setGoalCreateError(null);
    setGoalCreateNotice(null);
    setCreatingFromNotes(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      if (!authToken) throw new Error('Please sign in again and retry.');

      const extractForm = new FormData();
      extractForm.append('projectId', projectId);
      extractForm.append('filename', file.name);
      extractForm.append('file', file);

      const extractRes = await fetch(`${API_BASE}/uploads/extract-text`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: extractForm,
      });
      const extractData = await extractRes.json() as { text?: string; error?: string };
      if (!extractRes.ok || !extractData.text?.trim()) {
        throw new Error(extractData.error ?? 'Could not read the notes file.');
      }

      const aiRes = await fetch(`${API_BASE}/ai/meeting-notes-tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent,
          projectId,
          fileContent: extractData.text.slice(0, 50_000),
          fileName: file.name,
          existingTaskTitles: goals.map((goal) => goal.title),
        }),
      });
      const aiData = await aiRes.json() as {
        tasks?: Array<{ title: string; description?: string; category?: string | null; loe?: string | null; deadline?: string | null }>;
        error?: string;
      };
      if (!aiRes.ok) {
        throw new Error(aiData.error ?? 'Failed to analyze the notes.');
      }

      const tasks = (aiData.tasks ?? [])
        .filter((task) => task.title?.trim())
        .slice(0, 30);

      if (tasks.length === 0) {
        setGoalCreateNotice('No concrete tasks were found in those notes.');
        return;
      }

      for (const task of tasks) {
        await createGoal({
          title: task.title.trim(),
          ...(task.description ? { description: task.description } : {}),
          ...(task.deadline ? { deadline: task.deadline } : {}),
          ...(task.category ? { category: task.category } : {}),
          ...(task.loe ? { loe: task.loe } : {}),
        });
      }

      closeGoalModal();
      setGoalCreateNotice(`Created ${tasks.length} task${tasks.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (err) {
      setGoalCreateError(err instanceof Error ? err.message : 'Unable to create tasks from notes.');
    } finally {
      setCreatingFromNotes(false);
      if (createFromNotesInputRef.current) createFromNotesInputRef.current.value = '';
    }
  };

  const currentMemberProfile = members.find((m) => m.user_id === user?.id)?.profile;

  // Build assignee lookup from members + current user
  const allMembers = Array.from(new Map(
    [
      {
        user_id: user?.id ?? '',
        display_name: currentMemberProfile?.display_name ?? user?.user_metadata?.user_name ?? user?.email ?? 'You',
        avatar_url: currentMemberProfile?.avatar_url ?? user?.user_metadata?.avatar_url ?? null,
      },
      ...members.map((m) => ({ user_id: m.user_id, display_name: getProjectMemberDisplayName(m), avatar_url: m.profile?.avatar_url ?? null })),
    ]
      .filter((member) => member.user_id)
      .map((member) => [member.user_id, member] as const),
  ).values());
  function getAssignee(userId: string | null | undefined) {
    if (!userId) return null;
    return allMembers.find((m) => m.user_id === userId) ?? null;
  }

  const projectFingerprint = getProjectFingerprint(project.id);

  return (
    <>
    <div className="p-8 max-w-6xl mx-auto">
      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate('/projects')}
        className="flex items-center gap-1 text-muted hover:text-heading text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Back to Projects
      </button>

      {/* Project Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between gap-5 mb-1">
          <div className="flex items-center gap-5 min-w-0 flex-1">
            <div className="w-24 h-24 rounded-2xl border border-border bg-surface overflow-hidden flex items-center justify-center shrink-0">
              {project.image_url ? (
                <img src={project.image_url} alt={project.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-muted/40">{project.name[0]?.toUpperCase()}</span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                {editingName ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const trimmed = nameInput.trim();
                      if (trimmed && trimmed !== project.name) await updateProject({ name: trimmed });
                      setEditingName(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      autoFocus
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditingName(false); }}
                      onBlur={async () => {
                        const trimmed = nameInput.trim();
                        if (trimmed && trimmed !== project.name) await updateProject({ name: trimmed });
                        setEditingName(false);
                      }}
                      title="Project name"
                      placeholder="Project name"
                      className="font-sans text-3xl font-extrabold text-heading tracking-tight bg-transparent border-b-2 border-accent focus:outline-none min-w-[8rem] max-w-xl"
                    />
                  </form>
                ) : (
                  <h1
                    onClick={() => { setNameInput(project.name); setEditingName(true); }}
                    title="Click to rename"
                    className="font-sans text-3xl font-extrabold text-heading tracking-tight cursor-pointer hover:text-accent transition-colors"
                  >
                    {project.name}
                  </h1>
                )}
                <div className="relative group/status">
                  <StatusBadge status={projectStatus} size="md" />
                  <div className="absolute left-0 top-full mt-2 w-64 z-50 pointer-events-none opacity-0 group-hover/status:opacity-100 transition-opacity duration-150">
                    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl p-3">
                      <p className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)] font-semibold mb-1.5">Schedule Health</p>
                      {statusInsight.split('\n').map((line, i) => (
                        <p key={i} className={`text-xs font-mono ${i === 0 ? 'text-[var(--color-heading)]' : 'text-[var(--color-muted)] mt-0.5'}`}>{line}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {project.description && (
                <p className="text-sm text-muted">{project.description}</p>
              )}
              <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-mono">Project Hash</span>
                <span className="text-xs font-mono text-heading">{projectFingerprint}</span>
              </div>
            </div>
          </div>
          <div className="relative group shrink-0">
            <button
              type="button"
              onClick={() => setIuOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
            >
              <Sparkles size={13} /> Intelligent Update
            </button>
            <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-surface border border-border rounded-lg shadow-xl text-xs font-sans leading-relaxed opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 z-50">
              <p className="text-heading font-semibold mb-1">Intelligent Update</p>
              <p className="text-muted">Analyzes your goals, commits, and activity across all linked repos, then proposes specific changes — new goals, deadline shifts, and priority updates — based on what's actually happening in the project.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-px border border-border bg-border mb-8">
        {visibleTabs.map((vt) => {
          const tabMeta = tabs.find((t) => t.id === vt.id)!;
          return (
            <button
              type="button"
              key={tabMeta.id}
              onClick={() => handleTabChange(tabMeta.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 bg-surface text-xs tracking-wider uppercase transition-colors whitespace-nowrap first:rounded-tl last:rounded-tr ${
                activeTab === tabMeta.id
                  ? 'text-heading bg-surface2 font-medium'
                  : 'text-muted hover:text-heading hover:bg-surface2'
              }`}
            >
              <tabMeta.icon size={13} />
              {tabMeta.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <ErrorBoundary label="Overview Tab">
          <Suspense fallback={<SuspenseFallback label="Loading overview…" />}>
            <OverviewTab
              project={project}
              goals={goals}
              completedGoals={completedGoals}
              activeGoals={activeGoals}
              overallProgress={overallProgress}
              members={members}
              events={events}
              eventsLoading={eventsLoading}
              user={user}
              hasCommitData={hasCommitData}
              setHasCommitData={setHasCommitData}
              gitlabRepos={gitlabRepos}
              filePaths={filePaths}
              insights={insights}
              insightsLoading={insightsLoading}
              insightsError={insightsError}
              standup={standup}
              standupLoading={standupLoading}
              standupError={standupError}
              handleGenerateInsights={handleGenerateInsights}
              handleGenerateStandup={handleGenerateStandup}
              handleFileClick={handleFileClick}
              handleRepoClick={handleRepoClick}
              setEditGoal={setEditGoal}
              setEditAutoGuidance={setEditAutoGuidance}
              setActiveTab={handleTabChange}
              handlePromoteMember={handlePromoteMember}
              categoryLabels={projectCategories.map((c) => ({ id: c.id, name: c.name }))}
              loeLabels={projectLoes.map((l) => ({ id: l.id, name: l.name }))}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {activeTab === 'timeline' && (
        <Suspense fallback={<SuspenseFallback label="Loading timeline…" />}>
          <TimelinePage
            goals={goals}
            projectName={project.name}
            projectId={project.id}
            members={[
              ...(user ? [{ user_id: user.id, display_name: user.user_metadata?.user_name ?? user.user_metadata?.full_name ?? user.email ?? 'You' }] : []),
              ...members.map((m) => ({ user_id: m.user_id, display_name: m.profile?.display_name ?? null })),
            ]}
            projectCategories={projectCategories.map((c) => c.name)}
            projectLoes={projectLoes.map((l) => l.name)}
            onGoalClick={(g) => { setEditAutoGuidance(false); setEditGoal(g); }}
            onCreateGoalForDate={(dateStr) => { setNewGoalDeadline(dateStr); goalModal.onOpen(); }}
          />
        </Suspense>
      )}

      {activeTab === 'activity' && (
        <ErrorBoundary label="Activity Tab">
          <Suspense fallback={<SuspenseFallback label="Loading activity…" />}>
            <ActivityTab
              project={project}
              goals={goals}
              events={events}
              eventsLoading={eventsLoading}
              hasCommitData={hasCommitData}
              setHasCommitData={setHasCommitData}
              members={members}
              user={user}
              taskGuidance={taskGuidance}
              guidanceVisible={guidanceVisible}
              setGuidanceVisible={setGuidanceVisible}
              handleTaskGuidance={handleTaskGuidance}
              getAssignee={getAssignee}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {activeTab === 'goals' && (
        <ErrorBoundary label="Goals Tab">
          <Suspense fallback={<SuspenseFallback label="Loading tasks…" />}>
            <GoalsTab
              goals={goals}
              events={events}
              projectId={projectId ?? null}
              searchRef={searchRef}
              projectCategories={projectCategories.map((c) => c.name)}
              projectLoes={projectLoes.map((l) => l.name)}
              riskAssessing={riskAssessing}
              riskReport={riskReport}
              riskPanelOpen={riskPanelOpen}
              setRiskPanelOpen={setRiskPanelOpen}
              syncingProgress={syncingProgress}
              syncResult={syncResult}
              setSyncResult={setSyncResult}
              syncError={syncError}
              goalDependencies={goalDependencies}
              timeLogTotals={timeLogTotals}
              getAssignee={getAssignee}
              handleAssessRisk={handleAssessRisk}
              handleSyncOfficeProgress={handleSyncOfficeProgress}
              updateGoal={updateGoal}
              deleteGoal={deleteGoal}
              setEditGoal={setEditGoal}
              setEditAutoGuidance={setEditAutoGuidance}
              setActiveTab={handleTabChange}
              goalModalOnOpen={goalModal.onOpen}
              createGoal={createGoal}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {activeTab === 'coordination' && (
        <ErrorBoundary label="Coordination Tab">
          <Suspense fallback={<SuspenseFallback label="Loading coordination…" />}>
            <CoordinationTab
              projectId={project.id}
              isOwner={isOwner}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {activeTab === 'metrics' && (
        <Suspense fallback={<SuspenseFallback label="Loading metrics…" />}>
          <GoalMetrics
            goals={goals}
            members={members.map((m) => ({
              user_id: m.user_id,
              display_name: m.profile?.display_name ?? null,
              avatar_url: m.profile?.avatar_url ?? null,
            }))}
            currentUserId={user?.id ?? ''}
            currentUserName={currentMemberProfile?.display_name ?? user?.user_metadata?.user_name ?? user?.email ?? 'You'}
            currentUserAvatar={currentMemberProfile?.avatar_url ?? user?.user_metadata?.avatar_url}
            onAssignTask={(goalId, userId) => updateGoal(goalId, { assigned_to: userId })}
            timeLogs={timeLogs}
          />
        </Suspense>
      )}

      {activeTab === 'financials' && (
        <ErrorBoundary label="Financials Tab">
          <Suspense fallback={<SuspenseFallback label="Loading financials…" />}>
            <FinancialsTab projectId={project.id} />
          </Suspense>
        </ErrorBoundary>
      )}

      {activeTab === 'reports' && (
        <Suspense fallback={<SuspenseFallback label="Loading reports…" />}>
          <ReportsTab
            projectId={project.id}
            projectName={project.name}
            projectStartDate={project.start_date ?? null}
            githubRepo={githubRepos}
            gitlabRepos={gitlabRepos}
            messages={reportMessages}
            onMessagesChange={setReportMessages}
            onReportSaved={() => setSavedReportsVersion((v) => v + 1)}
          />
        </Suspense>
      )}

      {activeTab === 'documents' && (
        <DocumentsTab
          events={events}
          eventsLoading={eventsLoading}
          projectId={projectId!}
          docEditMode={docEditMode}
          setDocEditMode={setDocEditMode}
          docSelected={docSelected}
          setDocSelected={setDocSelected}
          bulkDeleting={bulkDeleting}
          setBulkDeleting={setBulkDeleting}
          deletingEventId={deletingEventId}
          setDeletingEventId={setDeletingEventId}
          onRefresh={refetchEvents}
          savedReportsVersion={savedReportsVersion}
        />
      )}

      {activeTab === 'integrations' && (
        <IntegrationsPreviewTab
          projectId={projectId!}
          project={project ? { name: project.name, github_repo: primaryGitHubRepo, github_repos: githubRepos } : null}
          githubRepo={githubRepos}
          gitlabRepos={gitlabRepos}
          goals={goals.map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress ?? 0 }))}
          o365Docs={events.filter((e) => e.source === 'local')}
          onNavigateSettings={() => handleTabChange('settings')}
        />
      )}

      {activeTab === 'settings' && (
        <ErrorBoundary label="Settings Tab">
          <Suspense fallback={<SuspenseFallback label="Loading settings…" />}>
            <SettingsTab
              project={project}
              projectId={projectId!}
              isOwner={isOwner}
              members={members}
              user={user}
              joinRequests={joinRequests}
              respondJoinRequest={respondJoinRequest}
              refetchJoinRequests={refetchJoinRequests}
              inviteRole={inviteRole}
              setInviteRole={setInviteRole}
              inviteTab={inviteTab}
              setInviteTab={setInviteTab}
              memberSearch={memberSearch}
              setMemberSearch={setMemberSearch}
              memberSearching={memberSearching}
              sharedInviteCandidates={invitableSharedPeople}
              sharedInviteLoading={sharedPeopleLoading}
              repoInput={repoInput}
              setRepoInput={setRepoInput}
              repoSaving={repoSaving}
              scanResults={scanResults}
              events={events}
              auditFrom={auditFrom}
              setAuditFrom={setAuditFrom}
              auditTo={auditTo}
              setAuditTo={setAuditTo}
              auditPreset={auditPreset}
              setAuditPreset={setAuditPreset}
              auditType={auditType}
              setAuditType={setAuditType}
              auditPage={auditPage}
              setAuditPage={setAuditPage}
              AUDIT_PAGE_SIZE={AUDIT_PAGE_SIZE}
              imageUploading={imageUploading}
              projectLabels={projectLabels}
              editPromptFeature={editPromptFeature}
              setEditPromptFeature={setEditPromptFeature}
              editPromptText={editPromptText}
              setEditPromptText={setEditPromptText}
              resetPromptsTyped={resetPromptsTyped}
              setResetPromptsTyped={setResetPromptsTyped}
              resetPromptsModalOpen={resetPromptsModalOpen}
              setResetPromptsModalOpen={setResetPromptsModalOpen}
              deletingProject={deletingProject}
              leavingProject={leavingProject}
              goals={goals}
              updateProject={updateProject}
              updateGoal={updateGoal}
              createGoal={createGoal}
              handleSaveRepo={handleSaveRepo}
              handleRepoScan={handleRepoScan}
              scanLoading={scanLoading}
              handleInviteByIdentifier={handleInviteByIdentifier}
              handleInviteSharedCollaborator={handleInviteSharedCollaborator}
              handleRemoveMember={handleRemoveMember}
              handlePromoteMember={handlePromoteMember}
              handleImageUpload={handleImageUpload}
              handleExportAuditCSV={handleExportAuditCSV}
              addLabel={addLabel}
              deleteLabel={deleteLabel}
              getPrompt={getPrompt}
              savePrompt={savePrompt}
              resetPrompt={resetPrompt}
              resetAllPrompts={resetAllPrompts}
              setDeleteModalOpen={setDeleteModalOpen}
              setGitlabRepos={setGitlabRepos}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>

    {deleteModalOpen && project && (
      <DeleteProjectModal
        projectName={project.name}
        busy={deletingProject || leavingProject}
        onRemove={handleRemoveProject}
        onDelete={handleDeleteProject}
        onClose={() => {
          if (!deletingProject && !leavingProject) setDeleteModalOpen(false);
        }}
      />
    )}

    {/* Add Task Modal — rendered globally so it works from any tab (timeline, calendar, tasks) */}
    <Modal open={goalModal.open} onClose={closeGoalModal} title="Add Task">
      <form onSubmit={handleCreateGoal} className="space-y-4">
        {goalCreateError && (
          <div className="rounded-md border border-[#D94F4F]/40 bg-[#D94F4F]/10 px-3 py-2 text-xs font-mono text-[#ffb3b3]">
            {goalCreateError}
          </div>
        )}
        {goalCreateNotice && (
          <div className="rounded-md border border-accent2/30 bg-accent2/10 px-3 py-2 text-xs font-mono text-heading">
            {goalCreateNotice}
          </div>
        )}
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Title</label>
          <input
            type="text"
            value={newGoalTitle}
            onChange={(e) => setNewGoalTitle(e.target.value)}
            required
            placeholder="e.g. Complete API integration"
            className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Notes</label>
          <textarea
            value={newGoalNotes}
            onChange={(e) => setNewGoalNotes(e.target.value)}
            rows={3}
            placeholder="Capture fuller context, dependencies, or pertinent details for this task."
            className="w-full px-4 py-2.5 bg-surface border border-border text-heading text-sm leading-relaxed placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors resize-y min-h-[92px]"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Deadline</label>
          <input
            type="date"
            value={newGoalDeadline}
            onChange={(e) => setNewGoalDeadline(e.target.value)}
            required
            title="Task deadline"
            className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Category</label>
            <select
              value={newGoalCategory}
              onChange={(e) => {
                setNewGoalCategory(e.target.value);
                if (e.target.value !== CREATE_NEW_CATEGORY_VALUE) setNewGoalCategoryDraft('');
              }}
              title="Task category"
              className="w-full px-3 py-2.5 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
            >
              <option value="">— Select —</option>
              <option value={CREATE_NEW_CATEGORY_VALUE}>+ Add New Category</option>
              {projectCategories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            {newGoalCategory === CREATE_NEW_CATEGORY_VALUE && (
              <input
                type="text"
                value={newGoalCategoryDraft}
                onChange={(e) => setNewGoalCategoryDraft(e.target.value)}
                placeholder="Enter new category"
                className="mt-2 w-full px-3 py-2.5 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
              />
            )}
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Line of Effort</label>
            <select
              value={newGoalLoe}
              onChange={(e) => {
                setNewGoalLoe(e.target.value);
                if (e.target.value !== CREATE_NEW_LOE_VALUE) setNewGoalLoeDraft('');
              }}
              title="Line of Effort"
              className="w-full px-3 py-2.5 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
            >
              <option value="">— Select —</option>
              <option value={CREATE_NEW_LOE_VALUE}>+ Add New LOE</option>
              {projectLoes.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
            {newGoalLoe === CREATE_NEW_LOE_VALUE && (
              <input
                type="text"
                value={newGoalLoeDraft}
                onChange={(e) => setNewGoalLoeDraft(e.target.value)}
                placeholder="Enter new LOE"
                className="mt-2 w-full px-3 py-2.5 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
              />
            )}
          </div>
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
            Assign To <span className="text-muted/60 normal-case tracking-normal">(select multiple)</span>
          </label>
          <div className="border border-border divide-y divide-border/50 max-h-28 overflow-y-auto">
            {allMembers.map((m) => {
              const checked = newGoalAssignees.includes(m.user_id);
              return (
                <label key={m.user_id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface2 transition-colors">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setNewGoalAssignees((prev) =>
                      checked ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]
                    )}
                    className="accent-accent w-3 h-3 shrink-0"
                  />
                  <span className="text-sm font-mono text-heading truncate">{m.display_name}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex gap-3 pt-2 flex-wrap">
          <button
            type="submit"
            disabled={creatingGoal}
            className="px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingGoal ? 'Creating…' : 'Create Task'}
          </button>

          <input
            ref={createFromNotesInputRef}
            type="file"
            accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={(event) => void handleCreateTasksFromNotes(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={creatingGoal || creatingFromNotes}
            onClick={() => createFromNotesInputRef.current?.click()}
            className="px-6 py-2.5 border border-accent2/30 text-accent2 text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent2/10 transition-colors rounded-md disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingFromNotes ? 'Analyzing Notes…' : 'Create From Notes'}
          </button>

          <button type="button" disabled={creatingGoal || creatingFromNotes} onClick={closeGoalModal} className="px-6 py-2.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md disabled:cursor-not-allowed disabled:opacity-60">
            Cancel
          </button>
        </div>
      </form>
    </Modal>

    {/* Goal Edit Modal */}
    {editGoal && (
      <Suspense fallback={<SuspenseFallback label="Loading task editor…" />}>
        <GoalEditModal
          goal={editGoal}
          members={allMembers.map((m) => ({ user_id: m.user_id, display_name: m.display_name }))}
          projectId={project.id}
          agent={agent}
          autoGuidance={editAutoGuidance}
          allGoals={goals.filter((g) => g.id !== editGoal.id)}
          filePaths={filePaths}
          githubRepo={githubRepos}
          gitlabRepos={gitlabRepos}
          projectCategories={projectCategories.map((c) => c.name)}
          projectLoes={projectLoes.map((l) => l.name)}
          onCreateProjectLabel={createProjectLabelIfNeeded}
          onFileClick={handleFileClick}
          onRepoClick={handleRepoClick}
          onTaskClick={(id) => {
            const g = goals.find((g) => g.id === id);
            if (g) {
              setEditAutoGuidance(false);
              setEditGoal(g);
            }
          }}
          onSave={async (id, updates) => { await updateGoal(id, updates); setEditGoal(null); }}
          onSilentSave={async (id, updates) => { await updateGoal(id, updates); }}
          onClose={handleGoalEditClose}
        />
      </Suspense>
    )}

    {/* Goal Report Modal */}
    {reportGoal && (
      <Suspense fallback={<SuspenseFallback label="Loading report…" />}>
        <GoalReportModal
          goal={reportGoal}
          projectId={project.id}
          onClose={() => setReportGoal(null)}
        />
      </Suspense>
    )}



    {/* ── File Preview Modal (code files from GitHub/GitLab) ─────────────── */}
    {previewFileRef && (
      <Suspense fallback={<SuspenseFallback label="Loading file preview…" />}>
        <FilePreviewModal
          fileRef={previewFileRef}
          content={previewContent}
          loading={previewLoading}
          error={previewError}
          onClose={() => { setPreviewFileRef(null); setPreviewContent(null); setPreviewError(null); }}
        />
      </Suspense>
    )}

    {/* ── Repo Tree Modal (browse repo files from AI insight links) ────────── */}
    {repoTreeTarget && (
      <Suspense fallback={<SuspenseFallback label="Loading repository browser…" />}>
        <RepoTreeModal
          repo={repoTreeTarget.repo}
          type={repoTreeTarget.type}
          projectId={repoTreeTarget.projectId}
          onClose={() => setRepoTreeTarget(null)}
        />
      </Suspense>
    )}
    {aiErrorDialog}

    </>
  );
}

// ── Documents Tab ────────────────────────────────────────────────────────────
interface SavedReport {
  id: string;
  title: string;
  content: Record<string, unknown>;
  format: string;
  date_range_from: string | null;
  date_range_to: string | null;
  generated_at: string;
  provider: string | null;
}

interface DocumentsTabProps {
  events: import('../types').OdysseyEvent[];
  eventsLoading: boolean;
  projectId: string;
  docEditMode: boolean;
  setDocEditMode: (v: boolean) => void;
  docSelected: Set<string>;
  setDocSelected: (v: Set<string>) => void;
  bulkDeleting: boolean;
  setBulkDeleting: (v: boolean) => void;
  deletingEventId: string | null;
  setDeletingEventId: (v: string | null) => void;
  onRefresh: () => void;
  savedReportsVersion?: number;
}

function DocumentsTab({
  events, eventsLoading, projectId,
  docEditMode, setDocEditMode,
  docSelected, setDocSelected,
  bulkDeleting, setBulkDeleting,
  deletingEventId, setDeletingEventId,
  onRefresh,
  savedReportsVersion = 0,
}: DocumentsTabProps) {
  const docs = events.filter((e) => e.source === 'local');
  const allSelected = docSelected.size === docs.length && docs.length > 0;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Saved reports ──────────────────────────────────────────────────────────
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [previewReport, setPreviewReport] = useState<SavedReport | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('saved_reports')
      .select('id, title, content, format, date_range_from, date_range_to, generated_at, provider')
      .eq('project_id', projectId)
      .order('generated_at', { ascending: false })
      .then(({ data }) => { if (data) setSavedReports(data as SavedReport[]); });
  }, [projectId, savedReportsVersion]);

  const handleDeleteReport = async (id: string) => {
    setDeletingReportId(id);
    await supabase.from('saved_reports').delete().eq('id', id);
    setSavedReports((prev) => prev.filter((r) => r.id !== id));
    setDeletingReportId(null);
    if (previewReport?.id === id) setPreviewReport(null);
  };

  const toggleRow = (id: string) => {
    const next = new Set(docSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setDocSelected(next);
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(docSelected);
    // Also delete from storage for any files that have a storage_path
    await Promise.all(ids.map(async (id) => {
      const ev = docs.find((d) => d.id === id);
      const meta = ev?.metadata as { storage_path?: string } | undefined;
      if (meta?.storage_path) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch('/api/uploads/file', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ storagePath: meta.storage_path }),
          });
        }
      }
      return deleteImportedEvent(id);
    }));
    setDocSelected(new Set());
    setDocEditMode(false);
    setBulkDeleting(false);
    onRefresh();
  };

  const handleSingleDelete = async (id: string) => {
    setDeletingEventId(id);
    const ev = docs.find((d) => d.id === id);
    const meta = ev?.metadata as { storage_path?: string } | undefined;
    if (meta?.storage_path) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await fetch('/api/uploads/file', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ storagePath: meta.storage_path }),
        });
      }
    }
    await deleteImportedEvent(id);
    setDeletingEventId(null);
    onRefresh();
  };

  const handleDownload = async (e: import('../types').OdysseyEvent) => {
    const meta = e.metadata as { storage_path?: string; filename?: string } | undefined;
    if (!meta?.storage_path) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('/api/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ storagePath: meta.storage_path }),
    });
    if (!res.ok) return;
    const { url } = await res.json();
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.filename ?? e.title ?? 'download';
    a.click();
  };

  const [previewDoc, setPreviewDoc] = useState<{ url: string; title: string; filename: string } | null>(null);

  const handlePreview = async (e: import('../types').OdysseyEvent) => {
    const meta = e.metadata as { storage_path?: string; filename?: string } | undefined;
    if (!meta?.storage_path) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('/api/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ storagePath: meta.storage_path }),
    });
    if (!res.ok) return;
    const { url } = await res.json();
    setPreviewDoc({ url, title: e.title ?? 'Document', filename: meta.filename ?? e.title ?? 'file' });
  };

  const handleUpload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setUploadError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setUploading(false); return; }
    for (const file of files) {
      const form = new FormData();
      form.append('projectId', projectId);
      form.append('filename', file.name);
      form.append('file', file);
      const res = await fetch('/api/uploads/local', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        setUploadError(err.error ?? 'Upload failed');
        setUploading(false);
        return;
      }
    }
    setUploading(false);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-sans text-sm font-bold text-heading">Documents</h3>
          <p className="text-[11px] text-muted font-mono mt-0.5">Imported files available to AI analysis</p>
        </div>
        <div className="flex items-center gap-2">
          {docEditMode ? (
            <>
              <button
                type="button"
                onClick={() => setDocSelected(allSelected ? new Set() : new Set(docs.map((d) => d.id)))}
                className="text-xs text-muted hover:text-heading border border-border px-3 py-1.5 rounded transition-colors"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
              {docSelected.size > 0 && (
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-400/30 text-red-400 text-xs font-semibold uppercase tracking-wider rounded hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkDeleting
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Trash2 size={11} />}
                  {bulkDeleting ? 'Deleting…' : `Delete ${docSelected.size} file${docSelected.size !== 1 ? 's' : ''}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setDocEditMode(false); setDocSelected(new Set()); }}
                className="text-xs text-muted hover:text-heading border border-border px-3 py-1.5 rounded transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {docs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDocEditMode(true)}
                  className="text-xs text-muted hover:text-heading border border-border px-3 py-1.5 rounded transition-colors"
                >
                  Edit
                </button>
              )}
              <label
                title="Upload PDF, DOCX, or text file"
                className={`flex items-center gap-2 px-4 py-2 border border-border text-xs font-sans font-semibold tracking-wider uppercase transition-colors rounded-md cursor-pointer ${uploading ? 'opacity-50 pointer-events-none text-muted' : 'text-muted hover:text-heading hover:bg-surface2'}`}
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {uploading ? 'Uploading…' : 'Upload File'}
                <input
                  type="file"
                  title="Upload PDF, DOCX, or text file"
                  className="sr-only"
                  multiple
                  accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md,.csv,.json"
                  onChange={async (e) => {
                    await handleUpload(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">{uploadError}</div>
      )}

      {eventsLoading ? (
        <div className="text-xs text-muted py-4">Loading…</div>
      ) : (
        <div className="space-y-px border border-border bg-border">
          {docs.map((e) => (
            <div
              key={e.id}
              className={`flex items-start gap-3 bg-surface px-4 py-3 group transition-colors ${docEditMode ? 'cursor-pointer hover:bg-surface2' : ''} ${docEditMode && docSelected.has(e.id) ? '!bg-accent/5' : ''}`}
              onClick={docEditMode ? () => toggleRow(e.id) : undefined}
            >
              {docEditMode && (
                <div className="mt-1 shrink-0">
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    docSelected.has(e.id) ? 'bg-accent border-accent' : 'border-border bg-surface'
                  }`}>
                    {docSelected.has(e.id) && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                  </div>
                </div>
              )}
              <div className="mt-0.5 shrink-0">
                {e.source === 'onenote'
                  ? <span className="text-[10px] font-mono text-accent3 border border-accent3/30 px-1 py-0.5 rounded">NOTE</span>
                  : e.source === 'local'
                  ? <span className="text-[10px] font-mono text-accent border border-accent/30 px-1 py-0.5 rounded">LOCAL</span>
                  : e.source === 'teams'
                  ? <span className="text-[10px] font-mono text-purple-400 border border-purple-400/30 px-1 py-0.5 rounded">TEAMS</span>
                  : <span className="text-[10px] font-mono text-accent2 border border-accent2/30 px-1 py-0.5 rounded">FILE</span>
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading font-medium truncate">{e.title}</div>
                {e.summary && <div className="text-[11px] text-muted mt-0.5 line-clamp-2">{e.summary}</div>}
                <div className="text-[10px] text-muted mt-1 font-mono">
                  {new Date(e.occurred_at).toLocaleDateString()} · {e.source}
                  {(e.metadata as { size_bytes?: number })?.size_bytes
                    ? ` · ${((e.metadata as { size_bytes: number }).size_bytes / 1024).toFixed(0)} KB`
                    : ''}
                </div>
              </div>
              {!docEditMode && (
                <div className="flex items-center gap-6 shrink-0">
                  {/* Preview — sits further left, separated from the download/delete cluster */}
                  {(e.metadata as { storage_path?: string })?.storage_path && (
                    <button
                      type="button"
                      title="Preview file"
                      onClick={() => handlePreview(e)}
                      className="text-[10px] text-accent hover:underline"
                    >
                      Preview
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    {(e.metadata as { web_url?: string })?.web_url && (
                      <a
                        href={(e.metadata as { web_url: string }).web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-accent hover:underline"
                      >
                        Open
                      </a>
                    )}
                    {(e.metadata as { storage_path?: string })?.storage_path && (
                      <button
                        type="button"
                        title="Download file"
                        onClick={() => handleDownload(e)}
                        className="text-[10px] text-accent hover:underline"
                      >
                        Download
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Remove from context"
                    disabled={deletingEventId === e.id}
                    onClick={() => handleSingleDelete(e.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger transition-all disabled:opacity-40"
                  >
                    {deletingEventId === e.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              )}
            </div>
          ))}
          {docs.length === 0 && (
            <div className="bg-surface px-4 py-8 text-center">
              <p className="text-xs text-muted">No documents yet. Upload a local file or import from Microsoft 365.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Historical Reports ─────────────────────────────────────────────── */}
      <div className="mt-8">
        <h4 className="text-[10px] tracking-[0.2em] uppercase text-muted font-semibold mb-3">Historical Reports</h4>
        {savedReports.length === 0 ? (
          <div className="border border-border bg-surface px-4 py-8 text-center">
            <p className="text-xs text-muted">No saved reports yet. Generate a report in the Reports tab.</p>
          </div>
        ) : (
          <div className="border border-border bg-surface divide-y divide-border">
            {savedReports.map((r) => {
              const fmtIcon = r.format === 'pptx' ? '📊' : r.format === 'pdf' ? '📄' : '📝';
              const dateStr = new Date(r.generated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
              const rangeStr = r.date_range_from && r.date_range_to
                ? `${r.date_range_from} → ${r.date_range_to}` : '';
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface2 transition-colors group">
                  <span className="text-base shrink-0">{fmtIcon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-heading font-medium truncate">{r.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted font-mono">{dateStr}</span>
                      {rangeStr && <span className="text-[10px] text-muted font-mono">{rangeStr}</span>}
                      {r.format && <span className="text-[9px] px-1.5 py-0.5 border border-border rounded text-muted font-mono uppercase">{r.format}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Preview report"
                    onClick={() => setPreviewReport(r)}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-[10px] border border-border text-muted rounded hover:text-heading hover:border-border/80 transition-all"
                  >
                    <FileText size={11} /> View
                  </button>
                  <button
                    type="button"
                    title="Download report"
                    onClick={async () => {
                      const rc = r.content as unknown as ReportContent;
                      const { downloadDocx, downloadPptx, downloadPdf } = await loadReportDownloads();
                      if (r.format === 'pptx') await downloadPptx(rc);
                      else if (r.format === 'pdf') await downloadPdf(rc);
                      else await downloadDocx(rc);
                    }}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-[10px] border border-border text-muted rounded hover:text-heading hover:border-border/80 transition-all"
                  >
                    <Download size={11} /> Download
                  </button>
                  <button
                    type="button"
                    title="Export goals as CSV"
                    onClick={async () => {
                      const { exportGoalsCSV } = await loadReportDownloads();
                      exportGoalsCSV(r.content as unknown as ReportContent);
                    }}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-[10px] border border-border text-muted rounded hover:text-heading hover:border-border/80 transition-all"
                  >
                    <Table size={11} /> CSV
                  </button>
                  <button
                    type="button"
                    title="Delete report"
                    onClick={() => handleDeleteReport(r.id)}
                    disabled={deletingReportId === r.id}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger transition-all disabled:opacity-40"
                  >
                    {deletingReportId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Report Preview Modal ───────────────────────────────────────────── */}
      {previewReport && (() => {
        const rc = previewReport.content as {
          title?: string; subtitle?: string; executiveSummary?: string;
          dateRange?: { from: string; to: string };
          sections?: Array<{ title: string; body: string; bullets?: string[]; table?: { headers: string[]; rows: string[][] } }>;
        };
        return (
          <>
            <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setPreviewReport(null)} />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
              <div className="w-full max-w-3xl max-h-[88vh] bg-surface border border-border shadow-2xl rounded-lg flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-heading font-sans truncate">{rc.title ?? previewReport.title}</h3>
                    {rc.subtitle && <p className="text-xs text-muted mt-0.5">{rc.subtitle}</p>}
                    {rc.dateRange && (
                      <p className="text-[10px] text-muted font-mono mt-1">{rc.dateRange.from} → {rc.dateRange.to}</p>
                    )}
                  </div>
                  <button type="button" title="Close" onClick={() => setPreviewReport(null)}
                    className="text-muted hover:text-heading transition-colors shrink-0 ml-4">
                    <X size={16} />
                  </button>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                  {/* Executive summary */}
                  {rc.executiveSummary && (
                    <div className="p-4 border border-border rounded bg-surface2">
                      <p className="text-[10px] tracking-[0.15em] uppercase text-muted font-semibold mb-2">Executive Summary</p>
                      <p className="text-xs text-heading leading-relaxed">{rc.executiveSummary}</p>
                    </div>
                  )}

                  {/* Sections */}
                  {(rc.sections ?? []).map((s, i) => (
                    <div key={i}>
                      <h4 className="text-xs font-bold text-heading mb-2 pb-1 border-b border-border">{s.title}</h4>
                      {s.body && <p className="text-xs text-muted leading-relaxed mb-2">{s.body}</p>}
                      {s.bullets && s.bullets.length > 0 && (
                        <ul className="space-y-1 mb-2">
                          {s.bullets.map((b, j) => (
                            <li key={j} className="flex items-start gap-2 text-xs text-muted">
                              <span className="text-accent shrink-0 mt-0.5">•</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.table && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px] border border-border">
                            <thead>
                              <tr className="bg-surface2">
                                {s.table.headers.map((h, j) => (
                                  <th key={j} className="px-3 py-1.5 text-left text-muted font-semibold border-b border-border">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {s.table.rows.map((row, j) => (
                                <tr key={j} className="border-b border-border/50 last:border-0 hover:bg-surface2/50">
                                  {row.map((cell, k) => (
                                    <td key={k} className="px-3 py-1.5 text-heading">{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-border bg-surface2 shrink-0 flex items-center justify-between">
                  <span className="text-[10px] text-muted">
                    Generated {new Date(previewReport.generated_at).toLocaleString()}
                    {previewReport.provider && ` · ${previewReport.provider}`}
                  </span>
                  <button type="button" onClick={() => setPreviewReport(null)}
                    className="px-3 py-1.5 text-xs text-muted border border-border rounded hover:text-heading transition-colors">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Document Preview Modal ─────────────────────────────────────────── */}
      {previewDoc && (() => {
        const ext = previewDoc.filename.split('.').pop()?.toLowerCase() ?? '';
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
        const isPdf   = ext === 'pdf';
        return (
          <>
            <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewDoc(null)} />
            <div className="fixed inset-4 z-50 flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] shrink-0">
                <span className="text-sm font-bold text-[var(--color-heading)] font-sans truncate">{previewDoc.title}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <a
                    href={previewDoc.url}
                    download={previewDoc.filename}
                    className="text-[10px] text-[var(--color-accent)] hover:underline font-mono flex items-center gap-1"
                  >
                    <Download size={11} /> Download
                  </a>
                  <button type="button" title="Close preview" onClick={() => setPreviewDoc(null)}
                    className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>
              {/* Preview body */}
              <div className="flex-1 overflow-hidden bg-[var(--color-surface2)]/30">
                {isPdf && (
                  <iframe
                    src={previewDoc.url}
                    title={previewDoc.title}
                    className="w-full h-full border-0"
                  />
                )}
                {isImage && (
                  <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
                    <img src={previewDoc.url} alt={previewDoc.title} className="max-w-full max-h-full object-contain rounded" />
                  </div>
                )}
                {!isPdf && !isImage && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                    <p className="text-sm text-[var(--color-muted)]">
                      Preview not available for <span className="font-mono">.{ext}</span> files.
                    </p>
                    <a
                      href={previewDoc.url}
                      download={previewDoc.filename}
                      className="text-[11px] text-[var(--color-accent)] hover:underline font-mono"
                    >
                      Download to view
                    </a>
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ── Integrations Preview Tab ─────────────────────────────────────────────────
interface CommitEntry { date: string; message: string; author: string }
interface FileEntry { path: string; size?: number }

interface IntegrationsPreviewTabProps {
  projectId: string;
  project: { name: string; github_repo?: string | null; github_repos?: string[] | null } | null;
  githubRepo: string | string[] | null;
  gitlabRepos: string[];
  goals: { id: string; title: string; status: string; progress: number }[];
  o365Docs: import('../types').OdysseyEvent[];
  onNavigateSettings: () => void;
}

// ── Collapsible folder tree ───────────────────────────────────────────────────
interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const f of files) {
    const parts = f.path.split('/');
    let nodes = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      let node = nodes.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path: parts.slice(0, i + 1).join('/'), children: [], isFile };
        nodes.push(node);
      }
      nodes = node.children;
    }
  }
  // Sort: folders first, then files, both alphabetical
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sort(n.children));
  };
  sort(root);
  return root;
}

function TreeNodeRow({ node, depth = 0, onOpenFile }: { node: TreeNode; depth?: number; onOpenFile?: (path: string) => void }) {
  // Root folders (depth 0) start open so structure is visible; subfolders start collapsed
  const [open, setOpen] = useState(false);
  // Pre-defined Tailwind padding classes per depth (up to 8 levels)
  const filePl  = ['pl-4',  'pl-7',  'pl-10', 'pl-14', 'pl-[68px]', 'pl-20', 'pl-24', 'pl-28'][Math.min(depth, 7)];
  const dirPl   = ['pl-1',  'pl-4',  'pl-7',  'pl-10', 'pl-14',     'pl-16', 'pl-20', 'pl-24'][Math.min(depth, 7)];

  if (node.isFile) {
    const ext = node.name.includes('.') ? node.name.split('.').pop() : '';
    return (
      <button
        type="button"
        onClick={() => onOpenFile?.(node.path)}
        className={`flex items-center gap-1.5 py-1 pr-4 w-full text-left hover:bg-surface2 cursor-pointer ${filePl}`}
      >
        <FileText size={10} className="text-muted shrink-0" />
        <span className="text-[11px] text-heading font-mono truncate flex-1 hover:text-accent transition-colors">{node.name}</span>
        {ext && <span className="text-[9px] text-muted/50 font-mono shrink-0">.{ext}</span>}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 w-full py-1 hover:bg-surface2 pr-4 text-left ${dirPl}`}
      >
        <ChevronRight size={11} className={`text-muted shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Folder size={11} className="text-accent/70 shrink-0" />
        <span className="text-[11px] text-heading font-mono font-medium truncate flex-1">{node.name}</span>
        <span className="text-[9px] text-muted/50 font-mono shrink-0">{node.children.length}</span>
      </button>
      {open && node.children.map((child) => (
        <TreeNodeRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}

function FolderTree({ files, onOpenFile }: { files: FileEntry[]; onOpenFile?: (path: string) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);
  if (tree.length === 0) return <div className="px-6 py-6 text-xs text-muted text-center">No files found.</div>;
  return (
    <div className="py-1">
      {tree.map((node) => <TreeNodeRow key={node.path} node={node} onOpenFile={onOpenFile} />)}
    </div>
  );
}

function RepoPanel({
  title,
  icon,
  source,
  repoId,
  repoLabel,
  repoUrl,
  titleExtra,
  commits,
  readme,
  files,
  loading,
  connected,
  onNavigateSettings,
  scanButton,
}: {
  title: string;
  icon: React.ReactNode;
  source: 'github' | 'gitlab';
  repoId: string;
  repoLabel?: string;
  repoUrl?: string;
  titleExtra?: React.ReactNode;
  commits: CommitEntry[];
  readme: string | null;
  files: FileEntry[];
  loading: boolean;
  connected: boolean;
  onNavigateSettings: () => void;
  scanButton?: React.ReactNode;
}) {
  const [view, setView] = useState<'commits' | 'files' | 'readme'>('files');
  const [fileSearch, setFileSearch] = useState('');
  const deferredFileSearch = useDeferredValue(fileSearch);
  const [openFile, setOpenFile] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    const normalizedSearch = deferredFileSearch.trim().toLowerCase();
    if (!normalizedSearch) return files;
    return files.filter((f) => f.path.toLowerCase().includes(normalizedSearch));
  }, [files, deferredFileSearch]);

  const externalFileUrl = (path: string) => {
    if (source === 'github') return `https://github.com/${repoId}/blob/HEAD/${path}`;
    return undefined; // GitLab host is env-specific; skip for now
  };

  return (
    <>
      {openFile && (
        <Suspense fallback={<SuspenseFallback label="Loading file viewer…" />}>
          <FileViewerLazy
            source={source}
            repo={repoId}
            path={openFile}
            externalUrl={externalFileUrl(openFile)}
            onClose={() => setOpenFile(null)}
          />
        </Suspense>
      )}

      <div className="border border-border bg-surface">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {icon}
            <span className="font-sans text-sm font-bold text-heading">{title}</span>
            {repoLabel && repoUrl && (
              <a href={repoUrl} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-accent hover:underline flex items-center gap-0.5 truncate max-w-[240px]">
                {repoLabel} <ExternalLink size={9} />
              </a>
            )}
            {repoLabel && !repoUrl && (
              <span className="text-[10px] text-muted truncate max-w-[240px]">{repoLabel}</span>
            )}
            {titleExtra}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scanButton}
            {!connected && (
              <button type="button" onClick={onNavigateSettings} className="text-[10px] text-accent hover:underline">
                Connect in Settings →
              </button>
            )}
          </div>
        </div>

        {!connected ? (
          <div className="px-6 py-8 text-center text-xs text-muted">No repository linked.</div>
        ) : loading ? (
          <div className="px-6 py-8 flex items-center justify-center gap-2 text-xs text-muted">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Sub-tabs */}
            <div className="flex border-b border-border">
              {(['files', 'commits', 'readme'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setView(t)}
                  className={`px-5 py-2 text-[10px] uppercase tracking-wider transition-colors ${
                    view === t ? 'text-heading border-b-2 border-accent font-medium' : 'text-muted hover:text-heading'
                  }`}>
                  {t === 'commits' ? `Commits (${commits.length})` : t === 'files' ? `Files (${files.length})` : 'README'}
                </button>
              ))}
            </div>

            {/* Commits view */}
            {view === 'commits' && (
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {commits.length === 0 && (
                  <div className="px-6 py-6 text-xs text-muted text-center">No commits found.</div>
                )}
                {commits.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 px-6 py-3">
                    <GitBranch size={11} className="text-muted mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-heading truncate">{c.message}</p>
                      <p className="text-[10px] text-muted">{c.author}{c.date ? ` · ${c.date}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Files view */}
            {view === 'files' && (
              <div>
                <div className="px-4 py-2 border-b border-border">
                  <input
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    placeholder="Filter files…"
                    className="w-full px-3 py-1.5 bg-surface2 border border-border text-xs text-heading placeholder:text-muted focus:outline-none focus:border-accent/50 rounded font-mono"
                  />
                </div>
                <div className="max-h-[480px] overflow-y-auto">
                  {deferredFileSearch ? (
                    <div className="divide-y divide-border/50">
                      {filteredFiles.length === 0 && (
                        <div className="px-6 py-6 text-xs text-muted text-center">No files match.</div>
                      )}
                      {filteredFiles.slice(0, 200).map((f) => {
                        const parts = f.path.split('/');
                        const name = parts[parts.length - 1];
                        const dir = parts.slice(0, -1).join('/');
                        return (
                          <button
                            key={f.path}
                            type="button"
                            onClick={() => setOpenFile(f.path)}
                            className="flex items-center gap-2 px-4 py-1.5 w-full text-left hover:bg-surface2 cursor-pointer"
                          >
                            <FileText size={10} className="text-muted shrink-0" />
                            <span className="text-[11px] text-heading font-mono truncate flex-1 hover:text-accent transition-colors">{name}</span>
                            {dir && <span className="text-[9px] text-muted/50 truncate shrink-0 max-w-[180px] font-mono">{dir}</span>}
                          </button>
                        );
                      })}
                      {filteredFiles.length > 200 && (
                        <div className="px-6 py-2 text-center text-[10px] text-muted">Showing 200 of {filteredFiles.length} files</div>
                      )}
                    </div>
                  ) : (
                    <FolderTree files={files} onOpenFile={setOpenFile} />
                  )}
                </div>
              </div>
            )}

            {/* README view */}
            {view === 'readme' && (
              <div className="px-6 py-4 max-h-96 overflow-y-auto">
                {readme ? (
                  <pre className="text-[11px] text-muted whitespace-pre-wrap font-mono leading-relaxed">{readme}</pre>
                ) : (
                  <p className="text-xs text-muted text-center py-6">No README found.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function IntegrationsPreviewTab({ projectId: _projectId, project, githubRepo, gitlabRepos, goals, o365Docs, onNavigateSettings }: IntegrationsPreviewTabProps) {
  const { agent } = useAIAgent();
  const githubRepoList = Array.isArray(githubRepo) ? githubRepo : (githubRepo ? [githubRepo] : []);
  const [selectedGhRepo, setSelectedGhRepo] = useState<string>(githubRepoList[0] ?? '');
  const activeGithubRepo = selectedGhRepo || githubRepoList[0] || null;
  const [selectedGlRepo, setSelectedGlRepo] = useState<string>(gitlabRepos[0] ?? '');
  const gitlabRepo = selectedGlRepo || gitlabRepos[0] || null;
  const [ghCommits, setGhCommits] = useState<CommitEntry[]>([]);
  const [ghReadme, setGhReadme] = useState<string | null>(null);
  const [ghFiles, setGhFiles] = useState<FileEntry[]>([]);
  const [ghLoading, setGhLoading] = useState(false);
  const [glCommits, setGlCommits] = useState<CommitEntry[]>([]);
  const [glReadme, setGlReadme] = useState<string | null>(null);
  const [glFiles, setGlFiles] = useState<FileEntry[]>([]);
  const [glLoading, setGlLoading] = useState(false);
  const [glScanLoading, setGlScanLoading] = useState(false);
  const [glScanResults, setGlScanResults] = useState<{ completed: string[]; suggested: { title: string; reason: string }[]; provider?: string } | null>(null);

  const parseCommits = (raw: string[]): CommitEntry[] =>
    raw.slice(0, 30).map((c) => {
      const match = c.match(/^\[(.+?)\] (.+?) — (.+)$/);
      return match ? { date: match[1], message: match[2], author: match[3] } : { date: '', message: c, author: '' };
    });

  useEffect(() => {
    if (!activeGithubRepo) return;
    setGhLoading(true);
    const [owner, repo] = activeGithubRepo.split('/');
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (sessionData.session?.access_token) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      Promise.all([
        fetch(`/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent?projectId=${encodeURIComponent(_projectId)}`, { headers }).then((r) => r.ok ? r.json() : null),
        fetch(`/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree?projectId=${encodeURIComponent(_projectId)}`, { headers }).then((r) => r.ok ? r.json() : null),
      ]).then(([recent, tree]) => {
        if (recent) {
          setGhCommits(parseCommits(recent.commits ?? []));
          if (recent.readme) setGhReadme(recent.readme);
        }
        if (tree?.files) setGhFiles(tree.files);
      }).catch(() => {}).finally(() => setGhLoading(false));
    })();
  }, [activeGithubRepo]);

  useEffect(() => {
    if (!gitlabRepo) return;
    setGlLoading(true);
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (sessionData.session?.access_token) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      Promise.all([
        fetch(`/api/gitlab/recent?projectId=${encodeURIComponent(_projectId)}&repo=${encodeURIComponent(gitlabRepo)}`, { headers }).then((r) => r.ok ? r.json() : null),
        fetch(`/api/gitlab/tree?projectId=${encodeURIComponent(_projectId)}&repo=${encodeURIComponent(gitlabRepo)}`, { headers }).then((r) => r.ok ? r.json() : null),
      ]).then(([recent, tree]) => {
        if (recent) {
          setGlCommits(parseCommits(recent.commits ?? []));
          if (recent.readme) setGlReadme(recent.readme);
        }
        if (tree?.files) setGlFiles(tree.files);
      }).catch(() => {}).finally(() => setGlLoading(false));
    })();
  }, [gitlabRepo, _projectId]);

  const handleGitLabScan = async () => {
    if (!gitlabRepo || !project) return;
    setGlScanLoading(true);
    setGlScanResults(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (sessionData.session?.access_token) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      const recentRes = await fetch(`/api/gitlab/recent?projectId=${encodeURIComponent(_projectId)}&repo=${encodeURIComponent(gitlabRepo)}`, { headers });
      const recentData = recentRes.ok ? await recentRes.json() : {};
      const scanRes = await fetch('/api/ai/repo-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          projectName: project.name,
          goals: goals.map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress })),
          commits: recentData.commits ?? [],
          readme: recentData.readme ?? '',
        }),
      });
      if (scanRes.ok) setGlScanResults(await scanRes.json());
    } catch { /* ignore */ } finally {
      setGlScanLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <RepoPanel
        title="GitHub"
        icon={<Github size={14} className={activeGithubRepo ? 'text-heading' : 'text-muted'} />}
        source="github"
        repoId={activeGithubRepo ?? ''}
        repoLabel={activeGithubRepo ?? undefined}
        repoUrl={activeGithubRepo ? `https://github.com/${activeGithubRepo}` : undefined}
        titleExtra={githubRepoList.length > 1 ? (
          <select
            value={selectedGhRepo}
            onChange={(e) => { setSelectedGhRepo(e.target.value); setGhCommits([]); setGhReadme(null); setGhFiles([]); }}
            title="Select GitHub repo"
            className="text-[10px] font-mono bg-surface2 border border-border text-heading px-2 py-0.5 rounded focus:outline-none cursor-pointer"
          >
            {githubRepoList.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        ) : undefined}
        commits={ghCommits}
        readme={ghReadme}
        files={ghFiles}
        loading={ghLoading}
        connected={!!activeGithubRepo}
        onNavigateSettings={onNavigateSettings}
      />

      <RepoPanel
        title="GitLab (NPS)"
        icon={
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className={gitlabRepo ? 'text-[#FC6D26]' : 'text-muted'}>
            <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51 1.22 3.78a.84.84 0 01-.3.92z"/>
          </svg>
        }
        source="gitlab"
        repoId={gitlabRepo ?? ''}
        repoLabel={undefined}
        titleExtra={gitlabRepos.length > 1 ? (
          <select
            value={selectedGlRepo}
            onChange={(e) => { setSelectedGlRepo(e.target.value); setGlCommits([]); setGlReadme(null); setGlFiles([]); }}
            title="Select GitLab repo"
            className="text-[10px] font-mono bg-surface2 border border-[#FC6D26]/30 text-[#FC6D26] px-2 py-0.5 rounded focus:outline-none cursor-pointer"
          >
            {gitlabRepos.map((r) => (
              <option key={r} value={r}>{r.split('/').pop() ?? r}</option>
            ))}
          </select>
        ) : gitlabRepo ? (
          <span className="text-[10px] text-muted font-mono truncate max-w-[240px]">{gitlabRepo.split('/').pop() ?? gitlabRepo}</span>
        ) : undefined}
        commits={glCommits}
        readme={glReadme}
        files={glFiles}
        loading={glLoading}
        connected={!!gitlabRepo}
        onNavigateSettings={onNavigateSettings}
        scanButton={undefined}
      />

      {/* GitLab scan results */}
      {glScanResults && (
        <div className="border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-[#FC6D26]" />
            <h3 className="text-sm font-bold text-heading">GitLab AI Scan Results</h3>
            {glScanResults.provider && <span className="text-[9px] text-muted font-mono">{glScanResults.provider}</span>}
          </div>
          {glScanResults.completed.length > 0 && (
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wider mb-2 font-medium">Looks Completed</p>
              <div className="space-y-1">
                {glScanResults.completed.map((id) => {
                  const g = goals.find((g) => g.id === id);
                  return g ? (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <CheckCircle size={11} className="text-green-500 shrink-0" />
                      <span className="text-heading">{g.title}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
          {glScanResults.suggested.length > 0 && (
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wider mb-2 font-medium">Suggested Goals</p>
              <div className="space-y-2">
                {glScanResults.suggested.map((s, i) => (
                  <div key={i} className="border border-border rounded p-3">
                    <p className="text-xs font-medium text-heading">{s.title}</p>
                    <p className="text-[11px] text-muted mt-0.5">{s.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Office 365 / Local Files */}
      <div className="border border-border bg-surface">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText size={14} className={o365Docs.length > 0 ? 'text-[#0078D4]' : 'text-muted'} />
            <span className="font-sans text-sm font-bold text-heading">Office 365 / Local Files</span>
            <span className="text-[10px] text-muted">{o365Docs.length} file{o365Docs.length !== 1 ? 's' : ''} imported</span>
          </div>
        </div>
        {o365Docs.length === 0 ? (
          <div className="px-6 py-8 text-center text-xs text-muted">No files imported yet. Use the Documents tab to import from Office 365.</div>
        ) : (
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {o365Docs.map((doc) => (
              <div key={doc.id} className="flex items-start gap-3 px-6 py-3">
                <FileText size={11} className="text-muted mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-heading truncate">{doc.title ?? doc.summary}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] px-1 py-0.5 border border-border text-muted rounded uppercase font-mono">{doc.source}</span>
                    <span className="text-[10px] text-muted flex items-center gap-0.5">
                      <Clock size={9} /> {new Date(doc.occurred_at).toLocaleDateString()}
                    </span>
                    {typeof (doc.metadata as Record<string, unknown> | null)?.url === 'string' && (
                      <a href={String((doc.metadata as Record<string, unknown>).url)} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-accent hover:underline flex items-center gap-0.5">
                        Open <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
