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

  // ── Commit history: aggregate commits from all linked GitHub + GitLab repos ──
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/commit-history', async (request, reply) => {
    const { projectId } = request.params;

    const [projectRes, gitlabRes] = await Promise.all([
      supabase.from('projects').select('github_repo').eq('id', projectId).single(),
      supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle(),
    ]);

    const githubRepo: string | null = projectRes.data?.github_repo ?? null;
    const gitlabCfg = gitlabRes.data?.config as { repos?: string[]; repo?: string; host?: string } | null;
    const gitlabRepos: string[] = gitlabCfg?.repos ?? (gitlabCfg?.repo ? [gitlabCfg.repo] : []);
    const gitlabHost: string = gitlabCfg?.host ?? process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';

    const countByDate = new Map<string, number>();
    // repoKey -> date -> count, for per-repo tooltip breakdown
    const repoBreakdown = new Map<string, Map<string, number>>();
    // Individual recent commits for the feed (author, message, date, repo, source)
    interface RecentCommit { sha: string; date: string; author: string; message: string; repo: string; source: 'github' | 'gitlab'; }
    const recentCommits: RecentCommit[] = [];

    function addCommit(repoKey: string, date: string) {
      countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
      if (!repoBreakdown.has(repoKey)) repoBreakdown.set(repoKey, new Map());
      const rm = repoBreakdown.get(repoKey)!;
      rm.set(date, (rm.get(date) ?? 0) + 1);
    }

    // 52-week lookback window
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 364);
    const sinceIso = oneYearAgo.toISOString();

    // GitHub commits — paginate until we've covered a full year
    if (githubRepo) {
      const [owner, repo] = githubRepo.split('/');
      const token = process.env.GITHUB_TOKEN;
      const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Odyssey-App' };
      if (token) ghHeaders.Authorization = `Bearer ${token}`;
      const repoKey = `github:${githubRepo}`;
      for (let page = 1; page <= 13; page++) {
        try {
          const r = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?since=${sinceIso}&per_page=100&page=${page}`,
            { headers: ghHeaders }
          );
          if (!r.ok) break;
          const commits: { sha: string; commit: { author: { name: string; date: string }; message: string } }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) {
            const date = c.commit.author.date.slice(0, 10);
            addCommit(repoKey, date);
            if (page === 1) {
              recentCommits.push({
                sha: c.sha.slice(0, 7),
                date: c.commit.author.date,
                author: c.commit.author.name,
                message: c.commit.message.split('\n')[0].slice(0, 80),
                repo: githubRepo,
                source: 'github',
              });
            }
          }
          if (commits.length < 100) break;
        } catch { break; }
      }
    }

    // GitLab commits — paginate with since filter, up to 13 pages per repo
    const gitlabToken = process.env.GITLAB_NPS_TOKEN;
    for (const repo of gitlabRepos) {
      const encoded = encodeURIComponent(repo);
      const repoKey = `gitlab:${repo}`;
      const repoLabel = repo.includes('/') ? repo.split('/').slice(-2).join('/') : repo;
      for (let page = 1; page <= 13; page++) {
        try {
          const r = await fetch(
            `${gitlabHost}/api/v4/projects/${encoded}/repository/commits?since=${sinceIso}&per_page=100&page=${page}&order_by=created_at&sort=desc`,
            { headers: gitlabToken ? { 'PRIVATE-TOKEN': gitlabToken } : {} }
          );
          if (!r.ok) break;
          const commits: { id: string; created_at: string; author_name: string; title: string }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) {
            addCommit(repoKey, c.created_at.slice(0, 10));
            if (page === 1) {
              recentCommits.push({
                sha: c.id.slice(0, 7),
                date: c.created_at,
                author: c.author_name,
                message: c.title.slice(0, 80),
                repo: repoLabel,
                source: 'gitlab',
              });
            }
          }
          if (commits.length < 100) break;
        } catch { break; }
      }
    }

    const commits = Array.from(countByDate.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Build per-repo breakdown: { repo, source, dateMap: { [date]: count } }
    const byRepo = Array.from(repoBreakdown.entries()).map(([repoKey, dateMap]) => {
      const colonIdx = repoKey.indexOf(':');
      return {
        source: repoKey.slice(0, colonIdx) as 'github' | 'gitlab',
        repo: repoKey.slice(colonIdx + 1),
        dateMap: Object.fromEntries(dateMap.entries()),
      };
    });

    // Sort recent commits by date desc, keep top 25
    recentCommits.sort((a, b) => b.date.localeCompare(a.date));
    const topRecent = recentCommits.slice(0, 25);

    return reply.send({ commits, byRepo, recentCommits: topRecent });
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
    projectId: string;
  }

  server.post<{ Body: ProjectInsightsBody }>('/ai/project-insights', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId is required' });
    }

    const ctx = await buildProjectContext(projectId);

    const codeBlock = [
      ctx.githubContext ? `GITHUB (commits + diffs + source):\n${ctx.githubContext.slice(0, 35_000)}` : '',
      ctx.gitlabContext ? `GITLAB (commits + diffs + source):\n${ctx.gitlabContext.slice(0, 35_000)}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's deep project intelligence engine. You have access to ACTUAL SOURCE CODE FILES and REAL COMMIT DIFFS — not just commit messages. Use them to give a technically grounded analysis.

Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with exactly four keys:
- "status": 3-4 sentences on the project's current health. Reference specific files, modules, or components you can see actively changing in the diffs. Note velocity trends.
- "nextSteps": Array of 4-6 strings. Each must be a specific, actionable task grounded in what you see in the code — reference actual file names, function names, or modules. No generic advice.
- "futureFeatures": Array of 3-5 strings. Suggest concrete features based on gaps you can identify in the current codebase structure and what the README/goals describe but the code doesn't yet implement.
- "codeInsights": Array of 4-6 strings. Deep technical observations: which modules are most actively developed (from diffs), code patterns you notice, potential technical debt, architectural observations, areas that look incomplete or missing tests, etc. Be specific — name files and patterns.`,
        user: `Project: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}

GOALS (${ctx.goals.length} total):
${ctx.goalsText}

RECENT ACTIVITY:
${ctx.eventsText.slice(0, 2000)}

${codeBlock}`,
        maxTokens: 3500,
      });

      let raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      // If the response was truncated mid-JSON, attempt to close it gracefully
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Trim to the last complete top-level key by finding the last valid closing
        const lastBrace = raw.lastIndexOf('}');
        if (lastBrace > 0) raw = raw.slice(0, lastBrace + 1);
        parsed = JSON.parse(raw); // re-throw if still broken
      }
      return {
        status: parsed.status || '',
        nextSteps: parsed.nextSteps || [],
        futureFeatures: parsed.futureFeatures || [],
        codeInsights: parsed.codeInsights || [],
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

  // ── Helper: gather full project context from DB + connected sources ─────────
  async function buildProjectContext(projectId: string) {
    const [
      { data: project },
      { data: goals },
      { data: events },
      { data: members },
      { data: gitlabInteg },
    ] = await Promise.all([
      supabase.from('projects').select('name, description, github_repo').eq('id', projectId).single(),
      supabase.from('goals').select('id, title, status, progress, deadline, category, assigned_to').eq('project_id', projectId),
      supabase.from('events').select('source, event_type, title, summary, metadata, occurred_at').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(50),
      supabase.from('project_members').select('user_id, role, profiles:user_id(display_name)').eq('project_id', projectId),
      supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle(),
    ]);

    // Goals with IDs for action proposals
    const goalsText = (goals ?? []).map((g) =>
      `- [ID:${g.id}] [${g.status.toUpperCase()}] "${g.title}" — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}${g.category ? ` [${g.category}]` : ''}${g.assigned_to ? ` assigned:${g.assigned_to}` : ''}`
    ).join('\n') || 'No goals set';

    const membersText = (members ?? []).map((m) => {
      const p = m.profiles as { display_name?: string | null } | null;
      return `- ${p?.display_name ?? m.user_id} (${m.role}) [user_id:${m.user_id}]`;
    }).join('\n') || 'No members';

    const eventsText = (events ?? []).map((e) => {
      let line = `[${new Date(e.occurred_at).toLocaleDateString()}] ${e.source}/${e.event_type}: ${e.title ?? '(untitled)'}`;
      if (e.summary) line += `\n  Summary: ${e.summary}`;
      const meta = e.metadata as { content_preview?: string } | null;
      if (meta?.content_preview) line += `\n  Content: ${meta.content_preview.slice(0, 600)}`;
      return line;
    }).join('\n\n') || 'No activity yet';

    // GitHub data — commits, README, code files, and recent commit diffs
    let githubContext = '';
    if (project?.github_repo) {
      const [owner, repo] = project.github_repo.split('/');
      const ghToken = process.env.GITHUB_TOKEN;
      const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Odyssey-App' };
      if (ghToken) ghHeaders.Authorization = `Bearer ${ghToken}`;
      const BASE = `http://localhost:${process.env.PORT ?? 3001}`;

      // 1. Commits + README
      try {
        const r = await fetch(`${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent`);
        if (r.ok) {
          const rd = await r.json() as { commits?: string[]; readme?: string };
          if (rd.commits?.length) githubContext += `GitHub commits:\n${rd.commits.slice(0, 20).join('\n')}`;
          if (rd.readme) githubContext += `\n\nREADME:\n${rd.readme.slice(0, 3000)}`;
        }
      } catch { /* best-effort */ }

      // 2. Recent commit diffs — what actually changed in the last 6 commits
      try {
        const commitsRes = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=8`,
          { headers: ghHeaders }
        );
        if (commitsRes.ok) {
          const commits: { sha: string; commit: { message: string } }[] = await commitsRes.json();
          const diffParts: string[] = [];
          for (const c of commits.slice(0, 6)) {
            try {
              const detailRes = await fetch(
                `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${c.sha}`,
                { headers: ghHeaders }
              );
              if (!detailRes.ok) continue;
              const detail: { files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[] } = await detailRes.json();
              const files = (detail.files ?? []).slice(0, 10).map((f) => {
                let line = `  [${f.status}] ${f.filename} (+${f.additions}/-${f.deletions})`;
                if (f.patch) line += `\n${f.patch.slice(0, 600)}`;
                return line;
              }).join('\n');
              diffParts.push(`── ${c.commit.message.split('\n')[0]}\n${files}`);
            } catch { /* skip single commit */ }
          }
          if (diffParts.length > 0) githubContext += `\n\nRECENT COMMIT DIFFS:\n${diffParts.join('\n\n')}`;
        }
      } catch { /* best-effort */ }

      // 3. Code file reading — full source like GitLab
      const CODE_EXTS_GH = new Set(['.py','.js','.ts','.jsx','.tsx','.json','.yaml','.yml','.md','.sh','.html','.css','.toml','.ini','.cfg','.rs','.go','.java','.c','.cpp','.h']);
      const ENTRY_NAMES_GH = new Set(['main.py','app.py','index.ts','index.js','server.ts','server.js','main.ts','main.js','__init__.py','manage.py','run.py','wsgi.py','asgi.py']);
      const CONFIG_NAMES_GH = new Set(['package.json','requirements.txt','pyproject.toml','setup.py','Makefile','Dockerfile','docker-compose.yml','tsconfig.json','vite.config.ts','go.mod','cargo.toml']);
      const tierGH = (f: { path: string }) => {
        const name = f.path.split('/').pop()!.toLowerCase();
        if (name.startsWith('readme')) return 1;
        if (ENTRY_NAMES_GH.has(name)) return 2;
        if (CONFIG_NAMES_GH.has(name)) return 3;
        if (f.path.toLowerCase().endsWith('.md')) return 1;
        return 4;
      };
      try {
        const treeRes = await fetch(`${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree`);
        if (treeRes.ok) {
          const treeData = await treeRes.json() as { files: { path: string; size: number }[] };
          const eligible = (treeData.files ?? []).filter((f) => {
            const ext = '.' + f.path.toLowerCase().split('.').pop()!;
            return CODE_EXTS_GH.has(ext) && f.size < 200_000;
          });
          eligible.sort((a, b) => tierGH(a) - tierGH(b));
          const GH_BUDGET = 20_000;
          let ghBytes = 0;
          const codeLines: string[] = [];
          for (const f of eligible) {
            if (ghBytes >= GH_BUDGET) break;
            const maxChars = tierGH(f) <= 1 ? 5000 : tierGH(f) === 2 ? 3000 : tierGH(f) === 3 ? 2000 : 1200;
            try {
              const fr = await fetch(`${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(f.path)}`);
              if (!fr.ok) continue;
              const fd = await fr.json() as { content?: string };
              if (!fd.content) continue;
              const snippet = fd.content.slice(0, maxChars);
              codeLines.push(`\n--- ${f.path} ---\n${snippet}${fd.content.length > maxChars ? '\n[truncated]' : ''}`);
              ghBytes += snippet.length;
            } catch { /* skip */ }
          }
          if (codeLines.length > 0) githubContext += `\n\nCODE FILES (${codeLines.length} files):\n${codeLines.join('\n')}`;
        }
      } catch { /* best-effort */ }
    }

    // GitLab data (multi-repo support) — commits + README + code files
    let gitlabContext = '';
    if (gitlabInteg?.config) {
      const cfg = gitlabInteg.config as { repos?: string[]; repo?: string; host?: string };
      const repos: string[] = cfg.repos ?? (cfg.repo ? [cfg.repo] : []);

      if (repos.length > 0) {
        const CODE_EXTS = new Set(['.py','.js','.ts','.jsx','.tsx','.json','.yaml','.yml','.md','.sh','.txt','.html','.css','.toml','.ini','.cfg','.rs','.go','.java','.c','.cpp','.h','.gitignore','.env.example']);
        const ENTRY_NAMES = new Set(['main.py','app.py','index.ts','index.js','server.ts','server.js','main.ts','main.js','__init__.py','manage.py','run.py','wsgi.py','asgi.py']);
        const CONFIG_NAMES = new Set(['package.json','requirements.txt','pyproject.toml','setup.py','setup.cfg','Makefile','Dockerfile','docker-compose.yml','docker-compose.yaml','tsconfig.json','vite.config.ts','vite.config.js','.env.example','CMakeLists.txt','cargo.toml','go.mod']);
        const BASE = `http://localhost:${process.env.PORT ?? 3001}`;
        const TOTAL_BUDGET = 60_000; // chars across all repos
        let totalCharsUsed = 0;

        const repoResults = await Promise.allSettled(repos.map(async (repo) => {
          const repoLabel = repos.length > 1 ? ` [${repo}]` : '';
          let repoCtx = '';

          // 1. Commits + README
          try {
            const r = await fetch(`${BASE}/api/gitlab/recent?repo=${encodeURIComponent(repo)}`);
            if (r.ok) {
              const rd = await r.json() as { commits?: string[]; readme?: string };
              if (rd.commits?.length) repoCtx += `GitLab${repoLabel} commits:\n${rd.commits.slice(0, 10).join('\n')}\n`;
              if (rd.readme) repoCtx += `\nREADME${repoLabel}:\n${rd.readme.slice(0, 4000)}\n`;
            }
          } catch { /* best-effort */ }

          // 1b. Recent commit diffs
          try {
            const gitlabToken = process.env.GITLAB_NPS_TOKEN;
            const gitlabHost = (gitlabInteg?.config as { host?: string } | null)?.host ?? process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';
            const encoded = encodeURIComponent(repo);
            const commitsRes = await fetch(
              `${gitlabHost}/api/v4/projects/${encoded}/repository/commits?per_page=6&order_by=created_at&sort=desc`,
              { headers: { 'PRIVATE-TOKEN': gitlabToken ?? '' } }
            );
            if (commitsRes.ok) {
              const commits: { id: string; title: string }[] = await commitsRes.json();
              const diffParts: string[] = [];
              for (const c of commits.slice(0, 6)) {
                try {
                  const diffRes = await fetch(
                    `${gitlabHost}/api/v4/projects/${encoded}/repository/commits/${c.id}/diff`,
                    { headers: { 'PRIVATE-TOKEN': gitlabToken ?? '' } }
                  );
                  if (!diffRes.ok) continue;
                  const diffs: { new_path: string; diff: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean }[] = await diffRes.json();
                  const files = diffs.slice(0, 10).map((d) => {
                    const status = d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified';
                    return `  [${status}] ${d.new_path}\n${(d.diff ?? '').slice(0, 600)}`;
                  }).join('\n');
                  diffParts.push(`── ${c.title}\n${files}`);
                } catch { /* skip */ }
              }
              if (diffParts.length > 0) repoCtx += `\nRECENT COMMIT DIFFS${repoLabel}:\n${diffParts.join('\n\n')}\n`;
            }
          } catch { /* best-effort */ }

          // 2. Code files — fetch tree then prioritized files
          try {
            const treeRes = await fetch(`${BASE}/api/gitlab/tree?repo=${encodeURIComponent(repo)}`);
            if (treeRes.ok) {
              const treeData = await treeRes.json() as { files: { path: string }[] };
              const allFiles = treeData.files ?? [];

              // Filter by extension whitelist
              const eligible = allFiles.filter((f) => {
                const lower = f.path.toLowerCase();
                return CODE_EXTS.has('.' + lower.split('.').pop()!) || lower.endsWith('.env.example');
              });

              // Sort into priority tiers: 1=README, 2=entry, 3=config, 4=code
              const tier = (f: { path: string }) => {
                const name = f.path.split('/').pop()!.toLowerCase();
                const lower = f.path.toLowerCase();
                if (name.startsWith('readme')) return 1;
                if (ENTRY_NAMES.has(name)) return 2;
                if (CONFIG_NAMES.has(name)) return 3;
                if (lower.endsWith('.md')) return 1; // other .md docs
                return 4;
              };
              eligible.sort((a, b) => tier(a) - tier(b));

              // Fetch each file within per-repo budget (20k chars per repo)
              const REPO_BUDGET = 20_000;
              let repoBytesUsed = 0;
              const codeLines: string[] = [];

              for (const f of eligible) {
                if (repoBytesUsed >= REPO_BUDGET || totalCharsUsed >= TOTAL_BUDGET) break;
                const maxChars = tier(f) <= 1 ? 5000 : tier(f) === 2 ? 3000 : tier(f) === 3 ? 2000 : 1200;
                try {
                  const fr = await fetch(`${BASE}/api/gitlab/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(f.path)}`);
                  if (!fr.ok) continue;
                  const fd = await fr.json() as { content?: string };
                  if (!fd.content) continue;
                  const snippet = fd.content.slice(0, maxChars);
                  codeLines.push(`\n--- ${f.path} ---\n${snippet}${fd.content.length > maxChars ? '\n[truncated]' : ''}`);
                  repoBytesUsed += snippet.length;
                  totalCharsUsed += snippet.length;
                } catch { /* skip unreadable file */ }
              }

              if (codeLines.length > 0) {
                repoCtx += `\nCODE FILES${repoLabel} (${codeLines.length} files):\n${codeLines.join('\n')}`;
              }
            }
          } catch { /* best-effort */ }

          return repoCtx;
        }));

        for (const result of repoResults) {
          if (result.status === 'fulfilled' && result.value) {
            gitlabContext += '\n' + result.value;
          }
        }
      }
    }

    return { project, goals: goals ?? [], members: members ?? [], goalsText, membersText, eventsText, githubContext, gitlabContext };
  }

  // ── Project chat: multi-turn conversation with action proposals ──────────
  interface ChatBody {
    agent?: string;
    projectId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    reportMode?: boolean;
  }

  server.post<{ Body: ChatBody }>('/ai/chat', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId, messages, reportMode } = request.body;

    if (!projectId || !messages?.length) {
      return reply.status(400).send({ error: 'projectId and messages are required' });
    }

    const ctx = await buildProjectContext(projectId);

    const systemPrompt = reportMode
      ? `You are Odyssey's report advisor. Help the user plan a project report. Discuss what data to include, suggest insights, and help structure the report. Be concise and specific. Reference actual goals, code files, and activity from the project data below. You have full access to the actual source code files from every linked GitLab repository.

PROJECT: ${ctx.project?.name ?? 'Unknown'}
GOALS:\n${ctx.goalsText}
ACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${ctx.githubContext ? `\n\nGITHUB:\n${ctx.githubContext.slice(0, 2000)}` : ''}${ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + full source code):\n${ctx.gitlabContext.slice(0, 60_000)}` : ''}`
      : `You are an AI assistant embedded in Odyssey with full read and write access to this project. You can answer questions, analyze progress, and propose actions on goals.

PROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}${ctx.project?.github_repo ? `\nGitHub: github.com/${ctx.project.github_repo}` : ''}

GOALS (${ctx.goals.length} total):
${ctx.goalsText}

TEAM MEMBERS:
${ctx.membersText}

RECENT ACTIVITY & DOCUMENTS:
${ctx.eventsText.slice(0, 3000)}${ctx.githubContext ? `\n\nGITHUB:\n${ctx.githubContext.slice(0, 2000)}` : ''}${ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + source code):\n${ctx.gitlabContext.slice(0, 60_000)}` : ''}

CAPABILITIES: When appropriate, you may propose ONE action on goals. Include it at the end of your message using this exact format:
<action>{"type":"create_goal","description":"Human-readable description of what you'll do","args":{"title":"...","deadline":"YYYY-MM-DD","category":"...","assignedTo":"user_id_or_null"}}</action>
OR for updates:
<action>{"type":"update_goal","description":"...","args":{"goalId":"exact-id","updates":{"status":"in_progress","progress":50,"deadline":"YYYY-MM-DD"}}}</action>
OR for delete:
<action>{"type":"delete_goal","description":"...","args":{"goalId":"exact-id","goalTitle":"..."}}</action>

Rules: Only propose an action when clearly relevant. Always explain reasoning before the tag. User must approve before anything executes.`;

    const history = messages.slice(-20);
    const lastMsg = history[history.length - 1]?.content ?? '';
    const transcript = history.slice(0, -1).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
    const userContent = transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg;

    try {
      const result = await chat(provider, { system: systemPrompt, user: userContent, maxTokens: 1500 });

      // Parse optional action tag
      let pendingAction: object | null = null;
      let displayMessage = result.text;
      const actionMatch = result.text.match(/<action>([\s\S]*?)<\/action>/);
      if (actionMatch) {
        try {
          pendingAction = JSON.parse(actionMatch[1].trim());
          displayMessage = result.text.replace(/<action>[\s\S]*?<\/action>/, '').trim();
        } catch { /* ignore malformed action */ }
      }

      return { message: displayMessage, pendingAction, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      if (msg.includes('rate') || msg.includes('429')) return reply.status(429).send({ error: 'Rate limit — try again shortly.' });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Chat with streaming status (SSE) ─────────────────────────────────────
  server.post<{ Body: ChatBody }>('/ai/chat-stream', async (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const provider = resolveProvider(request.body);
    const { projectId, messages, reportMode } = request.body;

    if (!projectId || !messages?.length) {
      send({ type: 'error', message: 'projectId and messages are required' });
      res.end();
      return;
    }

    try {
      send({ type: 'status', text: 'Loading project context…' });
      const ctx = await buildProjectContext(projectId);

      send({ type: 'status', text: 'Consulting AI…' });

      const systemPrompt = reportMode
        ? `You are Odyssey's report advisor. Help the user plan a project report. Discuss what data to include, suggest insights, and help structure the report. Be concise and specific. Reference actual goals, code files, and activity from the project data below. You have full access to the actual source code files from every linked GitLab repository.

PROJECT: ${ctx.project?.name ?? 'Unknown'}
GOALS:\n${ctx.goalsText}
ACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${ctx.githubContext ? `\n\nGITHUB:\n${ctx.githubContext.slice(0, 2000)}` : ''}${ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + full source code):\n${ctx.gitlabContext.slice(0, 60_000)}` : ''}`
        : `You are an AI assistant embedded in Odyssey with full read and write access to this project.

PROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}
GOALS (${ctx.goals.length} total):\n${ctx.goalsText}
TEAM MEMBERS:\n${ctx.membersText}
RECENT ACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${ctx.githubContext ? `\n\nGITHUB:\n${ctx.githubContext.slice(0, 2000)}` : ''}${ctx.gitlabContext ? `\n\nGITLAB REPOS:\n${ctx.gitlabContext.slice(0, 60_000)}` : ''}`;

      const history = messages.slice(-20);
      const lastMsg = history[history.length - 1]?.content ?? '';
      const transcript = history.slice(0, -1).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
      const userContent = transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg;

      const result = await chat(provider, { system: systemPrompt, user: userContent, maxTokens: 1500 });

      let pendingAction: object | null = null;
      let displayMessage = result.text;
      const actionMatch = result.text.match(/<action>([\s\S]*?)<\/action>/);
      if (actionMatch) {
        try {
          pendingAction = JSON.parse(actionMatch[1].trim());
          displayMessage = result.text.replace(/<action>[\s\S]*?<\/action>/, '').trim();
        } catch { /* ignore */ }
      }

      send({ type: 'done', message: displayMessage, pendingAction, provider: result.provider });
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed';
      send({ type: 'error', message: msg });
    }

    res.end();
  });

  // ── Generate structured report content ────────────────────────────────────
  interface GenerateReportBody {
    agent?: string;
    projectId: string;
    prompt: string;
    format: 'docx' | 'pptx' | 'pdf';
    dateFrom?: string;
    dateTo?: string;
  }

  server.post<{ Body: GenerateReportBody }>('/ai/generate-report', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId, prompt, dateFrom, dateTo } = request.body;
    if (!projectId || !prompt) return reply.status(400).send({ error: 'projectId and prompt are required' });

    const ctx = await buildProjectContext(projectId);

    const dateFilter = dateFrom || dateTo
      ? `\nDate range filter: ${dateFrom ?? 'beginning'} → ${dateTo ?? 'today'}`
      : '';

    // Compute raw stats for chart data (returned alongside AI text)
    const statusCounts = { not_started: 0, in_progress: 0, in_review: 0, complete: 0 } as Record<string, number>;
    const categoryProgress: Record<string, number[]> = {};
    for (const g of ctx.goals) {
      statusCounts[g.status] = (statusCounts[g.status] ?? 0) + 1;
      const cat = g.category ?? 'Uncategorized';
      if (!categoryProgress[cat]) categoryProgress[cat] = [];
      categoryProgress[cat].push(g.progress);
    }
    const categoryAvg: Record<string, number> = {};
    for (const [cat, vals] of Object.entries(categoryProgress)) {
      categoryAvg[cat] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    // Trim context to stay within model input limits
    const trimmedEvents  = ctx.eventsText.slice(0, 4000);
    const trimmedGithub  = ctx.githubContext.slice(0, 2000);
    const trimmedGitlab  = ctx.gitlabContext.slice(0, 30_000);

    const contextBlock = `PROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}
${dateFilter}
USER REQUEST: ${prompt}

GOALS (${ctx.goals.length} total):
${ctx.goalsText}

TEAM (${ctx.members.length} members):
${ctx.membersText}

RECENT ACTIVITY & DOCUMENTS:
${trimmedEvents}${trimmedGithub ? `\n\nGITHUB:\n${trimmedGithub}` : ''}${trimmedGitlab ? `\n\nGITLAB:\n${trimmedGitlab}` : ''}`;

    // ── Pass 1: generate metadata + section outlines (small, always fits) ──────
    let pass1: Record<string, unknown>;
    try {
      const r1 = await chat(provider, {
        system: `You are a project report planner. Return ONLY valid JSON — no markdown, no explanation.

Return an object with:
- "title": string (report title, max 70 chars)
- "subtitle": string (e.g. "Project Status Report — March 2026")
- "projectName": string
- "generatedAt": ISO date string
- "executiveSummary": string (3-4 sentences: overall health, key wins, risks, outlook)
- "sectionTitles": array of 5-7 strings — the exact section titles to include, chosen based on the data`,
        user: contextBlock + '\n\nPlan the report structure as JSON.',
        maxTokens: 800,
      });
      const t1 = r1.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      pass1 = JSON.parse(t1);
    } catch {
      return reply.status(500).send({ error: 'Failed to plan report structure. Try again.' });
    }

    const sectionTitles: string[] = Array.isArray(pass1.sectionTitles)
      ? (pass1.sectionTitles as string[])
      : ['Project Status Overview', 'Goal Progress', 'Team Contributions', 'Code & Commits', 'Risks & Recommendations'];

    // ── Pass 2: generate each section independently, merge results ─────────────
    const sections: Array<{ title: string; body: string; bullets: string[]; table?: { headers: string[]; rows: string[][] } }> = [];

    for (const sectionTitle of sectionTitles) {
      try {
        const r2 = await chat(provider, {
          system: `You write one section of a project report as JSON. Return ONLY valid JSON — no markdown, no explanation.

Return an object with:
- "title": string (the section title)
- "body": string (2-3 sentences of specific analysis using real names, percentages, dates from the data)
- "bullets": array of 4-6 specific, data-driven bullet strings
- "table": optional — include ONLY if this section benefits from a table. Object with "headers": string[] and "rows": string[][] (max 10 rows)`,
          user: `${contextBlock}

Write the section titled: "${sectionTitle}"`,
          maxTokens: 1200,
        });
        const t2 = r2.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        const sec = JSON.parse(t2);
        if (sec && typeof sec.title === 'string') sections.push(sec);
      } catch {
        // Skip failed sections rather than aborting the whole report
        sections.push({ title: sectionTitle, body: 'Data unavailable for this section.', bullets: [] });
      }
    }

    const parsed: Record<string, unknown> = {
      ...pass1,
      sections,
      generatedAt: (pass1.generatedAt as string) || new Date().toISOString(),
      provider,
    };

    // Attach raw data for client-side chart generation
    parsed.rawData = {
      goals: ctx.goals.map((g) => ({
        title:    g.title,
        status:   g.status,
        progress: g.progress,
        category: g.category ?? 'Uncategorized',
        deadline: g.deadline ?? null,
      })),
      statusCounts,
      categoryAvg,
      memberCount: ctx.members.length,
      totalGoals:  ctx.goals.length,
    };

    return parsed;
  });

  // ── Standup Generator: 2-week lookback ───────────────────────────────────────
  interface StandupBody {
    agent?: string;
    projectId: string;
  }

  server.post<{ Body: StandupBody }>('/ai/standup', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 14);
    const sinceISO = since.toISOString();
    const sinceDate = sinceISO.slice(0, 10);
    const toDate = now.toISOString().slice(0, 10);

    const [{ data: project }, { data: goals }, { data: events }, gitlabRes] = await Promise.all([
      supabase.from('projects').select('name, description, github_repo').eq('id', projectId).single(),
      supabase.from('goals').select('id, title, status, progress, deadline, category').eq('project_id', projectId),
      supabase.from('events').select('source, event_type, title, summary, occurred_at')
        .eq('project_id', projectId).gte('occurred_at', sinceISO)
        .order('occurred_at', { ascending: false }).limit(30),
      supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle(),
    ]);

    const githubRepo: string | null = project?.github_repo ?? null;
    const gitlabCfg = gitlabRes.data?.config as { repos?: string[]; repo?: string; host?: string } | null;
    const gitlabRepos: string[] = gitlabCfg?.repos ?? (gitlabCfg?.repo ? [gitlabCfg.repo] : []);
    const gitlabHost: string = gitlabCfg?.host ?? process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';

    const commitsByRepo: { source: 'github' | 'gitlab'; repo: string; commits: string[]; count: number }[] = [];

    if (githubRepo) {
      const [owner, repo] = githubRepo.split('/');
      const token = process.env.GITHUB_TOKEN;
      const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Odyssey-App' };
      if (token) ghHeaders.Authorization = `Bearer ${token}`;
      const msgs: string[] = [];
      try {
        for (let page = 1; page <= 2; page++) {
          const r = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=100&page=${page}&since=${sinceISO}`,
            { headers: ghHeaders }
          );
          if (!r.ok) break;
          const commits: { commit: { message: string } }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) msgs.push(c.commit.message.split('\n')[0].trim());
          if (commits.length < 100) break;
        }
      } catch { /* best-effort */ }
      if (msgs.length > 0) commitsByRepo.push({ source: 'github', repo: githubRepo, commits: msgs.slice(0, 50), count: msgs.length });
    }

    const gitlabToken = process.env.GITLAB_NPS_TOKEN;
    for (const repo of gitlabRepos) {
      const encoded = encodeURIComponent(repo);
      const msgs: string[] = [];
      try {
        for (let page = 1; page <= 2; page++) {
          const r = await fetch(
            `${gitlabHost}/api/v4/projects/${encoded}/repository/commits?per_page=100&page=${page}&since=${sinceISO}&order_by=created_at&sort=desc`,
            { headers: { 'PRIVATE-TOKEN': gitlabToken ?? '' } }
          );
          if (!r.ok) break;
          const commits: { title: string }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) msgs.push(c.title.trim());
          if (commits.length < 100) break;
        }
      } catch { /* best-effort */ }
      if (msgs.length > 0) commitsByRepo.push({ source: 'gitlab', repo, commits: msgs.slice(0, 50), count: msgs.length });
    }

    const totalCommits = commitsByRepo.reduce((sum, r) => sum + r.count, 0);

    const goalsText = (goals ?? []).map((g) =>
      `- [${g.status.toUpperCase()}] "${g.title}" — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}`
    ).join('\n') || 'No goals set';

    const eventsText = (events ?? []).map((e) =>
      `[${e.occurred_at.slice(0, 10)}] ${e.source}: ${e.title ?? e.event_type}${e.summary ? ` — ${e.summary}` : ''}`
    ).join('\n') || 'No logged events in this period';

    const commitsText = commitsByRepo.map((r) => {
      const label = `${r.source === 'github' ? 'GitHub' : 'GitLab'}: ${r.repo.split('/').pop()}`;
      return `${label} (${r.count} commits):\n${r.commits.slice(0, 20).map((m) => `  - ${m}`).join('\n')}`;
    }).join('\n\n') || 'No commits in this period';

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's standup generator. Based on the project's commit activity, goals, and logged events from the past 14 days, produce a concise team standup summary.

Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

