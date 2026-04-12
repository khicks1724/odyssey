import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isGeneratedThesisLatexCommitEvent, isGeneratedThesisLatexCommitMessage } from '../lib/activity-filters';
import { useAuth } from '../lib/auth';

async function fetchAccessibleProjectIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id');

  if (error || !data) return [];
  return [...new Set(data.map((project) => project.id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

async function fetchCommitHistoryForProject(projectId: string, accessToken?: string | null) {
  const res = await fetch(`/api/projects/${projectId}/commit-history`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error(`commit-history ${res.status}`);
  return res.json() as Promise<{
    commits?: { date: string; count: number }[];
    recentCommits?: RecentCommit[];
  }>;
}

interface DashboardStats {
  activeProjects: number;
  goalsTracked: number;
  eventsThisWeek: number;
  onTrackRate: number | null;
}

export interface DashboardPlanningPerson {
  userId: string;
  displayName: string;
  activeTasks: number;
  remainingHours: number;
  loggedHours: number;
  blockedOrLate: number;
  status: 'overcommitted' | 'balanced' | 'underloaded';
}

export interface DashboardPlanningProject {
  projectId: string;
  projectName: string;
  overdueOpen: number;
  dueSoon: number;
  blocked: number;
  varianceHours: number;
}

export interface DashboardPlanningSnapshot {
  plannedHours: number;
  actualHours: number;
  remainingHours: number;
  varianceHours: number;
  overdueOpen: number;
  dueSoon: number;
  blockedTasks: number;
  overcommittedPeople: number;
  underloadedPeople: number;
  activeEstimates: number;
  people: DashboardPlanningPerson[];
  riskyProjects: DashboardPlanningProject[];
}

export interface DashboardHoverTask {
  id: string;
  projectId: string;
  title: string;
  status: string;
  progress: number;
  category: string | null;
  loe: string | null;
  projectName: string;
  assignees: string[];
}

export interface DashboardHoverEvent {
  id: string;
  projectId: string;
  title: string;
  summary: string | null;
  source: string;
  eventType: string;
  occurredAt: string;
  projectName: string;
}

export interface DashboardOnTrackBreakdown {
  total: number;
  onTrack: number;
  needsAttention: number;
  complete: number;
  active: number;
  inProgress: number;
  notStarted: number;
  avgProgress: number;
  topCategories: { name: string; count: number }[];
}

export function useDashboardHoverDetails() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<DashboardHoverTask[]>([]);
  const [events, setEvents] = useState<DashboardHoverEvent[]>([]);
  const [assigneeNames, setAssigneeNames] = useState<Record<string, string>>({});
  const [breakdown, setBreakdown] = useState<DashboardOnTrackBreakdown>({
    total: 0,
    onTrack: 0,
    needsAttention: 0,
    complete: 0,
    active: 0,
    inProgress: 0,
    notStarted: 0,
    avgProgress: 0,
    topCategories: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const currentUserId = user.id;

    async function load() {
      setLoading(true);
      const projectIds = await fetchAccessibleProjectIds();
      if (projectIds.length === 0) {
        setTasks([]);
        setEvents([]);
        setAssigneeNames({});
        setBreakdown({
          total: 0,
          onTrack: 0,
          needsAttention: 0,
          complete: 0,
          active: 0,
          inProgress: 0,
          notStarted: 0,
          avgProgress: 0,
          topCategories: [],
        });
        setLoading(false);
        return;
      }

      const sinceWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [goalsRes, eventsRes] = await Promise.all([
        supabase
          .from('goals')
          .select('id, title, status, progress, category, loe, assignees, assigned_to, project_id, projects(name)')
          .in('project_id', projectIds)
          .order('updated_at', { ascending: false }),
        supabase
          .from('events')
          .select('id, title, summary, source, event_type, occurred_at, project_id, projects(name)')
          .in('project_id', projectIds)
          .gte('occurred_at', sinceWeek)
          .order('occurred_at', { ascending: false })
          .limit(8),
      ]);

      const goalRows = (goalsRes.data ?? []) as any[];
      const eventRows = ((eventsRes.data ?? []) as any[]).filter((event) => !isGeneratedThesisLatexCommitEvent(event));

      const assigneeIds = Array.from(
        new Set(
          goalRows.flatMap((g) => {
            const ids = Array.isArray(g.assignees) && g.assignees.length
              ? g.assignees
              : (g.assigned_to ? [g.assigned_to] : []);
            return ids.filter(Boolean);
          }),
        ),
      );

      let assigneeMap: Record<string, string> = {};
      if (assigneeIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', assigneeIds);

        assigneeMap = Object.fromEntries(
          (profiles ?? []).map((p: any) => [p.id, p.display_name || 'Unknown']),
        );
      }

      const complete = goalRows.filter((g) => g.status === 'complete').length;
      const active = goalRows.filter((g) => g.status === 'active').length;
      const inProgress = goalRows.filter((g) => g.status === 'in_progress' || g.status === 'in_review').length;
      const notStarted = goalRows.filter((g) => g.status === 'not_started').length;
      const onTrack = goalRows.filter((g) => g.status === 'active' || g.status === 'complete').length;
      const total = goalRows.length;

      const categoryCounts = new Map<string, number>();
      for (const goal of goalRows) {
        const cat = goal.category || 'General';
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }

      setAssigneeNames(assigneeMap);
      setTasks(
        goalRows.slice(0, 8).map((g) => ({
          id: g.id,
          projectId: g.project_id,
          title: g.title,
          status: g.status,
          progress: g.progress ?? 0,
          category: g.category,
          loe: g.loe,
          projectName: (g.projects as { name?: string } | null)?.name ?? 'Unknown project',
          assignees: (Array.isArray(g.assignees) && g.assignees.length ? g.assignees : (g.assigned_to ? [g.assigned_to] : []))
            .map((id: string) => assigneeMap[id] ?? id),
        })),
      );
      setEvents(
        eventRows.map((e) => ({
          id: e.id,
          projectId: e.project_id,
          title: e.title || e.event_type || 'Untitled event',
          summary: e.summary,
          source: e.source,
          eventType: e.event_type,
          occurredAt: e.occurred_at,
          projectName: (e.projects as { name?: string } | null)?.name ?? 'Unknown project',
        })),
      );
      setBreakdown({
        total,
        onTrack,
        needsAttention: Math.max(total - onTrack, 0),
        complete,
        active,
        inProgress,
        notStarted,
        avgProgress: total > 0 ? Math.round(goalRows.reduce((sum, g) => sum + (g.progress ?? 0), 0) / total) : 0,
        topCategories: Array.from(categoryCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name, count]) => ({ name, count })),
      });
      setLoading(false);
    }

    load();
  }, [user]);

  return { tasks, events, assigneeNames, breakdown, loading };
}

export function useDashboardStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    activeProjects: 0,
    goalsTracked: 0,
    eventsThisWeek: 0,
    onTrackRate: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function load() {
      const [projectsRes, goalsRes, eventsRes] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }),
        supabase.from('goals').select('id, status', { count: 'exact' }),
        supabase
          .from('events')
          .select('id, event_type, title, summary')
          .gte('occurred_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      const goalData = goalsRes.data ?? [];
      const totalGoals = goalData.length;
      const onTrack = goalData.filter((g) => g.status === 'active' || g.status === 'complete').length;

      const visibleEventsThisWeek = (eventsRes.data ?? []).filter((event: any) => !isGeneratedThesisLatexCommitEvent(event)).length;

      setStats({
        activeProjects: projectsRes.count ?? 0,
        goalsTracked: totalGoals,
        eventsThisWeek: visibleEventsThisWeek,
        onTrackRate: totalGoals > 0 ? Math.round((onTrack / totalGoals) * 100) : null,
      });
      setLoading(false);
    }

    load();
  }, [user]);

  return { stats, loading };
}

