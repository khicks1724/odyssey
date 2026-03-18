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
} from 'lucide-react';
import GoalMetrics from '../components/GoalMetrics';
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
  { id: 'members', label: 'Members', icon: Users },
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
  const { events, loading: eventsLoading } = useEvents(projectId);
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
            className={`flex items-center gap-2 px-5 py-3 bg-surface text-xs tracking-wider uppercase transition-colors first:rounded-tl last:rounded-tr ${
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
                  onClick={() => setActiveTab('settings')}
                  className="text-[10px] text-accent hover:underline"
                >
                  {project.github_repo ? 'Manage' : 'Connect'}
                </button>
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
            <h3 className="font-sans text-sm font-bold text-heading">
              Goals ({goals.length})
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncOfficeProgress}
                disabled={syncingProgress}
                title="Analyze imported Office documents and auto-update goal progress using AI"
                className="inline-flex items-center gap-2 px-4 py-2 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md disabled:opacity-50"
              >
                {syncingProgress ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Sync from Office
              </button>
              <button
                onClick={goalModal.onOpen}
                className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
              >
                <Plus size={14} />
                Add Goal
              </button>
            </div>
          </div>

          {/* Office sync result */}
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
            <div className="mb-4 border border-danger/20 bg-danger/5 rounded p-3 text-xs text-danger font-mono">
              {syncError}
            </div>
          )}

          {goals.length === 0 ? (
            <div className="border border-border bg-surface p-12 text-center">
              <Target size={32} className="text-border mx-auto mb-3" />
              <p className="text-sm text-muted mb-4">No goals yet. Add your first goal to start tracking progress.</p>
              <button
                onClick={goalModal.onOpen}
                className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
              >
                <Plus size={14} />
                Add Goal
              </button>
            </div>
          ) : (
            <div className="space-y-px border border-border bg-border">
              {goals.map((goal) => (
                <div key={goal.id} className="relative group">
                  <GoalCard
                    goal={goal}
                    onUpdateProgress={(id, progress) => updateGoal(id, { progress })}
                    onUpdateStatus={(id, status) => updateGoal(id, { status })}
                    assigneeName={getAssignee(goal.assigned_to)?.display_name ?? undefined}
                    assigneeAvatar={getAssignee(goal.assigned_to)?.avatar_url ?? undefined}
                  />
                  <button
                    onClick={() => deleteGoal(goal.id)}
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger transition-all"
                    title="Delete goal"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Goal Modal */}
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
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Category (optional)</label>
                <input
                  type="text"
                  value={newGoalCategory}
                  onChange={(e) => setNewGoalCategory(e.target.value)}
                  placeholder="e.g. Frontend, Backend, Design…"
                  className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
                />
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
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md"
                >
                  Create Goal
                </button>
                <button
                  type="button"
                  onClick={goalModal.onClose}
                  className="px-6 py-2.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md"
                >
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
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-sans text-sm font-bold text-heading">Documents</h3>
              <p className="text-[11px] text-muted font-mono mt-0.5">Imported files available to AI analysis</p>
            </div>
            <div className="flex items-center gap-2">
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
                    const files = Array.from(e.target.files ?? []);
                    if (!files.length || !projectId) return;
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
                    e.target.value = '';
                    window.location.reload();
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setOfficePickerOpen(true)}
                className="flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
              >
                <Plus size={12} /> Import from Office 365
              </button>
            </div>
          </div>

          {/* Imported Office events */}
          {eventsLoading ? (
            <div className="text-xs text-muted py-4">Loading…</div>
          ) : (
            <div className="space-y-px border border-border bg-border">
              {events
                .filter((e) => e.source === 'onenote' || e.source === 'onedrive' || e.source === 'local')
                .map((e) => (
                  <div key={e.id} className="flex items-start gap-3 bg-surface px-4 py-3 group">
                    <div className="mt-0.5 shrink-0">
                      {e.source === 'onenote'
                        ? <span className="text-[10px] font-mono text-accent3 border border-accent3/30 px-1 py-0.5 rounded">NOTE</span>
                        : e.source === 'local'
                        ? <span className="text-[10px] font-mono text-accent border border-accent/30 px-1 py-0.5 rounded">LOCAL</span>
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
                        onClick={async () => {
                          setDeletingEventId(e.id);
                          await deleteImportedEvent(e.id);
                          setDeletingEventId(null);
                          // events list will re-fetch via useEvents subscription
                          window.location.reload();
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger transition-all disabled:opacity-40"
                      >
                        {deletingEventId === e.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  </div>
                ))}
              {events.filter((e) => e.source === 'onenote' || e.source === 'onedrive' || e.source === 'local').length === 0 && (
                <div className="bg-surface px-4 py-8 text-center">
                  <p className="text-xs text-muted mb-3">No documents yet. Upload a local file or import from Microsoft 365.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div className="space-y-6">
          {/* Current Members */}
          <div className="border border-border bg-surface p-6">
            <div className="flex items-center gap-2 mb-6">
              <Users size={14} className="text-accent2" />
              <h3 className="font-sans text-sm font-bold text-heading">
                Team Members ({members.length + 1})
              </h3>
            </div>
            <div className="space-y-px border border-border bg-border">
              {/* Owner (current user) */}
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
              {/* Other members */}
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

          {/* Invite Members */}
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
                      <a
                        href={u.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-heading font-medium hover:text-accent transition-colors"
                      >
                        {u.login}
                      </a>
                    </div>
                    <button
                      onClick={() => handleInviteMember(u)}
                      disabled={inviting === u.login}
                      className="text-[10px] px-3 py-1 border border-accent/30 text-accent hover:bg-accent/10 transition-colors rounded disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {inviting === u.login ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <UserPlus size={10} />
                      )}
                      {inviting === u.login ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-8">
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
