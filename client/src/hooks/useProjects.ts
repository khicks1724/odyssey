import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Project, JoinRequest } from '../types';

const PROJECTS_CHANGED_EVENT = 'odyssey:projects-changed';

function notifyProjectsChanged() {
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}

// ─── Standalone cascade delete (safe to call from any component) ─────────────
export async function deleteProjectCascade(id: string) {
  const { data: goalRows } = await supabase.from('goals').select('id').eq('project_id', id);
  const goalIds = (goalRows ?? []).map((g) => g.id);

  if (goalIds.length > 0) {
    await supabase.from('goal_comments').delete().in('goal_id', goalIds);
    await supabase.from('goal_reports').delete().in('goal_id', goalIds);
    await supabase.from('goal_ai_guidance').delete().in('goal_id', goalIds);
    await supabase.from('time_logs').delete().in('goal_id', goalIds);
    await supabase.from('goal_assignees').delete().in('goal_id', goalIds);
  }

  await supabase.from('goal_dependencies').delete().eq('project_id', id);
  await supabase.from('goals').delete().eq('project_id', id);
  await supabase.from('events').delete().eq('project_id', id);
  await supabase.from('project_members').delete().eq('project_id', id);
  await supabase.from('project_insights').delete().eq('project_id', id);
  await supabase.from('saved_reports').delete().eq('project_id', id);
  await supabase.from('integrations').delete().eq('project_id', id);
  await supabase.from('standup_reports').delete().eq('project_id', id);
  await supabase.from('join_requests').delete().eq('project_id', id);

  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
  notifyProjectsChanged();
}

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

  useEffect(() => {
    const onProjectsChanged = () => { fetchProjects(); };
    const onFocus = () => { fetchProjects(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchProjects();
    };

    window.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
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
    notifyProjectsChanged();
    return data;
  };

  const updateProject = async (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'github_repo' | 'start_date' | 'is_private' | 'invite_code'>>) => {
    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    setProjects((prev) => prev.map((p) => (p.id === id ? data : p)));
    notifyProjectsChanged();
    return data;
  };

  const deleteProject = async (id: string) => {
    await deleteProjectCascade(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    notifyProjectsChanged();
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

  const updateProject = async (updates: Partial<Pick<Project, 'name' | 'description' | 'github_repo' | 'start_date' | 'is_private' | 'invite_code'>>) => {
    if (!id) throw new Error('No project');
    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setProject(data);
    notifyProjectsChanged();
    return data;
  };

  return { project, loading, updateProject, refetch: fetchProject };
}

// ─── Join requests hook (for project owners) ─────────────────────────────────
export function useJoinRequests(projectId: string | undefined) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRequests = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase
      .from('join_requests')
      .select('*, profile:user_id(display_name, avatar_url)')
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (data) setRequests(data as unknown as JoinRequest[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const respond = async (requestId: string, action: 'approve' | 'deny') => {
    const { data } = await supabase.rpc('respond_join_request', {
      p_request_id: requestId,
      p_action: action,
    });
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    await fetchRequests();
  };

  return { requests, loading, respond, refetch: fetchRequests };
}
