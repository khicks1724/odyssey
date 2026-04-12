import type { OdysseyEvent } from '../types';

export function isGeneratedThesisLatexCommitMessage(message: string | null | undefined) {
  const normalized = (message ?? '').split('\n')[0]?.trim() ?? '';
  if (!normalized) return false;
  return /^update thesis latex file\b/i.test(normalized);
}

export function isGeneratedThesisLatexCommitEvent(event: OdysseyEvent) {
  if (event.event_type !== 'commit') return false;
  return isGeneratedThesisLatexCommitMessage(event.title) || isGeneratedThesisLatexCommitMessage(event.summary);
}
