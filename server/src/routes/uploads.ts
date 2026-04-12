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
import { checkRateLimit } from '../lib/rate-limit.js';
import { requireProjectAccessFromAuthHeader } from '../lib/request-auth.js';

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
const MAX_LOCAL_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACT_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_TEMPLATE_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_TEXT_BUFFER_BYTES = 5 * 1024 * 1024;
const ZIP_ENTRY_LIMIT = 250;
const ZIP_UNCOMPRESSED_LIMIT_BYTES = 80 * 1024 * 1024;
const ZIP_SUSPICIOUS_RATIO = 120;
const EXTRACTION_TIMEOUT_MS = 12_000;
const SIGN_URL_TTL_SECONDS = 3600;
const UPLOAD_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };
const EXTRACTION_RATE_LIMIT = { maxRequests: 12, windowMs: 60_000 };
const SIGN_RATE_LIMIT = { maxRequests: 50, windowMs: 60_000 };
const TEMPLATE_RATE_LIMIT = { maxRequests: 12, windowMs: 60_000 };
const TEMPLATE_DELETE_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

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
  version: 2;
  targetTemplateType: ReportTemplateType;
  sourceFormat: 'docx' | 'pptx' | 'pdf';
  sourceMimeType: string;
  summary: string;
  sectionHeadings: string[];
  layoutHints: string[];
  styleHints: string[];
  palette: string[];
  fonts: string[];
  analysisConfidence?: 'low' | 'medium' | 'high';
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

