import type { FastifyInstance } from 'fastify';
import { chat, getAvailableProviders, type AIProvider } from '../ai-providers.js';

function resolveProvider(body: { agent?: string }): AIProvider {
  const agent = body.agent as AIProvider | undefined;
  if (agent && ['claude-sonnet', 'gpt-4o', 'gemini-pro'].includes(agent)) return agent;
  return 'claude-sonnet';
}

interface AISummarizeBody {
  agent?: string;
  projectName: string;
  events: {
    source: string;
    event_type: string;
    title: string;
    summary?: string;
    occurred_at: string;
    metadata?: Record<string, unknown>;
  }[];
  goals?: {
    title: string;
    status: string;
    progress: number;
    deadline?: string;
  }[];
  queryType: 'activity_summary' | 'deadline_risk' | 'contribution' | 'project_history';
  userQuestion?: string;
}

const systemPrompts: Record<string, string> = {
  activity_summary: `You are Odyssey's AI intelligence layer. Summarize recent project activity concisely. Focus on:
- Key developments and progress
- Notable patterns or changes in velocity
- Areas of high/low activity
Keep your response under 200 words. Use a professional, direct tone.`,

  deadline_risk: `You are Odyssey's deadline risk analyzer. Evaluate whether the project is on track for its goals. Consider:
- Current progress vs. deadline proximity
- Recent activity velocity
- Goal completion rates
Rate risk as: ON TRACK, AT RISK, or BEHIND SCHEDULE. Explain why in 2-3 sentences.`,

  contribution: `You are Odyssey's contribution analyst. Map who contributed what based on the event data. Focus on:
- Which areas each contributor focused on
- Volume and frequency of contributions
- Key accomplishments per contributor
Be factual and data-driven.`,

  project_history: `You are Odyssey's project historian. Tell the story of how this project evolved based on the event timeline. Focus on:
- Major milestones and turning points
- How different workstreams came together
- The overall arc of development
Write as a narrative, under 300 words.`,
};

