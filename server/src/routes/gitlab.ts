import type { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { getInternalUserId, getUserFromAuthHeader, isInternalRequest, userHasProjectAccess } from '../lib/request-auth.js';
import { getGitLabToken, storeGitLabToken } from '../lib/gitlab-token.js';

interface GitLabIntegrationConfig {
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

interface GitLabAccess {
  repoPath: string;
  repoUrl: string;
  token: string;
  host: string;
}

interface GitLabTokenRow {
  id: string;
  project_id: string;
  user_id: string;
  host: string;
  token_encrypted: string;
  token_iv: string;
  token_auth_tag: string;
}

function normalizeGitLabHost(host: string): string {
  return host.trim().replace(/\/+$/, '');
}

function buildGitLabRepoUrl(host: string, repoPath: string): string {
  return `${normalizeGitLabHost(host)}/${repoPath.replace(/^\/+|\/+$/g, '')}`;
}

function getGitLabRepoPath(config: GitLabIntegrationConfig | null | undefined): string {
  const repoPath = config?.repoPath?.trim()
    || config?.repo?.trim()
    || config?.repos?.find((value) => value.trim().length > 0)?.trim()
    || '';
  return repoPath.replace(/^\/+|\/+$/g, '');
}

function getGitLabRepoPaths(config: GitLabIntegrationConfig | null | undefined): string[] {
  const repoPath = config?.repoPath?.trim();
  const repos = (config?.repos ?? []).map((value) => value.trim()).filter(Boolean);
  const repo = config?.repo?.trim();
  return [...new Set([repoPath, ...repos, repo].filter((value): value is string => !!value))];
}

function getGitLabHost(config: GitLabIntegrationConfig | null | undefined): string {
  if (config?.host?.trim()) return normalizeGitLabHost(config.host);
  if (config?.repoUrl?.trim()) {
    try {
      return normalizeGitLabHost(new URL(config.repoUrl).origin);
    } catch {
      return '';
    }
  }
  return '';
}

function getGitLabRepoUrl(config: GitLabIntegrationConfig | null | undefined): string | null {
  const repoUrl = config?.repoUrl?.trim();
  if (repoUrl) return repoUrl;

  const repoPath = getGitLabRepoPaths(config)[0];
  const host = getGitLabHost(config);
  return repoPath && host ? buildGitLabRepoUrl(host, repoPath) : null;
}

function parseGitLabRepoUrl(input: string): { host: string; repoPath: string; repoUrl: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Repository URL must be a valid full HTTPS URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Repository URL must start with https://');
  }

  const repoPath = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!repoPath || !repoPath.includes('/')) {
    throw new Error('Repository URL must include the full GitLab project path.');
  }

  const host = normalizeGitLabHost(url.origin);
  return {
    host,
    repoPath,
    repoUrl: buildGitLabRepoUrl(host, repoPath),
  };
}

async function getGitLabIntegration(projectId: string) {
  const { data, error } = await supabase
    .from('integrations')
    .select('id, config')
    .eq('project_id', projectId)
    .eq('type', 'gitlab')
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; config: GitLabIntegrationConfig | null } | null;
}

async function saveGitLabIntegration(projectId: string, config: GitLabIntegrationConfig) {
  const existing = await getGitLabIntegration(projectId);
  if (existing?.id) {
    const { error } = await supabase
      .from('integrations')
      .update({ config })
      .eq('id', existing.id);
    return error;
  }

  const { error } = await supabase
    .from('integrations')
    .insert({ project_id: projectId, type: 'gitlab', config });
  return error;
}

async function getGitLabTokenRow(projectId: string, userId: string): Promise<GitLabTokenRow | null> {
  const { data, error } = await supabase
    .from('user_project_gitlab_tokens')
    .select('id, project_id, user_id, host, token_encrypted, token_iv, token_auth_tag')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return null;
  return (data as GitLabTokenRow | null) ?? null;
}

async function saveGitLabTokenForUser(projectId: string, userId: string, host: string, token: string): Promise<string | null> {
  const encryptedConfig = storeGitLabToken({}, token) as GitLabIntegrationConfig;
  const { error } = await supabase
    .from('user_project_gitlab_tokens')
    .upsert({
      project_id: projectId,
      user_id: userId,
      host,
      token_encrypted: encryptedConfig.tokenEncrypted,
      token_iv: encryptedConfig.tokenIv,
      token_auth_tag: encryptedConfig.tokenAuthTag,
    });

  return error?.message ?? null;
}

