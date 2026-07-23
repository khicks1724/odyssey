import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const {
  normalizeTokenUsageProviderFamily,
  tokenUsageLimitStatusMapFromPolicies,
} = await import('./token-usage-limits.js');

test('provider selections map to stable policy families', () => {
  assert.equal(normalizeTokenUsageProviderFamily('openai:gpt-5.6-sol'), 'openai');
  assert.equal(normalizeTokenUsageProviderFamily('claude-sonnet'), 'anthropic');
  assert.equal(normalizeTokenUsageProviderFamily('gemini-pro'), 'google_ai');
  assert.equal(normalizeTokenUsageProviderFamily('genai-mil:chat-model'), 'genai_mil');
  assert.equal(normalizeTokenUsageProviderFamily('nvidia'), 'nvidia');
  assert.equal(normalizeTokenUsageProviderFamily('gemma4'), 'gemma4');
});

test('legacy limit status selects the all-key, all-provider policy', () => {
  const evaluatedAt = new Date('2026-07-23T12:00:00.000Z');
  const defaultPolicy = {
    id: 'policy-1',
    userId: 'user-1',
    keySource: 'all' as const,
    providerFamily: 'all' as const,
    enabled: true,
    revision: 1,
    updatedAt: evaluatedAt.toISOString(),
    daily: { period: 'daily' as const, limit: 100, used: 25, percentage: 25, periodStart: '', resetsAt: '', reached: false },
    weekly: { period: 'weekly' as const, limit: null, used: 25, percentage: 0, periodStart: '', resetsAt: '', reached: false },
    monthly: { period: 'monthly' as const, limit: null, used: 25, percentage: 0, periodStart: '', resetsAt: '', reached: false },
    rate: {
      requestsPerMinute: null,
      tokensPerMinute: null,
      requestsUsed: 0,
      tokensUsed: 0,
      requestsPercentage: 0,
      tokensPercentage: 0,
      requestsReached: false,
      tokensReached: false,
      windowStartedAt: evaluatedAt.toISOString(),
      resetsAt: evaluatedAt.toISOString(),
    },
  };
  const result = tokenUsageLimitStatusMapFromPolicies(
    ['user-1'],
    new Map([['user-1', [defaultPolicy]]]),
    evaluatedAt,
  );
  assert.equal(result.get('user-1')?.daily.limit, 100);
  assert.equal(result.get('user-1')?.daily.used, 25);
});
