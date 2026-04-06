export function getProjectFingerprint(projectId: string): string {
  const compact = projectId.replace(/-/g, '').toUpperCase();
  return `ODY-${compact.slice(0, 6)}-${compact.slice(-6)}`;
}