async function resolveGitLabAccess(input: {
  projectId?: string;
  repo?: string;
  tokenHeader?: string;
  hostHeader?: string;
  userId?: string | null;
}): Promise<GitLabAccess | null> {
  const requestedRepo = input.repo?.trim().replace(/^\/+|\/+$/g, '') ?? '';

  if (input.projectId?.trim()) {
    const integration = await getGitLabIntegration(input.projectId.trim());
    const config = (integration?.config ?? null) as GitLabIntegrationConfig | null;
    const repoPath = requestedRepo || getGitLabRepoPath(config);
    const host = getGitLabHost(config);
    const tokenRow = input.userId ? await getGitLabTokenRow(input.projectId.trim(), input.userId) : null;
    const token = tokenRow
      ? getGitLabToken({
          tokenEncrypted: tokenRow.token_encrypted,
          tokenIv: tokenRow.token_iv,
          tokenAuthTag: tokenRow.token_auth_tag,
        })
      : getGitLabToken(config);
    if (!repoPath || !token || !host) return null;
    return {
      repoPath,
      token,
      host,
      repoUrl: config?.repoUrl?.trim() || buildGitLabRepoUrl(host, repoPath),
    };
  }

  const token = input.tokenHeader?.trim() ?? '';
  const host = input.hostHeader?.trim() ? normalizeGitLabHost(input.hostHeader) : '';
  if (!requestedRepo || !token || !host) return null;

  return {
    repoPath: requestedRepo,
    token,
    host,
    repoUrl: buildGitLabRepoUrl(host, requestedRepo),
  };
}

