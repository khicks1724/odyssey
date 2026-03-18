import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  GanttChart,
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
  Clock,
} from 'lucide-react';
import GoalMetrics from '../components/GoalMetrics';
import FileViewerLazy from '../components/FileViewer';
import OfficeFilePicker from '../components/OfficeFilePicker';
import ProjectChat from '../components/ProjectChat';
import { useProject } from '../hooks/useProjects';
import { fetchOneDriveFiles, useMicrosoftIntegration, deleteImportedEvent } from '../hooks/useMicrosoftIntegration';
import { useGoals } from '../hooks/useGoals';
import { useEvents } from '../hooks/useEvents';
import { useAuth } from '../lib/auth';
import { useAIAgent } from '../lib/ai-agent';
import { supabase } from '../lib/supabase';
import GoalCard from '../components/GoalCard';
import ActivityFeed from '../components/ActivityFeed';
import Timeline from '../components/Timeline';
import TimelinePage from '../components/TimelinePage';
import StatusBadge from '../components/StatusBadge';
import Modal, { useModal } from '../components/Modal';

const tabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'timeline', label: 'Timeline', icon: GanttChart },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'metrics', label: 'Metrics', icon: TrendingUp },
  { id: 'documents', label: 'Documents', icon: Link },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'settings', label: 'Settings', icon: Settings },
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
  const { user } = useAuth();
  const { agent } = useAIAgent();
  const { project, loading: projectLoading, updateProject, refetch: refetchProject } = useProject(projectId);
  const { goals, createGoal, updateGoal, deleteGoal } = useGoals(projectId);
  const { events, loading: eventsLoading, refetch: refetchEvents } = useEvents(projectId);
  const { status: msStatus } = useMicrosoftIntegration();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const goalModal = useModal();
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');
  const [newGoalCategory, setNewGoalCategory] = useState('');
  const [newGoalAssignee, setNewGoalAssignee] = useState('');

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
  const [insights, setInsights] = useState<{ status: string; nextSteps: string[]; futureFeatures: string[]; provider?: string } | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);

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

  // GitLab linked repo (for overview panel)
  const [gitlabRepo, setGitlabRepo] = useState<string | null>(null);

  // Teams folder integration (project-level)
  const [teamsFolder, setTeamsFolder] = useState<{ id: string; name: string } | null>(null);
  const [teamsFolderPickerOpen, setTeamsFolderPickerOpen] = useState(false);
  const [teamsFolderSaving, setTeamsFolderSaving] = useState(false);

  // Members state
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<GitHubUser[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  // Load persisted insights + Teams folder on mount
  useEffect(() => {
    if (!projectId) return;

    // Load saved AI insights
    supabase
      .from('project_insights')
      .select('status, next_steps, future_features, provider, generated_at')
      .eq('project_id', projectId)
      .single()
      .then(({ data }) => {
        if (data) {
          setInsights({
            status: data.status,
            nextSteps: data.next_steps as string[],
            futureFeatures: data.future_features as string[],
            provider: data.provider,
          });
        }
      });

    // Load GitLab integration
    supabase
      .from('integrations')
      .select('config')
      .eq('project_id', projectId)
      .eq('type', 'gitlab')
      .single()
      .then(({ data }) => {
        if (data?.config) {
          const cfg = data.config as { repo: string };
          setGitlabRepo(cfg.repo);
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
      setScanResults(scanData);
    } catch (err) {
      console.error('Scan failed:', err);
    }
    setScanLoading(false);
  };

  // Generate AI project insights
  const handleGenerateInsights = async () => {
    if (!project) return;
    setInsightsLoading(true);
    setInsights(null);
    setInsightsError(null);
    try {
      let commits: string[] = [];
      let readme = '';
      if (project.github_repo) {
        const [owner, repo] = project.github_repo.split('/');
        try {
          const recentRes = await fetch(`${API_BASE}/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent`);
          const recentData = await recentRes.json();
          commits = recentData.commits || [];
          readme = recentData.readme || '';
        } catch { /* repo fetch optional */ }
      }
      const res = await fetch(`${API_BASE}/ai/project-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          projectName: project.name,
          projectDescription: project.description,
          githubRepo: project.github_repo,
          goals: goals.map((g) => ({ title: g.title, status: g.status, progress: g.progress, deadline: g.deadline })),
          commits,
          readme,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInsightsError(data.error || `AI request failed (${res.status})`);
      } else if (!data.status && !data.nextSteps?.length) {
        setInsightsError('AI returned an empty response. Try a different model.');
      } else {
        setInsights(data);
        // Persist insights so they survive page changes and server restarts
        if (projectId) {
          supabase.from('project_insights').upsert(
            {
              project_id: projectId,
              status: data.status,
              next_steps: data.nextSteps,
              future_features: data.futureFeatures,
              provider: data.provider ?? agent,
              generated_at: new Date().toISOString(),
            },
            { onConflict: 'project_id' },
          );
        }
      }
    } catch (err) {
      console.error('Insights failed:', err);
      setInsightsError('Network error — is the server running?');
    }
    setInsightsLoading(false);
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
      await supabase.from('project_members').insert({ project_id: projectId, user_id: userId, role: 'member' });
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
        <button onClick={() => navigate('/projects')} className="text-accent text-xs hover:underline">
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

  const projectStatus = goals.some((g) => g.status === 'at_risk') ? 'at_risk'
    : goals.every((g) => g.status === 'complete') && goals.length > 0 ? 'complete'
    : 'on_track';

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;
    await createGoal({
      title: newGoalTitle,
      deadline: newGoalDeadline || undefined,
      category: newGoalCategory.trim() || 'General',
      assigned_to: newGoalAssignee || undefined,
    });
    setNewGoalTitle('');
    setNewGoalDeadline('');
    setNewGoalCategory('');
    setNewGoalAssignee('');
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
        onClick={() => navigate('/projects')}
        className="flex items-center gap-1 text-muted hover:text-heading text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Back to Projects
      </button>

      {/* Project Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
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
          <StatusBadge status={projectStatus} size="md" />
        </div>
        {project.description && (
          <p className="text-sm text-muted">{project.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-px border border-border bg-border mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 py-3 bg-surface text-xs tracking-wider uppercase transition-colors first:rounded-tl last:rounded-tr ${
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
                <StatRow label="Goals" value={`${completedGoals.length} / ${goals.length}`} />
                <StatRow label="Overall Progress" value={`${overallProgress}%`} />
                <StatRow label="Events" value={String(events.length)} />
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
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className={gitlabRepo ? 'text-[#FC6D26]' : 'text-muted'}>
                    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51 1.22 3.78a.84.84 0 01-.3.92z"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium">GitLab <span className="text-[9px] text-muted font-mono">NPS</span></div>
                    {gitlabRepo ? (
                      <div className="text-[10px] text-muted truncate">{gitlabRepo}</div>
                    ) : (
                      <div className="text-[10px] text-muted">Not connected</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="text-[10px] text-accent hover:underline"
                  >
                    {gitlabRepo ? 'Manage' : 'Connect'}
                  </button>
                </div>
              </div>
            </div>
            <div className="bg-surface p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-accent" />
                  <h3 className="font-sans text-sm font-bold text-heading">AI Insights</h3>
                </div>
                <button
                  onClick={handleGenerateInsights}
                  disabled={insightsLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider uppercase font-medium
                             bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {insightsLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                  {insightsLoading ? 'Analyzing…' : 'Generate'}
                </button>
              </div>
              {!insights && !insightsLoading && !insightsError && (
                <p className="text-xs text-muted leading-relaxed">
                  Click Generate to analyze your project with AI.
                </p>
              )}
            </div>
          </div>

          {/* AI Insights Results */}
          {(insights || insightsLoading || insightsError) && (
            <div className="border border-border bg-surface p-6 mb-8">
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
                  {/* Provider badge */}
                  {insights.provider && (
                    <div className="flex items-center gap-1.5 text-[10px] text-muted">
                      <CheckCircle size={10} className="text-green-500" />
                      Generated by <span className="font-medium text-heading">{insights.provider}</span>
                    </div>
                  )}

                  {/* Project Status */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 size={14} className="text-accent" />
                      <h4 className="font-sans text-sm font-bold text-heading">Project Status</h4>
                    </div>
                    <p className="text-xs text-muted leading-relaxed pl-5">{insights.status}</p>
                  </div>

                  {/* Next Steps */}
                  {insights.nextSteps?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Target size={14} className="text-accent2" />
                        <h4 className="font-sans text-sm font-bold text-heading">What to Work on Next</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {insights.nextSteps.map((step: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-accent font-mono text-[10px] mt-0.5">{i + 1}.</span>
                            {step}
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
                        <h4 className="font-sans text-sm font-bold text-heading">Future Feature Ideas</h4>
                      </div>
                      <ul className="space-y-1.5 pl-5">
                        {insights.futureFeatures.map((feat: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                            <span className="text-yellow-500">◆</span>
                            {feat}
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
              <Target size={14} className="text-accent2" />
              <h3 className="font-sans text-sm font-bold text-heading">Timeline</h3>
            </div>
            <Timeline goals={goals} />
          </div>

          {/* Recent Activity */}
          <div className="border border-border bg-surface p-6">
            <div className="flex items-center gap-2 mb-6">
              <Activity size={14} className="text-accent" />
              <h3 className="font-sans text-sm font-bold text-heading">Recent Activity</h3>
            </div>
            <ActivityFeed
              events={events.slice(0, 10)}
              loading={eventsLoading}
              emptyMessage="No activity yet. Connect a GitHub repo to start."
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
        <TimelinePage goals={goals} projectName={project.name} />
      )}

      {activeTab === 'activity' && (
        <div className="border border-border bg-surface p-6">
          <ActivityFeed
            events={events}
            loading={eventsLoading}
            emptyMessage="No activity yet. Connect a GitHub repo to start tracking."
          />
        </div>
      )}

      {activeTab === 'goals' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-sans text-sm font-bold text-heading">Goals ({goals.length})</h3>
            <div className="flex items-center gap-2">
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
                <Plus size={14} /> Add Goal
              </button>
            </div>
          </div>

          {syncResult && (
            <div className="mb-4 border border-accent/20 bg-accent/5 rounded p-4 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-accent">
                  {syncResult.applied > 0 ? `Updated ${syncResult.applied} goal${syncResult.applied > 1 ? 's' : ''} from Office documents` : 'Analysis complete — no changes needed'}
                </span>
                <button type="button" title="Dismiss" onClick={() => setSyncResult(null)} className="text-muted hover:text-heading"><X size={12} /></button>
              </div>
              <p className="text-muted leading-relaxed">{syncResult.summary}</p>
              {syncResult.provider && <p className="text-[10px] text-muted/60 mt-1">via {syncResult.provider}</p>}
            </div>
          )}
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

            onDelete={deleteGoal}
            onAdd={goalModal.onOpen}
            getAssignee={getAssignee}
          />

          <Modal open={goalModal.open} onClose={goalModal.onClose} title="Add Goal">
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
                  title="Goal deadline"
                  className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Category</label>
                <select
                  value={newGoalCategory}
                  onChange={(e) => setNewGoalCategory(e.target.value)}
                  title="Goal category"
                  className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
                >
                  <option value="">— Select category —</option>
                  <option value="Testing">Testing</option>
                  <option value="Seeker">Seeker</option>
                  <option value="Missile">Missile</option>
                  <option value="Admin">Admin</option>
                  <option value="Simulation">Simulation</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Assign to (optional)</label>
                <select
                  value={newGoalAssignee}
                  onChange={(e) => setNewGoalAssignee(e.target.value)}
                  title="Assign goal to team member"
                  className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
                >
                  <option value="">Unassigned</option>
                  {allMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md">
                  Create Goal
                </button>
                <button type="button" onClick={goalModal.onClose} className="px-6 py-2.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md">
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
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
        />
      )}

      {activeTab === 'integrations' && (
        <IntegrationsPreviewTab
          projectId={projectId!}
          project={project ? { name: project.name, github_repo: project.github_repo } : null}
          githubRepo={project?.github_repo ?? null}
          gitlabRepo={gitlabRepo}
          goals={goals.map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress ?? 0 }))}
          o365Docs={events.filter((e) => ['onenote', 'onedrive', 'teams', 'local'].includes(e.source))}
          onNavigateSettings={() => setActiveTab('settings')}
        />
      )}

      {activeTab === 'settings' && (
        <div className="space-y-8">
          {/* Team Members */}
          <div className="space-y-4">
            <div className="border border-border bg-surface p-6">
              <div className="flex items-center gap-2 mb-6">
                <Users size={14} className="text-accent2" />
                <h3 className="font-sans text-sm font-bold text-heading">
                  Team Members ({members.length + 1})
                </h3>
              </div>
              <div className="space-y-px border border-border bg-border">
                <div className="flex items-center gap-3 bg-surface px-4 py-3">
                  {user?.user_metadata?.avatar_url ? (
                    <img src={user.user_metadata.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center">
                      <span className="text-[10px] text-accent font-bold">You</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-heading font-medium truncate">
                      {user?.user_metadata?.user_name ?? user?.email ?? 'You'}
                    </div>
                    <div className="text-[10px] text-muted">Owner</div>
                  </div>
                </div>
                {members.map((m) => (
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
                      </div>
                      <div className="text-[10px] text-muted capitalize">{m.role}</div>
                    </div>
                    {m.user_id !== user?.id && (
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
                ))}
              </div>
            </div>

            <div className="border border-border bg-surface p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserPlus size={14} className="text-accent" />
                <h3 className="font-sans text-sm font-bold text-heading">Invite by GitHub Username</h3>
              </div>
              <p className="text-[11px] text-muted mb-4">
                Search for a GitHub user — they must have signed into Odyssey at least once.
              </p>
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
                        {inviting === u.login ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Project Name & Description */}
          <ProjectNameForm project={project} updateProject={updateProject} />

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

                <button
                  type="button"
                  onClick={handleRepoScan}
                  disabled={scanLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md disabled:opacity-50"
                >
                  {scanLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {scanLoading ? 'Scanning...' : 'Scan with AI'}
                </button>

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
          <GitLabSection projectId={projectId!} onLinked={(repo) => setGitlabRepo(repo)} />
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

    {/* Project AI Chat */}
    <ProjectChat projectId={project.id} projectName={project.name} />

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
  { status: 'not_started', label: 'Not Started', color: 'text-muted',        accent: 'border-border' },
  { status: 'in_progress', label: 'In Progress', color: 'text-accent2',      accent: 'border-accent2/40' },
  { status: 'in_review',   label: 'In Review',   color: 'text-yellow-400',   accent: 'border-yellow-400/40' },
  { status: 'complete',    label: 'Complete',     color: 'text-accent3',      accent: 'border-accent3/40' },
];

interface GoalsKanbanProps {
  goals: import('../types').Goal[];
  onUpdateStatus: (id: string, status: GoalStatus) => void;

  onDelete: (id: string) => void;
  onAdd: () => void;
  getAssignee: (userId: string | null | undefined) => { display_name: string | null; avatar_url: string | null } | null;
}

function GoalsKanban({ goals, onUpdateStatus, onDelete, onAdd, getAssignee }: GoalsKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<GoalStatus | null>(null);

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
        <p className="text-sm text-muted mb-4">No goals yet. Add your first goal to start tracking progress.</p>
        <button type="button" onClick={onAdd}
          className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md">
          <Plus size={14} /> Add Goal
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[60vh]">
      {KANBAN_COLUMNS.map((col) => {
        const colGoals = goals.filter((g) => g.status === col.status);
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
            <div className={`flex items-center justify-between px-3 py-2.5 border-b border-border`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${col.color}`}>{col.label}</span>
                <span className="text-[10px] text-muted bg-surface2 px-1.5 py-0.5 rounded font-mono">{colGoals.length}</span>
              </div>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto">
              {colGoals.map((goal) => {
                const assignee = getAssignee(goal.assigned_to);
                const isDragging = draggingId === goal.id;
                return (
                  <div
                    key={goal.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, goal.id)}
                    onDragEnd={handleDragEnd}
                    className={`group bg-surface2 border border-border rounded p-3 cursor-grab active:cursor-grabbing select-none transition-opacity ${
                      isDragging ? 'opacity-30' : 'hover:border-border/80 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 mb-2">
                      <p className="text-xs text-heading font-medium leading-snug flex-1">{goal.title}</p>
                      <button
                        type="button"
                        title="Delete goal"
                        onClick={() => onDelete(goal.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted hover:text-danger transition-all shrink-0"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {/* Progress bar — driven by status */}
                    {(() => {
                      const barMeta: Record<GoalStatus, { pct: number; cls: string }> = {
                        not_started: { pct: 0,   cls: 'bg-muted/40' },
                        in_progress: { pct: 40,  cls: 'bg-accent2' },
                        in_review:   { pct: 75,  cls: 'bg-yellow-400' },
                        complete:    { pct: 100, cls: 'bg-accent3' },
                      };
                      const bar = barMeta[col.status];
                      return (
                        <div className="mb-2">
                          <div className="h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${bar.cls} w-[var(--p)]`}
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              {...({ style: { '--p': `${bar.pct}%` } } as any)}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      {goal.deadline && (
                        <span className="text-[9px] text-muted font-mono">{new Date(goal.deadline).toLocaleDateString()}</span>
                      )}
                      {goal.category && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-border text-muted rounded font-mono">{goal.category}</span>
                      )}
                      {assignee && (
                        <span className="text-[9px] text-muted truncate max-w-[80px]">{assignee.display_name}</span>
                      )}
                    </div>
                  </div>
                );
              })}

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
}

function DocumentsTab({
  events, eventsLoading, projectId,
  docEditMode, setDocEditMode,
  docSelected, setDocSelected,
  bulkDeleting, setBulkDeleting,
  deletingEventId, setDeletingEventId,
  onOpenOfficePicker, onRefresh,
}: DocumentsTabProps) {
  const docs = events.filter((e) =>
    e.source === 'onenote' || e.source === 'onedrive' || e.source === 'local' || e.source === 'teams'
  );
  const allSelected = docSelected.size === docs.length && docs.length > 0;

  const toggleRow = (id: string) => {
    const next = new Set(docSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setDocSelected(next);
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(docSelected);
    await Promise.all(ids.map((id) => deleteImportedEvent(id)));
    setDocSelected(new Set());
    setDocEditMode(false);
    setBulkDeleting(false);
    onRefresh();
  };

  const handleSingleDelete = async (id: string) => {
    setDeletingEventId(id);
    await deleteImportedEvent(id);
    setDeletingEventId(null);
    onRefresh();
  };

  const handleUpload = async (files: File[]) => {
    if (!files.length) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    for (const file of files) {
      let content: string | undefined;
      const isText = file.type.startsWith('text/') || /\.(txt|md|csv|json|xml|log|yaml|yml|ts|js|py)$/i.test(file.name);
      if (isText) {
        content = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsText(file);
        });
      }
      await fetch('/api/uploads/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId, filename: file.name, mimeType: file.type, size: file.size, content }),
      });
    }
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
                title="Upload local file"
                className="flex items-center gap-2 px-4 py-2 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md cursor-pointer"
              >
                <Plus size={12} /> Upload File
                <input
                  type="file"
                  title="Upload local file"
                  className="sr-only"
                  multiple
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
                </div>
              </div>
              {!docEditMode && (
                <div className="flex items-center gap-2 shrink-0">
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
  gitlabRepo: string | null;
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
  const [open, setOpen] = useState(depth < 1);
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
  commits: CommitEntry[];
  readme: string | null;
  files: FileEntry[];
  loading: boolean;
  connected: boolean;
  onNavigateSettings: () => void;
  scanButton?: React.ReactNode;
}) {
  const [view, setView] = useState<'commits' | 'files' | 'readme'>('commits');
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
          <div className="flex items-center gap-2 min-w-0">
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
              {(['commits', 'files', 'readme'] as const).map((t) => (
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

function IntegrationsPreviewTab({ projectId: _projectId, project, githubRepo, gitlabRepo, goals, o365Docs, onNavigateSettings }: IntegrationsPreviewTabProps) {
  const { agent } = useAIAgent();
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
        repoLabel={gitlabRepo ?? undefined}
        commits={glCommits}
        readme={glReadme}
        files={glFiles}
        loading={glLoading}
        connected={!!gitlabRepo}
        onNavigateSettings={onNavigateSettings}
        scanButton={gitlabRepo ? (
          <button
            type="button"
            onClick={handleGitLabScan}
            disabled={glScanLoading}
            className="flex items-center gap-1.5 px-3 py-1 text-[10px] tracking-wider uppercase font-medium bg-[#FC6D26]/10 text-[#FC6D26] border border-[#FC6D26]/20 rounded hover:bg-[#FC6D26]/20 transition-colors disabled:opacity-50"
          >
            {glScanLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            {glScanLoading ? 'Scanning…' : 'Scan with AI'}
          </button>
        ) : undefined}
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
function GitLabSection({ projectId, onLinked }: { projectId: string; onLinked?: (repo: string | null) => void }) {
  const [linkedRepo, setLinkedRepo] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ name: string; web_url: string; last_activity: string; visibility: string } | null>(null);

  useEffect(() => {
    supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').single()
      .then(({ data }) => {
        if (data?.config) {
          const cfg = data.config as { repo: string };
          setLinkedRepo(cfg.repo);
        }
      });
  }, [projectId]);

  useEffect(() => {
    if (!linkedRepo) { setInfo(null); return; }
    fetch(`/api/gitlab/info?repo=${encodeURIComponent(linkedRepo)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setInfo(d); })
      .catch(() => {});
  }, [linkedRepo]);

  const handleLink = async () => {
    const raw = repoInput.trim();
    if (!raw) return;
    const path = raw.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '');
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
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to link repo');
      } else {
        setLinkedRepo(path);
        setRepoInput('');
        onLinked?.(path);
      }
    } catch {
      setError('Network error — check server is running');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`/api/gitlab/link?projectId=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setLinkedRepo(null);
      setInfo(null);
      onLinked?.(null);
    } catch { /* ignore */ }
  };

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-6">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className="text-[#FC6D26]">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51 1.22 3.78a.84.84 0 01-.3.92z"/>
        </svg>
        <h3 className="font-sans text-sm font-bold text-heading">GitLab Repository</h3>
        <span className="text-[9px] px-1.5 py-0.5 border border-border text-muted rounded font-mono">NPS</span>
      </div>

      {linkedRepo ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 border border-[#FC6D26]/20 bg-[#FC6D26]/5 rounded">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-heading font-mono truncate">{linkedRepo}</div>
              {info && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[10px] text-muted">{info.name}</div>
                  <div className="text-[10px] text-muted">
                    Last activity {new Date(info.last_activity).toLocaleDateString()} · {info.visibility}
                  </div>
                </div>
              )}
              {info?.web_url && (
                <a href={info.web_url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-[#FC6D26] hover:underline mt-1 inline-block">
                  Open in GitLab →
                </a>
              )}
            </div>
            <button type="button" onClick={handleUnlink}
              className="px-3 py-1.5 border border-danger/30 text-danger text-[10px] tracking-wider uppercase hover:bg-danger/5 transition-colors rounded shrink-0">
              Disconnect
            </button>
          </div>
          <p className="text-[11px] text-muted">Commits and README from this repo are included in AI insights and chat context.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Link your NPS GitLab repository. Paste the full URL or just the project path.
          </p>
          <div className="flex gap-2 max-w-lg">
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLink()}
              placeholder="usmc-capability-development/digital-trident-ir-camera-suite"
              title="GitLab repository path or URL"
              className="flex-1 px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-[#FC6D26]/50 transition-colors rounded"
            />
            <button type="button" onClick={handleLink} disabled={saving || !repoInput.trim()}
              className="px-4 py-3 bg-[#FC6D26]/10 border border-[#FC6D26]/30 text-[#FC6D26] text-xs font-semibold tracking-wider uppercase hover:bg-[#FC6D26]/20 transition-colors rounded disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
              Connect
            </button>
          </div>
          {error && <p className="text-xs text-danger font-mono">{error}</p>}
          <p className="text-[10px] text-muted">Must be on the NPS network or VPN for the server to reach gitlab.nps.edu</p>
        </div>
      )}
    </div>
  );
}

// ── Project name / description editor (used in Settings tab) ─────────────────
function ProjectNameForm({
  project,
  updateProject,
}: {
  project: { name: string; description?: string | null };
  updateProject: (updates: { name?: string; description?: string }) => Promise<unknown>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = name.trim() !== project.name || description.trim() !== (project.description ?? '');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await updateProject({ name: name.trim(), description: description.trim() || undefined });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings size={14} className="text-heading" />
        <h3 className="font-sans text-sm font-bold text-heading">Project Details</h3>
      </div>
      <form onSubmit={handleSave} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Project Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            title="Project name"
            placeholder="Project name"
            className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this project about?"
            className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors rounded resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !dirty || !name.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle size={12} /> : null}
          {saved ? 'Saved' : 'Save Changes'}
        </button>
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
