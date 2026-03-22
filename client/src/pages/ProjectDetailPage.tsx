import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProjectFilePaths, type FileRef } from '../hooks/useProjectFilePaths';
import MarkdownWithFileLinks from '../components/MarkdownWithFileLinks';
import FilePreviewModal from '../components/FilePreviewModal';
import RepoTreeModal from '../components/RepoTreeModal';
import './ProjectDetailPage.css';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  Users,
  Target,
  Github,
  Sparkles,
  BarChart3,
  Plus,
  Trash2,
  ArrowLeft,
  Clock,
  Search,
  Link,
  Loader2,
  CheckCircle,
  UserPlus,
  X,
  Settings,
  TrendingUp,
  Folder,
  ChevronRight,
  Plug,
  GitBranch,
  FileText,
  ExternalLink,
  Pencil,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldAlert,
  Download,
  Table,
  Copy,
  Lock,
  Globe,
  LogOut,
  Check,
} from 'lucide-react';
import GoalMetrics from '../components/GoalMetrics';
import SearchPanel, { type SearchPanelHandle } from '../components/SearchPanel';
import LogTimeModal from '../components/LogTimeModal';
import { downloadDocx, downloadPptx, downloadPdf, exportGoalsCSV, type ReportContent } from '../lib/report-download';
import FileViewerLazy from '../components/FileViewer';
import OfficeFilePicker from '../components/OfficeFilePicker';
import GoalEditModal from '../components/GoalEditModal';
import GoalReportModal from '../components/GoalReportModal';
import ReportsTab from '../components/ReportsTab';
import ProjectQRCode from '../components/ProjectQRCode';
import { useProject, useJoinRequests, deleteProjectCascade } from '../hooks/useProjects';
import { fetchOneDriveFiles, useMicrosoftIntegration, deleteImportedEvent } from '../hooks/useMicrosoftIntegration';
import { useGoals } from '../hooks/useGoals';
import { useEvents } from '../hooks/useEvents';
import { useProjectTimeLogs } from '../hooks/useProjectTimeLogs';
import { useAuth } from '../lib/auth';
import { useAIAgent } from '../lib/ai-agent';
import { useChatPanel } from '../lib/chat-panel';
import { supabase } from '../lib/supabase';
import GoalCard from '../components/GoalCard';
import ActivityFeed from '../components/ActivityFeed';
import ProgressRing from '../components/ProgressRing';
import CommitActivityCharts from '../components/CommitActivityCharts';
import Timeline from '../components/Timeline';
import TimelinePage from '../components/TimelinePage';
import StatusBadge from '../components/StatusBadge';
import Modal, { useModal } from '../components/Modal';
import { generateProjectCode, sanitizeProjectCode, PROJECT_CODE_LENGTH } from '../lib/project-code';
import { useAIErrorDialog } from '../lib/ai-error';

const tabs = [
  { id: 'overview',      label: 'Overview',      icon: BarChart3 },
  { id: 'timeline',      label: 'Timeline',      icon: Clock },
  { id: 'activity',      label: 'Activity',      icon: Activity },
  { id: 'goals',         label: 'Tasks',         icon: Target },
  { id: 'metrics',       label: 'Metrics',       icon: TrendingUp },
  { id: 'reports',       label: 'Reports',       icon: ClipboardList },
  { id: 'documents',     label: 'Documents',     icon: Link },
  { id: 'integrations',  label: 'Integrations',  icon: Plug },
  { id: 'settings',      label: 'Settings',      icon: Settings },
] as const;

type TabId = (typeof tabs)[number]['id'];

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

interface ScanResults {
  completed: string[];
  suggested: { title: string; reason: string }[];
}

