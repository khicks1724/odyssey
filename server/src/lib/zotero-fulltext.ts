import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { supabase } from './supabase.js';
import {
  downloadZoteroFile,
  zoteroJson,
  ZoteroApiError,
} from './zotero-client.js';

const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 1_500_000;
const MAX_PREVIEW_CHARS = 20_000;
const CHUNK_TARGET_CHARS = 3_600;
const CHUNK_OVERLAP_CHARS = 320;
const MAX_ATTACHMENTS_PER_SOURCE = 8;
const MAX_OCR_PAGES = 20;
const execFileAsync = promisify(execFile);

export type ZoteroFulltextConnection = {
  apiKey: string;
  zoteroUserId: string;
};

export type ZoteroFulltextAttachment = Record<string, unknown> & {
  key?: string;
  version?: number;
  title?: string;
  filename?: string;
  contentType?: string;
  linkMode?: string;
  md5?: string;
  mtime?: unknown;
};

export type ZoteroFulltextSource = Record<string, unknown> & {
  id: string;
  title?: string;
};

export type ThesisSourceTextMatch = {
  sourceId: string;
  sourceTitle: string;
  attachmentKey: string;
  attachmentName: string;
  chunkIndex: number;
  content: string;
  snippet: string;
  rank: number;
};

type ExtractedAttachment = {
  attachment: ZoteroFulltextAttachment;
  content: string;
  extractionMethod: 'zotero' | 'pdf' | 'ocr' | 'docx' | 'text';
  fulltextVersion: number | null;
  indexedPages: number | null;
  totalPages: number | null;
  indexedChars: number | null;
  totalChars: number | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Text extraction failed.';
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateExtractedText(value: string) {
  return normalizeExtractedText(value).slice(0, MAX_EXTRACTED_CHARS);
}

function attachmentName(attachment: ZoteroFulltextAttachment) {
  return stringValue(attachment.filename)
    || stringValue(attachment.title)
    || stringValue(attachment.key)
    || 'Zotero attachment';
}

function attachmentFingerprint(attachments: ZoteroFulltextAttachment[]) {
  return createHash('sha256')
    .update(JSON.stringify(attachments.map((attachment) => ({
      key: stringValue(attachment.key),
      version: finiteNumber(attachment.version),
      md5: stringValue(attachment.md5),
      mtime: attachment.mtime ?? null,
      filename: stringValue(attachment.filename),
      contentType: stringValue(attachment.contentType),
      linkMode: stringValue(attachment.linkMode),
    }))))
    .digest('hex');
}

function isLikelyPdf(attachment: ZoteroFulltextAttachment) {
  return /pdf/i.test(stringValue(attachment.contentType))
    || /\.pdf$/i.test(attachmentName(attachment));
}

function isLikelyDocx(attachment: ZoteroFulltextAttachment) {
  return /officedocument\.wordprocessingml/i.test(stringValue(attachment.contentType))
    || /\.docx$/i.test(attachmentName(attachment));
}

function isLikelyText(attachment: ZoteroFulltextAttachment) {
  const mimeType = stringValue(attachment.contentType).toLowerCase();
  return mimeType.startsWith('text/')
    || /(json|xml|yaml|csv|javascript|typescript|x-tex|markdown)/.test(mimeType)
    || /\.(txt|md|tex|bib|csv|json|ya?ml|xml|html?)$/i.test(attachmentName(attachment));
}

function isExtractableAttachment(attachment: ZoteroFulltextAttachment) {
  const linkMode = stringValue(attachment.linkMode);
  return linkMode !== 'linked_url' && Boolean(stringValue(attachment.key));
}

function detectSensitiveFulltext(
  source: ZoteroFulltextSource,
  attachments: ZoteroFulltextAttachment[],
  content: string,
) {
  const labels = [stringValue(source.title), ...attachments.map(attachmentName)].join(' ');
  const reasons: string[] = [];
  if (/\b(api\s*key|access\s*token|client\s*secret|password|credentials?|private\s*key)\b/i.test(labels)) {
    reasons.push('The source or attachment name suggests it may contain credentials.');
  }
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /\bAIza[A-Za-z0-9_-]{20,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\b\s*[:=]\s*[A-Za-z0-9_./+\-=]{10,}/i,
  ];
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    reasons.push('The extracted text contains a credential-like value.');
  }
  return { sensitive: reasons.length > 0, reasons };
}

