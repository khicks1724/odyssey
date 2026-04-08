import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { supabase } from '../lib/supabase.js';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
// Import from lib directly to avoid pdf-parse's test-file side-effect on module load
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import JSZip from 'jszip';

const BUCKET = 'project-documents';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.log', '.yaml', '.yml']);
const MAX_EXTRACTED_CHARS = 50_000; // ~12k tokens
const MAX_PREVIEW_CHARS = 2_000;
const MAX_SUMMARY_CHARS = 320;
const CHUNK_TARGET_CHARS = 3_500;
const REPORT_TEMPLATE_CHUNK_BYTES = 256 * 1024;
const REPORT_TEMPLATE_UPLOAD_DIR = path.join(tmpdir(), 'odyssey-report-template-uploads');

type ReportTemplateType = 'docx' | 'pptx' | 'pdf';

type DocumentProcessingResult = {
  extractedText: string | null;
  contentPreview: string | null;
  summary: string | null;
  keywords: string[];
  chunks: Array<{ index: number; content: string; contentPreview: string; charCount: number }>;
};

type TemplateRenderHints = {
  backgroundColor?: string;
  surfaceColor?: string;
  borderColor?: string;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  accentColor?: string;
  headingColor?: string;
  primaryFont?: string;
  secondaryFont?: string;
  monospaceFont?: string;
  aspectRatio?: 'wide' | 'standard';
  orientation?: 'portrait' | 'landscape';
  density?: 'airy' | 'balanced' | 'dense';
  titleAlignment?: 'left' | 'center';
  headerBand?: boolean;
  sidebarAccent?: boolean;
};

type TemplateAnalysis = {
  version: 1;
  sourceFormat: 'docx' | 'pptx' | 'pdf';
  summary: string;
  sectionHeadings: string[];
  layoutHints: string[];
  styleHints: string[];
  palette: string[];
  fonts: string[];
  pageCount?: number;
  slideCount?: number;
  hasCoverPage?: boolean;
  hasTables?: boolean;
  hasBullets?: boolean;
  sampleExcerpt?: string;
  renderHints: TemplateRenderHints;
};

type ReportTemplateUploadSession = {
  uploadId: string;
  projectId: string;
  templateType: ReportTemplateType;
  filename: string;
  mimeType: string;
  totalChunks: number;
  userId: string;
  createdAt: string;
};

const MAX_TEMPLATE_EXCERPT_CHARS = 1_400;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(parseInt(num, 10)));
}

function extractXmlText(xml: string): string {
  return compactWhitespace(decodeXmlEntities(xml.replace(/<[^>]+>/g, ' ')));
}

function extractPptxParagraphs(xml: string, limit = 160): string[] {
  const paragraphMatches = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  const paragraphs = paragraphMatches.map((paragraphXml) => {
    const runs = [...paragraphXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlEntities(match[1]));
    return compactWhitespace(runs.join(' '));
  }).filter(Boolean);
  return uniqueStrings(paragraphs, limit);
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

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (cleaned.length === 3) {
    return cleaned.split('').map((char) => `${char}${char}`).join('');
  }
  return cleaned.length === 6 ? cleaned : null;
}

function colorLuminance(hex: string): number {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return 0;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function extractPaletteFromThemeXml(themeXml: string): string[] {
  return uniqueStrings(
    [...themeXml.matchAll(/(?:lastClr|val)="([0-9A-Fa-f]{6})"/g)].map((match) => normalizeHexColor(match[1])),
    10,
  ).filter((value): value is string => Boolean(value));
}

function extractFontsFromThemeXml(themeXml: string): string[] {
  return uniqueStrings(
    [...themeXml.matchAll(/typeface="([^"]+)"/g)].map((match) => match[1]),
    8,
  );
}

function inferDensity(textLength: number, sectionCount: number): 'airy' | 'balanced' | 'dense' {
  if (textLength < 2_500 && sectionCount <= 6) return 'airy';
  if (textLength > 9_000 || sectionCount >= 10) return 'dense';
  return 'balanced';
}

function inferHeadingCase(headings: string[]): 'upper' | 'title' | 'sentence' {
  const sample = headings.slice(0, 6).filter(Boolean);
  if (!sample.length) return 'sentence';
  const uppercaseCount = sample.filter((heading) => heading === heading.toUpperCase()).length;
  const titleCount = sample.filter((heading) => /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(heading)).length;
  if (uppercaseCount >= Math.ceil(sample.length / 2)) return 'upper';
  if (titleCount >= Math.ceil(sample.length / 2)) return 'title';
  return 'sentence';
}

function extractLikelyHeadings(text: string, limit = 10): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length >= 4 && line.length <= 80);

  const matches = lines.filter((line) => {
    if (/[:.;]$/.test(line)) return false;
    if (/^[-*•▪▸]/.test(line)) return false;
    const words = line.split(/\s+/);
    if (words.length > 8) return false;
    return line === line.toUpperCase() || /^[A-Z][\w/&,-]+(?:\s+[A-Z][\w/&,-]+){0,6}$/.test(line);
  });

  return uniqueStrings(matches, limit);
}

