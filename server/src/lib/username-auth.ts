const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;
const MIN_PASSWORD_LENGTH = 10;
const INTERNAL_EMAIL_DOMAIN = 'users.odyssey.local';

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: unknown): string | null {
  if (typeof value !== 'string') return 'Username is required';

  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username must be 3-32 characters and use only letters, numbers, or underscores';
  }

  return null;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return 'Password is required';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

export function usernameToInternalEmail(username: string): string {
  return `${normalizeUsername(username)}@${INTERNAL_EMAIL_DOMAIN}`;
}