export function useDashboardPlanning() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<DashboardPlanningSnapshot>({
    plannedHours: 0,
    actualHours: 0,
    remainingHours: 0,
    varianceHours: 0,
    overdueOpen: 0,
    dueSoon: 0,
    blockedTasks: 0,
    overcommittedPeople: 0,
    underloadedPeople: 0,
    activeEstimates: 0,
    people: [],
    riskyProjects: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function load() {
      setLoading(true);
      const projectIds = await fetchAccessibleProjectIds();
      if (projectIds.length === 0) {
        setSnapshot({
          plannedHours: 0,
          actualHours: 0,
          remainingHours: 0,
          varianceHours: 0,
          overdueOpen: 0,
          dueSoon: 0,
          blockedTasks: 0,
          overcommittedPeople: 0,
          underloadedPeople: 0,
          activeEstimates: 0,
          people: [],
          riskyProjects: [],
        });
        setLoading(false);
        return;
      }

      const [goalsRes, timeLogsRes] = await Promise.all([
        supabase
          .from('goals')
          .select('id, title, project_id, status, progress, deadline, estimated_hours, assigned_to, assignees, projects(name)')
          .in('project_id', projectIds),
        supabase
          .from('time_logs')
          .select('goal_id, project_id, user_id, logged_hours, logged_at')
          .in('project_id', projectIds),
      ]);

      const goals = (goalsRes.data ?? []) as Array<{
        id: string;
        title: string;
        project_id: string;
        status: string;
        progress: number | null;
        deadline: string | null;
        estimated_hours: number | null;
        assigned_to: string | null;
        assignees: string[] | null;
        projects?: { name?: string } | null;
      }>;
      const timeLogs = (timeLogsRes.data ?? []) as Array<{
        goal_id: string | null;
        project_id: string;
        user_id: string | null;
        logged_hours: number;
        logged_at: string;
      }>;

      const actualHoursByGoal = new Map<string, number>();
      const loggedHoursByUser = new Map<string, number>();
      for (const log of timeLogs) {
        if (log.goal_id) {
          actualHoursByGoal.set(log.goal_id, (actualHoursByGoal.get(log.goal_id) ?? 0) + (log.logged_hours ?? 0));
        }
        if (log.user_id) {
          loggedHoursByUser.set(log.user_id, (loggedHoursByUser.get(log.user_id) ?? 0) + (log.logged_hours ?? 0));
        }
      }

      const today = new Date();
      const twoWeeksFromNow = new Date(today);
      twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

      const plannedGoals = goals.filter((goal) => (goal.estimated_hours ?? 0) > 0 || (actualHoursByGoal.get(goal.id) ?? 0) > 0);
      const plannedHours = plannedGoals.reduce((sum, goal) => sum + (goal.estimated_hours ?? 0), 0);
      const actualHours = plannedGoals.reduce((sum, goal) => sum + (actualHoursByGoal.get(goal.id) ?? 0), 0);
      const remainingHours = plannedGoals
        .filter((goal) => goal.status !== 'complete')
        .reduce((sum, goal) => sum + Math.max((goal.estimated_hours ?? 0) - (actualHoursByGoal.get(goal.id) ?? 0), 0), 0);
      const overdueOpen = goals.filter((goal) => goal.status !== 'complete' && goal.deadline && new Date(goal.deadline) < today).length;
      const dueSoon = goals.filter((goal) => goal.status !== 'complete' && goal.deadline && new Date(goal.deadline) >= today && new Date(goal.deadline) <= twoWeeksFromNow && (goal.progress ?? 0) < 80).length;
      const blockedTasks = goals.filter((goal) => goal.status === 'at_risk' || goal.status === 'missed').length;

      const personIds = Array.from(new Set(goals.flatMap((goal) => {
        if (Array.isArray(goal.assignees) && goal.assignees.length > 0) return goal.assignees.filter(Boolean);
        return goal.assigned_to ? [goal.assigned_to] : [];
      }).filter((value): value is string => Boolean(value))));

      let profileNameMap: Record<string, string> = {};
      if (personIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', personIds);
        profileNameMap = Object.fromEntries((profiles ?? []).map((profile: { id: string; display_name: string | null }) => [profile.id, profile.display_name ?? profile.id]));
      }

      const people = personIds.map((personId) => {
        const assignedGoals = goals.filter((goal) => {
          const assigneeIds = Array.isArray(goal.assignees) && goal.assignees.length > 0
            ? goal.assignees
            : goal.assigned_to ? [goal.assigned_to] : [];
          return assigneeIds.includes(personId);
        });
        const remainingLoad = assignedGoals
          .filter((goal) => goal.status !== 'complete')
          .reduce((sum, goal) => sum + Math.max((goal.estimated_hours ?? 0) - (actualHoursByGoal.get(goal.id) ?? 0), 0), 0);
        const loggedHours = loggedHoursByUser.get(personId) ?? 0;
        const blockedOrLate = assignedGoals.filter((goal) => goal.status === 'at_risk' || goal.status === 'missed' || (goal.deadline && new Date(goal.deadline) < today)).length;
        const status = remainingLoad > Math.max(loggedHours * 1.5, 12)
          ? 'overcommitted'
          : remainingLoad <= Math.max(loggedHours * 0.4, 4)
            ? 'underloaded'
            : 'balanced';
        return {
          userId: personId,
          displayName: profileNameMap[personId] ?? personId,
          activeTasks: assignedGoals.filter((goal) => goal.status !== 'complete').length,
          remainingHours: remainingLoad,
          loggedHours,
          blockedOrLate,
          status,
        } satisfies DashboardPlanningPerson;
      }).filter((person) => person.activeTasks > 0 || person.remainingHours > 0 || person.loggedHours > 0);

      const riskyProjects = Array.from(new Set(goals.map((goal) => goal.project_id))).map((projectId) => {
        const projectGoals = goals.filter((goal) => goal.project_id === projectId);
        const overdue = projectGoals.filter((goal) => goal.status !== 'complete' && goal.deadline && new Date(goal.deadline) < today).length;
        const upcoming = projectGoals.filter((goal) => goal.status !== 'complete' && goal.deadline && new Date(goal.deadline) >= today && new Date(goal.deadline) <= twoWeeksFromNow && (goal.progress ?? 0) < 80).length;
        const blocked = projectGoals.filter((goal) => goal.status === 'at_risk' || goal.status === 'missed').length;
        const planned = projectGoals.reduce((sum, goal) => sum + (goal.estimated_hours ?? 0), 0);
        const actual = projectGoals.reduce((sum, goal) => sum + (actualHoursByGoal.get(goal.id) ?? 0), 0);
        return {
          projectId,
          projectName: projectGoals[0]?.projects?.name ?? 'Unknown project',
          overdueOpen: overdue,
          dueSoon: upcoming,
          blocked,
          varianceHours: actual - planned,
        } satisfies DashboardPlanningProject;
      })
        .filter((project) => project.overdueOpen > 0 || project.dueSoon > 0 || project.blocked > 0 || project.varianceHours > 0)
        .sort((left, right) => (right.overdueOpen * 3 + right.blocked * 2 + right.dueSoon) - (left.overdueOpen * 3 + left.blocked * 2 + left.dueSoon))
        .slice(0, 5);

      setSnapshot({
        plannedHours,
        actualHours,
        remainingHours,
        varianceHours: actualHours - plannedHours,
        overdueOpen,
        dueSoon,
        blockedTasks,
        overcommittedPeople: people.filter((person) => person.status === 'overcommitted').length,
        underloadedPeople: people.filter((person) => person.status === 'underloaded').length,
        activeEstimates: plannedGoals.length,
        people: people.sort((left, right) => right.remainingHours - left.remainingHours || right.blockedOrLate - left.blockedOrLate),
        riskyProjects,
      });
      setLoading(false);
    }

    void load();
  }, [user]);

  return { snapshot, loading };
}

