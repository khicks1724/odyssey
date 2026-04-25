import { toAbsoluteAppUrl } from './base-path';
import { supabase } from './supabase';

export const THESIS_PAPER_DRAFT_STORAGE_KEY = 'odyssey-thesis-paper-draft';
export const THESIS_PAPER_THEME_STORAGE_KEY = 'odyssey-thesis-paper-theme';
export const THESIS_PAPER_SNAPSHOT_STORAGE_KEY = 'odyssey-thesis-paper-snapshot';
export const THESIS_PAPER_STATE_EVENT = 'odyssey:thesis-paper-state';
export const DEFAULT_THESIS_EXAMPLE_PATH = 'OdysseyExample.tex';
export const DEFAULT_THESIS_EXAMPLE_DRAFT = String.raw`\documentclass{article}

\title{Odyssey: An AI-Enabled Task Management Software}
\author{Kyle Hicks}
\date{\today}

\begin{document}

\maketitle

\section{Problem Statement}
Modern task management tools often lack intelligent prioritization, contextual awareness, and automation capabilities. Users must manually organize, track, and update tasks, which can lead to inefficiencies and missed deadlines. This project investigates whether integrating AI-driven decision support and automation into a task management platform can improve productivity, organization, and user experience.

\section{Research Objective}
The objective of this project is to design and implement an AI-enabled task management system, Odyssey, that enhances traditional task tracking with intelligent prioritization, automated scheduling, and contextual insights.

\section{Research Questions}
\begin{enumerate}
\item Can AI models effectively prioritize tasks based on context, deadlines, and user behavior?
\item What tradeoffs exist between system complexity, responsiveness, and usability?
\item How can automation be integrated without reducing user control or transparency?
\end{enumerate}

\section{Methodology}
This project will be executed in four primary phases.

\subsection{Background Review}
A review will be conducted on existing task management systems, productivity tools, and AI techniques for scheduling, recommendation systems, and natural language processing.

\subsection{System Design}
The architecture of Odyssey will be defined, including frontend interface, backend services, and AI integration components. Emphasis will be placed on scalability and modularity.

\subsection{Model Development}
Lightweight AI models will be developed to support task prioritization, natural language task input, and intelligent scheduling recommendations.

\subsection{Implementation and Integration}
The system will be implemented using modern development frameworks. AI components will be integrated into the workflow to provide real-time assistance and automation.

\subsection{Evaluation}
The system will be evaluated based on usability, task completion efficiency, recommendation accuracy, and system performance.

\section{Expected Contribution}
This project is expected to deliver a functional prototype of an AI-enabled task management platform that demonstrates how intelligent automation can enhance productivity tools. It will also provide insights into the tradeoffs between AI capability and user experience in real-world applications.

\section{Schedule}
\begin{enumerate}
\item Literature review
\item System architecture design
\item AI model development
\item Software implementation
\item System integration
\item Testing and evaluation
\item Documentation and final report
\end{enumerate}

\end{document}
`;

export type ThesisPaperPreviewStatus = 'idle' | 'rendering' | 'live' | 'error';

export interface ThesisPaperEditorSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  isEmpty: boolean;
  selectedText: string;
}

export interface ThesisPaperEditorViewport {
  firstLineNumber: number;
  lastLineNumber: number;
  centerLineNumber: number;
}

export interface ThesisPaperEditorState {
  cursorLineNumber: number;
  cursorColumn: number;
  selection: ThesisPaperEditorSelection | null;
  viewport: ThesisPaperEditorViewport | null;
}

export interface ThesisWorkspaceFile {
  id: string;
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  mimeType?: string | null;
}

export interface ThesisWorkspaceFolder {
  id: string;
  path: string;
}

export interface ThesisWorkspace {
  files: ThesisWorkspaceFile[];
  folders: ThesisWorkspaceFolder[];
  activeFileId: string | null;
}

