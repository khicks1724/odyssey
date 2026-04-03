import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type AIProvider = 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'gpt-4o' | 'gemini-pro' | 'genai-mil';

// 'auto' is a client-side concept — server resolves it per endpoint before calling chat()
export type AIProviderOrAuto = AIProvider | 'auto';

export interface ImageAttachment {
  base64: string;
  mimeType: string;
}

interface ChatMessage {
  system: string;
  user: string;
  maxTokens?: number;
  /** Vision images (Claude + GPT-4o only) */
  images?: ImageAttachment[];
  /** Request strict JSON output (OpenAI-compatible providers only) */
  jsonMode?: boolean;
  /** Enable web search via the provider's native search capability */
  webSearch?: boolean;
}

interface ChatResult {
  text: string;
  provider: AIProvider;
}

// ── Claude (Anthropic) ──────────────────────────────────────────

async function callAnthropicModel(msg: ChatMessage, model: string, provider: AIProvider, apiKeyOverride?: string): Promise<ChatResult> {
  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (msg.webSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';

  const body: Record<string, unknown> = {
    model,
    max_tokens: msg.maxTokens || 500,
    system: msg.system,
    messages: [{
      role: 'user',
      content: msg.images?.length
        ? [
            ...msg.images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
            })),
            { type: 'text', text: msg.user },
          ]
        : msg.user,
    }],
  };
  if (msg.webSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    markProviderError(provider, response.status, errBody);
    throw new Error(`Anthropic API ${response.status}: ${errBody}`);
  }
  clearProviderError(provider);

  const result = await response.json();
  // Extract text from all text blocks (web search may produce multiple content blocks)
  const text = (result.content as { type: string; text?: string }[])
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('') || '';
  return { text, provider };
}

function callClaude(msg: ChatMessage, apiKeyOverride?: string): Promise<ChatResult> {
  return callAnthropicModel(msg, 'claude-sonnet-4-6', 'claude-sonnet', apiKeyOverride);
}

function callClaudeHaiku(msg: ChatMessage, apiKeyOverride?: string): Promise<ChatResult> {
  return callAnthropicModel(msg, 'claude-haiku-4-5-20251001', 'claude-haiku', apiKeyOverride);
}

function callClaudeOpus(msg: ChatMessage, apiKeyOverride?: string): Promise<ChatResult> {
  return callAnthropicModel(msg, 'claude-opus-4-6', 'claude-opus', apiKeyOverride);
}

// ── GPT-4o (OpenAI) ─────────────────────────────────────────────

async function callGPT(msg: ChatMessage, apiKeyOverride?: string): Promise<ChatResult> {
  const apiKey = apiKeyOverride ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const openai = new OpenAI({ apiKey });
  const userContent = msg.images?.length
    ? [
        ...msg.images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
        })),
        { type: 'text' as const, text: msg.user },
      ]
    : msg.user;

  // gpt-4o-search-preview enables built-in web search; it doesn't support max_tokens or json_object mode
  const searchModel = msg.webSearch ? 'gpt-4o-search-preview' : 'gpt-4o';
  const completionParams: Parameters<typeof openai.chat.completions.create>[0] = {
    model: searchModel,
    messages: [
      { role: 'system', content: msg.system },
      { role: 'user', content: userContent as any },
    ],
    ...(msg.webSearch ? {} : { max_tokens: msg.maxTokens || 500 }),
    ...(msg.jsonMode && !msg.webSearch ? { response_format: { type: 'json_object' } } : {}),
  };

  try {
    const completion = await openai.chat.completions.create({ ...completionParams, stream: false });
    clearProviderError('gpt-4o');
    return { text: completion.choices[0]?.message?.content || '', provider: 'gpt-4o' };
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status ?? 0;
    const body = err?.message ?? String(err);
    markProviderError('gpt-4o', status, body);
    throw err;
  }
}

// ── Gemini (Google / GenAI.mil) ─────────────────────────────────

interface GoogleOAuthCred {
  access_token: string;
  refresh_token: string | null;
  connected_at: string;
}

