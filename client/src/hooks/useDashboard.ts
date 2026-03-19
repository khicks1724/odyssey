import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface DashboardStats {
  activeProjects: number;
  goalsTracked: number;
  eventsThisWeek: number;
  onTrackRate: number | null;
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
