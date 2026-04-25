export type SourceVenueKind =
  | 'journal_article'
  | 'conference_paper'
  | 'book'
  | 'book_chapter'
  | 'government_report'
  | 'thesis_dissertation'
  | 'dataset'
  | 'interview_notes'
  | 'archive_record'
  | 'web_article'
  | 'documentation';

export type ParsedSourceVenueMetadata = {
  raw: string;
  normalized: string;
  journal: string;
  booktitle: string;
  publisher: string;
  organization: string;
  institution: string;
  school: string;
  howpublished: string;
  volume: string;
  number: string;
  pages: string;
  edition: string;
  series: string;
  reportNumber: string;
  articleNumber: string;
};

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeDash(value: string) {
  return value.replace(/[–—]/g, '-');
}

function cleanSegment(value: string) {
  return compactWhitespace(
    normalizeDash(
      value
        .replace(/^\s*[:,;.-]+\s*/g, '')
        .replace(/\s*[:,;.-]+\s*$/g, ''),
    ),
  );
}

export function normalizeBibliographyPages(value: string) {
  return cleanSegment(value).replace(/\s*-\s*/g, '-');
}

export function normalizeVenueText(value: string) {
  return cleanSegment(
    value
      .replace(/\.\s*,/g, ',')
      .replace(/,\s*\./g, ','),
  );
}

function buildEmptyMetadata(venue: string): ParsedSourceVenueMetadata {
  const normalized = normalizeVenueText(venue);
  return {
    raw: venue,
    normalized,
    journal: '',
    booktitle: '',
    publisher: '',
    organization: '',
    institution: '',
    school: '',
    howpublished: '',
    volume: '',
    number: '',
    pages: '',
    edition: '',
    series: '',
    reportNumber: '',
    articleNumber: '',
  };
}

function isEditionSegment(value: string) {
  return /\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|rev\.?|expanded|international)\s+(?:ed(?:ition)?|printing)\b/i.test(value);
}

function isPageSegment(value: string) {
  return /\bpp?\.?\s*[A-Za-z0-9]+(?:\s*-\s*[A-Za-z0-9]+)?\b/i.test(value)
    || /^\s*[A-Za-z]?\d+(?:\.\d+)?\s*-\s*[A-Za-z]?\d+(?:\.\d+)?\s*$/i.test(value);
}

function isArticleNumberSegment(value: string) {
  return /\b(?:art(?:icle)?\.?\s*(?:no\.?)?|paper)\s*[A-Za-z0-9._-]+\b/i.test(value);
}

function isReportNumberSegment(value: string) {
  return /\b(?:report|tech(?:nical)?\s+report|working\s+paper|white\s+paper|directive|instruction|manual|handbook|standard|spec(?:ification)?|bulletin|memorandum|memo|jp|fm|rr|crs|gao)\b/i.test(value)
    || /[A-Z]{1,6}[-/ ]?\d[\w.-]*/.test(value);
}

function looksOrganizationLike(value: string) {
  return /\b(agency|department|office|committee|commission|command|center|centre|university|college|school|laboratory|lab|institute|administration|association|society|bureau|ministry|corps|navy|army|air force|marine|marines|government|council|press|publisher|organization|division|company|corporation|corp|inc|incorporated|llc|ltd|limited|plc|gmbh|group|holdings|systems|technologies|industries|international)\b/i.test(value);
}

function parsePageSegment(value: string) {
  const match = value.match(/\b(?:pp?\.?\s*)?([A-Za-z0-9]+(?:\.\d+)?(?:\s*-\s*[A-Za-z0-9]+(?:\.\d+)?)?)\b/i);
  return match?.[1] ? normalizeBibliographyPages(match[1]) : '';
}

function parseArticleNumberSegment(value: string) {
  const match = value.match(/\b(?:art(?:icle)?\.?\s*(?:no\.?)?|paper)\s*([A-Za-z0-9._-]+)\b/i);
  return match?.[1] ? cleanSegment(match[1]) : '';
}

