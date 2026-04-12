import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface ProjectCommitHistoryRepo {
  source: 'github' | 'gitlab';
  repo: string;
  dateMap: Record<string, number>;
}

export interface ProjectCommitHistoryRecentCommit {
  sha: string;
  date: string;
  author: string;
  message: string;
  repo: string;
  source: 'github' | 'gitlab';
}

interface ProjectCommitHistoryResponse {
  commits?: { date: string; count: number }[];
  byRepo?: ProjectCommitHistoryRepo[];
  recentCommits?: ProjectCommitHistoryRecentCommit[];
  linkedRepos?: Array<{ source: 'github' | 'gitlab'; repo: string }>;
}

export function useProjectCommitHistory(projectId: string | null | undefined) {
  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<{ date: string; count: number }[]>([]);
  const [byRepo, setByRepo] = useState<ProjectCommitHistoryRepo[]>([]);
  const [recentCommits, setRecentCommits] = useState<ProjectCommitHistoryRecentCommit[]>([]);
  const [linkedRepos, setLinkedRepos] = useState<Array<{ source: 'github' | 'gitlab'; repo: string }>>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectId) {
        setLoading(false);
        setCommits([]);
        setByRepo([]);
        setRecentCommits([]);
        setLinkedRepos([]);
        return;
      }

      setLoading(true);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token ?? null;
        const response = await fetch(`/api/projects/${projectId}/commit-history`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });

        if (!response.ok) {
          throw new Error(`commit-history ${response.status}`);
        }

        const data = (await response.json()) as ProjectCommitHistoryResponse;
        if (cancelled) return;

        setCommits(data.commits ?? []);
        setByRepo(data.byRepo ?? []);
        setRecentCommits(data.recentCommits ?? []);
        setLinkedRepos(data.linkedRepos ?? []);
      } catch {
        if (cancelled) return;
        setCommits([]);
        setByRepo([]);
        setRecentCommits([]);
        setLinkedRepos([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return {
    loading,
    commits,
    byRepo,
    recentCommits,
    linkedRepos,
    hasData: commits.length > 0,
  };
}
