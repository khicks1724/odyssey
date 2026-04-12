export function isGeneratedThesisLatexCommitMessage(message: string | null | undefined) {
  const normalized = (message ?? '').split('\n')[0]?.trim() ?? '';
  if (!normalized) return false;
  return /^update thesis latex file\b/i.test(normalized);
}
