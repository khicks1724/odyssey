import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Project } from '../types';

export function useProjects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) setProjects(data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Real-time sync — update local state whenever any project row changes in DB
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('projects-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setProjects((prev) =>
              prev.map((p) => (p.id === (payload.new as Project).id ? (payload.new as Project) : p))
            );
          } else if (payload.eventType === 'INSERT') {
            setProjects((prev) => [payload.new as Project, ...prev]);
          } else if (payload.eventType === 'DELETE') {
            setProjects((prev) => prev.filter((p) => p.id !== (payload.old as Project).id));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const createProject = async (name: string, description: string) => {
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase
      .from('projects')
      .insert({ name, description, owner_id: user.id })
      .select()
      .single();

    if (error) throw error;

    // Auto-add owner as a project member
    await supabase
      .from('project_members')
      .insert({ project_id: data.id, user_id: user.id, role: 'owner' });

    setProjects((prev) => [data, ...prev]);
    return data;
  };

  const updateProject = async (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'github_repo' | 'start_date'>>) => {
    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    setProjects((prev) => prev.map((p) => (p.id === id ? data : p)));
    return data;
  };

  const deleteProject = async (id: string) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) throw error;
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return { projects, loading, createProject, updateProject, deleteProject, refetch: fetchProjects };
}

export function useProject(id: string | undefined) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProject = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();
    if (!error && data) setProject(data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const updateProject = async (updates: Partial<Pick<Project, 'name' | 'description' | 'github_repo' | 'start_date'>>) => {
    if (!id) throw new Error('No project');
    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setProject(data);
    return data;
  };

  return { project, loading, updateProject, refetch: fetchProject };
}
