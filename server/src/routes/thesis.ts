import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { getUserFromAuthHeader } from '../lib/request-auth.js';
import { supabase } from '../lib/supabase.js';
import { getGitLabToken, storeGitLabToken } from '../lib/gitlab-token.js';
import {
  createDefaultThesisDocumentSeed,
  DEFAULT_THESIS_EXAMPLE_PATH,
  isKyleHicksDisplayName,
} from '../lib/thesis-default.js';
import { chat, getServerOpenAiCredential, getServerOpenAiPrimaryModel, type AIProviderSelection } from '../ai-providers.js';

type RepoProvider = 'github' | 'gitlab';

type ThesisDocumentRow = {
  user_id: string;
  draft: string;
  editor_theme: string | null;
  snapshot: unknown;
  repo_sync_status: 'idle' | 'saved' | 'error';
  repo_sync_error: string | null;
  repo_synced_at: string | null;
  updated_at: string;
};

type ThesisRepoLinkRow = {
  id: string;
  user_id: string;
  provider: RepoProvider;
  repo: string;
  host: string | null;
  branch: string | null;
  file_path: string;
  file_paths: unknown;
  sync_all_workspace_files: boolean;
  last_synced_file_paths: unknown;
  autosave_enabled: boolean;
  token_encrypted: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  updated_at: string;
};

type EncryptedTokenFields = {
  tokenEncrypted?: string | null;
  tokenIv?: string | null;
  tokenAuthTag?: string | null;
};

type GitLabIntegrationConfig = {
  repoUrl?: string;
  repoPath?: string;
  repo?: string;
  repos?: string[];
  token?: string;
  tokenEncrypted?: string;
  tokenIv?: string;
  tokenAuthTag?: string;
  host?: string;
};

type ProjectMemberRow = {
  project_id: string;
};

type GitLabIntegrationRow = {
  project_id: string;
  config: GitLabIntegrationConfig | null;
};

type UserProjectGitLabTokenRow = {
  project_id: string;
  host: string;
  token_encrypted: string;
  token_iv: string;
  token_auth_tag: string;
};

type ThesisRenderWorkspaceFile = {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  mimeType?: string | null;
};

type ThesisRenderWorkspace = {
  files: ThesisRenderWorkspaceFile[];
  folders: string[];
};

type ThesisRenderDiagnostic = {
  filePath: string | null;
  lineNumber: number;
  message: string;
  severity: 'error' | 'warning';
};

type ThesisSourceQueueStatus = 'queued' | 'analyzed' | 'tagged';
type ThesisSourceQueueType = 'paper' | 'web' | 'dataset' | 'notes' | 'document';
type ThesisSourceIntakeMethod = 'url' | 'pdf' | 'manual';
type ThesisSourceKind =
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
type ThesisSourceLibraryType = 'pdf' | 'link' | 'book' | 'paper' | 'report' | 'notes' | 'dataset';
type ThesisSourceRole = 'primary' | 'secondary' | 'contextual';
type ThesisSourceVerification = 'verified' | 'provisional' | 'restricted';
type ThesisSourceChapterTarget = 'literature_review' | 'methods' | 'findings' | 'appendix';

type ThesisSourceQueueItem = {
  id: string;
  title: string;
  type: ThesisSourceQueueType;
  status: ThesisSourceQueueStatus;
  insight: string;
};

type ThesisSourceLibraryItem = {
  id: string;
  citeKey: string;
  title: string;
  type: ThesisSourceLibraryType;
  acquisitionMethod: ThesisSourceIntakeMethod;
  sourceKind: ThesisSourceKind;
  status: ThesisSourceQueueStatus;
  role: ThesisSourceRole;
  verification: ThesisSourceVerification;
  chapterTarget: ThesisSourceChapterTarget;
  credit: string;
  venue: string;
  year: string;
  locator: string;
  citation: string;
  abstract: string;
  notes: string;
  tags: string[];
  addedOn: string;
  attachmentName: string;
  attachmentStoragePath: string;
  attachmentMimeType: string;
  attachmentUploadedAt: string;
};

type ThesisSourceSnapshot = {
  sourceLibrary: ThesisSourceLibraryItem[];
  sourceQueueItems: ThesisSourceQueueItem[];
  thesisDocuments: ThesisSupportingDocumentItem[];
};

type ThesisSupportingDocumentItem = {
  id: string;
  title: string;
  description: string;
  contribution: string;
  extractedTextPreview: string;
  linkedSourceId: string | null;
  addedOn: string;
  attachmentName: string;
  attachmentStoragePath: string;
  attachmentMimeType: string;
  attachmentUploadedAt: string;
};

type ParsedThesisSourceRecord = {
  filename: string;
  pageCount: number;
  title: string | null;
  credit: string | null;
  contextField: string | null;
  year: string | null;
  abstract: string | null;
  summary: string | null;
  keywords: string[];
  locator: string;
  citation: string | null;
  sourceKind: ThesisSourceKind | null;
  sourceTypeLabel: string | null;
  extractedTextPreview: string | null;
};

type ThesisKnowledgeLinkedProject = {
  id: string;
  name: string;
  description: string | null;
  github_repo: string | null;
  github_repos: string[] | null;
  gitlab_repos?: string[] | null;
};

type ThesisKnowledgeLinkedGoal = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  status: string;
  progress: number;
  category: string | null;
  loe: string | null;
};

type ThesisKnowledgeLinkedEvent = {
  id: string;
  project_id: string;
  source: string;
  event_type: string;
  title: string | null;
  summary: string | null;
  occurred_at: string;
};

type ThesisKnowledgeNodeKind = 'source' | 'theme' | 'document' | 'chapter' | 'credit' | 'reference' | 'project' | 'repo';

type ThesisKnowledgeGraphNode = {
  id: string;
  label: string;
  kind: ThesisKnowledgeNodeKind;
  size: number;
  score: number;
  detail: string;
  meta: string[];
  relatedSourceIds: string[];
};

type ThesisKnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind:
    | 'source-theme'
    | 'source-document'
    | 'source-chapter'
    | 'source-credit'
    | 'source-source'
    | 'document-theme'
    | 'source-reference'
    | 'project-theme'
    | 'project-source'
    | 'project-document'
    | 'project-repo';
  strength: number;
};

type ThesisKnowledgeThemeSummary = {
  id: string;
  label: string;
  count: number;
  sourceIds: string[];
};

type ThesisKnowledgeCoverageSummary = {
  id: string;
  label: string;
  count: number;
  sourceIds: string[];
};

type ThesisKnowledgeInsight = {
  title: string;
  body: string;
};

type ThesisKnowledgeSourceBrief = {
  id: string;
  title: string;
  summary: string;
  signals: string[];
};

type ThesisKnowledgeGraphPayload = {
  generatedAt: string;
  stats: {
    sourceCount: number;
    documentCount: number;
    projectCount: number;
    themeCount: number;
    connectionCount: number;
    hydratedSourceCount: number;
  };
  nodes: ThesisKnowledgeGraphNode[];
  edges: ThesisKnowledgeGraphEdge[];
  themes: ThesisKnowledgeThemeSummary[];
  coverage: ThesisKnowledgeCoverageSummary[];
  insights: ThesisKnowledgeInsight[];
  sourceBriefs: ThesisKnowledgeSourceBrief[];
};

type ThesisKnowledgeAiThemeSuggestion = {
  label: string;
  detail: string | null;
  sourceIds: string[];
  documentIds: string[];
  projectIds: string[];
};

type ThesisKnowledgeAiLinkSuggestion = {
  sourceLinks: Array<{
    leftSourceId: string;
    rightSourceId: string;
    strength: number;
    rationale: string | null;
  }>;
  documentSourceLinks: Array<{
    documentId: string;
    sourceId: string;
    strength: number;
    rationale: string | null;
  }>;
  projectSourceLinks: Array<{
    projectId: string;
    sourceId: string;
    strength: number;
    rationale: string | null;
  }>;
  projectDocumentLinks: Array<{
    projectId: string;
    documentId: string;
    strength: number;
    rationale: string | null;
  }>;
};

type ThesisKnowledgeAiEnhancement = ThesisKnowledgeAiLinkSuggestion & {
  themes: ThesisKnowledgeAiThemeSuggestion[];
  insights: string[];
};

const execFileAsync = promisify(execFile);
const MAX_RENDER_SOURCE_BYTES = 2_000_000;
const LATEX_RENDER_TIMEOUT_MS = 30_000;
const MAX_SOURCE_PDF_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_TEXT_PREVIEW_CHARS = 2_000;
const MAX_SOURCE_ABSTRACT_CHARS = 1_200;
const MAX_DOCUMENT_TEXT_PREVIEW_CHARS = 3_000;
const SOURCE_URL_FETCH_TIMEOUT_MS = 15_000;
const THESIS_SOURCE_BUCKET = 'project-documents';
const KNOWLEDGE_GRAPH_THEME_LIMIT = 10;
const KNOWLEDGE_GRAPH_AI_THEME_LIMIT = 6;
const KNOWLEDGE_GRAPH_THEME_OUTPUT_LIMIT = 12;
const KNOWLEDGE_GRAPH_SOURCE_THEME_LIMIT = 3;
const KNOWLEDGE_GRAPH_SOURCE_REFERENCE_LIMIT = 4;
const KNOWLEDGE_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'among', 'analysis', 'article', 'been', 'before', 'being', 'between',
  'both', 'brief', 'chapter', 'claim', 'could', 'dataset', 'defense', 'document', 'documents', 'evidence',
  'finding', 'findings', 'first', 'from', 'have', 'having', 'into', 'journal', 'linked', 'method', 'methods',
  'notes', 'paper', 'project', 'report', 'research', 'result', 'results', 'review', 'section', 'should', 'source',
  'sources', 'study', 'support', 'summary', 'their', 'there', 'these', 'they', 'this', 'thesis', 'those', 'through',
  'under', 'using', 'very', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'within', 'would', 'year',
  'your',
]);

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === 'string'));
}

function cleanPdfMetadataValue(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = compactWhitespace(value.replace(/\u0000/g, ' '));
  if (!cleaned) return null;
  if (/^(untitled|microsoft word|acrobat distiller|word|pdf|document)$/i.test(cleaned)) return null;
  return cleaned;
}

