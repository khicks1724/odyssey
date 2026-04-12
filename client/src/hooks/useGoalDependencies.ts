import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { pushUndoAction } from '../lib/undo-manager';
import type { GoalDependency } from '../types';

export function useGoalDependencies(goalId: string | undefined, projectId: string | undefined) {
  const [dependencies, setDependencies] = useState<GoalDependency[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDeps = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    const { data } = await supabase
      .from('goal_dependencies')
      .select('*')
      .eq('goal_id', goalId);
    setDependencies((data as GoalDependency[]) ?? []);
    setLoading(false);
  }, [goalId]);

  useEffect(() => {
    fetchDeps();
  }, [fetchDeps]);

  const addDependency = async (dependsOnGoalId: string) => {
    if (!goalId || !projectId) return;
    const { data, error } = await supabase
      .from('goal_dependencies')
      .insert({ goal_id: goalId, depends_on_goal_id: dependsOnGoalId, project_id: projectId })
      .select()
      .single();
    if (!error && data) {
      setDependencies(prev => [...prev, data as GoalDependency]);
    }
  };

  const removeDependency = async (dependsOnGoalId: string) => {
    const dependencyIndex = dependencies.findIndex((dependency) => dependency.depends_on_goal_id === dependsOnGoalId);
    const deletedDependency = dependencyIndex >= 0 ? dependencies[dependencyIndex] ?? null : null;
    const { error } = await supabase
      .from('goal_dependencies')
      .delete()
      .eq('goal_id', goalId!)
      .eq('depends_on_goal_id', dependsOnGoalId);
    if (!error) {
      setDependencies(prev => prev.filter(d => d.depends_on_goal_id !== dependsOnGoalId));
      if (!deletedDependency) return;
      pushUndoAction({
        label: 'Deleted task dependency',
        undo: async () => {
          const { data, error: restoreError } = await supabase
            .from('goal_dependencies')
            .insert(deletedDependency)
            .select()
            .single();
          if (restoreError) throw restoreError;
          setDependencies((prev) => {
            if (prev.some((dependency) => dependency.id === deletedDependency.id)) return prev;
            const next = [...prev];
            next.splice(Math.min(dependencyIndex, next.length), 0, data as GoalDependency);
            return next;
          });
        },
      });
    }
  };

  return { dependencies, loading, addDependency, removeDependency, refetch: fetchDeps };
}
