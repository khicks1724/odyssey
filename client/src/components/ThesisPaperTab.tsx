import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';
import { CheckCircle2, ChevronDown, ChevronUp, Expand, FileText, GripVertical, Leaf, Loader2, Minimize2, Minus, Plus, Search, Settings2, Sparkles, X } from 'lucide-react';
import {
  DEFAULT_THESIS_EXAMPLE_DRAFT,
  THESIS_PAPER_STATE_EVENT,
  THESIS_PAPER_SNAPSHOT_STORAGE_KEY,
  THESIS_PAPER_THEME_STORAGE_KEY,
  applyRemoteThesisDocument,
  createThesisPaperSnapshot,
  fetchThesisDocument,
  fetchThesisRenderPreview,
  getThesisWorkspaceActiveFile,
  getThesisWorkspaceFromSnapshot,
  readStoredThesisPaperSnapshot,
  saveThesisDocument,
  writeStoredThesisPaperSnapshot,
  type ThesisRenderDiagnostic,
  type ThesisPaperSnapshot,
  type ThesisPaperEditorState,
  type ThesisRemoteSaveState,
  type ThesisWorkspaceFile,
  type ThesisWorkspace,
} from '../lib/thesis-paper';
import { parseSourceVenueMetadata, type SourceVenueKind } from '../lib/bibliography-metadata';
import { pushUndoAction } from '../lib/undo-manager';
import ThesisFileExplorer from './ThesisFileExplorer';
import type { BibliographyFormat, SourceLibraryItem } from '../pages/ThesisPage';

const DEFAULT_PREVIEW_WIDTH_PERCENT = 46;
const MIN_PREVIEW_WIDTH_PERCENT = 26;
const MAX_PREVIEW_WIDTH_PERCENT = 74;
const DEFAULT_EXPLORER_WIDTH_PX = 296;
const MIN_EXPLORER_WIDTH_PX = 220;
const MAX_EXPLORER_WIDTH_PX = 520;
const THESIS_EXPLORER_COLLAPSED_STORAGE_KEY = 'odyssey-thesis-explorer-collapsed';
const THESIS_OVERLEAF_PREFERENCES_STORAGE_KEY = 'odyssey-thesis-overleaf-preferences';
const OVERLEAF_IMPORT_URL = 'https://www.overleaf.com/docs';

const DEFAULT_LATEX_TEMPLATE = DEFAULT_THESIS_EXAMPLE_DRAFT;

const editorThemes = [
  { id: 'odyssey-latex-white', label: 'Odyssey White' },
  { id: 'odyssey-latex-light', label: 'Odyssey Light' },
  { id: 'odyssey-latex-slate', label: 'Odyssey Slate' },
  { id: 'odyssey-latex-dark', label: 'Odyssey Dark' },
  { id: 'odyssey-latex-contrast', label: 'High Contrast' },
] as const;

type EditorThemeId = (typeof editorThemes)[number]['id'];
type ThesisOverleafEngine = 'auto' | 'latex_dvipdf' | 'pdflatex' | 'xelatex' | 'lualatex';
type ThesisOverleafEditorMode = 'source' | 'visual';
type ThesisPaneLayout = 'preview-left' | 'editor-left';
type ToolbarTooltipTone = 'default' | 'success';
type PreviewDisplayMode = 'pdf' | 'text' | 'image' | 'binary' | 'error';
type InsertSourceTargetRange = {
  filePath: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

const overleafEngineOptions: Array<{ value: ThesisOverleafEngine; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'xelatex', label: 'XeLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' },
  { value: 'latex_dvipdf', label: 'LaTeX+DVI' },
];

const overleafEditorModeOptions: Array<{ value: ThesisOverleafEditorMode; label: string }> = [
  { value: 'source', label: 'Source' },
  { value: 'visual', label: 'Visual' },
];

const thesisPaneLayoutOptions: Array<{ value: ThesisPaneLayout; label: string }> = [
  { value: 'preview-left', label: 'Preview left' },
  { value: 'editor-left', label: 'Editor left' },
];

const PREVIEW_ZOOM_OPTIONS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200] as const;
const DEFAULT_PREVIEW_ZOOM = 67;
const PREVIEW_TEXT_SIZE_OPTIONS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20] as const;
const DEFAULT_PREVIEW_TEXT_SIZE = 10;
const AUTOFIX_EDITOR_DECORATION_CSS = `
.monaco-editor .odyssey-autofix-line {
  background: rgba(34, 197, 94, 0.12);
}

.monaco-editor .odyssey-autofix-gutter {
  border-left: 3px solid rgba(34, 197, 94, 0.92);
  margin-left: 4px;
}
`;

interface LatexPreviewDiagnostic extends ThesisRenderDiagnostic {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface LatexPreviewErrorDetails {
  summary: string;
  details: string[];
  diagnostics: LatexPreviewDiagnostic[];
}

interface LatexAutofixChange {
  startLineNumber: number;
  endLineNumber: number;
  description: string;
}

interface LatexAutofixResult {
  nextSource: string;
  summary: string;
  changes: LatexAutofixChange[];
}

interface WorkspaceLatexAutofixResult extends LatexAutofixResult {
  filePath: string;
}

interface ThesisPaperTabProps {
  sourceLibrary: SourceLibraryItem[];
  bibliographyFormat: BibliographyFormat;
}

type InsertableSourceLibraryItem = Pick<
  SourceLibraryItem,
  | 'id'
  | 'citeKey'
  | 'title'
  | 'type'
  | 'sourceKind'
  | 'credit'
  | 'venue'
  | 'year'
  | 'locator'
  | 'citation'
  | 'abstract'
  | 'notes'
  | 'tags'
  | 'addedOn'
>;

const DEFAULT_EDITOR_THEME_ID: EditorThemeId = 'odyssey-latex-white';
function normalizeEditorThemeId(themeId: string | null | undefined): EditorThemeId {
  if (themeId === 'odyssey-latex-night') return 'odyssey-latex-dark';
  if (editorThemes.some((theme) => theme.id === themeId)) return themeId as EditorThemeId;
  return DEFAULT_EDITOR_THEME_ID;
}

function looksLikeLatexRoot(content: string) {
  return /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(content);
}

function resolveOverleafMainDocument(workspace: ThesisWorkspace, activeFilePath: string | null) {
  const latexFiles = workspace.files.filter((file) => file.path.toLowerCase().endsWith('.tex'));
  if (latexFiles.length === 0) return null;

  const activeLatexFile = activeFilePath
    ? latexFiles.find((file) => file.path === activeFilePath) ?? null
    : null;
  if (activeLatexFile && looksLikeLatexRoot(activeLatexFile.content)) {
    return activeLatexFile.path;
  }

  const namedMainFile = latexFiles.find((file) => /(?:^|\/)main\.tex$/i.test(file.path)) ?? null;
  if (namedMainFile && looksLikeLatexRoot(namedMainFile.content)) {
    return namedMainFile.path;
  }

  const detectedRoot = latexFiles.find((file) => looksLikeLatexRoot(file.content)) ?? null;
  if (detectedRoot) {
    return detectedRoot.path;
  }

  return activeLatexFile?.path ?? latexFiles[0]?.path ?? null;
}

function readStoredOverleafPreferences() {
  const fallback = {
    engine: 'auto' as ThesisOverleafEngine,
    editorMode: 'source' as ThesisOverleafEditorMode,
    paneLayout: 'preview-left' as ThesisPaneLayout,
  };

  try {
    const rawValue = window.localStorage.getItem(THESIS_OVERLEAF_PREFERENCES_STORAGE_KEY);
    if (!rawValue) return fallback;
    const parsed = JSON.parse(rawValue) as Partial<{
      engine: ThesisOverleafEngine;
      editorMode: ThesisOverleafEditorMode;
      paneLayout: ThesisPaneLayout;
    }>;
    return {
      engine: overleafEngineOptions.some((option) => option.value === parsed.engine) ? parsed.engine ?? fallback.engine : fallback.engine,
      editorMode: overleafEditorModeOptions.some((option) => option.value === parsed.editorMode) ? parsed.editorMode ?? fallback.editorMode : fallback.editorMode,
      paneLayout: thesisPaneLayoutOptions.some((option) => option.value === parsed.paneLayout) ? parsed.paneLayout ?? fallback.paneLayout : fallback.paneLayout,
    };
  } catch {
    return fallback;
  }
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function submitOverleafImportForm(fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = OVERLEAF_IMPORT_URL;
  form.target = '_blank';
  form.style.display = 'none';

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => form.remove(), 0);
}

const LATEX_PREVIEW_CSS = `
html {
  background: #ffffff;
}

body {
  margin: 0;
  padding: 32px 20px 56px;
  box-sizing: border-box;
  background: #ffffff;
  color: #111111;
  font-family: "Times New Roman", Times, serif;
}

.page {
  max-width: 8.5in;
  margin: 0 auto;
  padding: clamp(24px, 3vw, 44px);
  background: #ffffff;
  box-shadow:
    0 10px 24px rgba(15, 23, 42, 0.08),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.body {
  min-width: 0;
}

h1, h2, h3, h4, p, li {
  color: #111111;
  font-family: "Times New Roman", Times, serif;
}

a {
  color: #0f4f8a;
}

pre, code {
  font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace !important;
}

.code-frame {
  overflow: auto;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: #fbfbfc;
}

.code-frame pre {
  margin: 0;
  padding: 0;
  white-space: pre;
}

.code-frame code {
  display: block;
  padding: 18px 20px;
  color: #1f2328;
}

.code-frame .token.comment,
.code-frame .token.prolog,
.code-frame .token.doctype,
.code-frame .token.cdata {
  color: #7a7f85;
  font-style: italic;
}

.code-frame .token.punctuation,
.code-frame .token.operator {
  color: #4b5563;
}

.code-frame .token.keyword,
.code-frame .token.atrule,
.code-frame .token.selector,
.code-frame .token.important {
  color: #005fb8;
}

.code-frame .token.function,
.code-frame .token.class-name,
.code-frame .token.method {
  color: #795e26;
}

.code-frame .token.string,
.code-frame .token.char,
.code-frame .token.attr-value,
.code-frame .token.regex {
  color: #a31515;
}

.code-frame .token.number,
.code-frame .token.boolean,
.code-frame .token.constant,
.code-frame .token.symbol {
  color: #0b8a8f;
}

.code-frame .token.variable,
.code-frame .token.parameter,
.code-frame .token.property,
.code-frame .token.attr-name,
.code-frame .token.tag {
  color: #1f2328;
}

.code-frame .token.builtin,
.code-frame .token.namespace {
  color: #6f42c1;
}
`;

function buildPreviewDocument(bodyHtml: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${LATEX_PREVIEW_CSS}</style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPrismLanguage(language: string) {
  if (language === 'html' || language === 'xml') return 'markup';
  if (language === 'shell') return 'bash';
  if (language === 'plaintext') return 'plain';
  return language;
}

function isCodePreviewLanguage(language: string) {
  return !['plaintext', 'markdown', 'latex'].includes(language);
}

function buildPlainTextPreviewDocument(content: string, _path: string | null, pointSize: number) {
  const escaped = escapeHtml(content);
  return buildPreviewDocument(`
    <div class="page">
      <div class="body">
        <pre style="white-space: pre-wrap; word-break: break-word; font-size: ${pointSize}pt; line-height: 1.45; font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;">${escaped}</pre>
      </div>
    </div>
  `);
}

function buildCodePreviewDocument(content: string, _path: string | null, pointSize: number, language: string) {
  const prismLanguage = getPrismLanguage(language);
  const grammar = Prism.languages[prismLanguage];
  const highlighted = grammar
    ? Prism.highlight(content, grammar, prismLanguage)
    : escapeHtml(content);

  return buildPreviewDocument(`
    <div class="page">
      <div class="body">
        <div class="code-frame">
          <pre style="font-size: ${pointSize}pt; line-height: 1.5;"><code class="language-${escapeHtml(prismLanguage)}">${highlighted}</code></pre>
        </div>
      </div>
    </div>
  `);
}

function buildLatexErrorPreviewDocument(summary: string, details: string[]) {
  const escapedSummary = escapeHtml(summary);
  const listItems = details
    .map((detail) => `<li>${escapeHtml(detail)}</li>`)
    .join('');

  return buildPreviewDocument(`
    <div class="page">
      <div class="body">
        <h2>Preview needs LaTeX cleanup</h2>
        <p>${escapedSummary}</p>
        ${listItems ? `<ul>${listItems}</ul>` : ''}
      </div>
    </div>
  `);
}

function getFileLanguage(path: string | null) {
  if (!path) return 'plaintext';
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'tex' || extension === 'sty' || extension === 'cls' || extension === 'bib' || extension === 'bst') return 'latex';
  if (extension === 'md') return 'markdown';
  if (extension === 'json') return 'json';
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  if (extension === 'py') return 'python';
  if (extension === 'sh') return 'shell';
  if (extension === 'js') return 'javascript';
  if (extension === 'ts') return 'typescript';
  if (extension === 'tsx') return 'typescript';
  if (extension === 'html') return 'html';
  if (extension === 'xml') return 'xml';
  if (extension === 'css') return 'css';
  if (extension === 'sql') return 'sql';
  return 'plaintext';
}

function getWorkspaceFileEncoding(file: ThesisWorkspaceFile | null | undefined) {
  return file?.encoding === 'base64' ? 'base64' : 'utf-8';
}

function getWorkspaceFileMimeType(file: ThesisWorkspaceFile | null | undefined) {
  return file?.mimeType?.trim().toLowerCase() || null;
}

function isBinaryWorkspaceFile(file: ThesisWorkspaceFile | null | undefined) {
  return getWorkspaceFileEncoding(file) === 'base64';
}

function isImageWorkspaceFile(file: ThesisWorkspaceFile | null | undefined) {
  const mimeType = getWorkspaceFileMimeType(file);
  if (mimeType?.startsWith('image/')) return true;
  const path = file?.path.toLowerCase() ?? '';
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
}

function isPdfWorkspaceFile(file: ThesisWorkspaceFile | null | undefined) {
  const mimeType = getWorkspaceFileMimeType(file);
  if (mimeType === 'application/pdf') return true;
  return /\.pdf$/i.test(file?.path ?? '');
}

function base64ToUint8Array(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getWorkspaceFileBytes(file: ThesisWorkspaceFile) {
  if (getWorkspaceFileEncoding(file) === 'base64') {
    return base64ToUint8Array(file.content);
  }
  return new TextEncoder().encode(file.content);
}

function createWorkspaceFileObjectUrl(file: ThesisWorkspaceFile) {
  const mimeType = getWorkspaceFileMimeType(file) ?? 'application/octet-stream';
  return window.URL.createObjectURL(new Blob([getWorkspaceFileBytes(file)], { type: mimeType }));
}

function addWorkspaceFileToZip(
  zip: {
    file: (path: string, data: string | Uint8Array, options?: { base64?: boolean; binary?: boolean }) => void;
  },
  file: ThesisWorkspaceFile,
) {
  if (getWorkspaceFileEncoding(file) === 'base64') {
    zip.file(file.path, file.content, { base64: true, binary: true });
    return;
  }
  zip.file(file.path, file.content);
}

function buildImagePreviewDocument(path: string | null, imageUrl: string) {
  const escapedPath = escapeHtml(path ?? 'Document image');
  return buildPreviewDocument(`
    <div class="page">
      <div class="body">
        <div style="display:flex;justify-content:center;padding-top:16px;">
          <img src="${imageUrl}" alt="${escapedPath}" style="max-width:100%;height:auto;border:1px solid rgba(15,23,42,0.12);box-shadow:0 10px 24px rgba(15,23,42,0.08);" />
        </div>
      </div>
    </div>
  `);
}

function buildBinaryPreviewDocument(file: ThesisWorkspaceFile) {
  const mimeType = escapeHtml(getWorkspaceFileMimeType(file) ?? 'application/octet-stream');
  const byteCount = getWorkspaceFileBytes(file).byteLength.toLocaleString();
  return buildPreviewDocument(`
    <div class="page">
      <div class="body">
        <p>This file is stored in the thesis workspace, but Odyssey cannot render an inline preview for it yet.</p>
        <ul>
          <li>MIME type: ${mimeType}</li>
          <li>Size: ${byteCount} bytes</li>
        </ul>
      </div>
    </div>
  `);
}

function buildReadOnlyBinaryEditorText(file: ThesisWorkspaceFile) {
  const mimeType = getWorkspaceFileMimeType(file) ?? 'application/octet-stream';
  const byteCount = getWorkspaceFileBytes(file).byteLength.toLocaleString();
  return [
    `${file.path}`,
    '',
    'This file is binary and opens read-only in the source editor.',
    `MIME type: ${mimeType}`,
    `Size: ${byteCount} bytes`,
    '',
    'Use the preview pane to inspect supported formats such as images and PDFs.',
  ].join('\n');
}

function isBibFilePath(path: string | null) {
  return /\.bib$/i.test(path ?? '');
}

function isTexFilePath(path: string | null) {
  return /\.tex$/i.test(path ?? '');
}

function normalizeBibtexText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeBibtexFieldValue(value: string) {
  return normalizeBibtexText(value)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%&_#$])/g, '\\$1');
}

function formatBibtexDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function looksLikeOrganization(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/[A-Z]{2,}/.test(trimmed) && !/[a-z]/.test(trimmed)) return true;
  return /\b(agency|department|office|committee|commission|command|center|centre|university|college|school|laboratory|lab|institute|administration|association|society|bureau|ministry|corps|navy|army|air force|marine|marines|government|council|press|publisher|organization|division|company|corporation|corp|inc|incorporated|llc|ltd|limited|plc|gmbh|group|holdings|systems|technologies|industries|international)\b/i.test(trimmed);
}

function normalizeBibtexPersonName(value: string) {
  return normalizeBibtexText(value)
    .replace(/\\&/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/^[,;]+|[,;]+$/g, '')
    .trim();
}

function normalizeBibtexDisplayName(value: string) {
  const normalized = normalizeBibtexPersonName(value);
  const parts = normalized.split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 2) {
    return normalizeBibtexText(`${parts[1]} ${parts[0]}`);
  }
  return normalized;
}

function countBibtexNameWords(value: string) {
  return normalizeBibtexPersonName(value).split(/\s+/).filter(Boolean).length;
}

function isLikelySurnameFirstBibtexSequence(parts: string[]) {
  if (parts.length < 4 || parts.length % 2 !== 0) return false;
  const familyParts = parts.filter((_, index) => index % 2 === 0);
  const givenParts = parts.filter((_, index) => index % 2 === 1);
  const mostlyShortFamilyNames = familyParts.filter((part) => countBibtexNameWords(part) <= 2).length >= Math.ceil(familyParts.length * 0.8);
  const mostlyShortGivenNames = givenParts.filter((part) => countBibtexNameWords(part) <= 3).length >= Math.ceil(givenParts.length * 0.8);
  const manyFullNamesAlreadyPresent = parts.filter((part) => countBibtexNameWords(part) >= 2).length > Math.floor(parts.length / 2);
  return mostlyShortFamilyNames && mostlyShortGivenNames && !manyFullNamesAlreadyPresent;
}

function extractBibtexPeople(value: string) {
  const normalized = normalizeBibtexPersonName(value);
  if (!normalized) return [];

  const semicolonParts = normalized
    .split(/\s*;\s*|\s*\n+\s*/)
    .map((part) => normalizeBibtexDisplayName(part))
    .filter(Boolean);
  if (semicolonParts.length > 1) return semicolonParts;

  const commaCandidate = normalized
    .replace(/\s*,?\s*(?:and|&)\s+/gi, ', ')
    .replace(/\s*,\s*,+/g, ', ');
  const commaParts = commaCandidate
    .split(/\s*,\s*/)
    .map((part) => normalizeBibtexPersonName(part))
    .filter(Boolean);
  if (commaParts.length > 1 && commaParts.every((part) => part.split(/\s+/).filter(Boolean).length >= 2)) {
    return commaParts.map((part) => normalizeBibtexDisplayName(part));
  }
  if (isLikelySurnameFirstBibtexSequence(commaParts)) {
    const names: string[] = [];
    for (let index = 0; index < commaParts.length; index += 2) {
      const family = commaParts[index];
      const given = commaParts[index + 1];
      if (!family || !given) continue;
      names.push(normalizeBibtexText(`${given} ${family}`));
    }
    if (names.length > 1) return names;
  }

  const conjunctionParts = normalized
    .split(/\s+(?:and|&)\s+/i)
    .map((part) => normalizeBibtexDisplayName(part))
    .filter(Boolean);
  if (conjunctionParts.length > 1) return conjunctionParts;

  return [normalizeBibtexDisplayName(normalized)];
}

function formatBibtexPersonList(value: string) {
  const people = [...new Set(extractBibtexPeople(value))];
  if (people.length === 0) return '';
  return people.map((person) => escapeBibtexFieldValue(person)).join(' and ');
}

function formatBibtexAuthorValue(value: string) {
  const normalized = normalizeBibtexText(value);
  if (!normalized) return '';
  if (looksLikeOrganization(normalized)) {
    return `{{${escapeBibtexFieldValue(normalized)}}}`;
  }
  return formatBibtexPersonList(normalized);
}

function cleanBibtexTitle(value: string) {
  return normalizeBibtexText(value).replace(/\.\s*$/, '');
}

function slugBibtexKeyPart(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'source';
}

function getBibtexAuthorKeyPart(source: InsertableSourceLibraryItem) {
  const credit = normalizeBibtexText(source.credit);
  if (!credit) return '';
  if (looksLikeOrganization(credit)) return slugBibtexKeyPart(credit.split(/\s+/)[0] ?? credit);
  const firstPerson = extractBibtexPeople(credit)[0] ?? credit;
  const words = firstPerson.split(/\s+/).filter(Boolean);
  return slugBibtexKeyPart(words[words.length - 1] ?? credit);
}

function getBibtexTitleKeyPart(source: InsertableSourceLibraryItem) {
  const words = normalizeBibtexText(source.title)
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ''))
    .filter((word) => word.length >= 3);
  return slugBibtexKeyPart(words[0] ?? source.title);
}