function parseGoogleCred(credential: string): GoogleOAuthCred | null {
  if (!credential.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(credential) as GoogleOAuthCred;
    if (parsed.access_token) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** GenAI.mil (DoD) keys start with STARK_ and use an OpenAI-compatible endpoint */
export function isGenAiMilKey(key: string): boolean {
  return key.startsWith('STARK_') || key.startsWith('STARK-');
}


/**
 * Scrub URL-like references from a string so GenAI.mil doesn't try to browse them.
 * Replaces patterns like "GitHub: github.com/owner/repo" with a plain label.
 */
function scrubUrlsForGenAiMil(text: string): string {
  return text
    // "GitHub: github.com/..." or "GitHub: https://github.com/..."
    .replace(/GitHub:\s+https?:\/\/[^\s\n]+/gi, 'GitHub: [repository source code included below]')
    .replace(/GitHub:\s+github\.com\/[^\s\n]+/gi, 'GitHub: [repository source code included below]')
    // "GitLab: ..." variants
    .replace(/GitLab:\s+https?:\/\/[^\s\n]+/gi, 'GitLab: [repository source code included below]')
    .replace(/GitLab:\s+gitlab[^\s\n]*/gi, 'GitLab: [repository source code included below]')
    // Any remaining bare https?:// links (not part of code blocks) — replace inline
    .replace(/\bhttps?:\/\/(?!api\.genai\.mil)[^\s\n"'`>)]+/g, '[url-redacted]');
}

/** GenAI.mil — OpenAI-compatible /v1/chat/completions endpoint
 *
 * STARK API only accepts: messages, model, max_tokens, stream, temperature.
 * No response_format, no system role, no tool_choice, no assistant prefill.
 *
 * Two distinct failure modes we work around:
 *  1. JSON endpoints: model responds conversationally ("Of course,…") instead of JSON.
 *     Fix → two-step: step 1 gets natural analysis, step 2 reformats to JSON with a
 *     short focused prompt (no large context, just "convert this text to this schema").
 *  2. Chat endpoint: model responds as if it has no project context.
 *     Fix → restructure prompt so the user question appears at the END (most attended
 *     position) and project data is directly above it, not buried under a long preamble.
 */
async function callGeminiGenAiMil(msg: ChatMessage, apiKey: string): Promise<ChatResult> {
  const model = process.env.GENAI_MIL_MODEL ?? 'gemini-2.5-flash';

  // ── Helper: single raw API call ──────────────────────────────────────────
  async function rawCall(content: string, maxTokens: number, temperature: number): Promise<string> {
    const r = await fetch('https://api.genai.mil/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      // GenAI.mil returns an HTML "Unauthorized Access" page when accessed from
      // outside DoD networks (403/503). Surface a clean message instead of raw HTML.
      if (body.startsWith('<!doctype') || body.startsWith('<!DOCTYPE') || body.startsWith('<html')) {
        if (r.status === 401 || r.status === 403) {
          throw new Error(`GenAI.mil authentication failed (HTTP ${r.status}). Check that your STARK API key is correct in Settings → AI Models.`);
        }
        throw new Error(`GenAI.mil is only accessible from DoD/DoW networks. You must be on a DoD network or VPN to use this model. (HTTP ${r.status})`);
      }
      // Parse JSON error to extract unlock_url or clean message
      try {
        const errJson = JSON.parse(body) as { error?: { message?: string; unlock_url?: string } };
        const errMsg = errJson.error?.message ?? '';
        const unlockUrl = errJson.error?.unlock_url;
        if (unlockUrl) {
          throw new Error(`GenAI.mil: API key is locked.\n\nUnlock your key here: ${unlockUrl}`);
        }
        if (errMsg) {
          throw new Error(`GenAI.mil (${r.status}): ${errMsg}`);
        }
      } catch (parseErr) {
        if ((parseErr as Error).message.startsWith('GenAI.mil')) throw parseErr;
      }
      throw new Error(`GenAI.mil API ${r.status} (model: ${model}): ${body.slice(0, 300)}`);
    }
    const raw = await r.text();
    let d: { choices?: { message?: { content?: string } }[] };
    try { d = JSON.parse(raw); }
    catch { throw new Error(`GenAI.mil non-JSON response: ${raw.slice(0, 300)}`); }
    return d.choices?.[0]?.message?.content ?? '';
  }

  // ── Clean input ──────────────────────────────────────────────────────────
  const relabelRepoSections = (text: string) => text
    .replace(/GITHUB \(commits \+ full source code\):/gi,  'GITHUB SOURCE CODE:')
    .replace(/GITLAB REPOS \(commits \+ full source code\):/gi, 'GITLAB SOURCE CODE:')
    .replace(/GITHUB:/gi,  'GITHUB DATA:')
    .replace(/GITLAB:/gi,  'GITLAB DATA:')
    .replace(/## REPOSITORY:/gi, '## REPOSITORY:');

  const cleanedSystem = relabelRepoSections(scrubUrlsForGenAiMil(msg.system));
  const cleanedUser   = relabelRepoSections(scrubUrlsForGenAiMil(msg.user));

  // Keep total prompt under ~300k chars (~75k tokens) so STARK proxy doesn't truncate.
  // Budget: 85% for system context, 15% for user/question.
  const TOTAL_CAP  = 300_000;
  const SYS_CAP    = Math.floor(TOTAL_CAP * 0.85);
  const USER_CAP   = Math.floor(TOTAL_CAP * 0.15);

  const systemContent = cleanedSystem.length > SYS_CAP
    ? cleanedSystem.slice(0, SYS_CAP) + '\n[...context truncated to fit model limit]'
    : cleanedSystem;
  const userContent = cleanedUser.length > USER_CAP
    ? cleanedUser.slice(0, USER_CAP) + '\n[truncated]'
    : cleanedUser;

  // ── JSON mode: two-step ──────────────────────────────────────────────────
  // Step 1 — Ask the question naturally; model responds in plain language.
  // Step 2 — Send ONLY that response + the JSON schema; model converts to JSON.
  //           Short prompt = no "lost in the middle", no conversational opener.
  if (msg.jsonMode) {
    // Extract the schema description from the system prompt
    // (everything from "Return an object..." to the end of that paragraph)
    const schemaMatch = systemContent.match(
      /(Return (?:an object|ONLY a JSON object|a JSON (?:object|array))[\s\S]{0,3000})/i
    );
    const schemaText = schemaMatch?.[1]?.trim() ?? '';

    // Extract just the project data portion — systemContent starts with
    // instructions ("You are Odyssey's...") followed by the actual data.
    // Heuristic: data starts at the first standalone line beginning with an
    // all-caps word (PROJECT, TASKS, GOALS, RECENT) not preceded by a colon.
    const dataStartMatch = systemContent.search(/\n(?:PROJECT|TASKS|GOALS|RECENT ACTIVITY|TEAM)[\s:]/);
    const jsonProjectData = dataStartMatch >= 0 ? systemContent.slice(dataStartMatch + 1) : systemContent;

    // Step 1: natural language analysis with full project context
    const step1 =
      'You are a project management assistant. ' +
      'Using ONLY the project data provided below, answer the question at the end. ' +
      'Do NOT ask for more information — everything you need is already here.\n\n' +
      'PROJECT DATA:\n' +
      jsonProjectData +
      '\n\n---\n\n' +
      userContent;

    console.log(`[GenAI.mil] step1_len=${step1.length} model=${model}`);
    const analysis = await rawCall(step1, msg.maxTokens ?? 2048, 0.7);
    console.log(`[GenAI.mil] step1_response_preview=${analysis.slice(0, 120)}`);

    // Step 2: convert the natural-language analysis to JSON (short focused prompt)
    const step2 =
      'Convert the following project analysis into a JSON object.\n\n' +
      (schemaText ? `REQUIRED JSON STRUCTURE:\n${schemaText}\n\n` : '') +
      'STRICT RULES:\n' +
      '- Output ONLY the raw JSON object\n' +
      '- Start immediately with {\n' +
      '- End with }\n' +
      '- No text, explanation, or markdown before or after the JSON\n\n' +
      'ANALYSIS TO CONVERT:\n' +
      analysis;

    console.log(`[GenAI.mil] step2_len=${step2.length}`);
    const jsonText = await rawCall(step2, msg.maxTokens ?? 2048, 0);
    console.log(`[GenAI.mil] step2_response_preview=${jsonText.slice(0, 120)}`);

    return { text: jsonText, provider: 'gemini-pro' };
  }

  // ── Chat mode: question-last structure ───────────────────────────────────
  // The system prompt from the route already starts with "You are an AI assistant..."
  // followed by project data beginning at "PROJECT:". We split here so that
  // the === PROJECT DATA === section contains ONLY data, not nested instructions.
  const projMarker = systemContent.indexOf('\nPROJECT:');
  const capMarker  = systemContent.indexOf('\nCAPABILITIES:');
  const projectData = projMarker >= 0
    ? systemContent.slice(projMarker + 1, capMarker >= 0 ? capMarker : undefined)
    : systemContent;

  const chatPrompt =
    'You are an AI assistant for a project management tool called Odyssey. ' +
    'Answer the user question at the bottom using ONLY the project data provided. ' +
    'Do NOT ask for more information — everything you need is already below. ' +
    'Do NOT generate or claim to attach any files (PDF, DOCX, etc.) — ' +
    'if asked for a document, respond with the content as formatted markdown text.\n\n' +
    '=== PROJECT DATA ===\n' +
    projectData +
    '\n=== END PROJECT DATA ===\n\n' +
    'USER MESSAGE:\n' +
    userContent;

  console.log(`[GenAI.mil] chat_len=${chatPrompt.length} model=${model}`);
  const text = await rawCall(chatPrompt, msg.maxTokens ?? 2048, 0.7);
  console.log(`[GenAI.mil] chat_response_preview=${text.slice(0, 120)}`);
  clearProviderError('genai-mil');
  return { text, provider: 'genai-mil' };
}

/** Public wrapper for GenAI.mil called via the 'genai-mil' provider route */
async function callGenAiMilProvider(msg: ChatMessage, apiKeyOverride?: string): Promise<ChatResult> {
  const key = apiKeyOverride ?? process.env.GOOGLE_AI_API_KEY ?? '';
  if (!key || !isGenAiMilKey(key)) throw new Error('No STARK API key configured. Add your GenAI.mil key in Settings → AI Models.');
  try {
    return await callGeminiGenAiMil(msg, key);
  } catch (err: any) {
    markProviderError('genai-mil', err?.status ?? 0, err?.message ?? String(err));
    throw err;
  }
}

/** Google OAuth bearer token (linked Google account) */
async function callGeminiWithBearer(msg: ChatMessage, accessToken: string): Promise<ChatResult> {
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: msg.system }] },
    contents: [{ role: 'user', parts: [{ text: msg.user }] }],
    generationConfig: { maxOutputTokens: msg.maxTokens || 2048 },
    ...(msg.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    markProviderError('gemini-pro', res.status, text);
    if (res.status === 401) {
      throw new Error('Google AI token expired — reconnect Google account in Settings → AI Models.');
    }
    throw new Error(`Google AI API ${res.status}: ${text}`);
  }

  clearProviderError('gemini-pro');
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { text, provider: 'gemini-pro' };
}

async function callGemini(msg: ChatMessage, apiKeyOverride?: string): Promise<ChatResult> {
  const credential = apiKeyOverride ?? process.env.GOOGLE_AI_API_KEY;
  if (!credential) throw new Error('GOOGLE_AI_API_KEY not set');

  // GenAI.mil (DoD) — STARK_ prefix, OpenAI-compatible endpoint
  if (isGenAiMilKey(credential)) {
    return callGeminiGenAiMil(msg, credential);
  }

  // Google OAuth linked account
  const oauthCred = parseGoogleCred(credential);
  if (oauthCred) {
    return callGeminiWithBearer(msg, oauthCred.access_token);
  }

  // Standard Google AI Studio API key (AIza...)
  const genAI = new GoogleGenerativeAI(credential);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    ...(msg.webSearch ? { tools: [{ googleSearch: {} }] as any } : {}),
  });

  const result = await model.generateContent({
    systemInstruction: msg.system,
    contents: [{ role: 'user', parts: [{ text: msg.user }] }],
    generationConfig: { maxOutputTokens: msg.maxTokens ?? 2048 },
  });

  return { text: result.response.text(), provider: 'gemini-pro' };
}

