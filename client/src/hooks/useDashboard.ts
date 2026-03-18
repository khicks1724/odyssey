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

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 21); // next 3 weeks

    supabase
      .from('goals')
      .select('id, title, deadline, status, progress, project_id, projects(name)')
      .not('deadline', 'is', null)
      .not('status', 'in', '("complete","missed")')
      .lte('deadline', cutoff.toISOString().slice(0, 10))
      .order('deadline', { ascending: true })
      .limit(6)
      .then(({ data, error }) => {
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
      });
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

export function useActivityByDate() {
  const { user } = useAuth();
  const [data, setData] = useState<{ date: string; count: number }[]>([]);

  useEffect(() => {
    if (!user) return;

    const since = new Date();
    since.setDate(since.getDate() - 84); // 12 weeks

    supabase
      .from('events')
      .select('occurred_at')
      .gte('occurred_at', since.toISOString())
      .then(({ data: events, error }) => {
        if (error || !events) return;
        const counts = new Map<string, number>();
        events.forEach((e) => {
          const date = (e.occurred_at as string).slice(0, 10);
          counts.set(date, (counts.get(date) ?? 0) + 1);
        });
        setData(Array.from(counts.entries()).map(([date, count]) => ({ date, count })));
      });
  }, [user]);

  return { data };
}
