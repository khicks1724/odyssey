export interface GitHubRepoSource {
  github_repo?: string | null;
  github_repos?: string[] | null;
}

export function getGitHubRepos(source: GitHubRepoSource | null | undefined): string[] {
  const repos = (source?.github_repos ?? [])
    .map((value) => value.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, ''))
    .filter(Boolean);

  if (repos.length > 0) {
    return [...new Set(repos)];
  }

  const single = source?.github_repo?.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  return single ? [single] : [];
}

export function getPrimaryGitHubRepo(source: GitHubRepoSource | null | undefined): string | null {
  return getGitHubRepos(source)[0] ?? null;
}