export interface UpcomingDeadline {
  id: string;
  title: string;
  deadline: string;
  status: string;
  progress: number;
  project_id: string;
  projectName: string;
}

export function useUpcomingDeadlines() {
  const { user } = useAuth();
  const [deadlines, setDeadlines] = useState<UpcomingDeadline[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function load() {
      // RLS on goals requires project_id context — scope through memberships first
      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', user!.id);

      const projectIds = (memberships ?? []).map((m: any) => m.project_id);
      if (projectIds.length === 0) { setLoading(false); return; }

      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('goals')
        .select('id, title, deadline, status, progress, project_id, projects(name)')
        .in('project_id', projectIds)
        .not('deadline', 'is', null)
        .neq('status', 'complete')
        .gte('deadline', today)
        .order('deadline', { ascending: true })
        .limit(3);

      if (!error && data) {
        setDeadlines(
          data.map((g: any) => ({
            id: g.id,
            title: g.title,
            deadline: g.deadline,
            status: g.status,
            progress: g.progress,
            project_id: g.project_id,
            projectName: g.projects?.name ?? 'Unknown project',
          })),
        );
      }
      setLoading(false);
    }

    load();
  }, [user]);

  return { deadlines, loading };
}

export interface LatestInsight {
  status: string;
  next_steps: string[];
  future_features: string[];
  provider: string;
  generated_at: string;
  project_name: string;
  project_id: string;
}

