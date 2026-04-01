import type { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';

const ENV_GITLAB_TOKEN = process.env.GITLAB_TOKEN ?? process.env.GITLAB_NPS_TOKEN ?? '';
const ENV_GITLAB_HOST  = process.env.GITLAB_HOST ?? process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';

// Keep legacy exports for code that still references the module-level constants
const GITLAB_TOKEN = ENV_GITLAB_TOKEN;
const GITLAB_HOST  = ENV_GITLAB_HOST;

async function glGet(repo: string, path: string, token?: string, host?: string): Promise<unknown> {
  const effectiveToken = token || ENV_GITLAB_TOKEN;
  const effectiveHost  = host  || ENV_GITLAB_HOST;
  const encoded = encodeURIComponent(repo);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${effectiveHost}/api/v4/projects/${encoded}${path}`, {
      headers: { 'PRIVATE-TOKEN': effectiveToken },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitLab ${res.status}: ${body.slice(0, 300)}`);
    }
    // README comes back as plain text; everything else is JSON
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('application/json') ? res.json() : res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function gitlabRoutes(server: FastifyInstance) {
  // ── Recent commits + README (used by AI endpoints) ─────────────────────────
  server.get<{ Querystring: { repo: string } }>('/gitlab/recent', async (request, reply) => {
    const { repo } = request.query;
    if (!repo) return reply.status(400).send({ error: 'repo required' });
    const token = (request.headers['x-gitlab-token'] as string | undefined) || ENV_GITLAB_TOKEN;
    const host  = (request.headers['x-gitlab-host']  as string | undefined) || ENV_GITLAB_HOST;
    if (!token) return reply.status(503).send({ error: 'GitLab token not configured on server' });

    const [commitsResult, readmeResult] = await Promise.allSettled([
      glGet(repo, '/repository/commits?per_page=30&order_by=created&sort=desc', token, host),
      glGet(repo, '/repository/files/README.md/raw?ref=HEAD', token, host),
    ]);

    type GLCommit = { created_at: string; title: string; author_name: string; web_url: string; short_id: string };
    const commits = commitsResult.status === 'fulfilled'
      ? (commitsResult.value as GLCommit[]).map((c) =>
          `[${c.created_at.slice(0, 10)}] ${c.title} — ${c.author_name}`
        )
      : [];

    const readme = readmeResult.status === 'fulfilled' ? String(readmeResult.value).slice(0, 3000) : '';

    return { commits, readme, host: GITLAB_HOST };
  });

  // ── Repo metadata ──────────────────────────────────────────────────────────
  server.get<{ Querystring: { repo: string } }>('/gitlab/info', async (request, reply) => {
    const { repo } = request.query;
    if (!repo) return reply.status(400).send({ error: 'repo required' });
    const token = (request.headers['x-gitlab-token'] as string | undefined) || ENV_GITLAB_TOKEN;
    const host  = (request.headers['x-gitlab-host']  as string | undefined) || ENV_GITLAB_HOST;
    if (!token) return reply.status(503).send({ error: 'GitLab token not configured on server' });

    try {
      const data = await glGet(repo, '', token, host) as {
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

  // ── Repo file tree ─────────────────────────────────────────────────────────
  server.get<{ Querystring: { repo: string } }>('/gitlab/tree', async (request, reply) => {
    const { repo } = request.query;
    if (!repo) return reply.status(400).send({ error: 'repo required' });
    const token = (request.headers['x-gitlab-token'] as string | undefined) || ENV_GITLAB_TOKEN;
    const host  = (request.headers['x-gitlab-host']  as string | undefined) || ENV_GITLAB_HOST;
    if (!token) return reply.status(503).send({ error: 'GitLab token not configured on server' });

    try {
      type GLTreeEntry = { id: string; name: string; type: string; path: string; mode: string };
      const encoded = encodeURIComponent(repo);
      const files: GLTreeEntry[] = [];
      let page = 1;

      while (page <= 20) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(
            `${host}/api/v4/projects/${encoded}/repository/tree?recursive=true&per_page=100&page=${page}`,
            { headers: { 'PRIVATE-TOKEN': token }, signal: controller.signal },
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

  // ── Link a GitLab repo to a project ───────────────────────────────────────
  server.post<{ Body: { projectId: string; repo: string; token?: string; host?: string } }>('/gitlab/link', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, repo, token: bodyToken, host: bodyHost } = request.body;
    if (!projectId || !repo) return reply.status(400).send({ error: 'projectId and repo are required' });

    // Use user-provided token/host, fall back to server env
    const effectiveToken = bodyToken?.trim() || ENV_GITLAB_TOKEN;
    const effectiveHost  = bodyHost?.trim()  || ENV_GITLAB_HOST;

    // Verify membership
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) return reply.status(403).send({ error: 'Not a member of this project' });

    // Validate repo is reachable before saving
    if (effectiveToken) {
      try {
        await glGet(repo, '', effectiveToken, effectiveHost);
      } catch {
        return reply.status(422).send({ error: `Cannot reach GitLab repo "${repo}" — check the path, token, and host.` });
      }
    }

    // Read existing repos (support old single-repo format), preserve existing token/host if not provided
    const { data: existing } = await supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle();
    const existingCfg = existing?.config as { repos?: string[]; repo?: string; token?: string; host?: string } | null;
    const existingRepos: string[] = existingCfg?.repos ?? (existingCfg?.repo ? [existingCfg.repo] : []);
    if (!existingRepos.includes(repo)) existingRepos.push(repo);

    const configToSave: Record<string, unknown> = {
      repos: existingRepos,
      host: effectiveHost,
    };
    // Only store token if user explicitly provided one (don't store empty string)
    const tokenToStore = bodyToken?.trim() || existingCfg?.token || '';
    if (tokenToStore) configToSave['token'] = tokenToStore;

    const { error: dbErr } = await supabase.from('integrations').upsert(
      { project_id: projectId, type: 'gitlab', config: configToSave },
      { onConflict: 'project_id,type' },
    );
    if (dbErr) return reply.status(500).send({ error: dbErr.message });
    return { linked: true, repos: existingRepos, host: effectiveHost };
  });

  // ── Fetch raw file content ─────────────────────────────────────────────────
  server.get<{ Querystring: { repo: string; path: string } }>('/gitlab/file', async (request, reply) => {
    const { repo, path } = request.query;
    if (!repo || !path) return reply.status(400).send({ error: 'repo and path required' });
    const token = (request.headers['x-gitlab-token'] as string | undefined) || ENV_GITLAB_TOKEN;
    const host  = (request.headers['x-gitlab-host']  as string | undefined) || ENV_GITLAB_HOST;
    if (!token) return reply.status(503).send({ error: 'GitLab token not configured on server' });

    try {
      const encoded = encodeURIComponent(repo);
      const fileEncoded = encodeURIComponent(path);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(
          `${host}/api/v4/projects/${encoded}/repository/files/${fileEncoded}/raw?ref=HEAD`,
          { headers: { 'PRIVATE-TOKEN': token }, signal: controller.signal },
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

  // ── Unlink a GitLab repo (or all) from a project ──────────────────────────
  server.delete<{ Querystring: { projectId: string; repo?: string } }>('/gitlab/link', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, repo } = request.query;
    if (!projectId) return reply.status(400).send({ error: 'projectId required' });

    if (repo) {
      // Remove just this repo from the array
      const { data: existing } = await supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle();
      const cfg = existing?.config as { repos?: string[]; repo?: string; token?: string; host?: string } | null;
      const repos: string[] = cfg?.repos ?? (cfg?.repo ? [cfg.repo] : []);
      const updated = repos.filter((r) => r !== repo);
      if (updated.length === 0) {
        await supabase.from('integrations').delete().eq('project_id', projectId).eq('type', 'gitlab');
      } else {
        const preservedConfig: Record<string, unknown> = { repos: updated, host: cfg?.host || ENV_GITLAB_HOST };
        if (cfg?.token) preservedConfig['token'] = cfg.token;
        await supabase.from('integrations').upsert(
          { project_id: projectId, type: 'gitlab', config: preservedConfig },
          { onConflict: 'project_id,type' },
        );
      }
      return { unlinked: true, repos: updated };
    } else {
      await supabase.from('integrations').delete().eq('project_id', projectId).eq('type', 'gitlab');
      return { unlinked: true, repos: [] };
    }
  });
}