// ── Router ──────────────────────────────────────────────────────

const providers: Record<AIProvider, (msg: ChatMessage, apiKeyOverride?: string) => Promise<ChatResult>> = {
  'claude-haiku': callClaudeHaiku,
  'claude-sonnet': callClaude,
  'claude-opus': callClaudeOpus,
  'gpt-4o': callGPT,
  'gemini-pro': callGemini,
  'genai-mil': callGenAiMilProvider,
};

// ── Provider credit/error status cache ─────────────────────────────────────
// Tracks per-provider error state so the UI can show "No Credits" vs "No Key"
export type ProviderStatus = 'ready' | 'no_key' | 'no_credits' | 'invalid_key' | 'error';

const ERROR_TTL_MS = 10 * 60 * 1000; // errors expire after 10 minutes
const providerStatusCache = new Map<AIProvider, { status: ProviderStatus; ts: number }>();

export function markProviderError(provider: AIProvider, httpStatus: number, body: string) {
  const b = body.toLowerCase();
  let status: ProviderStatus;
  if (httpStatus === 402 || b.includes('insufficient') || b.includes('quota') || b.includes('billing') || b.includes('credit') || b.includes('out of credits') || b.includes('exceeded')) {
    status = 'no_credits';
  } else if (httpStatus === 401 || httpStatus === 403 || b.includes('invalid') || b.includes('authentication') || b.includes('unauthorized')) {
    status = 'invalid_key';
  } else if (httpStatus >= 400) {
    status = 'error';
  } else {
    return;
  }
  providerStatusCache.set(provider, { status, ts: Date.now() });
}