export function useLatestInsight() {
  const { user } = useAuth();
  const [insight, setInsight] = useState<LatestInsight | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('project_insights')
      .select('status, next_steps, future_features, provider, generated_at, project_id, projects(name)')
      .order('generated_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setInsight({
            status: data.status,
            next_steps: (data.next_steps ?? []) as string[],
            future_features: (data.future_features ?? []) as string[],
            provider: data.provider,
            generated_at: data.generated_at,
            project_name: (data.projects as unknown as { name: string } | null)?.name ?? 'Unknown',
            project_id: data.project_id,
          });
        }
        setLoading(false);
      });
  }, [user]);

  return { insight, loading };
}

export interface RecentCommit {
  sha: string;
  date: string;
  author: string;
  message: string;
  repo: string;
  source: 'github' | 'gitlab';
}

export function useRecentCommits() {
  const { user } = useAuth();
  const [commits, setCommits] = useState<RecentCommit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const projectIds = await fetchAccessibleProjectIds();
      if (projectIds.length === 0) { setLoading(false); return; }

      const all: RecentCommit[] = [];
      await Promise.all(
        projectIds.map(async (pid: string) => {
          try {
            const json = await fetchCommitHistoryForProject(pid, token);
            all.push(...(json.recentCommits ?? []));
          } catch { /* ignore */ }
        })
      );

      all.sort((a, b) => b.date.localeCompare(a.date));
      setCommits(all.filter((commit) => !isGeneratedThesisLatexCommitMessage(commit.message)).slice(0, 20));
      setLoading(false);
    }

    load();
  }, [user]);

  return { commits, loading };
}

