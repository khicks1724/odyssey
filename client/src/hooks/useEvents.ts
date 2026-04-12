import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { isGeneratedThesisLatexCommitEvent } from '../lib/activity-filters';
import type { OdysseyEvent } from '../types';

export function useEvents(projectId: string | undefined) {
  const [events, setEvents] = useState<OdysseyEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .limit(50);

    if (!error && data) setEvents(data.filter((event) => !isGeneratedThesisLatexCommitEvent(event as OdysseyEvent)));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Subscribe to realtime events
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`events:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const nextEvent = payload.new as OdysseyEvent;
          if (isGeneratedThesisLatexCommitEvent(nextEvent)) return;
          setEvents((prev) => [nextEvent, ...prev]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  return { events, loading, refetch: fetchEvents };
}

export function useRecentEvents(limit = 20) {
  const [events, setEvents] = useState<OdysseyEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!error && data) setEvents(data.filter((event) => !isGeneratedThesisLatexCommitEvent(event as OdysseyEvent)));
        setLoading(false);
      });
  }, [limit]);

  return { events, loading };
}
