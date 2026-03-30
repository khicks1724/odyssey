import type { FastifyInstance } from 'fastify';
import { chat, streamChat, getAvailableProviders, type AIProvider } from '../ai-providers.js';
import { supabase } from '../lib/supabase.js';
import { decryptUserKey } from './user-ai-keys.js';
import { isRateLimited, resetInSeconds } from '../lib/rate-limit.js';

const ALL_PROVIDERS: AIProvider[] = ['claude-haiku', 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro'];

// Map AIProvider to the service name stored in user_ai_keys table
function providerToService(provider: AIProvider): 'anthropic' | 'openai' | 'google' {
  if (provider === 'gpt-4o') return 'openai';
  if (provider === 'gemini-pro') return 'google';
  return 'anthropic'; // claude-haiku, claude-sonnet, claude-opus
}

// Look up the user's stored API key for the given provider (decrypted).
// Returns undefined if not found or auth fails.
async function getUserApiKey(authHeader: string | undefined, provider: AIProvider): Promise<string | undefined> {
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return undefined;

  const service = providerToService(provider);
  const { data, error } = await supabase
    .from('user_ai_keys')
    .select('encrypted_key, iv, auth_tag')
    .eq('user_id', user.id)
    .eq('provider', service)
    .maybeSingle();

  if (error || !data) return undefined;

  try {
    return decryptUserKey(data.encrypted_key, data.iv, data.auth_tag);
  } catch {
    return undefined;
  }
}

// Strip markdown code fences that models sometimes wrap JSON responses in.
// e.g. ```json { ... } ``` → { ... }
function extractJson(text: string): string {
  // Strip code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = fenced ? fenced[1].trim() : text.trim();

  // Find the outermost JSON object/array in case of preamble text
  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  const start = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start > 0) raw = raw.slice(start);

  // Strip JS-style line comments (// ...) — invalid in JSON
  raw = raw.replace(/\/\/[^\n]*/g, '');
  // Strip block comments (/* ... */) — invalid in JSON
  raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  // Fix trailing commas before } or ] — invalid in JSON
  raw = raw.replace(/,(\s*[}\]])/g, '$1');

  return raw.trim();
}

// Resolve the provider from the request body.
// When agent === 'auto' or is unset, the caller's `fallback` is used —
// each endpoint passes the tier appropriate for its task complexity.
function resolveProvider(body: { agent?: string }, fallback: AIProvider = 'claude-haiku'): AIProvider {
  const agent = body.agent;
  if (agent && agent !== 'auto' && ALL_PROVIDERS.includes(agent as AIProvider)) {
    return agent as AIProvider;
  }
  return fallback;
}