function buildRenderHints(
  palette: string[],
  fonts: string[],
  sourceFormat: 'docx' | 'pptx' | 'pdf',
  density: 'airy' | 'balanced' | 'dense',
  titleAlignment: 'left' | 'center',
): TemplateRenderHints {
  const normalizedPalette = palette
    .map((value) => normalizeHexColor(value))
    .filter((value): value is string => Boolean(value));
  const byLightness = [...normalizedPalette].sort((left, right) => colorLuminance(left) - colorLuminance(right));
  const darkColors = byLightness.filter((value) => colorLuminance(value) <= 0.45);
  const lightColors = [...byLightness].reverse().filter((value) => colorLuminance(value) >= 0.7);
  const mediumColors = normalizedPalette.filter((value) => colorLuminance(value) > 0.35 && colorLuminance(value) < 0.8);

  return {
    backgroundColor: lightColors[0] ?? (sourceFormat === 'pdf' ? 'F7F7F7' : 'FFFFFF'),
    surfaceColor: lightColors[1] ?? (sourceFormat === 'pptx' ? 'F4F4F4' : 'F8F8F8'),
    borderColor: mediumColors[0] ?? 'C8C8C8',
    primaryTextColor: darkColors[0] ?? '1F2937',
    secondaryTextColor: darkColors[1] ?? '4B5563',
    accentColor: mediumColors[1] ?? darkColors[0] ?? '2563EB',
    headingColor: darkColors[0] ?? mediumColors[0] ?? '111827',
    primaryFont: fonts[0],
    secondaryFont: fonts[1] ?? fonts[0],
    monospaceFont: fonts.find((font) => /mono|code|courier/i.test(font)),
    aspectRatio: sourceFormat === 'pptx' ? 'wide' : 'standard',
    orientation: sourceFormat === 'pptx' ? 'landscape' : 'portrait',
    density,
    titleAlignment,
    headerBand: sourceFormat === 'pptx',
    sidebarAccent: sourceFormat === 'pptx',
  };
}

async function analyzeDocxTemplate(buffer: Buffer, extractedText: string | null): Promise<TemplateAnalysis | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return null;

    const stylesXml = await zip.file('word/styles.xml')?.async('string');
    const themeXml = await zip.file('word/theme/theme1.xml')?.async('string');
    const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => {
      const block = match[0];
      const textRuns = [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((run) => decodeXmlEntities(run[1]));
      const text = compactWhitespace(textRuns.join(' '));
      const style = block.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] ?? null;
      return {
        text,
        style,
        isBullet: /<w:numPr\b/.test(block),
      };
    }).filter((paragraph) => paragraph.text.length > 0);

    const themePalette = themeXml ? extractPaletteFromThemeXml(themeXml) : [];
    const themeFonts = themeXml ? extractFontsFromThemeXml(themeXml) : [];
    const styleFonts = stylesXml
      ? uniqueStrings([...stylesXml.matchAll(/w:(?:ascii|hAnsi|cs)="([^"]+)"/g)].map((match) => match[1]), 6)
      : [];
    const headings = uniqueStrings([
      ...paragraphs
        .filter((paragraph) => /heading/i.test(paragraph.style ?? ''))
        .map((paragraph) => paragraph.text),
      ...extractLikelyHeadings(extractedText ?? paragraphs.map((paragraph) => paragraph.text).join('\n')),
    ]);

    const pageBreakCount = (documentXml.match(/<w:br[^>]*w:type="page"/g) ?? []).length;
    const tableCount = (documentXml.match(/<w:tbl\b/g) ?? []).length;
    const hasBullets = paragraphs.some((paragraph) => paragraph.isBullet);
    const pageEstimate = Math.max(1, pageBreakCount + 1, Math.round((extractedText?.length ?? 0) / 3_000) || 1);
    const density = inferDensity(extractedText?.length ?? paragraphs.length * 80, headings.length || 1);
    const headingCase = inferHeadingCase(headings);
    const hasCoverPage = pageEstimate > 1 && paragraphs.slice(0, 6).some((paragraph) => paragraph.text.length > 24);
    const fonts = uniqueStrings([...themeFonts, ...styleFonts]);
    const sampleExcerpt = compactWhitespace((extractedText ?? paragraphs.map((paragraph) => paragraph.text).join(' ')).slice(0, MAX_TEMPLATE_EXCERPT_CHARS));

    return {
      version: 1,
      sourceFormat: 'docx',
      summary: `DOCX template with approximately ${pageEstimate} page${pageEstimate === 1 ? '' : 's'}, ${headings.length || 1} recognizable section heading${headings.length === 1 ? '' : 's'}, and ${tableCount} table${tableCount === 1 ? '' : 's'}.`,
      sectionHeadings: headings,
      layoutHints: uniqueStrings([
        hasCoverPage ? 'Starts with a dedicated cover or title page.' : 'Begins directly with report content.',
        tableCount ? `Uses ${tableCount} structured table${tableCount === 1 ? '' : 's'} in the body.` : 'Relies more on prose than tables.',
        hasBullets ? 'Uses bullet lists for supporting detail.' : 'Uses paragraph-driven sections with limited bullets.',
      ]),
      styleHints: uniqueStrings([
        headingCase === 'upper' ? 'Headings are typically uppercase.' : headingCase === 'title' ? 'Headings are title case.' : 'Headings are sentence case.',
        fonts[0] ? `Primary typeface appears to be ${fonts[0]}.` : 'No dominant typeface could be inferred from the theme.',
        themePalette[0] ? `Visual identity includes a restrained palette anchored by ${themePalette.slice(0, 3).join(', ')}.` : 'No explicit theme palette was embedded in the DOCX theme.',
      ]),
      palette: themePalette,
      fonts,
      pageCount: pageEstimate,
      hasCoverPage,
      hasTables: tableCount > 0,
      hasBullets,
      sampleExcerpt: sampleExcerpt || undefined,
      renderHints: buildRenderHints(themePalette, fonts, 'docx', density, 'left'),
    };
  } catch {
    return null;
  }
}

