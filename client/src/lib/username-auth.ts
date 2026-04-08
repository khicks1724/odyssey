const LEGACY_USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 10;
const INTERNAL_EMAIL_DOMAIN = 'users.odyssey.local';

export function normalizeUsername(value: string): string {
  return value.trim();
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (!username) {
    return 'Username is required.';
  }
  if (username.length < MIN_USERNAME_LENGTH) {
    return `Username must be at least ${MIN_USERNAME_LENGTH} characters long.`;
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return `Username must be ${MAX_USERNAME_LENGTH} characters or fewer.`;
  }
  if (CONTROL_CHAR_PATTERN.test(username)) {
    return 'Username can use any visible characters, but not control characters.';
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

function canonicalizeUsername(value: string): string {
  return normalizeUsername(value).toLocaleLowerCase();
}

function hashUsernamePart(value: string, seed: bigint): string {
  const bytes = new TextEncoder().encode(value);
  let hash = seed;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function usernameToInternalEmail(username: string): string {
  const canonical = canonicalizeUsername(username);
  const forward = hashUsernamePart(canonical, 14695981039346656037n);
  const reverse = hashUsernamePart([...canonical].reverse().join(''), 7809847782465536322n);
  return `u-${forward}${reverse}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function legacyUsernameToInternalEmail(username: string): string {
  return `${canonicalizeUsername(username)}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function isLegacyUsername(username: string): boolean {
  return LEGACY_USERNAME_PATTERN.test(canonicalizeUsername(username));
}