export async function aiRoutes(server: FastifyInstance) {
  // ── Available providers endpoint ──
  server.get('/ai/providers', async () => {
    return { providers: getAvailableProviders() };
  });

  server.post<{ Body: AISummarizeBody }>('/ai/summarize', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectName, events, goals, queryType, userQuestion } = request.body;

    if (!projectName || !events || !queryType) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    // Build context within 4000 token budget (~16000 chars)
    const eventsSummary = events
      .slice(0, 20)
      .map((e) => `[${e.occurred_at}] ${e.source}/${e.event_type}: ${e.title}`)
      .join('\n');

    const goalsSummary = goals
      ? goals
          .map((g) => `- ${g.title} (${g.status}, ${g.progress}%${g.deadline ? `, due: ${g.deadline}` : ''})`)
          .join('\n')
      : 'No goals set';

    const userContent = `Project: ${projectName}

Recent Events (newest first):
${eventsSummary || 'No events yet'}

Goals:
${goalsSummary}

${userQuestion ? `User Question: ${userQuestion}` : `Provide a ${queryType.replace('_', ' ')} analysis.`}`;

    try {
      const result = await chat(provider, {
        system: systemPrompts[queryType] || systemPrompts.activity_summary,
        user: userContent,
        maxTokens: 500,
      });

      return {
        summary: result.text,
        queryType,
        provider: result.provider,
      };
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate AI summary' });
    }
  });

  // ── Categorize goals into topic categories ──
  interface CategorizeBody {
    agent?: string;
    projectName: string;
    goals: { id: string; title: string; status: string }[];
    categories: string[];
  }

  server.post<{ Body: CategorizeBody }>('/ai/categorize', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectName, goals, categories } = request.body;

    if (!goals || !categories || goals.length === 0) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const goalsList = goals.map((g) => `- ID: ${g.id} | Title: "${g.title}" | Status: ${g.status}`).join('\n');

    try {
      const result = await chat(provider, {
        system: `You categorize project goals into topic categories. Respond ONLY with valid JSON — no markdown, no explanation. The JSON should be an object mapping goal IDs to category names.`,
        user: `Project: ${projectName}\n\nGoals:\n${goalsList}\n\nAvailable categories: ${categories.join(', ')}\n\nAssign each goal to the single most relevant category. Return JSON like: {"goal-id-1": "Category", "goal-id-2": "Category"}`,
        maxTokens: 300,
      });

      const parsed = JSON.parse(result.text);
      return { categories: parsed, provider: result.provider };
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to categorize goals' });
    }
  });

  // ── Scan repo to evaluate goals and suggest new ones ──
  interface RepoScanBody {
    agent?: string;
    projectName: string;
    goals: { id: string; title: string; status: string; progress: number }[];
    commits: string[];
    readme: string;
  }

  server.post<{ Body: RepoScanBody }>('/ai/repo-scan', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectName, goals, commits, readme } = request.body;

    if (!projectName || !goals) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const goalsList = goals.map((g) =>
      `- [${g.id}] "${g.title}" — status: ${g.status}, progress: ${g.progress}%`
    ).join('\n');

    const commitsList = (commits || []).slice(0, 30).join('\n');

    try {
      const result = await chat(provider, {
        system: `You analyze GitHub repositories to evaluate project goals. Respond ONLY with valid JSON — no markdown, no explanation.

Return an object with two keys:
- "completed": array of goal IDs that appear to be fully completed based on recent commits and the README
- "suggested": array of objects with "title" and "reason" for new goals the project should consider based on what you see in the codebase

Be conservative: only mark goals as completed if the commits clearly show the work is done.
Suggest 2-4 practical, specific goals based on gaps or next steps visible in the code.`,
        user: `Project: ${projectName}

Current Goals:
${goalsList || 'No goals set yet'}

Recent Commits:
${commitsList || 'No commits available'}

README (excerpt):
${readme || 'No README found'}

Analyze which goals are completed and suggest new goals.`,
        maxTokens: 800,
      });

      const parsed = JSON.parse(result.text);
      return {
        completed: parsed.completed || [],
        suggested: parsed.suggested || [],
        provider: result.provider,
      };
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to scan repo' });
    }
  });

  // ── Project insights: status, next steps, future features ──
  interface ProjectInsightsBody {
    agent?: string;
    projectName: string;
    projectDescription?: string;
    githubRepo?: string;
    goals: { title: string; status: string; progress: number; deadline?: string }[];
    commits?: string[];
    readme?: string;
  }

  server.post<{ Body: ProjectInsightsBody }>('/ai/project-insights', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectName, projectDescription, githubRepo, goals, commits, readme } = request.body;

    if (!projectName) {
      return reply.status(400).send({ error: 'Missing project name' });
    }

    const goalsList = (goals || [])
      .map((g) => `- "${g.title}" — ${g.status}, ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}`)
      .join('\n');

    const commitsList = (commits || []).slice(0, 20).join('\n');

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's project intelligence engine. Provide a structured analysis. Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with exactly three keys:
- "status": A 2-3 sentence assessment of the project's current state and health.
- "nextSteps": An array of 3-4 strings, each a specific actionable task the team should focus on next based on goals and recent work.
- "futureFeatures": An array of 3-4 strings, each a suggested future feature or enhancement that would add value to the project.

Be specific, practical, and grounded in the actual project data provided. Do not be generic.`,
        user: `Project: ${projectName}
${projectDescription ? `Description: ${projectDescription}` : ''}
${githubRepo ? `Repository: github.com/${githubRepo}` : ''}

Goals:
${goalsList || 'No goals set yet'}

${commitsList ? `Recent Commits:\n${commitsList}` : ''}

${readme ? `README (excerpt):\n${readme.slice(0, 2000)}` : ''}

Analyze this project and provide insights.`,
        maxTokens: 600,
      });

      const parsed = JSON.parse(result.text);
      return {
        status: parsed.status || '',
        nextSteps: parsed.nextSteps || [],
        futureFeatures: parsed.futureFeatures || [],
        provider: result.provider,
      };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message || 'Failed to generate insights';
      if (msg.includes('credit balance') || msg.includes('billing')) {
        return reply.status(402).send({ error: 'API key has no credits. Switch to a different AI model or add billing.' });
      }
      if (msg.includes('quota') || msg.includes('429') || msg.includes('rate limit') || err?.status === 429) {
        return reply.status(429).send({ error: 'Rate limit hit — wait a minute and try again, or switch to a different model.' });
      }
      return reply.status(500).send({ error: msg });
    }
  });
}
