export function formatMemberRole(role: string | null | undefined): string {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) return 'Member';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
