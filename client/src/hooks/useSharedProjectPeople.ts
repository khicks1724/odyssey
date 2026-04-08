import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export interface SharedProjectPerson {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  project_id: string | null;
  project_name: string | null;
}

export function useSharedProjectPeople(excludeProjectId?: string | null) {
  const { user } = useAuth();
  const [people, setPeople] = useState<SharedProjectPerson[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPeople = useCallback(async () => {
    if (!user) {
      setPeople([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [{ data: memberships, error: membershipsError }, { data: ownedProjects, error: ownedProjectsError }] = await Promise.all([
        supabase.from('project_members').select('project_id').eq('user_id', user.id),
        supabase.from('projects').select('id').eq('owner_id', user.id),
      ]);
      if (membershipsError) throw membershipsError;
      if (ownedProjectsError) throw ownedProjectsError;

      const projectIds = [...new Set([
        ...(memberships ?? []).map((row) => row.project_id),
        ...(ownedProjects ?? []).map((row) => row.id),
      ])].filter((projectId) => projectId && projectId !== excludeProjectId);

      if (projectIds.length === 0) {
        setPeople([]);
        return;
      }

      const [{ data: projects, error: projectsError }, { data: memberRows, error: memberRowsError }] = await Promise.all([
        supabase.from('projects').select('id, name, owner_id').in('id', projectIds),
        supabase.from('project_members').select('project_id, user_id').in('project_id', projectIds),
      ]);
      if (projectsError) throw projectsError;
      if (memberRowsError) throw memberRowsError;

      const candidateRows = new Map<string, { user_id: string; project_id: string }>();
      for (const row of memberRows ?? []) {
        if (!row.project_id || !row.user_id || row.user_id === user.id) continue;
        candidateRows.set(`${row.user_id}:${row.project_id}`, { user_id: row.user_id, project_id: row.project_id });
      }
      for (const project of projects ?? []) {
        if (!project.id || !project.owner_id || project.owner_id === user.id) continue;
        candidateRows.set(`${project.owner_id}:${project.id}`, { user_id: project.owner_id, project_id: project.id });
      }

      const uniqueCandidates = [...candidateRows.values()];
      const userIds = [...new Set(uniqueCandidates.map((row) => row.user_id))];
      const { data: profiles, error: profilesError } = userIds.length
        ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', userIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;

      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const projectMap = new Map((projects ?? []).map((project) => [project.id, project]));
      const nextPeople = uniqueCandidates.map((row) => ({
        id: row.user_id,
        display_name: profileMap.get(row.user_id)?.display_name ?? null,
        avatar_url: profileMap.get(row.user_id)?.avatar_url ?? null,
        project_id: row.project_id,
        project_name: projectMap.get(row.project_id)?.name ?? null,
      }));

      nextPeople.sort((left, right) => {
        const nameCompare = (left.display_name ?? left.id).localeCompare(right.display_name ?? right.id);
        if (nameCompare !== 0) return nameCompare;
        return (left.project_name ?? '').localeCompare(right.project_name ?? '');
      });
      setPeople(nextPeople);
    } catch (error) {
      console.error('Failed to load shared project people:', error);
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [excludeProjectId, user]);

  useEffect(() => {
    void fetchPeople();
  }, [fetchPeople]);

  return {
    people,
    loading,
    refetch: fetchPeople,
  };
}