function extractPaletteFromXmlFragments(fragments: Array<string | null | undefined>, limit = 12): string[] {
  const colors = fragments.flatMap((fragment) => {
    if (!fragment) return [];
    return [
      ...[...fragment.matchAll(/(?:lastClr|val|fill|color|rgb)="([0-9A-Fa-f]{6})"/g)].map((match) => normalizeHexColor(match[1])),
      ...[...fragment.matchAll(/#[0-9A-Fa-f]{6}/g)].map((match) => normalizeHexColor(match[0])),
      ...[...fragment.matchAll(/\b([0-9A-Fa-f]{6})\b/g)].map((match) => normalizeHexColor(match[1])),
    ];
  });
  return uniqueStrings(colors, limit).filter((value): value is string => Boolean(value));
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

function detectTemplateSourceFormat(filename: string, mimeType: string): ReportTemplateType | null {
  const lower = filename.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (mimeType.includes('wordprocessingml') || lower.endsWith('.docx')) return 'docx';
  if (mimeType.includes('presentationml') || lower.endsWith('.pptx')) return 'pptx';
  return null;
}

function inferTitleAlignment(values: Array<'left' | 'center' | 'right' | null | undefined>, fallback: 'left' | 'center' = 'left'): 'left' | 'center' {
  const counts = { left: 0, center: 0, right: 0 };
  for (const value of values) {
    if (!value) continue;
    counts[value] += 1;
  }
  if (counts.center > counts.left && counts.center >= counts.right) return 'center';
  if (counts.left > 0 || counts.right > 0) return 'left';
  return fallback;
}

function inferAnalysisConfidence(score: number): 'low' | 'medium' | 'high' {
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
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

async function analyzeDocxTemplate(
  buffer: Buffer,
  extractedText: string | null,
  targetTemplateType: ReportTemplateType,
  sourceMimeType: string,
): Promise<TemplateAnalysis | null> {
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
      const alignment = block.match(/<w:jc[^>]*w:val="([^"]+)"/)?.[1] ?? null;
      return {
        text,
        style,
        alignment: (alignment === 'center' ? 'center' : alignment === 'right' ? 'right' : 'left') as 'left' | 'center' | 'right',
        isBullet: /<w:numPr\b/.test(block),
      };
    }).filter((paragraph) => paragraph.text.length > 0);

    const themePalette = extractPaletteFromXmlFragments([themeXml, stylesXml, documentXml]);
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
    const orientation = /<w:pgSz[^>]*w:orient="landscape"/.test(documentXml) ? 'landscape' : 'portrait';
    const pageEstimate = Math.max(1, pageBreakCount + 1, Math.round((extractedText?.length ?? 0) / 3_000) || 1);
    const density = inferDensity(extractedText?.length ?? paragraphs.length * 80, headings.length || 1);
    const headingCase = inferHeadingCase(headings);
    const firstParagraphs = paragraphs.slice(0, 8);
    const titleAlignment = inferTitleAlignment(firstParagraphs.map((paragraph) => paragraph.alignment), 'left');
    const hasCoverPage = pageEstimate > 1 && firstParagraphs.some((paragraph) => paragraph.text.length > 24 && paragraph.alignment === 'center');
    const fonts = uniqueStrings([...themeFonts, ...styleFonts]);
    const sampleExcerpt = compactWhitespace((extractedText ?? paragraphs.map((paragraph) => paragraph.text).join(' ')).slice(0, MAX_TEMPLATE_EXCERPT_CHARS));
    const confidence = inferAnalysisConfidence(
      (themePalette.length > 0 ? 2 : 0)
      + (fonts.length > 0 ? 2 : 0)
      + (headings.length > 0 ? 1 : 0)
      + (tableCount > 0 || hasBullets ? 1 : 0),
    );

    return {
      version: 2,
      targetTemplateType,
      sourceFormat: 'docx',
      sourceMimeType,
      summary: `DOCX template with approximately ${pageEstimate} page${pageEstimate === 1 ? '' : 's'}, ${headings.length || 1} recognizable section heading${headings.length === 1 ? '' : 's'}, and ${tableCount} table${tableCount === 1 ? '' : 's'}.`,
      sectionHeadings: headings,
      layoutHints: uniqueStrings([
        hasCoverPage ? 'Starts with a dedicated cover or title page.' : 'Begins directly with report content.',
        tableCount ? `Uses ${tableCount} structured table${tableCount === 1 ? '' : 's'} in the body.` : 'Relies more on prose than tables.',
        hasBullets ? 'Uses bullet lists for supporting detail.' : 'Uses paragraph-driven sections with limited bullets.',
        orientation === 'landscape' ? 'Document is configured for landscape pages.' : 'Document is configured for portrait pages.',
      ]),
      styleHints: uniqueStrings([
        headingCase === 'upper' ? 'Headings are typically uppercase.' : headingCase === 'title' ? 'Headings are title case.' : 'Headings are sentence case.',
        fonts[0] ? `Primary typeface appears to be ${fonts[0]}.` : 'No dominant typeface could be inferred from the theme.',
        themePalette[0] ? `Visual identity includes a restrained palette anchored by ${themePalette.slice(0, 3).join(', ')}.` : 'No explicit theme palette was embedded in the DOCX theme.',
        titleAlignment === 'center' ? 'Opening/title content is visually centered.' : 'Opening/title content is left-aligned.',
      ]),
      palette: themePalette,
      fonts,
      analysisConfidence: confidence,
      pageCount: pageEstimate,
      hasCoverPage,
      hasTables: tableCount > 0,
      hasBullets,
      sampleExcerpt: sampleExcerpt || undefined,
      renderHints: {
        ...buildRenderHints(themePalette, fonts, 'docx', density, titleAlignment),
        orientation,
        titleAlignment,
      },
    };
  } catch {
    return null;
  }
}

async function analyzePptxTemplate(
  buffer: Buffer,
  extractedText: string | null,
  targetTemplateType: ReportTemplateType,
  sourceMimeType: string,
): Promise<TemplateAnalysis | null> {
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
      const alignments: Array<'left' | 'center' | 'right'> = [...xml.matchAll(/<a:pPr[^>]*algn="([^"]+)"/g)]
        .map((match) => (match[1] === 'ctr' ? 'center' : match[1] === 'r' ? 'right' : 'left'));
      return {
        title,
        text: lines.join(' '),
        alignment: inferTitleAlignment(alignments, 'center'),
        hasBullets: /<a:buChar|<a:pPr[^>]*lvl=/.test(xml),
        hasTables: /table|tbl/i.test(xml),
        colors: extractPaletteFromXmlFragments([xml], 8),
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
    const themePalette = extractPaletteFromXmlFragments([themeXml, ...slideDetails.map((slide) => slide?.colors?.join(' '))]);
    const fonts = themeXml ? extractFontsFromThemeXml(themeXml) : [];
    const sampleExcerpt = compactWhitespace((extractedText ?? slideDetails.map((slide) => slide?.text ?? '').join(' ')).slice(0, MAX_TEMPLATE_EXCERPT_CHARS));
    const titleAlignment = inferTitleAlignment(slideDetails.map((slide) => slide?.alignment), 'center');
    const confidence = inferAnalysisConfidence(
      (themePalette.length > 0 ? 2 : 0)
      + (fonts.length > 0 ? 2 : 0)
      + (headings.length > 0 ? 1 : 0)
      + (slideCount > 1 ? 1 : 0),
    );

    return {
      version: 2,
      targetTemplateType,
      sourceFormat: 'pptx',
      sourceMimeType,
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
        titleAlignment === 'center' ? 'Slide titles and cover content skew centered.' : 'Slide titles skew left-aligned.',
      ]),
      palette: themePalette,
      fonts,
      analysisConfidence: confidence,
      slideCount,
      hasCoverPage: slideCount > 1,
      hasTables,
      hasBullets,
      sampleExcerpt: sampleExcerpt || undefined,
      renderHints: {
        ...buildRenderHints(themePalette, fonts, 'pptx', density, titleAlignment),
        aspectRatio,
        orientation: 'landscape',
        titleAlignment,
        headerBand: slideCount > 1,
        sidebarAccent: slideCount > 2,
      },
    };
  } catch {
    return null;
  }
}

