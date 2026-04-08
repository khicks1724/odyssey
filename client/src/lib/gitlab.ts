export interface GitLabIntegrationConfig {
  repoUrl?: string;
  repoPath?: string;
  repo?: string;
  repos?: string[];
  token?: string;
  tokenEncrypted?: string;
  tokenIv?: string;
  tokenAuthTag?: string;
  host?: string;
}

export function getGitLabRepoPaths(config: GitLabIntegrationConfig | null | undefined): string[] {
  const repos = (config?.repos ?? []).map((value) => value.trim()).filter(Boolean);
  const repoPath = config?.repoPath?.trim();
  const repo = config?.repo?.trim();
  return [...new Set([repoPath, ...repos, repo].filter((value): value is string => !!value))];
}

export function getGitLabRepoUrl(config: GitLabIntegrationConfig | null | undefined): string | null {
  const repoUrl = config?.repoUrl?.trim();
  if (repoUrl) return repoUrl;

  const repoPath = getGitLabRepoPaths(config)[0];
  const host = config?.host?.trim()?.replace(/\/+$/, '');
  if (repoPath && host) return `${host}/${repoPath}`;
  return null;
}
