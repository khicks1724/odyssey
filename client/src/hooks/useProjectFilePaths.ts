import { useState, useEffect, useCallback } from 'react';

export interface FileRef {
  type: 'github' | 'gitlab';
  repo: string; // "owner/repo" for github, "group/project" for gitlab
  path: string;
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
  githubRepo: string | null | undefined,
  gitlabRepos: string[],
): UseProjectFilePathsResult {
  const [filePaths, setFilePaths] = useState<Map<string, FileRef>>(new Map());
  const [loading, setLoading] = useState(false);

  const gitlabKey = gitlabRepos.join(',');

  useEffect(() => {
    if (!githubRepo && gitlabRepos.length === 0) return;

    setLoading(true);
    const pathMap = new Map<string, FileRef>();
    const fetches: Promise<void>[] = [];

    if (githubRepo) {
      const [owner, repo] = githubRepo.split('/');
      fetches.push(
        fetch(`/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { files?: { path: string }[] } | null) => {
            for (const f of data?.files ?? []) {
              const ref: FileRef = { type: 'github', repo: githubRepo, path: f.path };
              addPathAliases(pathMap, ref);
            }
          })
          .catch(() => {}),
      );
    }

    for (const repo of gitlabRepos) {
      fetches.push(
        fetch(`/api/gitlab/tree?repo=${encodeURIComponent(repo)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { files?: { path: string }[] } | null) => {
            for (const f of data?.files ?? []) {
              const ref: FileRef = { type: 'gitlab', repo, path: f.path };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubRepo, gitlabKey]);

  const fetchFileContent = useCallback(async (ref: FileRef): Promise<string> => {
    let url: string;
    if (ref.type === 'github') {
      const [owner, repo] = ref.repo.split('/');
      url = `/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(ref.path)}`;
    } else {
      url = `/api/gitlab/file?repo=${encodeURIComponent(ref.repo)}&path=${encodeURIComponent(ref.path)}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { content?: string };
    return data.content ?? '';
  }, []);

  return { filePaths, loading, fetchFileContent };
}
