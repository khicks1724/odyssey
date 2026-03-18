import type { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';

const GITLAB_TOKEN = process.env.GITLAB_NPS_TOKEN ?? '';
const GITLAB_HOST = process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';

async function glGet(repo: string, path: string): Promise<unknown> {
  const encoded = encodeURIComponent(repo);
  const res = await fetch(`${GITLAB_HOST}/api/v4/projects/${encoded}${path}`, {
    headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitLab ${res.status}: ${body.slice(0, 300)}`);
  }
  // README comes back as plain text; everything else is JSON
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export async function gitlabRoutes(server: FastifyInstance) {
  // ── Recent commits + README (used by AI endpoints) ─────────────────────────
  server.get<{ Querystring: { repo: string } }>('/gitlab/recent', async (request, reply) => {
    const { repo } = request.query;
    if (!repo) return reply.status(400).send({ error: 'repo required' });
    if (!GITLAB_TOKEN) return reply.status(503).send({ error: 'GitLab token not configured on server' });

    const [commitsResult, readmeResult] = await Promise.allSettled([
      glGet(repo, '/repository/commits?per_page=30&order_by=created&sort=desc'),
      glGet(repo, '/repository/files/README.md/raw?ref=HEAD'),
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
    if (!GITLAB_TOKEN) return reply.status(503).send({ error: 'GitLab token not configured on server' });

    try {
      const data = await glGet(repo, '') as {
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

  // ── Link a GitLab repo to a project ───────────────────────────────────────
  server.post<{ Body: { projectId: string; repo: string } }>('/gitlab/link', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, repo } = request.body;
    if (!projectId || !repo) return reply.status(400).send({ error: 'projectId and repo are required' });

    // Verify membership
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) return reply.status(403).send({ error: 'Not a member of this project' });

    // Validate repo is reachable before saving
    if (GITLAB_TOKEN) {
      try {
        await glGet(repo, '');
      } catch {
        return reply.status(422).send({ error: `Cannot reach GitLab repo "${repo}" — check the path and make sure you're on the NPS network/VPN.` });
      }
    }

    const { error: dbErr } = await supabase.from('integrations').upsert(
      { project_id: projectId, type: 'gitlab', config: { repo, host: GITLAB_HOST } },
      { onConflict: 'project_id,type' },
    );
    if (dbErr) return reply.status(500).send({ error: dbErr.message });
    return { linked: true, repo, host: GITLAB_HOST };
  });

  // ── Unlink GitLab repo from a project ─────────────────────────────────────
  server.delete<{ Querystring: { projectId: string } }>('/gitlab/link', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId } = request.query;
    if (!projectId) return reply.status(400).send({ error: 'projectId required' });

    await supabase.from('integrations').delete().eq('project_id', projectId).eq('type', 'gitlab');
    return { unlinked: true };
  });
}
