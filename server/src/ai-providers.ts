import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type AIProvider = 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'gpt-4o' | 'gemini-pro';

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
}

interface ChatResult {
  text: string;
  provider: AIProvider;
}

// ── Claude (Anthropic) ──────────────────────────────────────────

async function callAnthropicModel(msg: ChatMessage, model: string, provider: AIProvider, apiKeyOverride?: string): Promise<ChatResult> {
  const apiKey = apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body}`);
  }

  const result = await response.json();
  return { text: result.content?.[0]?.text || '', provider };
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

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: msg.maxTokens || 500,
    messages: [
      { role: 'system', content: msg.system },
      { role: 'user', content: userContent as any },
    ],
  });

  return { text: completion.choices[0]?.message?.content || '', provider: 'gpt-4o' };
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
function isGenAiMilKey(key: string): boolean {
  return key.startsWith('STARK_') || key.startsWith('STARK-');
}

/** GenAI.mil — OpenAI-compatible /v1/chat/completions endpoint */
async function callGeminiGenAiMil(msg: ChatMessage, apiKey: string): Promise<ChatResult> {
  // Allow override via env; GenAI.mil confirmed model ID per their docs
  const model = process.env.GENAI_MIL_MODEL ?? 'gemini-2.5-flash';

  const res = await fetch('https://api.genai.mil/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: msg.system },
        { role: 'user', content: msg.user },
      ],
      max_tokens: msg.maxTokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GenAI.mil API ${res.status} (model: ${model}): ${body}`);
  }

  const raw = await res.text();
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`GenAI.mil non-JSON response: ${raw.slice(0, 300)}`);
  }
  console.log('[GenAI.mil] response keys:', Object.keys(data));
  console.log('[GenAI.mil] choices[0]:', JSON.stringify(data.choices?.[0])?.slice(0, 300));
  const text = data.choices?.[0]?.message?.content ?? '';
  return { text, provider: 'gemini-pro' };
}

/** Google OAuth bearer token (linked Google account) */
async function callGeminiWithBearer(msg: ChatMessage, accessToken: string): Promise<ChatResult> {
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent';
  const body = {
    system_instruction: { parts: [{ text: msg.system }] },
    contents: [{ role: 'user', parts: [{ text: msg.user }] }],
    generationConfig: { maxOutputTokens: msg.maxTokens || 2048 },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      throw new Error('Google AI token expired — reconnect Google account in Settings → AI Models.');
    }
    throw new Error(`Google AI API ${res.status}: ${text}`);
  }

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
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1' });

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
};

export function getAvailableProviders(): { id: AIProvider; name: string; available: boolean }[] {
  return [
    { id: 'claude-haiku',  name: 'Claude Haiku',  available: !!process.env.ANTHROPIC_API_KEY },
    { id: 'claude-sonnet', name: 'Claude Sonnet',  available: !!process.env.ANTHROPIC_API_KEY },
    { id: 'claude-opus',   name: 'Claude Opus',    available: !!process.env.ANTHROPIC_API_KEY },
    { id: 'gpt-4o',        name: 'GPT-4o',         available: !!process.env.OPENAI_API_KEY },
    { id: 'gemini-pro',    name: 'Gemini 2.5 Flash', available: !!process.env.GOOGLE_AI_API_KEY },
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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
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
    }),
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
