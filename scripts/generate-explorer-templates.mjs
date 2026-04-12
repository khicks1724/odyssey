import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesRoot = path.join(repoRoot, 'templates');
const outputPath = path.join(repoRoot, 'client', 'src', 'generated', 'explorer-templates.ts');

const TEMPLATE_METADATA = {
  'NPS LaTex Template V3_2': {
    id: 'nps-latex-template-v3-2',
    label: 'NPS LaTex Template v3_2',
    folderName: 'NPS LaTex Template v3_2',
  },
};

const TEXT_FILE_EXTENSIONS = new Set([
  'bib', 'bst', 'c', 'cc', 'cls', 'cpp', 'css', 'csv', 'h', 'hpp', 'html', 'ini', 'java',
  'js', 'json', 'md', 'py', 'r', 'rb', 'rs', 'sh', 'sql', 'sty', 'tex', 'toml', 'ts', 'tsx',
  'txt', 'xml', 'yaml', 'yml',
]);

const MIME_TYPE_BY_EXTENSION = {
  bib: 'application/x-bibtex',
  bst: 'text/plain',
  cls: 'text/plain',
  css: 'text/css',
  csv: 'text/csv',
  gif: 'image/gif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  sql: 'text/plain',
  svg: 'image/svg+xml',
  sty: 'text/plain',
  tex: 'application/x-tex',
  toml: 'text/plain',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  txt: 'text/plain',
  webp: 'image/webp',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function getFileExtension(name) {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

function inferMimeType(fileName) {
  return MIME_TYPE_BY_EXTENSION[getFileExtension(fileName)] ?? null;
}

function isLikelyUtf8Text(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length === 0) return true;

  let suspiciousByteCount = 0;
  for (const value of sample) {
    if (value === 0) return false;
    const isControlCharacter = value < 32 && value !== 9 && value !== 10 && value !== 13;
    if (isControlCharacter) suspiciousByteCount += 1;
  }

  return suspiciousByteCount / sample.length < 0.02;
}

function isTextLikeFile(relativePath, mimeType, buffer) {
  if (mimeType?.startsWith('text/')) return true;
  if (mimeType && /(json|xml|yaml|javascript|typescript|x-tex|markdown|svg)/.test(mimeType)) return true;
  if (TEXT_FILE_EXTENSIONS.has(getFileExtension(relativePath))) return true;
  return isLikelyUtf8Text(buffer);
}

function slugifyTemplateId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function collectFiles(directoryPath, prefix = '') {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

  const files = [];
  for (const entry of entries) {
    const nextAbsolutePath = path.join(directoryPath, entry.name);
    const nextRelativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(nextAbsolutePath, nextRelativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(nextRelativePath);
    }
  }
  return files;
}

async function buildTemplateDefinition(templateDirectoryName) {
  const templateDirectoryPath = path.join(templatesRoot, templateDirectoryName);
  const metadata = TEMPLATE_METADATA[templateDirectoryName] ?? {
    id: slugifyTemplateId(templateDirectoryName),
    label: templateDirectoryName,
    folderName: templateDirectoryName,
  };
  const relativeFilePaths = await collectFiles(templateDirectoryPath);
  const files = [];

  for (const relativeFilePath of relativeFilePaths) {
    const absoluteFilePath = path.join(templateDirectoryPath, relativeFilePath);
    const buffer = await fs.readFile(absoluteFilePath);
    const mimeType = inferMimeType(relativeFilePath);
    const normalizedPath = toPosixPath(relativeFilePath);
    if (isTextLikeFile(normalizedPath, mimeType, buffer)) {
      files.push({
        path: normalizedPath,
        content: buffer.toString('utf8'),
        encoding: 'utf-8',
        mimeType,
      });
      continue;
    }
    files.push({
      path: normalizedPath,
      content: buffer.toString('base64'),
      encoding: 'base64',
      mimeType,
    });
  }

  return {
    ...metadata,
    files,
  };
}

async function main() {
  const templateEntries = await fs.readdir(templatesRoot, { withFileTypes: true });
  const templateDirectoryNames = templateEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

  const definitions = [];
  for (const templateDirectoryName of templateDirectoryNames) {
    definitions.push(await buildTemplateDefinition(templateDirectoryName));
  }

  const output = `export interface ExplorerTemplateDefinition {
  id: string;
  label: string;
  folderName: string;
  files: Array<{
    path: string;
    content: string;
    encoding?: 'utf-8' | 'base64';
    mimeType?: string | null;
  }>;
}

export const EXPLORER_TEMPLATE_DEFINITIONS: ExplorerTemplateDefinition[] = ${JSON.stringify(definitions, null, 2)};
`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, 'utf8');
}

await main();