export function clearProviderError(provider: AIProvider) {
  providerStatusCache.delete(provider);
}

export function getAvailableProviders(): { id: AIProvider; name: string; available: boolean; status: ProviderStatus }[] {
  const anthropicKey  = !!process.env.ANTHROPIC_API_KEY;
  const openaiKey     = !!process.env.OPENAI_API_KEY;
  const googleRaw     = process.env.GOOGLE_AI_API_KEY ?? '';
  // GenAI.mil uses a STARK_ key stored in GOOGLE_AI_API_KEY
  const hasStarkKey   = isGenAiMilKey(googleRaw);
  // Regular Google key: present AND not a STARK key
  const googleKey     = !!googleRaw && !hasStarkKey;

  function resolveStatus(provider: AIProvider, hasKey: boolean): ProviderStatus {
    if (!hasKey) return 'no_key';
    const cached = providerStatusCache.get(provider);
    if (!cached) return 'ready';
    // Expire old errors so transient failures don't stick forever
    if (Date.now() - cached.ts > ERROR_TTL_MS) {
      providerStatusCache.delete(provider);
      return 'ready';
    }
    return cached.status;
  }

  return [
    { id: 'claude-haiku',  name: 'Claude Haiku',       available: anthropicKey && resolveStatus('claude-haiku',  anthropicKey) === 'ready', status: resolveStatus('claude-haiku',  anthropicKey) },
    { id: 'claude-sonnet', name: 'Claude Sonnet 4.6',  available: anthropicKey && resolveStatus('claude-sonnet', anthropicKey) === 'ready', status: resolveStatus('claude-sonnet', anthropicKey) },
    { id: 'claude-opus',   name: 'Claude Opus 4.6',    available: anthropicKey && resolveStatus('claude-opus',   anthropicKey) === 'ready', status: resolveStatus('claude-opus',   anthropicKey) },
    { id: 'gpt-4o',        name: 'GPT-4o',             available: openaiKey    && resolveStatus('gpt-4o',        openaiKey)    === 'ready', status: resolveStatus('gpt-4o',        openaiKey) },
    { id: 'gemini-pro',    name: 'Gemini 2.5 Flash',   available: googleKey    && resolveStatus('gemini-pro',    googleKey)    === 'ready', status: resolveStatus('gemini-pro',    googleKey) },
    { id: 'genai-mil',     name: 'GenAI.mil (STARK)',  available: hasStarkKey  && resolveStatus('genai-mil',     hasStarkKey)  === 'ready', status: resolveStatus('genai-mil',     hasStarkKey) },
  ];
}