function cleanPdfFilename(filename: string) {
  return compactWhitespace(filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '));
}

function sanitizeStorageName(filename: string) {
  const normalized = filename
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'upload.pdf';
}

function normalizeThesisDocumentMimeType(mimeType: string, filename: string) {
  const normalizedMime = mimeType.trim().toLowerCase();
  const normalizedFilename = filename.trim().toLowerCase();
  if (normalizedFilename.endsWith('.step') || normalizedFilename.endsWith('.stp')) {
    return 'application/step';
  }
  if (normalizedFilename.endsWith('.png')) {
    return 'image/png';
  }
  if (normalizedFilename.endsWith('.jpg') || normalizedFilename.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (normalizedFilename.endsWith('.webp')) {
    return 'image/webp';
  }
  if (normalizedFilename.endsWith('.gif')) {
    return 'image/gif';
  }
  if (normalizedMime === 'application/x-step' || normalizedMime === 'model/step') {
    return 'application/step';
  }
  return normalizedMime || 'application/octet-stream';
}

async function extractDocumentTextPreview(fileBuffer: Buffer, mimeType: string, filename: string) {
  const normalizedMime = normalizeThesisDocumentMimeType(mimeType, filename);
  const normalizedFilename = filename.toLowerCase();

  if (normalizedMime === 'application/pdf' || normalizedFilename.endsWith('.pdf')) {
    try {
      const pdfData = await pdfParse(fileBuffer);
      return compactWhitespace(pdfData.text ?? '').slice(0, MAX_DOCUMENT_TEXT_PREVIEW_CHARS);
    } catch {
      return '';
    }
  }

  const isPlainTextLike = normalizedMime.startsWith('text/')
    || /(json|xml|yaml|csv|javascript|typescript|x-tex|tex|markdown|step)/.test(normalizedMime)
    || /\.(txt|md|tex|bib|csv|json|ya?ml|xml|html?|step|stp)$/i.test(normalizedFilename);

  if (!isPlainTextLike) return '';

  try {
    return compactWhitespace(new TextDecoder('utf-8', { fatal: false }).decode(fileBuffer)).slice(0, MAX_DOCUMENT_TEXT_PREVIEW_CHARS);
  } catch {
    return '';
  }
}

function isLikelyAuthorLine(line: string) {
  if (!line || line.length > 220) return false;
  if (/\b(abstract|keywords?|introduction|journal|conference|proceedings|report|vol\.|issue|doi)\b/i.test(line)) return false;
  if (/\d{4}/.test(line) && !/\b(et al\.?)\b/i.test(line)) return false;
  const surnameFirstMatches = line.match(/\b[A-Z][A-Za-z'`-]{1,}\s*,\s*[A-Z][A-Za-z.'`-]{1,}\b/g) ?? [];
  if (surnameFirstMatches.length >= 2) return true;
  if (surnameFirstMatches.length >= 1 && /(?:^|,)\s*&\s*[A-Z]/.test(line)) return true;
  const personMatches = line.match(/\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\s+[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\b/g) ?? [];
  return personMatches.length >= 1 && personMatches.join(' ').length >= Math.max(8, Math.floor(line.length * 0.45));
}

function isLikelyVenueLine(line: string) {
  return /\b(journal|conference|proceedings|transactions|symposium|workshop|university|press|review|report|laboratory|lab|institute|school|department|doi|issn|isbn|technical report|white paper|preprint|arxiv)\b/i.test(line);
}

function isLikelyCoverSheetNoise(line: string) {
  return (
    /\bthis may be the author'?s version\b/i.test(line)
    || /\bsubmitted\/accepted for publication\b/i.test(line)
    || /\bdownloaded from\b/i.test(line)
    || /\bconsult author\(s\) regarding copyright matters\b/i.test(line)
    || /\bcreative commons licence\b/i.test(line)
    || /\bversion of record\b/i.test(line)
    || /\bif you believe that this work infringes copyright\b/i.test(line)
    || /\bqueensland university of technology\b/i.test(line)
    || /https?:\/\//i.test(line)
    || /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(line)
  );
}

function isLikelyYearLine(line: string) {
  return /^\(?((19|20)\d{2})\)?$/.test(line.trim());
}

function extractYearFromLine(line: string) {
  return line.match(/\b((?:19|20)\d{2})\b/)?.[1] ?? null;
}

function hasLikelyCoverSheet(lines: string[]) {
  return lines.slice(0, 30).some((line) => isLikelyCoverSheetNoise(line));
}

function isSentenceLikeNonTitle(line: string) {
  const trimmed = line.trim();
  const wordCount = trimmed.split(/\s+/).length;
  const lower = trimmed.toLowerCase();
  const stopWordCount = (lower.match(/\b(the|a|an|is|are|was|were|be|been|being|to|of|for|in|on|at|by|with|from|that|this|these|those|both|and)\b/g) ?? []).length;

  if (
    /^(the purpose of|existing approaches?|this paper|in this paper|we propose|we present|we describe|we introduce|our approach|our method|our results)\b/i.test(trimmed)
  ) return true;
  if (/\b(the purpose|goal|objective|aim)\b/i.test(trimmed)) return true;
  if (/[.]$/.test(trimmed)) return true;
  if (wordCount >= 14 && /\b(is|are|was|were|be|been|being|have|has|had)\b/i.test(trimmed)) return true;
  if (wordCount >= 16 && stopWordCount / Math.max(wordCount, 1) > 0.48) return true;
  return false;
}

function isLikelyTitleCandidateLine(line: string) {
  const trimmed = line.trim();
  if (trimmed.length < 12 || trimmed.length > 160) return false;
  if (isLikelyCoverSheetNoise(trimmed)) return false;
  if (isLikelyAuthorLine(trimmed) || isLikelyVenueLine(trimmed) || isLikelyYearLine(trimmed)) return false;
  if (/^(abstract|keywords?|introduction|notice|copyright)\b/i.test(trimmed)) return false;
  if (/;/.test(trimmed)) return false;
  if ((trimmed.match(/,/g) ?? []).length > 1) return false;
  if (/^(this|unless|if|it|please|copyright|notice)\b/i.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 4 || wordCount > 22) return false;
  if (isSentenceLikeNonTitle(trimmed)) return false;
  return /[A-Za-z]/.test(trimmed);
}

function scoreTitleCandidateLine(line: string) {
  let score = 0;
  if (line.length >= 24 && line.length <= 110) score += 3;
  if (line.length > 110) score += 1;
  if (/^[A-Z]/.test(line)) score += 1;
  if (!/[.!?]$/.test(line)) score += 1;
  if ((line.match(/:/g) ?? []).length === 1) score += 1;
  if (/-/.test(line)) score += 1;
  if (/\b(approach|analysis|design|model|method|framework|calibration|camera|thermal|infrared|system|estimation|learning|measurement|vision|detection)\b/i.test(line)) score += 3;
  if ((line.match(/\b(of|for|with|using|based|and|in)\b/gi) ?? []).length >= 1) score += 1;
  if (/^(a|an|the)\b/i.test(line)) score += 1;
  if (isSentenceLikeNonTitle(line)) score -= 10;
  if (isLikelyCoverSheetNoise(line)) score -= 8;
  return score;
}

function finalizeTitleText(value: string) {
  return compactWhitespace(value).replace(/[.,;:]+$/, '').trim();
}

function findTitleBlock(lines: string[]) {
  let best: { title: string; startIndex: number; endIndex: number; score: number } | null = null;
  const coverSheetDetected = hasLikelyCoverSheet(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isLikelyTitleCandidateLine(line)) continue;

    const blockLines = [line];
    let score = scoreTitleCandidateLine(line);
    let endIndex = index;

    for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 4); nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (!isLikelyTitleCandidateLine(nextLine)) break;
      if ((nextLine.match(/,/g) ?? []).length > 0) break;
      if (nextLine.length > 90) break;
      blockLines.push(nextLine);
      score += scoreTitleCandidateLine(nextLine) + 1;
      endIndex = nextIndex;
      if (/[.!?]$/.test(nextLine)) break;
    }

    const previousLine = lines[index - 1] ?? '';
    const previousPreviousLine = lines[index - 2] ?? '';
    const nextLine = lines[endIndex + 1] ?? '';
    const nextNextLine = lines[endIndex + 2] ?? '';
    if (isLikelyYearLine(previousLine) || extractYearFromLine(previousLine) || extractYearFromLine(previousPreviousLine)) score += 2;
    if (isLikelyAuthorLine(previousLine)) score += 2;
    if (isLikelyAuthorLine(nextLine)) score += 4;
    if (isLikelyVenueLine(nextLine)) score += 2;
    if (isLikelyVenueLine(nextNextLine)) score += 2;
    if (index <= 20) score += 1;
    if (coverSheetDetected && index <= 5) score -= 4;
    if (coverSheetDetected && isLikelyAuthorLine(nextLine)) score += 2;

    const title = finalizeTitleText(blockLines.join(' '));
    if (!best || score > best.score) {
      best = { title, startIndex: index, endIndex, score };
    }
  }

  return best;
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 12): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = compactWhitespace(value ?? '');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeStringField(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return compactWhitespace(value).slice(0, maxLength);
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  const results: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeStringField(item, maxLength);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
    if (results.length >= maxItems) break;
  }
  return results;
}

function normalizeSourceQueueStatus(value: unknown): ThesisSourceQueueStatus {
  return value === 'analyzed' || value === 'tagged' ? value : 'queued';
}

function normalizeSourceQueueType(value: unknown): ThesisSourceQueueType {
  return value === 'web' || value === 'dataset' || value === 'notes' || value === 'document'
    ? value
    : 'paper';
}

function normalizeSourceLibraryType(value: unknown): ThesisSourceLibraryType {
  return value === 'pdf' || value === 'link' || value === 'book' || value === 'report' || value === 'notes' || value === 'dataset'
    ? value
    : 'paper';
}

function normalizeSourceAcquisitionMethod(value: unknown): ThesisSourceIntakeMethod {
  return value === 'url' || value === 'manual' ? value : 'pdf';
}

function normalizeSourceKind(value: unknown): ThesisSourceKind {
  return value === 'conference_paper'
    || value === 'book'
    || value === 'book_chapter'
    || value === 'government_report'
    || value === 'thesis_dissertation'
    || value === 'dataset'
    || value === 'interview_notes'
    || value === 'archive_record'
    || value === 'web_article'
    || value === 'documentation'
    ? value
    : 'journal_article';
}

function normalizeSourceRole(value: unknown): ThesisSourceRole {
  return value === 'primary' || value === 'contextual' ? value : 'secondary';
}

function normalizeSourceVerification(value: unknown): ThesisSourceVerification {
  return value === 'verified' || value === 'restricted' ? value : 'provisional';
}

function normalizeSourceChapterTarget(value: unknown): ThesisSourceChapterTarget {
  return value === 'methods' || value === 'findings' || value === 'appendix'
    ? value
    : 'literature_review';
}

function normalizeSourceQueueItem(value: unknown): ThesisSourceQueueItem | null {
  const record = asObject(value);
  if (!record) return null;

  const title = normalizeStringField(record.title, 240);
  const insight = normalizeStringField(record.insight, 1_200);
  if (!title || !insight) return null;

  return {
    id: normalizeStringField(record.id, 120) || `src-${Date.now().toString(36)}`,
    title,
    type: normalizeSourceQueueType(record.type),
    status: normalizeSourceQueueStatus(record.status),
    insight,
  };
}

function normalizeSourceLibraryItem(value: unknown): ThesisSourceLibraryItem | null {
  const record = asObject(value);
  if (!record) return null;

  const title = normalizeStringField(record.title, 240);
  const credit = normalizeSourceCreditValue(normalizeStringField(record.credit, 240));
  const venue = normalizeStringField(record.venue, 240);
  const year = normalizeStringField(record.year, 16);
  const locator = normalizeStringField(record.locator, 1_000);
  if (!title || !credit || !venue || !year || !locator) return null;

  return {
    id: normalizeStringField(record.id, 120) || `lib-${Date.now().toString(36)}`,
    citeKey: normalizeStringField(record.citeKey, 160) || normalizeStringField(record.id, 120) || `source_${Date.now().toString(36)}`,
    title,
    type: normalizeSourceLibraryType(record.type),
    acquisitionMethod: normalizeSourceAcquisitionMethod(record.acquisitionMethod),
    sourceKind: normalizeSourceKind(record.sourceKind),
    status: normalizeSourceQueueStatus(record.status),
    role: normalizeSourceRole(record.role),
    verification: normalizeSourceVerification(record.verification),
    chapterTarget: normalizeSourceChapterTarget(record.chapterTarget),
    credit,
    venue,
    year,
    locator,
    citation: normalizeStringField(record.citation, 8_000),
    abstract: normalizeStringField(record.abstract, 4_000),
    notes: normalizeStringField(record.notes, 4_000),
    tags: normalizeStringArray(record.tags, 20, 64),
    addedOn: normalizeStringField(record.addedOn, 32) || new Date().toISOString().slice(0, 10),
    attachmentName: normalizeStringField(record.attachmentName, 260),
    attachmentStoragePath: normalizeStringField(record.attachmentStoragePath, 1_000),
    attachmentMimeType: normalizeStringField(record.attachmentMimeType, 160),
    attachmentUploadedAt: normalizeStringField(record.attachmentUploadedAt, 64),
  };
}

function readSourceSnapshot(snapshot: unknown): ThesisSourceSnapshot {
  const record = asObject(snapshot);
  const sourceLibrary = Array.isArray(record?.sourceLibrary)
    ? record.sourceLibrary
        .map((item) => normalizeSourceLibraryItem(item))
        .filter((item): item is ThesisSourceLibraryItem => Boolean(item))
    : [];
  const sourceQueueItems = Array.isArray(record?.sourceQueueItems)
    ? record.sourceQueueItems
        .map((item) => normalizeSourceQueueItem(item))
        .filter((item): item is ThesisSourceQueueItem => Boolean(item))
    : [];
  const thesisDocuments = Array.isArray(record?.thesisDocuments)
    ? record.thesisDocuments
        .map((item) => normalizeThesisSupportingDocument(item))
        .filter((item): item is ThesisSupportingDocumentItem => Boolean(item))
    : [];

  return { sourceLibrary, sourceQueueItems, thesisDocuments };
}

function mergeThesisSourceSnapshot(
  snapshot: unknown,
  libraryItem: ThesisSourceLibraryItem,
  queueItem: ThesisSourceQueueItem,
) {
  const baseSnapshot = asObject(snapshot) ?? {};
  const current = readSourceSnapshot(snapshot);

  return {
    ...baseSnapshot,
    sourceLibrary: [libraryItem, ...current.sourceLibrary.filter((item) => item.id !== libraryItem.id)],
    sourceQueueItems: [queueItem, ...current.sourceQueueItems.filter((item) => item.id !== queueItem.id)],
    thesisDocuments: current.thesisDocuments,
  };
}

function normalizeThesisSupportingDocument(value: unknown): ThesisSupportingDocumentItem | null {
  const record = asObject(value);
  if (!record) return null;

  const id = normalizeStringField(record.id, 160);
  const title = normalizeStringField(record.title, 260);
  const description = normalizeStringField(record.description, 4_000);
  const contribution = normalizeStringField(record.contribution, 4_000);

  if (!id || !title || !description || !contribution) return null;

  return {
    id,
    title,
    description,
    contribution,
    extractedTextPreview: normalizeStringField(record.extractedTextPreview, MAX_DOCUMENT_TEXT_PREVIEW_CHARS),
    linkedSourceId: normalizeStringField(record.linkedSourceId, 160),
    addedOn: normalizeStringField(record.addedOn, 32) || new Date().toISOString().slice(0, 10),
    attachmentName: normalizeStringField(record.attachmentName, 260),
    attachmentStoragePath: normalizeStringField(record.attachmentStoragePath, 1_000),
    attachmentMimeType: normalizeStringField(record.attachmentMimeType, 160),
    attachmentUploadedAt: normalizeStringField(record.attachmentUploadedAt, 64),
  };
}

function extractKeywordList(text: string, filename: string): string[] {
  const explicitKeywords = text.match(/(?:^|\n)\s*(?:keywords?|index terms)\s*[:\-]\s*([^\n]+)/i)?.[1] ?? '';
  const normalizedExplicit = explicitKeywords
    .split(/[;,]/)
    .map((value) => compactWhitespace(value))
    .filter((value) => value.length >= 3 && value.length <= 40);
  if (normalizedExplicit.length > 0) {
    return uniqueStrings(normalizedExplicit, 10);
  }

  const tokens = `${cleanPdfFilename(filename)} ${text}`
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'will', 'your', 'into', 'about',
    'were', 'which', 'what', 'when', 'where', 'while', 'them', 'then', 'than', 'http', 'https',
    'paper', 'article', 'journal', 'conference', 'abstract', 'keywords', 'introduction', 'conclusion',
    'using', 'used', 'study', 'results', 'method', 'methods', 'analysis',
  ]);

  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (stopWords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([keyword]) => keyword);
}

function extractAbstract(text: string) {
  const abstractMatch = text.match(
    /(?:^|\n)\s*abstract\b[\s:.-]*([\s\S]{80,2200}?)(?=\n\s*(?:keywords?|index terms|1\.?\s+introduction|introduction|background|contents?)\b|$)/i,
  );
  if (abstractMatch?.[1]) {
    return compactWhitespace(abstractMatch[1]).slice(0, MAX_SOURCE_ABSTRACT_CHARS);
  }

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => compactWhitespace(paragraph))
    .filter((paragraph) => paragraph.length >= 120);
  return paragraphs[0]?.slice(0, MAX_SOURCE_ABSTRACT_CHARS) ?? null;
}

function extractSummary(text: string) {
  const normalized = compactWhitespace(text);
  if (!normalized) return null;
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  return compactWhitespace(sentences.slice(0, 2).join(' ')).slice(0, 320) || null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtmlTags(value: string) {
  return compactWhitespace(decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')));
}

function parseHtmlAttributes(tag: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([.:@a-zA-Z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const key = match[1]?.toLowerCase();
    const value = decodeHtmlEntities(match[3] ?? match[4] ?? match[5] ?? '');
    if (!key || !value) continue;
    attributes.set(key, value);
  }
  return attributes;
}

function splitKeywordValues(values: string[]) {
  return uniqueStrings(
    values
      .flatMap((value) => value.split(/[;,|]/g))
      .map((value) => compactWhitespace(value))
      .filter((value) => value.length >= 2 && value.length <= 80),
    12,
  );
}

function extractYearFromDateValue(value: string | null | undefined) {
  return value?.match(/\b((?:19|20)\d{2})\b/)?.[1] ?? null;
}

function normalizeTitleCandidate(value: string) {
  return compactWhitespace(
    decodeHtmlEntities(value)
      .replace(/\s*[|·•]\s*/g, ' | ')
      .replace(/\s+/g, ' '),
  );
}

function chooseBestCandidate(values: Array<string | null | undefined>, minLength = 1, maxLength = 320) {
  return uniqueStrings(values, 20).find((value) => value.length >= minLength && value.length <= maxLength) ?? null;
}

function cleanHtmlTitle(title: string, siteName: string | null, host: string) {
  const normalized = normalizeTitleCandidate(title);
  if (!normalized) return null;
  const parts = normalized.split(/\s(?:\||-|:)\s/).map((part) => compactWhitespace(part)).filter(Boolean);
  if (parts.length < 2) return normalized;
  const siteHints = uniqueStrings([
    siteName,
    host.replace(/^www\./i, ''),
    host.replace(/^www\./i, '').split('.')[0] ?? null,
  ]);
  const lastPart = parts[parts.length - 1]?.toLowerCase() ?? '';
  const matchesSite = siteHints.some((hint) => lastPart.includes(hint.toLowerCase()));
  if (matchesSite && parts[0] && parts[0].length >= 12) {
    return parts[0];
  }
  return normalized;
}

function buildSourceCitation(
  title: string | null,
  credit: string | null,
  year: string | null,
  contextField: string | null,
  locator: string,
) {
  const titleText = title?.trim();
  const creditText = credit?.trim();
  const yearText = year?.trim();
  const contextText = contextField?.trim();
  if (!titleText) return null;

  const parts = [
    creditText || null,
    yearText ? `(${yearText})` : null,
    `${titleText}.`,
    contextText ? `${contextText}.` : null,
    locator ? `${locator}.` : null,
  ].filter(Boolean);

  return parts.length > 0 ? compactWhitespace(parts.join(' ')).slice(0, 8_000) : null;
}

function looksLikeOrganizationCredit(value: string) {
  const trimmed = compactWhitespace(value);
  if (!trimmed) return false;
  if (/[A-Z]{2,}/.test(trimmed) && !/[a-z]/.test(trimmed)) return true;
  return /\b(agency|department|office|committee|commission|command|center|centre|university|college|school|laboratory|lab|institute|administration|association|society|bureau|ministry|corps|navy|army|air force|marine|marines|government|council|press|publisher|organization|division|company|corporation|corp|inc|incorporated|llc|ltd|limited|plc|gmbh|group|holdings|systems|technologies|industries|international)\b/i.test(trimmed);
}

function normalizeSourceCreditText(value: string) {
  return compactWhitespace(
    value
      .replace(/\\&/g, '&')
      .replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2'),
  ).replace(/^[,;]+|[,;]+$/g, '');
}

function invertSurnameFirstCreditName(value: string) {
  const normalized = normalizeSourceCreditText(value);
  const parts = normalized.split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 2) {
    return normalizeSourceCreditText(`${parts[1]} ${parts[0]}`);
  }
  return normalized;
}

function extractCreditPeople(value: string) {
  const normalized = normalizeSourceCreditText(value);
  if (!normalized || looksLikeOrganizationCredit(normalized) || /^https?:\/\//i.test(normalized)) return [];

  const semicolonParts = normalized
    .split(/\s*;\s*|\s*\n+\s*/)
    .map((part) => invertSurnameFirstCreditName(part))
    .filter(Boolean);
  if (semicolonParts.length > 1) return semicolonParts;

  const commaCandidate = normalized
    .replace(/\s*,?\s*(?:and|&)\s+/gi, ', ')
    .replace(/\s*,\s*,+/g, ', ');
  const commaParts = commaCandidate
    .split(/\s*,\s*/)
    .map((part) => normalizeSourceCreditText(part))
    .filter(Boolean);
  if (commaParts.length >= 4 && commaParts.length % 2 === 0) {
    const names: string[] = [];
    for (let index = 0; index < commaParts.length; index += 2) {
      const family = commaParts[index];
      const given = commaParts[index + 1];
      if (!family || !given) continue;
      names.push(normalizeSourceCreditText(`${given} ${family}`));
    }
    if (names.length > 1) return names;
  }

  const conjunctionParts = normalized
    .split(/\s+(?:and|&)\s+/i)
    .map((part) => invertSurnameFirstCreditName(part))
    .filter(Boolean);
  if (conjunctionParts.length > 1) return conjunctionParts;

  return [invertSurnameFirstCreditName(normalized)];
}

function normalizeSourceCreditValue(value: string | null | undefined) {
  const normalized = normalizeSourceCreditText(value ?? '');
  if (!normalized) return null;
  if (looksLikeOrganizationCredit(normalized)) return normalized;
  const people = uniqueStrings(extractCreditPeople(normalized), 12);
  if (people.length > 1) return people.join('; ');
  return people[0] ?? normalized;
}

function normalizeSourceCreditCandidates(values: Array<string | null | undefined>) {
  const directCandidates = uniqueStrings(
    values
      .map((value) => normalizeSourceCreditValue(value))
      .filter((value): value is string => Boolean(value)),
    20,
  );
  if (directCandidates.length === 0) return null;

  const personCandidates = uniqueStrings(
    directCandidates.flatMap((value) => extractCreditPeople(value)),
    12,
  );
  if (personCandidates.length > 1) return personCandidates.join('; ');
  return personCandidates[0] ?? directCandidates[0] ?? null;
}

function collectJsonLdRecords(value: unknown, records: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdRecords(item, records);
    return records;
  }
  const record = asObject(value);
  if (!record) return records;
  records.push(record);
  if (Array.isArray(record['@graph'])) {
    for (const item of record['@graph']) collectJsonLdRecords(item, records);
  }
  return records;
}

function valueToStrings(value: unknown): string[] {
  if (typeof value === 'string') return [compactWhitespace(decodeHtmlEntities(value))].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((item) => valueToStrings(item));
  const record = asObject(value);
  if (!record) return [];
  return [
    ...valueToStrings(record.name),
    ...valueToStrings(record.headline),
    ...valueToStrings(record.title),
    ...valueToStrings(record['@value']),
  ];
}

function valueToPeople(value: unknown): string[] {
  if (typeof value === 'string') return [compactWhitespace(decodeHtmlEntities(value))].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((item) => valueToPeople(item));
  const record = asObject(value);
  if (!record) return [];
  return uniqueStrings([
    ...valueToStrings(record.name),
    ...valueToStrings(record.alternateName),
    ...valueToStrings(record.author),
    ...valueToStrings(record.creator),
  ], 12);
}

function inferUrlSourceKind(input: {
  url: URL;
  contentType: string;
  sourceTypeHints: string[];
  title: string | null;
  venue: string | null;
  hasCitationJournal: boolean;
}) {
  const host = input.url.hostname.toLowerCase();
  const pathName = input.url.pathname.toLowerCase();
  const hints = input.sourceTypeHints.map((value) => value.toLowerCase());
  const title = (input.title ?? '').toLowerCase();
  const venue = (input.venue ?? '').toLowerCase();
  const combinedText = `${title} ${venue} ${pathName}`;

  if (input.contentType.includes('pdf')) return 'journal_article';
  if (hints.some((hint) => /\b(dataset|datacatalog)\b/.test(hint))) return 'dataset';
  if (hints.some((hint) => /\b(thesis|dissertation)\b/.test(hint))
    || /\b(thesis|dissertation|doctoral|masters?)\b/.test(combinedText)
    || /calhoun\.nps\.edu|proquest|dissertations?|etd/i.test(host + pathName)) {
    return 'thesis_dissertation';
  }
  if (hints.some((hint) => /\b(chapter)\b/.test(hint))) return 'book_chapter';
  if (hints.some((hint) => /\b(book)\b/.test(hint))) return 'book';
  if (/\b(conference|proceedings|symposium|workshop)\b/.test(combinedText)) {
    return 'conference_paper';
  }
  if (hints.some((hint) => /\b(apireference|softwareapplication|techarticle)\b/.test(hint))
    || /(^|\/)(docs?|documentation|reference|manual|guide|api)(\/|$)/.test(pathName)
    || /\b(docs?|documentation|reference|manual|guide|api)\b/.test(title)) {
    return 'documentation';
  }
  if (/archive\.org|webcache|wayback/i.test(host + pathName) || /\barchive\b/.test(title)) return 'archive_record';
  if (
    hints.some((hint) => /\b(report|whitepaper|technicalreport|governmentservice|legislation)\b/.test(hint))
    || /\.(gov|mil)$/i.test(host)
    || /\b(report|white paper|technical report|strategy|guidance)\b/.test(`${title} ${venue}`)
  ) {
    return 'government_report';
  }
  if (input.hasCitationJournal || hints.some((hint) => /\b(scholarlyarticle|article|medicalscholarlyarticle)\b/.test(hint))) {
    return 'journal_article';
  }
  return 'web_article';
}

function getSourceTypeLabel(kind: ThesisSourceKind | null) {
  if (kind === 'conference_paper') return 'Conference Paper / Proceedings';
  if (kind === 'book') return 'Book';
  if (kind === 'dataset') return 'Dataset';
  if (kind === 'book_chapter') return 'Book Chapter';
  if (kind === 'government_report') return 'Government / Technical Report';
  if (kind === 'thesis_dissertation') return 'Thesis / Dissertation';
  if (kind === 'interview_notes') return 'Interview / Personal Communication';
  if (kind === 'archive_record') return 'Archive / Collection Record';
  if (kind === 'documentation') return 'Manual / Standard / Documentation';
  if (kind === 'web_article') return 'Web Page / News / Blog';
  if (kind === 'journal_article') return 'Journal Article';
  return null;
}

/** Use AI to fill in missing citation fields from raw HTML + URL. Returns only the fields it found. */
async function aiEnhanceCitationMetadata(
  url: string,
  html: string,
  existing: { title?: string | null; credit?: string | null; year?: string | null; contextField?: string | null },
): Promise<{ title?: string; credit?: string; year?: string; contextField?: string }> {
  try {
    // Only use AI enhancement when a server-side AI key is configured
    const serverCred = getServerOpenAiCredential();
    if (!serverCred?.apiKey) return {};

    const provider: AIProviderSelection = `openai:${getServerOpenAiPrimaryModel('gpt-4o')}`;

    const missingFields = ([] as string[])
      .concat(!existing.title ? ['title (full document/article title)'] : [])
      .concat(!existing.credit ? ['author or organization responsible for this work'] : [])
      .concat(!existing.year ? ['publication year (4-digit)'] : [])
      .concat(!existing.contextField ? ['journal, publisher, or hosting organization'] : []);

    if (missingFields.length === 0) return {};

    // Trim HTML to useful text for the AI
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 4000);

    const result = await chat(provider, {
      system: 'You are a citation extraction assistant. Extract bibliographic metadata from web page text. Return ONLY valid JSON with the requested fields. If a field cannot be determined with reasonable confidence, omit it from the JSON.',
      user: `URL: ${url}

Page text excerpt:
${textContent}

Extract these missing citation fields as JSON:
${missingFields.map((f) => `- ${f}`).join('\n')}

Return JSON like: {"title":"...","author":"...","year":"2024","publisher":"..."} using only keys: title, author, year, publisher. Omit any key you are not confident about.`,
      maxTokens: 300,
    }, serverCred);

    const raw = result.text.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: { title?: string; credit?: string; year?: string; contextField?: string } = {};
    if (typeof parsed.title === 'string' && parsed.title.trim()) out.title = parsed.title.trim();
    if (typeof parsed.author === 'string' && parsed.author.trim()) out.credit = parsed.author.trim();
    if (typeof parsed.year === 'string' && /^\d{4}$/.test(parsed.year.trim())) out.year = parsed.year.trim();
    if (typeof parsed.publisher === 'string' && parsed.publisher.trim()) out.contextField = parsed.publisher.trim();
    return out;
  } catch {
    return {};
  }
}

function extractJsonPayload(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  let raw = fenced ? fenced[1].trim() : text.trim();
  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  const start = firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket);
  if (start > 0) raw = raw.slice(start);
  const lastBrace = raw.lastIndexOf('}');
  const lastBracket = raw.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end >= 0 && end < raw.length - 1) raw = raw.slice(0, end + 1);
  raw = raw.replace(/\/\/[^\n]*/g, '');
  raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  raw = raw.replace(/,(\s*[}\]])/g, '$1');
  return raw.trim();
}

function clampKnowledgeGraphStrength(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.7, Math.min(2.4, value));
}

async function aiEnhanceKnowledgeGraph(input: {
  sources: Array<{
    id: string;
    title: string;
    credit: string;
    venue: string;
    summary: string;
    terms: string[];
    references: string[];
  }>;
  documents: Array<{
    id: string;
    title: string;
    description: string;
    contribution: string;
    linkedSourceId: string | null;
    preview: string;
    terms: string[];
  }>;
  projects: Array<{
    id: string;
    name: string;
    description: string;
    repos: string[];
    goalTitles: string[];
    eventTitles: string[];
    terms: string[];
  }>;
  existingThemes: Array<{
    label: string;
    sourceIds: string[];
  }>;
}): Promise<ThesisKnowledgeAiEnhancement> {
  try {
    const serverCred = getServerOpenAiCredential();
    if (!serverCred?.apiKey) {
      return {
        themes: [],
        insights: [],
        sourceLinks: [],
        documentSourceLinks: [],
        projectSourceLinks: [],
        projectDocumentLinks: [],
      };
    }

    if (input.sources.length === 0 && input.documents.length === 0 && input.projects.length === 0) {
      return {
        themes: [],
        insights: [],
        sourceLinks: [],
        documentSourceLinks: [],
        projectSourceLinks: [],
        projectDocumentLinks: [],
      };
    }

    const provider: AIProviderSelection = `openai:${getServerOpenAiPrimaryModel('gpt-4o')}`;
    const result = await chat(provider, {
      system: [
        'You improve thesis knowledge graphs.',
        'Return ONLY valid JSON.',
        'Use only the provided node IDs.',
        'Prefer high-signal semantic relationships over weak keyword overlap.',
        'Every proposed theme must include at least one source ID.',
        `Return at most ${KNOWLEDGE_GRAPH_AI_THEME_LIMIT} themes per response.`,
      ].join(' '),
      user: JSON.stringify({
        instruction: {
          objective: 'Propose stronger thesis graph themes and semantic links across sources, supporting documents, and linked projects.',
          limits: {
            maxThemes: KNOWLEDGE_GRAPH_AI_THEME_LIMIT,
            maxSourceLinks: 8,
            maxDocumentSourceLinks: 8,
            maxProjectSourceLinks: 8,
            maxProjectDocumentLinks: 6,
            strengthRange: [0.7, 2.4],
          },
          themeRules: [
            'Use short human-readable labels.',
            'Themes should unify multiple evidence nodes when possible.',
            'Do not invent node IDs.',
          ],
          responseShape: {
            themes: [
              {
                label: 'string',
                detail: 'optional short explanation',
                sourceIds: ['source-id'],
                documentIds: ['document-id'],
                projectIds: ['project-node-id'],
              },
            ],
            sourceLinks: [
              {
                leftSourceId: 'source-id',
                rightSourceId: 'source-id',
                strength: 1.3,
                rationale: 'optional short reason',
              },
            ],
            documentSourceLinks: [
              {
                documentId: 'document-id',
                sourceId: 'source-id',
                strength: 1.2,
                rationale: 'optional short reason',
              },
            ],
            projectSourceLinks: [
              {
                projectId: 'project-node-id',
                sourceId: 'source-id',
                strength: 1.3,
                rationale: 'optional short reason',
              },
            ],
            projectDocumentLinks: [
              {
                projectId: 'project-node-id',
                documentId: 'document-id',
                strength: 1.2,
                rationale: 'optional short reason',
              },
            ],
            insights: ['optional short insight'],
          },
        },
        context: input,
      }),
      maxTokens: 1800,
      jsonMode: true,
    }, serverCred);

    const parsed = JSON.parse(extractJsonPayload(result.text)) as Record<string, unknown>;
    const safeThemes = Array.isArray(parsed.themes) ? parsed.themes : [];
    const safeInsights = Array.isArray(parsed.insights) ? parsed.insights : [];
    const safeSourceLinks = Array.isArray(parsed.sourceLinks) ? parsed.sourceLinks : [];
    const safeDocumentSourceLinks = Array.isArray(parsed.documentSourceLinks) ? parsed.documentSourceLinks : [];
    const safeProjectSourceLinks = Array.isArray(parsed.projectSourceLinks) ? parsed.projectSourceLinks : [];
    const safeProjectDocumentLinks = Array.isArray(parsed.projectDocumentLinks) ? parsed.projectDocumentLinks : [];

    const sourcesById = new Set(input.sources.map((item) => item.id));
    const documentsById = new Set(input.documents.map((item) => item.id));
    const projectsById = new Set(input.projects.map((item) => item.id));

    return {
      themes: safeThemes
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const candidate = item as Record<string, unknown>;
          const label = readString(candidate.label);
          const sourceIds = safeStringArray(candidate.sourceIds).filter((id) => sourcesById.has(id));
          if (!label || sourceIds.length === 0) return null;
          return {
            label,
            detail: readString(candidate.detail),
            sourceIds: uniqueStrings(sourceIds, 10),
            documentIds: uniqueStrings(safeStringArray(candidate.documentIds).filter((id) => documentsById.has(id)), 8),
            projectIds: uniqueStrings(safeStringArray(candidate.projectIds).filter((id) => projectsById.has(id)), 8),
          } satisfies ThesisKnowledgeAiThemeSuggestion;
        })
        .filter((item): item is ThesisKnowledgeAiThemeSuggestion => Boolean(item))
        .slice(0, KNOWLEDGE_GRAPH_AI_THEME_LIMIT),
      insights: uniqueStrings(
        safeInsights
          .map((item) => (typeof item === 'string' ? compactWhitespace(item) : ''))
          .filter(Boolean),
        3,
      ),
      sourceLinks: safeSourceLinks
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const candidate = item as Record<string, unknown>;
          const leftSourceId = readString(candidate.leftSourceId);
          const rightSourceId = readString(candidate.rightSourceId);
          if (!leftSourceId || !rightSourceId || leftSourceId === rightSourceId) return null;
          if (!sourcesById.has(leftSourceId) || !sourcesById.has(rightSourceId)) return null;
          return {
            leftSourceId,
            rightSourceId,
            strength: clampKnowledgeGraphStrength(typeof candidate.strength === 'number' ? candidate.strength : 1.2),
            rationale: readString(candidate.rationale),
          };
        })
        .filter((item): item is ThesisKnowledgeAiEnhancement['sourceLinks'][number] => Boolean(item))
        .slice(0, 8),
      documentSourceLinks: safeDocumentSourceLinks
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const candidate = item as Record<string, unknown>;
          const documentId = readString(candidate.documentId);
          const sourceId = readString(candidate.sourceId);
          if (!documentId || !sourceId) return null;
          if (!documentsById.has(documentId) || !sourcesById.has(sourceId)) return null;
          return {
            documentId,
            sourceId,
            strength: clampKnowledgeGraphStrength(typeof candidate.strength === 'number' ? candidate.strength : 1.15),
            rationale: readString(candidate.rationale),
          };
        })
        .filter((item): item is ThesisKnowledgeAiEnhancement['documentSourceLinks'][number] => Boolean(item))
        .slice(0, 8),
      projectSourceLinks: safeProjectSourceLinks
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const candidate = item as Record<string, unknown>;
          const projectId = readString(candidate.projectId);
          const sourceId = readString(candidate.sourceId);
          if (!projectId || !sourceId) return null;
          if (!projectsById.has(projectId) || !sourcesById.has(sourceId)) return null;
          return {
            projectId,
            sourceId,
            strength: clampKnowledgeGraphStrength(typeof candidate.strength === 'number' ? candidate.strength : 1.2),
            rationale: readString(candidate.rationale),
          };
        })
        .filter((item): item is ThesisKnowledgeAiEnhancement['projectSourceLinks'][number] => Boolean(item))
        .slice(0, 8),
      projectDocumentLinks: safeProjectDocumentLinks
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const candidate = item as Record<string, unknown>;
          const projectId = readString(candidate.projectId);
          const documentId = readString(candidate.documentId);
          if (!projectId || !documentId) return null;
          if (!projectsById.has(projectId) || !documentsById.has(documentId)) return null;
          return {
            projectId,
            documentId,
            strength: clampKnowledgeGraphStrength(typeof candidate.strength === 'number' ? candidate.strength : 1.1),
            rationale: readString(candidate.rationale),
          };
        })
        .filter((item): item is ThesisKnowledgeAiEnhancement['projectDocumentLinks'][number] => Boolean(item))
        .slice(0, 6),
    };
  } catch {
    return {
      themes: [],
      insights: [],
      sourceLinks: [],
      documentSourceLinks: [],
      projectSourceLinks: [],
      projectDocumentLinks: [],
    };
  }
}

async function inferUrlSourceMetadata(rawUrl: string): Promise<ParsedThesisSourceRecord> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('Enter a valid absolute URL.');
  }

  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_URL_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(parsedUrl.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Odyssey Thesis Source Ingest/1.0',
        accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Timed out while fetching that URL.');
    }
    throw new Error('Failed to fetch that URL.');
  }
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Could not fetch that URL (${response.status}).`);
  }

  const finalUrl = new URL(response.url || parsedUrl.toString());
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const filename = decodeURIComponent(finalUrl.pathname.split('/').filter(Boolean).pop() ?? finalUrl.hostname);

  if (contentType.includes('pdf') || /\.pdf(?:$|\?)/i.test(finalUrl.pathname)) {
    const fileBuffer = Buffer.from(await response.arrayBuffer());
    if (fileBuffer.byteLength === 0) {
      throw new Error('That PDF URL returned an empty file.');
    }
    if (fileBuffer.byteLength > MAX_SOURCE_PDF_BYTES) {
      throw new Error('That PDF URL exceeds the 32 MB ingest limit.');
    }
    const pdfData = await pdfParse(fileBuffer);
    const pdfRecord = inferPdfSourceMetadata(pdfData, filename || 'source.pdf');
    return {
      ...pdfRecord,
      locator: finalUrl.toString(),
      citation: buildSourceCitation(pdfRecord.title, pdfRecord.credit, pdfRecord.year, pdfRecord.contextField, finalUrl.toString()),
      sourceKind: pdfRecord.sourceKind ?? 'journal_article',
      sourceTypeLabel: pdfRecord.sourceTypeLabel ?? 'PDF',
      filename: filename || pdfRecord.filename,
    };
  }

  const html = await response.text();
  const metaMap = new Map<string, string[]>();
  const addMetaValue = (key: string | null | undefined, value: string | null | undefined) => {
    const normalizedKey = key?.trim().toLowerCase();
    const normalizedValue = value ? compactWhitespace(decodeHtmlEntities(value)) : '';
    if (!normalizedKey || !normalizedValue) return;
    metaMap.set(normalizedKey, [...(metaMap.get(normalizedKey) ?? []), normalizedValue]);
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0]);
    const key = attributes.get('name')
      || attributes.get('property')
      || attributes.get('itemprop')
      || attributes.get('http-equiv');
    const content = attributes.get('content');
    addMetaValue(key, content);
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0]);
    const rel = attributes.get('rel');
    const href = attributes.get('href');
    if (rel && href) addMetaValue(`link:${rel}`, href);
  }

  const jsonLdRecords: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      collectJsonLdRecords(JSON.parse(raw), jsonLdRecords);
    } catch {
      continue;
    }
  }

  const jsonLdTypes = uniqueStrings(
    jsonLdRecords.flatMap((record) => valueToStrings(record['@type'])),
    20,
  );
  const jsonLdTitles = uniqueStrings(
    jsonLdRecords.flatMap((record) => [
      ...valueToStrings(record.headline),
      ...valueToStrings(record.name),
      ...valueToStrings(record.title),
    ]),
    20,
  );
  const jsonLdAuthors = uniqueStrings(
    jsonLdRecords.flatMap((record) => [
      ...valueToPeople(record.author),
      ...valueToPeople(record.creator),
    ]),
    20,
  );
  const jsonLdDates = uniqueStrings(
    jsonLdRecords.flatMap((record) => [
      ...valueToStrings(record.datePublished),
      ...valueToStrings(record.dateCreated),
      ...valueToStrings(record.uploadDate),
    ]),
    20,
  );
  const jsonLdVenue = uniqueStrings(
    jsonLdRecords.flatMap((record) => [
      ...valueToStrings(record.publisher),
      ...valueToStrings(record.isPartOf),
      ...valueToStrings(record.publication),
    ]),
    20,
  );
  const jsonLdDescriptions = uniqueStrings(
    jsonLdRecords.flatMap((record) => [
      ...valueToStrings(record.description),
      ...valueToStrings(record.abstract),
    ]),
    20,
  );
  const jsonLdKeywords = splitKeywordValues(
    jsonLdRecords.flatMap((record) => valueToStrings(record.keywords)),
  );

  const pageTitle = stripHtmlTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const siteName = chooseBestCandidate([
    ...(metaMap.get('og:site_name') ?? []),
    ...(metaMap.get('application-name') ?? []),
  ], 2, 160);
  const title = chooseBestCandidate([
    ...(metaMap.get('citation_title') ?? []),
    ...(metaMap.get('dc.title') ?? []),
    ...(metaMap.get('dcterms.title') ?? []),
    ...jsonLdTitles,
    ...(metaMap.get('og:title') ?? []),
    ...(metaMap.get('twitter:title') ?? []),
    cleanHtmlTitle(pageTitle, siteName, finalUrl.hostname),
  ], 6, 320);
  const hasCitationJournal = (metaMap.get('citation_journal_title') ?? []).length > 0
    || (metaMap.get('citation_conference_title') ?? []).length > 0;
  const credit = normalizeSourceCreditCandidates([
    ...(metaMap.get('citation_author') ?? []),
    ...(metaMap.get('dc.creator') ?? []),
    ...(metaMap.get('dc.contributor') ?? []),
    ...jsonLdAuthors,
    ...(metaMap.get('author') ?? []),
    ...(metaMap.get('article:author') ?? []),
  ]);
  const contextField = chooseBestCandidate([
    ...(metaMap.get('citation_journal_title') ?? []),
    ...(metaMap.get('citation_conference_title') ?? []),
    ...(metaMap.get('citation_publisher') ?? []),
    ...(metaMap.get('dc.publisher') ?? []),
    ...(metaMap.get('og:site_name') ?? []),
    ...jsonLdVenue,
    finalUrl.hostname.replace(/^www\./i, ''),
  ], 2, 240);
  const year = chooseBestCandidate([
    ...[
      ...(metaMap.get('citation_publication_date') ?? []),
      ...(metaMap.get('citation_online_date') ?? []),
      ...(metaMap.get('dc.date') ?? []),
      ...(metaMap.get('article:published_time') ?? []),
      ...(metaMap.get('article:modified_time') ?? []),
      ...jsonLdDates,
    ].map((value) => extractYearFromDateValue(value)),
  ], 4, 4);
  const abstract = chooseBestCandidate([
    ...(metaMap.get('citation_abstract') ?? []),
    ...(metaMap.get('description') ?? []),
    ...(metaMap.get('og:description') ?? []),
    ...(metaMap.get('twitter:description') ?? []),
    ...(metaMap.get('dc.description') ?? []),
    ...jsonLdDescriptions,
  ], 24, MAX_SOURCE_ABSTRACT_CHARS);
  const keywords = splitKeywordValues([
    ...(metaMap.get('citation_keywords') ?? []),
    ...(metaMap.get('keywords') ?? []),
    ...(metaMap.get('news_keywords') ?? []),
    ...jsonLdKeywords,
  ]);
  let finalTitle = title;
  let finalCredit = credit;
  let finalYear = year;
  let finalContextField = contextField;

  // If key fields are missing, try AI enhancement
  const needsAI = !finalCredit || !finalYear;
  if (needsAI) {
    const aiFields = await aiEnhanceCitationMetadata(
      finalUrl.toString(),
      html,
      { title: finalTitle, credit: finalCredit, year: finalYear, contextField: finalContextField },
    );
    if (!finalTitle && aiFields.title) finalTitle = aiFields.title;
    if (!finalCredit && aiFields.credit) finalCredit = aiFields.credit;
    if (!finalYear && aiFields.year) finalYear = aiFields.year;
    if (!finalContextField && aiFields.contextField) finalContextField = aiFields.contextField;
  }

  const summary = extractSummary(abstract ?? [finalTitle, finalContextField].filter(Boolean).join('. '));
  const sourceKind = inferUrlSourceKind({
    url: finalUrl,
    contentType,
    sourceTypeHints: [
      ...jsonLdTypes,
      ...(metaMap.get('og:type') ?? []),
      ...(metaMap.get('citation_type') ?? []),
    ],
    title: finalTitle,
    venue: finalContextField,
    hasCitationJournal,
  });

  return {
    filename: filename || finalUrl.hostname,
    pageCount: 1,
    title: finalTitle,
    credit: finalCredit,
    contextField: finalContextField,
    year: finalYear,
    abstract,
    summary,
    keywords,
    locator: finalUrl.toString(),
    citation: buildSourceCitation(finalTitle, finalCredit, finalYear, finalContextField, finalUrl.toString()),
    sourceKind,
    sourceTypeLabel: getSourceTypeLabel(sourceKind),
    extractedTextPreview: chooseBestCandidate([
      abstract,
      summary,
      pageTitle,
    ], 12, MAX_SOURCE_TEXT_PREVIEW_CHARS),
  };
}

