import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ProjectLabel {
  id: string;
  project_id: string;
  type: 'category' | 'loe';
  name: string;
  color: string;
  created_at: string;
}

export function useProjectLabels(projectId: string | undefined) {
  const [labels, setLabels] = useState<ProjectLabel[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase
      .from('project_labels')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at');
    setLabels((data as ProjectLabel[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetch(); }, [fetch]);

  const addLabel = async (type: 'category' | 'loe', name: string, color: string) => {
    if (!projectId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from('project_labels')
      .insert({ project_id: projectId, type, name: trimmed, color })
      .select()
      .single();
    if (!error && data) setLabels((prev) => [...prev, data as ProjectLabel]);
  };

  const updateLabel = async (id: string, updates: Partial<Pick<ProjectLabel, 'name' | 'color'>>) => {
    const { error } = await supabase.from('project_labels').update(updates).eq('id', id);
    if (!error) setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const deleteLabel = async (id: string) => {
    const { error } = await supabase.from('project_labels').delete().eq('id', id);
    if (!error) setLabels((prev) => prev.filter((l) => l.id !== id));
  };

  const categories = labels.filter((l) => l.type === 'category');
  const loes = labels.filter((l) => l.type === 'loe');

  return { labels, categories, loes, loading, addLabel, updateLabel, deleteLabel, refetch: fetch };
}
