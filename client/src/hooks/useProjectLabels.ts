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
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('project_labels')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at');
    if (fetchError) {
      setError(fetchError.message);
      setLabels([]);
      setLoading(false);
      return;
    }
    setLabels((data as ProjectLabel[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetch(); }, [fetch]);

  const addLabel = async (type: 'category' | 'loe', name: string, color: string) => {
    if (!projectId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    const { data, error } = await supabase
      .from('project_labels')
      .insert({ project_id: projectId, type, name: trimmed, color })
      .select()
      .single();
    if (error) {
      setError(error.message);
      throw new Error(error.message);
    }
    if (data) {
      setLabels((prev) => [...prev, data as ProjectLabel]);
      await fetch();
    }
  };

  const updateLabel = async (id: string, updates: Partial<Pick<ProjectLabel, 'name' | 'color'>>) => {
    setError(null);
    const { error } = await supabase.from('project_labels').update(updates).eq('id', id);
    if (error) {
      setError(error.message);
      throw new Error(error.message);
    }
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
    await fetch();
  };

  const deleteLabel = async (id: string) => {
    setError(null);
    const { data, error } = await supabase
      .from('project_labels')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      setError(error.message);
      throw new Error(error.message);
    }
    if (!data || data.length === 0) {
      const message = 'Label could not be deleted.';
      setError(message);
      throw new Error(message);
    }
    setLabels((prev) => prev.filter((l) => l.id !== id));
    await fetch();
  };

  const categories = labels.filter((l) => l.type === 'category');
  const loes = labels.filter((l) => l.type === 'loe');

  return { labels, categories, loes, loading, error, addLabel, updateLabel, deleteLabel, refetch: fetch };
}