function inferPdfSourceMetadata(pdfData: Awaited<ReturnType<typeof pdfParse>>, filename: string): ParsedThesisSourceRecord {
  const text = pdfData.text?.trim() ?? '';
  const orderedLines = text
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line.replace(/\u0000/g, ' ')))
    .filter((line) => line.length >= 3 && line.length <= 220)
    .filter((line) => !/^(page\s+\d+|\d+)$/.test(line));
  const lines = uniqueStrings(
    orderedLines,
    40,
  );

  const info = (pdfData.info ?? {}) as Record<string, unknown>;
  const metadataTitle = cleanPdfMetadataValue(info.Title);
  const metadataAuthor = cleanPdfMetadataValue(info.Author);
  const metadataSubject = cleanPdfMetadataValue(info.Subject);
  const filenameTitle = cleanPdfFilename(filename);
  const titleBlock = findTitleBlock(orderedLines.slice(0, 260));

  let title = metadataTitle;
  if (
    !title
    || title.toLowerCase() === filenameTitle.toLowerCase()
    || isLikelyCoverSheetNoise(title)
    || title.length < 16
  ) {
    title = titleBlock?.title || orderedLines.slice(0, 260).find((line) => isLikelyTitleCandidateLine(line)) || filenameTitle;
  }

  let credit = normalizeSourceCreditValue(metadataAuthor);
  if (!credit) {
    const titleIndex = titleBlock?.startIndex ?? Math.max(0, orderedLines.findIndex((line) => line === title));
    credit = normalizeSourceCreditValue([
      ...orderedLines.slice(Math.max(0, titleIndex - 3), titleIndex + 1),
      ...orderedLines.slice(titleIndex + 1, titleIndex + 5),
    ].find((line) => isLikelyAuthorLine(line)) ?? null);
  }

  const yearCandidates = uniqueStrings([
    cleanPdfMetadataValue(info.CreationDate)?.match(/(?:19|20)\d{2}/)?.[0],
    cleanPdfMetadataValue(info.ModDate)?.match(/(?:19|20)\d{2}/)?.[0],
    ...lines.slice(0, 12).map((line) => line.match(/\b(19|20)\d{2}\b/)?.[0] ?? null),
  ]);
  const year = yearCandidates
    .map((value) => Number.parseInt(value, 10))
    .find((value) => Number.isFinite(value) && value >= 1900 && value <= new Date().getUTCFullYear() + 1);

  const contextField = metadataSubject
    ?? orderedLines
      .slice(Math.max(0, (titleBlock?.endIndex ?? 0) - 2), Math.min(orderedLines.length, (titleBlock?.endIndex ?? 0) + 8))
      .find((line) => isLikelyVenueLine(line) && line.toLowerCase() !== title?.toLowerCase())
    ?? lines.slice(0, 20).find((line) => isLikelyVenueLine(line) && line.toLowerCase() !== title?.toLowerCase())
    ?? null;

  const abstract = extractAbstract(text);
  const summary = extractSummary(abstract ?? text);
  const keywords = extractKeywordList(text, filename);

  return {
    filename,
    pageCount: Math.max(1, pdfData.numpages || 1),
    title: title || filenameTitle || null,
    credit,
    contextField,
    year: year ? `${year}` : null,
    abstract,
    summary,
    keywords,
    locator: filename,
    citation: buildSourceCitation(title || filenameTitle || null, credit, year ? `${year}` : null, contextField, filename),
    sourceKind: 'journal_article',
    sourceTypeLabel: 'PDF',
    extractedTextPreview: text ? text.slice(0, MAX_SOURCE_TEXT_PREVIEW_CHARS) : null,
  };
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function formatKnowledgeLabel(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeKnowledgePhrase(value: string) {
  return compactWhitespace(value)
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractKnowledgeTerms(textBlocks: Array<string | null | undefined>, seedTerms: string[] = [], limit = 8) {
  const explicitTerms = uniqueStrings(
    seedTerms
      .map((term) => normalizeKnowledgePhrase(term))
      .filter((term) => term.length >= 3 && term.length <= 48),
    limit,
  );

  const termCounts = new Map<string, number>();
  for (const block of textBlocks) {
    const normalized = normalizeKnowledgePhrase(block ?? '');
    if (!normalized) continue;
    const words = normalized.split(/\s+/).filter((word) => word.length >= 4 && !KNOWLEDGE_STOPWORDS.has(word));
    for (const word of words) {
      termCounts.set(word, (termCounts.get(word) ?? 0) + 1);
    }
    for (let index = 0; index < words.length - 1; index += 1) {
      const first = words[index];
      const second = words[index + 1];
      if (!first || !second) continue;
      const phrase = `${first} ${second}`;
      if (phrase.length > 32) continue;
      termCounts.set(phrase, (termCounts.get(phrase) ?? 0) + 2);
    }
  }

  const rankedTerms = [...termCounts.entries()]
    .filter(([term, count]) => count >= 2 && term.length >= 4 && term.length <= 40)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term);

  return uniqueStrings(
    [
      ...explicitTerms,
      ...rankedTerms,
    ].map((term) => formatKnowledgeLabel(term)),
    limit,
  );
}

function getChapterLabel(chapterTarget: ThesisSourceChapterTarget) {
  if (chapterTarget === 'literature_review') return 'Literature Review';
  if (chapterTarget === 'methods') return 'Methods';
  if (chapterTarget === 'findings') return 'Findings';
  return 'Appendix';
}

function getCreditLabel(credit: string) {
  const normalized = compactWhitespace(credit);
  if (!normalized) return null;
  const primary = normalized
    .split(/\s*(?:;|\/| and | & )\s*/i)
    .map((item) => compactWhitespace(item))
    .find(Boolean);
  if (!primary) return null;
  return primary.length > 72 ? `${primary.slice(0, 69)}...` : primary;
}

function getCreditLabels(credit: string) {
  const normalized = compactWhitespace(credit);
  if (!normalized) return [];

  const people = uniqueStrings(
    extractCreditPeople(normalized).map((person) => (
      person.length > 72 ? `${person.slice(0, 69)}...` : person
    )),
    12,
  );
  if (people.length > 0) return people;

  const fallback = getCreditLabel(normalized);
  return fallback ? [fallback] : [];
}

function normalizeThesisKnowledgeLinkedProject(input: unknown): ThesisKnowledgeLinkedProject | null {
  if (!input || typeof input !== 'object') return null;

  const candidate = input as Record<string, unknown>;
  const id = readString(candidate.id);
  const name = readString(candidate.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    description: readString(candidate.description),
    github_repo: readString(candidate.github_repo),
    github_repos: safeStringArray(candidate.github_repos),
    gitlab_repos: safeStringArray(candidate.gitlab_repos),
  };
}

async function enrichThesisKnowledgeLinkedProjectsWithGitLabRepos(
  linkedProjects: ThesisKnowledgeLinkedProject[],
): Promise<ThesisKnowledgeLinkedProject[]> {
  const projectIds = linkedProjects.map((project) => project.id).filter(Boolean);
  if (projectIds.length === 0) return linkedProjects;

  const { data, error } = await supabase
    .from('integrations')
    .select('project_id, config')
    .in('project_id', projectIds)
    .eq('type', 'gitlab');

  if (error || !data) return linkedProjects;

  const gitLabReposByProjectId = new Map<string, string[]>();
  for (const integration of data as GitLabIntegrationRow[]) {
    const repos = getGitLabRepoPaths(integration.config);
    if (repos.length === 0) continue;
    const existing = gitLabReposByProjectId.get(integration.project_id) ?? [];
    gitLabReposByProjectId.set(
      integration.project_id,
      uniqueStrings([...existing, ...repos], 24),
    );
  }

  return linkedProjects.map((project) => ({
    ...project,
    gitlab_repos: uniqueStrings([
      ...(project.gitlab_repos ?? []),
      ...(gitLabReposByProjectId.get(project.id) ?? []),
    ], 24),
  }));
}

function normalizeThesisKnowledgeLinkedGoal(input: unknown): ThesisKnowledgeLinkedGoal | null {
  if (!input || typeof input !== 'object') return null;

  const candidate = input as Record<string, unknown>;
  const id = readString(candidate.id);
  const projectId = readString(candidate.project_id);
  const title = readString(candidate.title);
  if (!id || !projectId || !title) return null;

  return {
    id,
    project_id: projectId,
    title,
    description: readString(candidate.description),
    deadline: readString(candidate.deadline),
    status: readString(candidate.status) ?? 'not_started',
    progress: typeof candidate.progress === 'number'
      ? Math.max(0, Math.min(100, candidate.progress))
      : 0,
    category: readString(candidate.category),
    loe: readString(candidate.loe),
  };
}

function normalizeThesisKnowledgeLinkedEvent(input: unknown): ThesisKnowledgeLinkedEvent | null {
  if (!input || typeof input !== 'object') return null;

  const candidate = input as Record<string, unknown>;
  const id = readString(candidate.id);
  const projectId = readString(candidate.project_id);
  const occurredAt = readString(candidate.occurred_at);
  if (!id || !projectId || !occurredAt) return null;

  return {
    id,
    project_id: projectId,
    source: readString(candidate.source) ?? 'manual',
    event_type: readString(candidate.event_type) ?? 'note',
    title: readString(candidate.title),
    summary: readString(candidate.summary),
    occurred_at: occurredAt,
  };
}

type ProjectOverlapEdge = ThesisKnowledgeGraphEdge & {
  overlap: string[];
};

function stripReferenceLeadMarkers(value: string) {
  return compactWhitespace(
    value
      .replace(/^\[\d+\]\s*/, '')
      .replace(/^\(\d+\)\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .replace(/^\d+\s+/, ''),
  );
}

function looksLikeReferenceHeading(line: string) {
  return /^(references|bibliography|works cited|literature cited|cited references|reference list|sources)$/i.test(compactWhitespace(line));
}

function looksLikeReferenceContent(line: string) {
  const normalized = compactWhitespace(line);
  if (normalized.length < 24) return false;
  return (
    /\b(19|20)\d{2}[a-z]?\b/.test(normalized)
    || /https?:\/\//i.test(normalized)
    || /\bdoi\b/i.test(normalized)
    || /\b(vol\.|pp\.|journal|conference|proceedings|review|press|report|arxiv|thesis)\b/i.test(normalized)
  );
}

function looksLikeReferenceStart(line: string) {
  const normalized = stripReferenceLeadMarkers(line);
  if (!normalized) return false;
  return (
    /^\w.+?\(\d{4}[a-z]?\)/.test(normalized)
    || /^([A-Z][A-Za-z'`-]+,\s*)?(?:[A-Z]\.\s*){1,5}/.test(normalized)
    || /^https?:\/\//i.test(normalized)
    || /^doi:/i.test(normalized)
  );
}

function parseReferenceTitle(reference: string) {
  const quotedTitle = reference.match(/["“]([^"”]{8,220})["”]/)?.[1];
  if (quotedTitle) return compactWhitespace(quotedTitle);

  const afterYear = reference.match(/\(\d{4}[a-z]?\)\.?\s*([^.;][^.]{8,220})\./)?.[1];
  if (afterYear) return compactWhitespace(afterYear);

  const segments = reference
    .split(/[.]/)
    .map((segment) => compactWhitespace(segment))
    .filter(Boolean);
  return segments.find((segment) => {
    const wordCount = segment.split(/\s+/).length;
    return wordCount >= 4
      && wordCount <= 24
      && !/\b(vol|pp|journal|conference|proceedings|press|review|report|doi|https?)\b/i.test(segment);
  }) ?? null;
}

function parseReferenceLeadAuthor(reference: string) {
  const normalized = stripReferenceLeadMarkers(reference);
  if (!normalized) return null;
  const match = normalized.match(/^(.{4,100}?)(?:\(\d{4}[a-z]?\)|["“]|https?:\/\/|doi:)/);
  if (!match?.[1]) return null;
  const label = compactWhitespace(match[1].replace(/[.,;:]$/, ''));
  return label.length > 72 ? `${label.slice(0, 69)}...` : label;
}

function parseReferenceYear(reference: string) {
  return reference.match(/\b((?:19|20)\d{2}[a-z]?)\b/)?.[1] ?? null;
}

function parseReferenceDoi(reference: string) {
  const doiMatch = reference.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0];
  if (doiMatch) return doiMatch.toLowerCase();
  const doiUrl = reference.match(/https?:\/\/(?:dx\.)?doi\.org\/([^)\s]+)/i)?.[1];
  return doiUrl ? doiUrl.toLowerCase() : null;
}

function buildReferenceKey(reference: string, title: string | null, leadAuthor: string | null, year: string | null) {
  const doi = parseReferenceDoi(reference);
  if (doi) return `doi:${doi}`;
  const titleKey = normalizeKnowledgePhrase(title ?? '').slice(0, 80);
  const authorKey = normalizeKnowledgePhrase(leadAuthor ?? '').slice(0, 40);
  const yearKey = normalizeKnowledgePhrase(year ?? '').slice(0, 8);
  return `ref:${authorKey}|${titleKey}|${yearKey}`;
}

function extractReferenceEntriesFromText(text: string) {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line.replace(/\u0000/g, ' ')))
    .filter((line) => line.length >= 3 && line.length <= 420);

  if (rawLines.length === 0) return [];

  const headingIndex = rawLines.findIndex((line) => looksLikeReferenceHeading(line));
  const sectionLines = headingIndex >= 0
    ? rawLines.slice(headingIndex + 1, headingIndex + 240)
    : rawLines.slice(Math.max(0, rawLines.length - 180));

  const candidates: string[] = [];
  let current = '';

  for (const line of sectionLines) {
    if (looksLikeReferenceHeading(line)) continue;
    const normalized = stripReferenceLeadMarkers(line);
    if (!normalized) continue;

    if (!current) {
      current = normalized;
      continue;
    }

    const shouldStartNext = looksLikeReferenceStart(normalized) && looksLikeReferenceContent(current);
    if (shouldStartNext) {
      candidates.push(current);
      current = normalized;
      continue;
    }

    if (`${current} ${normalized}`.length <= 520) {
      current = `${current} ${normalized}`;
    } else {
      candidates.push(current);
      current = normalized;
    }
  }
  if (current) candidates.push(current);

  const results: Array<{
    key: string;
    label: string;
    raw: string;
    year: string | null;
  }> = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = compactWhitespace(candidate);
    if (!looksLikeReferenceContent(normalized)) continue;
    const title = parseReferenceTitle(normalized);
    const leadAuthor = parseReferenceLeadAuthor(normalized);
    const year = parseReferenceYear(normalized);
    const key = buildReferenceKey(normalized, title, leadAuthor, year);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const label = title
      ?? (leadAuthor && year ? `${leadAuthor} (${year})` : leadAuthor || year || normalized.slice(0, 84));
    results.push({
      key,
      label: label.length > 110 ? `${label.slice(0, 107)}...` : label,
      raw: normalized,
      year,
    });
    if (results.length >= 40) break;
  }

  return results;
}

async function readThesisAttachmentFullText(storagePath: string, mimeType: string, filename: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) return '';

  const { data, error } = await supabase.storage.from(THESIS_SOURCE_BUCKET).download(normalizedPath);
  if (error || !data) return '';

  try {
    const buffer = Buffer.from(await data.arrayBuffer());
    const normalizedMime = (mimeType || data.type || '').toLowerCase();
    if (normalizedMime.includes('pdf') || /\.pdf$/i.test(filename)) {
      const pdfData = await pdfParse(buffer);
      return pdfData.text ?? '';
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  } catch {
    return '';
  }
}

async function extractCitedReferencesFromUrl(rawUrl: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_URL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsedUrl.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Odyssey Thesis Knowledge Graph/1.0',
        accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      },
    });
    clearTimeout(timeout);
    if (!response.ok) return [];

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('pdf') || /\.pdf(?:$|\?)/i.test(response.url || parsedUrl.pathname)) {
      const fileBuffer = Buffer.from(await response.arrayBuffer());
      const pdfData = await pdfParse(fileBuffer);
      return extractReferenceEntriesFromText(pdfData.text ?? '');
    }

    const html = await response.text();
    const text = html
      .replace(/<\/(p|li|div|section|article|br|h1|h2|h3|h4|h5|h6)>/gi, '$&\n')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    return extractReferenceEntriesFromText(stripHtmlTags(text));
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