function buildBibtexCitationKey(source: InsertableSourceLibraryItem, usedKeys: Set<string>) {
  if (source.citeKey.trim()) {
    const storedKey = source.citeKey.trim().replace(/\s+/g, '_');
    usedKeys.add(storedKey);
    return storedKey;
  }
  const authorPart = getBibtexAuthorKeyPart(source);
  const yearMatch = source.year.match(/\b\d{4}\b/);
  const yearPart = yearMatch ? yearMatch[0] : 'nd';
  const titlePart = getBibtexTitleKeyPart(source);
  const baseKey = [authorPart, yearPart, titlePart].filter(Boolean).join('_') || `source_${yearPart}`;
  let candidate = baseKey;
  let suffix = 2;
  while (usedKeys.has(candidate)) {
    candidate = `${baseKey}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(candidate);
  return candidate;
}

function inferThesisBibtexEntryType(source: InsertableSourceLibraryItem) {
  const combined = `${source.title} ${source.venue} ${source.notes}`.toLowerCase();
  if (/\b(ph\.?\s*d|doctor(?:al|ate)?|dissertation)\b/.test(combined)) {
    return 'phdthesis';
  }
  if (/\b(m\.?\s*s|m\.?\s*a|master(?:'s)?|thesis)\b/.test(combined)) {
    return 'mastersthesis';
  }
  return 'mastersthesis';
}

function inferBibtexEntryType(source: InsertableSourceLibraryItem) {
  switch (source.sourceKind) {
    case 'journal_article':
      return 'article';
    case 'conference_paper':
      return 'inproceedings';
    case 'book':
      return 'book';
    case 'book_chapter':
      return 'incollection';
    case 'government_report':
      return 'techreport';
    case 'thesis_dissertation':
      return inferThesisBibtexEntryType(source);
    case 'dataset':
      return 'misc';
    case 'interview_notes':
      return 'unpublished';
    case 'archive_record':
      return 'misc';
    case 'web_article':
      return 'misc';
    case 'documentation':
      return 'manual';
    default:
      if (source.type === 'book') return 'book';
      if (source.type === 'report') return 'techreport';
      if (source.type === 'notes') return 'unpublished';
      return source.type === 'paper' ? 'article' : 'misc';
  }
}

function getWebAccessNote(source: InsertableSourceLibraryItem, bibliographyFormat: BibliographyFormat) {
  if (!source.locator.trim() || !['link', 'dataset'].includes(source.type)) return '';
  if (bibliographyFormat === 'ieee' && source.year.trim()) return '';
  const formattedDate = formatBibtexDate(source.addedOn);
  return formattedDate ? `Accessed ${formattedDate}` : '';
}

function cleanVenueTerminalPeriod(value: string) {
  return normalizeBibtexText(value).replace(/\.\s*$/, '');
}

function extractDoiFromLocator(locator: string) {
  const normalized = normalizeBibtexText(locator)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : '';
}

function findReferencesBibFile(workspace: ThesisWorkspace) {
  return workspace.files.find((file) => /(?:^|\/)references\.bib$/i.test(file.path))
    ?? workspace.files.find((file) => /\.bib$/i.test(file.path))
    ?? null;
}

function hasBibtexKey(content: string, citeKey: string) {
  const escapedKey = citeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@\\w+\\s*\\{\\s*${escapedKey}\\s*,`, 'i').test(content);
}

function buildLatexCitationCommand(sourceIds: string[], bibliographyFormat: BibliographyFormat) {
  const citeCommand = bibliographyFormat === 'informs' ? '\\citep' : '\\cite';
  return `${citeCommand}{${sourceIds.join(',')}}`;
}

function hasLatexNoCiteAll(content: string) {
  return /\\nocite\s*(?:\[[^\]]*\]\s*)*\{\s*\*\s*\}/i.test(content);
}

function ensureBibliographyRegistration(content: string, _citeKeys: string[]) {
  if (hasLatexNoCiteAll(content)) return content;

  const nociteCommand = '\\nocite{*}';
  const bibliographyMatch = content.match(/^[ \t]*\\NPSbibliography(?:\[[^\]]*\])?\{[^}]+\}/m);
  if (bibliographyMatch && typeof bibliographyMatch.index === 'number') {
    const insertAt = bibliographyMatch.index;
    const before = content.slice(0, insertAt).replace(/\s*$/, '');
    const after = content.slice(insertAt);
    return `${before}\n${nociteCommand}\n\n${after}`;
  }

  const beginDocumentMatch = content.match(/\\begin\{document\}/);
  if (beginDocumentMatch && typeof beginDocumentMatch.index === 'number') {
    const insertAt = beginDocumentMatch.index + beginDocumentMatch[0].length;
    const before = content.slice(0, insertAt);
    const after = content.slice(insertAt).replace(/^\s*/, '\n');
    return `${before}\n${nociteCommand}\n${after}`;
  }

  const normalized = content.trimEnd();
  return `${normalized}\n\n${nociteCommand}\n`;
}

function buildBibtexFields(source: InsertableSourceLibraryItem, bibliographyFormat: BibliographyFormat) {
  const entryType = inferBibtexEntryType(source);
  const venueMetadata = parseSourceVenueMetadata(source.sourceKind as SourceVenueKind, source.venue);
  const fields: Array<[string, string]> = [];
  const authorValue = formatBibtexAuthorValue(source.credit);
  const titleValue = escapeBibtexFieldValue(cleanBibtexTitle(source.title || 'Untitled source'));
  const venueValue = escapeBibtexFieldValue(cleanVenueTerminalPeriod(source.venue));
  const yearValue = escapeBibtexFieldValue(source.year);
  const doiValue = escapeBibtexFieldValue(extractDoiFromLocator(source.locator));
  const locatorValue = doiValue ? '' : escapeBibtexFieldValue(source.locator);
  const accessNote = getWebAccessNote(source, bibliographyFormat);
  const noteSource = accessNote;
  const noteValue = noteSource ? escapeBibtexFieldValue(noteSource) : '';

  if (authorValue && entryType !== 'manual') {
    fields.push(['author', authorValue]);
  }
  fields.push(['title', titleValue]);

  switch (entryType) {
    case 'article':
      if (venueMetadata.journal) fields.push(['journal', escapeBibtexFieldValue(venueMetadata.journal)]);
      if (venueMetadata.volume) fields.push(['volume', escapeBibtexFieldValue(venueMetadata.volume)]);
      if (venueMetadata.number) fields.push(['number', escapeBibtexFieldValue(venueMetadata.number)]);
      if (venueMetadata.pages) fields.push(['pages', escapeBibtexFieldValue(venueMetadata.pages.replace(/\s*-\s*/g, '--'))]);
      break;
    case 'inproceedings':
      if (venueMetadata.booktitle) fields.push(['booktitle', escapeBibtexFieldValue(venueMetadata.booktitle)]);
      else if (venueValue) fields.push(['booktitle', venueValue]);
      if (venueMetadata.pages) fields.push(['pages', escapeBibtexFieldValue(venueMetadata.pages.replace(/\s*-\s*/g, '--'))]);
      if (venueMetadata.publisher) fields.push(['publisher', escapeBibtexFieldValue(venueMetadata.publisher)]);
      if (venueMetadata.edition) fields.push(['edition', escapeBibtexFieldValue(venueMetadata.edition)]);
      if (venueMetadata.organization) fields.push(['organization', escapeBibtexFieldValue(venueMetadata.organization)]);
      break;
    case 'incollection':
      if (venueMetadata.booktitle) fields.push(['booktitle', escapeBibtexFieldValue(venueMetadata.booktitle)]);
      else if (venueValue) fields.push(['booktitle', venueValue]);
      if (venueMetadata.pages) fields.push(['pages', escapeBibtexFieldValue(venueMetadata.pages.replace(/\s*-\s*/g, '--'))]);
      if (venueMetadata.publisher) fields.push(['publisher', escapeBibtexFieldValue(venueMetadata.publisher)]);
      if (venueMetadata.edition) fields.push(['edition', escapeBibtexFieldValue(venueMetadata.edition)]);
      break;
    case 'book':
      if (venueMetadata.publisher) fields.push(['publisher', escapeBibtexFieldValue(venueMetadata.publisher)]);
      else if (venueValue) fields.push(['publisher', venueValue]);
      if (venueMetadata.edition) fields.push(['edition', escapeBibtexFieldValue(venueMetadata.edition)]);
      break;
    case 'mastersthesis':
    case 'phdthesis':
      if (venueMetadata.school) fields.push(['school', escapeBibtexFieldValue(venueMetadata.school)]);
      else if (venueValue) fields.push(['school', venueValue]);
      break;
    case 'techreport':
      if (venueMetadata.institution) fields.push(['institution', escapeBibtexFieldValue(venueMetadata.institution)]);
      else if (venueValue) fields.push(['institution', venueValue]);
      if (venueMetadata.reportNumber) fields.push(['number', escapeBibtexFieldValue(venueMetadata.reportNumber)]);
      break;
    case 'manual':
      if (authorValue) {
        fields.push(['organization', authorValue.replace(/^\{\{|\}\}$/g, '')]);
      } else if (venueMetadata.organization) {
        fields.push(['organization', escapeBibtexFieldValue(venueMetadata.organization)]);
      } else if (venueValue) {
        fields.push(['organization', venueValue]);
      }
      if (venueMetadata.howpublished) fields.push(['howpublished', escapeBibtexFieldValue(venueMetadata.howpublished)]);
      else if (venueMetadata.reportNumber) fields.push(['howpublished', escapeBibtexFieldValue(venueMetadata.reportNumber)]);
      else if (venueValue) fields.push(['howpublished', venueValue]);
      if (venueMetadata.edition) fields.push(['edition', escapeBibtexFieldValue(venueMetadata.edition)]);
      break;
    case 'misc':
      if (venueMetadata.howpublished) fields.push(['howpublished', escapeBibtexFieldValue(venueMetadata.howpublished)]);
      else if (venueMetadata.organization) fields.push(['howpublished', escapeBibtexFieldValue(venueMetadata.organization)]);
      else if (venueValue) fields.push(['howpublished', venueValue]);
      if (venueMetadata.organization && !fields.some(([field]) => field === 'organization')) {
        fields.push(['organization', escapeBibtexFieldValue(venueMetadata.organization)]);
      }
      if (source.sourceKind === 'dataset') {
        fields.push(['note', escapeBibtexFieldValue(noteSource || 'Dataset')]);
      }
      break;
    case 'unpublished':
      fields.push(['note', escapeBibtexFieldValue(noteSource || 'Unpublished source')]);
      break;
    default:
      break;
  }

  if (yearValue) {
    fields.push(['year', yearValue]);
  }
  if (doiValue) {
    fields.push(['doi', doiValue]);
  }
  if (locatorValue) {
    fields.push(['url', locatorValue]);
  }
  if (noteValue && !fields.some(([field]) => field === 'note')) {
    fields.push(['note', noteValue]);
  }

  return { entryType, fields };
}

function shouldKeepBibtexNoteField(
  source: InsertableSourceLibraryItem,
  bibliographyFormat: BibliographyFormat,
  entryType: string,
) {
  if (entryType === 'unpublished') return true;
  if (source.sourceKind === 'dataset') return true;
  const accessNote = getWebAccessNote(source, bibliographyFormat);
  return Boolean(accessNote);
}

function sanitizeInsertedBibtexEntry(
  entryText: string,
  source: InsertableSourceLibraryItem,
  bibliographyFormat: BibliographyFormat,
) {
  const entryType = inferBibtexEntryType(source);
  const keepNote = shouldKeepBibtexNoteField(source, bibliographyFormat, entryType);
  let nextEntry = entryText;

  if (!keepNote) {
    nextEntry = nextEntry.replace(/\n\s*note\s*=\s*\{[\s\S]*?\},?/gi, '');
  }

  const normalizedAuthorValue = formatBibtexAuthorValue(source.credit);
  if (normalizedAuthorValue) {
    const authorFieldPattern = /\n(\s*)author\s*=\s*\{[\s\S]*?\},?/i;
    if (authorFieldPattern.test(nextEntry)) {
      nextEntry = nextEntry.replace(
        authorFieldPattern,
        (_match, indent: string) => `\n${indent}author = {${normalizedAuthorValue}},`,
      );
    }
  }

  return nextEntry
    .replace(/\n{3,}/g, '\n\n')
    .replace(/,\n(\s*\})/g, '\n$1');
}

function buildBibtexEntry(source: InsertableSourceLibraryItem, bibliographyFormat: BibliographyFormat, usedKeys: Set<string>) {
  const citationKey = buildBibtexCitationKey(source, usedKeys);
  const { entryType, fields } = buildBibtexFields(source, bibliographyFormat);
  const formattedFields = fields
    .filter(([, value]) => value.trim().length > 0)
    .map(([field, value], index, collection) => `  ${field} = {${value}}${index === collection.length - 1 ? '' : ','}`)
    .join('\n');
  const entryText = sanitizeInsertedBibtexEntry(
    `@${entryType}{${citationKey},\n${formattedFields}\n}`,
    source,
    bibliographyFormat,
  );

  return {
    citationKey,
    entryText,
  };
}

function collectExistingBibtexKeys(content: string) {
  const keys = new Set<string>();
  for (const match of content.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) {
    const key = match[1]?.trim();
    if (key) keys.add(key);
  }
  return keys;
}

function replaceBibtexEntry(content: string, citeKey: string, nextEntry: string) {
  const escapedKey = citeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entryPattern = new RegExp(
    String.raw`@\w+\s*\{\s*${escapedKey}\s*,[\s\S]*?(?=^\s*@\w+\s*\{|\s*\Z)`,
    'im',
  );

  if (entryPattern.test(content)) {
    return content.replace(entryPattern, nextEntry);
  }

  const normalized = content.trimEnd();
  return `${normalized}${normalized ? '\n\n' : ''}${nextEntry}\n`;
}

function removeBibtexEntry(content: string, citeKey: string, marker?: string) {
  const escapedKey = citeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entryPattern = new RegExp(
    String.raw`@\w+\s*\{\s*${escapedKey}\s*,[\s\S]*?(?=^\s*@\w+\s*\{|\s*\Z)`,
    'im',
  );

  const match = content.match(entryPattern);
  if (!match || typeof match.index !== 'number') {
    return content;
  }

  const entryText = match[0];
  const replacement = marker && entryText.includes(marker) ? marker : '';
  return `${content.slice(0, match.index)}${replacement}${content.slice(match.index + entryText.length)}`
    .replace(/\n{3,}/g, '\n\n');
}

function insertBibtexEntriesAtMarker(content: string, marker: string, entryText: string) {
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) return content;

  const before = content.slice(0, markerIndex);
  const after = content.slice(markerIndex + marker.length);
  const needsLeadingSpacing = before.trim().length > 0 && !/\n\s*\n\s*$/.test(before);
  const needsTrailingSpacing = after.trim().length > 0 && !/^\s*\n\s*\n/.test(after);
  const insertText = `${needsLeadingSpacing ? '\n\n' : ''}${entryText}${needsTrailingSpacing ? '\n\n' : ''}`;
  return `${before}${insertText}${after}`;
}

type BibtexCitationSuggestion = {
  key: string;
  title: string;
  entryType: string;
  filePath: string;
  authors?: string;
  year?: string;
  venue?: string;
};

function normalizeBibtexDisplayValue(value: string) {
  return value
    .replace(/^\{+|\}+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectBibtexCitationSuggestions(workspace: ThesisWorkspace, sourceLibrary: SourceLibraryItem[]) {
  const suggestions = new Map<string, BibtexCitationSuggestion>();

  for (const file of workspace.files.filter((item) => /\.bib$/i.test(item.path))) {
    const entryMatches = file.content.matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=^\s*@\w+\s*\{|\s*\Z)/gm);
    for (const match of entryMatches) {
      const entryType = match[1]?.trim() || 'misc';
      const key = match[2]?.trim();
      const body = match[3] ?? '';
      if (!key || suggestions.has(key)) continue;

      const titleMatch = body.match(/\btitle\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/i);
      const authorMatch = body.match(/\bauthor\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/i);
      const yearMatch = body.match(/\byear\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/i);
      const venueMatch = body.match(/\b(?:journal|booktitle|publisher|school|institution|howpublished)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/i);
      const title = normalizeBibtexDisplayValue(titleMatch?.[1] ?? '');
      suggestions.set(key, {
        key,
        title: title || key,
        entryType,
        filePath: file.path,
        authors: normalizeBibtexDisplayValue(authorMatch?.[1] ?? ''),
        year: normalizeBibtexDisplayValue(yearMatch?.[1] ?? ''),
        venue: normalizeBibtexDisplayValue(venueMatch?.[1] ?? ''),
      });
    }
  }

  for (const source of sourceLibrary) {
    const key = source.citeKey.trim();
    if (!key || suggestions.has(key)) continue;
    suggestions.set(key, {
      key,
      title: source.title.trim() || key,
      entryType: inferBibtexEntryType(source),
      filePath: findReferencesBibFile(workspace)?.path ?? 'references.bib',
      authors: source.credit.trim(),
      year: source.year.trim(),
      venue: source.venue.trim(),
    });
  }

  return [...suggestions.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function getLatexCitationContext(
  model: MonacoEditor.ITextModel,
  position: { lineNumber: number; column: number },
) {
  const textBeforeCursor = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const match = textBeforeCursor.match(/\\(?:no)?cite[a-zA-Z]*\s*(?:\[[^\]]*\]\s*)*\{([^}]*)$/s);
  if (!match) return null;

  const braceContent = match[1] ?? '';
  const rawSegment = braceContent.split(',').at(-1) ?? '';
  const leadingWhitespace = rawSegment.match(/^\s*/)?.[0] ?? '';
  const query = rawSegment.slice(leadingWhitespace.length);
  const replaceStartColumn = Math.max(1, position.column - query.length);

  return {
    query,
    range: {
      startLineNumber: position.lineNumber,
      startColumn: replaceStartColumn,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    },
  };
}

function getLatexCitationKeyAtPosition(
  model: MonacoEditor.ITextModel,
  position: { lineNumber: number; column: number },
) {
  const lineText = model.getLineContent(position.lineNumber);
  const linePrefix = lineText.slice(0, Math.max(0, position.column - 1));
  const commandStart = linePrefix.lastIndexOf('\\');
  if (commandStart < 0) return null;

  const commandSegment = linePrefix.slice(commandStart);
  const commandMatch = commandSegment.match(/^\\(?:no)?cite[a-zA-Z]*\s*(?:\[[^\]]*\]\s*)*\{([^}]*)$/);
  if (!commandMatch) return null;

  const citeListText = commandMatch[1] ?? '';
  const citeListStartIndex = commandSegment.lastIndexOf('{') + 1;
  const keyStartInLine = commandStart + citeListStartIndex;
  const cursorIndexInLine = Math.max(0, position.column - 1);
  const relativeCursor = cursorIndexInLine - keyStartInLine;
  if (relativeCursor < 0) return null;

  let segmentStart = 0;
  for (let index = 0; index < citeListText.length; index += 1) {
    const char = citeListText[index];
    if (char === ',') {
      if (relativeCursor <= index) {
        const rawKey = citeListText.slice(segmentStart, index);
        const trimmedLeft = rawKey.match(/^\s*/)?.[0].length ?? 0;
        const trimmedRight = rawKey.match(/\s*$/)?.[0].length ?? 0;
        const key = rawKey.trim();
        if (!key) return null;
        return {
          key,
          range: {
            startLineNumber: position.lineNumber,
            startColumn: keyStartInLine + segmentStart + trimmedLeft + 1,
            endLineNumber: position.lineNumber,
            endColumn: keyStartInLine + index - trimmedRight + 1,
          },
        };
      }
      segmentStart = index + 1;
    }
  }

  const rawKey = citeListText.slice(segmentStart);
  const trimmedLeft = rawKey.match(/^\s*/)?.[0].length ?? 0;
  const trimmedRight = rawKey.match(/\s*$/)?.[0].length ?? 0;
  const key = rawKey.trim();
  if (!key) return null;
  const segmentEnd = citeListText.length - trimmedRight;
  if (relativeCursor > segmentEnd) return null;

  return {
    key,
    range: {
      startLineNumber: position.lineNumber,
      startColumn: keyStartInLine + segmentStart + trimmedLeft + 1,
      endLineNumber: position.lineNumber,
      endColumn: keyStartInLine + segmentEnd + 1,
    },
  };
}

function buildCitationHoverMarkdown(item: BibtexCitationSuggestion) {
  const lines = [
    `**${item.key}**`,
    '',
    item.title,
    item.authors ? `Authors: ${item.authors}` : null,
    item.year ? `Year: ${item.year}` : null,
    item.venue ? `Source: ${item.venue}` : null,
    `Type: ${item.entryType}`,
    `File: ${item.filePath}`,
  ].filter(Boolean);

  return lines.join('  \n');
}

function collectLatexCitationHoverDecorations(
  model: MonacoEditor.ITextModel,
  suggestions: BibtexCitationSuggestion[],
  monaco: Monaco,
) {
  const suggestionMap = new Map(suggestions.map((item) => [item.key, item]));
  const decorations: MonacoEditor.IModelDeltaDecoration[] = [];
  const source = model.getValue();
  const commandPattern = /\\(?:no)?cite[a-zA-Z]*\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;

  for (const match of source.matchAll(commandPattern)) {
    const citeList = match[1] ?? '';
    const fullMatch = match[0] ?? '';
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) continue;
    const braceOffset = fullMatch.lastIndexOf('{');
    if (braceOffset < 0) continue;
    const citeListStart = matchIndex + braceOffset + 1;

    let segmentStart = 0;
    for (const segment of citeList.split(',')) {
      const trimmedLeft = segment.match(/^\s*/)?.[0].length ?? 0;
      const trimmedRight = segment.match(/\s*$/)?.[0].length ?? 0;
      const key = segment.trim();
      const entry = suggestionMap.get(key);
      const keyStartOffset = citeListStart + segmentStart + trimmedLeft;
      const keyEndOffset = citeListStart + segmentStart + segment.length - trimmedRight;

      if (entry && keyStartOffset < keyEndOffset) {
        const startPosition = model.getPositionAt(keyStartOffset);
        const endPosition = model.getPositionAt(keyEndOffset);
        decorations.push({
          range: new monaco.Range(
            startPosition.lineNumber,
            startPosition.column,
            endPosition.lineNumber,
            endPosition.column,
          ),
          options: {
            inlineClassName: 'odyssey-citation-hover-target',
            hoverMessage: {
              value: buildCitationHoverMarkdown(entry),
            },
          },
        });
      }

      segmentStart += segment.length + 1;
    }
  }

  return decorations;
}

function buildLineDiagnostic(
  source: string,
  filePath: string | null,
  lineNumber: number,
  message: string,
  severity: 'error' | 'warning',
): LatexPreviewDiagnostic {
  const lines = source.split('\n');
  const safeLineNumber = Math.min(Math.max(lineNumber, 1), Math.max(lines.length, 1));
  const lineText = lines[safeLineNumber - 1] ?? '';
  const firstNonWhitespace = lineText.search(/\S|$/);
  const startColumn = Math.max(1, firstNonWhitespace + 1);
  const endColumn = Math.max(startColumn + 1, lineText.length + 1);

  return {
    filePath,
    lineNumber: safeLineNumber,
    message,
    startLineNumber: safeLineNumber,
    startColumn,
    endLineNumber: safeLineNumber,
    endColumn,
    severity,
  };
}

function mapLatexDiagnostics(source: string, diagnostics: ThesisRenderDiagnostic[], activeFilePath: string | null) {
  return diagnostics
    .filter((diagnostic) => !diagnostic.filePath || !activeFilePath || diagnostic.filePath === activeFilePath)
    .map((diagnostic) => buildLineDiagnostic(
      source,
      diagnostic.filePath,
      diagnostic.lineNumber,
      diagnostic.message,
      diagnostic.severity,
    ));
}

function isBlankOrCommentLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith('%');
}

function isLikelyLatexBodyStart(line: string) {
  return /^\\(?:begin\{[^}]+\}|maketitle|chapter|section|subsection|subsubsection|paragraph|subparagraph|part|frontmatter|mainmatter|backmatter|appendix|tableofcontents|listoffigures|listoftables|printbibliography|bibliography|nocite|input|include)\b/.test(line);
}

