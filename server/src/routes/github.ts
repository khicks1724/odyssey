import type { FastifyInstance } from 'fastify';
import { getUserFromAuthHeader, isInternalRequest, requireProjectAccessFromAuthHeader } from '../lib/request-auth.js';
import { isGeneratedThesisLatexCommitMessage } from '../lib/activity-filters.js';

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  html_url: string;
  author?: { login: string; avatar_url: string } | null;
}

async function requireGitHubProjectAccess(
  authorization: string | undefined,
  projectId: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const access = await requireProjectAccessFromAuthHeader(projectId, authorization);
  return access.ok
    ? { ok: true }
    : { ok: false, status: access.status, error: access.error };
}

export async function githubRoutes(server: FastifyInstance) {
  // Fetch recent commits for a repo
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { per_page?: string; projectId?: string };
  }>('/github/:owner/:repo/commits', async (request, reply) => {
    if (!isInternalRequest(request.headers)) {
      const access = await requireGitHubProjectAccess(request.headers.authorization, request.query.projectId);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });
    }

    const { owner, repo } = request.params;
    const perPage = Math.min(100, Number(request.query.per_page) || 30);
    const token = (request.headers['x-github-token'] as string | undefined) || process.env.GITHUB_TOKEN;

    // Validate owner/repo format to prevent injection
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }

    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Odyssey-App',
    };
    if (token) ghHeaders.Authorization = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${perPage}`,
      { headers: ghHeaders },
    );

    if (!res.ok) {
      await res.text().catch(() => undefined);
      return reply.status(res.status).send({ error: 'GitHub API error' });
    }

    const commits: GitHubCommit[] = await res.json();

    // Normalize to Odyssey event format
    const events = commits
      .filter((c) => !isGeneratedThesisLatexCommitMessage(c.commit.message))
      .map((c) => ({
      source: 'github' as const,
      event_type: 'commit' as const,
      title: c.commit.message.split('\n')[0],
      summary: c.commit.message,
      metadata: {
        sha: c.sha,
        url: c.html_url,
        author_name: c.commit.author.name,
        author_login: c.author?.login,
        author_avatar: c.author?.avatar_url,
      },
      occurred_at: c.commit.author.date,
    }));

    return { commits: events, total: events.length };
  });

  // Get repo info
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { projectId?: string };
  }>('/github/:owner/:repo', async (request, reply) => {
    if (!isInternalRequest(request.headers)) {
      const access = await requireGitHubProjectAccess(request.headers.authorization, request.query.projectId);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });
    }

    const { owner, repo } = request.params;
    const token = (request.headers['x-github-token'] as string | undefined) || process.env.GITHUB_TOKEN;

    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }

    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Odyssey-App',
    };
    if (token) ghHeaders.Authorization = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: ghHeaders },
    );

    if (!res.ok) {
      await res.text().catch(() => undefined);
      return reply.status(res.status).send({ error: 'GitHub API error' });
    }

    const data = await res.json();
    return {
      full_name: data.full_name,
      description: data.description,
      language: data.language,
      stars: data.stargazers_count,
      open_issues: data.open_issues_count,
      default_branch: data.default_branch,
      html_url: data.html_url,
    };
  });

  // Search GitHub users
  server.get<{
    Querystring: { q: string };
  }>('/github/search/users', async (request, reply) => {
    const userId = await getUserFromAuthHeader(request.headers.authorization);
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { q } = request.query;
    const token = (request.headers['x-github-token'] as string | undefined) || process.env.GITHUB_TOKEN;

    if (!q || q.length < 2) {
      return reply.status(400).send({ error: 'Query must be at least 2 characters' });
    }

    if (!token) {
      return reply.status(503).send({ error: 'GitHub search is not configured' });
    }

    const res = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=8`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Odyssey-App',
        },
      },
    );

    if (!res.ok) {
      await res.text().catch(() => undefined);
      return reply.status(res.status).send({ error: 'GitHub API error' });
    }

    const data = await res.json();
    return {
      users: (data.items || []).map((u: { login: string; avatar_url: string; html_url: string; id: number }) => ({
        login: u.login,
        avatar_url: u.avatar_url,
        html_url: u.html_url,
        github_id: u.id,
      })),
    };
  });

  // Get repo file tree
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { projectId?: string };
  }>('/github/:owner/:repo/tree', async (request, reply) => {
    if (!isInternalRequest(request.headers)) {
      const access = await requireGitHubProjectAccess(request.headers.authorization, request.query.projectId);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });
    }

    const { owner, repo } = request.params;
    const token = (request.headers['x-github-token'] as string | undefined) || process.env.GITHUB_TOKEN;

    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Odyssey-App',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    // Get default branch first
    const infoRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers },
    );
    if (!infoRes.ok) return reply.status(infoRes.status).send({ error: 'Repo not found' });
    const info = await infoRes.json() as { default_branch: string };

    const treeRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${info.default_branch}?recursive=1`,
      { headers },
    );
    if (!treeRes.ok) return reply.status(treeRes.status).send({ error: 'Tree fetch failed' });
    const treeData = await treeRes.json() as { tree: { path: string; type: string; size?: number }[]; truncated?: boolean };

    return {
      branch: info.default_branch,
      truncated: !!treeData.truncated,
      files: treeData.tree
        .filter((f) => f.type === 'blob')
        .map((f) => ({ path: f.path, size: f.size ?? 0 })),
    };
  });

  // Get recent commits (for AI repo scan)
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { per_page?: string; projectId?: string };
  }>('/github/:owner/:repo/recent', async (request, reply) => {
    if (!isInternalRequest(request.headers)) {
      const access = await requireGitHubProjectAccess(request.headers.authorization, request.query.projectId);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });
    }

    const { owner, repo } = request.params;
    const token = (request.headers['x-github-token'] as string | undefined) || process.env.GITHUB_TOKEN;

    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }

    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Odyssey-App',
    };
    if (token) ghHeaders.Authorization = `Bearer ${token}`;

    // Fetch commits + README in parallel
    const [commitsRes, readmeRes] = await Promise.all([
      fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=30`,
        { headers: ghHeaders },
      ),
      fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
        { headers: ghHeaders },
      ),
    ]);

    const commits = commitsRes.ok ? await commitsRes.json() : [];
    let readme = '';
    if (readmeRes.ok) {
      const readmeData = await readmeRes.json();
      if (readmeData.content) {
        readme = Buffer.from(readmeData.content, 'base64').toString('utf-8').slice(0, 3000);
      }
    }

    const commitSummaries = (commits as GitHubCommit[])
      .filter((c) => !isGeneratedThesisLatexCommitMessage(c.commit.message))
      .slice(0, 30)
      .map((c) => `[${c.commit.author.date}] ${c.commit.message.split('\n')[0]}`);

    return { commits: commitSummaries, readme };
  });

  // Fetch raw file content
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { path: string; projectId?: string };
  }>('/github/:owner/:repo/file', async (request, reply) => {
    if (!isInternalRequest(request.headers)) {
      const access = await requireGitHubProjectAccess(request.headers.authorization, request.query.projectId);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });
    }

    const { owner, repo } = request.params;
    const { path } = request.query;
    const token = (request.headers['x-github-token'] as string | undefined) || process.env.GITHUB_TOKEN;

    if (!path) return reply.status(400).send({ error: 'path required' });
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Odyssey-App',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      { headers },
    );
    if (!res.ok) return reply.status(res.status).send({ error: 'File not found' });

    const data = await res.json() as { content?: string; encoding?: string; size?: number; name?: string };
    if (!data.content || data.encoding !== 'base64') {
      return reply.status(422).send({ error: 'Cannot decode file content' });
    }

    // Cap at 500 KB to avoid flooding the client
    if ((data.size ?? 0) > 512_000) {
      return reply.status(413).send({ error: 'File too large to preview (>512 KB)' });
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { content, name: data.name ?? path.split('/').pop() };
  });
}