async function readThesisAttachmentTextPreview(storagePath: string, mimeType: string, filename: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) return '';

  const { data, error } = await supabase.storage.from(THESIS_SOURCE_BUCKET).download(normalizedPath);
  if (error || !data) return '';

  try {
    const buffer = Buffer.from(await data.arrayBuffer());
    return extractDocumentTextPreview(buffer, mimeType || data.type || 'application/octet-stream', filename);
  } catch {
    return '';
  }
}

async function buildThesisKnowledgeGraph(
  sourceLibrary: ThesisSourceLibraryItem[],
  thesisDocuments: ThesisSupportingDocumentItem[],
  linkedProjects: ThesisKnowledgeLinkedProject[],
  linkedGoals: ThesisKnowledgeLinkedGoal[],
  linkedEvents: ThesisKnowledgeLinkedEvent[],
): Promise<ThesisKnowledgeGraphPayload> {
  const hydratedSources = await Promise.all(sourceLibrary.map(async (source) => {
    const urlMetadata = isHttpUrl(source.locator)
      ? await inferUrlSourceMetadata(source.locator).catch(() => null)
      : null;
    const attachmentPreview = source.attachmentStoragePath
      ? await readThesisAttachmentTextPreview(
          source.attachmentStoragePath,
          source.attachmentMimeType,
          source.attachmentName || source.title,
        ).catch(() => '')
      : '';
    const attachmentFullText = source.attachmentStoragePath
      ? await readThesisAttachmentFullText(
          source.attachmentStoragePath,
          source.attachmentMimeType,
          source.attachmentName || source.title,
        ).catch(() => '')
      : '';
    const extractedReferences = uniqueStrings(
      [
        ...extractReferenceEntriesFromText(attachmentFullText).map((reference) => JSON.stringify(reference)),
        ...(
          isHttpUrl(source.locator)
            ? await extractCitedReferencesFromUrl(source.locator).catch(() => [])
            : []
        ).map((reference) => JSON.stringify(reference)),
      ],
      50,
    ).map((value) => JSON.parse(value) as {
      key: string;
      label: string;
      raw: string;
      year: string | null;
    });

    const title = source.title || urlMetadata?.title || source.locator;
    const credit = source.credit || urlMetadata?.credit || '';
    const venue = source.venue || urlMetadata?.contextField || '';
    const summary = chooseBestCandidate([
      source.abstract,
      urlMetadata?.abstract,
      urlMetadata?.summary,
      attachmentPreview,
      source.notes,
      source.citation,
    ], 20, 420) ?? 'Metadata compiled from the thesis source record.';
    const terms = extractKnowledgeTerms([
      title,
      credit,
      venue,
      source.abstract,
      source.notes,
      source.citation,
      urlMetadata?.abstract,
      urlMetadata?.summary,
      attachmentPreview,
      extractedReferences.map((reference) => reference.label).join(' '),
    ], [
      ...source.tags,
      ...(urlMetadata?.keywords ?? []),
      source.sourceKind.replace(/_/g, ' '),
      source.role,
    ]);

    return {
      source,
      title,
      credit,
      venue,
      summary,
      terms,
      hydrated: Boolean(urlMetadata || attachmentPreview),
      extractedReferences,
      detail: [
        credit ? `Credit: ${credit}.` : null,
        venue ? `Context: ${venue}.` : null,
        source.year ? `Publication date: ${source.year}.` : null,
        extractedReferences.length > 0 ? `${extractedReferences.length} cited reference${extractedReferences.length === 1 ? '' : 's'} extracted.` : null,
        summary,
      ].filter(Boolean).join(' '),
    };
  }));

  const hydratedDocuments = await Promise.all(thesisDocuments.map(async (document) => {
    const attachmentPreview = !document.extractedTextPreview && document.attachmentStoragePath
      ? await readThesisAttachmentTextPreview(
          document.attachmentStoragePath,
          document.attachmentMimeType,
          document.attachmentName || document.title,
        ).catch(() => '')
      : '';
    const preview = document.extractedTextPreview || attachmentPreview;
    const linkedSource = hydratedSources.find((item) => item.source.id === document.linkedSourceId) ?? null;
    const terms = extractKnowledgeTerms([
      document.title,
      document.description,
      document.contribution,
      preview,
      linkedSource?.title ?? '',
    ], linkedSource?.terms ?? [], 6);

    return {
      document,
      preview,
      linkedSource,
      terms,
    };
  }));

  const projectContexts = linkedProjects.map((project) => {
    const projectGoals = linkedGoals.filter((goal) => goal.project_id === project.id);
    const projectEvents = linkedEvents.filter((event) => event.project_id === project.id);
    const activeGoals = projectGoals
      .filter((goal) => goal.status !== 'complete')
      .sort((left, right) => {
        if (left.deadline && right.deadline) return new Date(left.deadline).getTime() - new Date(right.deadline).getTime();
        if (left.deadline) return -1;
        if (right.deadline) return 1;
        return right.progress - left.progress;
      });
    const completedGoals = projectGoals.filter((goal) => goal.status === 'complete');
    const repoLabels = uniqueStrings([
      project.github_repo,
      ...(project.github_repos ?? []),
      ...(project.gitlab_repos ?? []),
    ], 24);
    const repoTerms = repoLabels.flatMap((repo) => {
      const repoName = repo.split('/').pop() ?? repo;
      return [repo, repoName];
    });
    const terms = extractKnowledgeTerms(
      [
        project.name,
        project.description,
        ...projectGoals.flatMap((goal) => [goal.title, goal.description, goal.category, goal.loe]),
        ...projectEvents.flatMap((event) => [event.title, event.summary, event.event_type, event.source]),
        repoLabels.join(' '),
      ],
      [
        project.name,
        ...repoTerms,
        ...activeGoals.slice(0, 3).map((goal) => goal.title),
        ...projectGoals.map((goal) => goal.category ?? ''),
      ],
      8,
    );
    const detail = [
      project.description ? compactWhitespace(project.description) : null,
      activeGoals.length > 0
        ? `${activeGoals.length} open linked task${activeGoals.length === 1 ? '' : 's'} still shape thesis execution.`
        : null,
      completedGoals.length > 0
        ? `${completedGoals.length} linked task${completedGoals.length === 1 ? '' : 's'} already completed.`
        : null,
      projectEvents.length > 0
        ? `${projectEvents.length} recent project event${projectEvents.length === 1 ? '' : 's'} are available as context.`
        : null,
      activeGoals[0]
        ? `Highest-priority task: ${activeGoals[0].title}.`
        : null,
    ].filter(Boolean).join(' ');

    return {
      project,
      goals: projectGoals,
      events: projectEvents,
      activeGoals,
      completedGoals,
      repoLabels,
      terms,
      detail: detail || 'Linked thesis project contributing execution context to the evidence map.',
    };
  });

  const themeCounts = new Map<string, { label: string; sourceIds: Set<string> }>();
  for (const hydratedSource of hydratedSources) {
    for (const term of hydratedSource.terms.slice(0, KNOWLEDGE_GRAPH_SOURCE_THEME_LIMIT + 2)) {
      const key = term.toLowerCase();
      const existing = themeCounts.get(key) ?? { label: term, sourceIds: new Set<string>() };
      existing.sourceIds.add(hydratedSource.source.id);
      themeCounts.set(key, existing);
    }
  }

  const deterministicThemes = [...themeCounts.entries()]
    .filter(([, value]) => value.sourceIds.size >= 1)
    .sort((left, right) => right[1].sourceIds.size - left[1].sourceIds.size || left[1].label.localeCompare(right[1].label))
    .slice(0, KNOWLEDGE_GRAPH_THEME_LIMIT)
    .map(([key, value]) => ({
      id: `theme:${key}`,
      label: value.label,
      count: value.sourceIds.size,
      sourceIds: [...value.sourceIds],
    }));

  const aiEnhancement = await aiEnhanceKnowledgeGraph({
    sources: hydratedSources.map((hydratedSource) => ({
      id: hydratedSource.source.id,
      title: hydratedSource.title,
      credit: hydratedSource.credit,
      venue: hydratedSource.venue,
      summary: compactWhitespace(hydratedSource.summary).slice(0, 240),
      terms: hydratedSource.terms.slice(0, 6),
      references: hydratedSource.extractedReferences.slice(0, 4).map((reference) => reference.label),
    })),
    documents: hydratedDocuments.map((hydratedDocument) => ({
      id: hydratedDocument.document.id,
      title: hydratedDocument.document.title,
      description: compactWhitespace(hydratedDocument.document.description).slice(0, 220),
      contribution: compactWhitespace(hydratedDocument.document.contribution).slice(0, 220),
      linkedSourceId: hydratedDocument.document.linkedSourceId,
      preview: compactWhitespace(hydratedDocument.preview).slice(0, 240),
      terms: hydratedDocument.terms.slice(0, 6),
    })),
    projects: projectContexts.map((projectContext) => ({
      id: `project:${projectContext.project.id}`,
      name: projectContext.project.name,
      description: compactWhitespace(projectContext.project.description ?? '').slice(0, 220),
      repos: projectContext.repoLabels,
      goalTitles: projectContext.activeGoals.slice(0, 4).map((goal) => goal.title),
      eventTitles: projectContext.events.slice(0, 4).map((event) => event.title ?? event.summary ?? event.event_type).filter(Boolean) as string[],
      terms: projectContext.terms.slice(0, 8),
    })),
    existingThemes: deterministicThemes.map((theme) => ({
      label: theme.label,
      sourceIds: theme.sourceIds,
    })),
  });

  const themeContextMap = new Map<string, {
    id: string;
    label: string;
    detail: string | null;
    sourceIds: Set<string>;
    documentIds: Set<string>;
    projectIds: Set<string>;
  }>();

  const upsertThemeContext = (
    label: string,
    detail: string | null,
    sourceIds: string[] = [],
    documentIds: string[] = [],
    projectIds: string[] = [],
  ) => {
    const normalizedLabel = compactWhitespace(label);
    if (!normalizedLabel) return;
    const key = normalizedLabel.toLowerCase();
    const existing = themeContextMap.get(key) ?? {
      id: `theme:${key}`,
      label: normalizedLabel,
      detail: null,
      sourceIds: new Set<string>(),
      documentIds: new Set<string>(),
      projectIds: new Set<string>(),
    };
    if (!existing.detail && detail) existing.detail = detail;
    if (normalizedLabel.length < existing.label.length) existing.label = normalizedLabel;
    for (const sourceId of sourceIds) existing.sourceIds.add(sourceId);
    for (const documentId of documentIds) existing.documentIds.add(documentId);
    for (const projectId of projectIds) existing.projectIds.add(projectId);
    themeContextMap.set(key, existing);
  };

  for (const theme of deterministicThemes) {
    upsertThemeContext(theme.label, null, theme.sourceIds);
  }
  for (const theme of aiEnhancement.themes) {
    upsertThemeContext(theme.label, theme.detail, theme.sourceIds, theme.documentIds, theme.projectIds);
  }

  const themeContexts = [...themeContextMap.values()]
    .filter((theme) => theme.sourceIds.size > 0)
    .sort((left, right) => {
      const leftWeight = left.sourceIds.size * 2 + left.documentIds.size + left.projectIds.size;
      const rightWeight = right.sourceIds.size * 2 + right.documentIds.size + right.projectIds.size;
      return rightWeight - leftWeight || left.label.localeCompare(right.label);
    })
    .slice(0, KNOWLEDGE_GRAPH_THEME_OUTPUT_LIMIT);

  const themes = themeContexts.map((theme) => ({
    id: theme.id,
    label: theme.label,
    count: theme.sourceIds.size,
    sourceIds: [...theme.sourceIds],
  }));

  const themeLookup = new Map(themeContexts.map((theme) => [theme.label.toLowerCase(), theme]));

  const coverageMap = new Map<string, ThesisKnowledgeCoverageSummary>();
  for (const hydratedSource of hydratedSources) {
    const label = getChapterLabel(hydratedSource.source.chapterTarget);
    const key = `chapter:${hydratedSource.source.chapterTarget}`;
    const existing = coverageMap.get(key) ?? { id: key, label, count: 0, sourceIds: [] };
    existing.count += 1;
    existing.sourceIds.push(hydratedSource.source.id);
    coverageMap.set(key, existing);
  }

  const repeatedCredits = new Map<string, { label: string; sourceIds: Set<string> }>();
  for (const hydratedSource of hydratedSources) {
    for (const creditLabel of getCreditLabels(hydratedSource.credit)) {
      const key = creditLabel.toLowerCase();
      const existing = repeatedCredits.get(key) ?? { label: creditLabel, sourceIds: new Set<string>() };
      existing.sourceIds.add(hydratedSource.source.id);
      repeatedCredits.set(key, existing);
    }
  }

  const creditNodes = [...repeatedCredits.entries()]
    .filter(([, value]) => value.sourceIds.size > 0)
    .sort((left, right) => right[1].sourceIds.size - left[1].sourceIds.size || left[1].label.localeCompare(right[1].label))
    .map(([key, value]) => ({
      id: `credit:${key}`,
      label: value.label,
      kind: 'credit' as const,
      size: 18 + value.sourceIds.size * 2,
      score: value.sourceIds.size,
      detail: `${value.label} is connected to ${value.sourceIds.size} thesis source${value.sourceIds.size === 1 ? '' : 's'}.`,
      meta: ['Credit node'],
      relatedSourceIds: [...value.sourceIds],
    }));
  const creditNodeIds = new Set(creditNodes.map((node) => node.id));

  const sourceNodes: ThesisKnowledgeGraphNode[] = hydratedSources.map((hydratedSource) => ({
    id: hydratedSource.source.id,
    label: hydratedSource.title,
    kind: 'source',
    size: 24 + hydratedSource.terms.length,
    score: 3 + hydratedSource.terms.length + (hydratedSource.hydrated ? 2 : 0) + Math.min(4, hydratedSource.extractedReferences.length),
    detail: hydratedSource.detail,
    meta: uniqueStrings([
      hydratedSource.source.type,
      hydratedSource.source.sourceKind.replace(/_/g, ' '),
      hydratedSource.source.role,
      hydratedSource.source.year,
      hydratedSource.venue,
      hydratedSource.extractedReferences.length > 0 ? `${hydratedSource.extractedReferences.length} cited refs` : null,
    ], 5),
    relatedSourceIds: [hydratedSource.source.id],
  }));

  const themeNodes: ThesisKnowledgeGraphNode[] = themeContexts.map((theme) => ({
    id: theme.id,
    label: theme.label,
    kind: 'theme',
    size: 18 + Math.min(14, theme.sourceIds.size * 2 + theme.documentIds.size + theme.projectIds.size),
    score: theme.sourceIds.size * 2 + theme.documentIds.size + theme.projectIds.size,
    detail: theme.detail ?? `${theme.label} appears across ${theme.sourceIds.size} thesis source${theme.sourceIds.size === 1 ? '' : 's'} and acts as a reusable evidence thread.`,
    meta: uniqueStrings([
      `${theme.sourceIds.size} connected sources`,
      theme.documentIds.size > 0 ? `${theme.documentIds.size} linked documents` : null,
      theme.projectIds.size > 0 ? `${theme.projectIds.size} linked projects` : null,
    ], 3),
    relatedSourceIds: [...theme.sourceIds],
  }));

  const documentNodes: ThesisKnowledgeGraphNode[] = hydratedDocuments.map((hydratedDocument) => ({
    id: hydratedDocument.document.id,
    label: hydratedDocument.document.title,
    kind: 'document',
    size: 18 + hydratedDocument.terms.length,
    score: 2 + hydratedDocument.terms.length + (hydratedDocument.linkedSource ? 2 : 0),
    detail: chooseBestCandidate([
      hydratedDocument.document.contribution,
      hydratedDocument.document.description,
      hydratedDocument.preview,
    ], 20, 360) ?? 'Supporting document attached to the thesis workspace.',
    meta: uniqueStrings([
      hydratedDocument.linkedSource ? `linked to ${hydratedDocument.linkedSource.title}` : 'unlinked document',
      ...hydratedDocument.terms.slice(0, 3),
    ], 4),
    relatedSourceIds: hydratedDocument.linkedSource ? [hydratedDocument.linkedSource.source.id] : [],
  }));

  const projectNodes: ThesisKnowledgeGraphNode[] = projectContexts.map((projectContext) => ({
    id: `project:${projectContext.project.id}`,
    label: projectContext.project.name,
    kind: 'project',
    size: 18 + Math.min(10, projectContext.terms.length + projectContext.activeGoals.length),
    score: 2 + projectContext.terms.length + projectContext.activeGoals.length + Math.min(3, projectContext.events.length),
    detail: projectContext.detail,
    meta: uniqueStrings([
      `${projectContext.activeGoals.length} open tasks`,
      `${projectContext.completedGoals.length} completed tasks`,
      `${projectContext.events.length} recent events`,
      ...projectContext.repoLabels.map((repo) => repo.split('/').slice(-2).join('/')),
    ], 5),
    relatedSourceIds: [],
  }));

  const repoContextMap = new Map<string, {
    id: string;
    label: string;
    normalizedLabel: string;
    projectIds: Set<string>;
    projectNames: Set<string>;
  }>();

  for (const projectContext of projectContexts) {
    for (const repoLabel of projectContext.repoLabels) {
      const normalizedLabel = compactWhitespace(repoLabel);
      if (!normalizedLabel) continue;
      const key = normalizedLabel.toLowerCase();
      const existing = repoContextMap.get(key) ?? {
        id: `repo:${key}`,
        label: normalizedLabel,
        normalizedLabel: key,
        projectIds: new Set<string>(),
        projectNames: new Set<string>(),
      };
      existing.projectIds.add(`project:${projectContext.project.id}`);
      existing.projectNames.add(projectContext.project.name);
      repoContextMap.set(key, existing);
    }
  }

  const repoNodes: ThesisKnowledgeGraphNode[] = [...repoContextMap.values()]
    .sort((left, right) => right.projectIds.size - left.projectIds.size || left.label.localeCompare(right.label))
    .map((repoContext) => ({
      id: repoContext.id,
      label: repoContext.label,
      kind: 'repo' as const,
      size: 18 + Math.min(8, repoContext.projectIds.size * 2),
      score: 2 + repoContext.projectIds.size,
      detail: `${repoContext.label} is linked to ${repoContext.projectIds.size} thesis project${repoContext.projectIds.size === 1 ? '' : 's'}.`,
      meta: uniqueStrings([
        `${repoContext.projectIds.size} linked project${repoContext.projectIds.size === 1 ? '' : 's'}`,
        ...[...repoContext.projectNames].slice(0, 3),
      ], 4),
      relatedSourceIds: [],
    }));

  const nodes: ThesisKnowledgeGraphNode[] = [
    ...creditNodes,
    ...themeNodes,
    ...sourceNodes,
    ...projectNodes,
    ...repoNodes,
    ...documentNodes,
  ];

  const edgeMap = new Map<string, ThesisKnowledgeGraphEdge>();
  const addEdge = (edge: ThesisKnowledgeGraphEdge) => {
    const key = `${edge.kind}:${edge.source}->${edge.target}`;
    const existing = edgeMap.get(key);
    if (!existing || edge.strength > existing.strength) {
      edgeMap.set(key, edge);
    }
  };

  for (const hydratedSource of hydratedSources) {
    for (const term of hydratedSource.terms) {
      const theme = themeLookup.get(term.toLowerCase());
      if (!theme) continue;
      addEdge({
        id: `${hydratedSource.source.id}->${theme.id}`,
        source: hydratedSource.source.id,
        target: theme.id,
        kind: 'source-theme',
        strength: 1.4,
      });
    }

    for (const creditLabel of getCreditLabels(hydratedSource.credit)) {
      const creditId = `credit:${creditLabel.toLowerCase()}`;
      if (creditNodeIds.has(creditId)) {
        addEdge({
          id: `${hydratedSource.source.id}->${creditId}`,
          source: hydratedSource.source.id,
          target: creditId,
          kind: 'source-credit',
          strength: 1.05,
        });
      }
    }

  }

  for (const hydratedDocument of hydratedDocuments) {
    if (hydratedDocument.linkedSource) {
      addEdge({
        id: `${hydratedDocument.document.id}->${hydratedDocument.linkedSource.source.id}`,
        source: hydratedDocument.document.id,
        target: hydratedDocument.linkedSource.source.id,
        kind: 'source-document',
        strength: 1.5,
      });
      continue;
    }

    for (const term of hydratedDocument.terms.slice(0, 2)) {
      const theme = themeLookup.get(term.toLowerCase());
      if (!theme) continue;
      addEdge({
        id: `${hydratedDocument.document.id}->${theme.id}`,
        source: hydratedDocument.document.id,
        target: theme.id,
        kind: 'document-theme',
        strength: 0.95,
      });
    }
  }

  for (const projectContext of projectContexts) {
    const projectId = `project:${projectContext.project.id}`;
    const projectTermSet = new Set(projectContext.terms.map((term) => term.toLowerCase()));

    for (const repoLabel of projectContext.repoLabels) {
      const normalizedRepoLabel = compactWhitespace(repoLabel).toLowerCase();
      if (!normalizedRepoLabel || !repoContextMap.has(normalizedRepoLabel)) continue;
      addEdge({
        id: `${projectId}->repo:${normalizedRepoLabel}`,
        source: projectId,
        target: `repo:${normalizedRepoLabel}`,
        kind: 'project-repo',
        strength: 1.2,
      });
    }

    for (const term of projectContext.terms) {
      const theme = themeLookup.get(term.toLowerCase());
      if (!theme) continue;
      addEdge({
        id: `${projectId}->${theme.id}`,
        source: projectId,
        target: theme.id,
        kind: 'project-theme',
        strength: 1.1,
      });
    }

    const projectSourceEdges = hydratedSources
      .reduce<ProjectOverlapEdge[]>((acc, hydratedSource) => {
        const overlap = hydratedSource.terms.filter((term) => projectTermSet.has(term.toLowerCase()));
        if (overlap.length === 0) return acc;
        acc.push({
          id: `${projectId}->${hydratedSource.source.id}`,
          source: projectId,
          target: hydratedSource.source.id,
          kind: 'project-source',
          strength: Math.min(2.1, 0.95 + overlap.length * 0.3),
          overlap,
        });
        return acc;
      }, [])
      .sort((left, right) => right.overlap.length - left.overlap.length || left.target.localeCompare(right.target))
      .slice(0, 5)
      .map(({ overlap, ...edge }) => edge);
    for (const edge of projectSourceEdges) addEdge(edge);

    const projectDocumentEdges = hydratedDocuments
      .reduce<ProjectOverlapEdge[]>((acc, hydratedDocument) => {
        const overlap = hydratedDocument.terms.filter((term) => projectTermSet.has(term.toLowerCase()));
        if (overlap.length === 0) return acc;
        acc.push({
          id: `${projectId}->${hydratedDocument.document.id}`,
          source: projectId,
          target: hydratedDocument.document.id,
          kind: 'project-document',
          strength: Math.min(1.8, 0.85 + overlap.length * 0.22),
          overlap,
        });
        return acc;
      }, [])
      .sort((left, right) => right.overlap.length - left.overlap.length || left.target.localeCompare(right.target))
      .slice(0, 3)
      .map(({ overlap, ...edge }) => edge);
    for (const edge of projectDocumentEdges) addEdge(edge);
  }

  const sourceSimilarityEdges: ThesisKnowledgeGraphEdge[] = [];
  for (let index = 0; index < hydratedSources.length; index += 1) {
    const left = hydratedSources[index];
    if (!left) continue;
    const leftThemes = new Set(left.terms.map((term) => term.toLowerCase()));
    for (let inner = index + 1; inner < hydratedSources.length; inner += 1) {
      const right = hydratedSources[inner];
      if (!right) continue;
      const overlap = right.terms.filter((term) => leftThemes.has(term.toLowerCase()));
      if (overlap.length < 2) continue;
      sourceSimilarityEdges.push({
        id: `${left.source.id}<->${right.source.id}`,
        source: left.source.id,
        target: right.source.id,
        kind: 'source-source',
        strength: Math.min(2.4, 0.8 + overlap.length * 0.35),
      });
    }
  }
  for (const edge of sourceSimilarityEdges.slice(0, 18)) addEdge(edge);

  for (const theme of themeContexts) {
    for (const sourceId of theme.sourceIds) {
      addEdge({
        id: `${sourceId}->${theme.id}`,
        source: sourceId,
        target: theme.id,
        kind: 'source-theme',
        strength: 1.55,
      });
    }
    for (const documentId of theme.documentIds) {
      addEdge({
        id: `${documentId}->${theme.id}`,
        source: documentId,
        target: theme.id,
        kind: 'document-theme',
        strength: 1.12,
      });
    }
    for (const projectId of theme.projectIds) {
      addEdge({
        id: `${projectId}->${theme.id}`,
        source: projectId,
        target: theme.id,
        kind: 'project-theme',
        strength: 1.18,
      });
    }
  }

  for (const link of aiEnhancement.sourceLinks) {
    addEdge({
      id: `${link.leftSourceId}<->${link.rightSourceId}:ai`,
      source: link.leftSourceId,
      target: link.rightSourceId,
      kind: 'source-source',
      strength: link.strength,
    });
  }
  for (const link of aiEnhancement.documentSourceLinks) {
    addEdge({
      id: `${link.documentId}->${link.sourceId}:ai`,
      source: link.documentId,
      target: link.sourceId,
      kind: 'source-document',
      strength: link.strength,
    });
  }
  for (const link of aiEnhancement.projectSourceLinks) {
    addEdge({
      id: `${link.projectId}->${link.sourceId}:ai`,
      source: link.projectId,
      target: link.sourceId,
      kind: 'project-source',
      strength: link.strength,
    });
  }
  for (const link of aiEnhancement.projectDocumentLinks) {
    addEdge({
      id: `${link.projectId}->${link.documentId}:ai`,
      source: link.projectId,
      target: link.documentId,
      kind: 'project-document',
      strength: link.strength,
    });
  }

  const edges = [...edgeMap.values()]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.source.localeCompare(right.source) || left.target.localeCompare(right.target));

  const strongestTheme = themes[0];
  const strongestCoverage = [...coverageMap.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))[0];
  const underdescribedSources = hydratedSources.filter((item) => !item.hydrated && item.source.tags.length === 0 && !item.source.abstract && !item.source.notes);
  const aiSemanticLinkCount = aiEnhancement.sourceLinks.length
    + aiEnhancement.documentSourceLinks.length
    + aiEnhancement.projectSourceLinks.length
    + aiEnhancement.projectDocumentLinks.length;
  const mostConnectedProject = projectContexts
    .map((projectContext) => {
      const projectId = `project:${projectContext.project.id}`;
      const projectEdgeCount = edges.filter((edge) => edge.source === projectId || edge.target === projectId).length;
      return { projectContext, projectEdgeCount };
    })
    .sort((left, right) => right.projectEdgeCount - left.projectEdgeCount || left.projectContext.project.name.localeCompare(right.projectContext.project.name))[0];

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      sourceCount: hydratedSources.length,
      documentCount: hydratedDocuments.length,
      projectCount: projectContexts.length,
      themeCount: themes.length,
      connectionCount: edges.length,
      hydratedSourceCount: hydratedSources.filter((item) => item.hydrated).length,
    },
    nodes,
    edges,
    themes,
    coverage: [...coverageMap.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    insights: [
      strongestTheme
        ? {
            title: 'Dominant evidence thread',
            body: `${strongestTheme.label} is the strongest recurring theme right now, with ${strongestTheme.count} connected source${strongestTheme.count === 1 ? '' : 's'} feeding the graph.`,
          }
        : null,
      strongestCoverage
        ? {
            title: 'Best-covered chapter target',
            body: `${strongestCoverage.label} currently has the deepest evidence bench with ${strongestCoverage.count} mapped source${strongestCoverage.count === 1 ? '' : 's'}.`,
          }
        : null,
      mostConnectedProject
        ? {
            title: 'Linked project pressure',
            body: `${mostConnectedProject.projectContext.project.name} is the most connected linked project in the graph right now, with ${mostConnectedProject.projectEdgeCount} evidence relationships touching themes, sources, or supporting documents.`,
          }
        : null,
      aiEnhancement.themes.length > 0 || aiSemanticLinkCount > 0
        ? {
            title: 'AI semantic synthesis',
            body: `AI graph synthesis added ${aiEnhancement.themes.length} refined theme${aiEnhancement.themes.length === 1 ? '' : 's'} and ${aiSemanticLinkCount} higher-signal semantic link${aiSemanticLinkCount === 1 ? '' : 's'} on top of the deterministic graph build.`,
          }
        : null,
      ...aiEnhancement.insights.map((insight, index) => ({
        title: `AI graph signal ${index + 1}`,
        body: insight,
      })),
      {
        title: 'Hydrated source coverage',
        body: `${hydratedSources.filter((item) => item.hydrated).length} of ${hydratedSources.length} source${hydratedSources.length === 1 ? '' : 's'} contributed extra URL or attachment context beyond the manually entered bibliography fields.`,
      },
      {
        title: 'Sources needing more context',
        body: underdescribedSources.length > 0
          ? `${underdescribedSources.length} source${underdescribedSources.length === 1 ? '' : 's'} still look sparse and would benefit from better notes, abstracts, or tags before drafting from them.`
          : 'Every current source has at least some contextual evidence attached, so the graph is not relying only on bare citation records.',
      },
    ].filter((item): item is ThesisKnowledgeInsight => Boolean(item)),
    sourceBriefs: hydratedSources
      .sort((left, right) => right.terms.length - left.terms.length || left.title.localeCompare(right.title))
      .slice(0, 6)
      .map((item) => ({
        id: item.source.id,
        title: item.title,
        summary: item.summary,
        signals: uniqueStrings([
          item.source.role,
          getChapterLabel(item.source.chapterTarget),
          item.venue,
          ...item.terms.slice(0, 3),
        ], 5),
      })),
  };
}

