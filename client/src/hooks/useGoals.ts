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

  const createGoal = async (goal: { title: string; description?: string | null; deadline?: string; category?: string; loe?: string; assigned_to?: string; assignees?: string[]; createdByAI?: boolean }) => {
    if (!projectId) throw new Error('No project');
    const { data: { user } } = await supabase.auth.getUser();
    const assignees = goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : []);
    const { data, error } = await supabase
      .from('goals')
      .insert({
        project_id: projectId,
        title: goal.title,
        description: goal.description?.trim() || null,
        deadline: goal.deadline || null,
        status: 'not_started',
        category: goal.category || null,
        loe: goal.loe || null,
        assigned_to: assignees[0] ?? null,
        assignees,
        created_by: goal.createdByAI ? null : (user?.id ?? null),
      })
      .select()
      .single();

    if (error) throw error;
    setGoals((prev) => [data, ...prev]);

    // Emit goal_created event
    void supabase.from('events').insert({
      project_id: projectId,
      actor_id: goal.createdByAI ? null : (user?.id ?? null),
      source: goal.createdByAI ? 'ai' : 'manual',
      event_type: 'goal_created',
      title: `Task created: "${goal.title}"`,
      metadata: {
        goal_id: data.id,
        created_by_ai: goal.createdByAI ?? false,
      },
      occurred_at: new Date().toISOString(),
    });

    return data;
  };

  const updateGoal = async (id: string, updates: Partial<Pick<Goal, 'title' | 'description' | 'deadline' | 'status' | 'progress' | 'assigned_to' | 'assignees' | 'category' | 'loe' | 'completed_at' | 'ai_guidance'>>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const enriched: typeof updates & { updated_by?: string | null } = { ...updates, updated_by: user?.id ?? null };
    if (updates.description !== undefined) {
      enriched.description = updates.description?.trim() || null;
    }
    // Keep assigned_to in sync with first assignee
    if (updates.assignees !== undefined) {
      enriched.assigned_to = updates.assignees[0] ?? null;
    }
    if (updates.status === 'complete' && !updates.completed_at) {
      enriched.completed_at = new Date().toISOString();
    } else if (updates.status && updates.status !== 'complete') {
      enriched.completed_at = null;
    }

    // Capture old status for event emission
    const oldGoal = goals.find((g) => g.id === id);

    const { data, error } = await supabase
      .from('goals')
      .update(enriched)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    setGoals((prev) => prev.map((g) => (g.id === id ? data : g)));

    // Emit goal_status_changed event if status changed
    if (updates.status && oldGoal && updates.status !== oldGoal.status && projectId) {
      const STATUS_LABELS: Record<string, string> = {
        not_started: 'Not Started',
        in_progress: 'In Progress',
        in_review: 'In Review',
        complete: 'Complete',
      };
      void supabase.from('events').insert({
        project_id: projectId,
        actor_id: user?.id ?? null,
        source: 'manual',
        event_type: 'goal_status_changed',
        title: `Task "${data.title}" moved to ${STATUS_LABELS[updates.status] ?? updates.status}`,
        metadata: {
          goal_id: id,
          old_status: oldGoal.status,
          new_status: updates.status,
        },
        occurred_at: new Date().toISOString(),
      });
    }

    return data;
  };

  const deleteGoal = async (id: string) => {
    const { error } = await supabase.from('goals').delete().eq('id', id);
    if (error) throw error;
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  return { goals, loading, createGoal, updateGoal, deleteGoal, refetch: fetchGoals };
}