export async function chat(provider: AIProvider, msg: ChatMessage, apiKey?: string): Promise<ChatResult> {
  const fn = providers[provider];
  if (!fn) throw new Error(`Unknown provider: ${provider}`);
  return fn(msg, apiKey);
}

// ── Anthropic model IDs ─────────────────────────────────────────
const ANTHROPIC_MODELS: Partial<Record<AIProvider, string>> = {
  'claude-haiku':  'claude-haiku-4-5-20251001',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-opus':   'claude-opus-4-6',
};

/**
 * Stream a response from an Anthropic model token-by-token.
 * Calls `onToken` for each text delta. Returns the full accumulated text.
 * Falls back to a single-shot call for non-Anthropic providers.
 * Pass `apiKeyOverride` to use a user-supplied key instead of the env var.
 */
export async function streamChat(
  provider: AIProvider,
  msg: ChatMessage,
  onToken: (text: string) => void,
  apiKeyOverride?: string,
): Promise<ChatResult> {
  const anthropicModel = ANTHROPIC_MODELS[provider];

  // Non-Anthropic providers: call normally, then emit the whole result as one chunk
  if (!anthropicModel) {
    const result = await chat(provider, msg, apiKeyOverride);
    onToken(result.text);
    return result;
  }

  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const streamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (msg.webSearch) streamHeaders['anthropic-beta'] = 'web-search-2025-03-05';

  const streamBody: Record<string, unknown> = {
    model: anthropicModel,
    max_tokens: msg.maxTokens || 2048,
    stream: true,
    system: msg.system,
    messages: [{
      role: 'user',
      content: msg.images?.length
        ? [
            ...msg.images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
            })),
            { type: 'text', text: msg.user },
          ]
        : msg.user,
    }],
  };
  if (msg.webSearch) {
    streamBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: streamHeaders,
    body: JSON.stringify(streamBody),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body}`);
  }

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const chunk: string = event.delta.text ?? '';
          fullText += chunk;
          onToken(chunk);
        }
      } catch { /* ignore parse errors on non-JSON lines */ }
    }
  }

  return { text: fullText, provider };
}