export interface ThesisPaperSnapshot {
  draft: string;
  lineCount: number;
  wordCount: number;
  previewStatus: ThesisPaperPreviewStatus;
  renderError: string | null;
  previewText: string;
  editorState: ThesisPaperEditorState | null;
  workspace: ThesisWorkspace | null;
  activeFileId: string | null;
  activeFilePath: string | null;
  updatedAt: number;
}

export interface ThesisPaperDraftEdit {
  lineStart: number;
  lineEnd: number;
  replacement: string;
}

export type ThesisRepoProvider = 'github' | 'gitlab';
export type ThesisRemoteSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ThesisRepoLink {
  id: string;
  provider: ThesisRepoProvider;
  repo: string;
  host: string | null;
  filePath: string;
  filePaths: string[];
  syncAllWorkspaceFiles: boolean;
  autosaveEnabled: boolean;
  tokenSaved: boolean;
  updatedAt: string;
}

export interface ThesisSourceAttachment {
  name: string;
  storagePath: string;
  mimeType: string;
  uploadedAt: string;
  extractedTextPreview?: string;
}

export interface ThesisDocumentRecord {
  draft: string;
  editorTheme: string | null;
  snapshot: ThesisPaperSnapshot | null;
  updatedAt: string;
  repoSyncStatus: 'idle' | 'saved' | 'error';
  repoSyncError: string | null;
  repoSyncedAt: string | null;
}

export interface ThesisSettingsRecord {
  document: {
    updatedAt: string;
    repoSyncStatus: 'idle' | 'saved' | 'error';
    repoSyncError: string | null;
    repoSyncedAt: string | null;
  } | null;
  repoLink: ThesisRepoLink | null;
}