function parseVolumeIssueSegment(value: string) {
  const normalized = cleanSegment(value);
  const parenMatch = normalized.match(/^(?:vol(?:ume)?\.?\s*)?(\d+[A-Za-z]?)(?:\s*\(\s*([^)]+)\s*\))$/i);
  if (parenMatch) {
    return {
      volume: cleanSegment(parenMatch[1] ?? ''),
      number: cleanSegment(parenMatch[2] ?? ''),
    };
  }

  const labeledMatch = normalized.match(/^(?:vol(?:ume)?\.?\s*)?(\d+[A-Za-z]?)(?:\s*,?\s*(?:no\.?|issue)\s*([A-Za-z0-9._-]+))?$/i);
  if (labeledMatch) {
    return {
      volume: cleanSegment(labeledMatch[1] ?? ''),
      number: cleanSegment(labeledMatch[2] ?? ''),
    };
  }

  return { volume: '', number: '' };
}

function peelTrailingSegment(segments: string[], predicate: (value: string) => boolean) {
  const last = segments.at(-1);
  if (!last || !predicate(last)) return '';
  segments.pop();
  return last;
}

function parseArticleVenue(venue: string) {
  const metadata = buildEmptyMetadata(venue);
  if (!metadata.normalized) return metadata;

  const fullMatch = metadata.normalized.match(
    /^(.*?)(?:,\s*|\s+)(?:vol(?:ume)?\.?\s*)?(\d+[A-Za-z]?)(?:\s*\(\s*([^)]+)\s*\)|\s*,?\s*(?:no\.?|issue)\s*([A-Za-z0-9._-]+))?(?:\s*[,;:]\s*(?:art(?:icle)?\.?\s*(?:no\.?)?\s*([A-Za-z0-9._-]+)|(?:pp?\.?\s*)?([A-Za-z0-9]+(?:\.\d+)?(?:\s*-\s*[A-Za-z0-9]+(?:\.\d+)?)?)))?\s*$/i,
  );
  if (fullMatch) {
    metadata.journal = cleanSegment(fullMatch[1] ?? '');
    metadata.volume = cleanSegment(fullMatch[2] ?? '');
    metadata.number = cleanSegment(fullMatch[3] ?? fullMatch[4] ?? '');
    metadata.articleNumber = cleanSegment(fullMatch[5] ?? '');
    metadata.pages = normalizeBibliographyPages(fullMatch[6] ?? '');
    return metadata;
  }

  const segments = metadata.normalized.split(/\s*,\s*/).map(cleanSegment).filter(Boolean);
  metadata.pages = parsePageSegment(peelTrailingSegment(segments, isPageSegment));
  metadata.articleNumber = parseArticleNumberSegment(peelTrailingSegment(segments, isArticleNumberSegment));
  const volumeIssueSegment = peelTrailingSegment(segments, (value) => {
    const parsed = parseVolumeIssueSegment(value);
    return Boolean(parsed.volume);
  });
  const volumeIssue = parseVolumeIssueSegment(volumeIssueSegment);
  metadata.volume = volumeIssue.volume;
  metadata.number = volumeIssue.number;
  metadata.journal = segments.join(', ') || metadata.normalized;
  return metadata;
}