async function analyzePptxTemplate(buffer: Buffer, extractedText: string | null): Promise<TemplateAnalysis | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (!presentationXml) return null;

    const themeXml = await zip.file('ppt/theme/theme1.xml')?.async('string');
    const slideFiles = Object.keys(zip.files)
      .filter((filePath) => /^ppt\/slides\/slide\d+\.xml$/.test(filePath))
      .sort((left, right) => {
        const leftIndex = parseInt(left.match(/slide(\d+)/)?.[1] ?? '0', 10);
        const rightIndex = parseInt(right.match(/slide(\d+)/)?.[1] ?? '0', 10);
        return leftIndex - rightIndex;
      });

    const slideDetails = await Promise.all(slideFiles.map(async (slideFile) => {
      const xml = await zip.file(slideFile)?.async('string');
      if (!xml) return null;
      const lines = extractPptxParagraphs(xml, 80);
      const title = lines.find((line) => line.length >= 4 && line.length <= 70) ?? null;
      return {
        title,
        text: lines.join(' '),
        hasBullets: /<a:buChar|<a:pPr[^>]*lvl=/.test(xml),
        hasTables: /table|tbl/i.test(xml),
      };
    }));

    const headings = uniqueStrings(slideDetails.map((slide) => slide?.title ?? null));
    const slideCount = slideDetails.filter(Boolean).length;
    const hasBullets = slideDetails.some((slide) => slide?.hasBullets);
    const hasTables = slideDetails.some((slide) => slide?.hasTables);
    const slideSize = presentationXml.match(/cx="(\d+)"[^>]*cy="(\d+)"/);
    const width = slideSize ? parseInt(slideSize[1], 10) : 13;
    const height = slideSize ? parseInt(slideSize[2], 10) : 7;
    const aspectRatio = width > height * 1.45 ? 'wide' : 'standard';
    const density = inferDensity(extractedText?.length ?? slideCount * 300, headings.length || 1);
    const themePalette = themeXml ? extractPaletteFromThemeXml(themeXml) : [];
    const fonts = themeXml ? extractFontsFromThemeXml(themeXml) : [];
    const sampleExcerpt = compactWhitespace((extractedText ?? slideDetails.map((slide) => slide?.text ?? '').join(' ')).slice(0, MAX_TEMPLATE_EXCERPT_CHARS));

    return {
      version: 1,
      sourceFormat: 'pptx',
      summary: `PPTX template with ${slideCount} slide${slideCount === 1 ? '' : 's'} in a ${aspectRatio} layout and ${headings.length || 1} identifiable slide heading${headings.length === 1 ? '' : 's'}.`,
      sectionHeadings: headings,
      layoutHints: uniqueStrings([
        slideCount > 1 ? 'Uses a dedicated opening slide before detail slides.' : 'Acts as a single-slide briefing layout.',
        hasBullets ? 'Slide bodies rely on bullet hierarchies.' : 'Slide bodies favor text blocks over bullet lists.',
        hasTables ? 'Includes at least one slide with a structured table or matrix.' : 'Does not appear to rely on table-heavy slides.',
      ]),
      styleHints: uniqueStrings([
        aspectRatio === 'wide' ? 'Designed for a widescreen presentation canvas.' : 'Designed for a standard presentation canvas.',
        fonts[0] ? `Primary presentation font appears to be ${fonts[0]}.` : 'No dominant presentation font could be inferred from the slide theme.',
        themePalette[0] ? `Presentation palette includes ${themePalette.slice(0, 4).join(', ')}.` : 'No embedded palette was detected in the slide theme.',
      ]),
      palette: themePalette,
      fonts,
      slideCount,
      hasCoverPage: slideCount > 1,
      hasTables,
      hasBullets,
      sampleExcerpt: sampleExcerpt || undefined,
      renderHints: {
        ...buildRenderHints(themePalette, fonts, 'pptx', density, 'center'),
        aspectRatio,
        orientation: 'landscape',
        titleAlignment: 'center',
        headerBand: true,
        sidebarAccent: true,
      },
    };
  } catch {
    return null;
  }
}