export interface AssignedTask {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  progress: number;
  deadline: string | null;
  category: string | null;
  loe: string | null;
}

export function useMyAssignedTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      setLoading(true);
      const projectIds = await fetchAccessibleProjectIds();
      if (projectIds.length === 0) { setTasks([]); setLoading(false); return; }

      const { data } = await supabase
        .from('goals')
        .select('id, title, status, progress, deadline, category, loe, project_id, assignees, assigned_to, projects(name)')
        .in('project_id', projectIds)
        .neq('status', 'complete')
        .or(`assigned_to.eq.${user!.id},assignees.cs.{${user!.id}}`)
        .order('deadline', { ascending: true, nullsFirst: false });

      setTasks(
        (data ?? []).map((g: any) => ({
          id: g.id,
          projectId: g.project_id,
          projectName: g.projects?.name ?? 'Unknown',
          title: g.title,
          status: g.status,
          progress: g.progress ?? 0,
          deadline: g.deadline ?? null,
          category: g.category ?? null,
          loe: g.loe ?? null,
        })),
      );
      setLoading(false);
    }
    load();
  }, [user]);

  return { tasks, loading };
}

export interface DashboardAISummary {
  summary: string;
  generatedAt: string;
  provider?: string | null;
  model?: string | null;
}

export function useDashboardAISummary() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardAISummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/ai/dashboard-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null) as { summary?: string; provider?: string; model?: string; error?: string } | null;
      if (!res.ok || !json?.summary) throw new Error(json?.error ?? `Failed to generate summary (${res.status})`);
      const result = {
        summary: json.summary,
        generatedAt: new Date().toISOString(),
        provider: json.provider ?? null,
        model: json.model ?? null,
      };
      setSummary(result);
      const { error: saveError } = await supabase
        .from('user_dashboard_summaries')
        .upsert({
          user_id: user.id,
          summary: result.summary,
          provider: result.provider,
          model: result.model,
          generated_at: result.generatedAt,
          updated_at: new Date().toISOString(),
        });
      if (saveError) {
        console.error('Failed to persist dashboard summary:', saveError);
      }
      localStorage.setItem(`dashboard-summary:${user.id}`, JSON.stringify(result));
    } catch (err: any) {
      setError(err?.message ?? 'Failed to generate summary');
    }
    setLoading(false);
  };

  // Load cached summary on mount
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let cancelled = false;

    async function loadStoredSummary() {
      const { data, error } = await supabase
        .from('user_dashboard_summaries')
        .select('summary, provider, model, generated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (!cancelled && data?.summary) {
        const stored = {
          summary: data.summary,
          provider: data.provider ?? null,
          model: data.model ?? null,
          generatedAt: data.generated_at,
        } satisfies DashboardAISummary;
        setSummary(stored);
        localStorage.setItem(`dashboard-summary:${userId}`, JSON.stringify(stored));
        return;
      }

      if (!cancelled) {
        const cached = localStorage.getItem(`dashboard-summary:${userId}`);
        if (cached) {
          try { setSummary(JSON.parse(cached) as DashboardAISummary); } catch { /* ignore */ }
        }
      }

      if (error) {
        console.error('Failed to load persisted dashboard summary:', error);
      }
    }

    void loadStoredSummary();
    return () => { cancelled = true; };
  }, [user]);

  return { summary, loading, error, generate };
}