function isLikelyLatexPreambleCommand(line: string) {
  return /^\\(?:documentclass|usepackage|title|author|date|thanks|newcommand|renewcommand|providecommand|DeclareMathOperator|DeclareRobustCommand|DeclarePairedDelimiter|newtheorem|theoremstyle|numberwithin|counterwithin|setcounter|setlength|addtolength|geometry|graphicspath|hypersetup|captionsetup|pagestyle|bibliographystyle|makeindex|makeglossaries|onehalfspacing|doublespacing|singlespacing|linespread|input@path|lstset|floatstyle|restylefloat|definecolor)\b/.test(line);
}

function findLatexDocumentBodyInsertionIndex(lines: string[], documentclassIndex: number) {
  for (let index = documentclassIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (isBlankOrCommentLine(lines[index])) continue;
    if (isLikelyLatexBodyStart(trimmed)) return index;
  }

  for (let index = documentclassIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (isBlankOrCommentLine(lines[index])) continue;
    if (!isLikelyLatexPreambleCommand(trimmed)) return index;
  }

  const endDocumentIndex = lines.findIndex((line, index) => index > documentclassIndex && /\\end\{document\}/.test(line));
  return endDocumentIndex >= 0 ? endDocumentIndex : lines.length;
}

function computeLatexAutofix(
  source: string,
  diagnostics: LatexPreviewDiagnostic[],
  renderError: string | null,
): LatexAutofixResult | null {
  if (!source.trim()) return null;

  const issueText = [renderError ?? '', ...diagnostics.map((diagnostic) => diagnostic.message)].join('\n');
  const documentclassMatch = source.match(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/);
  if (!documentclassMatch) return null;

  const nextLines = source.split('\n');
  const changes: LatexAutofixChange[] = [];
  const summaryParts: string[] = [];
  const documentclassLineNumber = source.slice(0, documentclassMatch.index ?? 0).split('\n').length;
  const documentclassIndex = Math.max(0, documentclassLineNumber - 1);

  const hasBeginDocument = nextLines.some((line) => /\\begin\{document\}/.test(line));
  const hasEndDocument = nextLines.some((line) => /\\end\{document\}/.test(line));
  const needsBeginDocument = !hasBeginDocument && /Missing \\begin\{document\}/i.test(issueText);

  if (needsBeginDocument) {
    const movedLineIndexes = nextLines
      .slice(0, documentclassIndex)
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !isBlankOrCommentLine(line))
      .map(({ index }) => index);

    const movedLines = movedLineIndexes.map((index) => nextLines[index]);
    if (movedLineIndexes.length > 0) {
      for (const index of movedLineIndexes) {
        nextLines[index] = '';
      }
      changes.push({
        startLineNumber: movedLineIndexes[0] + 1,
        endLineNumber: movedLineIndexes[movedLineIndexes.length - 1] + 1,
        description: movedLines.length === 1
          ? 'Moved leading content below \\begin{document}.'
          : 'Moved leading content block below \\begin{document}.',
      });
    }

    const insertAt = findLatexDocumentBodyInsertionIndex(nextLines, documentclassIndex);
    const insertedLines = [
      '\\begin{document}',
      ...(movedLines.length > 0 ? ['', ...movedLines, ''] : ['']),
    ];
    nextLines.splice(insertAt, 0, ...insertedLines);
    changes.push({
      startLineNumber: insertAt + 1,
      endLineNumber: insertAt + insertedLines.length,
      description: movedLines.length > 0
        ? 'Inserted \\begin{document} and preserved leading content inside the document body.'
        : 'Inserted \\begin{document}.',
    });
    summaryParts.push('inserted \\begin{document}');
  }

  const nextHasBeginDocument = nextLines.some((line) => /\\begin\{document\}/.test(line));
  const nextHasEndDocument = nextLines.some((line) => /\\end\{document\}/.test(line));
  const needsEndDocument = !hasEndDocument
    && nextHasBeginDocument
    && (
      /no legal \\end found/i.test(issueText)
      || /missing \\end\{document\}/i.test(issueText)
      || /ended by end of file/i.test(issueText)
      || /Emergency stop/i.test(issueText)
    );

  if (!nextHasEndDocument && needsEndDocument) {
    const needsSpacerLine = nextLines.length > 0 && nextLines[nextLines.length - 1].trim().length > 0;
    const insertAt = nextLines.length;
    const appendedLines = needsSpacerLine ? ['', '\\end{document}'] : ['\\end{document}'];
    nextLines.push(...appendedLines);
    changes.push({
      startLineNumber: insertAt + 1,
      endLineNumber: insertAt + appendedLines.length,
      description: 'Inserted \\end{document}.',
    });
    summaryParts.push('inserted \\end{document}');
  }

  const nextSource = nextLines.join('\n');
  if (changes.length === 0 || nextSource === source) return null;

  const summary = summaryParts.length > 0
    ? `Autofix ${summaryParts.join(' and ')}.`
    : 'Autofix applied minimal LaTeX changes.';

  return {
    nextSource,
    summary,
    changes,
  };
}

function computeWorkspaceLatexAutofix(
  workspace: ThesisWorkspace,
  options: {
    activeFilePath: string | null;
    mainDocumentPath: string | null;
    renderDiagnostics: ThesisRenderDiagnostic[];
    renderError: string | null;
  },
): WorkspaceLatexAutofixResult | null {
  const issueText = [options.renderError ?? '', ...options.renderDiagnostics.map((diagnostic) => diagnostic.message)].join('\n');
  if (/can be used only in preamble/i.test(issueText)) {
    const texFiles = workspace.files.filter((file) => /\.tex$/i.test(file.path) && !isBinaryWorkspaceFile(file));
    for (const rootFile of texFiles) {
      const frontMatterInputMatch = rootFile.content.match(/\\input\{([^}]*front-matter[^}]*)\}/);
      if (!frontMatterInputMatch) continue;

      const frontMatterReference = frontMatterInputMatch[1] ?? '';
      const frontMatterFile = resolveWorkspaceInputPath(workspace, rootFile.path, frontMatterReference);
      if (!frontMatterFile || isBinaryWorkspaceFile(frontMatterFile)) continue;
      if (!/\\NPShyperref\b/.test(frontMatterFile.content) || !/\\begin\{document\}/.test(frontMatterFile.content)) continue;

      const rootLines = rootFile.content.split('\n');
      const inputLineIndex = rootLines.findIndex((line) => /\\input\{([^}]*front-matter[^}]*)\}/.test(line));
      const beginLineIndex = rootLines.findIndex((line) => /\\begin\{document\}/.test(line));
      if (inputLineIndex < 0 || beginLineIndex < 0 || beginLineIndex > inputLineIndex) continue;

      const nextLines = [...rootLines];
      nextLines.splice(beginLineIndex, 1);
      return {
        filePath: rootFile.path,
        nextSource: nextLines.join('\n'),
        summary: 'Autofix removed the duplicate \\begin{document} so front-matter can own the preamble boundary.',
        changes: [{
          startLineNumber: beginLineIndex + 1,
          endLineNumber: beginLineIndex + 1,
          description: 'Removed duplicate \\begin{document} before \\input{front-matter}.',
        }],
      };
    }
  }

  const candidatePaths = [
    ...options.renderDiagnostics
      .map((diagnostic) => diagnostic.filePath)
      .filter((filePath): filePath is string => Boolean(filePath && /\.tex$/i.test(filePath))),
    options.mainDocumentPath,
    options.activeFilePath,
    ...workspace.files
      .filter((file) => /\.tex$/i.test(file.path) && looksLikeLatexRoot(file.content))
      .map((file) => file.path),
  ].filter((filePath, index, collection): filePath is string => (
    Boolean(filePath && /\.tex$/i.test(filePath)) && collection.indexOf(filePath) === index
  ));

  for (const filePath of candidatePaths) {
    const file = workspace.files.find((workspaceFile) => workspaceFile.path === filePath);
    if (!file || isBinaryWorkspaceFile(file)) continue;

    const fileDiagnostics = mapLatexDiagnostics(
      file.content,
      options.renderDiagnostics.filter((diagnostic) => !diagnostic.filePath || diagnostic.filePath === filePath),
      filePath,
    );
    const autofix = computeLatexAutofix(file.content, fileDiagnostics, options.renderError);
    if (!autofix) continue;

    return {
      ...autofix,
      filePath,
    };
  }

  return null;
}

function createPdfPreviewUrl(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return window.URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function configureLatexMonaco(monaco: Monaco) {
  const monacoWithFlag = monaco as Monaco & { __odysseyLatexConfigured?: boolean };
  if (monacoWithFlag.__odysseyLatexConfigured) return;

  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === 'latex')) {
    monaco.languages.register({ id: 'latex' });
  }

  monaco.languages.setLanguageConfiguration('latex', {
    comments: { lineComment: '%' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\(?:begin|end)(?=\{)/, 'keyword.environment'],
        [/\\[a-zA-Z@]+(\*?)/, 'keyword.command'],
        [/\\./, 'keyword.command'],
        [/\$\$/, 'delimiter.math'],
        [/\$/, 'delimiter.math'],
        [/[\{\}\[\]\(\)]/, 'delimiter.bracket'],
        [/[&_^~]/, 'operator'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/"[^"]*"/, 'string'],
        [/[,;:.]/, 'delimiter'],
        [/[A-Za-z]+(?:[-'][A-Za-z]+)*/, 'identifier'],
      ],
    },
  });

  monaco.editor.defineTheme('odyssey-latex-white', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7A7F85', fontStyle: 'italic' },
      { token: 'keyword', foreground: '005FB8' },
      { token: 'keyword.command', foreground: '005FB8' },
      { token: 'keyword.environment', foreground: '795E26', fontStyle: 'bold' },
      { token: 'delimiter.math', foreground: 'C02D2E', fontStyle: 'bold' },
      { token: 'delimiter.bracket', foreground: '4B5563' },
      { token: 'delimiter', foreground: '4B5563' },
      { token: 'number', foreground: '0B8A8F' },
      { token: 'string', foreground: 'A31515' },
      { token: 'string.escape', foreground: '0B8A8F' },
      { token: 'operator', foreground: '4B5563' },
      { token: 'type', foreground: '267F99' },
      { token: 'type.identifier', foreground: '267F99' },
      { token: 'class', foreground: '267F99' },
      { token: 'class.identifier', foreground: '267F99' },
      { token: 'function', foreground: '795E26' },
      { token: 'function.identifier', foreground: '795E26' },
      { token: 'constructor', foreground: '795E26' },
      { token: 'tag', foreground: '800000' },
      { token: 'attribute.name', foreground: 'E50000' },
      { token: 'attribute.value', foreground: '0451A5' },
      { token: 'regexp', foreground: '811F3F' },
    ],
    colors: {
      'editor.background': '#F7F7F8',
      'editor.foreground': '#1F2328',
      'editorLineNumber.foreground': '#A1A1AA',
      'editorLineNumber.activeForeground': '#4B5563',
      'editor.selectionBackground': '#CFE8FF',
      'editor.inactiveSelectionBackground': '#E8EEF5',
      'editorCursor.foreground': '#005FB8',
      'editorIndentGuide.background1': '#E5E7EB',
      'editorIndentGuide.activeBackground1': '#CBD5E1',
      'editor.lineHighlightBackground': '#EFEFF2',
      'editor.lineHighlightBorder': '#00000000',
      'editorWhitespace.foreground': '#D4D4D8',
      'editorBracketMatch.background': '#DCEBFA',
      'editorBracketMatch.border': '#00000000',
      'editorGutter.background': '#F7F7F8',
      'editorOverviewRuler.border': '#00000000',
    },
  });

  monaco.editor.defineTheme('odyssey-latex-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7E7B76', fontStyle: 'italic' },
      { token: 'keyword.command', foreground: '0D5C96' },
      { token: 'keyword.environment', foreground: 'B4580A', fontStyle: 'bold' },
      { token: 'delimiter.math', foreground: '9C3F2A', fontStyle: 'bold' },
      { token: 'delimiter.bracket', foreground: '8C6A44' },
      { token: 'number', foreground: '875A14' },
      { token: 'string', foreground: '8B2D57' },
      { token: 'operator', foreground: '9E5C2A' },
    ],
    colors: {
      'editor.background': '#F7F5F1',
      'editor.foreground': '#2B2520',
      'editorLineNumber.foreground': '#B4ACA2',
      'editorLineNumber.activeForeground': '#6F6457',
      'editor.selectionBackground': '#D7E8F6',
      'editor.inactiveSelectionBackground': '#E7DED2',
      'editorCursor.foreground': '#0d5c96',
      'editorIndentGuide.background1': '#E3DDD3',
      'editorIndentGuide.activeBackground1': '#C8BAA6',
      'editor.lineHighlightBackground': '#F1EEE8',
    },
  });

  monaco.editor.defineTheme('odyssey-latex-slate', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8A97A6', fontStyle: 'italic' },
      { token: 'keyword.command', foreground: '7CC7FF' },
      { token: 'keyword.environment', foreground: 'FFB867', fontStyle: 'bold' },
      { token: 'delimiter.math', foreground: 'F78C6C', fontStyle: 'bold' },
      { token: 'delimiter.bracket', foreground: 'D8C6A8' },
      { token: 'number', foreground: 'E7C773' },
      { token: 'string', foreground: 'F38BA8' },
      { token: 'operator', foreground: 'FF9E64' },
    ],
    colors: {
      'editor.background': '#1f242c',
      'editor.foreground': '#d8dde5',
      'editorLineNumber.foreground': '#5c6773',
      'editorLineNumber.activeForeground': '#a7b2bf',
      'editor.selectionBackground': '#284764',
      'editor.inactiveSelectionBackground': '#323c47',
      'editorCursor.foreground': '#7cc7ff',
      'editorIndentGuide.background1': '#303844',
      'editorIndentGuide.activeBackground1': '#54606e',
    },
  });

  monaco.editor.defineTheme('odyssey-latex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6F7F8F', fontStyle: 'italic' },
      { token: 'keyword.command', foreground: '66D9EF' },
      { token: 'keyword.environment', foreground: 'FFD866', fontStyle: 'bold' },
      { token: 'delimiter.math', foreground: 'FF7A90', fontStyle: 'bold' },
      { token: 'delimiter.bracket', foreground: 'D7DCE2' },
      { token: 'number', foreground: 'A6E22E' },
      { token: 'string', foreground: 'E6DB74' },
      { token: 'operator', foreground: 'FD971F' },
    ],
    colors: {
      'editor.background': '#11151b',
      'editor.foreground': '#eef2f7',
      'editorLineNumber.foreground': '#475261',
      'editorLineNumber.activeForeground': '#aeb6c1',
      'editor.selectionBackground': '#1d4460',
      'editor.inactiveSelectionBackground': '#24313c',
      'editorCursor.foreground': '#66d9ef',
      'editorIndentGuide.background1': '#232a33',
      'editorIndentGuide.activeBackground1': '#4d5867',
      'editor.lineHighlightBackground': '#181E26',
    },
  });

  monaco.editor.defineTheme('odyssey-latex-night', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6F7F8F', fontStyle: 'italic' },
      { token: 'keyword.command', foreground: '66D9EF' },
      { token: 'keyword.environment', foreground: 'FFD866', fontStyle: 'bold' },
      { token: 'delimiter.math', foreground: 'FF7A90', fontStyle: 'bold' },
      { token: 'delimiter.bracket', foreground: 'D7DCE2' },
      { token: 'number', foreground: 'A6E22E' },
      { token: 'string', foreground: 'E6DB74' },
      { token: 'operator', foreground: 'FD971F' },
    ],
    colors: {
      'editor.background': '#11151b',
      'editor.foreground': '#eef2f7',
      'editorLineNumber.foreground': '#475261',
      'editorLineNumber.activeForeground': '#aeb6c1',
      'editor.selectionBackground': '#1d4460',
      'editor.inactiveSelectionBackground': '#24313c',
      'editorCursor.foreground': '#66d9ef',
      'editorIndentGuide.background1': '#232a33',
      'editorIndentGuide.activeBackground1': '#4d5867',
      'editor.lineHighlightBackground': '#181E26',
    },
  });

  monaco.editor.defineTheme('odyssey-latex-contrast', {
    base: 'hc-black',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9CA3AF', fontStyle: 'italic' },
      { token: 'keyword.command', foreground: '4FC3F7' },
      { token: 'keyword.environment', foreground: 'FFD54F', fontStyle: 'bold' },
      { token: 'delimiter.math', foreground: 'FF8A80', fontStyle: 'bold' },
      { token: 'delimiter.bracket', foreground: 'FFFFFF' },
      { token: 'number', foreground: 'AED581' },
      { token: 'string', foreground: 'CE93D8' },
      { token: 'operator', foreground: 'FFB74D' },
    ],
    colors: {
      'editor.background': '#000000',
      'editor.foreground': '#FFFFFF',
      'editorLineNumber.foreground': '#7D8590',
      'editorLineNumber.activeForeground': '#FFFFFF',
      'editor.selectionBackground': '#1B4B72',
      'editor.inactiveSelectionBackground': '#30363D',
      'editorCursor.foreground': '#4FC3F7',
    },
  });

  monacoWithFlag.__odysseyLatexConfigured = true;
}

type PaneId = 'preview' | 'editor';

type VisualBlockKind = 'chapter' | 'section' | 'subsection' | 'paragraph' | 'abstract' | 'itemize' | 'enumerate' | 'raw';

type VisualDocumentMode = 'standalone' | 'workspace-nps';

type VisualDocumentLayoutEntry = {
  slotId: string;
  type: 'root' | 'file';
  path: string;
  inputCommand?: string;
};

interface VisualBlock {
  id: string;
  kind: VisualBlockKind;
  html?: string;
  items?: string[];
  raw?: string;
  sourcePath?: string | null;
  sourceSlot?: string | null;
}

interface VisualDocumentModel {
  mode: VisualDocumentMode;
  preamble: string;
  title: string;
  author: string;
  date: string;
  hasMaketitle: boolean;
  blocks: VisualBlock[];
  canEdit: boolean;
  mainFilePath?: string | null;
  metadataFilePath?: string | null;
  metadataDocumentPrefix?: string;
  mainFilePrefix?: string;
  mainFileSuffix?: string;
  layout?: VisualDocumentLayoutEntry[];
}

function buildEditorStateSnapshot(editor: MonacoEditor.IStandaloneCodeEditor, draft: string): ThesisPaperEditorState {
  const position = editor.getPosition();
  const selection = editor.getSelection();
  const model = editor.getModel();
  const visibleRange = editor.getVisibleRanges()[0] ?? null;
  const selectionText = selection && model && !selection.isEmpty()
    ? model.getValueInRange(selection).slice(0, 4000)
    : '';

  return {
    cursorLineNumber: position?.lineNumber ?? 1,
    cursorColumn: position?.column ?? 1,
    selection: selection ? {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
      isEmpty: selection.isEmpty(),
      selectedText: selectionText,
    } : null,
    viewport: visibleRange ? {
      firstLineNumber: visibleRange.startLineNumber,
      lastLineNumber: visibleRange.endLineNumber,
      centerLineNumber: Math.round((visibleRange.startLineNumber + visibleRange.endLineNumber) / 2),
    } : {
      firstLineNumber: 1,
      lastLineNumber: Math.max(1, draft.split('\n').length),
      centerLineNumber: 1,
    },
  };
}

function resolveExplorerSelection(workspace: ThesisWorkspace, preferredNodeId: string | null) {
  if (preferredNodeId) {
    if (workspace.files.some((file) => file.id === preferredNodeId)) {
      return preferredNodeId;
    }
    if (workspace.folders.some((folder) => `folder:${folder.path}` === preferredNodeId)) {
      return preferredNodeId;
    }
  }
  return getThesisWorkspaceActiveFile(workspace)?.id ?? null;
}

function buildWorkspaceStructureSignature(workspace: ThesisWorkspace) {
  return JSON.stringify({
    activeFileId: workspace.activeFileId,
    files: workspace.files.map((file) => ({ id: file.id, path: file.path })),
    folders: workspace.folders.map((folder) => folder.path),
  });
}

function hashWorkspaceFileContent(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildWorkspaceFileStorageSignature(file: ThesisWorkspaceFile) {
  return [
    file.path,
    file.encoding ?? 'utf-8',
    file.mimeType ?? '',
    file.content.length,
    hashWorkspaceFileContent(file.content),
  ].join(':');
}

function buildWorkspaceFileStorageSignatures(workspace: ThesisWorkspace) {
  return new Map(workspace.files.map((file) => [file.id, buildWorkspaceFileStorageSignature(file)]));
}

function computeWorkspacePersistedState(workspace: ThesisWorkspace, savedSignatures: ReadonlyMap<string, string>) {
  const savedFileIds = new Set<string>();
  let allSaved = savedSignatures.size === workspace.files.length;

  for (const file of workspace.files) {
    const currentSignature = buildWorkspaceFileStorageSignature(file);
    if (savedSignatures.get(file.id) === currentSignature) {
      savedFileIds.add(file.id);
      continue;
    }
    allSaved = false;
  }

  return { savedFileIds, allSaved };
}

function readBalancedBraces(input: string, openBraceIndex: number) {
  if (input[openBraceIndex] !== '{') return null;
  let depth = 0;
  let cursor = openBraceIndex;
  while (cursor < input.length) {
    const char = input[cursor];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          content: input.slice(openBraceIndex + 1, cursor),
          endIndex: cursor,
        };
      }
    }
    cursor += 1;
  }
  return null;
}

function parseInlineLatexToHtml(input: string) {
  const renderRange = (start: number, end: number): string => {
    let html = '';
    let index = start;
    while (index < end) {
      const slice = input.slice(index, end);
      const commandPatterns: Array<{ prefix: string; open: string; close: string }> = [
        { prefix: '\\textbf{', open: '<strong>', close: '</strong>' },
        { prefix: '\\textit{', open: '<em>', close: '</em>' },
        { prefix: '\\emph{', open: '<em>', close: '</em>' },
        { prefix: '\\underline{', open: '<u>', close: '</u>' },
      ];
      const matchedCommand = commandPatterns.find((pattern) => slice.startsWith(pattern.prefix));
      if (matchedCommand) {
        const braceIndex = index + matchedCommand.prefix.length - 1;
        const braced = readBalancedBraces(input, braceIndex);
        if (braced) {
          html += `${matchedCommand.open}${renderRange(braceIndex + 1, braced.endIndex)}${matchedCommand.close}`;
          index = braced.endIndex + 1;
          continue;
        }
      }

      if (slice.startsWith('\\\\')) {
        html += '<br />';
        index += 2;
        continue;
      }

      if (/^\\[#$%&_{}]/.test(slice)) {
        html += escapeHtml(slice[1]);
        index += 2;
        continue;
      }

      if (slice.startsWith('\\today')) {
        html += '\\today';
        index += '\\today'.length;
        continue;
      }

      html += escapeHtml(input[index] ?? '');
      index += 1;
    }
    return html;
  };

  return renderRange(0, input.length);
}

function sanitizeVisualEditableHtml(input: string) {
  if (typeof window === 'undefined') return input;
  const parser = new window.DOMParser();
  const document = parser.parseFromString(`<div>${input}</div>`, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return '';

  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent ?? '');
    }
    if (!(node instanceof HTMLElement)) return '';
    const children = Array.from(node.childNodes).map(renderNode).join('');
    const tagName = node.tagName.toLowerCase();
    if (tagName === 'strong' || tagName === 'b') return `<strong>${children}</strong>`;
    if (tagName === 'em' || tagName === 'i') return `<em>${children}</em>`;
    if (tagName === 'u') return `<u>${children}</u>`;
    if (tagName === 'br') return '<br />';
    if (tagName === 'div' || tagName === 'p') return `${children}<br />`;
    if (tagName === 'span') return children;
    return children;
  };

  return Array.from(root.childNodes).map(renderNode).join('')
    .replace(/(?:<br \/>){3,}/g, '<br /><br />');
}