function normalizeWorkspacePath(input: string) {
  const normalized = input
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');

  if (!normalized) {
    throw new Error('Path cannot be empty.');
  }
  if (normalized.includes('..')) {
    throw new Error('Path cannot contain "..".');
  }
  return normalized;
}

function sanitizeRenderWorkspace(snapshot: unknown, fallbackDraft: string) {
  const rawSnapshot = snapshot && typeof snapshot === 'object'
    ? snapshot as { workspace?: { files?: unknown; folders?: unknown }; files?: unknown; folders?: unknown }
    : null;
  const rawWorkspace = rawSnapshot?.workspace && typeof rawSnapshot.workspace === 'object'
    ? rawSnapshot.workspace
    : rawSnapshot;

  const files: ThesisRenderWorkspaceFile[] = [];
  if (Array.isArray(rawWorkspace?.files)) {
    for (const file of rawWorkspace.files) {
      if (!file || typeof file !== 'object') continue;
      const candidate = file as { path?: unknown; content?: unknown; encoding?: unknown; mimeType?: unknown };
      if (typeof candidate.path !== 'string') continue;
      try {
        files.push({
          path: normalizeWorkspacePath(candidate.path),
          content: typeof candidate.content === 'string' ? candidate.content : '',
          encoding: candidate.encoding === 'base64' ? 'base64' : 'utf-8',
          mimeType: typeof candidate.mimeType === 'string' && candidate.mimeType.trim() ? candidate.mimeType.trim() : null,
        });
      } catch {
        continue;
      }
    }
  }

  const uniqueFiles: ThesisRenderWorkspaceFile[] = [];
  const seenPaths = new Set<string>();
  for (const file of files) {
    if (seenPaths.has(file.path)) continue;
    seenPaths.add(file.path);
    uniqueFiles.push(file);
  }

  if (uniqueFiles.length === 0) {
    uniqueFiles.push({ path: DEFAULT_THESIS_EXAMPLE_PATH, content: fallbackDraft });
  }

  const folderSet = new Set<string>();
  const rawFolders = Array.isArray(rawWorkspace?.folders) ? rawWorkspace.folders : [];
  for (const folder of rawFolders) {
    if (!folder || typeof folder !== 'object') continue;
    const candidatePath = (folder as { path?: unknown }).path;
    if (typeof candidatePath !== 'string') continue;
    try {
      folderSet.add(normalizeWorkspacePath(candidatePath));
    } catch {
      continue;
    }
  }

  for (const file of uniqueFiles) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      folderSet.add(segments.slice(0, index).join('/'));
    }
  }

  return {
    files: uniqueFiles.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })),
    folders: [...folderSet].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
  } satisfies ThesisRenderWorkspace;
}

