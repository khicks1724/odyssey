import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface FileRef {
  type: 'github' | 'gitlab';
  repo: string; // "owner/repo" for github, "group/project" for gitlab
  path: string;
  projectId?: string | null;
}

interface UseProjectFilePathsResult {
  filePaths: Map<string, FileRef>;
  loading: boolean;
  fetchFileContent: (ref: FileRef) => Promise<string>;
}

function addPathAliases(pathMap: Map<string, FileRef>, ref: FileRef) {
  const normalized = ref.path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (!pathMap.has(normalized)) pathMap.set(normalized, ref);

  for (let i = 1; i < parts.length; i += 1) {
    const suffix = parts.slice(i).join('/');
    if (!pathMap.has(suffix)) pathMap.set(suffix, ref);
  }

  const basename = parts[parts.length - 1];
  if (basename && !pathMap.has(basename)) pathMap.set(basename, ref);
}

export function useProjectFilePaths(
  projectId: string | null | undefined,
  githubRepo: string | string[] | null | undefined,
  gitlabRepos: string[],
): UseProjectFilePathsResult {
  const [filePaths, setFilePaths] = useState<Map<string, FileRef>>(new Map());
  const [loading, setLoading] = useState(false);

  const gitlabKey = gitlabRepos.join(',');

  useEffect(() => {
    const githubRepos = Array.isArray(githubRepo)
      ? githubRepo.filter(Boolean)
      : githubRepo
        ? [githubRepo]
        : [];
    if (githubRepos.length === 0 && gitlabRepos.length === 0) return;

    setLoading(true);
    (async () => {
      const pathMap = new Map<string, FileRef>();
      const fetches: Promise<void>[] = [];
      const headers: Record<string, string> = {};
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.access_token) {
        headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      }

      for (const repoId of githubRepos) {
        const [owner, repo] = repoId.split('/');
        const params = new URLSearchParams();
        if (projectId) params.set('projectId', projectId);
        fetches.push(
          fetch(`/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree${params.toString() ? `?${params.toString()}` : ''}`, { headers })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { files?: { path: string }[] } | null) => {
              for (const f of data?.files ?? []) {
                const ref: FileRef = { type: 'github', repo: repoId, path: f.path, projectId };
                addPathAliases(pathMap, ref);
              }
            })
            .catch(() => {}),
        );
      }

      for (const repo of gitlabRepos) {
        fetches.push(
          fetch(`/api/gitlab/tree?projectId=${encodeURIComponent(projectId ?? '')}&repo=${encodeURIComponent(repo)}`, { headers })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { files?: { path: string }[] } | null) => {
              for (const f of data?.files ?? []) {
                const ref: FileRef = { type: 'gitlab', repo, path: f.path, projectId };
                addPathAliases(pathMap, ref);
              }
            })
            .catch(() => {}),
        );
      }

      Promise.all(fetches).finally(() => {
        setFilePaths(new Map(pathMap));
        setLoading(false);
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, Array.isArray(githubRepo) ? githubRepo.join(',') : githubRepo, gitlabKey]);

  const fetchFileContent = useCallback(async (ref: FileRef): Promise<string> => {
    let url: string;
    const headers: Record<string, string> = {};
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token) {
      headers.Authorization = `Bearer ${sessionData.session.access_token}`;
    }
    if (ref.type === 'github') {
      const [owner, repo] = ref.repo.split('/');
      const params = new URLSearchParams({ path: ref.path });
      if (ref.projectId ?? projectId) params.set('projectId', ref.projectId ?? projectId ?? '');
      url = `/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/file?${params.toString()}`;
    } else {
      url = `/api/gitlab/file?projectId=${encodeURIComponent(ref.projectId ?? projectId ?? '')}&repo=${encodeURIComponent(ref.repo)}&path=${encodeURIComponent(ref.path)}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { content?: string };
    return data.content ?? '';
  }, [projectId]);

  return { filePaths, loading, fetchFileContent };
}