export interface ThesisRenderDiagnostic {
  filePath: string | null;
  lineNumber: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface ThesisRenderResult {
  success: boolean;
  mainFilePath: string;
  pdfBase64: string | null;
  previewText: string;
  pageCount: number;
  wordCount: number;
  summary: string;
  details: string[];
  diagnostics: ThesisRenderDiagnostic[];
  log: string;
}

export type ParsedThesisSourceKind =
  | 'journal_article'
  | 'book_chapter'
  | 'government_report'
  | 'dataset'
  | 'interview_notes'
  | 'archive_record'
  | 'web_article'
  | 'documentation';

export interface ParsedThesisSourceRecord {
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
  sourceKind: ParsedThesisSourceKind | null;
  sourceTypeLabel: string | null;
  extractedTextPreview: string | null;
}

export type ParsedThesisSourcePdf = ParsedThesisSourceRecord;
export type ParsedThesisSourceUrl = ParsedThesisSourceRecord;

export interface ThesisKnowledgeLinkedProject {
  id: string;
  name: string;
  description: string | null;
  github_repo: string | null;
  github_repos: string[] | null;
}

export interface ThesisKnowledgeLinkedGoal {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  deadline: string | null;
  status: string;
  progress: number;
  category: string | null;
  loe: string | null;
}

export interface ThesisKnowledgeLinkedEvent {
  id: string;
  project_id: string;
  source: string;
  event_type: string;
  title: string | null;
  summary: string | null;
  occurred_at: string;
}

export type ThesisKnowledgeNodeKind = 'source' | 'theme' | 'document' | 'chapter' | 'credit' | 'reference' | 'project' | 'repo';

export interface ThesisKnowledgeGraphNode {
  id: string;
  label: string;
  kind: ThesisKnowledgeNodeKind;
  size: number;
  score: number;
  detail: string;
  meta: string[];
  relatedSourceIds: string[];
}

export interface ThesisKnowledgeGraphEdge {
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
}

export interface ThesisKnowledgeThemeSummary {
  id: string;
  label: string;
  count: number;
  sourceIds: string[];
}

export interface ThesisKnowledgeCoverageSummary {
  id: string;
  label: string;
  count: number;
  sourceIds: string[];
}

export interface ThesisKnowledgeInsight {
  title: string;
  body: string;
}

export interface ThesisKnowledgeSourceBrief {
  id: string;
  title: string;
  summary: string;
  signals: string[];
}

export interface ThesisKnowledgeGraphPayload {
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
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function buildStats(draft: string) {
  return {
    lineCount: draft.split('\n').length,
    wordCount: draft.trim().length > 0 ? draft.trim().split(/\s+/).length : 0,
  };
}

function createWorkspaceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `thesis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeThesisWorkspacePath(input: string) {
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

function compareWorkspacePaths(left: string, right: string) {
  const leftParts = left.split('/');
  const rightParts = right.split('/');
  const leftIsFile = left.includes('.');
  const rightIsFile = right.includes('.');

  if (leftParts.length !== rightParts.length && !leftIsFile && !rightIsFile) {
    return leftParts.length - rightParts.length;
  }
  if (leftIsFile !== rightIsFile) return leftIsFile ? 1 : -1;
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function buildAncestorFolders(filePath: string) {
  const segments = filePath.split('/');
  const folders: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    folders.push(segments.slice(0, index).join('/'));
  }
  return folders;
}

export function createThesisWorkspaceFile(
  path: string,
  content: string,
  options?: {
    encoding?: 'utf-8' | 'base64';
    mimeType?: string | null;
  },
): ThesisWorkspaceFile {
  return {
    id: createWorkspaceId(),
    path: normalizeThesisWorkspacePath(path),
    content,
    encoding: options?.encoding === 'base64' ? 'base64' : 'utf-8',
    mimeType: typeof options?.mimeType === 'string' && options.mimeType.trim() ? options.mimeType.trim() : null,
  };
}

export function createDefaultThesisWorkspace(draft: string, initialPath = DEFAULT_THESIS_EXAMPLE_PATH): ThesisWorkspace {
  const file = createThesisWorkspaceFile(initialPath, draft);
  return {
    files: [file],
    folders: buildAncestorFolders(file.path).map((folderPath) => ({
      id: createWorkspaceId(),
      path: folderPath,
    })),
    activeFileId: file.id,
  };
}

export function sanitizeThesisWorkspace(
  workspace: ThesisWorkspace | null | undefined,
  fallbackDraft: string,
  fallbackPath = DEFAULT_THESIS_EXAMPLE_PATH,
) {
  if (!workspace?.files?.length) {
    return createDefaultThesisWorkspace(fallbackDraft, fallbackPath);
  }

  const files: ThesisWorkspaceFile[] = [];
  for (const file of workspace.files) {
    try {
      files.push({
        id: file.id || createWorkspaceId(),
        path: normalizeThesisWorkspacePath(file.path),
        content: typeof file.content === 'string' ? file.content : '',
        encoding: file.encoding === 'base64' ? 'base64' : 'utf-8',
        mimeType: typeof file.mimeType === 'string' && file.mimeType.trim() ? file.mimeType.trim() : null,
      });
    } catch {
      continue;
    }
  }

  if (files.length === 0) {
    return createDefaultThesisWorkspace(fallbackDraft, fallbackPath);
  }

  const uniqueFiles: ThesisWorkspaceFile[] = [];
  const seenPaths = new Set<string>();
  for (const file of files) {
    if (seenPaths.has(file.path)) continue;
    seenPaths.add(file.path);
    uniqueFiles.push(file);
  }

  const explicitFolders = (workspace.folders ?? [])
    .map((folder) => {
      try {
        return {
          id: folder.id || createWorkspaceId(),
          path: normalizeThesisWorkspacePath(folder.path),
        } satisfies ThesisWorkspaceFolder;
      } catch {
        return null;
      }
    })
    .filter((folder): folder is ThesisWorkspaceFolder => Boolean(folder));

  const folderMap = new Map<string, ThesisWorkspaceFolder>();
  for (const folder of explicitFolders) {
    folderMap.set(folder.path, folder);
  }
  for (const file of uniqueFiles) {
    for (const folderPath of buildAncestorFolders(file.path)) {
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, { id: createWorkspaceId(), path: folderPath });
      }
    }
  }

  const activeFileId = uniqueFiles.some((file) => file.id === workspace.activeFileId)
    ? workspace.activeFileId
    : uniqueFiles[0].id;

  return {
    files: [...uniqueFiles].sort((left, right) => compareWorkspacePaths(left.path, right.path)),
    folders: [...folderMap.values()].sort((left, right) => compareWorkspacePaths(left.path, right.path)),
    activeFileId,
  } satisfies ThesisWorkspace;
}

export function getThesisWorkspaceActiveFile(workspace: ThesisWorkspace | null | undefined) {
  if (!workspace) return null;
  return workspace.files.find((file) => file.id === workspace.activeFileId) ?? workspace.files[0] ?? null;
}

export function getThesisWorkspaceFromSnapshot(
  snapshot: Partial<ThesisPaperSnapshot> | null | undefined,
  fallbackDraft: string,
  fallbackPath = DEFAULT_THESIS_EXAMPLE_PATH,
) {
  return sanitizeThesisWorkspace(snapshot?.workspace, fallbackDraft, fallbackPath);
}

export function createThesisPaperSnapshot(
  draft: string,
  partial?: Partial<Omit<ThesisPaperSnapshot, 'draft' | 'lineCount' | 'wordCount'>>,
) {
  const workspace = sanitizeThesisWorkspace(partial?.workspace, draft);
  const activeFile = getThesisWorkspaceActiveFile(workspace);
  return {
    draft,
    ...buildStats(draft),
    previewStatus: partial?.previewStatus ?? 'idle',
    renderError: partial?.renderError ?? null,
    previewText: partial?.previewText ?? '',
    editorState: partial?.editorState ?? null,
    workspace,
    activeFileId: activeFile?.id ?? null,
    activeFilePath: activeFile?.path ?? null,
    updatedAt: partial?.updatedAt ?? Date.now(),
  } satisfies ThesisPaperSnapshot;
}

export function readStoredThesisPaperDraft() {
  if (!isBrowser()) return '';
  return window.localStorage.getItem(THESIS_PAPER_DRAFT_STORAGE_KEY) ?? DEFAULT_THESIS_EXAMPLE_DRAFT;
}

export function readStoredThesisPaperSnapshot() {
  if (!isBrowser()) return createThesisPaperSnapshot('');

  const rawValue = window.localStorage.getItem(THESIS_PAPER_SNAPSHOT_STORAGE_KEY);
  if (!rawValue) {
    return createThesisPaperSnapshot(readStoredThesisPaperDraft());
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<ThesisPaperSnapshot>;
    return createThesisPaperSnapshot(parsed.draft ?? readStoredThesisPaperDraft(), parsed);
  } catch {
    return createThesisPaperSnapshot(readStoredThesisPaperDraft());
  }
}

export function writeStoredThesisPaperSnapshot(snapshot: ThesisPaperSnapshot) {
  if (!isBrowser()) return;
  window.localStorage.setItem(THESIS_PAPER_DRAFT_STORAGE_KEY, snapshot.draft);
  window.localStorage.setItem(THESIS_PAPER_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  window.dispatchEvent(new CustomEvent<ThesisPaperSnapshot>(THESIS_PAPER_STATE_EVENT, { detail: snapshot }));
}

export function updateStoredThesisPaperSnapshot(partial: Partial<ThesisPaperSnapshot>) {
  const currentSnapshot = readStoredThesisPaperSnapshot();
  const nextSnapshot = createThesisPaperSnapshot(partial.draft ?? currentSnapshot.draft, {
    ...currentSnapshot,
    ...partial,
    updatedAt: Date.now(),
  });
  writeStoredThesisPaperSnapshot(nextSnapshot);
  return nextSnapshot;
}

export function applyRemoteThesisDocument(document: ThesisDocumentRecord | null | undefined) {
  if (!document) return createThesisPaperSnapshot(readStoredThesisPaperDraft());
  const snapshot = createThesisPaperSnapshot(document.draft, document.snapshot ?? undefined);
  writeStoredThesisPaperSnapshot(snapshot);
  if (document.editorTheme && isBrowser()) {
    window.localStorage.setItem(THESIS_PAPER_THEME_STORAGE_KEY, document.editorTheme);
  }
  return snapshot;
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not signed in.');
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  let payload: (T & { error?: string; message?: string }) | null = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody) as T & { error?: string; message?: string };
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const payloadError = payload && typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : payload && typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : '';
    const fallbackText = rawBody && !/^\s*</.test(rawBody) ? rawBody.trim() : '';
    const sizeLimitMessage = response.status === 413 ? 'Uploaded file exceeds the allowed size limit.' : '';
    throw new Error(
      payloadError
      || fallbackText
      || sizeLimitMessage
      || `Request failed (${response.status} ${response.statusText}).`,
    );
  }
  return (payload ?? {}) as T;
}

function normalizeSignedAttachmentUrl(value: string) {
  if (typeof window === 'undefined') return value;

  try {
    const parsed = new URL(value, window.location.origin);
    if (!parsed.pathname.startsWith('/storage/v1/')) {
      return parsed.toString();
    }

    return toAbsoluteAppUrl(`/supabase${parsed.pathname}${parsed.search}${parsed.hash}`);
  } catch {
    return value;
  }
}

export async function fetchThesisDocument() {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/document'), {
    headers: await getAuthHeaders(),
  });
  const payload = await parseJsonResponse<{ document: ThesisDocumentRecord | null }>(response);
  return payload.document;
}

export async function saveThesisDocument(input: {
  draft: string;
  editorTheme: string | null;
  snapshot: ThesisPaperSnapshot;
  debug?: unknown;
}) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/document'), {
    method: 'PUT',
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return parseJsonResponse<{
    ok: true;
    updatedAt: string;
    repoSyncStatus: 'idle' | 'saved' | 'error';
    repoSyncError: string | null;
    repoSyncedAt: string | null;
  }>(response);
}

export async function fetchThesisSettings() {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/settings'), {
    headers: await getAuthHeaders(),
  });
  return parseJsonResponse<ThesisSettingsRecord>(response);
}

export async function fetchThesisRenderPreview(input: {
  draft: string;
  workspace: ThesisWorkspace;
  activeFilePath: string | null;
}, signal?: AbortSignal) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/render'), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
    signal,
  });
  const payload = await parseJsonResponse<{ result: ThesisRenderResult }>(response);
  return payload.result;
}

export async function parseThesisSourcePdf(file: File) {
  const headers = await getAuthHeaders();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);

  const response = await fetch(toAbsoluteAppUrl('/api/thesis/sources/parse-pdf'), {
    method: 'POST',
    headers: {
      Authorization: headers.Authorization,
    },
    body: formData,
  });
  const payload = await parseJsonResponse<{ document: ParsedThesisSourcePdf }>(response);
  return payload.document;
}

export async function parseThesisSourceUrl(url: string) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/sources/parse-url'), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ url }),
  });
  const payload = await parseJsonResponse<{ document: ParsedThesisSourceUrl }>(response);
  return payload.document;
}

export async function uploadThesisSourcePdf(file: File) {
  const headers = await getAuthHeaders();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);

  const response = await fetch(toAbsoluteAppUrl('/api/thesis/sources/upload-pdf'), {
    method: 'POST',
    headers: {
      Authorization: headers.Authorization,
    },
    body: formData,
  });
  const payload = await parseJsonResponse<{ attachment: ThesisSourceAttachment }>(response);
  return payload.attachment;
}

export async function uploadThesisDocumentAttachment(file: File) {
  const headers = await getAuthHeaders();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);

  const response = await fetch(toAbsoluteAppUrl('/api/thesis/documents/upload'), {
    method: 'POST',
    headers: {
      Authorization: headers.Authorization,
    },
    body: formData,
  });
  const payload = await parseJsonResponse<{ attachment: ThesisSourceAttachment }>(response);
  return payload.attachment;
}

export async function signThesisSourceAttachment(storagePath: string) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/sources/sign'), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ storagePath }),
  });
  const payload = await parseJsonResponse<{ url: string }>(response);
  return normalizeSignedAttachmentUrl(payload.url);
}

export async function queueThesisSource(input: {
  libraryItem: unknown;
  queueItem: unknown;
}) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/sources/queue'), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return parseJsonResponse<{
    ok: true;
    sourceLibrary: unknown[];
    sourceQueueItems: unknown[];
    updatedAt: string;
  }>(response);
}

export async function saveThesisSources(input: {
  sourceLibrary: unknown[];
  sourceQueueItems: unknown[];
  thesisDocuments?: unknown[];
}) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/sources/save'), {
    method: 'PUT',
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return parseJsonResponse<{
    ok: true;
    sourceLibrary: unknown[];
    sourceQueueItems: unknown[];
    thesisDocuments?: unknown[];
    updatedAt: string;
  }>(response);
}

export async function fetchThesisKnowledgeGraph(input: {
  sourceLibrary: unknown[];
  thesisDocuments: unknown[];
  linkedProjects?: ThesisKnowledgeLinkedProject[];
  linkedGoals?: ThesisKnowledgeLinkedGoal[];
  linkedEvents?: ThesisKnowledgeLinkedEvent[];
}) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/knowledge/graph'), {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse<{ graph: ThesisKnowledgeGraphPayload }>(response);
  return payload.graph;
}

export async function saveThesisRepoLink(input: {
  provider: ThesisRepoProvider;
  repository: string;
  host?: string | null;
  filePaths?: string[] | null;
  syncAllWorkspaceFiles?: boolean;
  autosaveEnabled?: boolean;
  token?: string | null;
}) {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/settings/repo'), {
    method: 'PUT',
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return parseJsonResponse<{ repoLink: ThesisRepoLink | null }>(response);
}

export async function deleteThesisRepoLink() {
  const response = await fetch(toAbsoluteAppUrl('/api/thesis/settings/repo'), {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  return parseJsonResponse<{ ok: true }>(response);
}

export function buildNumberedLatexSource(draft: string) {
  const lines = draft.split('\n');
  const width = String(lines.length).length;
  return lines
    .map((line, index) => `${String(index + 1).padStart(width, ' ')} | ${line}`)
    .join('\n');
}

export function applyThesisPaperDraftEdit(draft: string, edit: ThesisPaperDraftEdit) {
  const lineStart = Math.trunc(edit.lineStart);
  const lineEnd = Math.trunc(edit.lineEnd);
  if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd) || lineStart < 1 || lineEnd < 0) {
    throw new Error('Invalid thesis paper edit range.');
  }
  if (lineStart > lineEnd + 1) {
    throw new Error('Unsupported thesis paper edit range.');
  }

  const hadTrailingNewline = draft.endsWith('\n');
  const currentLines = draft.split('\n');
  const replacementLines = edit.replacement.length > 0 ? edit.replacement.split('\n') : [];

  if (lineStart <= lineEnd) {
    currentLines.splice(lineStart - 1, lineEnd - lineStart + 1, ...replacementLines);
  } else {
    currentLines.splice(lineEnd, 0, ...replacementLines);
  }

  let nextDraft = currentLines.join('\n');
  if (hadTrailingNewline && nextDraft.length > 0 && !nextDraft.endsWith('\n')) {
    nextDraft += '\n';
  }
  return nextDraft;
}
