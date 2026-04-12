import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { isGeneratedThesisLatexCommitMessage } from '../lib/activity-filters.js';
import { checkRateLimit } from '../lib/rate-limit.js';

// Map GitHub event types + actions to Odyssey event_type
type OdysseyEventType = 'commit' | 'message' | 'file_edit' | 'note' | 'meeting';
type OdysseySource = 'github';

interface NormalizedEvent {
  source: OdysseySource;
  event_type: OdysseyEventType;
  title: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

function normalizeGitHubEvent(
  githubEvent: string,
  payload: Record<string, unknown>,
): NormalizedEvent[] {
  const repo = (payload.repository as { full_name?: string })?.full_name ?? '';

  switch (githubEvent) {
    case 'push': {
      const commits = (payload.commits as {
        id: string;
        message: string;
        timestamp: string;
        author?: { name?: string; username?: string };
        url?: string;
      }[]) ?? [];
      const pusher = (payload.pusher as { name?: string })?.name ?? 'unknown';
      return commits
        .filter((commit) => !isGeneratedThesisLatexCommitMessage(commit.message))
        .map((c) => ({
        source: 'github',
        event_type: 'commit',
        title: c.message.split('\n')[0].slice(0, 255),
        summary: c.message,
        metadata: {
          sha: c.id,
          url: c.url,
          author_name: c.author?.name ?? pusher,
          author_login: c.author?.username,
          repo,
        },
        occurred_at: c.timestamp ?? new Date().toISOString(),
      }));
    }

    case 'pull_request': {
      const pr = payload.pull_request as {
        title?: string;
        html_url?: string;
        number?: number;
        merged?: boolean;
        user?: { login?: string };
        created_at?: string;
        merged_at?: string;
        updated_at?: string;
      };
      const action = payload.action as string;
      const label =
        action === 'closed' && pr?.merged ? 'merged' : action;
      return [
        {
          source: 'github',
          event_type: 'note',
          title: `PR ${label}: ${pr?.title ?? ''}`.slice(0, 255),
          summary: null,
          metadata: {
            pr_number: pr?.number,
            url: pr?.html_url,
            author_login: pr?.user?.login,
            action,
            merged: pr?.merged ?? false,
            repo,
          },
          occurred_at: pr?.merged_at ?? pr?.updated_at ?? pr?.created_at ?? new Date().toISOString(),
        },
      ];
    }

    case 'issues': {
      const issue = payload.issue as {
        title?: string;
        html_url?: string;
        number?: number;
        user?: { login?: string };
        created_at?: string;
        updated_at?: string;
      };
      const action = payload.action as string;
      return [
        {
          source: 'github',
          event_type: 'note',
          title: `Issue ${action}: ${issue?.title ?? ''}`.slice(0, 255),
          summary: null,
          metadata: {
            issue_number: issue?.number,
            url: issue?.html_url,
            author_login: issue?.user?.login,
            action,
            repo,
          },
          occurred_at: issue?.updated_at ?? issue?.created_at ?? new Date().toISOString(),
        },
      ];
    }

    case 'issue_comment': {
      const issue = payload.issue as { title?: string; number?: number; html_url?: string };
      const comment = payload.comment as {
        body?: string;
        user?: { login?: string };
        created_at?: string;
        html_url?: string;
      };
      return [
        {
          source: 'github',
          event_type: 'note',
          title: `Comment on #${issue?.number}: ${issue?.title ?? ''}`.slice(0, 255),
          summary: (comment?.body ?? '').slice(0, 500),
          metadata: {
            url: comment?.html_url ?? issue?.html_url,
            author_login: comment?.user?.login,
            repo,
          },
          occurred_at: comment?.created_at ?? new Date().toISOString(),
        },
      ];
    }

    case 'create':
    case 'delete': {
      const refType = payload.ref_type as string;
      const ref = payload.ref as string;
      const sender = (payload.sender as { login?: string })?.login ?? 'unknown';
      return [
        {
          source: 'github',
          event_type: 'note',
          title: `${githubEvent === 'create' ? 'Created' : 'Deleted'} ${refType}: ${ref}`.slice(0, 255),
          summary: null,
          metadata: { ref_type: refType, ref, sender, repo },
          occurred_at: new Date().toISOString(),
        },
      ];
    }

    case 'release': {
      const release = payload.release as {
        tag_name?: string;
        name?: string;
        html_url?: string;
        published_at?: string;
        author?: { login?: string };
      };
      return [
        {
          source: 'github',
          event_type: 'note',
          title: `Release: ${release?.name ?? release?.tag_name ?? ''}`.slice(0, 255),
          summary: null,
          metadata: {
            tag: release?.tag_name,
            url: release?.html_url,
            author_login: release?.author?.login,
            repo,
          },
          occurred_at: release?.published_at ?? new Date().toISOString(),
        },
      ];
    }

    default:
      return [];
  }
}

export async function webhookRoutes(server: FastifyInstance) {
  server.post('/github', async (request: FastifyRequest, reply) => {
    const webhookLimit = checkRateLimit(`github-webhook:${request.ip}`, { maxRequests: 120, windowMs: 60_000 });
    if (webhookLimit.limited) {
      return reply.code(429).send({ error: 'Webhook rate limit exceeded' });
    }

    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    const githubEvent = request.headers['x-github-event'] as string | undefined;

    // Verify webhook signature
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      server.log.error('GITHUB_WEBHOOK_SECRET not set — rejecting webhook');
      return reply.code(503).send({ error: 'Webhook verification is not configured' });
    } else {
      if (!signature) {
        return reply.code(401).send({ error: 'Missing signature' });
      }
      const payload = JSON.stringify(request.body);
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(payload).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    if (!githubEvent) {
      return reply.code(400).send({ error: 'Missing X-GitHub-Event header' });
    }

    server.log.info({ event: githubEvent }, 'Received GitHub webhook');

    const body = request.body as Record<string, unknown>;

    // Find the project by matching any linked GitHub repo
    const repoFullName = (body.repository as { full_name?: string } | undefined)?.full_name;
    if (!repoFullName) {
      return { received: true, skipped: 'No repository info in payload' };
    }

    const { data: projects, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .or(`github_repo.eq.${repoFullName},github_repos.cs.{${repoFullName}}`)
      .limit(10);

    if (projectError) {
      server.log.error({ projectError }, 'Failed to look up project for webhook');
      return reply.code(500).send({ error: 'Database error' });
    }

    if (!projects || projects.length === 0) {
      server.log.info({ repo: repoFullName }, 'No project linked to this repo — ignoring webhook');
      return { received: true, skipped: 'No matching project' };
    }

    // Normalize the event
    const normalized = normalizeGitHubEvent(githubEvent, body);
    if (normalized.length === 0) {
      return { received: true, skipped: `Unhandled event type: ${githubEvent}` };
    }

    // Insert events for every linked project
    const rows = projects.flatMap((project) =>
      normalized.map((e) => ({ ...e, project_id: project.id })),
    );

    const { error: insertError } = await supabase.from('events').insert(rows);
    if (insertError) {
      server.log.error({ insertError }, 'Failed to insert webhook events');
      return reply.code(500).send({ error: 'Failed to store events' });
    }

    server.log.info(
      { event: githubEvent, projects: projects.length, rows: rows.length },
      'Webhook events stored',
    );

    return { received: true, stored: rows.length };
  });
}
