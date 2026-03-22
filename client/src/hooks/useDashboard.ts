import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface DashboardStats {
  activeProjects: number;
  goalsTracked: number;
  eventsThisWeek: number;
  onTrackRate: number | null;
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

    async function load() {
      setLoading(true);

      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', user.id);

      const projectIds = (memberships ?? []).map((m: any) => m.project_id);
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
      const eventRows = (eventsRes.data ?? []) as any[];

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
          .select('id', { count: 'exact', head: true })
          .gte('occurred_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      const goalData = goalsRes.data ?? [];
      const totalGoals = goalData.length;
      const onTrack = goalData.filter((g) => g.status === 'active' || g.status === 'complete').length;

      setStats({
        activeProjects: projectsRes.count ?? 0,
        goalsTracked: totalGoals,
        eventsThisWeek: eventsRes.count ?? 0,
        onTrackRate: totalGoals > 0 ? Math.round((onTrack / totalGoals) * 100) : null,
      });
      setLoading(false);
    }

    load();
  }, [user]);

  return { stats, loading };
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
      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', user!.id);

      const projectIds = (memberships ?? []).map((m: any) => m.project_id);
      if (projectIds.length === 0) { setLoading(false); return; }

      const all: RecentCommit[] = [];
      await Promise.all(
        projectIds.map(async (pid: string) => {
          try {
            const r = await fetch(`/api/projects/${pid}/commit-history`);
            if (!r.ok) return;
            const json: { recentCommits?: RecentCommit[] } = await r.json();
            all.push(...(json.recentCommits ?? []));
          } catch { /* ignore */ }
        })
      );

      all.sort((a, b) => b.date.localeCompare(a.date));
      setCommits(all.slice(0, 20));
      setLoading(false);
    }

    load();
  }, [user]);

  return { commits, loading };
}

export function useActivityByDate() {
  const { user } = useAuth();
  const [data, setData] = useState<{ date: string; count: number }[]>([]);

  useEffect(() => {
    if (!user) return;

    async function load() {
      // RLS requires project_id — scope through memberships
      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', user!.id);

      const projectIds = (memberships ?? []).map((m: any) => m.project_id);
      if (projectIds.length === 0) return;

      // 52 weeks = 364 days — match the heatmap display range
      const since = new Date();
      since.setDate(since.getDate() - 364);
      const sinceIso = since.toISOString();

      const counts = new Map<string, number>();

      // Pull events (manual activity)
      const { data: events } = await supabase
        .from('events')
        .select('occurred_at')
        .in('project_id', projectIds)
        .gte('occurred_at', sinceIso);

      (events ?? []).forEach((e: any) => {
        const date = (e.occurred_at as string).slice(0, 10);
        counts.set(date, (counts.get(date) ?? 0) + 1);
      });

      // Pull goal creation/updates as activity proxy
      const { data: goals } = await supabase
        .from('goals')
        .select('created_at')
        .in('project_id', projectIds)
        .gte('created_at', sinceIso);

      (goals ?? []).forEach((g: any) => {
        const date = (g.created_at as string).slice(0, 10);
        counts.set(date, (counts.get(date) ?? 0) + 1);
      });

      // Pull commit history from all integrated GitHub/GitLab repos per project
      await Promise.all(
        projectIds.map(async (pid: string) => {
          try {
            const r = await fetch(`/api/projects/${pid}/commit-history`);
            if (!r.ok) return;
            const json: { commits: { date: string; count: number }[] } = await r.json();
            for (const { date, count } of json.commits ?? []) {
              // include all commits within the 52-week window
              if (date >= since.toISOString().slice(0, 10)) {
                counts.set(date, (counts.get(date) ?? 0) + count);
              }
            }
          } catch { /* ignore per-project failures */ }
        })
      );

      setData(Array.from(counts.entries()).map(([date, count]) => ({ date, count })));
    }

    load();
  }, [user]);

  return { data };
}