export function useActivityByDate() {
  const { user } = useAuth();
  const [data, setData] = useState<{ date: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function load() {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const projectIds = await fetchAccessibleProjectIds();
      if (projectIds.length === 0) {
        setData([]);
        setLoading(false);
        return;
      }

      // 52 weeks = 364 days — match the heatmap display range
      const since = new Date();
      since.setDate(since.getDate() - 364);
      const sinceIso = since.toISOString();
      const sinceDay = since.toISOString().slice(0, 10);

      const counts = new Map<string, number>();

      const [eventsRes, goalsRes, commitResults] = await Promise.all([
        supabase
          .from('events')
          .select('occurred_at')
          .in('project_id', projectIds)
          .gte('occurred_at', sinceIso),
        supabase
          .from('goals')
          .select('created_at')
          .in('project_id', projectIds)
          .gte('created_at', sinceIso),
        Promise.all(
          projectIds.map(async (pid: string) => {
            try {
              const json = await fetchCommitHistoryForProject(pid, token);
              return json.commits ?? [];
            } catch {
              return [] as { date: string; count: number }[];
            }
          }),
        ),
      ]);

      (eventsRes.data ?? []).forEach((e: any) => {
        const date = (e.occurred_at as string).slice(0, 10);
        counts.set(date, (counts.get(date) ?? 0) + 1);
      });

      (goalsRes.data ?? []).forEach((g: any) => {
        const date = (g.created_at as string).slice(0, 10);
        counts.set(date, (counts.get(date) ?? 0) + 1);
      });

      commitResults.flat().forEach(({ date, count }) => {
        if (date >= sinceDay) {
          counts.set(date, (counts.get(date) ?? 0) + count);
        }
      });

      setData(Array.from(counts.entries()).map(([date, count]) => ({ date, count })));
      setLoading(false);
    }

    load();
  }, [user]);

  return { data, loading };
}