async function extractScannedPdfText(buffer: Buffer, totalPages: number | null) {
  const directory = await mkdtemp(join(tmpdir(), 'odyssey-zotero-ocr-'));
  const inputPath = join(directory, 'source.pdf');
  const outputPrefix = join(directory, 'page');
  const pageLimit = Math.max(1, Math.min(totalPages ?? MAX_OCR_PAGES, MAX_OCR_PAGES));
  try {
    await writeFile(inputPath, buffer);
    await execFileAsync('pdftoppm', [
      '-jpeg',
      '-r', '180',
      '-f', '1',
      '-l', String(pageLimit),
      inputPath,
      outputPrefix,
    ], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const pageFiles = (await readdir(directory))
      .filter((name) => /^page-\d+\.jpg$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const pageTexts = await mapWithConcurrency(pageFiles, 2, async (name) => {
      try {
        const result = await execFileAsync('tesseract', [
          join(directory, name),
          'stdout',
          '-l', 'eng',
          '--psm', '1',
        ], {
          encoding: 'utf8',
          timeout: 90_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        return result.stdout;
      } catch {
        return '';
      }
    });
    return {
      content: normalizeExtractedText(pageTexts.join('\n\n')),
      indexedPages: pageFiles.length,
      totalPages: totalPages ?? pageFiles.length,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Split text on nearby paragraph/sentence boundaries while retaining a small
 * overlap so a phrase spanning two chunks remains discoverable. */
export function chunkZoteroFulltext(
  value: string,
  targetChars = CHUNK_TARGET_CHARS,
  overlapChars = CHUNK_OVERLAP_CHARS,
) {
  const text = normalizeExtractedText(value);
  if (!text) return [];
  if (text.length <= targetChars) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + targetChars);
    if (end < text.length) {
      const minimumBoundary = Math.max(start + Math.floor(targetChars * 0.72), start + 1);
      const searchWindow = text.slice(minimumBoundary, end);
      const boundaries = [...searchWindow.matchAll(/(?:\n\n|[.!?]\s+|\n)/g)];
      const boundary = boundaries.at(-1);
      if (boundary?.index !== undefined) {
        end = minimumBoundary + boundary.index + boundary[0].length;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;

    let nextStart = Math.max(start + 1, end - overlapChars);
    const nextWhitespace = text.indexOf(' ', nextStart);
    if (nextWhitespace >= 0 && nextWhitespace < end) nextStart = nextWhitespace + 1;
    start = nextStart;
  }
  return chunks;
}

async function extractDownloadedAttachment(
  connection: ZoteroFulltextConnection,
  attachment: ZoteroFulltextAttachment,
): Promise<ExtractedAttachment | null> {
  const key = stringValue(attachment.key);
  if (!key || stringValue(attachment.linkMode) === 'linked_file') return null;
  if (!isLikelyPdf(attachment) && !isLikelyDocx(attachment) && !isLikelyText(attachment)) return null;

  const response = await downloadZoteroFile(connection.apiKey, connection.zoteroUserId, key);
  const declaredSize = finiteNumber(response.headers.get('Content-Length')) ?? 0;
  if (declaredSize > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the 32 MB extraction limit.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the 32 MB extraction limit.');

  if (isLikelyPdf(attachment)) {
    const parsed = await pdfParse(buffer);
    const original = normalizeExtractedText(parsed.text ?? '');
    const pageCount = finiteNumber(parsed.numpages);
    if (original.length < 80) {
      const ocr = await extractScannedPdfText(buffer, pageCount);
      const content = ocr.content.slice(0, MAX_EXTRACTED_CHARS);
      if (!content) return null;
      return {
        attachment,
        content,
        extractionMethod: 'ocr',
        fulltextVersion: null,
        indexedPages: ocr.indexedPages,
        totalPages: ocr.totalPages,
        indexedChars: content.length,
        totalChars: ocr.content.length,
      };
    }
    const content = original.slice(0, MAX_EXTRACTED_CHARS);
    return {
      attachment,
      content,
      extractionMethod: 'pdf',
      fulltextVersion: null,
      indexedPages: pageCount,
      totalPages: pageCount,
      indexedChars: content.length,
      totalChars: original.length,
    };
  }

  if (isLikelyDocx(attachment)) {
    const parsed = await mammoth.extractRawText({ buffer });
    const original = normalizeExtractedText(parsed.value ?? '');
    const content = original.slice(0, MAX_EXTRACTED_CHARS);
    if (!content) return null;
    return {
      attachment,
      content,
      extractionMethod: 'docx',
      fulltextVersion: null,
      indexedPages: null,
      totalPages: null,
      indexedChars: content.length,
      totalChars: original.length,
    };
  }

  let original = normalizeExtractedText(new TextDecoder('utf-8', { fatal: false }).decode(buffer));
  if (/html/i.test(stringValue(attachment.contentType)) || /\.html?$/i.test(attachmentName(attachment))) {
    original = normalizeExtractedText(original
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>'));
  }
  const content = original.slice(0, MAX_EXTRACTED_CHARS);
  if (!content) return null;
  return {
    attachment,
    content,
    extractionMethod: 'text',
    fulltextVersion: null,
    indexedPages: null,
    totalPages: null,
    indexedChars: content.length,
    totalChars: original.length,
  };
}

async function extractAttachment(
  connection: ZoteroFulltextConnection,
  attachment: ZoteroFulltextAttachment,
): Promise<ExtractedAttachment | null> {
  const key = stringValue(attachment.key);
  if (!key) return null;

  try {
    const result = await zoteroJson<Record<string, unknown>>(
      connection.apiKey,
      `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(key)}/fulltext`,
    );
    const content = truncateExtractedText(stringValue(result.data.content));
    if (content) {
      return {
        attachment,
        content,
        extractionMethod: 'zotero',
        fulltextVersion: result.libraryVersion,
        indexedPages: finiteNumber(result.data.indexedPages),
        totalPages: finiteNumber(result.data.totalPages),
        indexedChars: finiteNumber(result.data.indexedChars) ?? content.length,
        totalChars: finiteNumber(result.data.totalChars) ?? content.length,
      };
    }
  } catch (error) {
    if (!(error instanceof ZoteroApiError) || error.status !== 404) throw error;
  }

  return extractDownloadedAttachment(connection, attachment);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const output: R[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    output.push(...await Promise.all(values.slice(index, index + concurrency).map(mapper)));
  }
  return output;
}

async function saveIndexedSource(userId: string, source: ZoteroFulltextSource) {
  const clean = { ...source };
  delete clean.revision;
  const { error } = await supabase.from('thesis_sources').update({ data: clean })
    .eq('user_id', userId)
    .eq('id', source.id);
  if (error) throw error;
}

export async function indexZoteroSourceFulltext(input: {
  userId: string;
  connection: ZoteroFulltextConnection;
  source: ZoteroFulltextSource;
  attachments: ZoteroFulltextAttachment[];
  force?: boolean;
}) {
  const { userId, connection, force = false } = input;
  const { data: latestRow } = await supabase.from('thesis_sources')
    .select('data')
    .eq('user_id', userId)
    .eq('id', input.source.id)
    .maybeSingle();
  const source = {
    ...input.source,
    ...asObject(latestRow?.data),
    id: input.source.id,
  } as ZoteroFulltextSource;
  const attachments = [...new Map(
    input.attachments
      .filter(isExtractableAttachment)
      .map((attachment) => [stringValue(attachment.key), attachment]),
  ).values()]
    .sort((left, right) => Number(isLikelyPdf(right)) - Number(isLikelyPdf(left)))
    .slice(0, MAX_ATTACHMENTS_PER_SOURCE);
  const fingerprint = attachmentFingerprint(attachments);

  if (!force
    && stringValue(source.zoteroFulltextFingerprint) === fingerprint
    && ['indexed', 'unavailable'].includes(stringValue(source.zoteroFulltextStatus))) {
    return source;
  }

  const extractionResults = await mapWithConcurrency(attachments, 3, async (attachment) => {
    try {
      return { extracted: await extractAttachment(connection, attachment), error: null as string | null };
    } catch (error) {
      return { extracted: null, error: `${attachmentName(attachment)}: ${shortError(error)}` };
    }
  });
  const extracted = extractionResults
    .map((result) => result.extracted)
    .filter((result): result is ExtractedAttachment => Boolean(result?.content));
  const errors = extractionResults.map((result) => result.error).filter((error): error is string => Boolean(error));
  const chunks = extracted.flatMap((result) => chunkZoteroFulltext(result.content).map((content, chunkIndex) => ({
    user_id: userId,
    source_id: source.id,
    attachment_key: stringValue(result.attachment.key),
    attachment_name: attachmentName(result.attachment),
    chunk_index: chunkIndex,
    content,
    content_hash: createHash('sha256').update(content).digest('hex'),
    extraction_method: result.extractionMethod,
    fulltext_version: result.fulltextVersion,
    metadata: {
      indexedPages: result.indexedPages,
      totalPages: result.totalPages,
      indexedChars: result.indexedChars,
      totalChars: result.totalChars,
    },
  })));

  if (chunks.length > 0 || errors.length === 0) {
    const { error: deleteError } = await supabase.from('thesis_source_text_chunks')
      .delete()
      .eq('user_id', userId)
      .eq('source_id', source.id);
    if (deleteError) throw deleteError;
  }
  for (let index = 0; index < chunks.length; index += 100) {
    const { error } = await supabase.from('thesis_source_text_chunks').insert(chunks.slice(index, index + 100));
    if (error) throw error;
  }

  // A transient Zotero failure should not discard a previously usable index.
  if (chunks.length === 0 && errors.length > 0 && source.zoteroFulltextStatus === 'indexed') {
    const retainedSource = {
      ...source,
      zoteroFulltextError: errors.join(' ').slice(0, 1_000),
      zoteroFulltextIndexedAt: new Date().toISOString(),
    };
    await saveIndexedSource(userId, retainedSource);
    return retainedSource;
  }

  const indexedPages = extracted.reduce((sum, item) => sum + (item.indexedPages ?? 0), 0);
  const totalPages = extracted.reduce((sum, item) => sum + (item.totalPages ?? 0), 0);
  const indexedChars = extracted.reduce((sum, item) => sum + (item.indexedChars ?? item.content.length), 0);
  const totalChars = extracted.reduce((sum, item) => sum + (item.totalChars ?? item.content.length), 0);
  const preview = extracted.map((item) => item.content).join('\n\n').slice(0, MAX_PREVIEW_CHARS);
  const hasText = chunks.length > 0;
  const sensitivity = detectSensitiveFulltext(
    source,
    attachments,
    extracted.map((item) => item.content).join('\n'),
  );
  const restrictedApproved = source.verification !== 'restricted'
    || source.zoteroFulltextRestrictedApproved === true;
  const sensitiveApproved = !sensitivity.sensitive
    || source.zoteroFulltextSensitiveApproved === true;
  const autoInclude = typeof source.zoteroFulltextAutoInclude === 'boolean'
    ? source.zoteroFulltextAutoInclude
    : source.zoteroFulltextEnabled !== false;
  const nextSource: ZoteroFulltextSource = {
    ...source,
    zoteroFulltextEnabled: hasText ? autoInclude && restrictedApproved && sensitiveApproved : false,
    zoteroFulltextAutoInclude: autoInclude,
    zoteroFulltextSensitive: sensitivity.sensitive,
    zoteroFulltextSensitiveReasons: sensitivity.reasons,
    zoteroFulltextSensitiveApproved: sensitivity.sensitive
      ? source.zoteroFulltextSensitiveApproved === true
      : false,
    zoteroFulltextPreview: preview,
    zoteroFulltextStatus: hasText ? 'indexed' : errors.length > 0 ? 'error' : 'unavailable',
    zoteroFulltextStats: {
      attachmentCount: attachments.length,
      indexedAttachments: extracted.length,
      indexedPages,
      totalPages,
      indexedChars,
      totalChars,
      chunkCount: chunks.length,
      extractionMethods: [...new Set(extracted.map((item) => item.extractionMethod))],
    },
    zoteroFulltextFingerprint: fingerprint,
    zoteroFulltextIndexedAt: new Date().toISOString(),
    zoteroFulltextError: errors.join(' ').slice(0, 1_000),
  };
  await saveIndexedSource(userId, nextSource);
  return nextSource;
}

const SEARCH_STOP_WORDS = new Set([
  'about', 'added', 'after', 'also', 'and', 'are', 'can', 'context', 'could', 'document',
  'documents', 'does', 'from', 'have', 'into', 'library', 'paper', 'papers', 'please',
  'me', 'source', 'sources', 'tell', 'that', 'the', 'their', 'these', 'this', 'using', 'what',
  'when', 'where', 'which', 'with', 'would', 'zotero',
]);

export function buildThesisSourceSearchQuery(value: string) {
  const terms = (value.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])
    .filter((term) => !SEARCH_STOP_WORDS.has(term))
    .filter((term, index, values) => values.indexOf(term) === index)
    .slice(0, 12);
  if (terms.length === 0) return value.trim().slice(0, 240);
  return terms.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR ');
}

export async function searchThesisSourceText(
  userId: string,
  query: string,
  limit = 12,
  includeAiExcluded = true,
) {
  const normalizedQuery = buildThesisSourceSearchQuery(query);
  if (!normalizedQuery) return [];
  const { data, error } = await supabase.rpc('search_thesis_source_text_chunks', {
    p_user_id: userId,
    p_query: normalizedQuery,
    p_limit: Math.max(1, Math.min(limit, 50)),
    p_include_ai_excluded: includeAiExcluded,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) => {
    const value = asObject(row);
    return {
      sourceId: stringValue(value.source_id),
      sourceTitle: stringValue(value.source_title),
      attachmentKey: stringValue(value.attachment_key),
      attachmentName: stringValue(value.attachment_name),
      chunkIndex: finiteNumber(value.chunk_index) ?? 0,
      content: stringValue(value.content),
      snippet: stringValue(value.snippet),
      rank: finiteNumber(value.rank) ?? 0,
    } satisfies ThesisSourceTextMatch;
  }).filter((match) => match.sourceId && match.content);
}

async function loadOpeningSourceChunks(userId: string, limit: number) {
  const { data: sourceRows, error: sourceError } = await supabase.from('thesis_sources')
    .select('id,data')
    .eq('user_id', userId);
  if (sourceError) throw sourceError;
  const sources = new Map<string, string>();
  for (const row of sourceRows ?? []) {
    const data = asObject(row.data);
    if (data.zoteroFulltextEnabled === false) continue;
    if (data.verification === 'restricted' && data.zoteroFulltextRestrictedApproved !== true) continue;
    if (data.zoteroFulltextSensitive === true && data.zoteroFulltextSensitiveApproved !== true) continue;
    if (stringValue(data.zoteroFulltextStatus) !== 'indexed') continue;
    sources.set(String(row.id), stringValue(data.title) || 'Untitled source');
  }
  if (sources.size === 0) return [];

  const { data: chunkRows, error: chunkError } = await supabase.from('thesis_source_text_chunks')
    .select('source_id,attachment_key,attachment_name,chunk_index,content,updated_at')
    .eq('user_id', userId)
    .eq('chunk_index', 0)
    .in('source_id', [...sources.keys()])
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)));
  if (chunkError) throw chunkError;
  return (chunkRows ?? []).map((row) => ({
    sourceId: String(row.source_id),
    sourceTitle: sources.get(String(row.source_id)) ?? 'Untitled source',
    attachmentKey: String(row.attachment_key),
    attachmentName: String(row.attachment_name ?? ''),
    chunkIndex: Number(row.chunk_index ?? 0),
    content: String(row.content ?? ''),
    snippet: String(row.content ?? '').slice(0, 800),
    rank: 0,
  } satisfies ThesisSourceTextMatch));
}

export async function buildThesisSourceContext(userId: string, userQuery: string) {
  let matches = await searchThesisSourceText(userId, userQuery, 10, false);
  if (matches.length === 0 && /\b(zotero|sources?|documents?|papers?|library|uploaded|added)\b/i.test(userQuery)) {
    matches = await loadOpeningSourceChunks(userId, 8);
  }
  if (matches.length === 0) return '';

  const seen = new Set<string>();
  let remaining = 14_000;
  const sections: string[] = [];
  for (const match of matches) {
    const key = `${match.sourceId}:${match.attachmentKey}:${match.chunkIndex}`;
    if (seen.has(key) || remaining <= 0) continue;
    seen.add(key);
    const excerpt = match.content.slice(0, Math.min(2_400, remaining));
    remaining -= excerpt.length;
    sections.push([
      `SOURCE: ${match.sourceTitle}`,
      `ATTACHMENT: ${match.attachmentName || match.attachmentKey}`,
      `ODYSSEY LINK: /thesis?tab=sources&source=${encodeURIComponent(match.sourceId)}`,
      `EXTRACTED PASSAGE:\n${excerpt}`,
    ].join('\n'));
  }
  return sections.length > 0
    ? `\n\nRELEVANT EXTRACTED ZOTERO TEXT:\n${sections.join('\n\n---\n\n')}`
    : '';
}

export const zoteroFulltextTestables = {
  normalizeExtractedText,
  attachmentFingerprint,
  detectSensitiveFulltext,
};
