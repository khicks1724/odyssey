import { CITATION_REFERENCE_LIBRARY } from '../generated/citation-references';

export type CitationReferenceFormat = keyof typeof CITATION_REFERENCE_LIBRARY;

export type CitationReferenceChunk = {
  id: string;
  guideTitle: string;
  text: string;
};

export function getCitationReferenceGuide(format: CitationReferenceFormat) {
  return CITATION_REFERENCE_LIBRARY[format];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scoreChunk(chunk: CitationReferenceChunk, query: string) {
  const haystack = `${chunk.guideTitle} ${chunk.text}`.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;

  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += 3;
    const matches = haystack.match(new RegExp(escapeRegExp(term), 'g'));
    score += Math.min(4, matches?.length ?? 0);
  }
  if (chunk.text.length >= 180 && chunk.text.length <= 1100) score += 2;
  return score;
}

export function searchCitationReferenceChunks(format: CitationReferenceFormat, query: string, limit = 6) {
  const guide = getCitationReferenceGuide(format);
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return guide.keySections.slice(0, limit).map((section) => ({
      id: section.id,
      guideTitle: guide.label,
      text: section.snippet,
      score: section.score,
      title: section.title,
    }));
  }

  return guide.searchableChunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(chunk, trimmedQuery),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