async function glGet(repoPath: string, path: string, token: string, host: string): Promise<unknown> {
  if (!token) throw new Error('GitLab token not configured for this project');
  if (!host) throw new Error('GitLab host not configured for this project');

  const encoded = encodeURIComponent(repoPath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${host}/api/v4/projects/${encoded}${path}`, {
      headers: { 'PRIVATE-TOKEN': token },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitLab ${res.status}: ${body.slice(0, 300)}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? res.json() : res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function requireProjectAccess(projectId: string, userId: string): Promise<boolean> {
  return userHasProjectAccess(projectId, userId);
}

async function authorizeGitLabProjectRequest(
  authorization: string | undefined,
  projectId: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!projectId?.trim()) {
    return { ok: false, status: 400, error: 'projectId is required' };
  }

  const userId = await getUserFromAuthHeader(authorization);
  if (!userId) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const allowed = await requireProjectAccess(projectId, userId);
  if (!allowed) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true };
}

export async function gitlabRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { projectId?: string; repo?: string } }>('/gitlab/recent', async (request, reply) => {
    const internalUserId = isInternalRequest(request.headers) ? getInternalUserId(request.headers) : null;
    if (!isInternalRequest(request.headers)) {
      const accessCheck = await authorizeGitLabProjectRequest(request.headers.authorization, request.query.projectId);
      if (!accessCheck.ok) return reply.status(accessCheck.status).send({ error: accessCheck.error });
    }

    const access = await resolveGitLabAccess({
      projectId: request.query.projectId,
      repo: request.query.repo,
      tokenHeader: request.headers['x-gitlab-token'] as string | undefined,
      hostHeader: request.headers['x-gitlab-host'] as string | undefined,
      userId: internalUserId ?? await getUserFromAuthHeader(request.headers.authorization),
    });
    if (!access) return reply.status(400).send({ error: 'GitLab repo not linked for this project' });

    const [commitsResult, readmeResult] = await Promise.allSettled([
      glGet(access.repoPath, '/repository/commits?per_page=30&order_by=created&sort=desc', access.token, access.host),
      glGet(access.repoPath, '/repository/files/README.md/raw?ref=HEAD', access.token, access.host),
    ]);

    type GLCommit = { created_at: string; title: string; author_name: string };
    const commits = commitsResult.status === 'fulfilled'
      ? (commitsResult.value as GLCommit[]).map((c) =>
          `[${c.created_at.slice(0, 10)}] ${c.title} — ${c.author_name}`
        )
      : [];

    const readme = readmeResult.status === 'fulfilled' ? String(readmeResult.value).slice(0, 3000) : '';
    return { commits, readme, host: access.host, repo: access.repoPath, repoUrl: access.repoUrl };
  });

  server.get<{ Querystring: { projectId?: string; repo?: string } }>('/gitlab/commits', async (request, reply) => {
    const internalUserId = isInternalRequest(request.headers) ? getInternalUserId(request.headers) : null;
    if (!isInternalRequest(request.headers)) {
      const accessCheck = await authorizeGitLabProjectRequest(request.headers.authorization, request.query.projectId);
      if (!accessCheck.ok) return reply.status(accessCheck.status).send({ error: accessCheck.error });
    }

    const access = await resolveGitLabAccess({
      projectId: request.query.projectId,
      repo: request.query.repo,
      tokenHeader: request.headers['x-gitlab-token'] as string | undefined,
      hostHeader: request.headers['x-gitlab-host'] as string | undefined,
      userId: internalUserId ?? await getUserFromAuthHeader(request.headers.authorization),
    });
    if (!access) return reply.status(400).send({ error: 'GitLab repo not linked for this project' });

    try {
      const data = await glGet(access.repoPath, '/repository/commits?per_page=6&order_by=created_at&sort=desc', access.token, access.host) as Array<{ id: string; title: string }>;
      return { commits: data };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  server.get<{ Querystring: { projectId?: string; repo?: string; sha?: string } }>('/gitlab/commit-diff', async (request, reply) => {
    const internalUserId = isInternalRequest(request.headers) ? getInternalUserId(request.headers) : null;
    if (!isInternalRequest(request.headers)) {
      const accessCheck = await authorizeGitLabProjectRequest(request.headers.authorization, request.query.projectId);
      if (!accessCheck.ok) return reply.status(accessCheck.status).send({ error: accessCheck.error });
    }

    const access = await resolveGitLabAccess({
      projectId: request.query.projectId,
      repo: request.query.repo,
      tokenHeader: request.headers['x-gitlab-token'] as string | undefined,
      hostHeader: request.headers['x-gitlab-host'] as string | undefined,
      userId: internalUserId ?? await getUserFromAuthHeader(request.headers.authorization),
    });
    const sha = request.query.sha?.trim();
    if (!access || !sha) return reply.status(400).send({ error: 'projectId, repo, and sha are required' });

    try {
      const data = await glGet(access.repoPath, `/repository/commits/${encodeURIComponent(sha)}/diff`, access.token, access.host);
      return { diffs: data };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  server.get<{ Querystring: { projectId?: string; repo?: string } }>('/gitlab/info', async (request, reply) => {
    const internalUserId = isInternalRequest(request.headers) ? getInternalUserId(request.headers) : null;
    if (!isInternalRequest(request.headers)) {
      const accessCheck = await authorizeGitLabProjectRequest(request.headers.authorization, request.query.projectId);
      if (!accessCheck.ok) return reply.status(accessCheck.status).send({ error: accessCheck.error });
    }

    const access = await resolveGitLabAccess({
      projectId: request.query.projectId,
      repo: request.query.repo,
      tokenHeader: request.headers['x-gitlab-token'] as string | undefined,
      hostHeader: request.headers['x-gitlab-host'] as string | undefined,
      userId: internalUserId ?? await getUserFromAuthHeader(request.headers.authorization),
    });
    if (!access) return reply.status(400).send({ error: 'GitLab repo not linked for this project' });

    try {
      const data = await glGet(access.repoPath, '', access.token, access.host) as {
        name_with_namespace: string;
        description: string | null;
        web_url: string;
        default_branch: string;
        star_count: number;
        open_issues_count: number;
        last_activity_at: string;
        visibility: string;
      };
      return {
        name: data.name_with_namespace,
        description: data.description,
        web_url: data.web_url,
        default_branch: data.default_branch,
        stars: data.star_count,
        open_issues: data.open_issues_count,
        last_activity: data.last_activity_at,
        visibility: data.visibility,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      server.log.error(err);
      return reply.status(500).send({ error: msg });
    }
  });

  server.get<{ Querystring: { projectId?: string; repo?: string } }>('/gitlab/tree', async (request, reply) => {
    const internalUserId = isInternalRequest(request.headers) ? getInternalUserId(request.headers) : null;
    if (!isInternalRequest(request.headers)) {
      const accessCheck = await authorizeGitLabProjectRequest(request.headers.authorization, request.query.projectId);
      if (!accessCheck.ok) return reply.status(accessCheck.status).send({ error: accessCheck.error });
    }

    const access = await resolveGitLabAccess({
      projectId: request.query.projectId,
      repo: request.query.repo,
      tokenHeader: request.headers['x-gitlab-token'] as string | undefined,
      hostHeader: request.headers['x-gitlab-host'] as string | undefined,
      userId: internalUserId ?? await getUserFromAuthHeader(request.headers.authorization),
    });
    if (!access) return reply.status(400).send({ error: 'GitLab repo not linked for this project' });

    try {
      type GLTreeEntry = { id: string; name: string; type: string; path: string; mode: string };
      const encoded = encodeURIComponent(access.repoPath);
      const files: GLTreeEntry[] = [];
      let page = 1;

      while (page <= 20) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(
            `${access.host}/api/v4/projects/${encoded}/repository/tree?recursive=true&per_page=100&page=${page}`,
            { headers: { 'PRIVATE-TOKEN': access.token }, signal: controller.signal },
          );
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`GitLab ${res.status}: ${body.slice(0, 300)}`);
          }

          const pageData = await res.json() as GLTreeEntry[];
          files.push(...pageData);

          const nextPage = res.headers.get('x-next-page');
          if (!nextPage || pageData.length === 0) break;
          page = Number(nextPage);
          if (!page) break;
        } finally {
          clearTimeout(timeout);
        }
      }

      return {
        files: files
          .filter((f) => f.type === 'blob')
          .map((f) => ({ path: f.path })),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  server.get<{ Querystring: { projectId: string } }>('/gitlab/link', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId } = request.query;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const hasAccess = await requireProjectAccess(projectId, user.id);
    if (!hasAccess) return reply.status(403).send({ error: 'Not a member of this project' });

    const integration = await getGitLabIntegration(projectId);
    const config = (integration?.config ?? null) as GitLabIntegrationConfig | null;
    const tokenRow = await getGitLabTokenRow(projectId, user.id);
    const repos = getGitLabRepoPaths(config);
    const repoUrl = getGitLabRepoUrl(config);

    return {
      repos,
      repoUrl,
      host: getGitLabHost(config) || tokenRow?.host || null,
      tokenSaved: Boolean(tokenRow || getGitLabToken(config)),
    };
  });

  server.post<{ Body: { projectId: string; repoUrl: string; token?: string } }>('/gitlab/link', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, repoUrl, token: providedToken } = request.body;
    if (!projectId || !repoUrl?.trim()) return reply.status(400).send({ error: 'projectId and repoUrl are required' });

    const hasAccess = await requireProjectAccess(projectId, user.id);
    if (!hasAccess) return reply.status(403).send({ error: 'Not a member of this project' });

    let parsedRepo: { host: string; repoPath: string; repoUrl: string };
    try {
      parsedRepo = parseGitLabRepoUrl(repoUrl);
    } catch (err) {
      return reply.status(422).send({ error: err instanceof Error ? err.message : 'Invalid repository URL' });
    }

    const existing = await getGitLabIntegration(projectId);
    const existingConfig = (existing?.config ?? null) as GitLabIntegrationConfig | null;
    const tokenRow = await getGitLabTokenRow(projectId, user.id);
    const existingUserToken = tokenRow
      ? getGitLabToken({
          tokenEncrypted: tokenRow.token_encrypted,
          tokenIv: tokenRow.token_iv,
          tokenAuthTag: tokenRow.token_auth_tag,
        })
      : '';
    const legacySharedToken = getGitLabToken(existingConfig);
    const effectiveToken = providedToken?.trim() || existingUserToken || legacySharedToken || '';
    if (!effectiveToken) {
      return reply.status(422).send({ error: 'Personal access token is required the first time you connect a GitLab repo.' });
    }

    try {
      await glGet(parsedRepo.repoPath, '', effectiveToken, parsedRepo.host);
    } catch {
      return reply.status(422).send({ error: `Cannot reach GitLab repo "${parsedRepo.repoPath}" — check the URL and personal access token.` });
    }

    const existingRepos = getGitLabRepoPaths(existingConfig);
    const mergedRepos = [...new Set([...existingRepos, parsedRepo.repoPath])];
    const configToSave = {
      repoUrl: parsedRepo.repoUrl,
      repoPath: mergedRepos[0] ?? parsedRepo.repoPath,
      repos: mergedRepos,
      host: parsedRepo.host,
    } satisfies GitLabIntegrationConfig;

    const dbErr = await saveGitLabIntegration(projectId, configToSave);
    if (dbErr) return reply.status(500).send({ error: dbErr.message });
    if (providedToken?.trim() || (!tokenRow && legacySharedToken)) {
      const tokenSaveError = await saveGitLabTokenForUser(projectId, user.id, parsedRepo.host, effectiveToken);
      if (tokenSaveError) return reply.status(500).send({ error: tokenSaveError });
    }

    return {
      linked: true,
      repoPath: parsedRepo.repoPath,
      repoUrl: parsedRepo.repoUrl,
      repos: mergedRepos,
      host: parsedRepo.host,
      tokenSaved: true,
    };
  });

  server.get<{ Querystring: { projectId?: string; repo?: string; path: string } }>('/gitlab/file', async (request, reply) => {
    const internalUserId = isInternalRequest(request.headers) ? getInternalUserId(request.headers) : null;
    if (!isInternalRequest(request.headers)) {
      const accessCheck = await authorizeGitLabProjectRequest(request.headers.authorization, request.query.projectId);
      if (!accessCheck.ok) return reply.status(accessCheck.status).send({ error: accessCheck.error });
    }

    const access = await resolveGitLabAccess({
      projectId: request.query.projectId,
      repo: request.query.repo,
      tokenHeader: request.headers['x-gitlab-token'] as string | undefined,
      hostHeader: request.headers['x-gitlab-host'] as string | undefined,
      userId: internalUserId ?? await getUserFromAuthHeader(request.headers.authorization),
    });
    const { path } = request.query;
    if (!access || !path) return reply.status(400).send({ error: 'projectId and path required for GitLab file access' });

    try {
      const encoded = encodeURIComponent(access.repoPath);
      const fileEncoded = encodeURIComponent(path);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(
          `${access.host}/api/v4/projects/${encoded}/repository/files/${fileEncoded}/raw?ref=HEAD`,
          { headers: { 'PRIVATE-TOKEN': access.token }, signal: controller.signal },
        );
        if (!res.ok) return reply.status(res.status).send({ error: 'File not found' });
        const contentLength = Number(res.headers.get('content-length') ?? 0);
        if (contentLength > 512_000) return reply.status(413).send({ error: 'File too large to preview (>512 KB)' });
        const content = await res.text();
        if (content.length > 512_000) return reply.status(413).send({ error: 'File too large to preview (>512 KB)' });
        return { content, name: path.split('/').pop() ?? path };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  server.delete<{ Querystring: { projectId: string; repo?: string } }>('/gitlab/link', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, repo } = request.query;
    if (!projectId) return reply.status(400).send({ error: 'projectId required' });

    const hasAccess = await requireProjectAccess(projectId, user.id);
    if (!hasAccess) return reply.status(403).send({ error: 'Not a member of this project' });

    const existing = await getGitLabIntegration(projectId);
    const existingConfig = (existing?.config ?? null) as GitLabIntegrationConfig | null;
    if (!existing?.id || !existingConfig) {
      return { unlinked: true, repos: [] };
    }

    const currentRepos = getGitLabRepoPaths(existingConfig);
    if (!repo?.trim()) {
      await supabase.from('integrations').delete().eq('project_id', projectId).eq('type', 'gitlab');
      return { unlinked: true, repos: [] };
    }

    const nextRepos = currentRepos.filter((value) => value !== repo.trim());
    if (nextRepos.length === 0) {
      await supabase.from('integrations').delete().eq('project_id', projectId).eq('type', 'gitlab');
      return { unlinked: true, repos: [] };
    }

    const nextConfig: GitLabIntegrationConfig = {
      ...existingConfig,
      repoPath: nextRepos[0],
      repos: nextRepos,
      repoUrl: buildGitLabRepoUrl(getGitLabHost(existingConfig), nextRepos[0]),
    };

    const { error } = await supabase.from('integrations').update({ config: nextConfig }).eq('id', existing.id);
    if (error) return reply.status(500).send({ error: error.message });
    return { unlinked: true, repos: nextRepos };
  });
}