async function analyzePdfTemplate(
  buffer: Buffer,
  extractedText: string | null,
  targetTemplateType: ReportTemplateType,
  sourceMimeType: string,
): Promise<TemplateAnalysis | null> {
  try {
    const pdfData = await pdfParse(buffer);
    const text = extractedText ?? pdfData.text?.trim() ?? '';
    const headings = extractLikelyHeadings(text);
    const density = inferDensity(text.length, headings.length || 1);
    const hasBullets = /(^|\n)\s*[•*-]\s+/m.test(text);
    const hasTables = /\|.+\||\btable\b/i.test(text);
    const pageCount = pdfData.numpages || Math.max(1, Math.round(text.length / 3_200));
    const sampleExcerpt = compactWhitespace(text.slice(0, MAX_TEMPLATE_EXCERPT_CHARS));
    const confidence = inferAnalysisConfidence(
      (headings.length > 0 ? 2 : 0)
      + (pageCount > 1 ? 1 : 0)
      + (hasBullets || hasTables ? 1 : 0),
    );

    return {
      version: 2,
      targetTemplateType,
      sourceFormat: 'pdf',
      sourceMimeType,
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
      analysisConfidence: confidence,
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
  sourceFormat: 'docx' | 'pptx' | 'pdf',
  targetTemplateType: ReportTemplateType,
  sourceMimeType: string,
): Promise<TemplateAnalysis | null> {
  if (sourceFormat === 'docx') return analyzeDocxTemplate(buffer, extractedText, targetTemplateType, sourceMimeType);
  if (sourceFormat === 'pptx') return analyzePptxTemplate(buffer, extractedText, targetTemplateType, sourceMimeType);
  return analyzePdfTemplate(buffer, extractedText, targetTemplateType, sourceMimeType);
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

function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isDangerousPathSegment(value: string): boolean {
  return value.includes('..') || value.startsWith('/') || value.startsWith('\\');
}

function detectBufferMimeType(buffer: Buffer, fallback: string, filename: string): string {
  if (buffer.length >= 5 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return 'application/pdf';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return fallback || 'application/octet-stream';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function validateArchiveSafety(buffer: Buffer, filename: string): Promise<void> {
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.docx') && !lower.endsWith('.pptx') && !lower.endsWith('.xlsx')) {
    return;
  }

  const zip = await withTimeout(JSZip.loadAsync(buffer), EXTRACTION_TIMEOUT_MS, 'Archive inspection');
  const entries = Object.values(zip.files);
  if (entries.length > ZIP_ENTRY_LIMIT) {
    throw new Error('Archive contains too many embedded files.');
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    if (isDangerousPathSegment(entry.name)) {
      throw new Error('Archive contains an invalid embedded path.');
    }
    if (entry.dir) continue;
    totalUncompressedBytes += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (totalUncompressedBytes > ZIP_UNCOMPRESSED_LIMIT_BYTES) {
      throw new Error('Archive expands beyond the allowed extraction limit.');
    }
  }

  if (buffer.byteLength > 0 && totalUncompressedBytes > buffer.byteLength * ZIP_SUSPICIOUS_RATIO) {
    throw new Error('Archive compression ratio is too high.');
  }
}

function validateFileShape(filename: string, mimeType: string, buffer: Buffer, maxBytes: number): string {
  const trimmedFilename = filename.trim();
  if (!trimmedFilename) throw new Error('filename is required');
  if (isDangerousPathSegment(trimmedFilename)) throw new Error('Invalid filename');
  if (buffer.byteLength === 0) throw new Error('Uploaded file is empty');
  if (buffer.byteLength > maxBytes) throw new Error(`"${trimmedFilename}" exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MB limit.`);

  const normalizedMime = detectBufferMimeType(buffer, mimeType, trimmedFilename);
  if (!isAllowedFileType(trimmedFilename, normalizedMime)) {
    throw new Error('Unsupported file type. Use PDF, DOCX, PPTX, TXT, Markdown, CSV, JSON, or similar text files.');
  }
  if (normalizedMime === 'application/json') {
    try {
      JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new Error('JSON upload is malformed.');
    }
  }
  if (normalizedMime.startsWith('text/') || TEXT_EXTS.has(getExtension(trimmedFilename))) {
    const sample = buffer.subarray(0, Math.min(buffer.byteLength, 2048));
    if (sample.includes(0)) {
      throw new Error('Text upload appears to be binary.');
    }
  }

  return normalizedMime;
}

type MultipartPayload = {
  fields: Record<string, string>;
  file: {
    filename: string;
    mimeType: string;
    buffer: Buffer;
  } | null;
};

async function readMultipartPayload(
  request: any,
  options: {
    fileFieldName?: string;
    maxFileBytes: number;
    maxFieldChars?: number;
  },
): Promise<MultipartPayload> {
  const parts = request.parts();
  const fields: Record<string, string> = {};
  let file: MultipartPayload['file'] = null;

  for await (const part of parts) {
    if (part.type === 'field') {
      const value = `${part.value ?? ''}`;
      if (value.length > (options.maxFieldChars ?? 20_000)) {
        throw new Error(`Field "${part.fieldname}" exceeds the allowed size.`);
      }
      fields[part.fieldname] = value;
      continue;
    }

    if (options.fileFieldName && part.fieldname !== options.fileFieldName) {
      continue;
    }
    if (file) {
      throw new Error('Only one file can be uploaded at a time.');
    }

    const chunks: Buffer[] = [];
    let fileBytes = 0;
    for await (const chunk of part.file) {
      const piece = chunk as Buffer;
      fileBytes += piece.byteLength;
      if (fileBytes > options.maxFileBytes) {
        throw new Error(`"${part.filename || 'upload'}" exceeds the ${(options.maxFileBytes / (1024 * 1024)).toFixed(0)} MB limit.`);
      }
      chunks.push(piece);
    }

    file = {
      filename: part.filename || 'upload',
      mimeType: part.mimetype || 'application/octet-stream',
      buffer: Buffer.concat(chunks),
    };
  }

  return { fields, file };
}

function getProjectIdFromStoragePath(storagePath: string): string | null {
  const normalized = storagePath.trim();
  if (!normalized || isDangerousPathSegment(normalized)) return null;
  const projectId = normalized.split('/')[0]?.trim();
  return projectId || null;
}

async function requireProjectMemberAccess(projectId: string, authorization: string | undefined) {
  return requireProjectAccessFromAuthHeader(projectId, authorization);
}

function limitKey(prefix: string, userId: string, projectId?: string | null): string {
  return `${prefix}:${userId}:${projectId ?? 'global'}`;
}

async function extractText(buffer: Buffer, filename: string, mimeType: string): Promise<string | null> {
  const lower = filename.toLowerCase();

  // PDF
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    try {
      const data = await withTimeout(pdfParse(buffer), EXTRACTION_TIMEOUT_MS, 'PDF extraction');
      return data.text?.trim().slice(0, MAX_EXTRACTED_CHARS) || null;
    } catch {
      return null;
    }
  }

  // DOCX
  if (mimeType.includes('wordprocessingml') || lower.endsWith('.docx')) {
    try {
      await validateArchiveSafety(buffer, filename);
      const result = await withTimeout(mammoth.extractRawText({ buffer }), EXTRACTION_TIMEOUT_MS, 'DOCX extraction');
      return result.value?.trim().slice(0, MAX_EXTRACTED_CHARS) || null;
    } catch {
      return null;
    }
  }

  // PPTX — extract all slide text via JSZip + XML tag stripping
  if (mimeType.includes('presentationml') || lower.endsWith('.pptx')) {
    try {
      await validateArchiveSafety(buffer, filename);
      const zip = await withTimeout(JSZip.loadAsync(buffer), EXTRACTION_TIMEOUT_MS, 'PPTX extraction');
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
    return buffer.subarray(0, MAX_TEXT_BUFFER_BYTES).toString('utf8').slice(0, MAX_EXTRACTED_CHARS);
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
  const inferredMime = validateFileShape(filename, mimeType || 'application/octet-stream', fileBuffer, MAX_TEMPLATE_UPLOAD_BYTES);
  const sourceFormat = detectTemplateSourceFormat(filename, inferredMime);
  if (!sourceFormat) {
    throw new Error('Template file must be DOCX, PPTX, or PDF.');
  }
  await validateArchiveSafety(fileBuffer, filename);

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

  const storagePath = `${projectId}/templates/${templateType}-${randomUUID()}-${sanitizeStorageName(filename)}`;
  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, { contentType: inferredMime, upsert: false });

  if (storageErr) {
    logger.error({ err: storageErr, projectId, templateType, filename, sizeBytes: fileBuffer.byteLength }, 'report template storage upload failed');
    throw new Error(`Storage upload failed: ${storageErr.message}`);
  }

  const extractedText = await extractText(fileBuffer, filename, inferredMime);
  const templateAnalysis = await analyzeReportTemplate(fileBuffer, extractedText, sourceFormat, templateType, inferredMime);
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
      source_format: sourceFormat,
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
    source_format?: ReportTemplateType;
  };
  return {
    template: {
      id: data.id,
      templateType: meta.template_type ?? templateType,
      sourceFormat: meta.source_format ?? sourceFormat,
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
    limits: { fileSize: 32 * 1024 * 1024 },
  });

  // ── Upload a file (PDF, DOCX, TXT, etc.) ──────────────────────────────────
  server.post('/uploads/local', async (request, reply) => {
    let payload: MultipartPayload;
    try {
      payload = await readMultipartPayload(request, { maxFileBytes: MAX_LOCAL_UPLOAD_BYTES });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid upload payload.' });
    }

    const projectId = `${payload.fields.projectId ?? ''}`.trim();
    const filename = `${payload.fields.filename ?? payload.file?.filename ?? ''}`.trim();
    const explicitTitle = `${payload.fields.title ?? ''}`.trim();
    const explicitSummary = `${payload.fields.summary ?? ''}`.trim();
    const metadataJson = `${payload.fields.metadataJson ?? ''}`.trim();
    const fileBuffer = payload.file?.buffer ?? null;
    if (!projectId || !filename || !fileBuffer || !payload.file) {
      return reply.status(400).send({ error: 'projectId, filename, and file are required' });
    }

    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

    const uploadLimit = checkRateLimit(limitKey('upload-local', access.userId, projectId), UPLOAD_RATE_LIMIT);
    if (uploadLimit.limited) {
      return reply.status(429).send({
        error: 'Upload rate limit exceeded. Please wait before sending more files.',
        retryAfterSeconds: uploadLimit.retryAfterSeconds,
      });
    }

    let inferredMime: string;
    try {
      inferredMime = validateFileShape(filename, payload.file.mimeType, fileBuffer, MAX_LOCAL_UPLOAD_BYTES);
      await validateArchiveSafety(fileBuffer, filename);
    } catch (error) {
      return reply.status(415).send({ error: error instanceof Error ? error.message : 'Unsupported upload.' });
    }

    // Upload to Supabase Storage: project-documents/{projectId}/{uuid}-{filename}
    const storagePath = `${projectId}/${randomUUID()}-${sanitizeStorageName(filename)}`;
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
      actor_id: access.userId,
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
      actorId: access.userId,
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
    let payload: MultipartPayload;
    try {
      payload = await readMultipartPayload(request, { maxFileBytes: MAX_EXTRACT_UPLOAD_BYTES });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid extraction payload.' });
    }

    const projectId = `${payload.fields.projectId ?? ''}`.trim();
    const filename = `${payload.fields.filename ?? payload.file?.filename ?? ''}`.trim();
    const fileBuffer = payload.file?.buffer ?? null;
    if (!projectId || !filename || !fileBuffer || !payload.file) {
      return reply.status(400).send({ error: 'projectId, filename, and file are required' });
    }

    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

    const extractionLimit = checkRateLimit(limitKey('upload-extract', access.userId, projectId), EXTRACTION_RATE_LIMIT);
    if (extractionLimit.limited) {
      return reply.status(429).send({
        error: 'Document extraction rate limit exceeded. Please wait before retrying.',
        retryAfterSeconds: extractionLimit.retryAfterSeconds,
      });
    }

    let inferredMime: string;
    try {
      inferredMime = validateFileShape(filename, payload.file.mimeType, fileBuffer, MAX_EXTRACT_UPLOAD_BYTES);
      await validateArchiveSafety(fileBuffer, filename);
    } catch (error) {
      return reply.status(415).send({ error: error instanceof Error ? error.message : 'Unsupported file type.' });
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
    const { storagePath } = request.body;
    if (!storagePath) return reply.status(400).send({ error: 'storagePath required' });

    const projectId = getProjectIdFromStoragePath(storagePath);
    if (!projectId) return reply.status(400).send({ error: 'Invalid storagePath' });

    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

    const signLimit = checkRateLimit(limitKey('upload-sign', access.userId, projectId), SIGN_RATE_LIMIT);
    if (signLimit.limited) {
      return reply.status(429).send({
        error: 'Too many file signing requests. Please wait before retrying.',
        retryAfterSeconds: signLimit.retryAfterSeconds,
      });
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGN_URL_TTL_SECONDS);

    if (error || !data) return reply.status(500).send({ error: error?.message ?? 'Could not sign URL' });
    return { url: data.signedUrl };
  });

  // ── List report templates for a project ───────────────────────────────────
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/report-templates', async (request, reply) => {
    const { projectId } = request.params;
    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

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
        source_format?: ReportTemplateType;
        filename?: string;
        size_bytes?: number;
        storage_path?: string;
        template_analysis?: TemplateAnalysis | null;
        document_id?: string | null;
      };
      return {
        id: e.id,
        templateType: meta.template_type ?? 'docx',
        sourceFormat: meta.source_format ?? meta.template_analysis?.sourceFormat ?? 'pdf',
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
    const projectId = `${request.body?.projectId ?? ''}`.trim();
    const templateType = `${request.body?.templateType ?? ''}`.trim();
    const filename = `${request.body?.filename ?? ''}`.trim();
    const mimeType = `${request.body?.mimeType ?? ''}`.trim() || 'application/octet-stream';
    const totalChunks = Number(request.body?.totalChunks ?? 0);

    if (!projectId || !filename || !isValidTemplateType(templateType) || !Number.isInteger(totalChunks) || totalChunks <= 0) {
      return reply.status(400).send({ error: 'projectId, templateType, filename, and totalChunks are required' });
    }
    if (!detectTemplateSourceFormat(filename, mimeType)) {
      return reply.status(415).send({ error: 'Template file must be DOCX, PPTX, or PDF.' });
    }

    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

    const templateLimit = checkRateLimit(limitKey('template-init', access.userId, projectId), TEMPLATE_RATE_LIMIT);
    if (templateLimit.limited) {
      return reply.status(429).send({
        error: 'Template upload rate limit exceeded. Please wait before retrying.',
        retryAfterSeconds: templateLimit.retryAfterSeconds,
      });
    }

    if (totalChunks * REPORT_TEMPLATE_CHUNK_BYTES > MAX_TEMPLATE_UPLOAD_BYTES) {
      return reply.status(413).send({ error: 'Template exceeds the maximum allowed size.' });
    }

    const uploadId = randomUUID();
    await writeReportTemplateUploadSession({
      uploadId,
      projectId,
      templateType,
      filename,
      mimeType,
      totalChunks,
      userId: access.userId,
      createdAt: new Date().toISOString(),
    });

    return { uploadId, chunkSizeBytes: REPORT_TEMPLATE_CHUNK_BYTES };
  });

  server.post('/uploads/report-template/chunk', async (request, reply) => {
    let payload: MultipartPayload;
    try {
      payload = await readMultipartPayload(request, { maxFileBytes: REPORT_TEMPLATE_CHUNK_BYTES, maxFieldChars: 512 });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid template chunk payload.' });
    }

    const uploadId = `${payload.fields.uploadId ?? ''}`.trim();
    const chunkIndex = Number(payload.fields.chunkIndex ?? -1);
    const fileBuffer = payload.file?.buffer ?? null;
    if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0 || !fileBuffer) {
      return reply.status(400).send({ error: 'uploadId, chunkIndex, and chunk file are required' });
    }
    if (fileBuffer.byteLength > REPORT_TEMPLATE_CHUNK_BYTES) {
      return reply.status(413).send({ error: `Chunk exceeds ${Math.floor(REPORT_TEMPLATE_CHUNK_BYTES / 1024)} KB limit` });
    }

    const session = await readReportTemplateUploadSession(uploadId);
    if (!session) return reply.status(404).send({ error: 'Upload session not found or expired' });
    const access = await requireProjectMemberAccess(session.projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });
    if (session.userId !== access.userId) return reply.status(403).send({ error: 'Forbidden' });
    if (chunkIndex >= session.totalChunks) return reply.status(400).send({ error: 'chunkIndex is out of range' });

    const paths = getReportTemplateUploadPaths(uploadId);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.chunk(chunkIndex), fileBuffer);

    return { ok: true };
  });

  server.post<{ Body: { uploadId?: string } }>('/uploads/report-template/complete', async (request, reply) => {
    const uploadId = `${request.body?.uploadId ?? ''}`.trim();
    if (!uploadId) return reply.status(400).send({ error: 'uploadId is required' });

    const session = await readReportTemplateUploadSession(uploadId);
    if (!session) return reply.status(404).send({ error: 'Upload session not found or expired' });
    const access = await requireProjectMemberAccess(session.projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });
    if (session.userId !== access.userId) return reply.status(403).send({ error: 'Forbidden' });

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
        userId: access.userId,
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
    let payload: MultipartPayload;
    try {
      payload = await readMultipartPayload(request, { maxFileBytes: MAX_TEMPLATE_UPLOAD_BYTES });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid template upload payload.' });
    }

    const projectId = `${payload.fields.projectId ?? ''}`.trim();
    const templateType = `${payload.fields.templateType ?? ''}`.trim();
    const filename = `${payload.fields.filename ?? payload.file?.filename ?? ''}`.trim();
    const fileBuffer = payload.file?.buffer ?? null;
    const mimeType = payload.file?.mimeType ?? 'application/octet-stream';

    if (!projectId || !templateType || !filename || !fileBuffer) {
      return reply.status(400).send({ error: 'projectId, templateType, filename, and file are required' });
    }
    if (!isValidTemplateType(templateType)) {
      return reply.status(400).send({ error: 'templateType must be docx, pptx, or pdf' });
    }

    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

    const templateLimit = checkRateLimit(limitKey('template-direct', access.userId, projectId), TEMPLATE_RATE_LIMIT);
    if (templateLimit.limited) {
      return reply.status(429).send({
        error: 'Template upload rate limit exceeded. Please wait before retrying.',
        retryAfterSeconds: templateLimit.retryAfterSeconds,
      });
    }
    try {
      return await storeReportTemplate({
        projectId,
        templateType,
        filename,
        mimeType,
        fileBuffer,
        userId: access.userId,
        logger: request.log,
      });
    } catch (err: unknown) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Template upload failed' });
    }
  });

  // ── Delete a report template ───────────────────────────────────────────────
  server.delete<{ Body: { projectId: string; eventId: string } }>('/uploads/report-template', async (request, reply) => {
    const { projectId, eventId } = request.body;
    if (!projectId || !eventId) return reply.status(400).send({ error: 'projectId and eventId are required' });

    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

    const deleteLimit = checkRateLimit(limitKey('template-delete', access.userId, projectId), TEMPLATE_DELETE_RATE_LIMIT);
    if (deleteLimit.limited) {
      return reply.status(429).send({
        error: 'Too many template delete requests. Please wait before retrying.',
        retryAfterSeconds: deleteLimit.retryAfterSeconds,
      });
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
    const { storagePath } = request.body;
    if (!storagePath) return reply.status(400).send({ error: 'storagePath required' });

    const projectId = getProjectIdFromStoragePath(storagePath);
    if (!projectId) return reply.status(400).send({ error: 'Invalid storagePath' });

    const access = await requireProjectMemberAccess(projectId, request.headers.authorization);
    if (!access.ok) return reply.status(access.status).send({ error: access.error });

    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (error) return reply.status(500).send({ error: error.message });
    return { ok: true };
  });
}
