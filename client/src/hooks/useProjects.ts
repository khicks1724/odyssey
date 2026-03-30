import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Project, JoinRequest } from '../types';

const PROJECTS_CHANGED_EVENT = 'odyssey:projects-changed';

function notifyProjectsChanged() {
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}

type RemoveProjectResult = {
  result: 'removed' | 'delete_required';
  new_owner_id?: string | null;
  ownership_transferred?: boolean;
};

async function removeProjectBucketFiles(bucket: string, projectId: string) {
  const prefix = `${projectId}`;
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error || !data || data.length === 0) return;

  const paths = data
    .filter((item) => item.name)
    .map((item) => `${prefix}/${item.name}`);

  if (paths.length > 0) {
    await supabase.storage.from(bucket).remove(paths);
  }
}

// ─── Standalone cascade delete (safe to call from any component) ─────────────
export async function deleteProjectCascade(id: string) {
  // Clean up storage buckets via the Storage API first (DB function can't do this directly)
  await Promise.allSettled([
    removeProjectBucketFiles('project-documents', id),
    removeProjectBucketFiles('goal-attachments', id),
    removeProjectBucketFiles('project-assets', id),
  ]);

  const { error } = await supabase.rpc('delete_project_cascade', { p_project_id: id });
  if (!error) {
    notifyProjectsChanged();
    return;
  }

  const message = error.message.toLowerCase();
  const missingRpc =
    message.includes('could not find the function public.delete_project_cascade') ||
    message.includes('schema cache') ||
    message.includes('function public.delete_project_cascade');

  if (!missingRpc) throw error;

  // Fallback if RPC doesn't exist
  const { error: fallbackError } = await supabase.from('projects').delete().eq('id', id);
  if (fallbackError) throw fallbackError;
  notifyProjectsChanged();
}

async function removeSelfFromProjectFallback(projectId: string, userId: string): Promise<RemoveProjectResult> {
  const [{ data: project, error: projectError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from('projects').select('id, owner_id').eq('id', projectId).single(),
    supabase
      .from('project_members')
      .select('user_id, role, joined_at')
      .eq('project_id', projectId)
      .order('joined_at', { ascending: true }),
  ]);

  if (projectError) throw projectError;
  if (membersError) throw membersError;

  const distinctUsers = new Set<string>();
  if (project?.owner_id) distinctUsers.add(project.owner_id);
  for (const member of members ?? []) {
    if (member.user_id) distinctUsers.add(member.user_id);
  }

  if (!distinctUsers.has(userId)) {
    throw new Error('You are not a member of this project.');
  }

  if (distinctUsers.size <= 1) {
    return { result: 'delete_required' };
  }

  let newOwnerId: string | null = null;
  let ownershipTransferred = false;

  if (project?.owner_id === userId) {
    const replacement = (members ?? [])
      .filter((member) => member.user_id !== userId)
      .sort((a, b) => {
        const aPriority = a.role === 'owner' ? 0 : 1;
        const bPriority = b.role === 'owner' ? 0 : 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
      })[0];

    if (!replacement?.user_id) {
      throw new Error('Could not transfer ownership before removing you from this project.');
    }

    newOwnerId = replacement.user_id;
    ownershipTransferred = true;

    const { error: updateOwnerError } = await supabase
      .from('projects')
      .update({ owner_id: newOwnerId })
      .eq('id', projectId);
    if (updateOwnerError) throw updateOwnerError;

    if (replacement.role !== 'owner') {
      const { error: promoteError } = await supabase
        .from('project_members')
        .update({ role: 'owner' })
        .eq('project_id', projectId)
        .eq('user_id', newOwnerId);
      if (promoteError) throw promoteError;
    }
  }

  const { error: removeError } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (removeError) throw removeError;

  return {
    result: 'removed',
    new_owner_id: newOwnerId,
    ownership_transferred: ownershipTransferred,
  };
}

export async function removeSelfFromProjectAccess(projectId: string, userId: string): Promise<RemoveProjectResult> {
  const { data, error } = await supabase.rpc('remove_self_from_project', { p_project_id: projectId });
  if (!error) {
    const result = (data as RemoveProjectResult | null) ?? { result: 'removed' as const };
    if (result.result === 'removed') notifyProjectsChanged();
    return result;
  }

  const message = error.message.toLowerCase();
  const missingRpc =
    message.includes('could not find the function public.remove_self_from_project') ||
    message.includes('schema cache') ||
    message.includes('function public.remove_self_from_project');

  if (!missingRpc) throw error;

  const result = await removeSelfFromProjectFallback(projectId, userId);
  if (result.result === 'removed') notifyProjectsChanged();
  return result;
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

  const removeSelfFromProject = async (id: string) => {
    if (!user) throw new Error('Not authenticated');
    const result = await removeSelfFromProjectAccess(id, user.id);
    if (result.result === 'removed') {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
    return result;
  };

  return { projects, loading, createProject, updateProject, deleteProject, removeSelfFromProject, refetch: fetchProjects };
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
    if (error) setProject(null);
    if (!error && data) setProject(data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const updateProject = async (updates: Partial<Pick<Project, 'name' | 'description' | 'github_repo' | 'start_date' | 'is_private' | 'invite_code' | 'image_url'>>) => {
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