// Chat-specific auto-routing: choose model based on message complexity
function resolveProviderForChat(body: { agent?: string }, lastMessage: string): AIProvider {
  if (body.agent && body.agent !== 'auto' && ALL_PROVIDERS.includes(body.agent as AIProvider)) {
    return body.agent as AIProvider;
  }
  const words = lastMessage.trim().split(/\s+/).length;
  const deepKeywords = /analyz|comprehensive|deep dive|explain in detail|walk me through|compare|evaluate|assess|design|architect/i;
  if (words > 80 || deepKeywords.test(lastMessage)) return 'claude-sonnet';
  if (words > 20) return 'claude-sonnet';
  return 'claude-haiku';
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

const MD_STYLE = `Use rich markdown formatting — the UI renders it fully. Use **bold** for key terms and task names, \`backticks\` for file names and identifiers, headers (## ###) to organize longer responses, bullet and numbered lists for structure, > blockquotes for caveats, and fenced code blocks for code. Never use emojis. Always refer to tasks by their title, never by ID.`;

const systemPrompts: Record<string, string> = {
  activity_summary: `You are Odyssey's AI intelligence layer. Summarize recent project activity concisely. Focus on:
- Key developments and progress
- Notable patterns or changes in velocity
- Areas of high/low activity
Keep your response under 200 words. Use a professional, direct tone. ${MD_STYLE}`,

  deadline_risk: `You are Odyssey's deadline risk analyzer. Evaluate whether the project is on track for its goals. Consider:
- Current progress vs. deadline proximity
- Recent activity velocity
- Goal completion rates
Rate risk as: **ON TRACK**, **AT RISK**, or **BEHIND SCHEDULE**. Explain why in 2-3 sentences. ${MD_STYLE}`,

  contribution: `You are Odyssey's contribution analyst. Map who contributed what based on the event data. Focus on:
- Which areas each contributor focused on
- Volume and frequency of contributions
- Key accomplishments per contributor
Be factual and data-driven. ${MD_STYLE}`,

  project_history: `You are Odyssey's project historian. Tell the story of how this project evolved based on the event timeline. Focus on:
- Major milestones and turning points
- How different workstreams came together
- The overall arc of development
Write as a narrative, under 300 words. ${MD_STYLE}`,
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
    const gitlabHost: string = gitlabCfg?.host ?? process.env.GITLAB_HOST ?? process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';

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
    const gitlabToken = process.env.GITLAB_TOKEN ?? process.env.GITLAB_NPS_TOKEN;
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

    // Build context within ~16000 chars
    const eventsSummary = events
      .slice(0, 20)
      .map((e) => `[${e.occurred_at}] ${e.source}/${e.event_type}: ${e.title}`)
      .join('\n');

    const goalsSummary = goals
      ? goals
          .map((g) => `- ${g.title} (${g.status}, ${g.progress}%${g.deadline ? `, due: ${g.deadline}` : ''})`)
          .join('\n')
      : 'No goals set';

    // Include extracted text from uploaded documents
    const docEvents = events.filter((e) => e.event_type === 'file_upload');
    const docsSection = docEvents.length > 0
      ? '\n\nUPLOADED DOCUMENTS:\n' + docEvents.map((e) => {
          const meta = e.metadata as { extracted_text?: string; filename?: string } | null;
          const text = meta?.extracted_text;
          if (!text) return null;
          const fname = meta?.filename || e.title;
          return `[${fname}]\n${text.slice(0, 10_000)}`;
        }).filter(Boolean).join('\n\n')
      : '';

    const userContent = `Project: ${projectName}

Recent Events (newest first):
${eventsSummary || 'No events yet'}

Goals:
${goalsSummary}${docsSection}

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
    const provider = resolveProvider(request.body, 'claude-sonnet');
    const { projectId } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId is required' });
    }

    const userApiKey = await getUserApiKey(request.headers.authorization, provider);
    const ctx = await getCachedContext(projectId);

    const codeBlock = [
      ctx.githubContext ? `GITHUB (commits + diffs + source):\n${ctx.githubContext.slice(0, 35_000)}` : '',
      ctx.gitlabContext ? `GITLAB (commits + diffs + source):\n${ctx.gitlabContext.slice(0, 35_000)}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's deep project intelligence engine. You have access to ACTUAL SOURCE CODE FILES and REAL COMMIT DIFFS — not just commit messages. Use them to give a technically grounded analysis.

Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with exactly four keys:
Use backtick markdown formatting for all file paths, function names, module names, variable names, and code identifiers (e.g. \`server/src/routes/ai.ts\`, \`resolveProvider()\`, \`GITHUB_TOKEN\`). When referencing repository files, prefer full repo-qualified paths such as \`repo-name/src/components/File.tsx\` instead of ambiguous relative-only paths like \`src/components/File.tsx\`. Use **bold** for emphasis on key terms.

Return an object with exactly four keys:
- "status": 3-4 sentences on the project's current health. Reference specific files, modules, or components you can see actively changing in the diffs. Note velocity trends.
- "nextSteps": Array of 4-6 strings. Each must be a specific, actionable task grounded in what you see in the code — reference actual file names, function names, or modules using backtick formatting. No generic advice.
- "futureFeatures": Array of 3-5 strings. Suggest concrete features based on gaps you can identify in the current codebase structure and what the README/tasks describe but the code doesn't yet implement.
- "codeInsights": Array of 4-6 strings. Deep technical observations: which modules are most actively developed (from diffs), code patterns you notice, potential technical debt, architectural observations, areas that look incomplete or missing tests, etc. Be specific — name files and patterns using backtick formatting.`,
        user: `Project: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}

TASKS (${ctx.goals.length} total):
${ctx.tasksText}

RECENT ACTIVITY:
${ctx.eventsText.slice(0, 2000)}

${codeBlock}`,
        maxTokens: 3000,
      }, userApiKey);

      let raw = extractJson(result.text);
      // If the response was truncated mid-JSON, attempt to close it gracefully
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const lastBrace = raw.lastIndexOf('}');
        if (lastBrace > 0) raw = raw.slice(0, lastBrace + 1);
        parsed = JSON.parse(raw);
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

    // Tasks list — IDs kept for action proposals in chat, but format uses "task" terminology
    const goalsText = (goals ?? []).map((g) =>
      `- [task_id:${g.id}] [${g.status.toUpperCase()}] "${g.title}" — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}${g.category ? ` [${g.category}]` : ''}${g.assigned_to ? ` assigned:${g.assigned_to}` : ''}`
    ).join('\n') || 'No tasks';

    // Tasks-only text (no IDs) for insights — prevents the AI from parroting UUIDs back to users
    const tasksText = (goals ?? []).map((g) =>
      `- [${g.status.toUpperCase()}] "${g.title}" — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}${g.category ? ` [${g.category}]` : ''}`
    ).join('\n') || 'No tasks';

    const membersText = (members ?? []).map((m) => {
      const p = m.profiles as { display_name?: string | null } | null;
      return `- ${p?.display_name ?? m.user_id} (${m.role}) [user_id:${m.user_id}]`;
    }).join('\n') || 'No members';

    // Separate uploaded documents from regular activity events
    const allEvents = events ?? [];
    const fileEvents = allEvents.filter((e) => e.event_type === 'file_upload');
    const activityEvents = allEvents.filter((e) => e.event_type !== 'file_upload');

    const eventsText = activityEvents.map((e) => {
      let line = `[${new Date(e.occurred_at).toLocaleDateString()}] ${e.source}/${e.event_type}: ${e.title ?? '(untitled)'}`;
      if (e.summary) line += `\n  Summary: ${e.summary}`;
      const meta = e.metadata as { content_preview?: string } | null;
      if (meta?.content_preview) line += `\n  Content: ${meta.content_preview.slice(0, 600)}`;
      return line;
    }).join('\n\n') || 'No activity yet';

    // Build a dedicated documents context with generous per-file and total budgets
    const DOC_PER_FILE = 15_000;
    const DOC_TOTAL    = 50_000;
    let docBudget = DOC_TOTAL;
    const documentsContext = fileEvents.map((e) => {
      const meta = e.metadata as { filename?: string; extracted_text?: string; readable?: boolean } | null;
      const name = meta?.filename ?? e.title ?? 'Unknown file';
      const date = new Date(e.occurred_at).toLocaleDateString();
      if (!meta?.extracted_text) return `[${date}] ${name}: (no text extracted)`;
      const alloc = Math.min(DOC_PER_FILE, docBudget);
      if (alloc <= 0) return `[${date}] ${name}: (document budget exhausted — download to read)`;
      const text = meta.extracted_text.slice(0, alloc);
      docBudget -= text.length;
      return `[${date}] FILE: ${name}\n${text}${meta.extracted_text.length > alloc ? '\n[...truncated]' : ''}`;
    }).join('\n\n---\n\n') || '';

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

      // 3. Full source code — recursive tree fetch then prioritized file fetch
      const BINARY_EXTS_GH = new Set(['.png','.jpg','.jpeg','.gif','.ico','.pdf','.zip','.tar','.gz','.bin','.onnx','.pt','.weights','.h264','.mp4','.so','.dylib','.exe','.wasm','.pkl','.npy','.npz','.db','.sqlite','.lock']);
      const CODE_EXTS_GH = new Set(['.py','.js','.ts','.jsx','.tsx','.json','.yaml','.yml','.md','.sh','.html','.css','.toml','.ini','.cfg','.rs','.go','.java','.c','.cpp','.h','.txt','.gitignore','.env.example','.svelte','.vue','.rb','.php','.kt','.swift','.cs','.r','.scala','.jl']);
      const ENTRY_NAMES_GH = new Set(['main.py','app.py','index.ts','index.js','server.ts','server.js','main.ts','main.js','__init__.py','manage.py','run.py','wsgi.py','asgi.py']);
      const CONFIG_NAMES_GH = new Set(['package.json','requirements.txt','pyproject.toml','setup.py','Makefile','Dockerfile','docker-compose.yml','tsconfig.json','vite.config.ts','go.mod','cargo.toml']);
      const tierGH = (f: { path: string; size?: number }) => {
        const name = f.path.split('/').pop()!.toLowerCase();
        if (name.startsWith('readme')) return 1;
        if (ENTRY_NAMES_GH.has(name)) return 2;
        if (CONFIG_NAMES_GH.has(name)) return 3;
        if (f.path.toLowerCase().endsWith('.md')) return 1;
        const ext = '.' + name.split('.').pop()!;
        if (['.py','.ts','.tsx','.js','.jsx'].includes(ext) && (f.size ?? Infinity) < 20_480) return 3;
        return 4;
      };
      try {
        const treeRes = await fetch(`${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree`);
        if (treeRes.ok) {
          const treeData = await treeRes.json() as { files: { path: string; size: number }[] };
          const allFiles = treeData.files ?? [];
          const skippedBinary: string[] = [];
          const skippedLarge: string[] = [];
          const eligible = allFiles.filter((f) => {
            const lower = f.path.toLowerCase();
            const ext = '.' + lower.split('.').pop()!;
            if (BINARY_EXTS_GH.has(ext)) { skippedBinary.push(f.path); return false; }
            if (!CODE_EXTS_GH.has(ext)) { return false; }
            if ((f.size ?? 0) > 102_400) { skippedLarge.push(f.path); return false; }
            return true;
          });
          eligible.sort((a, b) => tierGH(a) - tierGH(b));

          const GH_BUDGET = 60_000; // ~15k tokens — keep total prompt under Anthropic's 200k limit
          let ghBytes = 0;
          const codeLines: string[] = [];
          const skippedBudget: string[] = [];

          for (const f of eligible) {
            if (ghBytes >= GH_BUDGET) { skippedBudget.push(f.path); continue; }
            try {
              const fr = await fetch(`${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(f.path)}`);
              if (!fr.ok) continue;
              const fd = await fr.json() as { content?: string };
              if (!fd.content) continue;
              const remaining = GH_BUDGET - ghBytes;
              const snippet = fd.content.slice(0, remaining);
              const truncated = fd.content.length > remaining;
              codeLines.push(`### FILE: ${f.path}\n${snippet}${truncated ? '\n[...truncated — file exceeds remaining budget]' : ''}`);
              ghBytes += snippet.length;
            } catch { /* skip unreadable */ }
          }

          const summary = [
            `## REPOSITORY: ${owner}/${repo}`,
            `Files included: ${codeLines.length} / ${allFiles.length} total`,
            `Estimated tokens: ~${Math.round(ghBytes / 4).toLocaleString()}`,
            skippedBinary.length ? `Skipped (binary): ${skippedBinary.length} files` : '',
            skippedLarge.length ? `Skipped (>100KB): ${skippedLarge.length} files` : '',
            skippedBudget.length ? `Skipped (budget): ${skippedBudget.length} files` : '',
          ].filter(Boolean).join('\n');

          githubContext += `\n\n${summary}\n\n${codeLines.join('\n\n')}`;
        }
      } catch { /* best-effort */ }
    }

    // GitLab data (multi-repo support) — commits + README + code files
    let gitlabContext = '';
    if (gitlabInteg?.config) {
      const cfg = gitlabInteg.config as { repos?: string[]; repo?: string; host?: string };
      const repos: string[] = cfg.repos ?? (cfg.repo ? [cfg.repo] : []);

      if (repos.length > 0) {
        const BINARY_EXTS_GL = new Set(['.png','.jpg','.jpeg','.gif','.ico','.pdf','.zip','.tar','.gz','.bin','.onnx','.pt','.weights','.h264','.mp4','.so','.dylib','.exe','.wasm','.pkl','.npy','.npz','.db','.sqlite','.lock']);
        const CODE_EXTS = new Set(['.py','.js','.ts','.jsx','.tsx','.json','.yaml','.yml','.md','.sh','.txt','.html','.css','.toml','.ini','.cfg','.rs','.go','.java','.c','.cpp','.h','.gitignore','.env.example','.svelte','.vue','.rb','.php','.kt','.swift','.cs','.r','.scala','.jl']);
        const ENTRY_NAMES = new Set(['main.py','app.py','index.ts','index.js','server.ts','server.js','main.ts','main.js','__init__.py','manage.py','run.py','wsgi.py','asgi.py']);
        const CONFIG_NAMES = new Set(['package.json','requirements.txt','pyproject.toml','setup.py','setup.cfg','Makefile','Dockerfile','docker-compose.yml','docker-compose.yaml','tsconfig.json','vite.config.ts','vite.config.js','.env.example','CMakeLists.txt','cargo.toml','go.mod']);
        const BASE = `http://localhost:${process.env.PORT ?? 3001}`;
        const TOTAL_BUDGET = 100_000; // ~25k tokens across all repos
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
            const gitlabToken = process.env.GITLAB_TOKEN ?? process.env.GITLAB_NPS_TOKEN;
            const gitlabHost = (gitlabInteg?.config as { host?: string } | null)?.host ?? process.env.GITLAB_HOST ?? process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';
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

          // 2. Full source code — recursive tree + prioritized file fetch
          try {
            const treeRes = await fetch(`${BASE}/api/gitlab/tree?repo=${encodeURIComponent(repo)}`);
            if (treeRes.ok) {
              const treeData = await treeRes.json() as { files: { path: string; size?: number }[] };
              const allFiles = treeData.files ?? [];

              const skippedBinary: string[] = [];
              const skippedLarge: string[] = [];
              const eligible = allFiles.filter((f) => {
                const lower = f.path.toLowerCase();
                const ext = '.' + lower.split('.').pop()!;
                if (BINARY_EXTS_GL.has(ext)) { skippedBinary.push(f.path); return false; }
                if (!CODE_EXTS.has(ext) && !lower.endsWith('.env.example')) return false;
                if ((f.size ?? 0) > 102_400) { skippedLarge.push(f.path); return false; }
                return true;
              });

              const tier = (f: { path: string; size?: number }) => {
                const name = f.path.split('/').pop()!.toLowerCase();
                if (name.startsWith('readme')) return 1;
                if (ENTRY_NAMES.has(name)) return 2;
                if (CONFIG_NAMES.has(name)) return 3;
                if (f.path.toLowerCase().endsWith('.md')) return 1;
                const ext = '.' + name.split('.').pop()!;
                if (['.py','.ts','.tsx','.js','.jsx'].includes(ext) && (f.size ?? Infinity) < 20_480) return 3;
                return 4;
              };
              eligible.sort((a, b) => tier(a) - tier(b));

              const REPO_BUDGET = 60_000; // ~15k tokens per repo
              let repoBytesUsed = 0;
              const codeLines: string[] = [];
              const skippedBudget: string[] = [];

              for (const f of eligible) {
                if (repoBytesUsed >= REPO_BUDGET || totalCharsUsed >= TOTAL_BUDGET) { skippedBudget.push(f.path); continue; }
                try {
                  const fr = await fetch(`${BASE}/api/gitlab/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(f.path)}`);
                  if (!fr.ok) continue;
                  const fd = await fr.json() as { content?: string };
                  if (!fd.content) continue;
                  const remaining = Math.min(REPO_BUDGET - repoBytesUsed, TOTAL_BUDGET - totalCharsUsed);
                  const snippet = fd.content.slice(0, remaining);
                  const truncated = fd.content.length > remaining;
                  codeLines.push(`### FILE: ${f.path}\n${snippet}${truncated ? '\n[...truncated]' : ''}`);
                  repoBytesUsed += snippet.length;
                  totalCharsUsed += snippet.length;
                } catch { /* skip unreadable file */ }
              }

              const summary = [
                `## REPOSITORY: ${repo}`,
                `Files included: ${codeLines.length} / ${allFiles.length} total`,
                `Estimated tokens: ~${Math.round(repoBytesUsed / 4).toLocaleString()}`,
                skippedBinary.length ? `Skipped (binary): ${skippedBinary.length} files` : '',
                skippedLarge.length ? `Skipped (>100KB): ${skippedLarge.length} files` : '',
                skippedBudget.length ? `Skipped (budget): ${skippedBudget.length} files` : '',
              ].filter(Boolean).join('\n');

              repoCtx += `\n\n${summary}\n\n${codeLines.join('\n\n')}`;
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

    return { project, goals: goals ?? [], members: members ?? [], goalsText, tasksText, membersText, eventsText, documentsContext, githubContext, gitlabContext };
  }

  // Light context: DB-only (no GitHub/GitLab API calls) — used for haiku/simple chat messages
  // Cache project context for 5 min to avoid re-fetching GitHub/GitLab on every chat message
  type ProjectCtx = Awaited<ReturnType<typeof buildProjectContext>>;
  const ctxCache = new Map<string, { data: ProjectCtx; expiresAt: number }>();

  async function getCachedContext(projectId: string): Promise<ProjectCtx> {
    const cached = ctxCache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const data = await buildProjectContext(projectId);
    ctxCache.set(projectId, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
    return data;
  }

  // ── Project chat: multi-turn conversation with action proposals ──────────
  interface ChatAttachment {
    type: 'image' | 'text-file' | 'document' | 'repo';
    name: string;
    base64?: string;
    mimeType?: string;
    textContent?: string;
    repo?: string;
    repoType?: string;
  }

  interface ChatBody {
    agent?: string;
    projectId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    reportMode?: boolean;
    attachments?: ChatAttachment[];
  }

  // Hard-cap: total system+user prompt must stay under ~160k tokens (640k chars)
  // to leave room for the response and API overhead within Anthropic's 200k limit.
  const MAX_PROMPT_CHARS = 640_000;
  function capPromptSections(systemPrompt: string, githubSec: string, gitlabSec: string): { sys: string; gh: string; gl: string } {
    const baseLen = systemPrompt.length - githubSec.length - gitlabSec.length;
    const available = MAX_PROMPT_CHARS - baseLen;
    if (available <= 0) return { sys: systemPrompt.slice(0, MAX_PROMPT_CHARS), gh: '', gl: '' };
    const repoTotal = githubSec.length + gitlabSec.length;
    if (repoTotal <= available) return { sys: systemPrompt, gh: githubSec, gl: gitlabSec };
    const ratio = available / repoTotal;
    const ghKeep = Math.floor(githubSec.length * ratio);
    const glKeep = Math.floor(gitlabSec.length * ratio);
    const gh = ghKeep > 50 ? githubSec.slice(0, ghKeep) + '\n[...truncated to fit context limit]' : '';
    const gl = glKeep > 50 ? gitlabSec.slice(0, glKeep) + '\n[...truncated to fit context limit]' : '';
    const newSys = systemPrompt.replace(githubSec, gh).replace(gitlabSec, gl);
    return { sys: newSys, gh, gl };
  }

  const CHAT_STYLE = `\n\nRESPONSE STYLE: Do not use emojis. Use rich markdown formatting throughout your responses — the UI renders it fully. Specifically: use \`backticks\` for ALL file names, function names, variable names, repo names, and code identifiers; use **bold** for key terms, task names, and important values; use *italics* for emphasis; use headers (##, ###) to organize longer responses; use bullet lists and numbered lists wherever structure aids clarity; use > blockquotes for notes or caveats; use fenced code blocks (\`\`\`) for any code snippets. Never output raw special characters as literal formatting — always apply the appropriate markdown element so the rendered output is visually clear and scannable.`;

  const CHAT_STYLE_WITH_REPO_PATHS = `${CHAT_STYLE} When referencing a file from a linked repository, prefer the most specific repo-qualified path you can infer such as \`repo-name/src/components/File.tsx\` or \`org/repo/src/components/File.tsx\`, not just \`src/components/File.tsx\`.`;

  server.post<{ Body: ChatBody }>('/ai/chat', async (request, reply) => {
    // Rate limiting: per-user (from JWT) or per-IP fallback
    const rlKey = (request.headers['x-user-id'] as string | undefined) ?? request.ip;
    if (isRateLimited(rlKey)) {
      return reply.status(429).send({ error: `Rate limit exceeded — max 30 AI requests per minute. Retry in ${resetInSeconds(rlKey)}s.` });
    }

    const { projectId, messages, reportMode, attachments } = request.body;
    const lastMessage = messages?.[messages.length - 1]?.content ?? '';
    const provider = reportMode
      ? resolveProvider(request.body, 'claude-sonnet')
      : resolveProviderForChat(request.body, lastMessage);

    if (!projectId || !messages?.length) {
      return reply.status(400).send({ error: 'projectId and messages are required' });
    }

    // Look up user's personal API key override for the selected provider
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    // Always use full context so documents and repo code are available
    const ctx = await getCachedContext(projectId);

    const docsSection = ctx.documentsContext
      ? `\n\nUPLOADED DOCUMENTS (full text):\n${ctx.documentsContext}`
      : '';
    // Pass full repo context — budgets are enforced during fetch (200k chars per repo)
    const githubSection = ctx.githubContext
      ? `\n\nGITHUB (commits + full source code):\n${ctx.githubContext}`
      : '';
    const gitlabSection = ctx.gitlabContext
      ? `\n\nGITLAB REPOS (commits + full source code):\n${ctx.gitlabContext}`
      : '';

    const systemPrompt = reportMode
      ? `You are Odyssey's report advisor. Help the user plan a project report. Discuss what data to include, suggest insights, and help structure the report. Be concise and specific. Reference actual tasks by their title, code files, and activity from the project data below. Never show task IDs to the user.${CHAT_STYLE_WITH_REPO_PATHS}

PROJECT: ${ctx.project?.name ?? 'Unknown'}
TASKS:\n${ctx.tasksText}
ACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}`
      : `You are an AI assistant embedded in Odyssey with full read and write access to this project. You can answer questions, analyze progress, and propose actions on tasks. You have access to the full text of all uploaded documents and the source code of all linked repositories — use them when answering questions.${CHAT_STYLE_WITH_REPO_PATHS}

IMPORTANT: Always refer to tasks by their title (e.g. "Fix IR Intrinsic Calibration"), never by their ID. Task IDs are internal and must never appear in your responses.

PROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}${ctx.project?.github_repo ? `\nGitHub: github.com/${ctx.project?.github_repo}` : ''}

TASKS (${ctx.goals.length} total):
${ctx.tasksText}

TEAM MEMBERS:
${ctx.membersText}

RECENT ACTIVITY:
${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}

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

    // Build enriched user content from attachments
    let attachmentPrefix = '';
    const imageAttachments: { base64: string; mimeType: string }[] = [];
    for (const att of attachments ?? []) {
      if (att.type === 'image' && att.base64 && att.mimeType) {
        imageAttachments.push({ base64: att.base64, mimeType: att.mimeType });
      } else if ((att.type === 'text-file' || att.type === 'document') && att.textContent) {
        attachmentPrefix += `[Attached: ${att.name}]\n${att.textContent.slice(0, 20_000)}\n---\n\n`;
      } else if (att.type === 'repo' && att.repo) {
        attachmentPrefix += `[Repository context: ${att.repo} (${att.repoType ?? 'git'})]\n`;
      }
    }

    const userContent = attachmentPrefix
      ? `${attachmentPrefix}${transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg}`
      : transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg;

    const { sys: cappedSystem } = capPromptSections(systemPrompt, githubSection, gitlabSection);

    try {
      const result = await chat(provider, {
        system: cappedSystem,
        user: userContent,
        maxTokens: 4096,
        images: imageAttachments.length ? imageAttachments : undefined,
      }, userApiKey);

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
      // Pass through the real error so the client can display the actual provider message
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Chat with real token streaming (SSE) ─────────────────────────────────
  server.post<{ Body: ChatBody }>('/ai/chat-stream', async (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Rate limiting: per-user (from JWT) or per-IP fallback
    const rlKey = (request.headers['x-user-id'] as string | undefined) ?? request.ip;
    if (isRateLimited(rlKey)) {
      send({ type: 'error', message: `Rate limit exceeded — max 30 AI requests per minute. Retry in ${resetInSeconds(rlKey)}s.` });
      res.end();
      return;
    }

    const { projectId, messages, reportMode, attachments } = request.body;
    const lastMessage = messages?.[messages.length - 1]?.content ?? '';
    const provider = reportMode
      ? resolveProvider(request.body, 'claude-sonnet')
      : resolveProviderForChat(request.body, lastMessage);

    if (!projectId || !messages?.length) {
      send({ type: 'error', message: 'projectId and messages are required' });
      res.end();
      return;
    }

    // Look up user's personal API key override for the selected provider
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    try {
      send({ type: 'status', text: 'Loading project context…' });
      const ctx = await getCachedContext(projectId);
      send({ type: 'status', text: 'Generating response…' });

      const docsSection = ctx.documentsContext ? `\n\nUPLOADED DOCUMENTS (full text):\n${ctx.documentsContext}` : '';
      const githubSection = ctx.githubContext ? `\n\nGITHUB (commits + full source code):\n${ctx.githubContext}` : '';
      const gitlabSection = ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + full source code):\n${ctx.gitlabContext}` : '';

      const systemPrompt = reportMode
        ? `You are Odyssey's report advisor. Help the user plan a project report. Be concise and specific. Always refer to tasks by their title, never by ID.${CHAT_STYLE_WITH_REPO_PATHS}\n\nPROJECT: ${ctx.project?.name ?? 'Unknown'}\nTASKS:\n${ctx.tasksText}\nACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}`
        : `You are an AI assistant embedded in Odyssey with full read and write access to this project. You can answer questions, analyze progress, and propose actions on tasks.\n\nIMPORTANT: Always refer to tasks by their title (e.g. "Fix IR Intrinsic Calibration"), never by their ID. Task IDs are internal and must never appear in your responses.${CHAT_STYLE_WITH_REPO_PATHS}\n\nPROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}${ctx.project?.github_repo ? `\nGitHub: github.com/${ctx.project.github_repo}` : ''}\n\nTASKS (${ctx.goals.length} total):\n${ctx.tasksText}\n\nTEAM MEMBERS:\n${ctx.membersText}\n\nRECENT ACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}\n\nCAPABILITIES: When appropriate, you may propose ONE action on goals at the end using: <action>{"type":"create_goal"|"update_goal"|"delete_goal","description":"...","args":{...}}</action>`;

      const history = messages.slice(-20);
      const lastMsg = history[history.length - 1]?.content ?? '';
      const transcript = history.slice(0, -1).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');

      // Build attachment prefix (same as non-stream endpoint)
      let attachmentPrefix = '';
      const imageAttachments: { base64: string; mimeType: string }[] = [];
      for (const att of attachments ?? []) {
        if (att.type === 'image' && att.base64 && att.mimeType) {
          imageAttachments.push({ base64: att.base64, mimeType: att.mimeType });
        } else if ((att.type === 'text-file' || att.type === 'document') && att.textContent) {
          attachmentPrefix += `[Attached: ${att.name}]\n${att.textContent.slice(0, 20_000)}\n---\n\n`;
        } else if (att.type === 'repo' && att.repo) {
          attachmentPrefix += `[Repository context: ${att.repo} (${att.repoType ?? 'git'})]\n`;
        }
      }
      const userContent = attachmentPrefix
        ? `${attachmentPrefix}${transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg}`
        : transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg;

      const { sys: cappedSystem } = capPromptSections(systemPrompt, githubSection, gitlabSection);

      let fullText = '';
      const result = await streamChat(
        provider,
        { system: cappedSystem, user: userContent, maxTokens: 4096, images: imageAttachments.length ? imageAttachments : undefined },
        (chunk) => {
          fullText += chunk;
          send({ type: 'token', text: chunk });
        },
        userApiKey,
      );

      // Parse optional action tag from full accumulated text
      let pendingAction: object | null = null;
      let displayMessage = result.text || fullText;
      const actionMatch = displayMessage.match(/<action>([\s\S]*?)<\/action>/);
      if (actionMatch) {
        try {
          pendingAction = JSON.parse(actionMatch[1].trim());
          displayMessage = displayMessage.replace(/<action>[\s\S]*?<\/action>/, '').trim();
        } catch { /* ignore */ }
      }

      send({ type: 'done', message: displayMessage, pendingAction, provider: result.provider });
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed';
      // Pass the full error message through so the client can display the real reason
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
    const provider = resolveProvider(request.body, 'claude-sonnet');
    const { projectId, prompt, dateFrom, dateTo } = request.body;
    if (!projectId || !prompt) return reply.status(400).send({ error: 'projectId and prompt are required' });

    const ctx = await getCachedContext(projectId);

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

TASKS (${ctx.goals.length} total):
${ctx.goalsText}

TEAM (${ctx.members.length} members):
${ctx.membersText}

RECENT ACTIVITY & DOCUMENTS:
${trimmedEvents}${trimmedGithub ? `\n\nGITHUB:\n${trimmedGithub}` : ''}${trimmedGitlab ? `\n\nGITLAB:\n${trimmedGitlab}` : ''}`;

    // ── Pass 1: generate metadata + section outlines — haiku is sufficient here ─
    const haikuOk = getAvailableProviders().find((p) => p.id === 'claude-haiku')?.available ?? false;
    const pass1Provider: AIProvider = haikuOk ? 'claude-haiku' : provider;

    let pass1: Record<string, unknown>;
    try {
      const r1 = await chat(pass1Provider, {
        system: `You are a project report planner. Return ONLY valid JSON — no markdown, no explanation.

Return an object with:
- "title": string (report title, max 70 chars)
- "subtitle": string (e.g. "Project Status Report — March 2026")
- "projectName": string
- "generatedAt": ISO date string
- "executiveSummary": string (3-4 sentences: overall health, key wins, risks, outlook)
- "sectionTitles": array of 5-7 strings — the exact section titles to include, chosen based on the data. Always include at least one section with a figure or chart where the data supports it (e.g. task status breakdown, progress by category, timeline, team contributions).`,
        user: contextBlock + '\n\nPlan the report structure as JSON.',
        maxTokens: 700,
      });
      const t1 = r1.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      pass1 = JSON.parse(t1);
    } catch {
      return reply.status(500).send({ error: 'Failed to plan report structure. Try again.' });
    }

    const sectionTitles: string[] = Array.isArray(pass1.sectionTitles)
      ? (pass1.sectionTitles as string[])
      : ['Project Status Overview', 'Goal Progress', 'Team Contributions', 'Code & Commits', 'Risks & Recommendations'];

    // ── Pass 2: all sections in parallel — major speedup ───────────────────────
    const SECTION_SYSTEM = `You write one section of a project report as JSON. Return ONLY valid JSON — no markdown, no explanation.

Return an object with:
- "title": string (the section title)
- "body": string (2-3 sentences of specific analysis using real names, percentages, dates from the data)
- "bullets": array of 4-6 specific, data-driven bullet strings
- "table": optional — include ONLY if this section benefits from a table. Object with "headers": string[] and "rows": string[][] (max 10 rows, max 4 columns). CRITICAL table rules: every cell value must be short enough to fit in its column — use abbreviations if needed, never let text wrap more than 2 lines per cell, keep header text under 20 characters.
- "figure": optional — include if this section benefits from a visual figure (bar chart, pie chart, progress chart, timeline, etc.). Object with "type": "bar"|"pie"|"progress"|"timeline", "title": string, and "data": array of {label: string, value: number} objects. Only include figures where you have actual numeric data from the project.

AESTHETIC QUALITY REQUIREMENTS — be hypercritical about these:
- Table cell text must never overflow its cell boundary. If a value is long, truncate or abbreviate it.
- Tables must have consistent column widths — no column should dominate. Keep all cell text under 40 characters.
- Bullet points must be concise — each bullet under 120 characters. Never write paragraph-length bullets.
- Body text must be exactly 2-3 sentences — not one long run-on sentence.
- Figures must only be included when real numeric data exists to populate them — never include empty or fabricated chart data.`;

    const sectionResults = await Promise.all(
      sectionTitles.map(async (sectionTitle) => {
        try {
          const r2 = await chat(provider, {
            system: SECTION_SYSTEM,
            user: `${contextBlock}\n\nWrite the section titled: "${sectionTitle}"`,
            maxTokens: 1200,
          });
          const t2 = r2.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
          const sec = JSON.parse(t2);
          if (sec && typeof sec.title === 'string') return sec;
        } catch { /* fall through to placeholder */ }
        return { title: sectionTitle, body: 'Data unavailable for this section.', bullets: [] };
      })
    );
    const sections = sectionResults;

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

    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

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
    const gitlabHost: string = gitlabCfg?.host ?? process.env.GITLAB_HOST ?? process.env.GITLAB_NPS_HOST ?? 'https://gitlab.nps.edu';

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

    const gitlabToken = process.env.GITLAB_TOKEN ?? process.env.GITLAB_NPS_TOKEN;
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
    ).join('\n') || 'No tasks';

    const eventsText = (events ?? []).map((e) =>
      `[${e.occurred_at.slice(0, 10)}] ${e.source}: ${e.title ?? e.event_type}${e.summary ? ` — ${e.summary}` : ''}`
    ).join('\n') || 'No logged events in this period';

    const commitsText = commitsByRepo.map((r) => {
      const label = `${r.source === 'github' ? 'GitHub' : 'GitLab'}: ${r.repo.split('/').pop()}`;
      return `${label} (${r.count} commits):\n${r.commits.slice(0, 20).map((m) => `  - ${m}`).join('\n')}`;
    }).join('\n\n') || 'No commits in this period';

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's standup generator. Based on the project's commit activity, tasks, and logged events from the past 14 days, produce a concise team standup summary.

Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

Return an object with:
- "highlights": string — one punchy sentence summarizing the sprint in plain English
- "accomplished": array of 3-6 strings — key things completed or meaningfully progressed in the past 2 weeks, grounded in actual commit messages and task progress
- "inProgress": array of 2-4 strings — work actively underway based on recent commits and active tasks
- "blockers": array of 0-3 strings — risks, stalled tasks, or potential blockers (return empty array if none apparent)

Be specific. Reference real task names, actual commit topics, and concrete percentages. When you mention repository files, prefer the most specific repo-qualified or path-qualified form you can infer, such as \`repo-name/src/module/file.ts\` or \`calibration/core/plot_generator.py\`, instead of shortening to ambiguous bare filenames. Avoid generic filler.`,
        user: `Project: ${project?.name ?? 'Unknown'}${project?.description ? `\nDescription: ${project.description}` : ''}
Period: ${sinceDate} → ${toDate} (14 days)
Total commits: ${totalCommits}

TASKS:
${goalsText}

COMMITS BY REPO:
${commitsText}

LOGGED EVENTS:
${eventsText}

Generate the standup summary.`,
        maxTokens: 800,
      }, userApiKey);

      const raw = extractJson(result.text);
      const parsed = JSON.parse(raw);

      const standupResult = {
        highlights: parsed.highlights ?? '',
        accomplished: parsed.accomplished ?? [],
        inProgress: parsed.inProgress ?? [],
        blockers: parsed.blockers ?? [],
        period: { from: sinceDate, to: toDate },
        commitSummary: commitsByRepo.map((r) => ({ source: r.source, repo: r.repo, count: r.count })),
        totalCommits,
        provider: result.provider,
      };

      // Persist (best-effort, non-blocking)
      supabase.from('standup_reports').upsert({
        project_id:    projectId,
        highlights:    standupResult.highlights,
        accomplished:  standupResult.accomplished,
        in_progress:   standupResult.inProgress,
        blockers:      standupResult.blockers,
        period:        standupResult.period,
        commit_summary: standupResult.commitSummary,
        total_commits: standupResult.totalCommits,
        provider:      standupResult.provider,
        generated_at:  new Date().toISOString(),
      }, { onConflict: 'project_id' }).then(({ error: e }) => {
        if (e) server.log.warn({ err: e }, 'Failed to persist standup');
      });

      return standupResult;
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
    const provider = resolveProvider(request.body, 'claude-haiku');
    const { projectId } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const userApiKey = await getUserApiKey(request.headers.authorization, provider);
    const ctx = await getCachedContext(projectId);

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's intelligent project advisor. Analyze ALL available project data — tasks, documents, commits, team activity — and produce a JSON list of specific, actionable suggestions to improve the project's task structure and deadlines.

Respond ONLY with valid JSON — no markdown, no code fences, no comments, no trailing commas, no explanation outside the JSON.

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

Be specific and reference actual task IDs, names, dates. Generate 3-8 suggestions. Prioritize the most impactful ones.`,
        user: `PROJECT: ${ctx.project?.name ?? 'Unknown'}

TASKS:
${ctx.goalsText}

TEAM:
${ctx.membersText}

RECENT ACTIVITY & DOCUMENTS:
${ctx.eventsText.slice(0, 3000)}${ctx.githubContext ? `\n\nGITHUB:\n${ctx.githubContext.slice(0, 2000)}` : ''}${ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + source code):\n${ctx.gitlabContext.slice(0, 60_000)}` : ''}

Analyze everything and suggest specific improvements to the goal structure and deadlines.`,
        maxTokens: 3000,
      }, userApiKey);

      const parsed = JSON.parse(extractJson(result.text));
      return { suggestions: parsed.suggestions ?? [], provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed to run intelligent update';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Load persisted standup report ─────────────────────────────────────────
  server.get<{ Params: { projectId: string } }>('/ai/standup/:projectId', async (request, reply) => {
    const { projectId } = request.params;
    const { data, error } = await supabase
      .from('standup_reports')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error || !data) return reply.status(404).send({ error: 'No standup found' });
    return {
      highlights:    data.highlights,
      accomplished:  data.accomplished,
      inProgress:    data.in_progress,
      blockers:      data.blockers,
      period:        data.period,
      commitSummary: data.commit_summary,
      totalCommits:  data.total_commits,
      provider:      data.provider,
      generatedAt:   data.generated_at,
    };
  });

  // ── Per-task AI guidance ──────────────────────────────────────────────────
  interface TaskGuidanceBody {
    agent?: string;
    projectId: string;
    taskTitle: string;
    taskStatus: string;
    taskProgress: number;
    taskCategory?: string;
    taskLoe?: string;
  }

  server.post<{ Body: TaskGuidanceBody }>('/ai/task-guidance', async (request, reply) => {
    const { agent, projectId, taskTitle, taskStatus, taskProgress, taskCategory, taskLoe } = request.body;
    if (!projectId || !taskTitle) return reply.status(400).send({ error: 'projectId and taskTitle are required' });
    // Prefer haiku for lightweight guidance; fall back to first available provider if haiku is unavailable
    const haikuAvailable = getAvailableProviders().find((p) => p.id === 'claude-haiku')?.available ?? false;
    const provider = agent && agent !== 'auto'
      ? resolveProvider({ agent }, 'claude-haiku')
      : haikuAvailable
        ? 'claude-haiku'
        : (getAvailableProviders().find((p) => p.available)?.id ?? 'claude-haiku');
    const ctx = await getCachedContext(projectId);

    const repoCtx = [
      ctx.githubContext ? `GITHUB COMMITS & README:\n${ctx.githubContext.slice(0, 3000)}` : '',
      ctx.gitlabContext ? `GITLAB CONTEXT:\n${ctx.gitlabContext.slice(0, 3000)}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      const result = await chat(provider, {
        system: `You are a technical advisor giving specific, actionable guidance on how to make the most progress on a single project task. Be concrete. Reference repo files, commits, or related tasks where visible. No emojis. Use rich markdown: \`backticks\` for file names and identifiers, **bold** for key terms, bullet lists for steps (4-6 bullets max). When you reference repository files, prefer full repo-qualified paths such as \`repo-name/src/module/file.ts\` over ambiguous relative-only paths.`,
        user: `TASK: "${taskTitle}"
Status: ${taskStatus} (${taskProgress}% complete)
Category: ${taskCategory ?? 'unspecified'}
Line of Effort: ${taskLoe ?? 'unspecified'}

OTHER PROJECT TASKS:
${ctx.goalsText?.slice(0, 800) ?? 'none'}

${repoCtx}

Give me the 4-6 most impactful next steps to make concrete progress on this task right now.`,
        maxTokens: 500,
      });
      return { guidance: result.text, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate guidance' });
    }
  });

  // ── AI Search ────────────────────────────────────────────────────────────────
  interface AISearchBody { agent?: string; projectId: string; query: string; }

  server.post<{ Body: AISearchBody }>('/ai/search', async (request, reply) => {
    const { agent, projectId, query } = request.body;
    if (!projectId || !query) return reply.status(400).send({ error: 'projectId and query are required' });

    // Fetch goals + recent events
    const [goalsRes, eventsRes] = await Promise.all([
      supabase.from('goals').select('id,title,status,progress,category,loe,assignees,deadline').eq('project_id', projectId),
      supabase.from('events').select('id,title,summary,source,event_type,occurred_at').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(200),
    ]);

    const goals = goalsRes.data ?? [];
    const events = eventsRes.data ?? [];

    // Instant text match
    const q = query.toLowerCase();
    const textGoalIds = new Set(goals.filter((g: any) => g.title?.toLowerCase().includes(q)).map((g: any) => g.id));
    const textEventIds = new Set(events.filter((e: any) => e.title?.toLowerCase().includes(q) || e.summary?.toLowerCase().includes(q)).map((e: any) => e.id));

    const provider = resolveProvider({ agent }, 'claude-haiku');

    const goalsText = goals.map((g: any) =>
      `ID:${g.id} | "${g.title}" | ${g.status} | ${g.progress}% | category:${g.category ?? '-'} | assignees:${(g.assignees ?? []).join(',')} | deadline:${g.deadline ?? '-'}`
    ).join('\n');

    const eventsText = events.slice(0, 100).map((e: any) =>
      `ID:${e.id} | [${e.source}/${e.event_type}] ${e.title ?? ''} — ${e.summary?.slice(0, 120) ?? ''} | ${e.occurred_at?.slice(0, 10)}`
    ).join('\n');

    let aiGoalIds: string[] = [];
    let aiEventIds: string[] = [];
    let interpretation: string | null = null;

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's search engine. Given a natural language query about a project, identify which goals and events best match. Consider semantic meaning — the user might ask things like "tasks assigned to John", "what happened last week", or "at-risk items in Testing".
Respond ONLY with valid JSON: { "goalIds": ["id1",...], "eventIds": ["id1",...], "interpretation": "plain English explanation of what was searched for" }
Return up to 10 goalIds and 10 eventIds ordered by relevance.`,
        user: `QUERY: "${query}"

GOALS:
${goalsText || 'none'}

RECENT EVENTS:
${eventsText || 'none'}`,
        maxTokens: 600,
      });

      const parsed = JSON.parse(extractJson(result.text));
      aiGoalIds = Array.isArray(parsed.goalIds) ? parsed.goalIds : [];
      aiEventIds = Array.isArray(parsed.eventIds) ? parsed.eventIds : [];
      interpretation = parsed.interpretation ?? null;
    } catch {
      // fallback to text-only results
    }

    // Merge AI + text results, deduplicated
    const mergedGoals = [
      ...aiGoalIds.map((id: string) => ({ id, score: 'ai' as const })),
      ...[...textGoalIds].filter(id => !aiGoalIds.includes(id)).map(id => ({ id, score: 'text' as const })),
    ];
    const mergedEvents = [
      ...aiEventIds.map((id: string) => ({ id, score: 'ai' as const })),
      ...[...textEventIds].filter(id => !aiEventIds.includes(id)).map(id => ({ id, score: 'text' as const })),
    ];

    return { goals: mergedGoals, events: mergedEvents, interpretation, provider };
  });

  // ── Risk Assessment ───────────────────────────────────────────────────────────
  interface RiskAssessBody { agent?: string; projectId: string; }

  server.post<{ Body: RiskAssessBody }>('/ai/risk-assess', async (request, reply) => {
    const { agent, projectId } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const [goalsRes, depsRes] = await Promise.all([
      supabase.from('goals').select('id,title,status,progress,deadline,updated_at,assignees,category').eq('project_id', projectId),
      supabase.from('goal_dependencies').select('goal_id,depends_on_goal_id').eq('project_id', projectId),
    ]);

    const goals: any[] = goalsRes.data ?? [];
    const deps: any[] = depsRes.data ?? [];
    const now = new Date();

    const goalMap = new Map(goals.map(g => [g.id, g]));

    const goalsText = goals.map(g => {
      const deadline = g.deadline ? Math.round((new Date(g.deadline).getTime() - now.getTime()) / 86400000) : null;
      const stale = Math.round((now.getTime() - new Date(g.updated_at).getTime()) / 86400000);
      const myDeps = deps.filter(d => d.goal_id === g.id);
      const blockedBy = myDeps
        .map(d => goalMap.get(d.depends_on_goal_id))
        .filter((dep): dep is any => dep && dep.status !== 'complete')
        .map(dep => dep.title);

      return [
        `ID:${g.id} | "${g.title}" | ${g.status} | ${g.progress}%`,
        deadline !== null ? `deadline in ${deadline}d` : 'no deadline',
        `last updated ${stale}d ago`,
        blockedBy.length > 0 ? `blocked by: ${blockedBy.join(', ')}` : 'no blockers',
      ].join(' | ');
    }).join('\n');

    const provider = resolveProvider({ agent }, 'claude-sonnet');

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's risk analyst. Evaluate each goal's risk based on: progress vs deadline proximity, staleness (days since last update), whether it depends on incomplete goals, and current status.
Risk levels: low(0-25), medium(26-50), high(51-75), critical(76-100).
Respond ONLY with a valid JSON array: [{ "goalId": "...", "score": 45, "level": "medium", "factors": ["3 days until deadline", "no updates in 10 days"] }]
Assess every goal listed.`,
        user: `PROJECT GOALS:\n${goalsText}`,
        maxTokens: 1500,
      });

      const assessments: { goalId: string; score: number; level: string; factors: string[] }[] = JSON.parse(extractJson(result.text));

      // Write risk scores back to goals (0-1 float)
      await Promise.all(
        assessments.map(a =>
          supabase.from('goals').update({ risk_score: a.score / 100 }).eq('id', a.goalId)
        )
      );

      // Log a single audit event
      const session = await supabase.auth.getSession();
      const userId = session.data?.session?.user?.id ?? null;
      await supabase.from('events').insert({
        project_id: projectId,
        source: 'ai',
        event_type: 'goal_risk_assessed',
        title: 'Risk assessment completed',
        summary: `${assessments.length} goals assessed`,
        occurred_at: new Date().toISOString(),
        created_by: userId,
      });

      return { assessments, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to assess risk' });
    }
  });
}