function getWorkspaceFileBuffer(file: ThesisRenderWorkspaceFile) {
  if (file.encoding === 'base64') {
    return Buffer.from(file.content, 'base64');
  }
  return Buffer.from(file.content, 'utf8');
}

function normalizeHyperrefDriverOptionsForPreview(content: string) {
  return content.replace(/\\usepackage\[(((?:(?!\\usepackage)[\s\S])*?))\]\{hyperref\}/g, (fullMatch, rawOptions: string) => {
    const normalizedOptions = rawOptions
      .replace(/(^|,)\s*(?:pdftex|xetex|luatex|dvips|dvipdfm|dvipdfmx)\s*,\s*(?:%[^\r\n]*)?/gim, (_match, prefix: string) => prefix || '')
      .replace(/,\s*,/g, ',')
      .replace(/^\s*,\s*/g, '')
      .replace(/\s*,\s*$/g, '')
      .trim();

    if (!normalizedOptions) {
      return '\\usepackage{hyperref}';
    }

    return `\\usepackage[${normalizedOptions}]{hyperref}`;
  });
}

function normalizeNpsHyperrefMacroForPreview(content: string) {
  return content.replace(
    /\\newcommand\{\\NPShyperref\}\{[\s\S]*?\\makeatother\s*\}/m,
    String.raw`\newcommand{\NPShyperref}{
% Preview-safe hyperref setup for Odyssey renders.
\makeatletter
\usepackage[hidelinks,breaklinks]{hyperref}
\usepackage[all]{hypcap}
\makeatother
}`,
  );
}

function normalizeLatexContentForPreview(content: string) {
  return normalizeNpsHyperrefMacroForPreview(normalizeHyperrefDriverOptionsForPreview(content));
}

function getPreviewRenderBuffer(file: ThesisRenderWorkspaceFile) {
  if (file.encoding === 'base64') {
    return Buffer.from(file.content, 'base64');
  }

  if (!/\.(?:tex|cls|sty)$/i.test(file.path)) {
    return Buffer.from(file.content, 'utf8');
  }

  return Buffer.from(normalizeLatexContentForPreview(file.content), 'utf8');
}

function looksLikeLatexRoot(content: string) {
  return /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(content);
}

function chooseRenderEntryFile(workspace: ThesisRenderWorkspace, activeFilePath?: string | null) {
  const texFiles = workspace.files.filter((file) => /\.tex$/i.test(file.path));
  if (texFiles.length === 0) {
    throw new Error('No LaTeX source files are available to render.');
  }

  const activeFile = activeFilePath
    ? texFiles.find((file) => file.path === activeFilePath) ?? null
    : null;
  const activeRoot = activeFile && looksLikeLatexRoot(activeFile.content) ? activeFile : null;
  if (activeRoot) return activeRoot;

  const mainRoot = texFiles.find((file) => /(^|\/)main\.tex$/i.test(file.path) && looksLikeLatexRoot(file.content));
  if (mainRoot) return mainRoot;

  const firstRoot = texFiles.find((file) => looksLikeLatexRoot(file.content));
  if (firstRoot) return firstRoot;

  if (activeFile) return activeFile;

  const mainFile = texFiles.find((file) => /(^|\/)main\.tex$/i.test(file.path));
  return mainFile ?? texFiles[0];
}

function buildRenderSummary(log: string, diagnostics: ThesisRenderDiagnostic[]) {
  if (diagnostics.length > 0) {
    return diagnostics[0].message;
  }

  const latexErrorLine = log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('!'));
  if (latexErrorLine) {
    return latexErrorLine.replace(/^!\s*/, '');
  }

  return 'LaTeX rendering failed.';
}

function extractRenderDetails(log: string) {
  return log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => (
      line.startsWith('!')
      || /^l\.\d+/.test(line)
      || /LaTeX Error:/i.test(line)
      || /Undefined control sequence/i.test(line)
      || /Emergency stop/i.test(line)
      || /Missing .* inserted/i.test(line)
      || /Fatal error occurred/i.test(line)
    ))
    .slice(0, 10);
}