async function analyzePdfTemplate(buffer: Buffer, extractedText: string | null): Promise<TemplateAnalysis | null> {
  try {
    const pdfData = await pdfParse(buffer);
    const text = extractedText ?? pdfData.text?.trim() ?? '';
    const headings = extractLikelyHeadings(text);
    const density = inferDensity(text.length, headings.length || 1);
    const hasBullets = /(^|\n)\s*[•*-]\s+/m.test(text);
    const hasTables = /\|.+\||\btable\b/i.test(text);
    const pageCount = pdfData.numpages || Math.max(1, Math.round(text.length / 3_200));
    const sampleExcerpt = compactWhitespace(text.slice(0, MAX_TEMPLATE_EXCERPT_CHARS));

    return {
      version: 1,
      sourceFormat: 'pdf',
      summary: `PDF template with ${pageCount} page${pageCount === 1 ? '' : 's'} and ${headings.length || 1} likely section heading${headings.length === 1 ? '' : 's'} inferred from text layout.`,
      sectionHeadings: headings,
      layoutHints: uniqueStrings([
        'Preserve the page-driven structure and section cadence from the PDF.',
        hasBullets ? 'Bulleted support points appear throughout the document.' : 'Bulleted lists are limited; sections are primarily prose-based.',
        hasTables ? 'The layout includes at least one tabular or matrix-style section.' : 'The layout does not appear table-centric.',
      ]),
      styleHints: uniqueStrings([
        inferHeadingCase(headings) === 'upper' ? 'Section headings are predominantly uppercase.' : 'Section headings lean toward title or sentence case.',
        'Use restrained spacing and keep page composition close to the uploaded PDF.',
      ]),
      palette: [],
      fonts: [],
      pageCount,
      hasCoverPage: pageCount > 1,
      hasTables,
      hasBullets,
      sampleExcerpt: sampleExcerpt || undefined,
      renderHints: {
        ...buildRenderHints([], [], 'pdf', density, 'left'),
        orientation: 'portrait',
        titleAlignment: 'left',
        headerBand: false,
        sidebarAccent: false,
      },
    };
  } catch {
    return null;
  }
}

async function analyzeReportTemplate(
  buffer: Buffer,
  extractedText: string | null,
  templateType: 'docx' | 'pptx' | 'pdf',
): Promise<TemplateAnalysis | null> {
  if (templateType === 'docx') return analyzeDocxTemplate(buffer, extractedText);
  if (templateType === 'pptx') return analyzePptxTemplate(buffer, extractedText);
  return analyzePdfTemplate(buffer, extractedText);
}

function isTextFile(name: string, mimeType: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return mimeType.startsWith('text/') || TEXT_EXTS.has(ext);
}

function getExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

function isAllowedFileType(name: string, mimeType: string): boolean {
  return ALLOWED_MIME.has(mimeType) || TEXT_EXTS.has(getExtension(name));
}

async function extractText(buffer: Buffer, filename: string, mimeType: string): Promise<string | null> {
  const lower = filename.toLowerCase();

  // PDF
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    try {
      const data = await pdfParse(buffer);
      return data.text?.trim().slice(0, MAX_EXTRACTED_CHARS) || null;
    } catch {
      return null;
    }
  }

  // DOCX
  if (mimeType.includes('wordprocessingml') || lower.endsWith('.docx')) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value?.trim().slice(0, MAX_EXTRACTED_CHARS) || null;
    } catch {
      return null;
    }
  }

  // PPTX — extract all slide text via JSZip + XML tag stripping
  if (mimeType.includes('presentationml') || lower.endsWith('.pptx')) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const slideFiles = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)?.[0] ?? '0');
          const numB = parseInt(b.match(/\d+/)?.[0] ?? '0');
          return numA - numB;
        });
      const parts: string[] = [];
      for (const slideFile of slideFiles) {
        const xml = await zip.files[slideFile].async('string');
        const paragraphs = extractPptxParagraphs(xml, 80);
        if (paragraphs.length) parts.push(paragraphs.join('\n'));
      }
      return parts.join('\n').slice(0, MAX_EXTRACTED_CHARS) || null;
    } catch {
      return null;
    }
  }

  // Plain text formats
  if (isTextFile(filename, mimeType)) {
    return buffer.toString('utf8').slice(0, MAX_EXTRACTED_CHARS);
  }

  return null;
}

function summarizeText(text: string, filename: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(' ').slice(0, MAX_SUMMARY_CHARS);
  return summary || `${filename} uploaded to project knowledge base`;
}

function extractKeywords(text: string, filename: string): string[] {
  const tokens = `${filename} ${text}`
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];

  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'will', 'your', 'into', 'about',
    'project', 'meeting', 'notes', 'file', 'document', 'uploaded', 'there', 'their', 'would', 'could',
    'should', 'been', 'were', 'which', 'what', 'when', 'where', 'while', 'them', 'then', 'than', 'http',
  ]);

  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (stopWords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);
}

function chunkExtractedText(text: string): Array<{ index: number; content: string; contentPreview: string; charCount: number }> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: Array<{ index: number; content: string; contentPreview: string; charCount: number }> = [];
  let current = '';

  const pushChunk = () => {
    const content = current.trim();
    if (!content) return;
    chunks.push({
      index: chunks.length,
      content,
      contentPreview: content.slice(0, MAX_PREVIEW_CHARS),
      charCount: content.length,
    });
    current = '';
  };

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [normalized]) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if ((current.length + 2 + paragraph.length) <= CHUNK_TARGET_CHARS) {
      current += `\n\n${paragraph}`;
      continue;
    }
    pushChunk();
    if (paragraph.length <= CHUNK_TARGET_CHARS) {
      current = paragraph;
      continue;
    }
    for (let index = 0; index < paragraph.length; index += CHUNK_TARGET_CHARS) {
      current = paragraph.slice(index, index + CHUNK_TARGET_CHARS);
      pushChunk();
    }
  }
  pushChunk();

  return chunks;
}

