import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type AIProvider = 'claude-sonnet' | 'gpt-4o' | 'gemini-pro';

interface ChatMessage {
  system: string;
  user: string;
  maxTokens?: number;
}

interface ChatResult {
  text: string;
  provider: AIProvider;
}

// ── Claude (Anthropic) ──────────────────────────────────────────

async function callClaude(msg: ChatMessage): Promise<ChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: msg.maxTokens || 500,
      system: msg.system,
      messages: [{ role: 'user', content: msg.user }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body}`);
  }

  const result = await response.json();
  return { text: result.content?.[0]?.text || '', provider: 'claude-sonnet' };
}

// ── GPT-4o (OpenAI) ─────────────────────────────────────────────

async function callGPT(msg: ChatMessage): Promise<ChatResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: msg.maxTokens || 500,
    messages: [
      { role: 'system', content: msg.system },
      { role: 'user', content: msg.user },
    ],
  });

  return { text: completion.choices[0]?.message?.content || '', provider: 'gpt-4o' };
}

// ── Gemini Pro (Google) ─────────────────────────────────────────

async function callGemini(msg: ChatMessage): Promise<ChatResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent({
    systemInstruction: msg.system,
    contents: [{ role: 'user', parts: [{ text: msg.user }] }],
    generationConfig: { maxOutputTokens: msg.maxTokens || 500 },
  });

  return { text: result.response.text(), provider: 'gemini-pro' };
}

// ── Router ──────────────────────────────────────────────────────

const providers: Record<AIProvider, (msg: ChatMessage) => Promise<ChatResult>> = {
  'claude-sonnet': callClaude,
  'gpt-4o': callGPT,
  'gemini-pro': callGemini,
};

export function getAvailableProviders(): { id: AIProvider; name: string; available: boolean }[] {
  return [
    { id: 'claude-sonnet', name: 'Claude Sonnet', available: !!process.env.ANTHROPIC_API_KEY },
    { id: 'gpt-4o', name: 'GPT-4o', available: !!process.env.OPENAI_API_KEY },
    { id: 'gemini-pro', name: 'Gemini Pro', available: !!process.env.GOOGLE_AI_API_KEY },
  ];
}

export async function chat(provider: AIProvider, msg: ChatMessage): Promise<ChatResult> {
  const fn = providers[provider];
  if (!fn) throw new Error(`Unknown provider: ${provider}`);
  return fn(msg);
}