function escapeLatexText(value: string) {
  return value
    .replace(/\\/g, '\\textbackslash ')
    .replace(/([#$%&_])/g, '\\$1');
}

function htmlInlineToLatex(input: string) {
  if (typeof window === 'undefined') return input;
  const parser = new window.DOMParser();
  const document = parser.parseFromString(`<div>${input}</div>`, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return '';

  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeLatexText(node.textContent ?? '');
    }
    if (!(node instanceof HTMLElement)) return '';
    const children = Array.from(node.childNodes).map(renderNode).join('');
    const tagName = node.tagName.toLowerCase();
    if (tagName === 'strong' || tagName === 'b') return `\\textbf{${children}}`;
    if (tagName === 'em' || tagName === 'i') return `\\textit{${children}}`;
    if (tagName === 'u') return `\\underline{${children}}`;
    if (tagName === 'br') return ' \\\\\n';
    if (tagName === 'div' || tagName === 'p' || tagName === 'span') return children;
    return children;
  };

  return Array.from(root.childNodes).map(renderNode).join('').trim();
}

function extractLatexCommandValue(source: string, command: 'title' | 'author' | 'date') {
  const commandIndex = source.indexOf(`\\${command}`);
  if (commandIndex === -1) return '';
  const braceIndex = source.indexOf('{', commandIndex);
  if (braceIndex === -1) return '';
  const braced = readBalancedBraces(source, braceIndex);
  return braced?.content ?? '';
}

function upsertLatexCommand(source: string, command: 'title' | 'author' | 'date', value: string) {
  const nextCommand = `\\${command}{${value}}`;
  const commandIndex = source.indexOf(`\\${command}`);
  if (commandIndex === -1) {
    return `${source.trimEnd()}\n${nextCommand}\n`;
  }
  const braceIndex = source.indexOf('{', commandIndex);
  if (braceIndex === -1) {
    return `${source}\n${nextCommand}`;
  }
  const braced = readBalancedBraces(source, braceIndex);
  if (!braced) {
    return `${source}\n${nextCommand}`;
  }
  return `${source.slice(0, commandIndex)}${nextCommand}${source.slice(braced.endIndex + 1)}`;
}

function normalizeWorkspaceLatexPath(pathValue: string) {
  return pathValue
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function getWorkspacePathDirectory(pathValue: string) {
  const normalized = normalizeWorkspaceLatexPath(pathValue);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
}

function joinWorkspaceLatexPath(baseDirectory: string, relativePath: string) {
  const joined = `${baseDirectory ? `${baseDirectory}/` : ''}${relativePath}`;
  const segments = joined.replace(/\\/g, '/').split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

function resolveWorkspaceInputPath(workspace: ThesisWorkspace, fromPath: string, rawReference: string) {
  const normalizedReference = rawReference.trim().replace(/\\/g, '/');
  if (!normalizedReference) return null;
  const candidates = normalizedReference.toLowerCase().endsWith('.tex')
    ? [normalizedReference]
    : [normalizedReference, `${normalizedReference}.tex`];
  const fromDirectory = getWorkspacePathDirectory(fromPath);
  for (const candidate of candidates) {
    const directPath = normalizeWorkspaceLatexPath(joinWorkspaceLatexPath(fromDirectory, candidate));
    const directMatch = workspace.files.find((file) => file.path === directPath);
    if (directMatch) return directMatch;
    const fallbackMatch = workspace.files.find((file) => file.path === normalizeWorkspaceLatexPath(candidate));
    if (fallbackMatch) return fallbackMatch;
  }
  return null;
}

function parseLatexVisualBlocks(
  body: string,
  nextBlockId: (kind: VisualBlockKind) => string,
  options?: {
    sourcePath?: string | null;
    sourceSlot?: string | null;
    treatCommandsAsRaw?: boolean;
  },
) {
  const lines = body.split('\n');
  const blocks: VisualBlock[] = [];
  let paragraphBuffer: string[] = [];

  const attachSource = (block: VisualBlock): VisualBlock => ({
    ...block,
    sourcePath: options?.sourcePath ?? null,
    sourceSlot: options?.sourceSlot ?? null,
  });

  const flushParagraph = () => {
    const text = paragraphBuffer.join(' ').trim();
    if (text) {
      blocks.push(attachSource({
        id: nextBlockId('paragraph'),
        kind: 'paragraph',
        html: parseInlineLatexToHtml(text),
      }));
    }
    paragraphBuffer = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    const chapterMatch = trimmed.match(/^\\chapter\{([\s\S]*)\}$/);
    if (chapterMatch) {
      flushParagraph();
      blocks.push(attachSource({
        id: nextBlockId('chapter'),
        kind: 'chapter',
        html: parseInlineLatexToHtml(chapterMatch[1] ?? ''),
      }));
      index += 1;
      continue;
    }

    const sectionMatch = trimmed.match(/^\\(section|subsection)\{([\s\S]*)\}$/);
    if (sectionMatch) {
      flushParagraph();
      blocks.push(attachSource({
        id: nextBlockId(sectionMatch[1] === 'section' ? 'section' : 'subsection'),
        kind: sectionMatch[1] === 'section' ? 'section' : 'subsection',
        html: parseInlineLatexToHtml(sectionMatch[2] ?? ''),
      }));
      index += 1;
      continue;
    }

    if (trimmed === '\\maketitle') {
      flushParagraph();
      blocks.push(attachSource({
        id: nextBlockId('raw'),
        kind: 'raw',
        raw: line,
      }));
      index += 1;
      continue;
    }

    if (trimmed === '\\begin{abstract}') {
      flushParagraph();
      const abstractLines: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== '\\end{abstract}') {
        abstractLines.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push(attachSource({
        id: nextBlockId('abstract'),
        kind: 'abstract',
        html: parseInlineLatexToHtml(abstractLines.join(' ').trim()),
      }));
      index += 1;
      continue;
    }

    const listBeginMatch = trimmed.match(/^\\begin\{(itemize|enumerate)\}$/);
    if (listBeginMatch) {
      flushParagraph();
      const envKind = listBeginMatch[1];
      const items: string[] = [];
      let activeItem: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== `\\end{${envKind}}`) {
        const candidate = lines[index] ?? '';
        const candidateTrimmed = candidate.trim();
        if (candidateTrimmed.startsWith('\\item')) {
          if (activeItem.length > 0) {
            items.push(parseInlineLatexToHtml(activeItem.join(' ').trim()));
          }
          activeItem = [candidateTrimmed.replace(/^\\item\s*/, '')];
        } else {
          activeItem.push(candidateTrimmed);
        }
        index += 1;
      }
      if (activeItem.length > 0) {
        items.push(parseInlineLatexToHtml(activeItem.join(' ').trim()));
      }
      blocks.push(attachSource({
        id: nextBlockId(envKind === 'itemize' ? 'itemize' : 'enumerate'),
        kind: envKind === 'itemize' ? 'itemize' : 'enumerate',
        items: items.length > 0 ? items : [''],
      }));
      index += 1;
      continue;
    }

    const rawEnvironmentMatch = trimmed.match(/^\\begin\{([^}]+)\}$/);
    if (rawEnvironmentMatch) {
      flushParagraph();
      const envName = rawEnvironmentMatch[1];
      const rawLines = [line];
      index += 1;
      while (index < lines.length) {
        const currentLine = lines[index] ?? '';
        rawLines.push(currentLine);
        if (currentLine.trim() === `\\end{${envName}}`) {
          index += 1;
          break;
        }
        index += 1;
      }
      blocks.push(attachSource({
        id: nextBlockId('raw'),
        kind: 'raw',
        raw: rawLines.join('\n'),
      }));
      continue;
    }

    if (trimmed.startsWith('\\')) {
      flushParagraph();
      if (options?.treatCommandsAsRaw) {
        blocks.push(attachSource({
          id: nextBlockId('raw'),
          kind: 'raw',
          raw: line,
        }));
      } else {
        blocks.push(attachSource({
          id: nextBlockId('raw'),
          kind: 'raw',
          raw: line,
        }));
      }
      index += 1;
      continue;
    }

    paragraphBuffer.push(trimmed);
    index += 1;
  }

  flushParagraph();
  return blocks;
}

function parseWorkspaceBackedLatexVisualDocument(workspace: ThesisWorkspace, activeFilePath: string): VisualDocumentModel | null {
  const activeFile = workspace.files.find((file) => file.path === activeFilePath);
  if (!activeFile || isBinaryWorkspaceFile(activeFile)) return null;

  const frontMatterInputMatch = activeFile.content.match(/\\input\{([^}]*front-matter[^}]*)\}/);
  const endMatch = /\\end\{document\}/.exec(activeFile.content);
  if (!frontMatterInputMatch || !endMatch) return null;

  const frontMatterReference = frontMatterInputMatch[1] ?? '';
  const frontMatterFile = resolveWorkspaceInputPath(workspace, activeFile.path, frontMatterReference);
  if (!frontMatterFile || isBinaryWorkspaceFile(frontMatterFile)) return null;

  const beginMatch = /\\begin\{document\}/.exec(frontMatterFile.content);
  if (!beginMatch) return null;

  const preamble = frontMatterFile.content.slice(0, beginMatch.index).trimEnd();
  const metadataDocumentPrefix = frontMatterFile.content.slice(beginMatch.index + beginMatch[0].length);
  const frontMatterInputIndex = frontMatterInputMatch.index ?? -1;
  if (frontMatterInputIndex < 0) return null;
  const mainFilePrefix = activeFile.content.slice(0, frontMatterInputIndex + frontMatterInputMatch[0].length).trimEnd();
  const mainFileBody = activeFile.content.slice(frontMatterInputIndex + frontMatterInputMatch[0].length, endMatch.index).trim();
  const mainFileSuffix = activeFile.content.slice(endMatch.index);

  let blockId = 0;
  const nextBlockId = (kind: VisualBlockKind) => `${kind}-${blockId += 1}`;
  const blocks: VisualBlock[] = [];
  const layout: VisualDocumentLayoutEntry[] = [];
  const inputPattern = /\\input\{([^}]+)\}/g;
  let cursor = 0;
  let inputIndex = 0;

  const pushRootSegment = (rawSegment: string) => {
    const trimmedSegment = rawSegment.trim();
    if (!trimmedSegment) return;
    const slotId = `root-${layout.length + 1}`;
    layout.push({ slotId, type: 'root', path: activeFile.path });
    blocks.push({
      id: nextBlockId('raw'),
      kind: 'raw',
      raw: trimmedSegment,
      sourcePath: activeFile.path,
      sourceSlot: slotId,
    });
  };

  for (const match of mainFileBody.matchAll(inputPattern)) {
    const matchIndex = match.index ?? 0;
    pushRootSegment(mainFileBody.slice(cursor, matchIndex));
    const rawReference = match[1] ?? '';
    const referencedFile = resolveWorkspaceInputPath(workspace, activeFile.path, rawReference);
    const slotId = `file-${inputIndex += 1}`;
    if (referencedFile && !isBinaryWorkspaceFile(referencedFile)) {
      layout.push({
        slotId,
        type: 'file',
        path: referencedFile.path,
        inputCommand: match[0],
      });
      const parsedBlocks = parseLatexVisualBlocks(referencedFile.content, nextBlockId, {
        sourcePath: referencedFile.path,
        sourceSlot: slotId,
      });
      if (parsedBlocks.length > 0) {
        blocks.push(...parsedBlocks);
      } else {
        blocks.push({
          id: nextBlockId('raw'),
          kind: 'raw',
          raw: referencedFile.content.trim(),
          sourcePath: referencedFile.path,
          sourceSlot: slotId,
        });
      }
    } else {
      layout.push({
        slotId,
        type: 'root',
        path: activeFile.path,
      });
      blocks.push({
        id: nextBlockId('raw'),
        kind: 'raw',
        raw: match[0],
        sourcePath: activeFile.path,
        sourceSlot: slotId,
      });
    }
    cursor = matchIndex + match[0].length;
  }
  pushRootSegment(mainFileBody.slice(cursor));

  return {
    mode: 'workspace-nps',
    preamble,
    title: parseInlineLatexToHtml(extractLatexCommandValue(preamble, 'title')),
    author: parseInlineLatexToHtml(extractLatexCommandValue(preamble, 'author')),
    date: parseInlineLatexToHtml(extractLatexCommandValue(preamble, 'date')),
    hasMaketitle: false,
    blocks,
    canEdit: true,
    mainFilePath: activeFile.path,
    metadataFilePath: frontMatterFile.path,
    metadataDocumentPrefix,
    mainFilePrefix,
    mainFileSuffix,
    layout,
  };
}

function parseLatexVisualDocument(source: string, options?: { workspace?: ThesisWorkspace; activeFilePath?: string | null }): VisualDocumentModel {
  const beginMatch = /\\begin\{document\}/.exec(source);
  const endMatch = /\\end\{document\}/.exec(source);
  if (!beginMatch || !endMatch || endMatch.index <= beginMatch.index) {
    if (options?.workspace && options.activeFilePath) {
      const workspaceBackedDocument = parseWorkspaceBackedLatexVisualDocument(options.workspace, options.activeFilePath);
      if (workspaceBackedDocument) {
        return workspaceBackedDocument;
      }
    }
    return {
      mode: 'standalone',
      preamble: source,
      title: '',
      author: '',
      date: '',
      hasMaketitle: false,
      blocks: [],
      canEdit: false,
    };
  }

  const preamble = source.slice(0, beginMatch.index).trimEnd();
  const body = source.slice(beginMatch.index + beginMatch[0].length, endMatch.index).trim();
  let blockId = 0;
  const blocks = parseLatexVisualBlocks(body, (kind) => `${kind}-${blockId += 1}`);
  let hasMaketitle = false;
  hasMaketitle = /(^|\n)\s*\\maketitle(\s|$)/.test(body);

  return {
    mode: 'standalone',
    preamble,
    title: parseInlineLatexToHtml(extractLatexCommandValue(preamble, 'title')),
    author: parseInlineLatexToHtml(extractLatexCommandValue(preamble, 'author')),
    date: parseInlineLatexToHtml(extractLatexCommandValue(preamble, 'date')),
    hasMaketitle,
    blocks,
    canEdit: true,
  };
}

function serializeLatexVisualBlocks(documentModel: VisualDocumentModel, blocks: VisualBlock[]) {
  const bodySections: string[] = [];
  if (documentModel.mode === 'standalone' && (documentModel.hasMaketitle || documentModel.title || documentModel.author || documentModel.date)) {
    bodySections.push('\\maketitle');
  }

  for (const block of blocks) {
    if (block.kind === 'chapter') {
      bodySections.push(`\\chapter{${htmlInlineToLatex(block.html ?? '')}}`);
      continue;
    }
    if (block.kind === 'section') {
      bodySections.push(`\\section{${htmlInlineToLatex(block.html ?? '')}}`);
      continue;
    }
    if (block.kind === 'subsection') {
      bodySections.push(`\\subsection{${htmlInlineToLatex(block.html ?? '')}}`);
      continue;
    }
    if (block.kind === 'abstract') {
      bodySections.push(`\\begin{abstract}\n${htmlInlineToLatex(block.html ?? '')}\n\\end{abstract}`);
      continue;
    }
    if (block.kind === 'itemize' || block.kind === 'enumerate') {
      const items = (block.items ?? [''])
        .map((item) => `  \\item ${htmlInlineToLatex(item)}`)
        .join('\n');
      bodySections.push(`\\begin{${block.kind}}\n${items}\n\\end{${block.kind}}`);
      continue;
    }
    if (block.kind === 'raw') {
      bodySections.push((block.raw ?? '').trimEnd());
      continue;
    }
    bodySections.push(htmlInlineToLatex(block.html ?? ''));
  }

  return bodySections.filter(Boolean).join('\n\n');
}

function serializeLatexVisualDocument(documentModel: VisualDocumentModel) {
  let preamble = documentModel.preamble;
  preamble = upsertLatexCommand(preamble, 'title', htmlInlineToLatex(documentModel.title));
  preamble = upsertLatexCommand(preamble, 'author', htmlInlineToLatex(documentModel.author));
  preamble = upsertLatexCommand(preamble, 'date', htmlInlineToLatex(documentModel.date));

  const serializedBody = serializeLatexVisualBlocks(documentModel, documentModel.blocks);

  return `${preamble.trimEnd()}\n\n\\begin{document}\n\n${serializedBody}\n\n\\end{document}\n`;
}

function syncVisualDocumentToWorkspace(documentModel: VisualDocumentModel, targetWorkspace: ThesisWorkspace, fallbackDraft: string) {
  if (documentModel.mode !== 'workspace-nps') {
    const nextDraft = serializeLatexVisualDocument(documentModel);
    const currentActiveFile = getThesisWorkspaceActiveFile(targetWorkspace);
    if (!currentActiveFile) {
      return { draft: nextDraft, workspace: targetWorkspace };
    }
    return {
      draft: nextDraft,
      workspace: {
        ...targetWorkspace,
        files: targetWorkspace.files.map((file) => (file.id === currentActiveFile.id ? { ...file, content: nextDraft } : file)),
        activeFileId: currentActiveFile.id,
      } satisfies ThesisWorkspace,
    };
  }

  const metadataFilePath = documentModel.metadataFilePath ?? null;
  const mainFilePath = documentModel.mainFilePath ?? null;
  if (!metadataFilePath || !mainFilePath) {
    const nextDraft = serializeLatexVisualDocument({ ...documentModel, mode: 'standalone' });
    return { draft: nextDraft, workspace: targetWorkspace };
  }

  let nextMetadataContent = documentModel.preamble;
  nextMetadataContent = upsertLatexCommand(nextMetadataContent, 'title', htmlInlineToLatex(documentModel.title));
  nextMetadataContent = upsertLatexCommand(nextMetadataContent, 'author', htmlInlineToLatex(documentModel.author));
  nextMetadataContent = upsertLatexCommand(nextMetadataContent, 'date', htmlInlineToLatex(documentModel.date));
  nextMetadataContent = `${nextMetadataContent.trimEnd()}\n\n\\begin{document}${documentModel.metadataDocumentPrefix ?? ''}`;

  const groupedBlocks = new Map<string, VisualBlock[]>();
  for (const block of documentModel.blocks) {
    const slotId = block.sourceSlot ?? block.sourcePath ?? block.id;
    const collection = groupedBlocks.get(slotId) ?? [];
    collection.push(block);
    groupedBlocks.set(slotId, collection);
  }

  const nextFileContentByPath = new Map<string, string>();
  for (const entry of documentModel.layout ?? []) {
    if (entry.type !== 'file') continue;
    const entryBlocks = groupedBlocks.get(entry.slotId) ?? [];
    nextFileContentByPath.set(entry.path, `${serializeLatexVisualBlocks(documentModel, entryBlocks).trim()}\n`);
  }

  const mainBodySections = (documentModel.layout ?? []).map((entry) => {
    if (entry.type === 'file') {
      return entry.inputCommand ?? `\\input{${entry.path.replace(/\.tex$/i, '')}}`;
    }
    const entryBlocks = groupedBlocks.get(entry.slotId) ?? [];
    return serializeLatexVisualBlocks(documentModel, entryBlocks);
  }).filter((section) => section.trim().length > 0);
  const nextMainContent = `${(documentModel.mainFilePrefix ?? '').trimEnd()}\n\n${mainBodySections.join('\n\n')}\n\n${documentModel.mainFileSuffix ?? '\\end{document}\n'}`;

  const nextWorkspace = {
    ...targetWorkspace,
    files: targetWorkspace.files.map((file) => {
      if (file.path === metadataFilePath) {
        return { ...file, content: nextMetadataContent };
      }
      if (file.path === mainFilePath) {
        return { ...file, content: nextMainContent };
      }
      const rewrittenFile = nextFileContentByPath.get(file.path);
      if (typeof rewrittenFile === 'string') {
        return { ...file, content: rewrittenFile };
      }
      return file;
    }),
  } satisfies ThesisWorkspace;
  const activeFile = getThesisWorkspaceActiveFile(nextWorkspace);
  const nextDraft = nextWorkspace.files.find((file) => file.path === mainFilePath)?.content
    ?? activeFile?.content
    ?? fallbackDraft;

  return {
    draft: nextDraft,
    workspace: nextWorkspace,
  };
}

function cloneVisualDocument(documentModel: VisualDocumentModel): VisualDocumentModel {
  return {
    ...documentModel,
    blocks: documentModel.blocks.map((block) => ({
      ...block,
      items: block.items ? [...block.items] : undefined,
    })),
  };
}

function areVisualDocumentsEqual(left: VisualDocumentModel, right: VisualDocumentModel) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function summarizeWorkspace(workspace: ThesisWorkspace | null | undefined) {
  return {
    activeFileId: workspace?.activeFileId ?? null,
    fileCount: workspace?.files.length ?? 0,
    folderCount: workspace?.folders.length ?? 0,
    filePaths: workspace?.files.map((file) => file.path) ?? [],
    folderPaths: workspace?.folders.map((folder) => folder.path) ?? [],
  };
}