function buildDocumentProcessingResult(filename: string, extractedText: string | null): DocumentProcessingResult {
  const text = extractedText?.trim() ?? '';
  const contentPreview = text ? text.slice(0, MAX_PREVIEW_CHARS) : null;
  const chunks = text ? chunkExtractedText(text) : [];
  return {
    extractedText: text || null,
    contentPreview,
    summary: text ? summarizeText(text, filename) : null,
    keywords: text ? extractKeywords(text, filename) : [],
    chunks,
  };
}

async function persistStructuredDocument(input: {
  projectId: string;
  eventId: string;
  actorId: string;
  filename: string;
  mimeType: string;
  storagePath: string;
  sizeBytes: number;
  readable: boolean;
  processing: DocumentProcessingResult;
}): Promise<string | null> {
  const { data: documentRow, error: documentError } = await supabase
    .from('project_documents')
    .upsert({
      project_id: input.projectId,
      event_id: input.eventId,
      actor_id: input.actorId,
      filename: input.filename,
      mime_type: input.mimeType,
      storage_bucket: BUCKET,
      storage_path: input.storagePath,
      size_bytes: input.sizeBytes,
      readable: input.readable,
      extracted_text: input.processing.extractedText,
      content_preview: input.processing.contentPreview,
      summary: input.processing.summary,
      keywords: input.processing.keywords,
      extracted_char_count: input.processing.extractedText?.length ?? 0,
      chunk_count: input.processing.chunks.length,
    })
    .select('id')
    .single();

  if (documentError || !documentRow?.id) {
    return null;
  }

  await supabase.from('project_document_chunks').delete().eq('document_id', documentRow.id);
  if (input.processing.chunks.length > 0) {
    await supabase.from('project_document_chunks').insert(
      input.processing.chunks.map((chunk) => ({
        document_id: documentRow.id,
        project_id: input.projectId,
        chunk_index: chunk.index,
        content: chunk.content,
        content_preview: chunk.contentPreview,
        char_count: chunk.charCount,
      })),
    );
  }

  return documentRow.id;
}

function isValidTemplateType(value: string): value is ReportTemplateType {
  return value === 'docx' || value === 'pptx' || value === 'pdf';
}

async function userCanAccessProject(projectId: string, userId: string): Promise<boolean> {
  const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
  const { data: membership } = await supabase
    .from('project_members').select('user_id')
    .eq('project_id', projectId).eq('user_id', userId).single();
  return proj?.owner_id === userId || !!membership;
}

async function ensureReportTemplateUploadDir(): Promise<void> {
  await mkdir(REPORT_TEMPLATE_UPLOAD_DIR, { recursive: true });
}

function getReportTemplateUploadPaths(uploadId: string) {
  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(REPORT_TEMPLATE_UPLOAD_DIR, safeUploadId);
  return {
    dir,
    metadata: path.join(dir, 'metadata.json'),
    chunk: (chunkIndex: number) => path.join(dir, `${chunkIndex}.part`),
  };
}

async function writeReportTemplateUploadSession(session: ReportTemplateUploadSession): Promise<void> {
  await ensureReportTemplateUploadDir();
  const paths = getReportTemplateUploadPaths(session.uploadId);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.metadata, JSON.stringify(session), 'utf8');
}

async function readReportTemplateUploadSession(uploadId: string): Promise<ReportTemplateUploadSession | null> {
  try {
    const paths = getReportTemplateUploadPaths(uploadId);
    const contents = await readFile(paths.metadata, 'utf8');
    const parsed = JSON.parse(contents) as Partial<ReportTemplateUploadSession>;
    if (
      typeof parsed.uploadId !== 'string'
      || typeof parsed.projectId !== 'string'
      || typeof parsed.filename !== 'string'
      || typeof parsed.mimeType !== 'string'
      || typeof parsed.totalChunks !== 'number'
      || typeof parsed.userId !== 'string'
      || typeof parsed.createdAt !== 'string'
      || !isValidTemplateType(parsed.templateType ?? '')
    ) {
      return null;
    }
    return parsed as ReportTemplateUploadSession;
  } catch {
    return null;
  }
}

async function removeReportTemplateUploadSession(uploadId: string): Promise<void> {
  const paths = getReportTemplateUploadPaths(uploadId);
  await rm(paths.dir, { recursive: true, force: true });
}

