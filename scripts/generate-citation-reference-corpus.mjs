import { promises as fs } from 'node:fs';
import path from 'node:path';
import pdfParse from '../server/node_modules/pdf-parse/lib/pdf-parse.js';

const repoRoot = '/home/kyle/odyssey';
const sourceDir = path.join(repoRoot, 'Citation References', 'NPS Citation References');
const processedDir = path.join(repoRoot, 'Citation References', 'processed');
const extractedDir = path.join(processedDir, 'extracted-text');
const generatedTsPath = path.join(repoRoot, 'client', 'src', 'generated', 'citation-references.ts');
const corpusJsonPath = path.join(processedDir, 'citation-corpus.json');
const tempToolRoot = '/home/kyle/citation-tools-temp/node_modules';

const DEFAULT_SECTION_QUERIES = [
  { id: 'journal-article', title: 'Journal articles', query: 'journal article doi online print database page numbers' },
  { id: 'website', title: 'Websites and webpages', query: 'website webpage url online retrieved access date no date organization author' },
  { id: 'government', title: 'Government and military documents', query: 'government military document directive doctrine instruction memorandum report department defense' },
  { id: 'thesis-dissertation', title: 'Theses and dissertations', query: 'thesis dissertation archive calhoun institutional archive proquest' },
  { id: 'personal-communication', title: 'Personal communication', query: 'personal communication interview email unpublished not retrievable reference entry none' },
  { id: 'figures-tables', title: 'Figures, tables, and equations', query: 'figure table equation adapted from source citation page numbers quoted material' },
];

const FORMAT_DEFINITIONS = {
  apa: {
    label: 'APA',
    pdfs: ['NPS Thesis APA Citations.pdf'],
    variants: ['APA 7th edition'],
  },
  chicago: {
    label: 'Chicago',
    pdfs: ['NPS Thesis Chicago Author-Date Citations.pdf', 'NPS Thesis Chicago Notes and Bibliography Citations.pdf'],
    variants: ['Chicago Author-Date', 'Chicago Notes and Bibliography'],
  },
  ieee: {
    label: 'IEEE',
    pdfs: ['NPS Thesis IEEE Citations.pdf'],
    variants: ['IEEE'],
  },
  informs: {
    label: 'INFORMS',
    pdfs: ['NPS Thesis INFORMS Citations.pdf'],
    variants: ['INFORMS'],
  },
  asme: {
    label: 'ASME',
    pdfs: ['NPS Thesis ASME Citations.pdf'],
    variants: ['ASME'],
  },
  aiaa: {
    label: 'AIAA',
    pdfs: ['NPS Thesis AIAA Citations.pdf'],
    variants: ['AIAA'],
  },
  ams: {
    label: 'AMS',
    pdfs: ['NPS Thesis AMS Citations.pdf', 'NPS Thesis AMS Meteorological Citations.pdf'],
    variants: ['AMS', 'AMS Meteorological'],
  },
};

function compactWhitespace(value) {
  return value.replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeExtractedText(value) {
  const normalizedLines = value
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());

  const lines = [];
  for (const line of normalizedLines) {
    if (!line) {
      if (lines.at(-1) !== '') lines.push('');
      continue;
    }
    lines.push(line);
  }

  return lines.join('\n').trim();
}

function normalizeParagraph(value) {
  return compactWhitespace(value).replace(/\s+/g, ' ').trim();
}

function cleanLine(line) {
  return line.replace(/\s+/g, ' ').trim();
}

function toSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function scoreChunkForQuery(text, query) {
  const haystack = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += 1;
    const matches = haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    score += Math.min(3, matches?.length ?? 0);
  }
  if (text.length >= 220 && text.length <= 1100) score += 2;
  return score;
}

function buildChunks(text, prefix) {
  let rawParagraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => normalizeParagraph(paragraph))
    .filter((paragraph) => paragraph.length >= 80);

  if (rawParagraphs.length <= 1) {
    const lines = text
      .split('\n')
      .map((line) => cleanLine(line))
      .filter(Boolean);

    rawParagraphs = [];
    let buffer = [];
    let bufferLength = 0;
    for (const line of lines) {
      const isHeading = line.length <= 90 && !/[.!?]$/.test(line) && /^[A-Z0-9][A-Za-z0-9 /&:().,'"[\]-]+$/.test(line);
      if (isHeading && buffer.length > 0) {
        rawParagraphs.push(normalizeParagraph(buffer.join(' ')));
        buffer = [line];
        bufferLength = line.length;
        continue;
      }
      if (bufferLength + line.length > 420 && buffer.length > 0) {
        rawParagraphs.push(normalizeParagraph(buffer.join(' ')));
        buffer = [line];
        bufferLength = line.length;
        continue;
      }
      buffer.push(line);
      bufferLength += line.length + 1;
    }
    if (buffer.length > 0) {
      rawParagraphs.push(normalizeParagraph(buffer.join(' ')));
    }
    rawParagraphs = rawParagraphs.filter((paragraph) => paragraph.length >= 80);
  }

  const chunks = [];
  let buffer = [];
  let bufferLength = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const chunkText = buffer.join('\n\n').trim();
    if (chunkText.length >= 120) {
      chunks.push({
        id: `${prefix}-${String(chunks.length + 1).padStart(3, '0')}`,
        text: chunkText,
      });
    }
    buffer = [];
    bufferLength = 0;
  };

  for (const paragraph of rawParagraphs) {
    if (bufferLength + paragraph.length > 950 && bufferLength >= 280) {
      flushBuffer();
    }
    buffer.push(paragraph);
    bufferLength += paragraph.length;
  }
  flushBuffer();

  if (chunks.length === 0 && text.trim()) {
    chunks.push({
      id: `${prefix}-001`,
      text: normalizeParagraph(text).slice(0, 1100),
    });
  }

  return chunks;
}

