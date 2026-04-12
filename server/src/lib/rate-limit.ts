/**
 * Simple in-memory rate limiter for AI endpoints.
 * Limits each user to MAX_REQUESTS per WINDOW_MS.
 * Falls back to IP-based limiting for unauthenticated requests.
 */

const MAX_REQUESTS = 30;
const WINDOW_MS = 60_000;

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
  maxRequests: number;
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

// Prune expired buckets every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60_000);

/**
 * Returns true if the request should be blocked (rate limit exceeded).
 * @param key - user ID or IP address
 */
export function checkRateLimit(key: string, options: RateLimitOptions = {}): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const maxRequests = options.maxRequests ?? MAX_REQUESTS;
  const windowMs = options.windowMs ?? WINDOW_MS;
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now || bucket.maxRequests !== maxRequests || bucket.windowMs !== windowMs) {
    bucket = { count: 1, resetAt: now + windowMs, maxRequests, windowMs };
    buckets.set(key, bucket);
    return { limited: false, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  return {
    limited: bucket.count > maxRequests,
    retryAfterSeconds: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function isRateLimited(key: string, options: RateLimitOptions = {}): boolean {
  return checkRateLimit(key, options).limited;
}

/**
 * Returns seconds until the rate limit window resets for a given key.
 */
export function resetInSeconds(key: string): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
}
