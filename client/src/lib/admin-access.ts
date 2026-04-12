export const TOKEN_USAGE_ADMIN_EMAILS = [
  'kyle.hicks@nps.edu',
  'jasavatt@nps.edu',
  'dtpierce@nps.edu',
] as const;

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

export function canViewTokenUsagePage(
  emailCandidates: Array<string | null | undefined>,
  _displayNameCandidates: Array<string | null | undefined>,
) {
  return emailCandidates.some((value) => TOKEN_USAGE_ADMIN_EMAILS.includes(normalizeEmail(value) as (typeof TOKEN_USAGE_ADMIN_EMAILS)[number]));
}
