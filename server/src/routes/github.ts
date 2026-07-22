import type { FastifyInstance } from 'fastify';
import { getUserFromAuthHeader, isInternalRequest, requireProjectAccessFromAuthHeader } from '../lib/request-auth.js';
import { isGeneratedThesisLatexCommitMessage } from '../lib/activity-filters.js';
import { buildCommitDiffPayload } from '../lib/commit-diff.js';
import { getGitHubRepos } from '../lib/github.js';
import { supabase } from '../lib/supabase.js';
import { getStoredGitHubTokenForUser } from './user-github-token.js';

async function getUserGitHubToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.slice(7));
  if (userError || !user) return null;
  return (await getStoredGitHubTokenForUser(user.id))?.token ?? null;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  html_url: string;
  author?: { login: string; avatar_url: string } | null;
}

interface GitHubCommitDetails extends GitHubCommit {
  stats?: { additions?: number; deletions?: number; total?: number };
  files?: Array<{
    filename: string;
    previous_filename?: string;
    status?: string;
    additions?: number;
    deletions?: number;
    changes?: number;
    patch?: string;
  }>;
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
    const token = (request.headers['x-github-token'] as string | undefined) || await getUserGitHubToken(request.headers.authorization) || process.env.GITHUB_TOKEN;

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
    const token = (request.headers['x-github-token'] as string | undefined) || await getUserGitHubToken(request.headers.authorization) || process.env.GITHUB_TOKEN;

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
    const token = (request.headers['x-github-token'] as string | undefined) || await getUserGitHubToken(request.headers.authorization) || process.env.GITHUB_TOKEN;

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
    const token = (request.headers['x-github-token'] as string | undefined) || await getUserGitHubToken(request.headers.authorization) || process.env.GITHUB_TOKEN;

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
    const token = (request.headers['x-github-token'] as string | undefined) || await getUserGitHubToken(request.headers.authorization) || process.env.GITHUB_TOKEN;

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

    const visibleCommits = (commits as GitHubCommit[])
      .filter((c) => !isGeneratedThesisLatexCommitMessage(c.commit.message))
      .slice(0, 30);
    const commitSummaries = visibleCommits
      .map((c) => `[${c.commit.author.date}] ${c.commit.message.split('\n')[0]}`);
    const commitDetails = visibleCommits.map((c) => ({
      sha: c.sha,
      date: c.commit.author.date,
      message: c.commit.message.split('\n')[0],
      author: c.commit.author.name || c.author?.login || 'Unknown author',
      url: c.html_url,
    }));

    return { commits: commitSummaries, commitDetails, readme };
  });

  // Fetch a single commit's file patches without exposing the connected token.
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { projectId?: string; sha?: string };
  }>('/github/:owner/:repo/commit-diff', async (request, reply) => {
    const projectId = request.query.projectId?.trim();
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
    if (!isInternalRequest(request.headers)) {
      const access = await requireGitHubProjectAccess(request.headers.authorization, projectId);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });
    }

    const { owner, repo } = request.params;
    const sha = request.query.sha?.trim() ?? '';
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
      return reply.status(400).send({ error: 'A valid commit SHA is required' });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('github_repo, github_repos')
      .eq('id', projectId)
      .maybeSingle();
    if (projectError) return reply.status(500).send({ error: 'Unable to verify the linked repository' });
    const requestedRepo = `${owner}/${repo}`.toLowerCase();
    const linked = getGitHubRepos(project).some((value) => value.toLowerCase() === requestedRepo);
    if (!linked) return reply.status(403).send({ error: 'This repository is not linked to the project' });

    const token = (request.headers['x-github-token'] as string | undefined)
      || await getUserGitHubToken(request.headers.authorization)
      || process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Odyssey-App',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}?per_page=100`,
      { headers },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      return reply.status(response.status).send({
        error: body?.message?.trim() || `GitHub could not load this commit (${response.status})`,
      });
    }

    const commit = await response.json() as GitHubCommitDetails;
    const files = (commit.files ?? []).map((file) => ({
      oldPath: file.previous_filename ?? file.filename,
      newPath: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch ?? null,
      binary: !file.patch
        && (file.additions ?? 0) === 0
        && (file.deletions ?? 0) === 0
        && (file.changes ?? 0) > 0,
    }));
    const payload = buildCommitDiffPayload(files, {
      reportedFileCount: files.length,
      additions: commit.stats?.additions,
      deletions: commit.stats?.deletions,
      truncated: response.headers.get('link')?.includes('rel="next"'),
    });

    return {
      ...payload,
      commit: {
        sha: commit.sha,
        message: commit.commit.message.split('\n')[0],
        author: commit.commit.author.name || commit.author?.login || 'Unknown author',
        date: commit.commit.author.date,
        url: commit.html_url,
      },
    };
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
    const token = (request.headers['x-github-token'] as string | undefined) || await getUserGitHubToken(request.headers.authorization) || process.env.GITHUB_TOKEN;

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
