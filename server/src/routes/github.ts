import type { FastifyInstance } from 'fastify';

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  html_url: string;
  author?: { login: string; avatar_url: string } | null;
}

export async function githubRoutes(server: FastifyInstance) {
  // Fetch recent commits for a repo
  server.get<{
    Params: { owner: string; repo: string };
    Querystring: { per_page?: string };
  }>('/github/:owner/:repo/commits', async (request, reply) => {
    const { owner, repo } = request.params;
    const perPage = Math.min(100, Number(request.query.per_page) || 30);
    const token = request.headers['x-github-token'] as string;

    if (!token) {
      return reply.status(401).send({ error: 'GitHub token required' });
    }

    // Validate owner/repo format to prevent injection
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }

    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${perPage}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Odyssey-App',
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      return reply.status(res.status).send({ error: 'GitHub API error', details: body });
    }

    const commits: GitHubCommit[] = await res.json();

    // Normalize to Odyssey event format
    const events = commits.map((c) => ({
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
  }>('/github/:owner/:repo', async (request, reply) => {
    const { owner, repo } = request.params;
    const token = request.headers['x-github-token'] as string;

    if (!token) {
      return reply.status(401).send({ error: 'GitHub token required' });
    }

    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      return reply.status(400).send({ error: 'Invalid owner or repo name' });
    }

    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Odyssey-App',
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      return reply.status(res.status).send({ error: 'GitHub API error', details: body });
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
}