export default function ThesisPaperTab({ sourceLibrary, bibliographyFormat }: ThesisPaperTabProps) {
  const initialSnapshot = useMemo(() => readStoredThesisPaperSnapshot(), []);
  const initialWorkspace = useMemo(
    () => getThesisWorkspaceFromSnapshot(initialSnapshot, initialSnapshot.draft || DEFAULT_LATEX_TEMPLATE),
    [initialSnapshot],
  );
  const initialActiveFile = useMemo(() => getThesisWorkspaceActiveFile(initialWorkspace), [initialWorkspace]);
  const initialOverleafPreferences = useMemo(() => readStoredOverleafPreferences(), []);

  const [workspace, setWorkspace] = useState<ThesisWorkspace>(initialWorkspace);
  const [draft, setDraft] = useState(() => (initialActiveFile?.content ?? initialSnapshot.draft) || DEFAULT_LATEX_TEMPLATE);
  const [selectedExplorerNodeId, setSelectedExplorerNodeId] = useState<string | null>(() => initialActiveFile?.id ?? null);
  const [editorTheme, setEditorTheme] = useState(() => normalizeEditorThemeId(window.localStorage.getItem(THESIS_PAPER_THEME_STORAGE_KEY)));
  const [overleafEngine, setOverleafEngine] = useState<ThesisOverleafEngine>(initialOverleafPreferences.engine);
  const [overleafEditorMode, setOverleafEditorMode] = useState<ThesisOverleafEditorMode>(initialOverleafPreferences.editorMode);
  const [paneLayout, setPaneLayout] = useState<ThesisPaneLayout>(initialOverleafPreferences.paneLayout);
  const [previewDocument, setPreviewDocument] = useState<string>(() => buildPreviewDocument('<div class="page"><div class="body"><p>Rendering thesis draft…</p></div></div>'));
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewStats, setPreviewStats] = useState({ pages: 1, words: 0 });
  const [previewPage, setPreviewPage] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(DEFAULT_PREVIEW_ZOOM);
  const [previewTextSize, setPreviewTextSize] = useState(DEFAULT_PREVIEW_TEXT_SIZE);
  const [previewDisplayMode, setPreviewDisplayMode] = useState<PreviewDisplayMode>('pdf');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [latexDiagnostics, setLatexDiagnostics] = useState<LatexPreviewDiagnostic[]>([]);
  const [renderDiagnostics, setRenderDiagnostics] = useState<ThesisRenderDiagnostic[]>([]);
  const [autofixHighlights, setAutofixHighlights] = useState<LatexAutofixChange[]>([]);
  const [isApplyingAutofix, setIsApplyingAutofix] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteSaveState, setRemoteSaveState] = useState<ThesisRemoteSaveState>('idle');
  const [remoteSaveMessage, setRemoteSaveMessage] = useState<string | null>(null);
  const [remoteRepoWarning, setRemoteRepoWarning] = useState<string | null>(null);
  const [savedFileIds, setSavedFileIds] = useState<Set<string>>(() => new Set());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [previewWidthPercent, setPreviewWidthPercent] = useState(DEFAULT_PREVIEW_WIDTH_PERCENT);
  const [explorerWidthPx, setExplorerWidthPx] = useState(DEFAULT_EXPLORER_WIDTH_PX);
  const [explorerCollapsed, setExplorerCollapsed] = useState(() => window.localStorage.getItem(THESIS_EXPLORER_COLLAPSED_STORAGE_KEY) === 'true');
  const [expandedPane, setExpandedPane] = useState<PaneId | null>(null);
  const [paneMetaCollapsed, setPaneMetaCollapsed] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] = useState<'preview' | 'explorer' | null>(null);
  const [isOpeningInOverleaf, setIsOpeningInOverleaf] = useState(false);
  const [isOverleafPreferencesOpen, setIsOverleafPreferencesOpen] = useState(false);
  const [overleafError, setOverleafError] = useState<string | null>(null);
  const [visualDocument, setVisualDocument] = useState<VisualDocumentModel>(() => parseLatexVisualDocument(
    (initialActiveFile && !isBinaryWorkspaceFile(initialActiveFile) ? initialActiveFile.content : initialSnapshot.draft) || DEFAULT_LATEX_TEMPLATE,
    {
      workspace: initialWorkspace,
      activeFilePath: initialActiveFile?.path ?? null,
    },
  ));
  const [visualSelection, setVisualSelection] = useState<{ blockId: string | null; itemIndex: number | null }>({ blockId: null, itemIndex: null });
  const [visualPreambleVisible, setVisualPreambleVisible] = useState(false);
  const [overleafPreferencesPosition, setOverleafPreferencesPosition] = useState({ top: 0, right: 0 });
  const [toolbarTooltip, setToolbarTooltip] = useState<{
    label: string;
    tone: ToolbarTooltipTone;
    top: number;
    left: number;
  } | null>(null);
  const [insertSourceModalOpen, setInsertSourceModalOpen] = useState(false);
  const [insertSourceSearch, setInsertSourceSearch] = useState('');
  const [selectedInsertSourceIds, setSelectedInsertSourceIds] = useState<string[]>([]);
  const [insertSourceError, setInsertSourceError] = useState<string | null>(null);
  const workspaceLayoutRef = useRef<HTMLDivElement | null>(null);
  const splitPaneRef = useRef<HTMLDivElement | null>(null);
  const previewDividerRef = useRef<HTMLDivElement | null>(null);
  const explorerDividerRef = useRef<HTMLDivElement | null>(null);
  const overleafPreferencesRef = useRef<HTMLDivElement | null>(null);
  const overleafPreferencesButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarTooltipAnchorRef = useRef<HTMLElement | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const insertSourceActionRef = useRef<IDisposable | null>(null);
  const citationCompletionProviderRef = useRef<IDisposable | null>(null);
  const citationHoverProviderRef = useRef<IDisposable | null>(null);
  const insertSourceContextKeyRef = useRef<{ set: (value: boolean) => void } | null>(null);
  const insertSourceTargetRangeRef = useRef<InsertSourceTargetRange | null>(null);
  const editorDecorationIdsRef = useRef<string[]>([]);
  const autofixDecorationIdsRef = useRef<string[]>([]);
  const editorListenersRef = useRef<IDisposable[]>([]);
  const editorSyncFrameRef = useRef<number | null>(null);
  const suppressNextEditorChangeRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activeResizeHandleRef = useRef<'preview' | 'explorer' | null>(null);
  const selectedExplorerNodeIdRef = useRef<string | null>(initialActiveFile?.id ?? null);
  const savedFileIdsRef = useRef<Set<string>>(new Set());
  const lastRemoteSavedFileSignaturesRef = useRef<Map<string, string>>(new Map());
  const lastLocalSnapshotUpdateRef = useRef<number | null>(null);
  const latestWorkspaceRef = useRef<ThesisWorkspace>(initialWorkspace);
  const latestSourceLibraryRef = useRef<SourceLibraryItem[]>(sourceLibrary);
  const lastSavedWorkspaceStructureRef = useRef<string>(buildWorkspaceStructureSignature(initialWorkspace));
  const localChangesDuringHydrationRef = useRef(false);
  const previewRenderJobRef = useRef(0);
  const previewIndicatorTimeoutRef = useRef<number | null>(null);
  const previewHasSuccessfulRenderRef = useRef(false);
  const previewPdfUrlRef = useRef<string | null>(null);
  const skipNextVisualModelSyncRef = useRef(false);
  const visualEditableRefs = useRef<Record<string, HTMLElement | null>>({});
  const visualEditorRootRef = useRef<HTMLDivElement | null>(null);
  const visualHistoryRef = useRef<VisualDocumentModel[]>([cloneVisualDocument(parseLatexVisualDocument(
    (initialActiveFile && !isBinaryWorkspaceFile(initialActiveFile) ? initialActiveFile.content : initialSnapshot.draft) || DEFAULT_LATEX_TEMPLATE,
    {
      workspace: initialWorkspace,
      activeFilePath: initialActiveFile?.path ?? null,
    },
  ))]);
  const visualHistoryIndexRef = useRef(0);
  const deferredDraft = useDeferredValue(draft);
  const activeWorkspaceFile = useMemo(() => getThesisWorkspaceActiveFile(workspace), [workspace]);
  const isActiveBinaryFile = useMemo(() => isBinaryWorkspaceFile(activeWorkspaceFile), [activeWorkspaceFile]);
  const activeFilePath = activeWorkspaceFile?.path ?? null;
  const activeEditorLanguage = useMemo(() => getFileLanguage(activeFilePath), [activeFilePath]);
  const editorValue = useMemo(
    () => (activeWorkspaceFile && isActiveBinaryFile ? buildReadOnlyBinaryEditorText(activeWorkspaceFile) : draft),
    [activeWorkspaceFile, draft, isActiveBinaryFile],
  );
  const workspaceStructureSignature = useMemo(() => buildWorkspaceStructureSignature(workspace), [workspace]);
  const overleafMainDocument = useMemo(() => resolveOverleafMainDocument(workspace, activeFilePath), [workspace, activeFilePath]);
  const availableAutofix = useMemo(
    () => (
      renderError
        ? computeWorkspaceLatexAutofix(workspace, {
            activeFilePath,
            mainDocumentPath: overleafMainDocument,
            renderDiagnostics,
            renderError,
          })
        : null
    ),
    [activeFilePath, overleafMainDocument, renderDiagnostics, renderError, workspace],
  );
  const previewOnLeft = paneLayout === 'preview-left';
  const canControlPdfPreview = previewDisplayMode === 'pdf' && Boolean(previewPdfUrl);
  const canControlTextPreview = previewDisplayMode === 'text';
  const previewFrameSrc = previewPdfUrl
    ? `${previewPdfUrl}#toolbar=0&navpanes=0&scrollbar=0&page=${previewPage}&zoom=${previewZoom}`
    : null;
  const filteredInsertSources = useMemo(() => {
    const query = insertSourceSearch.trim().toLowerCase();
    if (!query) return sourceLibrary;
    return sourceLibrary.filter((source) => (
      source.title.toLowerCase().includes(query)
      || source.credit.toLowerCase().includes(query)
      || source.venue.toLowerCase().includes(query)
      || source.year.toLowerCase().includes(query)
      || source.tags.some((tag) => tag.toLowerCase().includes(query))
    ));
  }, [insertSourceSearch, sourceLibrary]);
  const selectedInsertSources = useMemo(
    () => sourceLibrary.filter((source) => selectedInsertSourceIds.includes(source.id)),
    [selectedInsertSourceIds, sourceLibrary],
  );
  const insertSourceMode = isBibFilePath(activeFilePath)
    ? 'bib'
    : isTexFilePath(activeFilePath)
      ? 'tex'
      : 'unsupported';

  const persistSnapshot = (partial: Partial<ThesisPaperSnapshot>) => {
    const currentSnapshot = readStoredThesisPaperSnapshot();
    const nextSnapshot = createThesisPaperSnapshot(partial.draft ?? currentSnapshot.draft, {
      ...currentSnapshot,
      ...partial,
      updatedAt: Date.now(),
    });
    lastLocalSnapshotUpdateRef.current = nextSnapshot.updatedAt;
    writeStoredThesisPaperSnapshot(nextSnapshot);
    return nextSnapshot;
  };

  const applySavedFileIds = (nextSavedFileIds: Set<string>) => {
    savedFileIdsRef.current = nextSavedFileIds;
    setSavedFileIds(nextSavedFileIds);
  };

  const commitRemoteSavedWorkspace = (nextWorkspace: ThesisWorkspace) => {
    lastRemoteSavedFileSignaturesRef.current = buildWorkspaceFileStorageSignatures(nextWorkspace);
    applySavedFileIds(new Set(nextWorkspace.files.map((file) => file.id)));
    setHasUnsavedChanges(false);
  };

  const reconcilePersistedWorkspace = (nextWorkspace: ThesisWorkspace) => {
    const persistedState = computeWorkspacePersistedState(nextWorkspace, lastRemoteSavedFileSignaturesRef.current);
    applySavedFileIds(persistedState.savedFileIds);
    setHasUnsavedChanges(!persistedState.allSaved);
  };

  const updateActiveFilePersistedState = (nextFile: ThesisWorkspaceFile | null, nextWorkspace: ThesisWorkspace) => {
    const nextSavedFileIds = new Set(savedFileIdsRef.current);
    if (nextFile) {
      const currentSignature = buildWorkspaceFileStorageSignature(nextFile);
      if (lastRemoteSavedFileSignaturesRef.current.get(nextFile.id) === currentSignature) {
        nextSavedFileIds.add(nextFile.id);
      } else {
        nextSavedFileIds.delete(nextFile.id);
      }
    }
    applySavedFileIds(nextSavedFileIds);
    setHasUnsavedChanges(
      nextSavedFileIds.size !== nextWorkspace.files.length
      || lastRemoteSavedFileSignaturesRef.current.size !== nextWorkspace.files.length,
    );
  };

  const clearPreviewObjectUrl = () => {
    if (previewPdfUrlRef.current) {
      window.URL.revokeObjectURL(previewPdfUrlRef.current);
      previewPdfUrlRef.current = null;
    }
  };

  const markLocalChangeDuringHydration = () => {
    if (!remoteReady) {
      localChangesDuringHydrationRef.current = true;
    }
  };

  const applyEditorDiagnostics = (diagnostics: LatexPreviewDiagnostic[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    monaco.editor.setModelMarkers(
      model,
      'odyssey-thesis-preview',
      activeEditorLanguage === 'latex'
        ? diagnostics.map((diagnostic) => ({
            ...diagnostic,
            severity: diagnostic.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
          }))
        : [],
    );

    const citationDecorations = activeEditorLanguage === 'latex'
      ? collectLatexCitationHoverDecorations(
          model,
          collectBibtexCitationSuggestions(latestWorkspaceRef.current, latestSourceLibraryRef.current),
          monaco,
        )
      : [];

    editorDecorationIdsRef.current = editor.deltaDecorations(editorDecorationIdsRef.current, citationDecorations);
  };

  const applyAutofixDecorations = (changes: LatexAutofixChange[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model || activeEditorLanguage !== 'latex') return;

    const decorations = changes.map((change) => ({
      range: new monaco.Range(
        change.startLineNumber,
        1,
        change.endLineNumber,
        model.getLineMaxColumn(change.endLineNumber),
      ),
      options: {
        isWholeLine: true,
        className: 'odyssey-autofix-line',
        linesDecorationsClassName: 'odyssey-autofix-gutter',
        hoverMessage: { value: change.description },
        overviewRuler: {
          color: 'rgba(34, 197, 94, 0.85)',
          position: monaco.editor.OverviewRulerLane.Left,
        },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }));

    autofixDecorationIdsRef.current = editor.deltaDecorations(autofixDecorationIdsRef.current, decorations);

    const firstChange = changes[0];
    if (!firstChange) return;

    editor.setSelection(new monaco.Range(
      firstChange.startLineNumber,
      1,
      firstChange.startLineNumber,
      1,
    ));
    editor.revealLineInCenter(firstChange.startLineNumber);
    editor.focus();
  };

  const clearAutofixFeedback = () => {
    setAutofixHighlights([]);

    const editor = editorRef.current;
    if (!editor || autofixDecorationIdsRef.current.length === 0) return;
    autofixDecorationIdsRef.current = editor.deltaDecorations(autofixDecorationIdsRef.current, []);
  };

  const handleAutofixRenderFailure = () => {
    if (!availableAutofix) return;

    setIsApplyingAutofix(true);
    const previousWorkspace = workspace;
    const previousSelectedNodeId = selectedExplorerNodeIdRef.current;
    const targetFile = workspace.files.find((file) => file.path === availableAutofix.filePath) ?? null;
    if (!targetFile) {
      setIsApplyingAutofix(false);
      return;
    }
    const nextWorkspace = {
      ...workspace,
      activeFileId: targetFile.id,
      files: workspace.files.map((file) => (
        file.path === availableAutofix.filePath ? { ...file, content: availableAutofix.nextSource } : file
      )),
    } satisfies ThesisWorkspace;

    pushUndoAction({
      label: 'Applied thesis LaTeX autofix',
      undo: () => {
        applyWorkspaceUpdate(previousWorkspace, {
          openFileId: previousWorkspace.activeFileId,
          selectedNodeId: previousSelectedNodeId,
        });
        clearAutofixFeedback();
      },
    });

    applyWorkspaceUpdate(nextWorkspace, {
      openFileId: targetFile.id,
      selectedNodeId: previousSelectedNodeId,
    });

    setAutofixHighlights(availableAutofix.changes);
    window.requestAnimationFrame(() => {
      applyAutofixDecorations(availableAutofix.changes);
      setIsApplyingAutofix(false);
    });
  };

  const applySnapshotToTab = (snapshot: ThesisPaperSnapshot) => {
    const nextWorkspace = getThesisWorkspaceFromSnapshot(snapshot, snapshot.draft || DEFAULT_LATEX_TEMPLATE);
    const nextActiveFile = getThesisWorkspaceActiveFile(nextWorkspace);
    latestWorkspaceRef.current = nextWorkspace;
    lastSavedWorkspaceStructureRef.current = buildWorkspaceStructureSignature(nextWorkspace);
    reconcilePersistedWorkspace(nextWorkspace);
    setWorkspace(nextWorkspace);
    setSelectedExplorerNodeId(resolveExplorerSelection(nextWorkspace, selectedExplorerNodeIdRef.current));
    setDraft(nextActiveFile?.content ?? snapshot.draft);
    setRenderError(snapshot.renderError ?? null);
    setLatexDiagnostics([]);
    setRenderDiagnostics([]);
    if (editorRef.current && editorRef.current.getValue() !== (nextActiveFile?.content ?? snapshot.draft)) {
      suppressNextEditorChangeRef.current = true;
      editorRef.current.setValue(
        nextActiveFile
          ? (isBinaryWorkspaceFile(nextActiveFile) ? buildReadOnlyBinaryEditorText(nextActiveFile) : nextActiveFile.content)
          : snapshot.draft,
      );
    }
  };

  const syncWorkspaceDraft = (nextDraft: string, targetWorkspace = workspace) => {
    const currentActiveFile = getThesisWorkspaceActiveFile(targetWorkspace);
    if (!currentActiveFile) return targetWorkspace;
    return {
      ...targetWorkspace,
      files: targetWorkspace.files.map((file) => (
        file.id === currentActiveFile.id ? { ...file, content: nextDraft } : file
      )),
      activeFileId: currentActiveFile.id,
    } satisfies ThesisWorkspace;
  };

  const persistRemoteWorkspaceNow = (nextDraft: string, nextWorkspace: ThesisWorkspace) => {
    if (!remoteReady) return;
    const nextStructureSignature = buildWorkspaceStructureSignature(nextWorkspace);
    if (lastSavedWorkspaceStructureRef.current === nextStructureSignature) return;
    latestWorkspaceRef.current = nextWorkspace;
    lastSavedWorkspaceStructureRef.current = nextStructureSignature;
    void persistRemoteDraft(nextDraft, editorTheme, nextWorkspace);
  };

  const openWorkspaceFile = (fileId: string, nextWorkspace = workspace) => {
    const nextFile = nextWorkspace.files.find((file) => file.id === fileId);
    if (!nextFile) return;
    markLocalChangeDuringHydration();
    latestWorkspaceRef.current = { ...nextWorkspace, activeFileId: fileId };
    setWorkspace({ ...nextWorkspace, activeFileId: fileId });
    setSelectedExplorerNodeId(fileId);
    setDraft(nextFile.content);
    setRenderError(null);
    setRenderDiagnostics([]);
    persistSnapshot({
      draft: nextFile.content,
      renderError: null,
      workspace: { ...nextWorkspace, activeFileId: fileId },
      activeFileId: nextFile.id,
      activeFilePath: nextFile.path,
    });
    if (editorRef.current) {
      suppressNextEditorChangeRef.current = true;
      editorRef.current.setValue(isBinaryWorkspaceFile(nextFile) ? buildReadOnlyBinaryEditorText(nextFile) : nextFile.content);
    }
    persistRemoteWorkspaceNow(nextFile.content, { ...nextWorkspace, activeFileId: fileId });
  };

  const applyWorkspaceUpdate = (
    nextWorkspace: ThesisWorkspace,
    options?: {
      openFileId?: string | null;
      selectedNodeId?: string | null;
    },
  ) => {
    markLocalChangeDuringHydration();
    const nextActiveFileId = options?.openFileId
      ?? nextWorkspace.activeFileId
      ?? getThesisWorkspaceActiveFile(nextWorkspace)?.id
      ?? null;
    const resolvedWorkspace = {
      ...nextWorkspace,
      activeFileId: nextActiveFileId,
    } satisfies ThesisWorkspace;
    const nextActiveFile = getThesisWorkspaceActiveFile(resolvedWorkspace);
    const nextDraft = nextActiveFile?.content ?? '';

    setWorkspace(resolvedWorkspace);
    latestWorkspaceRef.current = resolvedWorkspace;
    setSelectedExplorerNodeId(resolveExplorerSelection(resolvedWorkspace, options?.selectedNodeId ?? selectedExplorerNodeIdRef.current));
    setDraft(nextDraft);
    setRenderError(null);
    setRenderDiagnostics([]);
    reconcilePersistedWorkspace(resolvedWorkspace);
    persistSnapshot({
      draft: nextDraft,
      renderError: null,
      workspace: resolvedWorkspace,
      activeFileId: nextActiveFile?.id ?? null,
      activeFilePath: nextActiveFile?.path ?? null,
    });

    if (editorRef.current && editorRef.current.getValue() !== nextDraft) {
      suppressNextEditorChangeRef.current = true;
      editorRef.current.setValue(nextDraft);
    }
    persistRemoteWorkspaceNow(nextDraft, resolvedWorkspace);
  };

  const persistRemoteDraft = async (nextDraft: string, nextTheme: EditorThemeId, nextWorkspace: ThesisWorkspace) => {
    setRemoteSaveState('saving');
    setRemoteSaveMessage(null);
    try {
      const localSnapshot = readStoredThesisPaperSnapshot();
      const snapshot = createThesisPaperSnapshot(nextDraft, {
        ...localSnapshot,
        workspace: nextWorkspace,
        updatedAt: Date.now(),
      });
      const result = await saveThesisDocument({
        draft: nextDraft,
        editorTheme: nextTheme,
        snapshot,
        debug: {
          nextWorkspace: summarizeWorkspace(nextWorkspace),
          latestWorkspace: summarizeWorkspace(latestWorkspaceRef.current),
          localSnapshotWorkspace: summarizeWorkspace(localSnapshot.workspace),
          selectedExplorerNodeId: selectedExplorerNodeIdRef.current,
        },
      });
      commitRemoteSavedWorkspace(nextWorkspace);
      setRemoteSaveState('saved');
      setRemoteSaveMessage(null);
      setRemoteRepoWarning(result.repoSyncStatus === 'error' ? (result.repoSyncError ?? 'Repository mirror failed.') : null);
    } catch (error) {
      setRemoteSaveState('error');
      setRemoteSaveMessage(error instanceof Error ? error.message : 'Failed to autosave thesis draft.');
      setRemoteRepoWarning(null);
    }
  };

  useEffect(() => {
    latestWorkspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    latestSourceLibraryRef.current = sourceLibrary;
  }, [sourceLibrary]);

  useEffect(() => {
    persistSnapshot({
      draft,
      previewStatus: isRendering ? 'rendering' : readStoredThesisPaperSnapshot().previewStatus,
      renderError,
      workspace,
    });
  }, [draft, isRendering, renderError, workspace]);

  useEffect(() => {
    if (activeEditorLanguage !== 'latex') {
      const fallbackVisualDocument = parseLatexVisualDocument(DEFAULT_LATEX_TEMPLATE, {
        workspace,
        activeFilePath,
      });
      setVisualDocument(fallbackVisualDocument);
      resetVisualHistory(fallbackVisualDocument);
      return;
    }
    if (skipNextVisualModelSyncRef.current) {
      skipNextVisualModelSyncRef.current = false;
      return;
    }
    const parsedVisualDocument = parseLatexVisualDocument(draft, {
      workspace,
      activeFilePath,
    });
    setVisualDocument(parsedVisualDocument);
    resetVisualHistory(parsedVisualDocument);
  }, [activeEditorLanguage, activeFilePath, draft, workspace]);

  useEffect(() => {
    selectedExplorerNodeIdRef.current = selectedExplorerNodeId;
  }, [selectedExplorerNodeId]);

  useEffect(() => {
    const normalizedThemeId = normalizeEditorThemeId(editorTheme);
    if (normalizedThemeId !== editorTheme) {
      setEditorTheme(normalizedThemeId);
      return;
    }
    window.localStorage.setItem(THESIS_PAPER_THEME_STORAGE_KEY, normalizedThemeId);
  }, [editorTheme]);

  useEffect(() => {
    window.localStorage.setItem(THESIS_EXPLORER_COLLAPSED_STORAGE_KEY, explorerCollapsed ? 'true' : 'false');
  }, [explorerCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(THESIS_OVERLEAF_PREFERENCES_STORAGE_KEY, JSON.stringify({
      engine: overleafEngine,
      editorMode: overleafEditorMode,
      paneLayout,
    }));
  }, [overleafEditorMode, overleafEngine, paneLayout]);

  useEffect(() => {
    if (!isOverleafPreferencesOpen) return;

    const updateMenuPosition = () => {
      const trigger = overleafPreferencesButtonRef.current;
      if (!trigger) return;
      const bounds = trigger.getBoundingClientRect();
      setOverleafPreferencesPosition({
        top: bounds.bottom + 6,
        right: Math.max(12, window.innerWidth - bounds.right),
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (overleafPreferencesRef.current?.contains(target)) return;
      if (overleafPreferencesButtonRef.current?.contains(target)) return;
      setIsOverleafPreferencesOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOverleafPreferencesOpen(false);
      }
    };

    updateMenuPosition();
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOverleafPreferencesOpen]);

  useEffect(() => {
    if (!toolbarTooltip) return;

    const updateTooltipPosition = () => {
      const anchor = toolbarTooltipAnchorRef.current;
      if (!anchor) {
        setToolbarTooltip(null);
        return;
      }
      const bounds = anchor.getBoundingClientRect();
      setToolbarTooltip((current) => (
        current
          ? {
              ...current,
              top: bounds.bottom + 8,
              left: Math.min(window.innerWidth - 16, Math.max(16, bounds.left + (bounds.width / 2))),
            }
          : current
      ));
    };

    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [toolbarTooltip]);

  useEffect(() => {
    const isSupportedInsertFile = isBibFilePath(activeFilePath) || isTexFilePath(activeFilePath);
    insertSourceContextKeyRef.current?.set(isSupportedInsertFile);
    if (!isSupportedInsertFile && insertSourceModalOpen) {
      setInsertSourceModalOpen(false);
      setInsertSourceError(null);
      setInsertSourceSearch('');
      setSelectedInsertSourceIds([]);
    }
  }, [activeFilePath, insertSourceModalOpen]);

  useEffect(() => {
    if (!insertSourceModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInsertSourceModalOpen(false);
        setInsertSourceError(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [insertSourceModalOpen]);

  useEffect(() => {
    let cancelled = false;

    const loadRemoteDocument = async () => {
      try {
        const remoteDocument = await fetchThesisDocument();
        if (cancelled) return;

        if (remoteDocument) {
          const localSnapshot = readStoredThesisPaperSnapshot();
          const remoteUpdatedAt = new Date(remoteDocument.updatedAt).getTime();
          const localTheme = normalizeEditorThemeId(window.localStorage.getItem(THESIS_PAPER_THEME_STORAGE_KEY));

          if (localChangesDuringHydrationRef.current) {
            const localWorkspace = getThesisWorkspaceFromSnapshot(localSnapshot, localSnapshot.draft || DEFAULT_LATEX_TEMPLATE);
            latestWorkspaceRef.current = localWorkspace;
            void persistRemoteDraft(localSnapshot.draft, localTheme, localWorkspace);
            setEditorTheme(localTheme);
            setRemoteSaveState('saving');
            return;
          }

          if (!localSnapshot.updatedAt || remoteUpdatedAt >= localSnapshot.updatedAt || !localSnapshot.draft.trim()) {
            const hydratedSnapshot = applyRemoteThesisDocument(remoteDocument);
            applySnapshotToTab(hydratedSnapshot);
            commitRemoteSavedWorkspace(getThesisWorkspaceFromSnapshot(hydratedSnapshot, hydratedSnapshot.draft || DEFAULT_LATEX_TEMPLATE));
            setEditorTheme(normalizeEditorThemeId(remoteDocument.editorTheme));
          } else {
            const localWorkspace = getThesisWorkspaceFromSnapshot(localSnapshot, localSnapshot.draft || DEFAULT_LATEX_TEMPLATE);
            void persistRemoteDraft(
              localSnapshot.draft,
              localTheme,
              localWorkspace,
            );
          }

          setRemoteSaveState('saved');
          setRemoteSaveMessage(null);
          setRemoteRepoWarning(remoteDocument.repoSyncStatus === 'error' ? remoteDocument.repoSyncError : null);
        }
      } catch (error) {
        if (cancelled) return;
        setRemoteSaveState('error');
        setRemoteSaveMessage(error instanceof Error ? error.message : 'Failed to load thesis draft.');
        setRemoteRepoWarning(null);
      } finally {
        if (!cancelled) setRemoteReady(true);
      }
    };

    void loadRemoteDocument();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THESIS_PAPER_SNAPSHOT_STORAGE_KEY) return;
      const snapshot = readStoredThesisPaperSnapshot();
      applySnapshotToTab(snapshot);
    };

    const handlePaperState = (event: Event) => {
      const snapshot = (event as CustomEvent<ThesisPaperSnapshot>).detail ?? readStoredThesisPaperSnapshot();
      if (snapshot.updatedAt === lastLocalSnapshotUpdateRef.current) return;
      applySnapshotToTab(snapshot);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(THESIS_PAPER_STATE_EVENT, handlePaperState as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(THESIS_PAPER_STATE_EVENT, handlePaperState as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!remoteReady) return;
    const timeout = window.setTimeout(() => {
      void persistRemoteDraft(draft, editorTheme, latestWorkspaceRef.current);
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [draft, editorTheme, remoteReady]);

  useEffect(() => {
    if (!remoteReady) return;
    if (lastSavedWorkspaceStructureRef.current === workspaceStructureSignature) return;
    persistRemoteWorkspaceNow(draft, workspace);
  }, [draft, remoteReady, workspace, workspaceStructureSignature]);

  useEffect(() => {
    if (!previewPdfUrl) {
      setPreviewPage(1);
      return;
    }
    setPreviewPage((currentPage) => Math.min(Math.max(1, currentPage), Math.max(1, previewStats.pages)));
  }, [previewPdfUrl, previewStats.pages]);

  useEffect(() => {
    if (!previewPdfUrl || !previewFrameSrc) return;
    const iframe = previewIframeRef.current;
    if (!iframe) return;

    const currentSrc = iframe.getAttribute('src');
    if (currentSrc === previewFrameSrc) return;

    try {
      iframe.contentWindow?.location.replace(previewFrameSrc);
    } catch {
      iframe.setAttribute('src', previewFrameSrc);
    }
  }, [previewFrameSrc, previewPdfUrl]);

  useEffect(() => {
    const renderJobId = previewRenderJobRef.current + 1;
    previewRenderJobRef.current = renderJobId;
    const abortController = new AbortController();
    if (previewIndicatorTimeoutRef.current !== null) {
      window.clearTimeout(previewIndicatorTimeoutRef.current);
    }
    previewIndicatorTimeoutRef.current = window.setTimeout(() => {
      if (previewRenderJobRef.current === renderJobId) {
        setIsRendering(true);
      }
    }, 140);

    const timeout = window.setTimeout(() => {
      const renderPreview = async () => {
        try {
          if (activeWorkspaceFile && (isPdfWorkspaceFile(activeWorkspaceFile) || isImageWorkspaceFile(activeWorkspaceFile))) {
            if (previewRenderJobRef.current !== renderJobId) return;
            clearPreviewObjectUrl();

            if (isPdfWorkspaceFile(activeWorkspaceFile)) {
              const nextPreviewPdfUrl = createWorkspaceFileObjectUrl(activeWorkspaceFile);
              previewPdfUrlRef.current = nextPreviewPdfUrl;
              setPreviewDisplayMode('pdf');
              setPreviewPdfUrl(nextPreviewPdfUrl);
              setPreviewDocument(buildPreviewDocument('<div class="page"><div class="body"><p>Rendering PDF preview…</p></div></div>'));
            } else if (isImageWorkspaceFile(activeWorkspaceFile)) {
              const imageUrl = createWorkspaceFileObjectUrl(activeWorkspaceFile);
              previewPdfUrlRef.current = imageUrl;
              setPreviewDisplayMode('image');
              setPreviewPdfUrl(null);
              setPreviewDocument(buildImagePreviewDocument(activeFilePath, imageUrl));
            } else {
              setPreviewDisplayMode('binary');
              setPreviewPdfUrl(null);
              setPreviewDocument(buildBinaryPreviewDocument(activeWorkspaceFile));
            }

            previewHasSuccessfulRenderRef.current = true;
            setPreviewStats({ pages: 1, words: 0 });
            setRenderError(null);
            setLatexDiagnostics([]);
            setRenderDiagnostics([]);
            persistSnapshot({
              draft: deferredDraft,
              previewStatus: 'live',
              renderError: null,
              previewText: '',
              workspace,
            });
            return;
          }

          if (activeWorkspaceFile && isBinaryWorkspaceFile(activeWorkspaceFile)) {
            if (previewRenderJobRef.current !== renderJobId) return;
            clearPreviewObjectUrl();
            setPreviewDisplayMode('binary');
            setPreviewPdfUrl(null);
            setPreviewDocument(buildBinaryPreviewDocument(activeWorkspaceFile));
            previewHasSuccessfulRenderRef.current = true;
            setPreviewStats({ pages: 1, words: 0 });
            setRenderError(null);
            setLatexDiagnostics([]);
            setRenderDiagnostics([]);
            persistSnapshot({
              draft: deferredDraft,
              previewStatus: 'live',
              renderError: null,
              previewText: '',
              workspace,
            });
            return;
          }

          if (activeEditorLanguage !== 'latex') {
            const textPreviewSource = activeWorkspaceFile?.content ?? deferredDraft;
            const previewText = textPreviewSource.replace(/\s+/g, ' ').trim();
            const previewWordCount = previewText.length > 0 ? previewText.split(/\s+/).length : 0;
            if (previewRenderJobRef.current !== renderJobId) return;
            clearPreviewObjectUrl();
            setPreviewDisplayMode('text');
            setPreviewPdfUrl(null);
            setPreviewDocument(
              isCodePreviewLanguage(activeEditorLanguage)
                ? buildCodePreviewDocument(textPreviewSource, activeFilePath, previewTextSize, activeEditorLanguage)
                : buildPlainTextPreviewDocument(textPreviewSource, activeFilePath, previewTextSize),
            );
            previewHasSuccessfulRenderRef.current = true;
            setPreviewStats({ pages: 1, words: previewWordCount });
            setRenderError(null);
            setLatexDiagnostics([]);
            setRenderDiagnostics([]);
            persistSnapshot({
              draft: deferredDraft,
              previewStatus: 'live',
              renderError: null,
              previewText,
              workspace,
            });
            return;
          }

          const result = await fetchThesisRenderPreview({
            draft: deferredDraft,
            workspace,
            activeFilePath,
          }, abortController.signal);

          if (previewRenderJobRef.current !== renderJobId) return;

          const mappedDiagnostics = mapLatexDiagnostics(deferredDraft, result.diagnostics, activeFilePath);
          if (!result.success || !result.pdfBase64) {
            const previewError: LatexPreviewErrorDetails = {
              summary: result.summary,
              details: result.details.length > 0 ? result.details : ['See the compile log in the server response for more detail.'],
              diagnostics: mappedDiagnostics,
            };
            const message = [previewError.summary, ...previewError.details.map((detail) => `- ${detail}`)].join('\n');
            clearPreviewObjectUrl();
            setPreviewDisplayMode('error');
            setPreviewPdfUrl(null);
            setPreviewDocument(buildLatexErrorPreviewDocument(previewError.summary, previewError.details));
            setPreviewStats({ pages: 1, words: 0 });
            setRenderError(message);
            setLatexDiagnostics(previewError.diagnostics);
            setRenderDiagnostics(result.diagnostics);
            persistSnapshot({
              draft: deferredDraft,
              previewStatus: 'error',
              renderError: message,
              workspace,
            });
            return;
          }

          const nextPreviewPdfUrl = createPdfPreviewUrl(result.pdfBase64);
          clearPreviewObjectUrl();
          previewPdfUrlRef.current = nextPreviewPdfUrl;
          previewHasSuccessfulRenderRef.current = true;
          setPreviewDisplayMode('pdf');
          setPreviewPdfUrl(nextPreviewPdfUrl);
          setRenderError(null);
          setLatexDiagnostics(mappedDiagnostics);
          setRenderDiagnostics(result.diagnostics);
          setPreviewStats({ pages: Math.max(1, result.pageCount || 1), words: result.wordCount });
          persistSnapshot({
            draft: deferredDraft,
            previewStatus: 'live',
            renderError: null,
            previewText: result.previewText,
            workspace,
          });
        } catch (error) {
          if (abortController.signal.aborted) return;
          const message = error instanceof Error ? error.message : 'Failed to render LaTeX preview.';
          if (previewRenderJobRef.current !== renderJobId) return;
          clearPreviewObjectUrl();
          setPreviewDisplayMode('error');
          setPreviewPdfUrl(null);
          setPreviewDocument(buildLatexErrorPreviewDocument(message, ['Odyssey could not compile the current LaTeX workspace.']));
          setPreviewStats({ pages: 1, words: 0 });
          setRenderError(message);
          setLatexDiagnostics([]);
          setRenderDiagnostics([]);
          persistSnapshot({
            draft: deferredDraft,
            previewStatus: 'error',
            renderError: message,
            workspace,
          });
        } finally {
          if (previewIndicatorTimeoutRef.current !== null) {
            window.clearTimeout(previewIndicatorTimeoutRef.current);
            previewIndicatorTimeoutRef.current = null;
          }
          if (previewRenderJobRef.current === renderJobId) {
            setIsRendering(false);
          }
        }
      };

      void renderPreview();
    }, activeEditorLanguage === 'latex' ? 650 : 90);

    return () => {
      abortController.abort();
      window.clearTimeout(timeout);
      if (previewIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(previewIndicatorTimeoutRef.current);
        previewIndicatorTimeoutRef.current = null;
      }
    };
  }, [activeEditorLanguage, activeFilePath, activeWorkspaceFile, deferredDraft, previewTextSize, workspace]);

  useEffect(() => {
    applyEditorDiagnostics(latexDiagnostics);
  }, [activeEditorLanguage, draft, latexDiagnostics, sourceLibrary, workspace]);

  useEffect(() => {
    if (autofixHighlights.length === 0) {
      const editor = editorRef.current;
      if (!editor || autofixDecorationIdsRef.current.length === 0) return;
      autofixDecorationIdsRef.current = editor.deltaDecorations(autofixDecorationIdsRef.current, []);
      return;
    }
    applyAutofixDecorations(autofixHighlights);
  }, [activeEditorLanguage, autofixHighlights, draft]);

  useEffect(() => {
    clearAutofixFeedback();
  }, [activeFilePath]);

  const stats = useMemo(() => {
    if (isActiveBinaryFile) {
      return { lines: 0, words: 0 };
    }
    const lines = draft.split('\n').length;
    const words = draft.trim().length > 0 ? draft.trim().split(/\s+/).length : 0;
    return { lines, words };
  }, [draft, isActiveBinaryFile]);

  useEffect(() => {
    if (!expandedPane) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedPane(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedPane]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (previewIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(previewIndicatorTimeoutRef.current);
      }
      clearPreviewObjectUrl();
      if (editorSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(editorSyncFrameRef.current);
      }
      insertSourceActionRef.current?.dispose();
      citationCompletionProviderRef.current?.dispose();
      citationHoverProviderRef.current?.dispose();
      insertSourceContextKeyRef.current = null;
      for (const listener of editorListenersRef.current) {
        listener.dispose();
      }
      editorListenersRef.current = [];
    };
  }, []);

  const resizePreviewPane = (clientX: number) => {
    const splitPane = splitPaneRef.current;
    if (!splitPane) return;

    const bounds = splitPane.getBoundingClientRect();
    const nextWidth = previewOnLeft
      ? ((clientX - bounds.left) / bounds.width) * 100
      : ((bounds.right - clientX) / bounds.width) * 100;
    const clampedWidth = Math.min(MAX_PREVIEW_WIDTH_PERCENT, Math.max(MIN_PREVIEW_WIDTH_PERCENT, nextWidth));
    setPreviewWidthPercent(clampedWidth);
  };

  const resizeExplorerPane = (clientX: number) => {
    const workspaceLayout = workspaceLayoutRef.current;
    if (!workspaceLayout) return;

    const bounds = workspaceLayout.getBoundingClientRect();
    const nextWidth = clientX - bounds.left;
    const clampedWidth = Math.min(MAX_EXPLORER_WIDTH_PX, Math.max(MIN_EXPLORER_WIDTH_PX, nextWidth));
    setExplorerWidthPx(clampedWidth);
  };

  const stopResize = () => {
    setActiveResizeHandle(null);
    activeResizeHandleRef.current = null;
    activePointerIdRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const beginResize = (handle: 'preview' | 'explorer', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    activeResizeHandleRef.current = handle;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveResizeHandle(handle);
    if (handle === 'preview') {
      resizePreviewPane(event.clientX);
    } else {
      resizeExplorerPane(event.clientX);
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (activeResizeHandleRef.current === 'preview') {
      resizePreviewPane(event.clientX);
    } else if (activeResizeHandleRef.current === 'explorer') {
      resizeExplorerPane(event.clientX);
    }
  };

  const handleResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopResize();
  };

  useEffect(() => {
    if (!activeResizeHandle) return;

    const handleWindowBlur = () => {
      const divider = activeResizeHandleRef.current === 'explorer'
        ? explorerDividerRef.current
        : previewDividerRef.current;
      const pointerId = activePointerIdRef.current;
      if (divider && pointerId !== null && divider.hasPointerCapture(pointerId)) {
        divider.releasePointerCapture(pointerId);
      }
      stopResize();
    };

    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, [activeResizeHandle]);

  const renderResizeDivider = (
    handle: 'preview' | 'explorer',
    label: string,
    ref: React.RefObject<HTMLDivElement | null>,
  ) => {
    const isActive = activeResizeHandle === handle;
    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        onPointerDown={(event) => beginResize(handle, event)}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onLostPointerCapture={() => stopResize()}
        className="hidden w-5 shrink-0 select-none xl:flex xl:items-center xl:justify-center"
      >
        <div className="relative flex h-full w-full items-center justify-center">
          <div className={`h-full w-px transition-colors ${isActive ? 'bg-accent/40' : 'bg-border/70'}`} />
          <div
            className={`absolute inline-flex h-10 w-3 cursor-col-resize items-center justify-center rounded-full border transition-colors ${
              isActive
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-border/60 bg-surface/92 text-muted/70'
            }`}
          >
            <GripVertical size={11} />
          </div>
        </div>
      </div>
    );
  };

  const toggleExpandedPane = (pane: PaneId) => {
    setExpandedPane((currentPane) => (currentPane === pane ? null : pane));
  };

  const handleEditorMount = (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    insertSourceActionRef.current?.dispose();
    citationCompletionProviderRef.current?.dispose();
    citationHoverProviderRef.current?.dispose();
    insertSourceContextKeyRef.current = editor.createContextKey(
      'odysseyCitationInsertionFileActive',
      isBibFilePath(activeFilePath) || isTexFilePath(activeFilePath),
    );
    insertSourceActionRef.current = editor.addAction({
      id: 'odyssey.insert-source-from-library',
      label: 'Insert Citation from Sources Library',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.1,
      precondition: 'odysseyCitationInsertionFileActive',
      run: () => {
        setInsertSourceError(null);
        setInsertSourceSearch('');
        setSelectedInsertSourceIds([]);
        setInsertSourceModalOpen(true);
        return;
      },
    });
    citationCompletionProviderRef.current = monaco.languages.registerCompletionItemProvider('latex', {
      triggerCharacters: ['{', ',', '_'],
      provideCompletionItems: (model: MonacoEditor.ITextModel, position: { lineNumber: number; column: number }) => {
        if (!/\.tex$/i.test(model.uri.path)) {
          return { suggestions: [] };
        }

        const citationContext = getLatexCitationContext(model, position);
        if (!citationContext) {
          return { suggestions: [] };
        }

        const normalizedQuery = citationContext.query.trim().toLowerCase();
        const suggestions = collectBibtexCitationSuggestions(
          latestWorkspaceRef.current,
          latestSourceLibraryRef.current,
        )
          .filter((item) => {
            if (!normalizedQuery) return true;
            return item.key.toLowerCase().includes(normalizedQuery)
              || item.title.toLowerCase().includes(normalizedQuery);
          })
          .slice(0, 50)
          .map((item) => ({
            label: item.key,
            kind: monaco.languages.CompletionItemKind.Reference,
            detail: item.entryType,
            documentation: {
              value: `${item.title}\n\n${item.filePath}`,
            },
            insertText: item.key,
            range: citationContext.range,
            filterText: `${item.key} ${item.title}`,
            sortText: item.key,
            commitCharacters: [',', '}'],
          }));

        return { suggestions };
      },
    });
    citationHoverProviderRef.current = monaco.languages.registerHoverProvider('latex', {
      provideHover: (model: MonacoEditor.ITextModel, position: { lineNumber: number; column: number }) => {
        if (!/\.tex$/i.test(model.uri.path)) {
          return null;
        }

        const citationTarget = getLatexCitationKeyAtPosition(model, position);
        if (!citationTarget) {
          return null;
        }

        const citationEntry = collectBibtexCitationSuggestions(
          latestWorkspaceRef.current,
          latestSourceLibraryRef.current,
        ).find((item) => item.key === citationTarget.key);
        if (!citationEntry) {
          return null;
        }

        return {
          range: citationTarget.range,
          contents: [
            {
              value: buildCitationHoverMarkdown(citationEntry),
            },
          ],
        };
      },
    });
    for (const listener of editorListenersRef.current) {
      listener.dispose();
    }
    editorListenersRef.current = [];
    editorListenersRef.current.push(editor.onContextMenu((event) => {
      const position = event.target.position;
      const model = editor.getModel();
      if (!position || !model) return;
      const clickedRange = new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      );
      insertSourceTargetRangeRef.current = {
        filePath: model.uri.path,
        startLineNumber: clickedRange.startLineNumber,
        startColumn: clickedRange.startColumn,
        endLineNumber: clickedRange.endLineNumber,
        endColumn: clickedRange.endColumn,
      };
      editor.setPosition(position);
      editor.setSelection(clickedRange);
      editor.revealPositionInCenterIfOutsideViewport(position);
    }));
    editorListenersRef.current.push(editor.onDidChangeModelContent((event) => {
      const latestChange = event.changes.at(-1);
      const text = latestChange?.text ?? '';
      if ((text !== '{' && text !== ',') || editor.getModel()?.uri.path.match(/\.tex$/i) === null) return;
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;
      if (!getLatexCitationContext(model, position)) return;
      editor.trigger('odyssey-citation-complete', 'editor.action.triggerSuggest', {});
    }));
    applyEditorDiagnostics(latexDiagnostics);
  };

  const toggleInsertSourceSelection = (sourceId: string) => {
    setSelectedInsertSourceIds((currentIds) => (
      currentIds.includes(sourceId)
        ? currentIds.filter((id) => id !== sourceId)
        : [...currentIds, sourceId]
    ));
  };

  const handleConfirmSourceInsert = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) {
      setInsertSourceError('The editor is not ready yet.');
      return;
    }
    if (insertSourceMode === 'unsupported' || !activeFilePath) {
      setInsertSourceError('Open a `.tex` or `.bib` file to insert from the Sources Library.');
      return;
    }
    const selectedSources = sourceLibrary.filter((source) => selectedInsertSourceIds.includes(source.id));
    if (selectedSources.length === 0) {
      setInsertSourceError('Select at least one source to insert.');
      return;
    }

    const pendingInsertRange = insertSourceTargetRangeRef.current;
    const selection = editor.getSelection();
    const range = pendingInsertRange && pendingInsertRange.filePath === model.uri.path
      ? new monacoRef.current!.Range(
          pendingInsertRange.startLineNumber,
          pendingInsertRange.startColumn,
          pendingInsertRange.endLineNumber,
          pendingInsertRange.endColumn,
        )
      : selection ?? new monacoRef.current!.Range(1, 1, 1, 1);
    const sourceText = model.getValue();
    const startOffset = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
    const endOffset = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn });
    const before = sourceText.slice(0, startOffset);
    const after = sourceText.slice(endOffset);
    const nextCurrentFileContent = (() => {
      if (insertSourceMode === 'bib') {
        const usedKeys = collectExistingBibtexKeys(sourceText);
        const insertionMarker = '__ODYSSEY_BIB_INSERTION_POINT__';
        let nextSourceText = `${before}${insertionMarker}${after}`;
        const newEntries: string[] = [];
        for (const source of selectedSources) {
          const entry = buildBibtexEntry(source, bibliographyFormat, usedKeys);
          nextSourceText = removeBibtexEntry(nextSourceText, entry.citationKey, insertionMarker);
          newEntries.push(entry.entryText);
        }
        if (newEntries.length > 0) {
          nextSourceText = insertBibtexEntriesAtMarker(nextSourceText, insertionMarker, newEntries.join('\n\n'));
        } else {
          nextSourceText = nextSourceText.replace(insertionMarker, '');
        }
        return nextSourceText;
      }

      const citationCommand = buildLatexCitationCommand(
        selectedSources.map((source) => source.citeKey),
        bibliographyFormat,
      );
      return `${before}${citationCommand}${after}`;
    })();

    let nextWorkspace = {
      ...workspace,
      files: workspace.files.map((file) => (
        file.path === activeFilePath ? { ...file, content: nextCurrentFileContent } : file
      )),
    } satisfies ThesisWorkspace;

    if (insertSourceMode === 'tex') {
      const referencesFile = findReferencesBibFile(nextWorkspace);
      if (!referencesFile) {
        setInsertSourceError('No `references.bib` file was found in the thesis workspace.');
        return;
      }
      const usedKeys = collectExistingBibtexKeys(referencesFile.content);
      let nextReferencesContent = referencesFile.content;
      for (const source of selectedSources) {
        const entry = buildBibtexEntry(source, bibliographyFormat, usedKeys);
        nextReferencesContent = replaceBibtexEntry(nextReferencesContent, entry.citationKey, entry.entryText);
      }
      if (nextReferencesContent !== referencesFile.content) {
        nextWorkspace = {
          ...nextWorkspace,
          files: nextWorkspace.files.map((file) => (
            file.id === referencesFile.id ? { ...file, content: nextReferencesContent } : file
          )),
        };
      }
    }

    if (insertSourceMode === 'bib') {
      const mainDocumentPath = resolveOverleafMainDocument(nextWorkspace, overleafMainDocument ?? activeFilePath);
      if (!mainDocumentPath) {
        setInsertSourceError('No root `.tex` document was found to register the bibliography entries.');
        return;
      }
      const mainDocument = nextWorkspace.files.find((file) => file.path === mainDocumentPath) ?? null;
      if (!mainDocument) {
        setInsertSourceError('The root `.tex` document could not be found in the workspace.');
        return;
      }
      const nextMainDocumentContent = ensureBibliographyRegistration(
        mainDocument.content,
        selectedSources.map((source) => source.citeKey),
      );
      if (nextMainDocumentContent !== mainDocument.content) {
        nextWorkspace = {
          ...nextWorkspace,
          files: nextWorkspace.files.map((file) => (
            file.path === mainDocument.path ? { ...file, content: nextMainDocumentContent } : file
          )),
        };
      }
    }

    applyWorkspaceUpdate(nextWorkspace, {
      openFileId: workspace.activeFileId,
      selectedNodeId: selectedExplorerNodeIdRef.current,
    });
    insertSourceTargetRangeRef.current = null;
    editor.focus();
    setInsertSourceModalOpen(false);
    setInsertSourceError(null);
    setInsertSourceSearch('');
    setSelectedInsertSourceIds([]);
  };

  const resetVisualHistory = (nextVisualDocument: VisualDocumentModel) => {
    visualHistoryRef.current = [cloneVisualDocument(nextVisualDocument)];
    visualHistoryIndexRef.current = 0;
  };

  const recordVisualHistory = (nextVisualDocument: VisualDocumentModel) => {
    const currentEntry = visualHistoryRef.current[visualHistoryIndexRef.current];
    if (currentEntry && areVisualDocumentsEqual(currentEntry, nextVisualDocument)) return;
    const nextHistory = visualHistoryRef.current.slice(0, visualHistoryIndexRef.current + 1);
    nextHistory.push(cloneVisualDocument(nextVisualDocument));
    visualHistoryRef.current = nextHistory;
    visualHistoryIndexRef.current = nextHistory.length - 1;
  };

  const applyVisualDocument = (nextVisualDocument: VisualDocumentModel, options?: { recordHistory?: boolean }) => {
    const nextState = syncVisualDocumentToWorkspace(nextVisualDocument, workspace, draft);
    if (options?.recordHistory !== false) {
      recordVisualHistory(nextVisualDocument);
    }
    skipNextVisualModelSyncRef.current = true;
    markLocalChangeDuringHydration();
    setVisualDocument(nextVisualDocument);
    const nextWorkspace = nextState.workspace;
    latestWorkspaceRef.current = nextWorkspace;
    setDraft(nextState.draft);
    setWorkspace(nextWorkspace);
    setRenderError(null);
    if (editorRef.current && editorRef.current.getValue() !== nextState.draft) {
      suppressNextEditorChangeRef.current = true;
      editorRef.current.setValue(nextState.draft);
    }
  };

  const restoreVisualDocumentHistory = (direction: 'undo' | 'redo') => {
    const currentIndex = visualHistoryIndexRef.current;
    const nextIndex = direction === 'undo'
      ? Math.max(0, currentIndex - 1)
      : Math.min(visualHistoryRef.current.length - 1, currentIndex + 1);
    if (nextIndex === currentIndex) return;
    visualHistoryIndexRef.current = nextIndex;
    setVisualSelection({ blockId: null, itemIndex: null });
    applyVisualDocument(cloneVisualDocument(visualHistoryRef.current[nextIndex]), { recordHistory: false });
  };

  const updateVisualBlock = (blockId: string, updater: (block: VisualBlock) => VisualBlock) => {
    const next = {
      ...visualDocument,
      blocks: visualDocument.blocks.map((block) => (block.id === blockId ? updater(block) : block)),
    };
    applyVisualDocument(next);
  };

  const updateVisualField = (field: 'title' | 'author' | 'date', html: string) => {
    const normalizedHtml = sanitizeVisualEditableHtml(html);
    const next = { ...visualDocument, [field]: normalizedHtml };
    applyVisualDocument(next);
  };

  const updateVisualBlockHtml = (blockId: string, html: string) => {
    const normalizedHtml = sanitizeVisualEditableHtml(html);
    updateVisualBlock(blockId, (block) => ({ ...block, html: normalizedHtml }));
  };

  const updateVisualListItem = (blockId: string, itemIndex: number, html: string) => {
    const normalizedHtml = sanitizeVisualEditableHtml(html);
    updateVisualBlock(blockId, (block) => ({
      ...block,
      items: (block.items ?? []).map((item, index) => (index === itemIndex ? normalizedHtml : item)),
    }));
  };

  const updateVisualRawBlock = (blockId: string, raw: string) => {
    updateVisualBlock(blockId, (block) => ({ ...block, raw }));
  };

  const getVisualEditableKey = (blockId: string, itemIndex: number | null = null) => (
    itemIndex === null ? blockId : `${blockId}:item:${itemIndex}`
  );

  const captureVisualSelectionHtml = () => {
    if (!visualSelection.blockId) return;
    const key = getVisualEditableKey(visualSelection.blockId, visualSelection.itemIndex);
    const element = visualEditableRefs.current[key];
    if (!element) return;
    if (visualSelection.blockId === '__title__') {
      updateVisualField('title', element.innerHTML);
      return;
    }
    if (visualSelection.blockId === '__author__') {
      updateVisualField('author', element.innerHTML);
      return;
    }
    if (visualSelection.blockId === '__date__') {
      updateVisualField('date', element.innerHTML);
      return;
    }
    if (visualSelection.itemIndex !== null) {
      updateVisualListItem(visualSelection.blockId, visualSelection.itemIndex, element.innerHTML);
      return;
    }
    updateVisualBlockHtml(visualSelection.blockId, element.innerHTML);
  };

  const handleVisualInlineCommand = (command: 'bold' | 'italic' | 'underline') => {
    if (typeof document === 'undefined') return;
    document.execCommand(command);
    window.requestAnimationFrame(captureVisualSelectionHtml);
  };

  const activeVisualBlock = visualSelection.blockId
    ? visualDocument.blocks.find((block) => block.id === visualSelection.blockId) ?? null
    : null;

  const handleVisualBlockTypeChange = (nextKind: 'paragraph' | 'chapter' | 'section' | 'subsection' | 'itemize' | 'enumerate') => {
    if (!activeVisualBlock) return;
    updateVisualBlock(activeVisualBlock.id, (block) => {
      if (nextKind === 'itemize' || nextKind === 'enumerate') {
        const firstItem = block.kind === 'itemize' || block.kind === 'enumerate'
          ? (block.items?.[0] ?? '')
          : (block.html ?? '');
        return {
          ...block,
          kind: nextKind,
          items: [firstItem],
        };
      }
      if (block.kind === 'itemize' || block.kind === 'enumerate') {
        return {
          ...block,
          kind: nextKind,
          html: block.items?.join('<br />') ?? '',
        };
      }
      return { ...block, kind: nextKind };
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.ctrlKey || event.metaKey;
      if (!isModifierPressed || event.altKey) return;
      const normalizedKey = event.key.toLowerCase();
      const isUndo = normalizedKey === 'z' && !event.shiftKey;
      const isRedo = normalizedKey === 'y' || (normalizedKey === 'z' && event.shiftKey);
      if (!isUndo && !isRedo) return;

      if (overleafEditorMode === 'source') {
        if (!editorRef.current?.hasTextFocus()) return;
        event.preventDefault();
        editorRef.current.trigger('keyboard', isUndo ? 'undo' : 'redo', null);
        return;
      }

      if (overleafEditorMode !== 'visual') return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!visualEditorRootRef.current?.contains(target)) return;
      event.preventDefault();
      restoreVisualDocumentHistory(isUndo ? 'undo' : 'redo');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [overleafEditorMode]);

  const renderVisualEditor = () => {
    if (activeEditorLanguage !== 'latex' || !visualDocument.canEdit) {
      return (
        <div className="flex h-full items-center justify-center bg-surface px-6 text-center text-sm text-muted">
          Visual mode currently requires an active LaTeX document with a standard <code>\begin{'{'}document{'}'}</code> structure.
        </div>
      );
    }

    return (
      <div ref={visualEditorRootRef} className="flex h-full min-h-0 flex-col bg-surface text-heading">
        <div className="border-b border-border bg-surface2/85 px-4 py-3 backdrop-blur-[2px]">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={
                activeVisualBlock
                  ? activeVisualBlock.kind === 'chapter'
                    ? 'chapter'
                    : activeVisualBlock.kind === 'section'
                    ? 'section'
                    : activeVisualBlock.kind === 'subsection'
                      ? 'subsection'
                      : activeVisualBlock.kind === 'enumerate'
                        ? 'enumerate'
                        : activeVisualBlock.kind === 'itemize'
                          ? 'itemize'
                          : 'paragraph'
                  : 'paragraph'
              }
              onChange={(event) => handleVisualBlockTypeChange(event.target.value as 'paragraph' | 'chapter' | 'section' | 'subsection' | 'itemize' | 'enumerate')}
              className="rounded-xl border border-border bg-paper px-3 py-1.5 text-xs font-semibold text-heading shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] focus:outline-none focus:border-accent"
            >
              <option value="paragraph">Normal text</option>
              <option value="chapter">Chapter heading</option>
              <option value="section">Section heading</option>
              <option value="subsection">Subsection</option>
              <option value="itemize">Bulleted list</option>
              <option value="enumerate">Numbered list</option>
            </select>

            <button
              type="button"
              onClick={() => handleVisualInlineCommand('bold')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-paper text-sm font-black text-heading transition-colors hover:bg-surface2"
              aria-label="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => handleVisualInlineCommand('italic')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-paper text-sm italic text-heading transition-colors hover:bg-surface2"
              aria-label="Italic"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => handleVisualInlineCommand('underline')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-paper text-xs underline text-heading transition-colors hover:bg-surface2"
              aria-label="Underline"
            >
              U
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setVisualPreambleVisible((current) => !current)}
                className="rounded-full border border-border bg-paper px-4 py-2 text-xs font-semibold text-heading transition-colors hover:bg-surface"
              >
                {visualPreambleVisible ? 'Hide document preamble' : 'Show document preamble'}
              </button>
              <div className="rounded-full border border-accent3/20 bg-accent3/10 px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-accent3">
                Editing
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 overflow-hidden text-xs text-muted">
            <span className="truncate">{activeFilePath?.split('/').join(' › ') ?? 'Untitled'}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-bg px-3 py-4 sm:px-4">
          {visualPreambleVisible && (
            <div className="mx-auto mb-4 max-w-5xl rounded-2xl border border-border bg-surface p-4 shadow-[0_16px_44px_rgba(15,31,51,0.08)]">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Document Preamble</p>
              <textarea
                value={visualDocument.preamble}
                onChange={(event) => {
                  const next = { ...visualDocument, preamble: event.target.value };
                  applyVisualDocument(next);
                }}
                className="min-h-[140px] w-full rounded-xl border border-border bg-paper px-4 py-3 font-mono text-xs text-heading focus:outline-none focus:border-accent"
              />
            </div>
          )}

          <div className="mx-auto grid max-w-5xl grid-cols-[4rem_minmax(0,1fr)] gap-4">
            <div className="hidden pt-20 pr-2 text-right font-mono text-[9px] text-muted/60 md:block">
              {Array.from({ length: Math.max(visualDocument.blocks.length + 12, 24) }, (_, index) => (
                <div key={`visual-line-${index + 1}`} className="h-6.5 leading-[1.625rem]">
                  {index + 1}
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-border bg-paper px-5 py-5 shadow-[0_22px_60px_rgba(15,31,51,0.12)] sm:px-8 sm:py-6">
              <div className="mx-auto max-w-[44rem]">
                <div className="mb-7 text-center text-heading">
                  <div
                    ref={(element) => {
                      visualEditableRefs.current.__title__ = element;
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: visualDocument.title || 'Untitled document' }}
                    onFocus={() => setVisualSelection({ blockId: '__title__', itemIndex: null })}
                    onInput={(event) => updateVisualField('title', event.currentTarget.innerHTML)}
                    className="outline-none font-serif text-[1.8rem] font-semibold leading-[1.18] sm:text-[2.2rem]"
                  />
                  <div
                    ref={(element) => {
                      visualEditableRefs.current.__author__ = element;
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: visualDocument.author || 'Author' }}
                    onFocus={() => setVisualSelection({ blockId: '__author__', itemIndex: null })}
                    onInput={(event) => updateVisualField('author', event.currentTarget.innerHTML)}
                    className="mt-3 outline-none text-[0.95rem] font-semibold sm:text-[1.02rem]"
                  />
                  <div
                    ref={(element) => {
                      visualEditableRefs.current.__date__ = element;
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: visualDocument.date || '\\today' }}
                    onFocus={() => setVisualSelection({ blockId: '__date__', itemIndex: null })}
                    onInput={(event) => updateVisualField('date', event.currentTarget.innerHTML)}
                    className="mt-2 outline-none text-[10px] tracking-[0.12em] text-muted"
                  />
                </div>

                <div className="space-y-4">
                  {visualDocument.blocks.map((block) => {
                    if (block.kind === 'chapter' || block.kind === 'section' || block.kind === 'subsection' || block.kind === 'paragraph' || block.kind === 'abstract') {
                      const key = getVisualEditableKey(block.id);
                      const textClassName = block.kind === 'chapter'
                        ? 'font-serif text-[2rem] font-semibold leading-[1.16] text-heading sm:text-[2.2rem]'
                        : block.kind === 'section'
                        ? 'font-serif text-[1.7rem] font-semibold leading-[1.2] text-heading sm:text-[1.82rem]'
                        : block.kind === 'subsection'
                          ? 'font-serif text-[1.35rem] font-semibold leading-[1.24] text-heading sm:text-[1.46rem]'
                          : block.kind === 'abstract'
                            ? 'rounded-xl border border-border bg-surface/80 px-4 py-3.5 text-[13px] leading-6 text-heading/90'
                            : 'text-[13px] leading-6 text-heading/90';
                      return (
                        <div key={block.id}>
                          {block.kind === 'abstract' && (
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Abstract</p>
                          )}
                          <div
                            ref={(element) => {
                              visualEditableRefs.current[key] = element;
                            }}
                            contentEditable
                            suppressContentEditableWarning
                            dangerouslySetInnerHTML={{ __html: block.html ?? '' }}
                            onFocus={() => setVisualSelection({ blockId: block.id, itemIndex: null })}
                            onInput={(event) => updateVisualBlockHtml(block.id, event.currentTarget.innerHTML)}
                            className={`outline-none ${textClassName}`}
                          />
                        </div>
                      );
                    }

                    if (block.kind === 'itemize' || block.kind === 'enumerate') {
                      const ListTag = block.kind === 'enumerate' ? 'ol' : 'ul';
                      return (
                        <div key={block.id}>
                          <ListTag className={`space-y-2 pl-5 text-[13px] leading-6 text-heading/90 ${block.kind === 'enumerate' ? 'list-decimal' : 'list-disc'}`}>
                            {(block.items ?? []).map((item, itemIndex) => {
                              const key = getVisualEditableKey(block.id, itemIndex);
                              return (
                                <li key={key}>
                                  <div
                                    ref={(element) => {
                                      visualEditableRefs.current[key] = element;
                                    }}
                                    contentEditable
                                    suppressContentEditableWarning
                                    dangerouslySetInnerHTML={{ __html: item }}
                                    onFocus={() => setVisualSelection({ blockId: block.id, itemIndex })}
                                    onInput={(event) => updateVisualListItem(block.id, itemIndex, event.currentTarget.innerHTML)}
                                    className="outline-none"
                                  />
                                </li>
                              );
                            })}
                          </ListTag>
                        </div>
                      );
                    }

                    return (
                      <div key={block.id} className="rounded-xl border border-border bg-surface p-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Raw LaTeX block</p>
                        <textarea
                          value={block.raw ?? ''}
                          onFocus={() => setVisualSelection({ blockId: block.id, itemIndex: null })}
                          onChange={(event) => updateVisualRawBlock(block.id, event.target.value)}
                          className="min-h-[132px] w-full rounded-xl border border-border bg-paper px-4 py-3 font-mono text-xs text-heading focus:outline-none focus:border-accent"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleOpenInOverleaf = async () => {
    if (workspace.files.length === 0) {
      setOverleafError('There are no thesis files to export.');
      return;
    }

    setIsOpeningInOverleaf(true);
    setOverleafError(null);

    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();

      for (const file of workspace.files) {
        addWorkspaceFileToZip(zip, file);
      }

      const archive = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const fields: Record<string, string> = {
        snip_uri: `data:application/zip;base64,${uint8ArrayToBase64(archive)}`,
      };

      if (overleafMainDocument) {
        fields.main_document = overleafMainDocument;
      }
      if (overleafEngine !== 'auto') {
        fields.engine = overleafEngine;
      }
      if (overleafEditorMode === 'visual') {
        fields.visual_editor = 'true';
      }

      submitOverleafImportForm(fields);
    } catch (error) {
      setOverleafError(error instanceof Error ? error.message : 'Failed to prepare Overleaf export.');
    } finally {
      setIsOpeningInOverleaf(false);
    }
  };

  const showToolbarTooltip = (target: HTMLElement, label: string, tone: ToolbarTooltipTone = 'default') => {
    toolbarTooltipAnchorRef.current = target;
    const bounds = target.getBoundingClientRect();
    setToolbarTooltip({
      label,
      tone,
      top: bounds.bottom + 8,
      left: Math.min(window.innerWidth - 16, Math.max(16, bounds.left + (bounds.width / 2))),
    });
  };

  const hideToolbarTooltip = () => {
    toolbarTooltipAnchorRef.current = null;
    setToolbarTooltip(null);
  };

  const closeOverleafPreferences = () => {
    setIsOverleafPreferencesOpen(false);
  };

  const togglePaneMetaCollapsed = () => {
    setPaneMetaCollapsed((current) => !current);
  };

  const getToolbarTooltipProps = (label: string, tone: ToolbarTooltipTone = 'default') => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      showToolbarTooltip(event.currentTarget, label, tone);
    },
    onMouseLeave: hideToolbarTooltip,
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      showToolbarTooltip(event.currentTarget, label, tone);
    },
    onBlur: hideToolbarTooltip,
  });

  const renderPaneControls = (pane: PaneId) => (
    <button
      type="button"
      onClick={() => toggleExpandedPane(pane)}
      aria-label={expandedPane === pane ? 'Collapse pane' : 'Expand pane'}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-surface text-heading transition-colors hover:bg-surface hover:text-heading"
      {...getToolbarTooltipProps(expandedPane === pane ? 'Collapse' : 'Expand')}
    >
      {expandedPane === pane ? <Minimize2 size={12} /> : <Expand size={12} />}
    </button>
  );

  const renderSubbarToggle = (placement: 'header' | 'subbar') => (
    <button
      type="button"
      onClick={togglePaneMetaCollapsed}
      aria-label={paneMetaCollapsed ? 'Show pane details' : 'Hide pane details'}
      aria-pressed={paneMetaCollapsed}
      className={
        placement === 'subbar'
          ? 'absolute left-0 top-0 z-10 inline-flex h-full w-10 items-center justify-center border-r border-border bg-surface2 text-muted transition-colors hover:bg-surface hover:text-heading'
          : 'absolute left-0 top-0 z-10 inline-flex h-full w-10 items-center justify-center border-r border-border bg-surface2 text-muted transition-colors hover:bg-surface hover:text-heading'
      }
      {...getToolbarTooltipProps(paneMetaCollapsed ? 'Show details' : 'Hide details')}
    >
      {paneMetaCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
    </button>
  );

  const adjustPreviewPage = (delta: number) => {
    setPreviewPage((currentPage) => Math.min(Math.max(1, currentPage + delta), Math.max(1, previewStats.pages)));
  };

  const adjustPreviewZoom = (delta: 1 | -1) => {
    const currentIndex = PREVIEW_ZOOM_OPTIONS.findIndex((option) => option === previewZoom);
    if (currentIndex === -1) {
      setPreviewZoom(DEFAULT_PREVIEW_ZOOM);
      return;
    }
    const nextIndex = Math.min(
      PREVIEW_ZOOM_OPTIONS.length - 1,
      Math.max(0, currentIndex + delta),
    );
    setPreviewZoom(PREVIEW_ZOOM_OPTIONS[nextIndex] ?? DEFAULT_PREVIEW_ZOOM);
  };

  const adjustPreviewTextSize = (delta: 1 | -1) => {
    const currentIndex = PREVIEW_TEXT_SIZE_OPTIONS.findIndex((option) => option === previewTextSize);
    if (currentIndex === -1) {
      setPreviewTextSize(DEFAULT_PREVIEW_TEXT_SIZE);
      return;
    }
    const nextIndex = Math.min(
      PREVIEW_TEXT_SIZE_OPTIONS.length - 1,
      Math.max(0, currentIndex + delta),
    );
    setPreviewTextSize(PREVIEW_TEXT_SIZE_OPTIONS[nextIndex] ?? DEFAULT_PREVIEW_TEXT_SIZE);
  };

  const renderPreviewPane = () => (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-surface">
      <div className="relative flex min-h-[56px] items-center justify-between gap-4 border-b border-border bg-surface2 px-4 py-2">
        <div className="flex items-center gap-2 pl-8">
          <FileText size={15} className="text-accent" />
          <h2 className="font-sans text-sm font-bold text-heading">Document Preview</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em]">
            {isRendering ? (
              <span className="inline-flex items-center gap-1.5 text-accent">
                <Loader2 size={11} className="animate-spin" />
                Rendering
              </span>
            ) : renderError ? (
              <>
                {availableAutofix ? (
                  <button
                    type="button"
                    onClick={handleAutofixRenderFailure}
                    disabled={isApplyingAutofix}
                    className="inline-flex items-center gap-1.5 border border-emerald-500/30 bg-emerald-500/12 px-2.5 py-1 text-emerald-700 transition-colors hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isApplyingAutofix ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    Autofix
                  </button>
                ) : null}
                <span className="inline-flex items-center gap-1.5 border border-danger/30 bg-danger/8 px-2 py-1 text-danger">
                  <FileText size={11} />
                  Render Failed
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 border border-accent2/30 bg-accent2/8 px-2 py-1 text-accent2">
                <CheckCircle2 size={11} />
                Render Success
              </span>
            )}
          </div>
          {renderPaneControls('preview')}
        </div>
        {paneMetaCollapsed && renderSubbarToggle('header')}
      </div>

      {!paneMetaCollapsed && (
        <div className="relative flex items-center gap-3 border-b border-border px-4 py-1 pl-12 text-[11px] font-medium text-heading">
          {renderSubbarToggle('subbar')}
          <div className="min-w-[5.5rem] pr-2 text-left">
            {previewStats.pages} page{previewStats.pages === 1 ? '' : 's'}
          </div>
          <div className="flex flex-1 items-center justify-center gap-4">
            <div className="inline-flex h-7 shrink-0 items-center border border-border bg-surface">
              <button
                type="button"
                onClick={() => adjustPreviewPage(-1)}
                aria-label="Previous page"
                disabled={!canControlPdfPreview || previewPage <= 1}
                className="inline-flex h-full w-7 items-center justify-center text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:text-muted/50"
                {...getToolbarTooltipProps('Previous page')}
              >
                <ChevronUp size={11} />
              </button>
              <div className="min-w-[4.25rem] border-x border-border px-2 text-center text-[11px] font-semibold text-heading">
                {previewPage} / {Math.max(1, previewStats.pages)}
              </div>
              <button
                type="button"
                onClick={() => adjustPreviewPage(1)}
                aria-label="Next page"
                disabled={!canControlPdfPreview || previewPage >= previewStats.pages}
                className="inline-flex h-full w-7 items-center justify-center text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:text-muted/50"
                {...getToolbarTooltipProps('Next page')}
              >
                <ChevronDown size={11} />
              </button>
            </div>

            <div className="min-w-[7rem] text-center">
              {previewStats.words} words
            </div>
            <div className="inline-flex h-7 shrink-0 items-center border border-border bg-surface">
              <button
                type="button"
                onClick={() => (canControlTextPreview ? adjustPreviewTextSize(-1) : adjustPreviewZoom(-1))}
                aria-label={canControlTextPreview ? 'Decrease text size' : 'Zoom out'}
                disabled={canControlTextPreview
                  ? previewTextSize <= PREVIEW_TEXT_SIZE_OPTIONS[0]
                  : (!canControlPdfPreview || previewZoom <= PREVIEW_ZOOM_OPTIONS[0])}
                className="inline-flex h-full w-7 items-center justify-center text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:text-muted/50"
                {...getToolbarTooltipProps(canControlTextPreview ? 'Decrease text size' : 'Zoom out')}
              >
                <Minus size={11} />
              </button>
              <label className="flex h-full items-center border-x border-border bg-surface px-2">
                <span className="sr-only">{canControlTextPreview ? 'Preview text size' : 'Preview zoom'}</span>
                <select
                  value={canControlTextPreview ? previewTextSize : previewZoom}
                  onChange={(event) => {
                    if (canControlTextPreview) {
                      setPreviewTextSize(Number(event.target.value));
                    } else {
                      setPreviewZoom(Number(event.target.value));
                    }
                  }}
                  disabled={canControlTextPreview ? false : !canControlPdfPreview}
                  className="h-full min-w-[5rem] bg-transparent text-center text-[11px] font-semibold text-heading focus:outline-none disabled:cursor-not-allowed disabled:text-muted/60"
                >
                  {canControlTextPreview
                    ? PREVIEW_TEXT_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option} pt
                      </option>
                    ))
                    : PREVIEW_ZOOM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}%
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => (canControlTextPreview ? adjustPreviewTextSize(1) : adjustPreviewZoom(1))}
                aria-label={canControlTextPreview ? 'Increase text size' : 'Zoom in'}
                disabled={canControlTextPreview
                  ? previewTextSize >= PREVIEW_TEXT_SIZE_OPTIONS[PREVIEW_TEXT_SIZE_OPTIONS.length - 1]
                  : (!canControlPdfPreview || previewZoom >= PREVIEW_ZOOM_OPTIONS[PREVIEW_ZOOM_OPTIONS.length - 1])}
                className="inline-flex h-full w-7 items-center justify-center text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:text-muted/50"
                {...getToolbarTooltipProps(canControlTextPreview ? 'Increase text size' : 'Zoom in')}
              >
                <Plus size={11} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-white p-3 sm:p-4 xl:p-5">
        {previewPdfUrl ? (
          <iframe
            key={previewPdfUrl}
            ref={previewIframeRef}
            title="Live thesis paper preview"
            src={previewFrameSrc ?? undefined}
            className="h-full min-h-[420px] w-full border border-border bg-white"
          />
        ) : (
          <iframe
            title="Live thesis paper preview"
            srcDoc={previewDocument}
            className="h-full min-h-[420px] w-full border border-border bg-white"
          />
        )}
      </div>
    </section>
  );

  const renderEditorPane = () => (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-surface">
      <div className="relative flex min-h-[56px] items-center justify-between gap-4 border-b border-border bg-surface2 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5 pl-8">
          <Sparkles size={15} className="text-accent2" />
          <h2 className="font-sans text-sm font-bold text-heading">{activeEditorLanguage === 'latex' ? 'LaTeX Editor' : 'Source Editor'}</h2>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <div className="inline-flex h-9 shrink-0 items-center gap-1.5 border border-border bg-surface px-2.5 text-[10px] font-mono uppercase tracking-[0.16em] text-heading">
            {remoteSaveState === 'saving' ? (
              <>
                <Loader2 size={11} className="animate-spin text-accent" />
                Saving
              </>
            ) : remoteSaveState === 'error' ? (
              <>
                <FileText size={11} className="text-danger" />
                Save Failed
              </>
            ) : hasUnsavedChanges ? (
              <>
                <FileText size={11} className="text-amber-600" />
                Pending
              </>
            ) : remoteSaveState === 'idle' ? (
              <>
                <FileText size={11} className="text-muted" />
                Autosave
              </>
            ) : (
              <>
                <CheckCircle2 size={11} className="text-accent2" />
                Saved
              </>
            )}
          </div>

          <div ref={overleafPreferencesRef} className="relative shrink-0">
            <button
              ref={overleafPreferencesButtonRef}
              type="button"
              onClick={() => setIsOverleafPreferencesOpen((current) => !current)}
              aria-label="Open Overleaf preferences"
              className="inline-flex h-9 w-9 items-center justify-center border border-border bg-surface text-heading transition-colors hover:bg-surface2"
              {...getToolbarTooltipProps('Settings')}
            >
              <Settings2 size={14} className="text-accent2" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleOpenInOverleaf()}
            aria-label="Open in Overleaf"
            disabled={isOpeningInOverleaf || workspace.files.length === 0}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-[#138a41]/30 bg-[#138a41]/10 text-[#138a41] transition-colors hover:bg-[#138a41]/16 disabled:cursor-not-allowed disabled:opacity-60"
            {...getToolbarTooltipProps('Open in Overleaf', 'success')}
          >
            {isOpeningInOverleaf ? <Loader2 size={12} className="animate-spin" /> : <Leaf size={13} />}
          </button>

          {renderPaneControls('editor')}
        </div>
        {paneMetaCollapsed && renderSubbarToggle('header')}
      </div>

      {remoteSaveState === 'error' && remoteSaveMessage && (
        <div className="border-b border-danger/30 bg-danger/5 px-5 py-3 text-xs text-danger">
          Thesis autosave failed. {remoteSaveMessage}
        </div>
      )}

      {remoteSaveState !== 'error' && remoteRepoWarning && (
        <div className="border-b border-amber-300/50 bg-amber-50 px-5 py-3 text-xs text-amber-900">
          Repository mirror warning. {remoteRepoWarning}
        </div>
      )}

      {overleafError && (
        <div className="border-b border-danger/30 bg-danger/5 px-5 py-3 text-xs text-danger">
          Overleaf export failed. {overleafError}
        </div>
      )}

      {isOverleafPreferencesOpen && (
        <div
          ref={overleafPreferencesRef}
          className="fixed z-50 w-64 border border-border bg-surface2 p-3 shadow-2xl"
          style={{ top: `${overleafPreferencesPosition.top}px`, right: `${overleafPreferencesPosition.right}px` }}
        >
          <div className="space-y-3">
            <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
              Theme
              <select
                value={editorTheme}
                onChange={(event) => {
                  setEditorTheme(normalizeEditorThemeId(event.target.value));
                  closeOverleafPreferences();
                }}
                onChangeCapture={() => markLocalChangeDuringHydration()}
                className="mt-1.5 w-full border border-border bg-surface px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-heading focus:outline-none"
              >
                {editorThemes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
              Engine
              <select
                value={overleafEngine}
                onChange={(event) => {
                  setOverleafEngine(event.target.value as ThesisOverleafEngine);
                  closeOverleafPreferences();
                }}
                className="mt-1.5 w-full border border-border bg-surface px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-heading focus:outline-none"
              >
                {overleafEngineOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
              Mode
              <select
                value={overleafEditorMode}
                onChange={(event) => {
                  setOverleafEditorMode(event.target.value as ThesisOverleafEditorMode);
                  closeOverleafPreferences();
                }}
                className="mt-1.5 w-full border border-border bg-surface px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-heading focus:outline-none"
              >
                {overleafEditorModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
              Layout
              <select
                value={paneLayout}
                onChange={(event) => {
                  setPaneLayout(event.target.value as ThesisPaneLayout);
                  closeOverleafPreferences();
                }}
                className="mt-1.5 w-full border border-border bg-surface px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-heading focus:outline-none"
              >
                {thesisPaneLayoutOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {!paneMetaCollapsed && (
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-1.5 pl-12 text-[11px] font-medium text-heading">
          {renderSubbarToggle('subbar')}
          <span>{stats.lines} lines</span>
          <span>{stats.words} words</span>
          <span>Language: {activeEditorLanguage}</span>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {overleafEditorMode === 'visual' ? (
          renderVisualEditor()
        ) : (
          <Editor
            height="100%"
            defaultLanguage={activeEditorLanguage}
            language={activeEditorLanguage}
            defaultValue={editorValue}
            theme={editorTheme}
            beforeMount={configureLatexMonaco}
            onMount={handleEditorMount}
            onChange={(value) => {
              if (isActiveBinaryFile) return;
              if (suppressNextEditorChangeRef.current) {
                suppressNextEditorChangeRef.current = false;
                return;
              }
              if (autofixHighlights.length > 0) {
                clearAutofixFeedback();
              }
              const nextDraft = value ?? '';
              markLocalChangeDuringHydration();
              const nextWorkspace = syncWorkspaceDraft(nextDraft);
              latestWorkspaceRef.current = nextWorkspace;
              setDraft(nextDraft);
              setWorkspace(nextWorkspace);
              updateActiveFilePersistedState(getThesisWorkspaceActiveFile(nextWorkspace), nextWorkspace);
            }}
            options={{
              minimap: { enabled: false },
              glyphMargin: false,
              fontSize: 14,
              fontLigatures: true,
              lineNumbersMinChars: 3,
              padding: { top: 18, bottom: 18 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              tabSize: 2,
              wordWrap: 'on',
              wrappingIndent: 'indent',
              overviewRulerBorder: false,
              renderValidationDecorations: 'on',
              renderLineHighlight: 'line',
              cursorBlinking: 'smooth',
              automaticLayout: true,
              readOnly: isActiveBinaryFile,
            }}
          />
        )}
      </div>
    </section>
  );

  return (
    <div className="min-h-[calc(100vh-12rem)]">
      <style>{AUTOFIX_EDITOR_DECORATION_CSS}</style>
      {insertSourceModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[2px]"
          onMouseDown={() => {
            setInsertSourceModalOpen(false);
            setInsertSourceError(null);
            insertSourceTargetRangeRef.current = null;
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="insert-source-modal-title"
            className="flex max-h-[min(46rem,calc(100vh-3rem))] w-full max-w-4xl flex-col overflow-hidden border border-border bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border bg-surface2 px-5 py-4">
              <div className="min-w-0">
                <h2 id="insert-source-modal-title" className="text-sm font-semibold uppercase tracking-[0.18em] text-heading">
                  Insert Citation from Sources Library
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {insertSourceMode === 'bib'
                    ? 'Select one or more saved sources to insert into the active `.bib` file. Odyssey will also add `\\nocite{*}` to the root LaTeX document so the NPS bibliography can render everything currently saved in `references.bib` without a visible in-text citation.'
                    : insertSourceMode === 'tex'
                      ? 'Select one or more saved sources to cite in the active `.tex` file. Odyssey will also add any missing entries to `references.bib`.'
                      : 'Open a `.tex` or `.bib` file to insert from the Sources Library.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInsertSourceModalOpen(false);
                  setInsertSourceError(null);
                  insertSourceTargetRangeRef.current = null;
                }}
                className="inline-flex h-9 w-9 items-center justify-center border border-border bg-surface text-heading transition-colors hover:bg-surface2"
                aria-label="Close citation insertion window"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.9fr)]">
              <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
                <div className="border-b border-border px-5 py-4">
                  <label className="flex items-center gap-2 border border-border bg-surface px-3 py-2 text-xs text-muted">
                    <Search size={14} className="text-accent" />
                    <input
                      autoFocus
                      type="search"
                      value={insertSourceSearch}
                      onChange={(event) => setInsertSourceSearch(event.target.value)}
                      placeholder="Search sources library"
                      className="w-full bg-transparent text-sm text-heading outline-none placeholder:text-muted"
                    />
                  </label>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {filteredInsertSources.length > 0 ? (
                    <div className="space-y-2">
                      {filteredInsertSources.map((source) => {
                        const isSelected = selectedInsertSourceIds.includes(source.id);
                        return (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => {
                              setInsertSourceError(null);
                              toggleInsertSourceSelection(source.id);
                            }}
                            className={`w-full border px-4 py-3 text-left transition-colors ${
                              isSelected
                                ? 'border-accent bg-accent/8'
                                : 'border-border bg-surface hover:border-accent/35 hover:bg-surface2'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center border ${
                                isSelected ? 'border-accent bg-accent text-[var(--color-accent-fg)]' : 'border-border bg-surface'
                              }`}>
                                {isSelected ? <CheckCircle2 size={12} /> : null}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="text-sm font-semibold text-heading">{source.title}</span>
                                  <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                                    {source.type}
                                  </span>
                                  {source.year.trim() ? (
                                    <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                                      {source.year}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-muted">
                                  {[source.credit, source.venue].filter((value) => value.trim().length > 0).join(' • ') || 'No author or venue metadata yet.'}
                                </p>
                                {source.tags.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {source.tags.slice(0, 5).map((tag) => (
                                      <span
                                        key={`${source.id}-${tag}`}
                                        className="border border-border bg-surface2 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[16rem] items-center justify-center px-6 text-center text-sm text-muted">
                      No sources match this search.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-col bg-surface2/40">
                <div className="border-b border-border px-5 py-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                    {selectedInsertSources.length} selected
                  </p>
                  <p className="mt-1 text-sm font-semibold text-heading">Ready to insert</p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {selectedInsertSources.length > 0 ? (
                    <div className="space-y-4">
                      {selectedInsertSources.map((source) => (
                        <div key={`selected-${source.id}`} className="border border-border bg-surface px-4 py-3">
                          <p className="text-sm font-semibold text-heading">{source.title}</p>
                          <p className="mt-1 text-xs text-muted">
                            {[source.credit, source.venue, source.year].filter((value) => value.trim().length > 0).join(' • ') || 'Metadata will be inferred where possible.'}
                          </p>
                          {source.abstract.trim() ? (
                            <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-muted">{source.abstract}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[16rem] items-center justify-center text-center text-sm text-muted">
                      Choose one or more entries from the Sources Library.
                    </div>
                  )}
                </div>

                <div className="border-t border-border px-5 py-4">
                  {insertSourceError ? (
                    <div className="mb-3 border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                      {insertSourceError}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setInsertSourceModalOpen(false);
                        setInsertSourceError(null);
                        insertSourceTargetRangeRef.current = null;
                      }}
                      className="inline-flex h-10 items-center justify-center border border-border bg-surface px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-heading transition-colors hover:bg-surface2"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmSourceInsert}
                      className="odyssey-fill-accent inline-flex h-10 min-w-[11rem] items-center justify-center px-4 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors hover:opacity-90"
                    >
                      {insertSourceMode === 'bib' ? 'Insert Entries' : 'Insert Citation'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {toolbarTooltip && (
        <div
          className={`pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] shadow-lg ${
            toolbarTooltip.tone === 'success'
              ? 'border-[#138a41]/45 bg-[#163f2a] text-[#2fd477]'
              : 'border-border bg-surface2 text-heading'
          }`}
          style={{ top: `${toolbarTooltip.top}px`, left: `${toolbarTooltip.left}px` }}
        >
          {toolbarTooltip.label}
        </div>
      )}
      {expandedPane ? (
        <div className="fixed inset-0 z-50 bg-paper px-3 py-3 sm:px-6 sm:py-6">
          <div className="h-full min-h-0">
            {expandedPane === 'preview' ? renderPreviewPane() : renderEditorPane()}
          </div>
        </div>
      ) : (
        <div
          ref={workspaceLayoutRef}
          className="flex min-h-[calc(100vh-12rem)] min-w-0 flex-col gap-4 xl:h-[calc(100vh-12rem)] xl:min-h-[760px] xl:min-w-0 xl:flex-row xl:gap-0"
        >
          <div
            className={explorerCollapsed ? 'w-full xl:min-h-0 xl:w-auto xl:shrink-0' : 'w-full xl:min-h-0 xl:shrink-0'}
            style={explorerCollapsed
              ? undefined
              : ({
                  width: `${explorerWidthPx}px`,
                  flexBasis: `${explorerWidthPx}px`,
                } as CSSProperties)}
          >
            <ThesisFileExplorer
              collapsed={explorerCollapsed}
              workspace={workspace}
              activeFileId={workspace.activeFileId}
              selectedNodeId={selectedExplorerNodeId}
              savedFileIds={savedFileIds}
              onOpenFile={openWorkspaceFile}
              onWorkspaceChange={(nextWorkspace, options) => {
                applyWorkspaceUpdate(nextWorkspace, {
                  openFileId: options?.openFileId ?? null,
                  selectedNodeId: options?.selectedNodeId ?? null,
                });
              }}
              onDeleteSelectionSnapshot={(workspaceBefore, options) => {
                pushUndoAction({
                  label: 'Deleted thesis explorer selection',
                  undo: () => {
                    applyWorkspaceUpdate(workspaceBefore, {
                      openFileId: workspaceBefore.activeFileId,
                      selectedNodeId: options.selectedNodeId,
                    });
                  },
                });
              }}
              onSelectedNodeIdChange={setSelectedExplorerNodeId}
              onToggleCollapsed={() => setExplorerCollapsed((current) => !current)}
            />
          </div>
          {!explorerCollapsed && renderResizeDivider('explorer', 'Resize explorer and workspace panes', explorerDividerRef)}
          <div
            ref={splitPaneRef}
            className="flex min-h-[calc(100vh-12rem)] min-w-0 flex-1 flex-col gap-6 xl:h-[calc(100vh-12rem)] xl:min-h-[760px] xl:min-w-0 xl:flex-row xl:gap-0"
          >
            {previewOnLeft ? (
              <>
                <div className="min-h-[420px] xl:min-h-0 xl:min-w-0 xl:shrink-0" style={{ flexBasis: `${previewWidthPercent}%` }}>
                  {renderPreviewPane()}
                </div>

                {renderResizeDivider('preview', 'Resize preview and editor panes', previewDividerRef)}

                <div className="min-h-[460px] xl:min-h-0 xl:min-w-0 xl:flex-1">
                  {renderEditorPane()}
                </div>
              </>
            ) : (
              <>
                <div className="min-h-[460px] xl:min-h-0 xl:min-w-0 xl:flex-1">
                  {renderEditorPane()}
                </div>

                {renderResizeDivider('preview', 'Resize preview and editor panes', previewDividerRef)}

                <div className="min-h-[420px] xl:min-h-0 xl:min-w-0 xl:shrink-0" style={{ flexBasis: `${previewWidthPercent}%` }}>
                  {renderPreviewPane()}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
