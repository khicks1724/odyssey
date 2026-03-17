import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Goal } from '../types';

export function useGoals(projectId: string | undefined) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (!error && data) setGoals(data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const createGoal = async (goal: { title: string; deadline?: string }) => {
    if (!projectId) throw new Error('No project');
    const { data, error } = await supabase
      .from('goals')
      .insert({ project_id: projectId, title: goal.title, deadline: goal.deadline || null })
      .select()
      .single();

    if (error) throw error;
    setGoals((prev) => [data, ...prev]);
    return data;
  };

  const updateGoal = async (id: string, updates: Partial<Pick<Goal, 'title' | 'deadline' | 'status' | 'progress'>>) => {
    const { data, error } = await supabase
      .from('goals')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    setGoals((prev) => prev.map((g) => (g.id === id ? data : g)));
    return data;
  };

  const deleteGoal = async (id: string) => {
    const { error } = await supabase.from('goals').delete().eq('id', id);
    if (error) throw error;
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  return { goals, loading, createGoal, updateGoal, deleteGoal, refetch: fetchGoals };
}