function pickSummary(chunks) {
  const preferred = chunks.find((chunk) => chunk.text.length >= 240 && chunk.text.length <= 900) ?? chunks[0];
  return preferred?.text ?? '';
}

function pickKeySections(chunks) {
  return DEFAULT_SECTION_QUERIES.map((section) => {
    const best = chunks
      .map((chunk) => ({ chunk, score: scoreChunkForQuery(chunk.text, section.query) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)[0];

    if (!best) return null;
    return {
      id: section.id,
      title: section.title,
      snippet: best.chunk.text,
      score: best.score,
    };
  }).filter(Boolean);
}

async function loadOcrModules() {
  const pdfjs = await import(path.join(tempToolRoot, 'pdfjs-dist/legacy/build/pdf.mjs'));
  const { createCanvas } = await import(path.join(tempToolRoot, '@napi-rs/canvas/index.js'));
  const tesseractModule = await import(path.join(tempToolRoot, 'tesseract.js/src/index.js'));
  return { pdfjs, createCanvas, createWorker: tesseractModule.createWorker };
}

async function extractPdfText(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const parsed = await pdfParse(fileBuffer);
  const normalized = normalizeExtractedText(parsed.text ?? '');
  if (normalized.length >= 200) {
    return {
      pageCount: parsed.numpages ?? 0,
      extractionMethod: 'pdf-text',
      text: normalized,
    };
  }

  const { pdfjs, createCanvas, createWorker } = await loadOcrModules();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const worker = await createWorker('eng');
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const result = await worker.recognize(canvas.toBuffer('image/png'));
    pageTexts.push(normalizeExtractedText(result.data.text ?? ''));
  }

  await worker.terminate();
  return {
    pageCount: document.numPages,
    extractionMethod: 'ocr',
    text: normalizeExtractedText(pageTexts.join('\n\n')),
  };
}

async function main() {
  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(path.dirname(generatedTsPath), { recursive: true });

  const pdfNames = (await fs.readdir(sourceDir)).filter((name) => name.endsWith('.pdf')).sort();
  const extractedByPdf = {};

  for (const pdfName of pdfNames) {
    const filePath = path.join(sourceDir, pdfName);
    const extracted = await extractPdfText(filePath);
    const baseName = pdfName.replace(/\.pdf$/i, '');
    await fs.writeFile(path.join(extractedDir, `${baseName}.txt`), `${extracted.text}\n`, 'utf8');
    extractedByPdf[pdfName] = {
      ...extracted,
      title: baseName,
      relativePath: path.relative(repoRoot, filePath),
      textPath: path.relative(repoRoot, path.join(extractedDir, `${baseName}.txt`)),
    };
    console.log(`processed ${pdfName} (${extracted.extractionMethod}, ${extracted.pageCount} pages)`);
  }

  const corpus = {};
  for (const [format, definition] of Object.entries(FORMAT_DEFINITIONS)) {
    const guides = definition.pdfs.map((pdfName) => {
      const extracted = extractedByPdf[pdfName];
      const chunks = buildChunks(extracted.text, toSlug(pdfName));
      return {
        id: toSlug(pdfName),
        title: extracted.title,
        fileName: pdfName,
        relativePath: extracted.relativePath,
        extractedTextPath: extracted.textPath,
        pageCount: extracted.pageCount,
        extractionMethod: extracted.extractionMethod,
        summary: pickSummary(chunks),
        keySections: pickKeySections(chunks),
        chunks,
      };
    });

    const mergedChunks = guides.flatMap((guide) =>
      guide.chunks.map((chunk) => ({
        ...chunk,
        guideTitle: guide.title,
      })),
    );

    corpus[format] = {
      format,
      label: definition.label,
      variants: definition.variants,
      guides,
      summary: guides.map((guide) => `${guide.title}: ${guide.summary}`).join('\n\n').trim(),
      keySections: pickKeySections(mergedChunks.map((chunk) => ({ id: chunk.id, text: `[${chunk.guideTitle}] ${chunk.text}` }))),
      searchableChunks: mergedChunks.map((chunk) => ({
        id: chunk.id,
        guideTitle: chunk.guideTitle,
        text: chunk.text,
      })),
    };
  }

  await fs.writeFile(corpusJsonPath, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');

  const generatedTs = `export const CITATION_REFERENCE_LIBRARY = ${JSON.stringify(corpus, null, 2)} as const;\n`;
  await fs.writeFile(generatedTsPath, generatedTs, 'utf8');
}

await main();
