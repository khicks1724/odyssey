import type { FastifyInstance } from 'fastify';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface AISummarizeBody {
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
  server.post<{ Body: AISummarizeBody }>('/ai/summarize', async (request, reply) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return reply.status(503).send({
        error: 'AI not configured',
        message: 'Set ANTHROPIC_API_KEY to enable AI features',
      });
    }

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
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: systemPrompts[queryType] || systemPrompts.activity_summary,
          messages: [{ role: 'user', content: userContent }],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        server.log.error(`Anthropic API error: ${response.status} ${errorBody}`);
        return reply.status(502).send({ error: 'AI service error' });
      }

      const result = await response.json();
      const content = result.content?.[0]?.text || 'No response generated';

      return {
        summary: content,
        queryType,
        tokens: {
          input: result.usage?.input_tokens,
          output: result.usage?.output_tokens,
        },
      };
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate AI summary' });
    }
  });
}
