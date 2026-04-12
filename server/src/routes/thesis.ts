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
  | 'book_chapter'
  | 'government_report'
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

const execFileAsync = promisify(execFile);
const MAX_RENDER_SOURCE_BYTES = 2_000_000;
const LATEX_RENDER_TIMEOUT_MS = 30_000;
const MAX_SOURCE_PDF_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_TEXT_PREVIEW_CHARS = 2_000;
const MAX_SOURCE_ABSTRACT_CHARS = 1_200;
const MAX_DOCUMENT_TEXT_PREVIEW_CHARS = 3_000;
const SOURCE_URL_FETCH_TIMEOUT_MS = 15_000;
const THESIS_SOURCE_BUCKET = 'project-documents';

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
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

async function extractDocumentTextPreview(fileBuffer: Buffer, mimeType: string, filename: string) {
  const normalizedMime = mimeType.toLowerCase();
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
    || /(json|xml|yaml|csv|javascript|typescript|x-tex|tex|markdown)/.test(normalizedMime)
    || /\.(txt|md|tex|bib|csv|json|ya?ml|xml|html?)$/i.test(normalizedFilename);

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
  return value === 'book_chapter'
    || value === 'government_report'
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
  const credit = normalizeStringField(record.credit, 240);
  const venue = normalizeStringField(record.venue, 240);
  const year = normalizeStringField(record.year, 16);
  const locator = normalizeStringField(record.locator, 1_000);
  if (!title || !credit || !venue || !year || !locator) return null;

  return {
    id: normalizeStringField(record.id, 120) || `lib-${Date.now().toString(36)}`,
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

  if (input.contentType.includes('pdf')) return 'journal_article';
  if (hints.some((hint) => /\b(dataset|datacatalog)\b/.test(hint))) return 'dataset';
  if (hints.some((hint) => /\b(book|chapter)\b/.test(hint))) return 'book_chapter';
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
  if (kind === 'dataset') return 'Dataset';
  if (kind === 'book_chapter') return 'Book Chapter';
  if (kind === 'government_report') return 'Government or Lab Report';
  if (kind === 'interview_notes') return 'Interview or Notes';
  if (kind === 'archive_record') return 'Archive Record';
  if (kind === 'documentation') return 'Documentation';
  if (kind === 'web_article') return 'Web Article';
  if (kind === 'journal_article') return 'Journal Article';
  return null;
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
      throw new Error('That PDF URL exceeds the 12 MB ingest limit.');
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
  const credit = chooseBestCandidate([
    ...(metaMap.get('citation_author') ?? []),
    ...(metaMap.get('dc.creator') ?? []),
    ...(metaMap.get('dc.contributor') ?? []),
    ...jsonLdAuthors,
    ...(metaMap.get('author') ?? []),
    ...(metaMap.get('article:author') ?? []),
  ], 2, 240);
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
  const summary = extractSummary(abstract ?? [title, contextField].filter(Boolean).join('. '));
  const sourceKind = inferUrlSourceKind({
    url: finalUrl,
    contentType,
    sourceTypeHints: [
      ...jsonLdTypes,
      ...(metaMap.get('og:type') ?? []),
      ...(metaMap.get('citation_type') ?? []),
    ],
    title,
    venue: contextField,
    hasCitationJournal,
  });

  return {
    filename: filename || finalUrl.hostname,
    pageCount: 1,
    title,
    credit,
    contextField,
    year,
    abstract,
    summary,
    keywords,
    locator: finalUrl.toString(),
    citation: buildSourceCitation(title, credit, year, contextField, finalUrl.toString()),
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

  let credit = metadataAuthor;
  if (!credit) {
    const titleIndex = titleBlock?.startIndex ?? Math.max(0, orderedLines.findIndex((line) => line === title));
    credit = [
      ...orderedLines.slice(Math.max(0, titleIndex - 3), titleIndex + 1),
      ...orderedLines.slice(titleIndex + 1, titleIndex + 5),
    ].find((line) => isLikelyAuthorLine(line)) ?? null;
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
      return reply.status(413).send({ error: 'Uploaded PDF exceeds the 12 MB limit.' });
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
    const mimeType = upload.mimetype || 'application/octet-stream';

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
      return reply.status(413).send({ error: 'Uploaded document exceeds the 12 MB limit.' });
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
      return reply.status(413).send({ error: 'Uploaded PDF exceeds the 12 MB limit.' });
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
