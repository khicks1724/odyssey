import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { pushUndoAction } from '../lib/undo-manager';
import type { TimeLog } from '../types';

export function useTimeLogs(goalId: string | undefined) {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    const { data } = await supabase
      .from('time_logs')
      .select('*')
      .eq('goal_id', goalId)
      .order('logged_at', { ascending: false });
    setLogs((data as TimeLog[]) ?? []);
    setLoading(false);
  }, [goalId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalHours = logs.reduce((sum, l) => sum + l.logged_hours, 0);

  const logTime = async (hours: number, description: string, projectId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !goalId) return;
    const { data, error } = await supabase.from('time_logs').insert({
      goal_id: goalId,
      project_id: projectId,
      user_id: session.user.id,
      logged_hours: hours,
      description: description || null,
      logged_at: new Date().toISOString(),
    }).select().single();
    if (!error && data) {
      setLogs(prev => [data as TimeLog, ...prev]);
    }
  };

  const deleteLog = async (id: string) => {
    const logIndex = logs.findIndex((log) => log.id === id);
    const deletedLog = logIndex >= 0 ? logs[logIndex] ?? null : null;
    const { error } = await supabase.from('time_logs').delete().eq('id', id);
    if (error) return;
    setLogs(prev => prev.filter(l => l.id !== id));
    if (!deletedLog) return;
    pushUndoAction({
      label: `Deleted time log (${deletedLog.logged_hours}h)`,
      undo: async () => {
        const { data, error: restoreError } = await supabase
          .from('time_logs')
          .insert(deletedLog)
          .select()
          .single();
        if (restoreError) throw restoreError;
        setLogs((prev) => {
          if (prev.some((log) => log.id === deletedLog.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(logIndex, next.length), 0, data as TimeLog);
          return next;
        });
      },
    });
  };

  return { logs, loading, totalHours, logTime, deleteLog, refetch: fetchLogs };
}
