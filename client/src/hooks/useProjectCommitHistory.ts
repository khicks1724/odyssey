import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface ProjectCommitHistoryRepositoryStatus {
  source: 'github' | 'gitlab';
  repo: string;
  status: 'ok' | 'empty' | 'partial' | 'error';
  commitCount: number;
  message?: string;
}

interface ProjectCommitHistoryResponse {
  commits?: { date: string; count: number }[];
  byRepo?: ProjectCommitHistoryRepo[];
  recentCommits?: ProjectCommitHistoryRecentCommit[];
  linkedRepos?: Array<{ source: 'github' | 'gitlab'; repo: string }>;
  repositoryStatuses?: ProjectCommitHistoryRepositoryStatus[];
  warnings?: string[];
  fetchedAt?: string;
}

export interface ProjectCommitHistoryState {
  loading: boolean;
  refreshing: boolean;
  commits: { date: string; count: number }[];
  byRepo: ProjectCommitHistoryRepo[];
  recentCommits: ProjectCommitHistoryRecentCommit[];
  linkedRepos: Array<{ source: 'github' | 'gitlab'; repo: string }>;
  repositoryStatuses: ProjectCommitHistoryRepositoryStatus[];
  warnings: string[];
  error: string | null;
  lastUpdated: string | null;
  hasData: boolean;
  refresh: () => Promise<void>;
}

const AUTO_REFRESH_MS = 60_000;

export function useProjectCommitHistory(projectId: string | null | undefined): ProjectCommitHistoryState {
  const [loading, setLoading] = useState(Boolean(projectId));
  const [refreshing, setRefreshing] = useState(false);
  const [commits, setCommits] = useState<{ date: string; count: number }[]>([]);
  const [byRepo, setByRepo] = useState<ProjectCommitHistoryRepo[]>([]);
  const [recentCommits, setRecentCommits] = useState<ProjectCommitHistoryRecentCommit[]>([]);
  const [linkedRepos, setLinkedRepos] = useState<Array<{ source: 'github' | 'gitlab'; repo: string }>>([]);
  const [repositoryStatuses, setRepositoryStatuses] = useState<ProjectCommitHistoryRepositoryStatus[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (background = false) => {
    const requestId = ++requestSequence.current;
    if (!projectId) {
      setLoading(false);
      setRefreshing(false);
      setCommits([]);
      setByRepo([]);
      setRecentCommits([]);
      setLinkedRepos([]);
      setRepositoryStatuses([]);
      setWarnings([]);
      setError(null);
      setLastUpdated(null);
      return;
    }

    if (background) setRefreshing(true);
    else setLoading(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;
      const response = await fetch(`/api/projects/${projectId}/commit-history`, {
        cache: 'no-store',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Commit history request failed (${response.status}).`);
      }

      const data = (await response.json()) as ProjectCommitHistoryResponse;
      if (requestId !== requestSequence.current) return;

      setCommits(data.commits ?? []);
      setByRepo(data.byRepo ?? []);
      setRecentCommits(data.recentCommits ?? []);
      setLinkedRepos(data.linkedRepos ?? []);
      setRepositoryStatuses(data.repositoryStatuses ?? []);
      setWarnings(data.warnings ?? []);
      setError(null);
      setLastUpdated(data.fetchedAt ?? new Date().toISOString());
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Unable to load repository history.');
      if (!background) {
        setCommits([]);
        setByRepo([]);
        setRecentCommits([]);
        setLinkedRepos([]);
        setRepositoryStatuses([]);
        setWarnings([]);
      }
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    setCommits([]);
    setByRepo([]);
    setRecentCommits([]);
    setLinkedRepos([]);
    setRepositoryStatuses([]);
    setWarnings([]);
    setError(null);
    setLastUpdated(null);
    void load(false);

    if (!projectId) return undefined;

    const interval = window.setInterval(() => void load(true), AUTO_REFRESH_MS);
    const refreshOnFocus = () => void load(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      requestSequence.current += 1;
    };
  }, [load, projectId]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return {
    loading,
    refreshing,
    commits,
    byRepo,
    recentCommits,
    linkedRepos,
    repositoryStatuses,
    warnings,
    error,
    lastUpdated,
    hasData: commits.length > 0,
    refresh,
  };
}