const API_BASE = '/api';

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { agent, providers } = useAIAgent();
  const { showAIError, aiErrorDialog } = useAIErrorDialog(agent, providers);
  const { register, unregister, setIuOpen } = useChatPanel();
  const { project, loading: projectLoading, updateProject, refetch: refetchProject } = useProject(projectId);
  const { goals, createGoal, updateGoal, deleteGoal, refetch: refetchGoals } = useGoals(projectId);
  const { events, loading: eventsLoading, refetch: refetchEvents } = useEvents(projectId);
  const { status: msStatus } = useMicrosoftIntegration();
  const [deletingProject, setDeletingProject] = useState(false);
  const [leavingProject, setLeavingProject] = useState(false);
  const [inviteRole, setInviteRole] = useState<'member' | 'owner'>('member');
  const [copySuccess, setCopySuccess] = useState(false);

  const isOwner = project?.owner_id === user?.id;

  const handleDeleteProject = async () => {
    if (!projectId || !project) return;
    if (!window.confirm(`Permanently delete "${project.name}"?\n\nThis will remove all tasks, events, and data. This cannot be undone.`)) return;
    setDeletingProject(true);
    try {
      await deleteProjectCascade(projectId);
      navigate('/projects');
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert('Failed to delete project. Please try again.');
      setDeletingProject(false);
    }
  };

  const handleLeaveProject = async () => {
    if (!projectId || !user) return;
    if (!window.confirm('Leave this project? You will lose access unless re-invited.')) return;
    setLeavingProject(true);
    try {
      await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', user.id);
      navigate('/projects');
    } catch (err) {
      console.error('Failed to leave project:', err);
      alert('Failed to leave project. Please try again.');
      setLeavingProject(false);
    }
  };

  const handleCopyInviteCode = async () => {
    if (!project?.invite_code) return;
    await navigator.clipboard.writeText(project.invite_code);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // Join requests (for owners to approve/deny)
  const { requests: joinRequests, respond: respondJoinRequest, refetch: refetchJoinRequests } = useJoinRequests(isOwner ? projectId : undefined);

  // Register this project with the global chat panel; unregister on unmount or project change
  useEffect(() => {
    if (project?.id && project?.name) {
      register(project.id, project.name, refetchGoals);
    }
    return () => { unregister(); };
  }, [project?.id, project?.name, register, unregister, refetchGoals]);

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const goalModal = useModal();
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');
  const [newGoalCategory, setNewGoalCategory] = useState('');
  const [newGoalLoe, setNewGoalLoe] = useState('');
  const [newGoalAssignees, setNewGoalAssignees] = useState<string[]>([]);

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

  // Documents / Office file picker
  const [officePickerOpen, setOfficePickerOpen] = useState(false);

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
  const { filePaths, fetchFileContent } = useProjectFilePaths(project?.github_repo, gitlabRepos);
  const [previewFileRef, setPreviewFileRef] = useState<FileRef | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [repoTreeTarget, setRepoTreeTarget] = useState<{ repo: string; type: 'github' | 'gitlab' } | null>(null);

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
    setRepoTreeTarget({ repo, type });
  }, []);

  // Teams folder integration (project-level)
  const [teamsFolder, setTeamsFolder] = useState<{ id: string; name: string } | null>(null);
  const [teamsFolderPickerOpen, setTeamsFolderPickerOpen] = useState(false);
  const [teamsFolderSaving, setTeamsFolderSaving] = useState(false);

  // Members state
  const [members, setMembers] = useState<MemberRow[]>([]);

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
  const [logTimeGoal, setLogTimeGoal] = useState<import('../types').Goal | null>(null);
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
  const { logs: timeLogs, refetch: refetchTimeLogs } = useProjectTimeLogs(projectId);
  const timeLogTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of timeLogs) m.set(l.goal_id, (m.get(l.goal_id) ?? 0) + l.logged_hours);
    return m;
  }, [timeLogs]);

  // Intelligent Update panel — now lives in the layout right panel via context
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<GitHubUser[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  useEffect(() => {
    const navState = location.state as { openTab?: TabId; editGoalId?: string } | null;
    if (!navState) return;

    if (navState.openTab) setActiveTab(navState.openTab);
    if (navState.editGoalId) {
      if (goals.length === 0) return;
      const goal = goals.find((g) => g.id === navState.editGoalId);
      if (!goal) return;
      setEditAutoGuidance(false);
      setEditGoal(goal);
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, goals]);

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
          const cfg = data.config as { repos?: string[]; repo?: string };
          setGitlabRepos(cfg.repos ?? (cfg.repo ? [cfg.repo] : []));
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
    const { data } = await supabase
      .from('project_members')
      .select('user_id, role, joined_at, profiles:user_id(display_name, avatar_url)')
      .eq('project_id', projectId);
    if (data) setMembers(data as unknown as MemberRow[]);
  }, [projectId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // AI risk assessment
  const handleAssessRisk = async () => {
    if (!projectId) return;
    setRiskAssessing(true);
    try {
      const res = await fetch(`${API_BASE}/ai/risk-assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      await updateProject({ github_repo: slug });
      setRepoInput('');
    } catch (err) {
      console.error('Failed to save repo:', err);
    }
    setRepoSaving(false);
  };

  // AI repo scan
  const handleRepoScan = async () => {
    if (!project?.github_repo) return;
    setScanLoading(true);
    setScanResults(null);
    try {
      const [owner, repo] = project.github_repo.split('/');
      // Fetch recent repo data
      const recentRes = await fetch(`${API_BASE}/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent`);
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
      const res = await fetch(`${API_BASE}/ai/project-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`${API_BASE}/ai/standup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`${API_BASE}/ai/task-guidance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`${API_BASE}/ai/analyze-office-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // Search GitHub users
  const handleMemberSearch = async () => {
    if (memberSearch.trim().length < 2) return;
    setMemberSearching(true);
    try {
      const res = await fetch(`${API_BASE}/github/search/users?q=${encodeURIComponent(memberSearch.trim())}`);
      const data = await res.json();
      setMemberResults(data.users || []);
    } catch {
      setMemberResults([]);
    }
    setMemberSearching(false);
  };

  // Invite member by GitHub username — look up or create a profile row
  const handleInviteMember = async (ghUser: GitHubUser) => {
    if (!projectId) return;
    setInviting(ghUser.login);
    try {
      // Check if a profile already exists with this display_name (GitHub login)
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('id')
        .eq('display_name', ghUser.login)
        .limit(1);
      let userId = existingProfiles?.[0]?.id;
      if (!userId) {
        // No matching profile — we can't create auth users from the client.
        // Instead, store a pending invite (use github_id as a placeholder).
        // For now, show a message — full invite flow needs email.
        setInviting(null);
        alert(`User "${ghUser.login}" hasn't signed up to Odyssey yet. Ask them to sign in with GitHub first.`);
        return;
      }
      // Check if already a member
      const { data: existing } = await supabase
        .from('project_members')
        .select('user_id')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .limit(1);
      if (existing && existing.length > 0) {
        setInviting(null);
        return;
      }
      await supabase.from('project_members').insert({ project_id: projectId, user_id: userId, role: inviteRole });
      await fetchMembers();
    } catch (err) {
      console.error('Invite failed:', err);
    }
    setInviting(null);
  };

  // Remove member
  const handleRemoveMember = async (userId: string) => {
    if (!projectId) return;
    await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId);
    await fetchMembers();
  };

  const handlePromoteMember = async (userId: string) => {
    if (!projectId) return;
    await supabase.from('project_members').update({ role: 'owner' }).eq('project_id', projectId).eq('user_id', userId);
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
    if (!newGoalTitle.trim()) return;
    await createGoal({
      title: newGoalTitle,
      deadline: newGoalDeadline || undefined,
      category: newGoalCategory.trim() || undefined,
      loe: newGoalLoe || undefined,
      assignees: newGoalAssignees,
    });
    setNewGoalTitle('');
    setNewGoalDeadline('');
    setNewGoalCategory('');
    setNewGoalLoe('');
    setNewGoalAssignees([]);
    goalModal.onClose();
  };

  // Build assignee lookup from members + current user
  const allMembers = [
    { user_id: user?.id ?? '', display_name: user?.user_metadata?.user_name ?? user?.email ?? 'You', avatar_url: user?.user_metadata?.avatar_url ?? null },
    ...members.map((m) => ({ user_id: m.user_id, display_name: m.profile?.display_name ?? m.user_id, avatar_url: m.profile?.avatar_url ?? null })),
  ];
  function getAssignee(userId: string | null) {
    if (!userId) return null;
    return allMembers.find((m) => m.user_id === userId) ?? null;
  }

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
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-3">
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
        {project.description && (
          <p className="text-sm text-muted">{project.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-px border border-border bg-border mb-8">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 bg-surface text-xs tracking-wider uppercase transition-colors whitespace-nowrap first:rounded-tl last:rounded-tr ${
              activeTab === tab.id
                ? 'text-heading bg-surface2 font-medium'
                : 'text-muted hover:text-heading hover:bg-surface2'
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <>
          {/* Stats + Integrations + AI */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mb-8">
            <div className="bg-surface p-6">
              <h3 className="font-sans text-sm font-bold text-heading mb-4">Project Status</h3>
              <div className="space-y-3">
                <StatRow label="Tasks" value={`${completedGoals.length} / ${goals.length}`} />
                <StatRow label="Overall Progress" value={`${overallProgress}%`} />
                <StatRow label="Members" value={String(members.length || 1)} />
                <StatRow label="Events" value={String(events.length)} />
                {(() => {
                  const now = Date.now();
                  const overdueCount = goals.filter(
                    (g) => g.deadline && new Date(g.deadline).getTime() < now && g.status !== 'complete'
                  ).length;
                  const soonCount = goals.filter((g) => {
                    if (!g.deadline || g.status === 'complete') return false;
                    const ms = new Date(g.deadline).getTime() - now;
                    return ms > 0 && ms < 14 * 86_400_000 && g.progress < 75;
                  }).length;
                  const completionRate = goals.length > 0 ? completedGoals.length / goals.length : 0;

                  let label: string;
                  let color: string;
                  if (overdueCount > 0) {
                    label = `At Risk · ${overdueCount} overdue`;
                    color = 'text-red-400';
                  } else if (soonCount > 0) {
                    label = `Caution · ${soonCount} due soon`;
                    color = 'text-yellow-400';
                  } else if (completionRate >= 0.5 || overallProgress >= 60) {
                    label = 'On Track';
                    color = 'text-green-500';
                  } else if (goals.length === 0) {
                    label = 'No tasks yet';
                    color = 'text-muted';
                  } else {
                    label = 'Early Stage';
                    color = 'text-muted';
                  }
                  return (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted">Trajectory</span>
                      <span className={`text-xs font-mono font-medium ${color}`}>{label}</span>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="bg-surface p-6">
              <h3 className="font-sans text-sm font-bold text-heading mb-4">Integrations</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 border border-border rounded">
                  <Github size={16} className={project.github_repo ? 'text-accent' : 'text-muted'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium">GitHub</div>
                    {project.github_repo ? (
                      <a
                        href={`https://github.com/${project.github_repo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-accent hover:underline truncate block"
                      >
                        {project.github_repo}
                      </a>
                    ) : (
                      <div className="text-[10px] text-muted">Not connected</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="text-[10px] text-accent hover:underline"
                  >
                    {project.github_repo ? 'Manage' : 'Connect'}
                  </button>
                </div>
                <div className="flex items-center gap-3 p-3 border border-border rounded">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className={gitlabRepos.length > 0 ? 'text-[#FC6D26]' : 'text-muted'}>
                    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51 1.22 3.78a.84.84 0 01-.3.92z"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium">GitLab <span className="text-[9px] text-muted font-mono">NPS</span></div>
                    {gitlabRepos.length > 0 ? (
                      <div className="text-[10px] text-muted truncate">
                        {gitlabRepos.length === 1 ? gitlabRepos[0] : `${gitlabRepos.length} repos linked`}
                      </div>
                    ) : (
                      <div className="text-[10px] text-muted">Not connected</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="text-[10px] text-accent hover:underline"
                  >
                    {gitlabRepos.length > 0 ? 'Manage' : 'Connect'}
                  </button>
                </div>
              </div>
            </div>
            <div className="bg-surface p-6 flex flex-col gap-5">
              {/* AI Insights */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-accent" />
                    <h3 className="font-sans text-sm font-bold text-heading">AI Insights</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateInsights}
                    disabled={insightsLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider uppercase font-medium
                               bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors
                               disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {insightsLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                    {insightsLoading ? 'Analyzing…' : insights ? 'Regenerate' : 'Generate'}
                  </button>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  {insights ? `Last run ${new Date(insights.generatedAt ?? '').toLocaleDateString()}` : 'Project status, next steps, and feature ideas.'}
                </p>
              </div>

              <div className="border-t border-border" />

              {/* 2-Week Standup */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ClipboardList size={14} className="text-accent" />
                    <h3 className="font-sans text-sm font-bold text-heading">2-Week Standup</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateStandup}
                    disabled={standupLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider uppercase font-medium
                               bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors
                               disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {standupLoading ? <Loader2 size={10} className="animate-spin" /> : <ClipboardList size={10} />}
                    {standupLoading ? 'Generating…' : standup ? 'Regenerate' : 'Generate'}
                  </button>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  {standup ? `${standup.totalCommits} commits · ${standup.period.from} → ${standup.period.to}` : 'Summarizes commits, goals, and activity from the last 14 days.'}
                </p>
              </div>
            </div>
          </div>

          {/* AI Insights Results */}
          {(insights || insightsLoading || insightsError) && (
            <div className="border border-border bg-surface p-6 mb-8">
              {/* Header row — always visible */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-accent" />
                  <h3 className="font-sans text-sm font-bold text-heading">AI Insights</h3>
                </div>
                {insights && (
                  <div className="flex flex-col items-end gap-0.5">
                    {insights.generatedAt && (
                      <div className="flex items-center gap-1 text-[10px] text-muted">
                        <Clock size={9} />
                        {new Date(insights.generatedAt).toLocaleString()}
                      </div>
                    )}
                    {insights.provider && (
                      <div className="flex items-center gap-1 text-[10px] text-muted">
                        <CheckCircle size={9} className="text-green-500" />
                        <span>{insights.provider}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {insightsLoading ? (
                <div className="flex items-center justify-center gap-3 py-12">
                  <Loader2 size={20} className="animate-spin text-accent" />
                  <span className="text-sm text-muted">Analyzing project with AI…</span>
                </div>
              ) : insightsError ? (
                <div className="flex items-center gap-3 p-4 border border-red-300/30 bg-red-500/5 rounded">
                  <X size={16} className="text-red-400 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-heading mb-0.5">Insights generation failed</p>
                    <p className="text-[11px] text-muted">{insightsError}</p>
                    <p className="text-[10px] text-muted mt-1">Try selecting a different AI model from the dropdown and clicking Generate again.</p>
                  </div>
                </div>
              ) : insights && (
                <div className="space-y-6">

                  {/* Project Status */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 size={14} className="text-accent" />
                      <h4 className="font-sans text-base font-bold text-heading">Project Status</h4>
                    </div>
                    <div className="text-xs text-muted leading-relaxed pl-5">
                      <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>
                        {insights.status}
                      </MarkdownWithFileLinks>
                    </div>
                  </div>

                  {/* Next Steps */}
                  {insights.nextSteps?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Target size={14} className="text-accent2" />
                        <h4 className="font-sans text-base font-bold text-heading">What to Work on Next</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {insights.nextSteps.map((step: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-accent font-mono text-[10px] mt-0.5 shrink-0">{i + 1}.</span>
                            <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>{step}</MarkdownWithFileLinks>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Future Features */}
                  {insights.futureFeatures?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={14} className="text-yellow-500" />
                        <h4 className="font-sans text-base font-bold text-heading">Future Feature Ideas</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {insights.futureFeatures.map((feat: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-yellow-500 shrink-0">◆</span>
                            <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>{feat}</MarkdownWithFileLinks>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Code Insights */}
                  {insights.codeInsights && insights.codeInsights.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <GitBranch size={14} className="text-accent3" />
                        <h4 className="font-sans text-base font-bold text-heading">Codebase Analysis</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {insights.codeInsights.map((obs: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-accent3 font-mono text-[10px] mt-0.5 shrink-0">{'</>'}</span>
                            <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>{obs}</MarkdownWithFileLinks>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Standup Results */}
          {(standup || standupLoading || standupError) && (
            <div className="border border-border bg-surface p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <ClipboardList size={14} className="text-accent" />
                <h3 className="font-sans text-sm font-bold text-heading">2-Week Standup</h3>
              </div>

              {standupLoading && (
                <div className="flex items-center gap-3 py-8 justify-center">
                  <Loader2 size={18} className="animate-spin text-accent" />
                  <span className="text-sm text-muted">Analyzing 14 days of activity…</span>
                </div>
              )}

              {standupError && (
                <div className="flex items-center gap-3 p-4 border border-red-300/30 bg-red-500/5 rounded">
                  <X size={16} className="text-red-400 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-heading mb-0.5">Standup generation failed</p>
                    <p className="text-[11px] text-muted">{standupError}</p>
                  </div>
                </div>
              )}

              {standup && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono text-muted">
                      {standup.period.from} → {standup.period.to}
                    </span>
                    {standup.commitSummary.map((r) => (
                      <span
                        key={r.repo}
                        className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-border/60 text-muted"
                      >
                        <GitBranch size={9} />
                        {r.repo.split('/').pop()} · {r.count}
                      </span>
                    ))}
                    {standup.provider && (
                      <span className="ml-auto text-[10px] text-muted font-mono">{standup.provider}</span>
                    )}
                  </div>

                  {standup.highlights && (
                    <div className="px-4 py-3 rounded bg-accent/8 border border-accent/15">
                      <p className="text-xs text-heading leading-relaxed">{standup.highlights}</p>
                    </div>
                  )}

                  {standup.accomplished.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle size={13} className="text-green-500" />
                        <h4 className="font-sans text-base font-bold text-heading">Accomplished</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {standup.accomplished.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-green-500 shrink-0 mt-0.5">✓</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {standup.inProgress.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp size={13} className="text-accent" />
                        <h4 className="font-sans text-base font-bold text-heading">In Progress</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {standup.inProgress.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-accent shrink-0 mt-0.5">→</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {standup.blockers.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <X size={13} className="text-red-400" />
                        <h4 className="font-sans text-base font-bold text-heading">Blockers / Risks</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {standup.blockers.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-red-400 shrink-0 mt-0.5">⚠</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Timeline */}
          <div className="border border-border bg-surface p-6 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={14} className="text-accent2" />
              <h3 className="font-sans text-sm font-bold text-heading">Timeline</h3>
            </div>
            <Timeline
              goals={goals}
              members={[
                { user_id: user?.id ?? '', display_name: user?.user_metadata?.user_name ?? user?.email ?? 'You' },
                ...members.map((m) => ({ user_id: m.user_id, display_name: m.profile?.display_name ?? null })),
              ]}
            />
          </div>

          {/* Recent Activity */}
          <div className="border border-border bg-surface p-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-accent" />
              <h3 className="font-sans text-sm font-bold text-heading">Recent Activity</h3>
            </div>
            <CommitActivityCharts projectId={project.id} onHasData={setHasCommitData} />
            <ActivityFeed
              events={events.slice(0, 10)}
              loading={eventsLoading}
              emptyMessage={hasCommitData ? undefined : "No activity yet. Connect a GitHub repo to start."}
            />
          </div>

          {/* Team Members */}
          <div className="border border-border bg-surface p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-accent2" />
                <h3 className="font-sans text-sm font-bold text-heading">Team Members</h3>
                <span className="text-[10px] text-muted font-mono bg-surface2 px-1.5 py-0.5 rounded">{members.length + 1}</span>
              </div>
              <button type="button" onClick={() => setActiveTab('settings')}
                className="text-[10px] text-accent hover:underline">
                Manage →
              </button>
            </div>
            <div className="space-y-px border border-border bg-border">
              {/* Owner row — current user */}
              <div className="flex items-center gap-3 bg-surface px-4 py-2.5">
                {user?.user_metadata?.avatar_url
                  ? <img src={user.user_metadata.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                  : <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center"><span className="text-[10px] text-accent font-bold">You</span></div>
                }
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-heading font-medium truncate">{user?.user_metadata?.user_name ?? user?.email ?? 'You'}</div>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 border border-accent3/30 text-accent3 rounded uppercase font-mono">Owner</span>
              </div>
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-3 bg-surface px-4 py-2.5 group">
                  {m.profile?.avatar_url
                    ? <img src={m.profile.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                    : <div className="w-7 h-7 rounded-full bg-accent2/20 flex items-center justify-center">
                        <span className="text-[10px] text-accent2 font-bold uppercase">{(m.profile?.display_name ?? '?')[0]}</span>
                      </div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium truncate">{m.profile?.display_name ?? m.user_id}</div>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 border rounded uppercase font-mono ${
                    m.role === 'owner' ? 'border-accent3/30 text-accent3' : 'border-border text-muted'
                  }`}>{m.role}</span>
                  {m.role !== 'owner' && (
                    <button
                      type="button"
                      title="Promote to owner"
                      onClick={() => handlePromoteMember(m.user_id)}
                      className="opacity-0 group-hover:opacity-100 text-[9px] px-2 py-0.5 border border-accent3/30 text-accent3 rounded hover:bg-accent3/10 transition-all"
                    >
                      Make Owner
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === 'timeline' && (
        <TimelinePage
          goals={goals}
          projectName={project.name}
          projectId={project.id}
          members={members.map((m) => ({ user_id: m.user_id, display_name: m.profile?.display_name ?? null }))}
          onGoalClick={(g) => { setEditAutoGuidance(false); setEditGoal(g); }}
          onCreateGoalForDate={(dateStr) => { setNewGoalDeadline(dateStr); goalModal.onOpen(); }}
        />
      )}

      {activeTab === 'activity' && (
        <div className="border border-border bg-surface p-6 space-y-8">
          <CommitActivityCharts projectId={project.id} onHasData={setHasCommitData} />

          {/* ── Recent Goal Progress ────────────────────────────────── */}
          {(() => {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const recentGoals = goals
              .filter((g) => g.updated_at && g.updated_at > thirtyDaysAgo && g.status !== 'not_started')
              .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
              .slice(0, 8);

            if (recentGoals.length === 0) return null;

            const statusLabel: Record<string, string> = {
              in_progress: 'In Progress',
              in_review: 'In Review',
              complete: 'Complete',
              at_risk: 'At Risk',
            };
            const statusColor: Record<string, string> = {
              not_started: 'text-[#D94F4F]',
              in_progress:  'text-[#D97E2A]',
              in_review:    'text-[#facc15]',
              complete:     'text-[#6DBE7D]',
              at_risk:      'text-[#D94F4F]',
            };

            return (
              <section>
                <h4 className="text-[10px] tracking-[0.2em] uppercase text-muted font-semibold mb-3">
                  Recent Task Progress
                </h4>
                <div className="space-y-3">
                  {recentGoals.map((g) => {
                    const updatedBy = getAssignee(g.updated_by);
                    const assignedTo = getAssignee(g.assigned_to);
                    const actor = updatedBy ?? assignedTo;

                    const relatedEvent = events.find(
                      (e) => e.event_type === 'goal_progress_updated' &&
                        (e.metadata as Record<string, unknown> | null)?.goal_id === g.id
                    );
                    const relatedMeta = relatedEvent?.metadata as Record<string, unknown> | null;
                    const evidence = relatedMeta?.evidence as string | undefined;
                    const completedBy = relatedMeta?.completed_by as string | undefined;

                    const daysAgo = Math.floor(
                      (Date.now() - new Date(g.updated_at).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    const timeStr = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
                    const guidance = taskGuidance[g.id];
                    const hasGuidance = !!guidance?.text;
                    const isVisible = !!guidanceVisible[g.id];

                    return (
                      <div key={g.id} className="rounded border border-border/50 bg-surface2/30 hover:bg-surface2 transition-colors group">
                        <div className="flex items-start gap-3 px-3 py-3">
                          {/* Progress ring */}
                          <div className="relative shrink-0">
                            <ProgressRing progress={g.progress} size={44} />
                            {g.status === 'complete' && (
                              <CheckCircle size={10} className="absolute -top-0.5 -right-0.5 text-accent3" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Title row */}
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm text-heading font-semibold leading-snug">{g.title}</span>
                              <div className="flex flex-col items-end shrink-0 gap-0.5">
                                <button
                                  type="button"
                                  title={hasGuidance ? 'Regenerate guidance' : 'Get AI guidance'}
                                  onClick={() => handleTaskGuidance(g)}
                                  disabled={guidance?.loading}
                                  className={`opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-accent/10 transition-all disabled:opacity-40 ${hasGuidance ? 'text-accent' : 'text-muted hover:text-accent'}`}
                                >
                                  {hasGuidance ? <RefreshCw size={10} /> : <Sparkles size={11} />}
                                  {hasGuidance && <span className="font-mono">Regenerate</span>}
                                </button>
                                <span className="text-[10px] text-muted font-mono">{timeStr}</span>
                              </div>
                            </div>

                            {/* Badges row */}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className={`text-[10px] font-semibold ${statusColor[g.status] ?? 'text-muted'}`}>
                                {statusLabel[g.status] ?? g.status}
                              </span>
                              <span className="text-[10px] text-muted font-mono">{g.progress}%</span>
                              {g.category && (
                                <span className="text-[9px] px-1.5 py-0.5 border border-border rounded text-muted font-mono uppercase">{g.category}</span>
                              )}
                              {g.loe && (
                                <span className="text-[9px] px-1.5 py-0.5 border border-accent2/30 rounded text-accent2 font-mono uppercase">{g.loe}</span>
                              )}
                              {actor && (
                                <span className="text-[10px] text-muted">
                                  {updatedBy ? `updated by ${updatedBy.display_name}` : assignedTo ? `assigned to ${assignedTo.display_name}` : ''}
                                </span>
                              )}
                              {completedBy && (
                                <span className="text-[10px] text-muted">work by {completedBy}</span>
                              )}
                            </div>

                            {evidence && (
                              <p className="text-[11px] text-muted mt-1 line-clamp-2 italic">{evidence}</p>
                            )}
                          </div>
                        </div>

                        {/* AI Guidance panel — collapsible, text persists */}
                        {(guidance?.loading || hasGuidance) && (
                          <div className="border-t border-border/50">
                            {/* Panel header with collapse toggle */}
                            <button
                              type="button"
                              onClick={() => !guidance?.loading && setGuidanceVisible((prev) => ({ ...prev, [g.id]: !isVisible }))}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface2/50 transition-colors"
                            >
                              {guidance?.loading
                                ? <Loader2 size={11} className="text-accent shrink-0 animate-spin" />
                                : <Sparkles size={11} className="text-accent shrink-0" />
                              }
                              <span className="text-[10px] text-accent font-mono tracking-wide flex-1 text-left">
                                {guidance?.loading ? 'Analyzing task…' : 'AI Guidance'}
                              </span>
                              {!guidance?.loading && (
                                isVisible
                                  ? <ChevronUp size={11} className="text-muted" />
                                  : <ChevronDown size={11} className="text-muted" />
                              )}
                            </button>

                            {/* Collapsible content — hidden while loading to avoid duplicate status */}
                            {isVisible && !guidance?.loading && (
                              <div className="px-3 pb-2.5">
                                <div className="text-[11px] text-muted leading-relaxed min-w-0">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                                      h1: ({ children }) => <h1 className="text-xs font-bold mb-1.5 mt-2 first:mt-0 text-heading">{children}</h1>,
                                      h2: ({ children }) => <h2 className="text-xs font-bold mb-1 mt-2 first:mt-0 text-heading">{children}</h2>,
                                      h3: ({ children }) => <h3 className="text-[11px] font-semibold mb-1 mt-1.5 first:mt-0 text-heading">{children}</h3>,
                                      ul: ({ children }) => <ul className="mb-1.5 pl-4 space-y-0.5 list-disc">{children}</ul>,
                                      ol: ({ children }) => <ol className="mb-1.5 pl-4 space-y-0.5 list-decimal">{children}</ol>,
                                      strong: ({ children }) => <strong className="font-semibold text-heading">{children}</strong>,
                                      em: ({ children }) => <em className="italic">{children}</em>,
                                      code: ({ children }) => <code className="bg-surface border border-border rounded px-1 py-0.5 font-mono text-[10px]">{children}</code>,
                                      a: ({ href, children }) => <a href={href} className="text-accent2 underline" target="_blank" rel="noreferrer">{children}</a>,
                                    }}
                                  >
                                    {guidance?.text ?? ''}
                                  </ReactMarkdown>
                                </div>
                                {guidance?.provider && (
                                  <div className="mt-1.5 text-[9px] text-muted/50 font-mono text-right">{guidance.provider}</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* ── Event Feed ───────────────────────────────────────────── */}
          <section>
            <h4 className="text-[10px] tracking-[0.2em] uppercase text-muted font-semibold mb-3">
              All Activity
            </h4>
            <ActivityFeed
              events={events}
              loading={eventsLoading}
              emptyMessage={hasCommitData ? undefined : "No activity yet. Connect a GitHub or GitLab repo to start tracking."}
            />
          </section>
        </div>
      )}

      {activeTab === 'goals' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-sans text-sm font-bold text-heading">Tasks ({goals.length})</h3>
            <div className="flex items-center gap-2">
              <SearchPanel
                ref={searchRef}
                projectId={projectId ?? null}
                goals={goals}
                events={events}
                onGoalSelect={(id) => {
                  const g = goals.find((g) => g.id === id);
                  if (g) { setEditAutoGuidance(false); setEditGoal(g); }
                }}
                onEventSelect={() => setActiveTab('activity')}
              />
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={handleAssessRisk}
                  disabled={riskAssessing}
                  title="Run AI risk assessment on all tasks"
                  className={`inline-flex items-center gap-2 px-4 py-2 border text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors disabled:opacity-50 ${riskReport ? 'rounded-l-md border-r-0 border-border text-muted' : 'rounded-md border-border text-muted'}`}
                >
                  {riskAssessing ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
                  {riskAssessing ? 'Assessing…' : 'Assess Risk'}
                </button>
                {riskReport && (
                  <button
                    type="button"
                    onClick={() => setRiskPanelOpen(v => !v)}
                    title={riskPanelOpen ? 'Hide risk report' : 'Show risk report'}
                    className={`inline-flex items-center gap-1 px-2.5 py-2 border border-border text-xs font-mono rounded-r-md transition-colors ${riskPanelOpen ? 'bg-surface2 text-heading' : 'text-muted hover:bg-surface2 hover:text-heading'}`}
                  >
                    {riskPanelOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleSyncOfficeProgress}
                disabled={syncingProgress}
                title="Analyze imported Office documents and auto-update goal progress using AI"
                className="inline-flex items-center gap-2 px-4 py-2 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md disabled:opacity-50"
              >
                {syncingProgress ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Sync from Office
              </button>
              <button
                type="button"
                onClick={goalModal.onOpen}
                className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
              >
                <Plus size={14} /> Add Task
              </button>
            </div>
          </div>

          {syncResult && (
            <div className="mb-4 border border-accent/20 bg-accent/5 rounded p-4 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-accent">
                  {syncResult.applied > 0 ? `Updated ${syncResult.applied} task${syncResult.applied > 1 ? 's' : ''} from Office documents` : 'Analysis complete — no changes needed'}
                </span>
                <button type="button" title="Dismiss" onClick={() => setSyncResult(null)} className="text-muted hover:text-heading"><X size={12} /></button>
              </div>
              <p className="text-muted leading-relaxed">{syncResult.summary}</p>
              {syncResult.provider && <p className="text-[10px] text-muted/60 mt-1">via {syncResult.provider}</p>}
            </div>
          )}
          {/* Risk Assessment Panel */}
          {riskReport && riskPanelOpen && (() => {
            const sorted = [...riskReport.assessments].sort((a, b) => b.score - a.score);
            const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
            sorted.forEach(a => { if (counts[a.level] !== undefined) counts[a.level]++; });
            const levelStyle: Record<string, string> = {
              critical: 'text-[var(--color-danger)] border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5',
              high:     'text-orange-400 border-orange-400/30 bg-orange-400/5',
              medium:   'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
              low:      'text-[var(--color-accent3)] border-[var(--color-accent3)]/30 bg-[var(--color-accent3)]/5',
            };
            return (
              <div className="mb-4 border border-border rounded-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-surface2 border-b border-border">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={12} className="text-muted" />
                    <span className="text-xs font-semibold text-heading">Risk Assessment</span>
                    <span className="text-[10px] text-muted font-mono">
                      {new Date(riskReport.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {(['critical','high','medium','low'] as const).map(lvl => counts[lvl] > 0 && (
                      <span key={lvl} className={`text-[9px] font-mono px-1.5 py-0.5 border rounded ${levelStyle[lvl]}`}>
                        {counts[lvl]} {lvl}
                      </span>
                    ))}
                    <button type="button" title="Close" onClick={() => setRiskPanelOpen(false)} className="text-muted hover:text-heading transition-colors ml-1">
                      <X size={12} />
                    </button>
                  </div>
                </div>
                {/* Goal rows */}
                <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
                  {sorted.map(a => {
                    const goal = goals.find(g => g.id === a.goalId);
                    if (!goal) return null;
                    return (
                      <div key={a.goalId} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface2/50 transition-colors">
                        <span className={`shrink-0 text-[9px] font-mono px-1.5 py-0.5 border rounded mt-0.5 ${levelStyle[a.level] ?? ''}`}>
                          {a.level}
                        </span>
                        <div className="flex-1 min-w-0">
                          <button
                            type="button"
                            className="text-xs text-heading font-mono text-left hover:text-accent transition-colors truncate w-full"
                            onClick={() => { setEditAutoGuidance(false); setEditGoal(goal); }}
                          >
                            {goal.title}
                          </button>
                          {a.factors.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5">
                              {a.factors.map((f, i) => (
                                <li key={i} className="text-[10px] text-muted font-mono flex items-start gap-1">
                                  <span className="shrink-0 mt-0.5 opacity-50">·</span>{f}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-muted shrink-0">{a.score}/100</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {syncError && (
            <div className="mb-4 border border-danger/20 bg-danger/5 rounded p-3 text-xs text-danger font-mono">{syncError}</div>
          )}

          <GoalsKanban
            goals={goals}
            onUpdateStatus={(id, status) => {
              const progressMap: Record<GoalStatus, number> = {
                not_started: 0, in_progress: 40, in_review: 75, complete: 100,
              };
              updateGoal(id, { status, progress: progressMap[status] });
            }}
            onEdit={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}
            onEditWithGuidance={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(true); setEditGoal(g); } }}
            onDelete={deleteGoal}
            onAdd={goalModal.onOpen}
            getAssignee={getAssignee}
            goalDependencies={goalDependencies}
            timeLogTotals={timeLogTotals}
            onLogTime={(id) => { const g = goals.find((g) => g.id === id); if (g) setLogTimeGoal(g); }}
          />

        </div>
      )}

      {activeTab === 'metrics' && (
        <GoalMetrics
          goals={goals}
          members={members.map((m) => ({
            user_id: m.user_id,
            display_name: m.profile?.display_name ?? null,
            avatar_url: m.profile?.avatar_url ?? null,
          }))}
          currentUserId={user?.id ?? ''}
          currentUserName={user?.user_metadata?.user_name ?? user?.email ?? 'You'}
          currentUserAvatar={user?.user_metadata?.avatar_url}
          onAssignTask={(goalId, userId) => updateGoal(goalId, { assigned_to: userId })}
          timeLogs={timeLogs}
        />
      )}

      {activeTab === 'reports' && (
        <ReportsTab
          projectId={project.id}
          projectName={project.name}
          projectStartDate={project.start_date ?? null}
          githubRepo={project.github_repo}
          gitlabRepos={gitlabRepos}
          messages={reportMessages}
          onMessagesChange={setReportMessages}
          onReportSaved={() => setSavedReportsVersion((v) => v + 1)}
        />
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
          onOpenOfficePicker={() => setOfficePickerOpen(true)}
          onRefresh={refetchEvents}
          savedReportsVersion={savedReportsVersion}
        />
      )}

      {activeTab === 'integrations' && (
        <IntegrationsPreviewTab
          projectId={projectId!}
          project={project ? { name: project.name, github_repo: project.github_repo } : null}
          githubRepo={project?.github_repo ?? null}
          gitlabRepos={gitlabRepos}
          goals={goals.map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress ?? 0 }))}
          o365Docs={events.filter((e) => ['onenote', 'onedrive', 'teams', 'local'].includes(e.source))}
          onNavigateSettings={() => setActiveTab('settings')}
        />
      )}

      {activeTab === 'settings' && (
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

          {/* Team Members + Invite — side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-border bg-surface p-6">
              <div className="flex items-center gap-2 mb-6">
                <Users size={14} className="text-accent2" />
                <h3 className="font-sans text-sm font-bold text-heading">
                  Team Members ({members.length})
                </h3>
              </div>
              <div className="space-y-px border border-border bg-border">
                {members.map((m) => {
                  const isCurrentUser = m.user_id === user?.id;
                  return (
                    <div key={m.user_id} className="flex items-center gap-3 bg-surface px-4 py-3 group">
                      {m.profile?.avatar_url ? (
                        <img src={m.profile.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-accent2/20 flex items-center justify-center">
                          <span className="text-[10px] text-accent2 font-bold uppercase">
                            {(m.profile?.display_name ?? '?')[0]}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-heading font-medium truncate">
                          {m.profile?.display_name ?? m.user_id}
                          {isCurrentUser && <span className="ml-1.5 text-[9px] text-muted">(you)</span>}
                        </div>
                        <div className="text-[10px] text-muted capitalize">{m.role}</div>
                      </div>
                      {/* Owners can remove/promote other members */}
                      {isOwner && !isCurrentUser && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.user_id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger transition-all"
                          title="Remove member"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Add members panel — owners only */}
            {isOwner ? (
              <div className="border border-border bg-surface p-6">
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <div className="flex items-center gap-2">
                  <UserPlus size={14} className="text-accent" />
                    <h3 className="font-sans text-sm font-bold text-heading">Add Members</h3>
                  </div>
                  {projectId && <ProjectQRCode projectId={projectId} />}
                </div>
                <p className="text-[11px] text-muted mb-4">
                  Search for a GitHub user — they must have signed into Odyssey at least once, or open a QR preview for a new user to scan.
                </p>
                {/* Role selector */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[10px] tracking-[0.15em] uppercase text-muted">Invite as</span>
                  <div className="flex items-center gap-1 border border-border rounded overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setInviteRole('member')}
                      className={`px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors ${inviteRole === 'member' ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}
                    >
                      Member
                    </button>
                    <button
                      type="button"
                      onClick={() => setInviteRole('owner')}
                      className={`px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors ${inviteRole === 'owner' ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2'}`}
                    >
                      Owner
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 max-w-md mb-4">
                  <input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleMemberSearch()}
                    placeholder="GitHub username…"
                    className="flex-1 px-4 py-2.5 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
                  />
                  <button
                    type="button"
                    onClick={handleMemberSearch}
                    disabled={memberSearching || memberSearch.trim().length < 2}
                    className="px-4 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded disabled:opacity-50 flex items-center gap-2"
                  >
                    {memberSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    Search
                  </button>
                </div>
                {memberResults.length > 0 && (
                  <div className="space-y-px border border-border bg-border max-w-md">
                    {memberResults.map((u) => (
                      <div key={u.login} className="flex items-center gap-3 bg-surface px-4 py-2.5">
                        <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                        <div className="flex-1 min-w-0">
                          <a href={u.html_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-heading font-medium hover:text-accent transition-colors">
                            {u.login}
                          </a>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleInviteMember(u)}
                          disabled={inviting === u.login}
                          className="text-[10px] px-3 py-1 border border-accent/30 text-accent hover:bg-accent/10 transition-colors rounded disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {inviting === u.login ? <Loader2 size={10} className="animate-spin" /> : <UserPlus size={10} />}
                          {inviting === u.login ? 'Adding…' : `Add as ${inviteRole}`}
                        </button>
                      </div>
                    ))}
                  </div>
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

          {/* Danger Zone */}
          <div className="border border-danger/30 bg-surface p-6">
            <div className="flex items-center gap-2 mb-4">
              <Trash2 size={14} className="text-danger" />
              <h3 className="font-sans text-sm font-bold text-danger">Danger Zone</h3>
            </div>
            {isOwner ? (
              <>
                <p className="text-xs text-muted mb-4">
                  Permanently delete this project and all associated tasks, events, and data. This action cannot be undone.
                </p>
                <button
                  type="button"
                  onClick={handleDeleteProject}
                  disabled={deletingProject}
                  className="flex items-center gap-2 px-5 py-2 border border-danger/40 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/10 transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deletingProject ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {deletingProject ? 'Deleting…' : 'Delete Project'}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-muted mb-4">
                  Remove yourself from this project. You will lose access and will need to be re-invited.
                </p>
                <button
                  type="button"
                  onClick={handleLeaveProject}
                  disabled={leavingProject}
                  className="flex items-center gap-2 px-5 py-2 border border-danger/40 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/10 transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {leavingProject ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                  {leavingProject ? 'Leaving…' : 'Leave Project'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>

    {/* Office File Picker modal */}
    {officePickerOpen && project && (
      <OfficeFilePicker
        projectId={project.id}
        projectName={project.name}
        onClose={() => setOfficePickerOpen(false)}
        onImported={() => { /* events list refreshes automatically via useEvents */ }}
      />
    )}

    {/* Add Task Modal — rendered globally so it works from any tab (timeline, calendar, tasks) */}
    <Modal open={goalModal.open} onClose={goalModal.onClose} title="Add Task">
      <form onSubmit={handleCreateGoal} className="space-y-4">
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
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Deadline (optional)</label>
          <input
            type="date"
            value={newGoalDeadline}
            onChange={(e) => setNewGoalDeadline(e.target.value)}
            title="Task deadline"
            className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Category</label>
            <select
              value={newGoalCategory}
              onChange={(e) => setNewGoalCategory(e.target.value)}
              title="Task category"
              className="w-full px-3 py-2.5 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
            >
              <option value="">— None —</option>
              <option value="Testing">Testing</option>
              <option value="Seeker">Seeker</option>
              <option value="Missile">Missile</option>
              <option value="Admin">Admin</option>
              <option value="Simulation">Simulation</option>
              <option value="DevOps">DevOps</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Line of Effort</label>
            <select
              value={newGoalLoe}
              onChange={(e) => setNewGoalLoe(e.target.value)}
              title="Line of Effort"
              className="w-full px-3 py-2.5 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
            >
              <option value="">— None —</option>
              <option value="Training">Training</option>
              <option value="Simulation">Simulation</option>
              <option value="JetsonCV">JetsonCV</option>
              <option value="Image Capture">Image Capture</option>
              <option value="Flight Software">Flight Software</option>
              <option value="IR Camera Suite">IR Camera Suite</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
            Assign To <span className="text-muted/60 normal-case tracking-normal">(select multiple)</span>
          </label>
          <div className="border border-border divide-y divide-border/50 max-h-32 overflow-y-auto">
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
        <div className="flex gap-3 pt-2">
          <button type="submit" className="px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md">
            Create Task
          </button>
          <button type="button" onClick={goalModal.onClose} className="px-6 py-2.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md">
            Cancel
          </button>
        </div>
      </form>
    </Modal>

    {/* Goal Edit Modal */}
    {editGoal && (
      <GoalEditModal
        goal={editGoal}
        members={allMembers.map((m) => ({ user_id: m.user_id, display_name: m.display_name }))}
        projectId={project.id}
        agent={agent}
        autoGuidance={editAutoGuidance}
        allGoals={goals.filter((g) => g.id !== editGoal.id)}
        filePaths={filePaths}
        githubRepo={project.github_repo}
        gitlabRepos={gitlabRepos}
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
        onClose={handleGoalEditClose}
      />
    )}

    {/* Goal Report Modal */}
    {reportGoal && (
      <GoalReportModal
        goal={reportGoal}
        projectId={project.id}
        onClose={() => setReportGoal(null)}
      />
    )}

    {/* Log Time Modal */}
    {logTimeGoal && (
      <LogTimeModal
        goalId={logTimeGoal.id}
        projectId={projectId!}
        goalTitle={logTimeGoal.title}
        onClose={() => setLogTimeGoal(null)}
        onLogged={() => { setLogTimeGoal(null); refetchTimeLogs(); }}
      />
    )}


    {/* ── File Preview Modal (code files from GitHub/GitLab) ─────────────── */}
    {previewFileRef && (
      <FilePreviewModal
        fileRef={previewFileRef}
        content={previewContent}
        loading={previewLoading}
        error={previewError}
        onClose={() => { setPreviewFileRef(null); setPreviewContent(null); setPreviewError(null); }}
      />
    )}

    {/* ── Repo Tree Modal (browse repo files from AI insight links) ────────── */}
    {repoTreeTarget && (
      <RepoTreeModal
        repo={repoTreeTarget.repo}
        type={repoTreeTarget.type}
        onClose={() => setRepoTreeTarget(null)}
      />
    )}
    {aiErrorDialog}

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
    </>
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
  const [files, setFiles] = useState<Array<{ id: string; name: string; folder?: unknown; lastModifiedDateTime: string }>>([]);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
              {/* Link current folder */}
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

// ── Goals Kanban Board ───────────────────────────────────────────────────────
type GoalStatus = import('../types').Goal['status'];

const KANBAN_COLUMNS: { status: GoalStatus; label: string; color: string; accent: string }[] = [
  { status: 'not_started', label: 'Not Started', color: 'text-[#D94F4F]', accent: 'border-[#D94F4F]/40' },
  { status: 'in_progress', label: 'In Progress', color: 'text-[#D97E2A]', accent: 'border-[#D97E2A]/40' },
  { status: 'in_review',   label: 'In Review',   color: 'text-[#facc15]', accent: 'border-[#facc15]/40' },
  { status: 'complete',    label: 'Complete',     color: 'text-[#6DBE7D]', accent: 'border-[#6DBE7D]/40' },
];

interface GoalsKanbanProps {
  goals: import('../types').Goal[];
  onUpdateStatus: (id: string, status: GoalStatus) => void;
  onEdit: (id: string) => void;
  onEditWithGuidance: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  getAssignee: (userId: string | null | undefined) => { display_name: string | null; avatar_url: string | null } | null;
  goalDependencies?: import('../types').GoalDependency[];
  timeLogTotals?: Map<string, number>;
  onLogTime?: (goalId: string) => void;
}

const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isStaleComplete(goal: import('../types').Goal): boolean {
  if (goal.status !== 'complete') return false;
  const updated = goal.updated_at ? new Date(goal.updated_at).getTime() : 0;
  return Date.now() - updated > STALE_MS;
}

function GoalsKanban({ goals, onUpdateStatus, onEdit, onEditWithGuidance, onDelete, onAdd, getAssignee, goalDependencies = [], timeLogTotals = new Map(), onLogTime }: GoalsKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<GoalStatus | null>(null);
  const [showStale, setShowStale] = useState(false);

  const handleDragStart = (e: React.DragEvent, goalId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('goalId', goalId);
    setDraggingId(goalId);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverCol(null);
  };

  const handleDragOver = (e: React.DragEvent, status: GoalStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(status);
  };

  const handleDrop = (e: React.DragEvent, status: GoalStatus) => {
    e.preventDefault();
    const goalId = e.dataTransfer.getData('goalId');
    if (goalId) onUpdateStatus(goalId, status);
    setDraggingId(null);
    setDragOverCol(null);
  };

  if (goals.length === 0) {
    return (
      <div className="border border-border bg-surface p-12 text-center">
        <Target size={32} className="text-border mx-auto mb-3" />
        <p className="text-sm text-muted mb-4">No tasks yet. Add your first task to start tracking progress.</p>
        <button type="button" onClick={onAdd}
          className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md">
          <Plus size={14} /> Add Task
        </button>
      </div>
    );
  }

  const barColors: Record<GoalStatus, string> = {
    not_started: 'bg-[#D94F4F]/50',
    in_progress: 'bg-[#D97E2A]/70',
    in_review:   'bg-[#facc15]/70',
    complete:    'bg-[#6DBE7D]/70',
  };

  const riskDotColor = (score: number | null | undefined) => {
    if (score == null) return null;
    if (score >= 0.75) return 'bg-red-500';
    if (score >= 0.5) return 'bg-orange-400';
    if (score >= 0.25) return 'bg-yellow-400';
    return 'bg-green-500';
  };

  const renderCard = (goal: import('../types').Goal, colStatus: GoalStatus, stale = false) => {
    const assigneeList = (goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : [])).map(getAssignee).filter(Boolean);
    const isDragging = draggingId === goal.id;
    const barCls = barColors[colStatus];
    const riskDot = riskDotColor(goal.risk_score);
    const myDeps = goalDependencies.filter((d) => d.goal_id === goal.id);
    const blockedDeps = myDeps.filter((d) => {
      const depGoal = goals.find((g) => g.id === d.depends_on_goal_id);
      return depGoal && depGoal.status !== 'complete';
    });
    const loggedHours = timeLogTotals.get(goal.id);
    return (
      <div
        key={goal.id}
        draggable
        onDragStart={(e) => handleDragStart(e, goal.id)}
        onDragEnd={handleDragEnd}
        className={`group border rounded p-3 cursor-grab active:cursor-grabbing select-none transition-all ${
          isDragging ? 'opacity-30' : 'hover:border-border/80 hover:shadow-sm'
        } ${stale ? 'bg-surface border-border/30 opacity-40 saturate-0' : 'bg-surface2 border-border'}`}
      >
        <div className="flex items-start justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {riskDot && <span className={`w-2 h-2 rounded-full shrink-0 ${riskDot}`} title={`Risk score: ${Math.round((goal.risk_score ?? 0) * 100)}`} />}
            <div className="min-w-0">
              <p className="text-xs text-heading font-medium leading-snug">{goal.title}</p>
              {goal.loe && <p className="text-[9px] text-accent2 font-mono mt-0.5 truncate">{goal.loe}</p>}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {onLogTime && (
              <button type="button" title="Log time" onClick={(e) => { e.stopPropagation(); onLogTime(goal.id); }}
                className="p-0.5 text-muted hover:text-accent2 transition-colors opacity-0 group-hover:opacity-100">
                <Clock size={11} />
              </button>
            )}
            <button type="button" title="Get AI guidance" onClick={(e) => { e.stopPropagation(); onEditWithGuidance(goal.id); }}
              className="p-0.5 text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100">
              <Sparkles size={11} />
            </button>
            <button type="button" title="Expand goal" onClick={() => onEdit(goal.id)}
              className="p-0.5 text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100">
              <ExternalLink size={11} />
            </button>
            <button type="button" title="Delete goal" onClick={() => onDelete(goal.id)}
              className="p-0.5 text-muted hover:text-danger transition-colors">
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        <div className="mb-2">
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barCls}`}
              style={{ width: `${goal.progress ?? 0}%` }}
            />
          </div>
          <span className="text-[9px] text-muted font-mono">{goal.progress ?? 0}%</span>
        </div>

        <div className="flex items-center justify-between gap-1 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {goal.deadline && (
              <span className="text-[9px] text-muted font-mono">{new Date(goal.deadline).toLocaleDateString()}</span>
            )}
            {goal.category && (
              <span className="text-[9px] px-1.5 py-0.5 border border-border text-muted rounded font-mono">{goal.category}</span>
            )}
            {assigneeList.length > 0 && (
              <div className="flex items-center gap-0.5 flex-wrap">
                {assigneeList.slice(0, 2).map((a) => (
                  <span key={a!.user_id} className="text-[9px] text-muted truncate max-w-[70px]">{a!.display_name}</span>
                ))}
                {assigneeList.length > 2 && (
                  <span className="text-[9px] text-muted font-mono">+{assigneeList.length - 2}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {myDeps.length > 0 && (
              <span className={`text-[9px] font-mono flex items-center gap-0.5 ${blockedDeps.length > 0 ? 'text-red-400' : 'text-muted'}`}
                title={`${myDeps.length} dependenc${myDeps.length === 1 ? 'y' : 'ies'}${blockedDeps.length > 0 ? ` (${blockedDeps.length} blocking)` : ''}`}>
                <Link size={8} />{myDeps.length}
              </span>
            )}
            {loggedHours != null && loggedHours > 0 && (
              <span className="text-[9px] text-muted font-mono flex items-center gap-0.5" title="Hours logged">
                <Clock size={8} />{loggedHours.toFixed(1)}h
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[60vh]">
      {KANBAN_COLUMNS.map((col) => {
        const allColGoals = goals.filter((g) => g.status === col.status);
        const isComplete = col.status === 'complete';
        const freshGoals = isComplete ? allColGoals.filter((g) => !isStaleComplete(g)) : allColGoals;
        const staleGoals = isComplete ? allColGoals.filter((g) => isStaleComplete(g)) : [];
        const isOver = dragOverCol === col.status;

        return (
          <div
            key={col.status}
            className={`flex flex-col flex-1 min-w-0 border rounded transition-colors ${
              isOver ? `${col.accent} bg-surface2` : 'border-border bg-surface'
            }`}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${col.color}`}>{col.label}</span>
                <span className="text-[10px] text-muted bg-surface2 px-1.5 py-0.5 rounded font-mono">
                  {freshGoals.length}{staleGoals.length > 0 ? `+${staleGoals.length}` : ''}
                </span>
              </div>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto">
              {freshGoals.length === 0 && !isOver && (
                <p className="text-[10px] text-muted/50 text-center py-4">No tasks here</p>
              )}
              {freshGoals.map((goal) => renderCard(goal, col.status, false))}

              {/* Stale completed goals */}
              {isComplete && staleGoals.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowStale((v) => !v)}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted hover:text-heading border border-dashed border-border/50 rounded transition-colors mt-1"
                  >
                    <span className={`transition-transform ${showStale ? 'rotate-90' : ''}`}>▶</span>
                    {showStale ? 'Hide' : 'Show'} {staleGoals.length} archived goal{staleGoals.length !== 1 ? 's' : ''}
                  </button>
                  {showStale && staleGoals.map((goal) => renderCard(goal, col.status, true))}
                </>
              )}

              {/* Drop target hint when dragging */}
              {isOver && draggingId && (
                <div className={`border-2 border-dashed ${col.accent} rounded p-3 text-center text-[10px] text-muted`}>
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
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
  onOpenOfficePicker: () => void;
  onRefresh: () => void;
  savedReportsVersion?: number;
}

function DocumentsTab({
  events, eventsLoading, projectId,
  docEditMode, setDocEditMode,
  docSelected, setDocSelected,
  bulkDeleting, setBulkDeleting,
  deletingEventId, setDeletingEventId,
  onOpenOfficePicker, onRefresh,
  savedReportsVersion = 0,
}: DocumentsTabProps) {
  const docs = events.filter((e) =>
    e.source === 'onenote' || e.source === 'onedrive' || e.source === 'local' || e.source === 'teams'
  );
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
    a.download = meta.filename ?? e.title;
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
              <button
                type="button"
                onClick={onOpenOfficePicker}
                className="flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
              >
                <Plus size={12} /> Import from Office 365
              </button>
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
                      const rc = r.content as ReportContent;
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
                    onClick={() => exportGoalsCSV(r.content as ReportContent)}
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
  project: { name: string; github_repo?: string | null } | null;
  githubRepo: string | null;
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
  const tree = buildTree(files);
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
  const [openFile, setOpenFile] = useState<string | null>(null);

  const filteredFiles = fileSearch
    ? files.filter((f) => f.path.toLowerCase().includes(fileSearch.toLowerCase()))
    : files;

  const externalFileUrl = (path: string) => {
    if (source === 'github') return `https://github.com/${repoId}/blob/HEAD/${path}`;
    return undefined; // GitLab host is env-specific; skip for now
  };

  return (
    <>
      {openFile && (
        <FileViewerLazy
          source={source}
          repo={repoId}
          path={openFile}
          externalUrl={externalFileUrl(openFile)}
          onClose={() => setOpenFile(null)}
        />
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
                  {fileSearch ? (
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
    if (!githubRepo) return;
    setGhLoading(true);
    const [owner, repo] = githubRepo.split('/');
    Promise.all([
      fetch(`/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree`).then((r) => r.ok ? r.json() : null),
    ]).then(([recent, tree]) => {
      if (recent) {
        setGhCommits(parseCommits(recent.commits ?? []));
        if (recent.readme) setGhReadme(recent.readme);
      }
      if (tree?.files) setGhFiles(tree.files);
    }).catch(() => {}).finally(() => setGhLoading(false));
  }, [githubRepo]);

  useEffect(() => {
    if (!gitlabRepo) return;
    setGlLoading(true);
    Promise.all([
      fetch(`/api/gitlab/recent?repo=${encodeURIComponent(gitlabRepo)}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/gitlab/tree?repo=${encodeURIComponent(gitlabRepo)}`).then((r) => r.ok ? r.json() : null),
    ]).then(([recent, tree]) => {
      if (recent) {
        setGlCommits(parseCommits(recent.commits ?? []));
        if (recent.readme) setGlReadme(recent.readme);
      }
      if (tree?.files) setGlFiles(tree.files);
    }).catch(() => {}).finally(() => setGlLoading(false));
  }, [gitlabRepo]);

  const handleGitLabScan = async () => {
    if (!gitlabRepo || !project) return;
    setGlScanLoading(true);
    setGlScanResults(null);
    try {
      const recentRes = await fetch(`/api/gitlab/recent?repo=${encodeURIComponent(gitlabRepo)}`);
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
        icon={<Github size={14} className={githubRepo ? 'text-heading' : 'text-muted'} />}
        source="github"
        repoId={githubRepo ?? ''}
        repoLabel={githubRepo ?? undefined}
        repoUrl={githubRepo ? `https://github.com/${githubRepo}` : undefined}
        commits={ghCommits}
        readme={ghReadme}
        files={ghFiles}
        loading={ghLoading}
        connected={!!githubRepo}
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
                    {(doc.metadata as Record<string, unknown>)?.url && (
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

// ── GitLab repo section (Settings tab) ───────────────────────────────────────
function GitLabSection({ projectId, onReposChanged }: { projectId: string; onReposChanged?: (repos: string[]) => void }) {
  const [linkedRepos, setLinkedRepos] = useState<string[]>([]);
  const [repoInput, setRepoInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

      {/* Linked repos list */}
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

      {/* Add repo input — always visible */}
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

// ── Project name / description editor (used in Settings tab) ─────────────────
function ProjectNameForm({
  project,
  updateProject,
  isOwner,
}: {
  project: { name: string; description?: string | null; start_date?: string | null; invite_code?: string | null };
  updateProject: (updates: { name?: string; description?: string; start_date?: string | null; invite_code?: string }) => Promise<unknown>;
  isOwner: boolean;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [startDate, setStartDate] = useState(project.start_date ?? '');
  const [inviteCode, setInviteCode] = useState(project.invite_code ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copiedInviteCode, setCopiedInviteCode] = useState(false);

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
          {/* Left column: Name + Start Date stacked */}
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
          {/* Right column: Description */}
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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-heading font-sans font-semibold">{value}</span>
    </div>
  );
}