function parseLatexDiagnostics(log: string, mainFilePath: string) {
  const lines = log.split(/\r?\n/);
  const diagnostics: ThesisRenderDiagnostic[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^(?:\.\/)?([^:\n]+):(\d+):\s*(.+)$/);
    if (!match) continue;
    const [, rawFilePath, rawLineNumber, rawMessage] = match;
    const filePath = rawFilePath.trim() ? rawFilePath.trim().replace(/^\.\//, '') : mainFilePath;
    const lineNumber = Number.parseInt(rawLineNumber, 10);
    const message = rawMessage.trim();
    if (!Number.isFinite(lineNumber) || lineNumber < 1 || !message) continue;
    const severity: 'error' | 'warning' = /warning/i.test(message) ? 'warning' : 'error';
    const key = `${filePath}:${lineNumber}:${message}:${severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      filePath,
      lineNumber,
      message,
      severity,
    });
  }

  return diagnostics.slice(0, 25);
}

async function compileLatexWorkspace(workspace: ThesisRenderWorkspace, activeFilePath?: string | null) {
  const totalBytes = workspace.files.reduce((sum, file) => sum + getWorkspaceFileBuffer(file).byteLength, 0);
  if (totalBytes > MAX_RENDER_SOURCE_BYTES) {
    throw new Error('Thesis workspace is too large to render.');
  }

  const entryFile = chooseRenderEntryFile(workspace, activeFilePath);
  const renderRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'odyssey-thesis-render-'));
  const outputRoot = path.join(renderRoot, '.tectonic-out');
  const cacheRoot = path.join(renderRoot, '.cache');
  const texmfVarRoot = path.join(renderRoot, '.texmf-var');

  try {
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.mkdir(cacheRoot, { recursive: true });
    await fs.mkdir(texmfVarRoot, { recursive: true });

    for (const folderPath of workspace.folders) {
      await fs.mkdir(path.join(renderRoot, folderPath), { recursive: true });
    }

    for (const file of workspace.files) {
      const absolutePath = path.join(renderRoot, file.path);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, getPreviewRenderBuffer(file));
    }

    let compileLog = '';
    try {
      const { stdout, stderr } = await execFileAsync(
        'tectonic',
        [
          '--keep-logs',
          '--keep-intermediates',
          '--chatter',
          'minimal',
          '--reruns',
          '2',
          '--outdir',
          outputRoot,
          '--untrusted',
          entryFile.path,
        ],
        {
          cwd: renderRoot,
          timeout: LATEX_RENDER_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            HOME: renderRoot,
            XDG_CACHE_HOME: cacheRoot,
            TEXMFVAR: texmfVarRoot,
          },
        },
      );
      compileLog = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
    } catch (error) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        signal?: NodeJS.Signals;
        killed?: boolean;
        code?: number | string | null;
      };
      compileLog = `${execError.stdout ?? ''}\n${execError.stderr ?? ''}`.trim();
      if (execError.signal === 'SIGTERM' || execError.killed) {
        compileLog = `${compileLog}\nLaTeX rendering timed out after ${LATEX_RENDER_TIMEOUT_MS}ms.`.trim();
      }
    }

    const outputBaseName = path.basename(entryFile.path).replace(/\.tex$/i, '');
    const pdfPath = path.join(outputRoot, `${outputBaseName}.pdf`);
    const logPath = path.join(outputRoot, `${outputBaseName}.log`);
    const fileLog = await fs.readFile(logPath, 'utf8').catch(() => '');
    if (fileLog.trim()) {
      compileLog = [compileLog, fileLog].filter((part) => part.trim().length > 0).join('\n');
    }
    const pdfExists = await fs.stat(pdfPath).then(() => true).catch(() => false);
    const diagnostics = parseLatexDiagnostics(compileLog, entryFile.path);

    if (!pdfExists) {
      return {
        success: false,
        mainFilePath: entryFile.path,
        pdfBase64: null,
        previewText: '',
        pageCount: 0,
        wordCount: 0,
        summary: buildRenderSummary(compileLog, diagnostics),
        details: extractRenderDetails(compileLog),
        diagnostics,
        log: compileLog,
      };
    }

    const pdfBuffer = await fs.readFile(pdfPath);
    let previewText = '';
    let pageCount = 1;
    try {
      const pdfData = await pdfParse(pdfBuffer);
      previewText = pdfData.text?.replace(/\s+/g, ' ').trim() ?? '';
      pageCount = Math.max(1, pdfData.numpages || 1);
    } catch {
      previewText = '';
      pageCount = 1;
    }

    return {
      success: true,
      mainFilePath: entryFile.path,
      pdfBase64: pdfBuffer.toString('base64'),
      previewText,
      pageCount,
      wordCount: previewText ? previewText.split(/\s+/).length : 0,
      summary: diagnostics.length > 0 ? diagnostics[0].message : 'LaTeX rendered successfully.',
      details: diagnostics.slice(0, 6).map((diagnostic) => (
        `${diagnostic.filePath ?? entryFile.path}:${diagnostic.lineNumber} ${diagnostic.message}`
      )),
      diagnostics,
      log: compileLog,
    };
  } finally {
    await fs.rm(renderRoot, { recursive: true, force: true });
  }
}

function getWorkspaceSummary(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      fileCount: 0,
      folderCount: 0,
      filePaths: [] as string[],
      folderPaths: [] as string[],
    };
  }

  const workspace = (snapshot as { workspace?: { files?: Array<{ path?: unknown }>; folders?: Array<{ path?: unknown }> } }).workspace;
  const files = Array.isArray(workspace?.files) ? workspace.files : [];
  const folders = Array.isArray(workspace?.folders) ? workspace.folders : [];

  return {
    fileCount: files.length,
    folderCount: folders.length,
    filePaths: files
      .map((file) => (typeof file?.path === 'string' ? file.path : ''))
      .filter((path) => path.length > 0),
    folderPaths: folders
      .map((folder) => (typeof folder?.path === 'string' ? folder.path : ''))
      .filter((path) => path.length > 0),
  };
}

function encodePathSegments(path: string) {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function normalizeGitHubRepo(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('GitHub repository is required.');
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.hostname !== 'github.com') throw new Error('GitHub repository URL must use github.com.');
    const repo = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GitHub repository must look like owner/repo.');
    return repo;
  }
  const repo = trimmed.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GitHub repository must look like owner/repo.');
  return repo;
}

function normalizeGitLabRepoInput(input: string, hostInput?: string | null) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('GitLab repository is required.');

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') throw new Error('GitLab repository URL must start with https://');
    const repo = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (!repo.includes('/')) throw new Error('GitLab repository URL must include the full group/project path.');
    return { host: url.origin.replace(/\/+$/, ''), repo };
  }

  const repo = trimmed.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  const host = hostInput?.trim().replace(/\/+$/, '') ?? '';
  if (!host) throw new Error('GitLab host is required when the repository is not a full URL.');
  if (!/^https:\/\//i.test(host)) throw new Error('GitLab host must start with https://');
  if (!repo.includes('/')) throw new Error('GitLab repository must include the full group/project path.');
  return { host, repo };
}

function normalizeFilePath(input: string | null | undefined) {
  const filePath = (input ?? '').trim().replace(/^\/+/, '');
  if (!filePath) return 'main.tex';
  if (filePath.includes('..')) throw new Error('File path cannot contain "..".');
  return filePath;
}

function normalizeGitLabHost(host: string | null | undefined) {
  return (host ?? '').trim().replace(/\/+$/, '');
}

function normalizeGitLabRepoPath(repo: string | null | undefined) {
  return (repo ?? '').trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

function getGitLabRepoPaths(config: GitLabIntegrationConfig | null | undefined) {
  const repoPath = config?.repoPath?.trim();
  const repos = (config?.repos ?? []).map((value) => value.trim()).filter(Boolean);
  const repo = config?.repo?.trim();
  return [...new Set([repoPath, ...repos, repo].filter((value): value is string => Boolean(value)).map(normalizeGitLabRepoPath))];
}

function getGitLabHost(config: GitLabIntegrationConfig | null | undefined) {
  if (config?.host?.trim()) return normalizeGitLabHost(config.host);
  if (config?.repoUrl?.trim()) {
    try {
      return normalizeGitLabHost(new URL(config.repoUrl).origin);
    } catch {
      return '';
    }
  }
  return '';
}

function normalizeFilePaths(input: unknown, fallbackFilePath: string | null | undefined) {
  const values = Array.isArray(input) ? input : [];
  const normalized = [...new Set(values
    .map((value) => (typeof value === 'string' ? normalizeFilePath(value) : null))
    .filter((value): value is string => Boolean(value)))];
  if (normalized.length > 0) return normalized;
  return [normalizeFilePath(fallbackFilePath)];
}

function normalizeOptionalFilePaths(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values
    .map((value) => (typeof value === 'string' ? normalizeFilePath(value) : null))
    .filter((value): value is string => Boolean(value)))];
}

async function requireUser(authorization: string | undefined) {
  const userId = await getUserFromAuthHeader(authorization);
  return userId;
}

async function getThesisDocument(userId: string): Promise<ThesisDocumentRow | null> {
  const { data, error } = await supabase
    .from('thesis_documents')
    .select('user_id, draft, editor_theme, snapshot, repo_sync_status, repo_sync_error, repo_synced_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ThesisDocumentRow | null) ?? null;
}

async function getProfileDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.display_name === 'string' ? data.display_name : null;
}

async function seedDefaultThesisDocumentForUser(userId: string): Promise<ThesisDocumentRow | null> {
  const displayName = await getProfileDisplayName(userId);
  if (isKyleHicksDisplayName(displayName)) {
    return null;
  }

  const seed = createDefaultThesisDocumentSeed();
  const { error: upsertError } = await supabase
    .from('thesis_documents')
    .upsert({
      user_id: userId,
      draft: seed.draft,
      editor_theme: null,
      snapshot: seed.snapshot,
      repo_sync_status: 'idle',
      repo_sync_error: null,
      repo_synced_at: null,
    });
  if (upsertError) throw upsertError;

  return getThesisDocument(userId);
}

async function getThesisRepoLink(userId: string): Promise<ThesisRepoLinkRow | null> {
  const { data, error } = await supabase
    .from('user_thesis_repo_links')
    .select('id, user_id, provider, repo, host, branch, file_path, file_paths, sync_all_workspace_files, last_synced_file_paths, autosave_enabled, token_encrypted, token_iv, token_auth_tag, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ThesisRepoLinkRow | null) ?? null;
}

function mapRepoLink(row: ThesisRepoLinkRow | null) {
  if (!row) return null;
  const filePaths = normalizeFilePaths(row.file_paths, row.file_path);
  return {
    id: row.id,
    provider: row.provider,
    repo: row.repo,
    host: row.host,
    filePath: filePaths[0] ?? normalizeFilePath(row.file_path),
    filePaths,
    syncAllWorkspaceFiles: row.sync_all_workspace_files,
    autosaveEnabled: row.autosave_enabled,
    tokenSaved: Boolean(row.token_encrypted && row.token_iv && row.token_auth_tag),
    updatedAt: row.updated_at,
  };
}

function readStoredToken(row: ThesisRepoLinkRow | null) {
  if (!row?.token_encrypted || !row.token_iv || !row.token_auth_tag) return '';
  return getGitLabToken({
    tokenEncrypted: row.token_encrypted,
    tokenIv: row.token_iv,
    tokenAuthTag: row.token_auth_tag,
  });
}

async function findLinkedProjectGitLabToken(row: ThesisRepoLinkRow) {
  if (row.provider !== 'gitlab') return '';

  const repo = normalizeGitLabRepoPath(row.repo);
  const host = normalizeGitLabHost(row.host);
  if (!repo || !host) return '';

  const { data: memberships, error: membershipError } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', row.user_id);
  if (membershipError) return '';

  const projectIds = ((memberships as ProjectMemberRow[] | null) ?? [])
    .map((entry) => entry.project_id)
    .filter(Boolean);
  if (projectIds.length === 0) return '';

  const [{ data: integrations, error: integrationError }, { data: tokenRows, error: tokenError }] = await Promise.all([
    supabase
      .from('integrations')
      .select('project_id, config')
      .in('project_id', projectIds)
      .eq('type', 'gitlab'),
    supabase
      .from('user_project_gitlab_tokens')
      .select('project_id, host, token_encrypted, token_iv, token_auth_tag')
      .eq('user_id', row.user_id)
      .in('project_id', projectIds),
  ]);

  if (integrationError || tokenError) return '';

  const tokenByProjectId = new Map(
    (((tokenRows as UserProjectGitLabTokenRow[] | null) ?? []).filter((entry) => normalizeGitLabHost(entry.host) === host))
      .map((entry) => [
        entry.project_id,
        getGitLabToken({
          tokenEncrypted: entry.token_encrypted,
          tokenIv: entry.token_iv,
          tokenAuthTag: entry.token_auth_tag,
        }),
      ]),
  );

  for (const integration of (integrations as GitLabIntegrationRow[] | null) ?? []) {
    const config = integration.config;
    if (getGitLabHost(config) !== host) continue;
    if (!getGitLabRepoPaths(config).includes(repo)) continue;

    const userToken = tokenByProjectId.get(integration.project_id)?.trim();
    if (userToken) return userToken;

    const sharedToken = getGitLabToken(config).trim();
    if (sharedToken) return sharedToken;
  }

  return '';
}

async function resolveGitHubBranch(repo: string, token: string, preferredBranch: string | null) {
  if (preferredBranch) return preferredBranch;
  const [owner, repoName] = repo.split('/');
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Odyssey-App',
    },
  });
  if (!response.ok) {
    throw new Error('Failed to read GitHub repository metadata. Check the repository and token permissions.');
  }
  const payload = await response.json() as { default_branch?: string };
  return payload.default_branch?.trim() || 'main';
}

function getSelectedRepoFiles(row: ThesisRepoLinkRow, snapshot: unknown, fallbackDraft: string) {
  const workspace = sanitizeRenderWorkspace(snapshot, fallbackDraft);
  if (row.sync_all_workspace_files) {
    if (workspace.files.length === 0) {
      throw new Error('No workspace documents were found to sync.');
    }
    return workspace.files;
  }

  const selectedPaths = normalizeFilePaths(row.file_paths, row.file_path);
  const workspaceByPath = new Map(workspace.files.map((file) => [file.path, file]));
  const selectedFiles: ThesisRenderWorkspaceFile[] = [];
  const seen = new Set<string>();

  for (const selectedPath of selectedPaths) {
    let match = workspaceByPath.get(selectedPath) ?? null;
    if (!match) {
      const basename = selectedPath.split('/').pop();
      const basenameMatches = workspace.files.filter((file) => file.path.split('/').pop() === basename);
      if (basenameMatches.length === 1) match = basenameMatches[0];
    }
    if (!match || seen.has(match.path)) continue;
    seen.add(match.path);
    selectedFiles.push(match);
  }

  return selectedFiles;
}

async function syncDraftToGitHub(row: ThesisRepoLinkRow, files: ThesisRenderWorkspaceFile[]) {
  const token = readStoredToken(row);
  if (!token) throw new Error('GitHub token is missing for thesis repo autosave.');

  const [owner, repoName] = row.repo.split('/');
  const branch = await resolveGitHubBranch(row.repo, token, row.branch);
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Odyssey-App',
  };

  for (const file of files) {
    const filePath = normalizeFilePath(file.path);
    const fileBuffer = getWorkspaceFileBuffer(file);
    const fileUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/contents/${encodePathSegments(filePath)}?ref=${encodeURIComponent(branch)}`;
    const currentResponse = await fetch(fileUrl, { headers });
    let sha: string | undefined;
    if (currentResponse.ok) {
      const current = await currentResponse.json() as { sha?: string; content?: string; encoding?: string };
      sha = current.sha;
      if (current.content && current.encoding === 'base64') {
        const existing = Buffer.from(current.content.replace(/\n/g, ''), 'base64');
        if (existing.equals(fileBuffer)) continue;
      }
    } else if (currentResponse.status !== 404) {
      throw new Error('Failed to read the target file from GitHub.');
    }

    const updateResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/contents/${encodePathSegments(filePath)}`,
      {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Update thesis LaTeX file ${filePath} from Odyssey`,
          content: fileBuffer.toString('base64'),
          branch,
          ...(sha ? { sha } : {}),
        }),
      },
    );

    if (!updateResponse.ok) {
      const message = await updateResponse.text().catch(() => '');
      throw new Error(`GitHub save failed: ${message.slice(0, 200) || updateResponse.statusText}`);
    }
  }
}

async function resolveGitLabBranch(row: ThesisRepoLinkRow, token: string) {
  if (row.branch?.trim()) return row.branch.trim();
  const projectId = encodeURIComponent(row.repo);
  const headers = { 'PRIVATE-TOKEN': token };
  let lastFailure = '';

  const response = await fetch(`${row.host}/api/v4/projects/${projectId}`, { headers });
  if (response.ok) {
    const payload = await response.json() as { default_branch?: string };
    if (payload.default_branch?.trim()) return payload.default_branch.trim();
  } else {
    const message = await response.text().catch(() => '');
    lastFailure = `GitLab ${response.status}: ${message.slice(0, 200) || response.statusText}`;
  }

  for (const candidate of ['main', 'master']) {
    const branchResponse = await fetch(
      `${row.host}/api/v4/projects/${projectId}/repository/branches/${encodeURIComponent(candidate)}`,
      { headers },
    );
    if (branchResponse.ok) return candidate;
    const message = await branchResponse.text().catch(() => '');
    lastFailure = `GitLab ${branchResponse.status}: ${message.slice(0, 200) || branchResponse.statusText}`;
  }

  const branchesResponse = await fetch(
    `${row.host}/api/v4/projects/${projectId}/repository/branches?per_page=1`,
    { headers },
  );
  if (branchesResponse.ok) {
    const payload = await branchesResponse.json() as Array<{ name?: string }>;
    const branch = payload.find((item) => item.name?.trim())?.name?.trim();
    if (branch) return branch;
  } else {
    const message = await branchesResponse.text().catch(() => '');
    lastFailure = `GitLab ${branchesResponse.status}: ${message.slice(0, 200) || branchesResponse.statusText}`;
  }

  throw new Error(lastFailure ? `Failed to read GitLab repository metadata. ${lastFailure}` : 'Failed to read GitLab repository metadata.');
}

async function syncDraftToGitLabWithToken(row: ThesisRepoLinkRow, files: ThesisRenderWorkspaceFile[], token: string) {
  if (!row.host) throw new Error('GitLab host is missing for thesis repo autosave.');

  const branch = await resolveGitLabBranch(row, token);
  const headers = {
    'PRIVATE-TOKEN': token,
    'Content-Type': 'application/json',
  };
  const currentPaths = files.map((file) => normalizeFilePath(file.path));
  const currentPathSet = new Set(currentPaths);
  const stalePaths = normalizeOptionalFilePaths(row.last_synced_file_paths)
    .filter((filePath) => !currentPathSet.has(filePath));

  for (const file of files) {
    const filePath = normalizeFilePath(file.path);
    const fileBuffer = getWorkspaceFileBuffer(file);
    const fileEndpoint = `${row.host}/api/v4/projects/${encodeURIComponent(row.repo)}/repository/files/${encodeURIComponent(filePath)}`;
    const currentResponse = await fetch(`${fileEndpoint}?ref=${encodeURIComponent(branch)}`, { headers: { 'PRIVATE-TOKEN': token } });
    if (currentResponse.ok) {
      const current = await currentResponse.json() as { content?: string; encoding?: string };
      if (current.content && current.encoding === 'base64') {
        const existing = Buffer.from(current.content, 'base64');
        if (existing.equals(fileBuffer)) continue;
      }
    } else if (currentResponse.status !== 404) {
      const message = await currentResponse.text().catch(() => '');
      throw new Error(`GitLab file lookup failed: ${message.slice(0, 200) || currentResponse.statusText}`);
    }

    const body = JSON.stringify({
      branch,
      content: fileBuffer.toString('base64'),
      encoding: 'base64',
      commit_message: `Update thesis LaTeX file ${filePath} from Odyssey`,
    });

    const saveResponse = await fetch(fileEndpoint, {
      method: currentResponse.status === 404 ? 'POST' : 'PUT',
      headers,
      body,
    });

    if (!saveResponse.ok) {
      const message = await saveResponse.text().catch(() => '');
      throw new Error(`GitLab save failed: ${message.slice(0, 200) || saveResponse.statusText}`);
    }
  }

  for (const filePath of stalePaths) {
    const fileEndpoint = `${row.host}/api/v4/projects/${encodeURIComponent(row.repo)}/repository/files/${encodeURIComponent(filePath)}`;
    const currentResponse = await fetch(`${fileEndpoint}?ref=${encodeURIComponent(branch)}`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (currentResponse.status === 404) continue;
    if (!currentResponse.ok) {
      const message = await currentResponse.text().catch(() => '');
      throw new Error(`GitLab file lookup failed: ${message.slice(0, 200) || currentResponse.statusText}`);
    }

    const deleteResponse = await fetch(fileEndpoint, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        branch,
        commit_message: `Delete thesis file ${filePath} removed from Odyssey`,
      }),
    });

    if (!deleteResponse.ok) {
      const message = await deleteResponse.text().catch(() => '');
      throw new Error(`GitLab delete failed: ${message.slice(0, 200) || deleteResponse.statusText}`);
    }
  }
}

function isGitLabAuthFailure(message: string) {
  return /\b(401|403)\b/.test(message) || /unauthorized|forbidden/i.test(message);
}

