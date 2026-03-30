import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type PromptFeature = 'insights' | 'standup' | 'report' | 'guidance' | 'risk' | 'intelligent_update';

export interface ProjectPrompt {
  id: string;
  project_id: string;
  feature: PromptFeature;
  prompt: string;
  updated_at: string;
}

export const PROMPT_LABELS: Record<PromptFeature, string> = {
  insights:          'AI Insights',
  standup:           '2-Week Standup',
  report:            'Report Generator',
  guidance:          'AI Guidance',
  risk:              'Task Risk Assessment',
  intelligent_update:'Intelligent Update',
};

export function useProjectPrompts(projectId: string | undefined) {
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase
      .from('project_prompts')
      .select('*')
      .eq('project_id', projectId);
    setPrompts((data as ProjectPrompt[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetch(); }, [fetch]);

  const getPrompt = (feature: PromptFeature): string | null =>
    prompts.find((p) => p.feature === feature)?.prompt ?? null;

  const savePrompt = async (feature: PromptFeature, prompt: string) => {
    if (!projectId) return;
    const existing = prompts.find((p) => p.feature === feature);
    if (existing) {
      const { error } = await supabase
        .from('project_prompts')
        .update({ prompt, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (!error) setPrompts((prev) => prev.map((p) => (p.id === existing.id ? { ...p, prompt } : p)));
    } else {
      const { data, error } = await supabase
        .from('project_prompts')
        .insert({ project_id: projectId, feature, prompt })
        .select()
        .single();
      if (!error && data) setPrompts((prev) => [...prev, data as ProjectPrompt]);
    }
  };

  const resetPrompt = async (feature: PromptFeature) => {
    if (!projectId) return;
    const existing = prompts.find((p) => p.feature === feature);
    if (existing) {
      await supabase.from('project_prompts').delete().eq('id', existing.id);
      setPrompts((prev) => prev.filter((p) => p.id !== existing.id));
    }
  };

  const resetAllPrompts = async () => {
    if (!projectId) return;
    await supabase.from('project_prompts').delete().eq('project_id', projectId);
    setPrompts([]);
  };

  return { prompts, loading, getPrompt, savePrompt, resetPrompt, resetAllPrompts, refetch: fetch };
}
