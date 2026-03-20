import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { TimeLog } from '../types';

export function useProjectTimeLogs(projectId: string | undefined) {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase
      .from('time_logs')
      .select('*')
      .eq('project_id', projectId)
      .order('logged_at', { ascending: false });
    setLogs((data as TimeLog[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { logs, loading, refetch: fetchLogs };
}