async function syncDraftToGitLab(row: ThesisRepoLinkRow, files: ThesisRenderWorkspaceFile[]) {
  const thesisToken = readStoredToken(row).trim();
  const linkedProjectToken = (await findLinkedProjectGitLabToken(row)).trim();
  const candidateTokens = [...new Set([thesisToken, linkedProjectToken].filter(Boolean))];
  if (candidateTokens.length === 0) throw new Error('GitLab token is missing for thesis repo autosave.');

  let lastError: Error | null = null;
  for (const token of candidateTokens) {
    try {
      await syncDraftToGitLabWithToken(row, files, token);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Failed to sync thesis draft to GitLab.');
      if (!isGitLabAuthFailure(lastError.message)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('Failed to sync thesis draft to GitLab.');
}

async function syncDraftToRepo(row: ThesisRepoLinkRow | null, draft: string, snapshot: unknown) {
  if (!row || !row.autosave_enabled) {
    return { status: 'idle' as const, error: null, syncedAt: null };
  }

  const files = getSelectedRepoFiles(row, snapshot, draft);
  if (row.provider === 'github') {
    await syncDraftToGitHub(row, files);
  } else {
    await syncDraftToGitLab(row, files);
    const syncedPaths = files.map((file) => normalizeFilePath(file.path));
    const { error } = await supabase
      .from('user_thesis_repo_links')
      .update({ last_synced_file_paths: syncedPaths })
      .eq('id', row.id);
    if (error) {
      throw new Error('GitLab sync finished, but Odyssey could not record the synced file manifest.');
    }
  }

  return { status: 'saved' as const, error: null, syncedAt: new Date().toISOString() };
}

export async function thesisRoutes(server: FastifyInstance) {
  await server.register(multipart, {
    limits: { fileSize: MAX_SOURCE_PDF_BYTES },
  });

  server.post('/thesis/sources/upload-pdf', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const requestWithFile = request as typeof request & {
      file: () => Promise<{
        filename: string;
        mimetype: string;
        toBuffer: () => Promise<Buffer>;
      } | undefined>;
    };

    const upload = await requestWithFile.file().catch(() => undefined);
    if (!upload) {
      return reply.status(400).send({ error: 'PDF file is required.' });
    }

    const filename = upload.filename?.trim() || 'upload.pdf';
    const mimeType = normalizeThesisDocumentMimeType(upload.mimetype || 'application/octet-stream', filename);
    if (!/\.pdf$/i.test(filename) && mimeType !== 'application/pdf') {
      return reply.status(415).send({ error: 'Only PDF uploads are supported here.' });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await upload.toBuffer();
    } catch {
      return reply.status(400).send({ error: 'Failed to read the uploaded PDF.' });
    }

    if (fileBuffer.byteLength === 0) {
      return reply.status(400).send({ error: 'Uploaded PDF is empty.' });
    }
    if (fileBuffer.byteLength > MAX_SOURCE_PDF_BYTES) {
      return reply.status(413).send({ error: 'Uploaded PDF exceeds the 32 MB limit.' });
    }
    if (fileBuffer.byteLength < 5 || !fileBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      return reply.status(415).send({ error: 'Uploaded file is not a valid PDF.' });
    }

    const storagePath = `thesis-sources/${userId}/${Date.now().toString(36)}-${sanitizeStorageName(filename)}`;
    const { error: storageError } = await supabase.storage
      .from(THESIS_SOURCE_BUCKET)
      .upload(storagePath, fileBuffer, { contentType: 'application/pdf', upsert: false });

    if (storageError) {
      request.log.error({
        thesisSourcePdfUpload: {
          userId,
          filename,
          storagePath,
          error: storageError.message,
        },
      }, 'failed to upload thesis source pdf');
      return reply.status(500).send({ error: `Storage upload failed: ${storageError.message}` });
    }

    return {
      attachment: {
        name: filename,
        storagePath,
        mimeType: 'application/pdf',
        uploadedAt: new Date().toISOString(),
      },
    };
  });

  server.post('/thesis/documents/upload', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const requestWithFile = request as typeof request & {
      file: () => Promise<{
        filename: string;
        mimetype: string;
        toBuffer: () => Promise<Buffer>;
      } | undefined>;
    };

    const upload = await requestWithFile.file().catch(() => undefined);
    if (!upload) {
      return reply.status(400).send({ error: 'Document file is required.' });
    }

    const filename = upload.filename?.trim() || 'document';
    const mimeType = normalizeThesisDocumentMimeType(upload.mimetype || 'application/octet-stream', filename);

    let fileBuffer: Buffer;
    try {
      fileBuffer = await upload.toBuffer();
    } catch {
      return reply.status(400).send({ error: 'Failed to read the uploaded document.' });
    }

    if (fileBuffer.byteLength === 0) {
      return reply.status(400).send({ error: 'Uploaded document is empty.' });
    }
    if (fileBuffer.byteLength > MAX_SOURCE_PDF_BYTES) {
      return reply.status(413).send({ error: 'Uploaded document exceeds the 32 MB limit.' });
    }

    const extractedTextPreview = await extractDocumentTextPreview(fileBuffer, mimeType, filename);

    const storagePath = `thesis-documents/${userId}/${Date.now().toString(36)}-${sanitizeStorageName(filename)}`;
    const { error: storageError } = await supabase.storage
      .from(THESIS_SOURCE_BUCKET)
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });

    if (storageError) {
      request.log.error({
        thesisDocumentUpload: {
          userId,
          filename,
          storagePath,
          error: storageError.message,
        },
      }, 'failed to upload thesis document');
      return reply.status(500).send({ error: `Storage upload failed: ${storageError.message}` });
    }

    return {
      attachment: {
        name: filename,
        storagePath,
        mimeType,
        uploadedAt: new Date().toISOString(),
        extractedTextPreview,
      },
    };
  });

  server.post('/thesis/sources/parse-pdf', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const requestWithFile = request as typeof request & {
      file: () => Promise<{
        filename: string;
        mimetype: string;
        toBuffer: () => Promise<Buffer>;
      } | undefined>;
    };

    const upload = await requestWithFile.file().catch(() => undefined);
    if (!upload) {
      return reply.status(400).send({ error: 'PDF file is required.' });
    }

    const filename = upload.filename?.trim() || 'upload.pdf';
    const mimeType = upload.mimetype || 'application/octet-stream';
    if (!/\.pdf$/i.test(filename) && mimeType !== 'application/pdf') {
      return reply.status(415).send({ error: 'Only PDF uploads are supported here.' });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await upload.toBuffer();
    } catch {
      return reply.status(400).send({ error: 'Failed to read the uploaded PDF.' });
    }

    if (fileBuffer.byteLength === 0) {
      return reply.status(400).send({ error: 'Uploaded PDF is empty.' });
    }
    if (fileBuffer.byteLength > MAX_SOURCE_PDF_BYTES) {
      return reply.status(413).send({ error: 'Uploaded PDF exceeds the 32 MB limit.' });
    }
    if (fileBuffer.byteLength < 5 || !fileBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      return reply.status(415).send({ error: 'Uploaded file is not a valid PDF.' });
    }

    try {
      const pdfData = await pdfParse(fileBuffer);
      if (!pdfData.text?.trim() && !pdfData.info) {
        return reply.status(422).send({ error: 'No readable text could be extracted from that PDF.' });
      }

      return {
        document: inferPdfSourceMetadata(pdfData, filename),
      };
    } catch (error) {
      request.log.warn({
        thesisSourcePdfParse: {
          userId,
          filename,
          error: error instanceof Error ? error.message : 'Unknown PDF parse error',
        },
      }, 'failed to parse thesis source pdf');
      return reply.status(422).send({ error: 'Could not parse that PDF. Try a text-based PDF instead of a scanned image.' });
    }
  });

  server.post<{
    Body: {
      url?: string;
    };
  }>('/thesis/sources/parse-url', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const url = typeof request.body?.url === 'string' ? request.body.url.trim() : '';
    if (!url) {
      return reply.status(400).send({ error: 'A URL is required.' });
    }

    try {
      return {
        document: await inferUrlSourceMetadata(url),
      };
    } catch (error) {
      request.log.warn({
        thesisSourceUrlParse: {
          userId,
          url,
          error: error instanceof Error ? error.message : 'Unknown URL parse error',
        },
      }, 'failed to parse thesis source url');

      const message = error instanceof Error ? error.message : 'Could not parse that URL.';
      const status = /valid absolute url|http and https/i.test(message) ? 400 : 422;
      return reply.status(status).send({ error: message });
    }
  });

  server.post<{
    Body: {
      sourceLibrary?: unknown;
      thesisDocuments?: unknown;
      linkedProjects?: unknown;
      linkedGoals?: unknown;
      linkedEvents?: unknown;
    };
  }>('/thesis/knowledge/graph', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const sourceLibrary = Array.isArray(request.body.sourceLibrary)
      ? request.body.sourceLibrary
          .map((item) => normalizeSourceLibraryItem(item))
          .filter((item): item is ThesisSourceLibraryItem => Boolean(item))
      : [];
    const thesisDocuments = Array.isArray(request.body.thesisDocuments)
      ? request.body.thesisDocuments
          .map((item) => normalizeThesisSupportingDocument(item))
          .filter((item): item is ThesisSupportingDocumentItem => Boolean(item))
      : [];
    const linkedProjects = Array.isArray(request.body.linkedProjects)
      ? request.body.linkedProjects
          .map((item) => normalizeThesisKnowledgeLinkedProject(item))
          .filter((item): item is ThesisKnowledgeLinkedProject => Boolean(item))
      : [];
    const linkedGoals = Array.isArray(request.body.linkedGoals)
      ? request.body.linkedGoals
          .map((item) => normalizeThesisKnowledgeLinkedGoal(item))
          .filter((item): item is ThesisKnowledgeLinkedGoal => Boolean(item))
      : [];
    const linkedEvents = Array.isArray(request.body.linkedEvents)
      ? request.body.linkedEvents
          .map((item) => normalizeThesisKnowledgeLinkedEvent(item))
          .filter((item): item is ThesisKnowledgeLinkedEvent => Boolean(item))
      : [];

    try {
      const enrichedLinkedProjects = await enrichThesisKnowledgeLinkedProjectsWithGitLabRepos(linkedProjects);
      return {
        graph: await buildThesisKnowledgeGraph(sourceLibrary, thesisDocuments, enrichedLinkedProjects, linkedGoals, linkedEvents),
      };
    } catch (error) {
      request.log.error({
        thesisKnowledgeGraph: {
          userId,
          sourceCount: sourceLibrary.length,
          documentCount: thesisDocuments.length,
          projectCount: linkedProjects.length,
          error: error instanceof Error ? error.message : 'Unknown knowledge graph error',
        },
      }, 'failed to build thesis knowledge graph');
      return reply.status(500).send({ error: 'Failed to build thesis knowledge graph.' });
    }
  });

  server.post<{
    Body: {
      storagePath?: string;
    };
  }>('/thesis/sources/sign', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const storagePath = typeof request.body?.storagePath === 'string' ? request.body.storagePath.trim() : '';
    if (!storagePath) return reply.status(400).send({ error: 'storagePath required' });
    if (
      !storagePath.startsWith(`thesis-sources/${userId}/`)
      && !storagePath.startsWith(`thesis-documents/${userId}/`)
    ) {
      return reply.status(403).send({ error: 'That thesis attachment is not available.' });
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(THESIS_SOURCE_BUCKET)
      .createSignedUrl(storagePath, 3600);

    if (signError || !signed?.signedUrl) {
      return reply.status(500).send({ error: signError?.message || 'Failed to sign thesis source attachment.' });
    }

    return { url: signed.signedUrl };
  });

  server.post<{
    Body: {
      libraryItem?: unknown;
      queueItem?: unknown;
    };
  }>('/thesis/sources/queue', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const libraryItem = normalizeSourceLibraryItem(request.body.libraryItem);
    const queueItem = normalizeSourceQueueItem(request.body.queueItem);
    if (!libraryItem || !queueItem) {
      return reply.status(400).send({ error: 'A complete thesis source record is required before queueing.' });
    }

    try {
      const document = await getThesisDocument(userId);
      const nextSnapshot = mergeThesisSourceSnapshot(document?.snapshot, libraryItem, queueItem);

      const { error: upsertError } = await supabase
        .from('thesis_documents')
        .upsert({
          user_id: userId,
          draft: document?.draft ?? '',
          editor_theme: document?.editor_theme ?? null,
          snapshot: nextSnapshot,
        });

      if (upsertError) {
        request.log.error({
          thesisSourceQueue: {
            userId,
            title: libraryItem.title,
            locator: libraryItem.locator,
            error: upsertError.message,
          },
        }, 'failed to persist thesis source queue item');
        return reply.status(500).send({ error: 'Failed to queue thesis source.' });
      }

      const updatedDocument = await getThesisDocument(userId);
      const sourceSnapshot = readSourceSnapshot(updatedDocument?.snapshot);
      return {
        ok: true,
        sourceLibrary: sourceSnapshot.sourceLibrary,
        sourceQueueItems: sourceSnapshot.sourceQueueItems,
        updatedAt: updatedDocument?.updated_at ?? new Date().toISOString(),
      };
    } catch (error) {
      request.log.error({
        thesisSourceQueue: {
          userId,
          title: libraryItem.title,
          locator: libraryItem.locator,
          error: error instanceof Error ? error.message : 'Unknown queue error',
        },
      }, 'failed thesis source queue');
      return reply.status(500).send({ error: 'Failed to queue thesis source.' });
    }
  });

  server.put<{
    Body: {
      sourceLibrary?: unknown;
      sourceQueueItems?: unknown;
      thesisDocuments?: unknown;
    };
  }>('/thesis/sources/save', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const sourceLibrary = Array.isArray(request.body.sourceLibrary)
      ? request.body.sourceLibrary
          .map((item) => normalizeSourceLibraryItem(item))
          .filter((item): item is ThesisSourceLibraryItem => Boolean(item))
      : null;
    const sourceQueueItems = Array.isArray(request.body.sourceQueueItems)
      ? request.body.sourceQueueItems
          .map((item) => normalizeSourceQueueItem(item))
          .filter((item): item is ThesisSourceQueueItem => Boolean(item))
      : null;
    const thesisDocuments = Array.isArray(request.body.thesisDocuments)
      ? request.body.thesisDocuments
          .map((item) => normalizeThesisSupportingDocument(item))
          .filter((item): item is ThesisSupportingDocumentItem => Boolean(item))
      : [];

    if (!sourceLibrary || !sourceQueueItems) {
      return reply.status(400).send({ error: 'A complete thesis source snapshot is required.' });
    }

    try {
      const document = await getThesisDocument(userId);
      const baseSnapshot = asObject(document?.snapshot) ?? {};
      const nextSnapshot = {
        ...baseSnapshot,
        sourceLibrary,
        sourceQueueItems,
        thesisDocuments,
      };

      const { error: upsertError } = await supabase
        .from('thesis_documents')
        .upsert({
          user_id: userId,
          draft: document?.draft ?? '',
          editor_theme: document?.editor_theme ?? null,
          snapshot: nextSnapshot,
        });

      if (upsertError) {
        request.log.error({
          thesisSourceSave: {
            userId,
            sourceCount: sourceLibrary.length,
            queueCount: sourceQueueItems.length,
            documentCount: thesisDocuments.length,
            error: upsertError.message,
          },
        }, 'failed to persist thesis source snapshot');
        return reply.status(500).send({ error: 'Failed to save thesis sources.' });
      }

      const updatedDocument = await getThesisDocument(userId);
      const sourceSnapshot = readSourceSnapshot(updatedDocument?.snapshot);
      return {
        ok: true,
        sourceLibrary: sourceSnapshot.sourceLibrary,
        sourceQueueItems: sourceSnapshot.sourceQueueItems,
        thesisDocuments: sourceSnapshot.thesisDocuments,
        updatedAt: updatedDocument?.updated_at ?? new Date().toISOString(),
      };
    } catch (error) {
      request.log.error({
        thesisSourceSave: {
          userId,
          error: error instanceof Error ? error.message : 'Unknown thesis source save error',
        },
      }, 'failed thesis source save');
      return reply.status(500).send({ error: 'Failed to save thesis sources.' });
    }
  });

  server.post<{
    Body: {
      draft?: string;
      workspace?: unknown;
      activeFilePath?: string | null;
    };
  }>('/thesis/render', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const draft = typeof request.body.draft === 'string' ? request.body.draft : '';
    const activeFilePath = typeof request.body.activeFilePath === 'string' && request.body.activeFilePath.trim()
      ? normalizeWorkspacePath(request.body.activeFilePath)
      : null;

    try {
      const workspace = sanitizeRenderWorkspace(request.body.workspace, draft);
      const result = await compileLatexWorkspace(workspace, activeFilePath);

      request.log.info({
        thesisRender: {
          userId,
          success: result.success,
          mainFilePath: result.mainFilePath,
          activeFilePath,
          fileCount: workspace.files.length,
          folderCount: workspace.folders.length,
          diagnostics: result.diagnostics.length,
          pageCount: result.pageCount,
        },
      }, 'completed thesis render');

      return { result };
    } catch (error) {
      request.log.warn({
        thesisRender: {
          userId,
          activeFilePath,
          error: error instanceof Error ? error.message : 'Unknown render failure',
        },
      }, 'failed thesis render');
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to render LaTeX workspace.',
      });
    }
  });

  server.get('/thesis/document', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const document = await getThesisDocument(userId) ?? await seedDefaultThesisDocumentForUser(userId);
    return {
      document: document ? {
        draft: document.draft,
        editorTheme: document.editor_theme,
        snapshot: document.snapshot,
        updatedAt: document.updated_at,
        repoSyncStatus: document.repo_sync_status,
        repoSyncError: document.repo_sync_error,
        repoSyncedAt: document.repo_synced_at,
      } : null,
    };
  });

  server.put<{
    Body: {
      draft?: string;
      editorTheme?: string | null;
      snapshot?: unknown;
      debug?: unknown;
    };
  }>('/thesis/document', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const draft = typeof request.body.draft === 'string' ? request.body.draft : null;
    if (draft === null) return reply.status(400).send({ error: 'Draft is required.' });
    if (draft.length > 2_000_000) return reply.status(413).send({ error: 'Draft is too large to autosave.' });

    const workspaceSummary = getWorkspaceSummary(request.body.snapshot);
    request.log.info({
      thesisSave: {
        userId,
        fileCount: workspaceSummary.fileCount,
        folderCount: workspaceSummary.folderCount,
        filePaths: workspaceSummary.filePaths,
        folderPaths: workspaceSummary.folderPaths,
        debug: request.body.debug ?? null,
      },
    }, 'received thesis document save');

    const repoLink = await getThesisRepoLink(userId);
    const { error: upsertError } = await supabase
      .from('thesis_documents')
      .upsert({
        user_id: userId,
        draft,
        editor_theme: request.body.editorTheme?.trim() || null,
        snapshot: request.body.snapshot ?? {},
        repo_sync_status: repoLink?.autosave_enabled ? 'idle' : 'idle',
        repo_sync_error: null,
      });

    if (upsertError) {
      return reply.status(500).send({ error: 'Failed to autosave thesis draft.' });
    }

    let repoSyncStatus: 'idle' | 'saved' | 'error' = 'idle';
    let repoSyncError: string | null = null;
    let repoSyncedAt: string | null = null;
    if (repoLink?.autosave_enabled) {
      try {
        const result = await syncDraftToRepo(repoLink, draft, request.body.snapshot);
        repoSyncStatus = result.status;
        repoSyncError = result.error;
        repoSyncedAt = result.syncedAt;
      } catch (error) {
        repoSyncStatus = 'error';
        repoSyncError = error instanceof Error ? error.message : 'Failed to sync thesis draft to repository.';
      }

      await supabase
        .from('thesis_documents')
        .update({
          repo_sync_status: repoSyncStatus,
          repo_sync_error: repoSyncError,
          repo_synced_at: repoSyncedAt,
        })
        .eq('user_id', userId);
    }

    const document = await getThesisDocument(userId);
    return {
      ok: true,
      updatedAt: document?.updated_at ?? new Date().toISOString(),
      repoSyncStatus: document?.repo_sync_status ?? repoSyncStatus,
      repoSyncError: document?.repo_sync_error ?? repoSyncError,
      repoSyncedAt: document?.repo_synced_at ?? repoSyncedAt,
    };
  });

  server.get('/thesis/settings', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const [document, repoLink] = await Promise.all([
      getThesisDocument(userId),
      getThesisRepoLink(userId),
    ]);

    return {
      document: document ? {
        updatedAt: document.updated_at,
        repoSyncStatus: document.repo_sync_status,
        repoSyncError: document.repo_sync_error,
        repoSyncedAt: document.repo_synced_at,
      } : null,
      repoLink: mapRepoLink(repoLink),
    };
  });

  server.put<{
    Body: {
      provider?: RepoProvider;
      repository?: string;
      host?: string | null;
      filePaths?: string[] | null;
      syncAllWorkspaceFiles?: boolean;
      autosaveEnabled?: boolean;
      token?: string | null;
    };
  }>('/thesis/settings/repo', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const provider = request.body.provider;
    if (provider !== 'github' && provider !== 'gitlab') {
      return reply.status(400).send({ error: 'Provider must be github or gitlab.' });
    }

    try {
      const existing = await getThesisRepoLink(userId);
      const repository = typeof request.body.repository === 'string' ? request.body.repository : '';
      const filePaths = normalizeFilePaths(request.body.filePaths, existing?.file_path);
      const syncAllWorkspaceFiles = request.body.syncAllWorkspaceFiles === true;
      const autosaveEnabled = request.body.autosaveEnabled !== false;
      const token = request.body.token?.trim() ?? '';
      const canReuseExistingToken = existing?.provider === provider
        && Boolean(existing.token_encrypted && existing.token_iv && existing.token_auth_tag);

      let repo = '';
      let host: string | null = null;
      if (provider === 'github') {
        repo = normalizeGitHubRepo(repository);
      } else {
        const normalized = normalizeGitLabRepoInput(repository, request.body.host);
        repo = normalized.repo;
        host = normalized.host;
      }
      const repoTargetChanged = existing?.provider !== provider
        || normalizeGitLabHost(existing?.host) !== normalizeGitLabHost(host)
        || normalizeGitLabRepoPath(existing?.repo) !== normalizeGitLabRepoPath(repo);

      const encryptedToken = token
        ? storeGitLabToken({}, token) as EncryptedTokenFields
        : canReuseExistingToken ? {
            tokenEncrypted: existing?.token_encrypted ?? null,
            tokenIv: existing?.token_iv ?? null,
            tokenAuthTag: existing?.token_auth_tag ?? null,
          } : {
            tokenEncrypted: null,
            tokenIv: null,
            tokenAuthTag: null,
          };

      if (!encryptedToken.tokenEncrypted || !encryptedToken.tokenIv || !encryptedToken.tokenAuthTag) {
        return reply.status(400).send({ error: 'A personal access token is required the first time you connect a thesis repo.' });
      }

      const { error } = await supabase
        .from('user_thesis_repo_links')
        .upsert({
          user_id: userId,
          provider,
          repo,
          host,
          branch: null,
          file_path: filePaths[0] ?? 'main.tex',
          file_paths: filePaths,
          sync_all_workspace_files: syncAllWorkspaceFiles,
          last_synced_file_paths: repoTargetChanged ? [] : normalizeOptionalFilePaths(existing?.last_synced_file_paths),
          autosave_enabled: autosaveEnabled,
          token_encrypted: encryptedToken.tokenEncrypted,
          token_iv: encryptedToken.tokenIv,
          token_auth_tag: encryptedToken.tokenAuthTag,
        }, { onConflict: 'user_id' });

      if (error) {
        return reply.status(500).send({ error: 'Failed to save thesis repo settings.' });
      }

      const saved = await getThesisRepoLink(userId);
      return { repoLink: mapRepoLink(saved) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid thesis repo settings.' });
    }
  });

  server.delete('/thesis/settings/repo', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('user_thesis_repo_links')
      .delete()
      .eq('user_id', userId);
    if (error) {
      return reply.status(500).send({ error: 'Failed to remove thesis repo settings.' });
    }
    return { ok: true };
  });
}
