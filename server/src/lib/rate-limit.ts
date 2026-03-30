/**
 * Simple in-memory rate limiter for AI endpoints.
 * Limits each user to MAX_REQUESTS per WINDOW_MS.
 * Falls back to IP-based limiting for unauthenticated requests.
 */

const MAX_REQUESTS = 30;         // per window
const WINDOW_MS    = 60_000;     // 1 minute

interface Bucket {
  count: number;
  resetAt: number;
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
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS;
}

/**
 * Returns seconds until the rate limit window resets for a given key.
 */
export function resetInSeconds(key: string): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
}
