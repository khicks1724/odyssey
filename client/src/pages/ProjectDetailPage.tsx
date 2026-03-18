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
} from 'lucide-react';
import { useProject } from '../hooks/useProjects';
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
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const goalModal = useModal();
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');

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

  // Members state
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<GitHubUser[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

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
      }
    } catch (err) {
      console.error('Insights failed:', err);
      setInsightsError('Network error — is the server running?');
    }
    setInsightsLoading(false);
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
    await createGoal({ title: newGoalTitle, deadline: newGoalDeadline || undefined });
    setNewGoalTitle('');
    setNewGoalDeadline('');
    goalModal.onClose();
  };

  return (
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
          <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
            {project.name}
          </h1>
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
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-sans text-sm font-bold text-heading">
              Goals ({goals.length})
            </h3>
            <button
              onClick={goalModal.onOpen}
              className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
            >
              <Plus size={14} />
              Add Goal
            </button>
          </div>

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
                  className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
                />
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

      {activeTab === 'members' && (
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-6">
            <Users size={14} className="text-accent2" />
            <h3 className="font-sans text-sm font-bold text-heading">Team Members</h3>
          </div>
          <div className="py-4">
            <div className="flex items-center gap-3 p-3 border border-border rounded">
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                <span className="text-xs text-accent font-bold">You</span>
              </div>
              <div>
                <div className="text-xs text-heading font-medium">Project Owner</div>
                <div className="text-[10px] text-muted">Member since project creation</div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted mt-4">
            Member invitation will be available in a future update.
          </p>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-8">
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
                    onClick={() => updateProject({ github_repo: null })}
                    className="px-3 py-1.5 border border-danger/30 text-danger text-[10px] tracking-wider uppercase hover:bg-danger/5 transition-colors rounded"
                  >
                    Disconnect
                  </button>
                </div>

                <button
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
