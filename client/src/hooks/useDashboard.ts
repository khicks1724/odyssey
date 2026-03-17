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
