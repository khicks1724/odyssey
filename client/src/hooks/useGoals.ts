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

  const createGoal = async (goal: { title: string; deadline?: string; category?: string; assigned_to?: string }) => {
    if (!projectId) throw new Error('No project');
    const { data, error } = await supabase
      .from('goals')
      .insert({
        project_id: projectId,
        title: goal.title,
        deadline: goal.deadline || null,
        category: goal.category || 'General',
        assigned_to: goal.assigned_to || null,
      })
      .select()
      .single();

    if (error) throw error;
    setGoals((prev) => [data, ...prev]);
    return data;
  };

  const updateGoal = async (id: string, updates: Partial<Pick<Goal, 'title' | 'deadline' | 'status' | 'progress' | 'assigned_to' | 'category' | 'completed_at'>>) => {
    const enriched: typeof updates = { ...updates };
    if (updates.status === 'complete' && !updates.completed_at) {
      enriched.completed_at = new Date().toISOString();
    } else if (updates.status && updates.status !== 'complete') {
      enriched.completed_at = null;
    }
    const { data, error } = await supabase
      .from('goals')
      .update(enriched)
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