Return an object with:
- "highlights": string — one punchy sentence summarizing the sprint in plain English
- "accomplished": array of 3-6 strings — key things completed or meaningfully progressed in the past 2 weeks, grounded in actual commit messages and goal progress
- "inProgress": array of 2-4 strings — work actively underway based on recent commits and active goals
- "blockers": array of 0-3 strings — risks, stalled goals, or potential blockers (return empty array if none apparent)

Be specific. Reference real goal names, actual commit topics, and concrete percentages. Avoid generic filler.`,
        user: `Project: ${project?.name ?? 'Unknown'}${project?.description ? `\nDescription: ${project.description}` : ''}
Period: ${sinceDate} → ${toDate} (14 days)
Total commits: ${totalCommits}

GOALS:
${goalsText}

COMMITS BY REPO:
${commitsText}

LOGGED EVENTS:
${eventsText}

Generate the standup summary.`,
        maxTokens: 1000,
      });

      const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const parsed = JSON.parse(raw);

      return {
        highlights: parsed.highlights ?? '',
        accomplished: parsed.accomplished ?? [],
        inProgress: parsed.inProgress ?? [],
        blockers: parsed.blockers ?? [],
        period: { from: sinceDate, to: toDate },
        commitSummary: commitsByRepo.map((r) => ({ source: r.source, repo: r.repo, count: r.count })),
        totalCommits,
        provider: result.provider,
      };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed to generate standup';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Intelligent Update: analyze everything and propose goal changes ────────
  interface IntelligentUpdateBody {
    agent?: string;
    projectId: string;
  }

  server.post<{ Body: IntelligentUpdateBody }>('/ai/intelligent-update', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const ctx = await buildProjectContext(projectId);

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's intelligent project advisor. Analyze ALL available project data — goals, documents, commits, team activity — and produce a JSON list of specific, actionable suggestions to improve the project's goal structure and deadlines.

Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

Return an object with one key:
- "suggestions": array of suggestion objects, each with:
  - "id": string (unique short id like "s1", "s2")
  - "type": "create_goal" | "update_goal" | "delete_goal" | "extend_deadline" | "contract_deadline"
  - "priority": "high" | "medium" | "low"
  - "title": string (short label shown in the UI, max 60 chars)
  - "reasoning": string (2-3 sentences explaining WHY this is suggested based on the actual data)
  - "args": object matching the type:
    - create_goal: {title, deadline?, category?, assignedTo?}
    - update_goal: {goalId, updates: {title?, status?, progress?, deadline?, category?, assigned_to?}}
    - delete_goal: {goalId, goalTitle}
    - extend_deadline: {goalId, goalTitle, currentDeadline, suggestedDeadline, reason}
    - contract_deadline: {goalId, goalTitle, currentDeadline, suggestedDeadline, reason}

Be specific and reference actual goal IDs, names, dates. Generate 3-8 suggestions. Prioritize the most impactful ones.`,
        user: `PROJECT: ${ctx.project?.name ?? 'Unknown'}

GOALS:
${ctx.goalsText}

TEAM:
${ctx.membersText}

RECENT ACTIVITY & DOCUMENTS:
${ctx.eventsText.slice(0, 3000)}${ctx.githubContext ? `\n\nGITHUB:\n${ctx.githubContext.slice(0, 2000)}` : ''}${ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + source code):\n${ctx.gitlabContext.slice(0, 60_000)}` : ''}

Analyze everything and suggest specific improvements to the goal structure and deadlines.`,
        maxTokens: 2000,
      });

      const parsed = JSON.parse(result.text);
      return { suggestions: parsed.suggestions ?? [], provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed to run intelligent update';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      return reply.status(500).send({ error: msg });
    }
  });
}
