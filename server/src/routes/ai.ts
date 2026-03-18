import type { FastifyInstance } from 'fastify';
import { chat, getAvailableProviders, type AIProvider } from '../ai-providers.js';
import { supabase } from '../lib/supabase.js';

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
        maxTokens: 1024,
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
        maxTokens: 512,
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
        maxTokens: 1200,
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
        maxTokens: 1024,
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

  // ── Analyze a document (OneNote page, OneDrive file, etc.) ──────────────
  interface AnalyzeDocumentBody {
    agent?: string;
    title: string;
    content: string;        // Plain text content of the document
    projectName?: string;   // Optional project context
  }

  server.post<{ Body: AnalyzeDocumentBody }>('/ai/analyze-document', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { title, content, projectName } = request.body;

    if (!title || !content) {
      return reply.status(400).send({ error: 'title and content are required' });
    }

    // Cap input to keep within token budget (~8k chars ≈ 2k tokens)
    const truncated = content.slice(0, 8000);

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's document intelligence engine. Analyze documents and extract structured insights for a project management context. Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with exactly four keys:
- "summary": A 2-3 sentence summary of what the document is about.
- "keyPoints": An array of 4-6 strings, each a key insight or important point from the document.
- "actionItems": An array of 0-5 strings, each a concrete action item or task mentioned or implied by the document.
- "projectRelevance": A 1-2 sentence note on how this document could inform project decisions or progress.`,
        user: `Document Title: ${title}
${projectName ? `Project Context: ${projectName}\n` : ''}
Document Content:
${truncated}

Analyze this document and extract structured insights.`,
        maxTokens: 1024,
      });

      const parsed = JSON.parse(result.text);
      return {
        summary: parsed.summary || '',
        keyPoints: parsed.keyPoints || [],
        actionItems: parsed.actionItems || [],
        projectRelevance: parsed.projectRelevance || '',
        provider: result.provider,
      };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to analyze document' });
    }
  });

  // ── Analyze office files → update goal progress ───────────────────────────
  interface OfficeProgressBody {
    agent?: string;
    projectId: string;
  }

  server.post<{ Body: OfficeProgressBody }>('/ai/analyze-office-progress', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId } = request.body;

    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    // Fetch goals + onenote/onedrive events
    const [{ data: goals }, { data: events }, { data: project }] = await Promise.all([
      supabase.from('goals').select('id, title, status, progress, deadline, category, assigned_to').eq('project_id', projectId),
      supabase
        .from('events')
        .select('id, source, event_type, title, summary, metadata, occurred_at, created_by')
        .eq('project_id', projectId)
        .in('source', ['onenote', 'onedrive', 'local'])
        .order('occurred_at', { ascending: false }),
      supabase.from('projects').select('name').eq('id', projectId).single(),
    ]);

    if (!goals?.length) return reply.status(400).send({ error: 'No goals found for this project' });
    if (!events?.length) return reply.status(400).send({ error: 'No imported Office documents found. Import some OneNote pages or OneDrive files first.' });

    // Build document context — include content previews from metadata
    const docsContext = events.map((e) => {
      const meta = e.metadata as { content_preview?: string; modified_by?: string; last_modified?: string; author?: string } | null;
      const modifiedBy = meta?.modified_by ?? meta?.author ?? (e.created_by ? `User ${e.created_by}` : 'Unknown');
      const modifiedAt = meta?.last_modified ?? e.occurred_at;
      let doc = `Document: "${e.title ?? '(untitled)'}"\n`;
      doc += `  Source: ${e.source} | Imported: ${new Date(e.occurred_at).toLocaleDateString()} | Modified by: ${modifiedBy} | Modified at: ${new Date(modifiedAt).toLocaleDateString()}\n`;
      if (e.summary) doc += `  Summary: ${e.summary}\n`;
      if (meta?.content_preview) doc += `  Content: ${meta.content_preview.slice(0, 1200)}\n`;
      return doc;
    }).join('\n---\n');

    const goalsContext = goals.map((g) =>
      `Goal ID: ${g.id}\n  Title: "${g.title}"\n  Status: ${g.status} | Progress: ${g.progress}%${g.deadline ? ` | Deadline: ${g.deadline}` : ''}${g.category ? ` | Category: ${g.category}` : ''}${g.assigned_to ? ` | Assigned to: ${g.assigned_to}` : ''}`
    ).join('\n\n');

    try {
      const result = await chat(provider, {
        system: `You are an AI progress tracker for a project management platform. Analyze imported documents (from OneNote and OneDrive) to determine which project goals they represent progress on, estimate completion percentages, and identify who did the work based on document metadata.

Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with two keys:
- "updates": Array of goal progress updates. Each item must have:
  - "goalId": string (exact goal ID from the input)
  - "progress": number 0–100 (estimated completion %)
  - "status": "active" | "complete" | "at_risk" (infer from content)
  - "completedBy": string or null (person who contributed most, from document metadata)
  - "evidence": string (1-2 sentence explanation of what document content indicates this progress)
  - "lastActivityDate": string ISO date (when this work occurred, from doc modification dates)
- "summary": string (2-3 sentences summarizing what the documents collectively reveal about team progress)

Rules:
- Only include goals that clearly relate to the document content
- Use document modification history (modified_by, last_modified) to determine who did the work
- Be conservative: only mark goals as "complete" if documents strongly indicate all work is done
- If a document shows partial work, estimate a realistic percentage
- If multiple documents relate to the same goal, synthesize them together
- "at_risk" means the work seems stalled, overdue, or has blockers mentioned`,
        user: `Project: ${project?.name ?? 'Unknown'}

GOALS TO EVALUATE:
${goalsContext}

IMPORTED OFFICE DOCUMENTS:
${docsContext}

Analyze which goals these documents show progress on, who did the work, and when.`,
        maxTokens: 2000,
      });

      const parsed = JSON.parse(result.text);
      const updates = parsed.updates ?? [];

      // Apply goal updates to DB
      const applied: string[] = [];
      for (const u of updates) {
        const goal = goals.find((g) => g.id === u.goalId);
        if (!goal) continue;
        const newProgress = Math.min(100, Math.max(0, Math.round(u.progress)));
        // Only update if AI suggests meaningful change or status change
        if (newProgress !== goal.progress || u.status !== goal.status) {
          await supabase.from('goals').update({
            progress: newProgress,
            status: u.status,
            updated_at: new Date().toISOString(),
          }).eq('id', u.goalId);
          applied.push(u.goalId);

          // Log an event for the progress update
          await supabase.from('events').insert({
            project_id: projectId,
            source: 'ai',
            event_type: 'goal_progress_updated',
            title: `AI updated goal: "${goal.title}" → ${newProgress}%`,
            summary: u.evidence,
            metadata: {
              goal_id: u.goalId,
              old_progress: goal.progress,
              new_progress: newProgress,
              completed_by: u.completedBy ?? null,
              last_activity_date: u.lastActivityDate ?? null,
              analyzed_by: provider,
            },
            occurred_at: new Date().toISOString(),
          });
        }
      }

      return {
        updates,
        applied: applied.length,
        summary: parsed.summary ?? '',
        provider: result.provider,
      };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed to analyze office progress';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Project chat: multi-turn conversation with full project context ────────
  interface ChatBody {
    agent?: string;
    projectId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }

  server.post<{ Body: ChatBody }>('/ai/chat', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId, messages } = request.body;

    if (!projectId || !messages?.length) {
      return reply.status(400).send({ error: 'projectId and messages are required' });
    }

    // Gather project context from DB
    const [{ data: project }, { data: goals }, { data: events }, { data: gitlabInteg }] = await Promise.all([
      supabase.from('projects').select('name, description, github_repo').eq('id', projectId).single(),
      supabase.from('goals').select('title, status, progress, deadline, category, assigned_to').eq('project_id', projectId),
      supabase.from('events').select('source, event_type, title, summary, metadata, occurred_at').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(40),
      supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').single(),
    ]);

    // Format goals
    const goalsSummary = (goals ?? [])
      .map((g) => `- [${g.status.toUpperCase()}] ${g.title} — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}${g.category ? ` [${g.category}]` : ''}`)
      .join('\n') || 'No goals set';

    // Format events — include MS document previews
    const eventsSummary = (events ?? [])
      .map((e) => {
        let line = `[${new Date(e.occurred_at).toLocaleDateString()}] ${e.source}/${e.event_type}: ${e.title ?? '(untitled)'}`;
        if (e.summary) line += `\n  Summary: ${e.summary}`;
        if (e.source === 'onenote' || e.source === 'onedrive' || e.source === 'local') {
          const meta = e.metadata as { content_preview?: string } | null;
          if (meta?.content_preview) line += `\n  Document Content: ${meta.content_preview.slice(0, 800)}`;
        }
        return line;
      })
      .join('\n\n') || 'No activity recorded yet';

    // Optional: fetch GitHub commits + README if repo is linked
    let githubContext = '';
    if (project?.github_repo) {
      try {
        const [owner, repo] = project.github_repo.split('/');
        const recentRes = await fetch(
          `http://localhost:${process.env.PORT ?? 3001}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent`,
        );
        if (recentRes.ok) {
          const rd = await recentRes.json() as { commits?: string[]; readme?: string };
          if (rd.commits?.length) githubContext += `\nGitHub — Recent commits:\n${rd.commits.slice(0, 15).join('\n')}`;
          if (rd.readme) githubContext += `\n\nGitHub README (excerpt):\n${rd.readme.slice(0, 1500)}`;
        }
      } catch { /* best-effort */ }
    }

    // Optional: fetch GitLab commits + README if a GitLab repo is linked
    let gitlabContext = '';
    if (gitlabInteg?.config) {
      const cfg = gitlabInteg.config as { repo?: string; host?: string };
      if (cfg.repo) {
        try {
          const glRes = await fetch(
            `http://localhost:${process.env.PORT ?? 3001}/api/gitlab/recent?repo=${encodeURIComponent(cfg.repo)}`,
          );
          if (glRes.ok) {
            const rd = await glRes.json() as { commits?: string[]; readme?: string };
            if (rd.commits?.length) gitlabContext += `\nGitLab (${cfg.host ?? 'self-hosted'}) — Recent commits:\n${rd.commits.slice(0, 15).join('\n')}`;
            if (rd.readme) gitlabContext += `\n\nGitLab README (excerpt):\n${rd.readme.slice(0, 1500)}`;
          }
        } catch { /* best-effort */ }
      }
    }

    const completedCount = (goals ?? []).filter((g) => g.status === 'complete').length;
    const atRiskCount = (goals ?? []).filter((g) => g.status === 'at_risk').length;

    const systemPrompt = `You are an AI assistant embedded in Odyssey, a project intelligence platform. You have full real-time context about this project and can answer questions, analyze progress, review documents, and give recommendations.

PROJECT: ${project?.name ?? 'Unknown'}${project?.description ? `\nDescription: ${project.description}` : ''}${project?.github_repo ? `\nGitHub Repository: github.com/${project.github_repo}` : ''}

GOALS SUMMARY: ${(goals ?? []).length} total — ${completedCount} complete, ${atRiskCount} at risk
${goalsSummary}

RECENT ACTIVITY & IMPORTED DOCUMENTS (newest first):
${eventsSummary}${githubContext ? `\n\nGITHUB DATA:\n${githubContext}` : ''}${gitlabContext ? `\n\nGITLAB DATA:\n${gitlabContext}` : ''}

INSTRUCTIONS:
- Be specific and always reference actual project data in your answers
- When discussing goals, mention their exact status and progress %
- When discussing documents, reference their actual content
- Keep responses concise but thorough
- If asked something you don't have data for, say so clearly
- You can suggest creating goals, importing documents, or other Odyssey actions`;

    // Build conversation — keep last 20 messages for token budget
    const history = messages.slice(-20);
    const lastUserMessage = history[history.length - 1]?.content ?? '';

    // Build conversation transcript for context (everything except the last user message)
    const transcript = history.slice(0, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const userContent = transcript
      ? `${transcript}\n\nUser: ${lastUserMessage}`
      : lastUserMessage;

    try {
      const result = await chat(provider, {
        system: systemPrompt,
        user: userContent,
        maxTokens: 1500,
      });
      return { message: result.text, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      if (msg.includes('rate') || msg.includes('429')) return reply.status(429).send({ error: 'Rate limit — try again shortly.' });
      return reply.status(500).send({ error: msg });
    }
  });
}