export function parseSourceVenueMetadata(sourceKind: SourceVenueKind, venue: string): ParsedSourceVenueMetadata {
  if (sourceKind === 'journal_article') return parseArticleVenue(venue);

  const metadata = buildEmptyMetadata(venue);
  if (!metadata.normalized) return metadata;

  const segments = metadata.normalized.split(/\s*,\s*/).map(cleanSegment).filter(Boolean);
  metadata.pages = parsePageSegment(peelTrailingSegment(segments, isPageSegment));
  metadata.articleNumber = parseArticleNumberSegment(peelTrailingSegment(segments, isArticleNumberSegment));
  metadata.edition = cleanSegment(peelTrailingSegment(segments, isEditionSegment));
  metadata.reportNumber = cleanSegment(peelTrailingSegment(segments, isReportNumberSegment));

  const remaining = segments.filter(Boolean);
  const first = remaining[0] ?? '';
  const last = remaining.at(-1) ?? '';

  switch (sourceKind) {
    case 'conference_paper':
      if (remaining.length >= 2 && looksOrganizationLike(last)) {
        metadata.publisher = last;
        metadata.booktitle = remaining.slice(0, -1).join(', ');
      } else {
        metadata.booktitle = remaining.join(', ');
      }
      break;
    case 'book':
      metadata.publisher = remaining.join(', ') || metadata.normalized;
      break;
    case 'book_chapter':
      if (remaining.length >= 2 && looksOrganizationLike(last)) {
        metadata.publisher = last;
        metadata.booktitle = remaining.slice(0, -1).join(', ');
      } else {
        metadata.booktitle = remaining.join(', ');
      }
      break;
    case 'government_report':
      metadata.institution = remaining.join(', ') || metadata.normalized;
      break;
    case 'thesis_dissertation':
      metadata.school = remaining.join(', ') || metadata.normalized;
      break;
    case 'documentation':
      metadata.organization = first || metadata.normalized;
      metadata.howpublished = remaining.slice(1).join(', ') || metadata.reportNumber;
      break;
    case 'web_article':
    case 'dataset':
    case 'archive_record':
    case 'interview_notes':
      if (remaining.length >= 2 && looksOrganizationLike(last)) {
        metadata.organization = last;
        metadata.howpublished = remaining.slice(0, -1).join(', ');
      } else {
        metadata.organization = remaining.join(', ') || metadata.normalized;
      }
      break;
    default:
      metadata.organization = remaining.join(', ') || metadata.normalized;
      break;
  }

  return metadata;
}

function appendPart(parts: string[], value: string, prefix = '') {
  const normalized = cleanSegment(value);
  if (!normalized) return;
  parts.push(prefix ? `${prefix}${normalized}` : normalized);
}

export function buildSourceVenueDisplayFromMetadata(sourceKind: SourceVenueKind, metadata: ParsedSourceVenueMetadata) {
  const parts: string[] = [];

  switch (sourceKind) {
    case 'journal_article':
      appendPart(parts, metadata.journal);
      if (metadata.volume && metadata.number) {
        parts.push(`${metadata.volume} (${metadata.number})`);
      } else {
        appendPart(parts, metadata.volume);
        appendPart(parts, metadata.number);
      }
      if (metadata.articleNumber) appendPart(parts, metadata.articleNumber, 'Art. ');
      if (metadata.pages) appendPart(parts, metadata.pages, 'pp. ');
      break;
    case 'conference_paper':
      appendPart(parts, metadata.booktitle);
      appendPart(parts, metadata.edition);
      if (metadata.pages) appendPart(parts, metadata.pages, 'pp. ');
      appendPart(parts, metadata.publisher);
      break;
    case 'book':
      appendPart(parts, metadata.publisher);
      appendPart(parts, metadata.edition);
      break;
    case 'book_chapter':
      appendPart(parts, metadata.booktitle);
      appendPart(parts, metadata.edition);
      if (metadata.pages) appendPart(parts, metadata.pages, 'pp. ');
      appendPart(parts, metadata.publisher);
      break;
    case 'government_report':
      appendPart(parts, metadata.institution);
      appendPart(parts, metadata.reportNumber);
      break;
    case 'thesis_dissertation':
      appendPart(parts, metadata.school);
      appendPart(parts, metadata.reportNumber);
      break;
    case 'documentation':
      appendPart(parts, metadata.organization);
      appendPart(parts, metadata.howpublished || metadata.reportNumber);
      appendPart(parts, metadata.edition);
      break;
    case 'web_article':
    case 'dataset':
    case 'archive_record':
    case 'interview_notes':
      appendPart(parts, metadata.organization);
      appendPart(parts, metadata.howpublished || metadata.reportNumber);
      break;
    default:
      appendPart(parts, metadata.normalized);
      break;
  }

  return parts.join(', ') || metadata.normalized;
}

export function buildSourceVenueDisplay(sourceKind: SourceVenueKind, venue: string) {
  return buildSourceVenueDisplayFromMetadata(sourceKind, parseSourceVenueMetadata(sourceKind, venue));
}

export function looksLikeCompleteArticleVenue(value: string) {
  const parsed = parseArticleVenue(value);
  return Boolean(parsed.journal && parsed.volume && (parsed.pages || parsed.articleNumber));
}
