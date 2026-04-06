export interface GitLabIntegrationConfig {
  repoUrl?: string;
  repoPath?: string;
  repo?: string;
  repos?: string[];
  token?: string;
  host?: string;
}

export function getGitLabRepoPaths(config: GitLabIntegrationConfig | null | undefined): string[] {
  const repoPath = config?.repoPath?.trim();
  if (repoPath) return [repoPath];

  const repos = (config?.repos ?? []).map((value) => value.trim()).filter(Boolean);
  if (repos.length > 0) return [...new Set(repos)];

  const repo = config?.repo?.trim();
  return repo ? [repo] : [];
}

export function getGitLabRepoUrl(config: GitLabIntegrationConfig | null | undefined): string | null {
  const repoUrl = config?.repoUrl?.trim();
  if (repoUrl) return repoUrl;

  const repoPath = getGitLabRepoPaths(config)[0];
  const host = config?.host?.trim()?.replace(/\/+$/, '');
  if (repoPath && host) return `${host}/${repoPath}`;
  return null;
}