async function storeReportTemplate(input: {
  projectId: string;
  templateType: ReportTemplateType;
  filename: string;
  mimeType: string;
  fileBuffer: Buffer;
  userId: string;
  logger: FastifyInstance['log'];
}) {
  const { projectId, templateType, filename, mimeType, fileBuffer, userId, logger } = input;

  const { data: existing } = await supabase
    .from('events')
    .select('id, metadata')
    .eq('project_id', projectId)
    .eq('event_type', 'report_template')
    .filter('metadata->>template_type', 'eq', templateType);

  for (const old of existing ?? []) {
    const oldMeta = old.metadata as { storage_path?: string };
    if (oldMeta.storage_path) {
      await supabase.storage.from(BUCKET).remove([oldMeta.storage_path]);
    }
    await supabase.from('events').delete().eq('id', old.id);
  }

  const storagePath = `${projectId}/templates/${templateType}-${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const inferredMime = mimeType || 'application/octet-stream';
  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, { contentType: inferredMime, upsert: false });

  if (storageErr) {
    logger.error({ err: storageErr, projectId, templateType, filename, sizeBytes: fileBuffer.byteLength }, 'report template storage upload failed');
    throw new Error(`Storage upload failed: ${storageErr.message}`);
  }

  const extractedText = await extractText(fileBuffer, filename, inferredMime);
  const templateAnalysis = await analyzeReportTemplate(fileBuffer, extractedText, templateType);
  const processing = buildDocumentProcessingResult(filename, extractedText);

  const { data, error: dbErr } = await supabase.from('events').insert({
    project_id: projectId,
    actor_id: userId,
    source: 'local',
    event_type: 'report_template',
    title: filename,
    summary: `Report template for ${templateType.toUpperCase()} reports`,
    metadata: {
      template_type: templateType,
      filename,
      mime_type: inferredMime,
      size_bytes: fileBuffer.byteLength,
      storage_path: storagePath,
      storage_bucket: BUCKET,
      content_preview: processing.contentPreview,
      document_summary: processing.summary,
      keywords: processing.keywords,
      chunk_count: processing.chunks.length,
      extracted_char_count: processing.extractedText?.length ?? 0,
      readable: extractedText !== null,
      template_analysis: templateAnalysis,
      analysis_version: templateAnalysis?.version ?? null,
    },
    occurred_at: new Date().toISOString(),
  }).select().single();

  if (dbErr) {
    logger.error({ err: dbErr, projectId, templateType, filename, sizeBytes: fileBuffer.byteLength }, 'report template event insert failed');
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(dbErr.message);
  }

  const documentId = await persistStructuredDocument({
    projectId,
    eventId: data.id,
    actorId: userId,
    filename,
    mimeType: inferredMime,
    storagePath,
    sizeBytes: fileBuffer.byteLength,
    readable: extractedText !== null,
    processing,
  });

  if (documentId) {
    const nextMetadata = {
      ...((data.metadata as Record<string, unknown> | null) ?? {}),
      document_id: documentId,
    };
    await supabase
      .from('events')
      .update({
        metadata: nextMetadata,
      })
      .eq('id', data.id);
    data.metadata = nextMetadata;
  } else {
    logger.warn({ projectId, templateType, filename, eventId: data.id }, 'report template stored without structured document row');
  }

  const meta = data.metadata as {
    template_type?: string;
    filename?: string;
    size_bytes?: number;
    storage_path?: string;
    template_analysis?: TemplateAnalysis | null;
    document_id?: string | null;
  };
  return {
    template: {
      id: data.id,
      templateType: meta.template_type ?? templateType,
      filename: meta.filename ?? filename,
      sizeBytes: meta.size_bytes ?? 0,
      storagePath: meta.storage_path ?? storagePath,
      analysis: meta.template_analysis ?? null,
      documentId: meta.document_id ?? null,
      uploadedAt: data.occurred_at,
    },
  };
}

export async function uploadRoutes(server: FastifyInstance) {
  await server.register(multipart, {
    limits: { fileSize: 157_286_400 }, // 150 MB
  });

  // ── Upload a file (PDF, DOCX, TXT, etc.) ──────────────────────────────────
  server.post('/uploads/local', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const parts = request.parts();
    let projectId = '';
    let filename = '';
    let mimeType = '';
    let fileBuffer: Buffer | null = null;
    let explicitTitle = '';
    let explicitSummary = '';
    let metadataJson = '';

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'projectId') projectId = part.value as string;
        if (part.fieldname === 'filename') filename = part.value as string;
        if (part.fieldname === 'title') explicitTitle = part.value as string;
        if (part.fieldname === 'summary') explicitSummary = part.value as string;
        if (part.fieldname === 'metadataJson') metadataJson = part.value as string;
      } else if (part.type === 'file') {
        filename = filename || part.filename;
        mimeType = part.mimetype;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!projectId || !filename || !fileBuffer) {
      return reply.status(400).send({ error: 'projectId, filename, and file are required' });
    }

    // Membership check
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Not a member of this project' });
    }

    // Validate MIME type (be lenient — browsers sometimes report wrong types)
    const inferredMime = mimeType || 'application/octet-stream';
    if (!isAllowedFileType(filename, inferredMime)) {
      return reply.status(415).send({ error: 'Unsupported file type. Use PDF, DOCX, PPTX, TXT, Markdown, CSV, JSON, or similar text files.' });
    }

    // Upload to Supabase Storage: project-documents/{projectId}/{uuid}-{filename}
    const storagePath = `${projectId}/${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: storageErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: inferredMime, upsert: false });

    if (storageErr) {
      return reply.status(500).send({ error: `Storage upload failed: ${storageErr.message}` });
    }

    // Extract text from PDF, DOCX, and plain-text formats for AI context
    const extractedText = await extractText(fileBuffer, filename, inferredMime);
    const processing = buildDocumentProcessingResult(filename, extractedText);

    const sizeKb = (fileBuffer.byteLength / 1024).toFixed(1);
    const summary = explicitSummary || `${filename} (${sizeKb} KB) — uploaded to project storage`;
    let extraMetadata: Record<string, unknown> = {};
    if (metadataJson) {
      try {
        const parsed = JSON.parse(metadataJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          extraMetadata = parsed as Record<string, unknown>;
        }
      } catch {
        return reply.status(400).send({ error: 'metadataJson must be valid JSON' });
      }
    }

    const { data, error: dbErr } = await supabase.from('events').insert({
      project_id: projectId,
      actor_id: user.id,
      source: 'local',
      event_type: 'file_upload',
      title: explicitTitle || filename,
      summary,
      metadata: {
        filename,
        mime_type: inferredMime,
        size_bytes: fileBuffer.byteLength,
        storage_path: storagePath,
        storage_bucket: BUCKET,
        extracted_text: processing.extractedText,
        content_preview: processing.contentPreview,
        document_summary: processing.summary,
        keywords: processing.keywords,
        chunk_count: processing.chunks.length,
        extracted_char_count: processing.extractedText?.length ?? 0,
        readable: extractedText !== null,
        ...extraMetadata,
      },
      occurred_at: new Date().toISOString(),
    }).select().single();

    if (dbErr) {
      // Clean up storage if DB insert fails
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return reply.status(500).send({ error: dbErr.message });
    }

    const documentId = await persistStructuredDocument({
      projectId,
      eventId: data.id,
      actorId: user.id,
      filename,
      mimeType: inferredMime,
      storagePath,
      sizeBytes: fileBuffer.byteLength,
      readable: extractedText !== null,
      processing,
    });

    if (documentId) {
      const nextMetadata = {
        ...((data.metadata as Record<string, unknown> | null) ?? {}),
        document_id: documentId,
      };
      await supabase
        .from('events')
        .update({
          metadata: nextMetadata,
        })
        .eq('id', data.id);
      data.metadata = nextMetadata;
    }

    return { event: data };
  });

  // ── Extract text from TXT/DOCX/PDF/etc. without storing the file ─────────
  server.post('/uploads/extract-text', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const parts = request.parts();
    let projectId = '';
    let filename = '';
    let mimeType = '';
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'projectId') projectId = part.value as string;
        if (part.fieldname === 'filename') filename = part.value as string;
      } else if (part.type === 'file') {
        filename = filename || part.filename;
        mimeType = part.mimetype;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!projectId || !filename || !fileBuffer) {
      return reply.status(400).send({ error: 'projectId, filename, and file are required' });
    }

    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Not a member of this project' });
    }

    const inferredMime = mimeType || 'application/octet-stream';
    if (!isAllowedFileType(filename, inferredMime)) {
      return reply.status(415).send({ error: 'Unsupported file type.' });
    }

    const extractedText = await extractText(fileBuffer, filename, inferredMime);
    if (!extractedText?.trim()) {
      return reply.status(422).send({ error: 'No readable text could be extracted from that file.' });
    }

    return {
      text: extractedText,
      preview: extractedText.slice(0, MAX_PREVIEW_CHARS),
      length: extractedText.length,
    };
  });

  // ── Generate a signed download URL ─────────────────────────────────────────
  server.post<{ Body: { storagePath: string } }>('/uploads/sign', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { storagePath } = request.body;
    if (!storagePath) return reply.status(400).send({ error: 'storagePath required' });

    // Verify membership: project ID is the first path segment
    const projectId = storagePath.split('/')[0];
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600); // 1-hour expiry

    if (error || !data) return reply.status(500).send({ error: error?.message ?? 'Could not sign URL' });
    return { url: data.signedUrl };
  });

  // ── List report templates for a project ───────────────────────────────────
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/report-templates', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId } = request.params;
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('events')
      .select('id, title, occurred_at, metadata')
      .eq('project_id', projectId)
      .eq('event_type', 'report_template')
      .order('occurred_at', { ascending: false });

    if (error) return reply.status(500).send({ error: error.message });

    const templates = (data ?? []).map((e) => {
      const meta = e.metadata as {
        template_type?: string;
        filename?: string;
        size_bytes?: number;
        storage_path?: string;
        template_analysis?: TemplateAnalysis | null;
        document_id?: string | null;
      };
      return {
        id: e.id,
        templateType: meta.template_type ?? 'docx',
        filename: meta.filename ?? e.title,
        sizeBytes: meta.size_bytes ?? 0,
        storagePath: meta.storage_path ?? '',
        analysis: meta.template_analysis ?? null,
        documentId: meta.document_id ?? null,
        uploadedAt: e.occurred_at,
      };
    });

    return { templates };
  });

  // ── Upload a report template ───────────────────────────────────────────────
  server.post<{ Body: { projectId?: string; templateType?: string; filename?: string; mimeType?: string; totalChunks?: number } }>('/uploads/report-template/init', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const projectId = `${request.body?.projectId ?? ''}`.trim();
    const templateType = `${request.body?.templateType ?? ''}`.trim();
    const filename = `${request.body?.filename ?? ''}`.trim();
    const mimeType = `${request.body?.mimeType ?? ''}`.trim() || 'application/octet-stream';
    const totalChunks = Number(request.body?.totalChunks ?? 0);

    if (!projectId || !filename || !isValidTemplateType(templateType) || !Number.isInteger(totalChunks) || totalChunks <= 0) {
      return reply.status(400).send({ error: 'projectId, templateType, filename, and totalChunks are required' });
    }

    if (!(await userCanAccessProject(projectId, user.id))) {
      return reply.status(403).send({ error: 'Only project members can manage templates' });
    }

    const uploadId = randomUUID();
    await writeReportTemplateUploadSession({
      uploadId,
      projectId,
      templateType,
      filename,
      mimeType,
      totalChunks,
      userId: user.id,
      createdAt: new Date().toISOString(),
    });

    return { uploadId, chunkSizeBytes: REPORT_TEMPLATE_CHUNK_BYTES };
  });

  server.post('/uploads/report-template/chunk', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const parts = request.parts();
    let uploadId = '';
    let chunkIndex = -1;
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'uploadId') uploadId = `${part.value ?? ''}`;
        if (part.fieldname === 'chunkIndex') chunkIndex = Number(part.value ?? -1);
      } else if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0 || !fileBuffer) {
      return reply.status(400).send({ error: 'uploadId, chunkIndex, and chunk file are required' });
    }
    if (fileBuffer.byteLength > REPORT_TEMPLATE_CHUNK_BYTES) {
      return reply.status(413).send({ error: `Chunk exceeds ${Math.floor(REPORT_TEMPLATE_CHUNK_BYTES / 1024)} KB limit` });
    }

    const session = await readReportTemplateUploadSession(uploadId);
    if (!session) return reply.status(404).send({ error: 'Upload session not found or expired' });
    if (session.userId !== user.id) return reply.status(403).send({ error: 'Forbidden' });
    if (chunkIndex >= session.totalChunks) return reply.status(400).send({ error: 'chunkIndex is out of range' });

    const paths = getReportTemplateUploadPaths(uploadId);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.chunk(chunkIndex), fileBuffer);

    return { ok: true };
  });

  server.post<{ Body: { uploadId?: string } }>('/uploads/report-template/complete', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const uploadId = `${request.body?.uploadId ?? ''}`.trim();
    if (!uploadId) return reply.status(400).send({ error: 'uploadId is required' });

    const session = await readReportTemplateUploadSession(uploadId);
    if (!session) return reply.status(404).send({ error: 'Upload session not found or expired' });
    if (session.userId !== user.id) return reply.status(403).send({ error: 'Forbidden' });
    if (!(await userCanAccessProject(session.projectId, user.id))) {
      return reply.status(403).send({ error: 'Only project members can manage templates' });
    }

    try {
      const paths = getReportTemplateUploadPaths(uploadId);
      const existingParts = new Set(
        (await readdir(paths.dir))
          .map((name) => {
            const match = name.match(/^(\d+)\.part$/);
            return match ? Number(match[1]) : null;
          })
          .filter((value): value is number => value !== null),
      );

      for (let index = 0; index < session.totalChunks; index += 1) {
        if (!existingParts.has(index)) {
          return reply.status(400).send({ error: `Missing chunk ${index + 1} of ${session.totalChunks}` });
        }
      }

      const buffers: Buffer[] = [];
      for (let index = 0; index < session.totalChunks; index += 1) {
        buffers.push(await readFile(paths.chunk(index)));
      }

      const result = await storeReportTemplate({
        projectId: session.projectId,
        templateType: session.templateType,
        filename: session.filename,
        mimeType: session.mimeType,
        fileBuffer: Buffer.concat(buffers),
        userId: user.id,
        logger: request.log,
      });

      return result;
    } catch (err: unknown) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Failed to complete template upload' });
    } finally {
      await removeReportTemplateUploadSession(uploadId);
    }
  });

  server.post('/uploads/report-template', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const parts = request.parts();
    let projectId = '';
    let templateType = '';   // 'docx' | 'pptx' | 'pdf'
    let filename = '';
    let mimeType = '';
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'projectId') projectId = part.value as string;
        if (part.fieldname === 'templateType') templateType = part.value as string;
        if (part.fieldname === 'filename') filename = part.value as string;
      } else if (part.type === 'file') {
        filename = filename || part.filename;
        mimeType = part.mimetype;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!projectId || !templateType || !filename || !fileBuffer) {
      return reply.status(400).send({ error: 'projectId, templateType, filename, and file are required' });
    }
    if (!isValidTemplateType(templateType)) {
      return reply.status(400).send({ error: 'templateType must be docx, pptx, or pdf' });
    }

    if (!(await userCanAccessProject(projectId, user.id))) {
      return reply.status(403).send({ error: 'Only project members can manage templates' });
    }
    try {
      return await storeReportTemplate({
        projectId,
        templateType,
        filename,
        mimeType: mimeType || 'application/octet-stream',
        fileBuffer,
        userId: user.id,
        logger: request.log,
      });
    } catch (err: unknown) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Template upload failed' });
    }
  });

  // ── Delete a report template ───────────────────────────────────────────────
  server.delete<{ Body: { projectId: string; eventId: string } }>('/uploads/report-template', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, eventId } = request.body;
    if (!projectId || !eventId) return reply.status(400).send({ error: 'projectId and eventId are required' });

    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Only project members can manage templates' });
    }

    const { data: evt } = await supabase
      .from('events').select('metadata').eq('id', eventId).eq('project_id', projectId).single();

    if (!evt) return reply.status(404).send({ error: 'Template not found' });

    const meta = evt.metadata as { storage_path?: string };
    if (meta.storage_path) {
      await supabase.storage.from(BUCKET).remove([meta.storage_path]);
    }
    await supabase.from('events').delete().eq('id', eventId);

    return { ok: true };
  });

  // ── Delete a file from storage (called when event is deleted) ──────────────
  server.delete<{ Body: { storagePath: string } }>('/uploads/file', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { storagePath } = request.body;
    if (!storagePath) return reply.status(400).send({ error: 'storagePath required' });

    const projectId = storagePath.split('/')[0];
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (error) return reply.status(500).send({ error: error.message });
    return { ok: true };
  });
}
