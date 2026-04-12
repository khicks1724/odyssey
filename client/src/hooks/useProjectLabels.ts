import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { pushUndoAction } from '../lib/undo-manager';

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

  const addLabel = async (type: 'category' | 'loe', name: string, color: string): Promise<ProjectLabel | null> => {
    if (!projectId) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
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
      const created = data as ProjectLabel;
      setLabels((prev) => [...prev, created]);
      await fetch();
      return created;
    }
    return null;
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
    const labelIndex = labels.findIndex((label) => label.id === id);
    const deletedLabel = labelIndex >= 0 ? labels[labelIndex] ?? null : null;
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
    if (deletedLabel) {
      pushUndoAction({
        label: `Deleted ${deletedLabel.type === 'category' ? 'category' : 'LOE'} label ${deletedLabel.name}`,
        undo: async () => {
          const { data: restored, error: restoreError } = await supabase
            .from('project_labels')
            .insert(deletedLabel)
            .select()
            .single();
          if (restoreError) throw new Error(restoreError.message);
          setLabels((prev) => {
            if (prev.some((label) => label.id === deletedLabel.id)) return prev;
            const next = [...prev];
            next.splice(Math.min(labelIndex, next.length), 0, restored as ProjectLabel);
            return next;
          });
          await fetch();
        },
      });
    }
    await fetch();
  };

  const categories = labels.filter((l) => l.type === 'category');
  const loes = labels.filter((l) => l.type === 'loe');

  return { labels, categories, loes, loading, error, addLabel, updateLabel, deleteLabel, refetch: fetch };
}
