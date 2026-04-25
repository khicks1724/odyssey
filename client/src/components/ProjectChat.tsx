import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Send, Loader2, Bot, Check, Ban, Plus, Pencil, Trash2, Copy, CheckCheck, AlertTriangle,
  X, FileText, Github, GitBranch, Image, File, ChevronRight, ChevronDown, Mic,
  Download, TableIcon,
} from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { useChatPanel, type ChatMessage as Message, type MessageAttachment, type ReportFormat, type SuggestedTask, type TaskProposal, type TaskProposalState } from '../lib/chat-panel';
import { downloadReport, exportGoalsCSV } from '../lib/report-download';
import { supabase } from '../lib/supabase';
import { saveGeneratedReportToProject } from '../lib/report-storage';
import { useProjectFilePaths, type FileRef } from '../hooks/useProjectFilePaths';
import MarkdownWithFileLinks from './MarkdownWithFileLinks';
import RepoTreeModal from './RepoTreeModal';
import type { Project } from '../types';
import { useAIErrorDialog } from '../lib/ai-error';
import { pushUndoAction } from '../lib/undo-manager';
import { replaceTaskIdsWithTitles } from '../lib/task-refs';
import { getGitLabRepoPaths, type GitLabIntegrationConfig } from '../lib/gitlab';
import { getGitHubRepos } from '../lib/github';
import {
  applyThesisPaperDraftEdit,
  DEFAULT_THESIS_EXAMPLE_PATH,
  getThesisWorkspaceActiveFile,
  parseThesisSourcePdf,
  parseThesisSourceUrl,
  queueThesisSource,
  uploadThesisSourcePdf,
  getThesisWorkspaceFromSnapshot,
  readStoredThesisPaperSnapshot,
  type ParsedThesisSourceRecord,
  type ThesisSourceAttachment,
  updateStoredThesisPaperSnapshot,
} from '../lib/thesis-paper';
import './ProjectChat.css';

type BrowserSpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: {
    transcript: string;
  };
};

type BrowserSpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResultLike>;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

type PendingAction = NonNullable<Message['pendingActions']>[number];

interface Props {
  projectId: string | null;
  projectName: string;
  projects: Project[];
  onGoalMutated?: () => void;
}

// ── Attachment (pending, not yet sent) ─────────────────────────────────────

interface PendingAttachment {
  id: string;
  type: 'image' | 'text-file' | 'document' | 'repo';
  name: string;
  /** base64 string (no data: prefix) for images/files */
  base64?: string;
  mimeType?: string;
  textContent?: string;
  previewUrl?: string;
  repo?: string;
  repoType?: 'github' | 'gitlab';
}

// ── Project resource types ──────────────────────────────────────────────────

interface ProjectDoc {
  id: string;
  name: string;
  source: string;
  extractedText?: string;
}

interface ProjectMemberCandidate {
  userId: string;
  role: string;
  displayName: string;
  username: string | null;
  email: string | null;
}

interface ProjectGoalCandidate {
  id: string;
  title: string;
}

// ── Action config ───────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create_goal: <Plus size={12} />,
  update_goal: <Pencil size={12} />,
  delete_goal: <Trash2 size={12} />,
  review_redundancy: <AlertTriangle size={12} />,
  extend_deadline: <Pencil size={12} />,
  contract_deadline: <Pencil size={12} />,
  update_paper_draft: <Pencil size={12} />,
  add_thesis_source: <FileText size={12} />,
};

const ACTION_COLORS: Record<string, string> = {
  create_goal: 'border-accent3/30 bg-accent3/5 text-accent3',
  update_goal: 'border-accent2/30 bg-accent2/5 text-accent2',
  delete_goal: 'border-danger/30  bg-danger/5  text-danger',
  review_redundancy: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  extend_deadline: 'border-accent/30 bg-accent/5 text-accent',
  contract_deadline: 'border-border bg-surface2 text-muted',
  update_paper_draft: 'border-accent/30 bg-accent/5 text-accent',
  add_thesis_source: 'border-accent2/30 bg-accent2/5 text-accent2',
};

const ACTION_LABELS: Record<TaskProposal['type'], string> = {
  create_goal: 'Create Task',
  update_goal: 'Update Task',
  delete_goal: 'Delete Task',
  review_redundancy: 'Redundancy Check',
  extend_deadline: 'Extend Deadline',
  contract_deadline: 'Move Deadline Up',
  update_paper_draft: 'Edit Paper Draft',
  add_thesis_source: 'Add Thesis Source',
};

const THESIS_SOURCE_SYNC_EVENT = 'odyssey:thesis-sources-updated';

function createThesisSourceId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeParsedSourceKind(value: unknown) {
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

function mapParsedKindToLibraryType(method: 'url' | 'pdf' | 'manual', kind: string) {
  if (kind === 'dataset') return 'dataset';
  if (kind === 'interview_notes') return 'notes';
  if (kind === 'documentation' || kind === 'web_article') return 'link';
  if (kind === 'government_report' || kind === 'archive_record') return method === 'url' ? 'link' : 'report';
  if (kind === 'book_chapter') return 'book';
  if (method === 'url') return 'link';
  return 'paper';
}

function mapParsedKindToQueueType(kind: string) {
  if (kind === 'dataset') return 'dataset';
  if (kind === 'interview_notes') return 'notes';
  if (kind === 'documentation' || kind === 'web_article') return 'web';
  if (kind === 'archive_record') return 'document';
  return 'paper';
}

function buildQueuedThesisSource(
  parsed: ParsedThesisSourceRecord,
  method: 'url' | 'pdf',
  locator: string,
  attachmentName?: string,
  attachment?: ThesisSourceAttachment | null,
) {
  const today = new Date().toISOString().slice(0, 10);
  const kind = normalizeParsedSourceKind(parsed.sourceKind);
  const title = parsed.title?.trim() || attachmentName || locator;
  const credit = parsed.credit?.trim() || (method === 'pdf' ? 'Unknown author' : 'Unknown publisher');
  const fallbackVenue = method === 'url'
    ? (() => {
        try {
          return new URL(locator).hostname.replace(/^www\./i, '');
        } catch {
          return 'Web source';
        }
      })()
    : 'Uploaded PDF';
  const venue = parsed.contextField?.trim() || fallbackVenue;
  const year = parsed.year?.trim() || `${new Date().getUTCFullYear()}`;
  const notes = parsed.summary?.trim() || parsed.abstract?.trim() || `Added from ${method === 'url' ? 'URL' : 'PDF'} via Thesis AI.`;

  return {
    libraryItem: {
      id: createThesisSourceId('lib'),
      title,
      type: mapParsedKindToLibraryType(method, kind),
      acquisitionMethod: method,
      sourceKind: kind,
      status: 'queued',
      role: 'secondary',
      verification: 'provisional',
      chapterTarget: 'literature_review',
      credit,
      venue,
      year,
      locator,
      citation: parsed.citation?.trim() || '',
      abstract: parsed.abstract?.trim() || parsed.summary?.trim() || '',
      notes,
      tags: parsed.keywords ?? [],
      addedOn: today,
      attachmentName: attachment?.name ?? '',
      attachmentStoragePath: attachment?.storagePath ?? '',
      attachmentMimeType: attachment?.mimeType ?? '',
      attachmentUploadedAt: attachment?.uploadedAt ?? '',
    },
    queueItem: {
      id: createThesisSourceId('src'),
      title,
      type: mapParsedKindToQueueType(kind),
      status: 'queued',
      insight: notes,
    },
  };
}

function findAttachmentByName(messages: Message[], attachmentName: string) {
  const target = attachmentName.trim().toLowerCase();
  if (!target) return null;

  for (let msgIdx = messages.length - 1; msgIdx >= 0; msgIdx -= 1) {
    const message = messages[msgIdx];
    if (message.role !== 'user' || !message.attachments?.length) continue;
    const match = [...message.attachments].reverse().find((attachment) => attachment.name.trim().toLowerCase() === target);
    if (match) return match;
  }

  return null;
}

function getProposalKey(action: PendingAction, index: number): string {
  return action.id?.trim() || `proposal-${index}`;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function emailLocalPart(email: string | null | undefined): string | null {
  if (!email) return null;
  const [localPart] = email.split('@');
  return localPart?.trim() || null;
}

function normalizeMemberAlias(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeGoalMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*`"_']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMemberAliases(member: ProjectMemberCandidate): string[] {
  return uniqueNonEmptyStrings([
    member.userId,
    member.displayName,
    member.username,
    member.email,
    emailLocalPart(member.email),
  ]).map(normalizeMemberAlias);
}

function describeMember(member: ProjectMemberCandidate): string {
  return member.username
    ? `${member.displayName} (@${member.username})`
    : member.displayName;
}

function resolveAssigneeIdentifiers(
  values: unknown[],
  members: ProjectMemberCandidate[],
): { assignees: string[]; unresolved: string[]; ambiguous: Array<{ input: string; candidates: string[] }> } {
  const assignees: string[] = [];
  const unresolved: string[] = [];
  const ambiguous: Array<{ input: string; candidates: string[] }> = [];

  for (const rawValue of values) {
    const value = String(rawValue ?? '').trim();
    if (!value) continue;

    if (members.length === 0 && isLikelyUuid(value)) {
      assignees.push(value);
      continue;
    }

    const normalizedValue = normalizeMemberAlias(value);
    const matches = members.filter((member) => getMemberAliases(member).includes(normalizedValue));

    if (matches.length === 1) {
      assignees.push(matches[0].userId);
      continue;
    }

    if (matches.length > 1) {
      ambiguous.push({
        input: value,
        candidates: matches.map(describeMember),
      });
      continue;
    }

    unresolved.push(value);
  }

  return {
    assignees: [...new Set(assignees)],
    unresolved,
    ambiguous,
  };
}

function buildAssigneeResolutionError(
  unresolved: string[],
  ambiguous: Array<{ input: string; candidates: string[] }>,
): Error {
  const parts: string[] = [];

  if (unresolved.length > 0) {
    parts.push(`No project member matched: ${unresolved.join(', ')}.`);
  }

  if (ambiguous.length > 0) {
    parts.push(
      ambiguous
        .map((entry) => `Multiple project members matched "${entry.input}": ${entry.candidates.join(', ')}`)
        .join(' '),
    );
  }

  parts.push('Ask Project AI to use the exact display name, username, or email of the intended member.');
  return new Error(parts.join(' '));
}

function getGoalLookupCandidates(action: PendingAction): string[] {
  const candidates: string[] = [];

  const goalTitle = typeof action.args.goalTitle === 'string' ? action.args.goalTitle : null;
  const argTitle = typeof action.args.title === 'string' ? action.args.title : null;
  const actionTitle = typeof action.title === 'string' ? action.title : null;
  const description = typeof action.description === 'string' ? action.description : null;

  if (goalTitle) candidates.push(goalTitle);
  if (argTitle) candidates.push(argTitle);
  if (actionTitle) candidates.push(actionTitle);
  if (description) candidates.push(description);

  if (description) {
    const boldMatches = [...description.matchAll(/\*\*(.+?)\*\*/g)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
    candidates.push(...boldMatches);
  }

  return uniqueNonEmptyStrings(candidates);
}

function resolveGoalId(action: PendingAction, goals: ProjectGoalCandidate[]): string {
  const rawGoalId = typeof action.args.goalId === 'string' ? action.args.goalId.trim() : '';
  if (isLikelyUuid(rawGoalId)) return rawGoalId;

  const normalizedCandidates = getGoalLookupCandidates(action)
    .map(normalizeGoalMatchText)
    .filter(Boolean);
  const combinedText = normalizedCandidates.join(' ');

  const exactMatches = goals.filter((goal) => normalizedCandidates.includes(normalizeGoalMatchText(goal.title)));
  if (exactMatches.length === 1) return exactMatches[0].id;
  if (exactMatches.length > 1) {
    throw new Error(`Multiple tasks matched this proposal: ${exactMatches.map((goal) => goal.title).join(', ')}.`);
  }

  const inclusionMatches = goals.filter((goal) => {
    const normalizedGoalTitle = normalizeGoalMatchText(goal.title);
    return normalizedGoalTitle.length >= 8 && combinedText.includes(normalizedGoalTitle);
  });
  if (inclusionMatches.length === 1) return inclusionMatches[0].id;
  if (inclusionMatches.length > 1) {
    throw new Error(`Multiple tasks matched this proposal: ${inclusionMatches.map((goal) => goal.title).join(', ')}.`);
  }

  throw new Error('This proposal did not include a valid task target. Ask Project AI to regenerate the action for the specific task.');
}

function normalizeUpdateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const candidateUpdates = args.updates && typeof args.updates === 'object' && !Array.isArray(args.updates)
    ? args.updates as Record<string, unknown>
    : args;
  const updates = { ...candidateUpdates };

  delete updates.goalId;
  delete updates.goalTitle;
  delete updates.currentDeadline;
  delete updates.suggestedDeadline;
  delete updates.reason;
  delete updates.summary;
  delete updates.recommendedAction;

  if (updates.assignedTo && !updates.assigned_to) {
    updates.assigned_to = updates.assignedTo;
    delete updates.assignedTo;
  }

  const allowedKeys = new Set([
    'title',
    'status',
    'progress',
    'deadline',
    'category',
    'loe',
    'assigned_to',
    'assignees',
    'completed_at',
    'ai_guidance',
    'description',
  ]);

  for (const key of Object.keys(updates)) {
    if (!allowedKeys.has(key)) delete updates[key];
  }

  if (updates.assignees !== undefined) {
    const assignees = Array.isArray(updates.assignees)
      ? updates.assignees.map((value) => String(value)).filter(Boolean)
      : [];
    updates.assignees = assignees;
    if (updates.assigned_to === undefined) updates.assigned_to = assignees[0] ?? null;
  } else if (Object.prototype.hasOwnProperty.call(updates, 'assigned_to')) {
    const assignedTo = updates.assigned_to ? String(updates.assigned_to) : null;
    updates.assigned_to = assignedTo;
    updates.assignees = assignedTo ? [assignedTo] : [];
  }

  if (updates.progress !== undefined) {
    const progress = Number(updates.progress);
    if (Number.isFinite(progress)) updates.progress = progress;
    else delete updates.progress;
  }

  if (updates.deadline === '') updates.deadline = null;

  return updates;
}

function getActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: unknown; details?: unknown; hint?: unknown; error_description?: unknown };
    const parts = [maybeError.message, maybeError.details, maybeError.hint, maybeError.error_description]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (parts.length > 0) return parts.join(' ');
  }
  return 'Unknown error';
}

function formatProposalSummary(action: PendingAction): string[] {
  if (action.type === 'create_goal') {
    return [
      `Title: ${String(action.args.title ?? 'Untitled task')}`,
      `Deadline: ${String(action.args.deadline ?? 'None')}`,
      `Category: ${String(action.args.category ?? 'Uncategorized')}`,
    ];
  }

  if (action.type === 'update_goal') {
    const updates = normalizeUpdateArgs(action.args);
    return Object.entries(updates).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`);
  }

  if (action.type === 'delete_goal') {
    return [`Target: ${String(action.args.goalTitle ?? action.title ?? 'Selected task')}`];
  }

  if (action.type === 'update_paper_draft') {
    const lineStart = Number(action.args.lineStart);
    const lineEnd = Number(action.args.lineEnd);
    return [
      `Lines: ${Number.isFinite(lineStart) && Number.isFinite(lineEnd) ? `${lineStart}-${lineEnd}` : 'unknown'}`,
      `Replacement: ${typeof action.args.replacement === 'string' ? `${action.args.replacement.split('\n').length} line(s)` : 'none'}`,
    ];
  }

  if (action.type === 'add_thesis_source') {
    return [
      `URL: ${typeof action.args.url === 'string' ? action.args.url : 'none'}`,
      `Attachment: ${typeof action.args.attachmentName === 'string' ? action.args.attachmentName : 'none'}`,
    ];
  }

  if (action.type === 'extend_deadline' || action.type === 'contract_deadline') {
    return [
      `Target: ${String(action.args.goalTitle ?? action.title ?? 'Selected task')}`,
      `Deadline: ${String(action.args.suggestedDeadline ?? 'None')}`,
    ];
  }

  const goalTitles = Array.isArray(action.args.goalTitles)
    ? action.args.goalTitles.map((value) => String(value)).filter(Boolean)
    : [];

  return [
    goalTitles.length ? `Tasks: ${goalTitles.join(' · ')}` : 'Tasks: Review candidate duplicates',
    `Finding: ${String(action.args.summary ?? 'Potential overlap detected.')}`,
    `Recommendation: ${String(action.args.recommendedAction ?? 'clarify')}`,
  ];
}

function sanitizeTaskText(text: string | null | undefined, tasks: ProjectGoalCandidate[]): string {
  return replaceTaskIdsWithTitles(text ?? '', tasks);
}

function withProposalState(
  messages: Message[],
  msgIdx: number,
  action: PendingAction,
  actionIdx: number,
  state: 'pending' | 'approved' | 'denied' | 'executing',
): Message[] {
  const key = getProposalKey(action, actionIdx);
  return messages.map((message, index) => {
    if (index !== msgIdx) return message;
    return {
      ...message,
      actionStates: {
        ...(message.actionStates ?? {}),
        [key]: state,
      },
    };
  });
}

// ── Attachment chip (display) ───────────────────────────────────────────────

function AttachmentChip({
  att,
  onRemove,
}: {
  att: PendingAttachment;
  onRemove: () => void;
}) {
  const icon =
    att.type === 'image' ? <Image size={10} className="shrink-0" /> :
    att.type === 'repo'  ? (att.repoType === 'gitlab'
      ? <GitBranch size={10} className="shrink-0 text-[#FC6D26]" />
      : <Github    size={10} className="shrink-0" />) :
    <FileText size={10} className="shrink-0" />;

  return (
    <div className="pc-chip flex items-center gap-1 px-2 py-0.5 bg-surface border border-border rounded text-[10px] text-muted font-mono">
      {att.type === 'image' && att.previewUrl
        ? <img src={att.previewUrl} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
        : icon}
      <span className="max-w-[100px] truncate">{att.name}</span>
      <button type="button" title={`Remove ${att.name}`} onClick={onRemove} className="ml-0.5 hover:text-danger transition-colors">
        <X size={9} />
      </button>
    </div>
  );
}

// ── Sent attachment pill (inside message bubble) ────────────────────────────

function AttachmentPill({ att }: { att: MessageAttachment }) {
  const icon =
    att.type === 'image' ? <Image size={9} className="shrink-0" /> :
    att.type === 'repo'  ? (att.repoType === 'gitlab'
      ? <GitBranch size={9} className="shrink-0" />
      : <Github    size={9} className="shrink-0" />) :
    <File size={9} className="shrink-0" />;

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-black/20 rounded text-[9px] font-mono opacity-80">
      {att.type === 'image' && att.previewUrl
        ? <img src={att.previewUrl} alt="" className="w-3 h-3 rounded object-cover shrink-0" />
        : icon}
      {att.name}
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

// Detect intent to generate a downloadable report/document
const GENERATE_INTENT = /\b(generate|create|make|build|produce|export|download|write|put together|compile)\b.{0,60}\b(report|doc|docx|pptx|pdf|powerpoint|word|presentation|summary|slide\s*deck|slides|deck|brief(?:ing)?|document)\b/i;

function detectReportFormat(text: string): ReportFormat | null {
  if (/\bpptx\b|powerpoint|slides?\s*deck|presentation/i.test(text)) return 'pptx';
  if (/\bpdf\b/i.test(text)) return 'pdf';
  if (/\bdocx?\b|word\s*doc/i.test(text)) return 'docx';
  return null;
}

function inferProjectFromPrompt(text: string, projects: Project[], fallbackProjectId: string | null) {
  const normalized = text.toLowerCase();
  const matchedProject = projects.find((project) => {
    const name = project.name.toLowerCase().trim();
    return name.length > 2 && normalized.includes(name);
  });
  return matchedProject?.id ?? fallbackProjectId ?? projects[0]?.id ?? null;
}

export default function ProjectChat({ projectId, projectName, projects, onGoalMutated }: Props) {
  const { agent, providers, notifyModelUsed } = useAIAgent();
  const {
    messages,
    setMessages,
    mode,
    panelTitle,
    panelSubtitle,
    workspaceContext,
    inputPlaceholder,
    allowProjectSwitching,
  } = useChatPanel();
  const { showAIError, aiErrorDialog } = useAIErrorDialog(agent, providers);
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(projectId ?? projects[0]?.id ?? null);
  const selectedProject = projects.find((project) => project.id === resolvedProjectId) ?? null;

  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Pending attachments (not yet sent)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextView, setContextView] = useState<'main' | 'docs' | 'repos'>('main');
  const [contextPos, setContextPos] = useState<{ top: number; left: number } | null>(null);
  const contextBtnRef = useRef<HTMLButtonElement>(null);

  // Project resources (fetched once)
  const [projectDocs,  setProjectDocs]  = useState<ProjectDoc[]>([]);
  const [githubRepo,   setGithubRepo]   = useState<string[]>([]);
  const [gitlabRepos,  setGitlabRepos]  = useState<string[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberCandidate[]>([]);
  const [projectGoals, setProjectGoals] = useState<ProjectGoalCandidate[]>([]);
  const [resourcesReady, setResourcesReady] = useState(false);
  const { filePaths } = useProjectFilePaths(resolvedProjectId, githubRepo, gitlabRepos);
  const [repoTreeTarget, setRepoTreeTarget] = useState<{ repo: string; type: 'github' | 'gitlab'; initialPath?: string; projectId?: string | null } | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const projectPickerRef = useRef<HTMLDivElement>(null);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const messagesRef  = useRef<HTMLDivElement>(null);
  const messagesStateRef = useRef<Message[]>(messages);
  const previousMessageCountRef = useRef(messages.length);
  const shouldStickToBottomRef = useRef(true);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextRef  = useRef<HTMLDivElement>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const dictationBaseInputRef = useRef('');
  const autoDownloadedReportKeysRef = useRef<Set<string>>(new Set());
  const [isDictating, setIsDictating] = useState(false);

  const speechRecognitionSupported = typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Close project picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projectPickerRef.current && !projectPickerRef.current.contains(e.target as Node)) {
        setProjectPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleReportDownload = useCallback(async (data: NonNullable<Message['reportReady']>['data'], format: NonNullable<Message['reportReady']>['format']) => {
    try {
      await downloadReport(data, format);
    } catch (downloadError) {
      console.error('Failed to download generated report:', downloadError);
      setError('Failed to download report.');
    }
  }, []);

  useEffect(() => {
    for (const message of messages) {
      const reportReady = message.reportReady;
      const autoDownloadKey = reportReady?.autoDownloadKey;
      if (!autoDownloadKey || autoDownloadedReportKeysRef.current.has(autoDownloadKey)) continue;
      autoDownloadedReportKeysRef.current.add(autoDownloadKey);
      if (reportReady) {
        void handleReportDownload(reportReady.data, reportReady.format);
      }
    }
  }, [handleReportDownload, messages]);

  // ── Fetch project resources ──────────────────────────────────────────────

  useEffect(() => {
    if (projectId) {
      setResolvedProjectId(projectId);
    } else if (!allowProjectSwitching) {
      setResolvedProjectId(null);
    } else if (!resolvedProjectId && projects.length > 0) {
      setResolvedProjectId(projects[0].id);
    }
  }, [allowProjectSwitching, projectId, projects, resolvedProjectId]);

  useEffect(() => {
    let cancelled = false;
    if (!resolvedProjectId) {
      setGithubRepo([]);
      setGitlabRepos([]);
      setProjectDocs([]);
      setResourcesReady(true);
      return () => { cancelled = true; };
    }

    async function load() {
      // Project record (GitHub repos)
      const { data: proj } = await supabase
        .from('projects')
        .select('github_repo, github_repos, owner_id')
        .eq('id', resolvedProjectId)
        .maybeSingle();
      if (!cancelled) setGithubRepo(getGitHubRepos(proj));

      const { data: goalRows } = await supabase
        .from('goals')
        .select('id, title')
        .eq('project_id', resolvedProjectId);
      if (!cancelled) {
        setProjectGoals((goalRows ?? []).map((goal) => ({
          id: String(goal.id),
          title: String(goal.title ?? ''),
        })));
      }

      const { data: memberRows } = await supabase
        .from('project_members')
        .select('user_id, role')
        .eq('project_id', resolvedProjectId);

      const memberUserIds = uniqueNonEmptyStrings([
        typeof proj?.owner_id === 'string' ? proj.owner_id : null,
        ...(memberRows ?? []).map((member) => member.user_id),
      ]);

      const { data: profileRows } = memberUserIds.length
        ? await supabase
          .from('profiles')
          .select('id, display_name, username, email')
          .in('id', memberUserIds)
        : { data: [] as Array<{ id: string; display_name: string | null; username: string | null; email: string | null }> };

      const profileMap = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
      const nextMembers = new Map<string, ProjectMemberCandidate>();

      for (const member of memberRows ?? []) {
        const profile = profileMap.get(member.user_id);
        nextMembers.set(member.user_id, {
          userId: member.user_id,
          role: member.role ?? 'member',
          displayName: profile?.display_name?.trim() || profile?.username?.trim() || profile?.email?.trim() || member.user_id,
          username: profile?.username?.trim() || null,
          email: profile?.email?.trim() || null,
        });
      }

      if (typeof proj?.owner_id === 'string' && proj.owner_id) {
        const ownerProfile = profileMap.get(proj.owner_id);
        const existingOwner = nextMembers.get(proj.owner_id);
        if (existingOwner) {
          existingOwner.role = 'owner';
          existingOwner.displayName = ownerProfile?.display_name?.trim() || existingOwner.displayName;
          existingOwner.username = ownerProfile?.username?.trim() || existingOwner.username;
          existingOwner.email = ownerProfile?.email?.trim() || existingOwner.email;
        } else {
          nextMembers.set(proj.owner_id, {
            userId: proj.owner_id,
            role: 'owner',
            displayName: ownerProfile?.display_name?.trim() || ownerProfile?.username?.trim() || ownerProfile?.email?.trim() || proj.owner_id,
            username: ownerProfile?.username?.trim() || null,
            email: ownerProfile?.email?.trim() || null,
          });
        }
      }

      if (!cancelled) setProjectMembers([...nextMembers.values()]);

      // GitLab repos
      const { data: gl } = await supabase
        .from('integrations')
        .select('config')
        .eq('project_id', resolvedProjectId)
        .eq('type', 'gitlab')
        .maybeSingle();
      if (!cancelled && gl?.config) {
        const cfg = gl.config as GitLabIntegrationConfig;
        setGitlabRepos(getGitLabRepoPaths(cfg));
      }

      // Uploaded documents
      const { data: evts } = await supabase
        .from('events')
        .select('id, metadata, source')
        .eq('project_id', resolvedProjectId)
        .in('source', ['local', 'onenote', 'onedrive', 'teams'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (!cancelled && evts) {
        setProjectDocs(evts.map((e: any) => ({
          id: e.id,
          name: (e.metadata?.filename ?? e.metadata?.title ?? 'Document') as string,
          source: e.source as string,
          extractedText: e.metadata?.extracted_text as string | undefined,
        })));
      }

      if (!cancelled) setResourcesReady(true);
    }

    load();
    return () => { cancelled = true; };
  }, [resolvedProjectId]);

  // ── Close context menu on outside click ─────────────────────────────────

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      const insidePanel = contextRef.current?.contains(target);
      const insideBtn = contextBtnRef.current?.contains(target);
      if (!insidePanel && !insideBtn) {
        setContextOpen(false);
        setContextView('main');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // ── Scroll & focus ───────────────────────────────────────────────────────

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;

    const updateStickiness = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom <= 96;
    };

    updateStickiness();
    el.addEventListener('scroll', updateStickiness, { passive: true });
    return () => el.removeEventListener('scroll', updateStickiness);
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;

    const previousMessageCount = previousMessageCountRef.current;
    const messagesGrew = messages.length > previousMessageCount;
    previousMessageCountRef.current = messages.length;

    if (!messagesGrew || !shouldStickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);
  useEffect(() => {
    messagesStateRef.current = messages;
  }, [messages]);
  // Reset textarea height when input is cleared (e.g. after send)
  useEffect(() => {
    if (!input && inputRef.current) {
      inputRef.current.style.height = '0px';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [input]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const resizeTextarea = useCallback((t: HTMLTextAreaElement) => {
    t.style.height = '0px';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }, []);

  const syncInputWithResize = useCallback((nextValue: string) => {
    setInput(nextValue);
    window.requestAnimationFrame(() => {
      if (inputRef.current) resizeTextarea(inputRef.current);
    });
  }, [resizeTextarea]);

  const stopDictation = useCallback((mode: 'stop' | 'abort' = 'stop') => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    if (mode === 'abort') {
      recognition.abort();
    } else {
      recognition.stop();
    }
  }, []);

  const startDictation = useCallback(() => {
    const RecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      setError('Dictation is not supported in this browser.');
      return;
    }

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.abort();
      speechRecognitionRef.current = null;
    }

    const recognition = new RecognitionCtor();
    dictationBaseInputRef.current = input;
    speechRecognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onstart = () => {
      setIsDictating(true);
      setError(null);
      setContextOpen(false);
      setContextView('main');
      inputRef.current?.focus();
    };

    recognition.onresult = (event) => {
      let committedText = dictationBaseInputRef.current;
      let interimText = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        if (result.isFinal) {
          committedText = committedText
            ? `${committedText}${/\s$/.test(committedText) ? '' : ' '}${transcript}`
            : transcript;
        } else {
          interimText += `${interimText ? ' ' : ''}${transcript}`;
        }
      }

      dictationBaseInputRef.current = committedText;
      const displayValue = interimText
        ? `${committedText}${committedText && !/\s$/.test(committedText) ? ' ' : ''}${interimText}`
        : committedText;
      syncInputWithResize(displayValue);
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone access was blocked. Allow microphone access to use dictation.');
      } else {
        setError('Dictation failed. Try again.');
      }
      setIsDictating(false);
      speechRecognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsDictating(false);
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null;
      }
      syncInputWithResize(dictationBaseInputRef.current);
    };

    recognition.start();
  }, [input, syncInputWithResize]);

  const toggleDictation = useCallback(() => {
    if (isDictating) {
      stopDictation('stop');
      return;
    }
    startDictation();
  }, [isDictating, startDictation, stopDictation]);

  useEffect(() => () => {
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    recognition?.abort();
  }, []);

  // ── Copy ────────────────────────────────────────────────────────────────

  const copyMessage = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }, []);

  // ── File upload ─────────────────────────────────────────────────────────

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const id = `${Date.now()}-${Math.random()}`;

      if (isImage) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          setAttachments((prev) => [...prev, {
            id, type: 'image', name: file.name,
            base64, mimeType: file.type, previewUrl: dataUrl,
          }]);
        };
        reader.readAsDataURL(file);
      } else if (isPdf) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          setAttachments((prev) => [...prev, {
            id,
            type: 'document',
            name: file.name,
            base64,
            mimeType: file.type || 'application/pdf',
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        // Read as text (covers .txt, .md, .py, .ts, .json, .csv, .yaml, etc.)
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          setAttachments((prev) => [...prev, {
            id, type: 'text-file', name: file.name, textContent: text,
          }]);
        };
        reader.readAsText(file);
      }
    }
  }, []);

  // ── Paste images ────────────────────────────────────────────────────────

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((it) => it.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const fileList = imageItems.map((it) => it.getAsFile()).filter(Boolean) as File[];
    const dt = new DataTransfer();
    fileList.forEach((f) => dt.items.add(f));
    handleFiles(dt.files);
  }, [handleFiles]);

  // ── Drag & drop ─────────────────────────────────────────────────────────

  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ── Remove attachment ────────────────────────────────────────────────────

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  // ── Add doc / repo ───────────────────────────────────────────────────────

  const addedIds = useMemo(() => new Set(attachments.map((a) => a.id)), [attachments]);

  const toggleDoc = (doc: ProjectDoc) => {
    if (addedIds.has(doc.id)) {
      removeAttachment(doc.id);
    } else {
      setAttachments((prev) => [...prev, {
        id: doc.id,
        type: 'document',
        name: doc.name,
        textContent: doc.extractedText,
      }]);
    }
  };

  const toggleRepo = (repo: string, repoType: 'github' | 'gitlab') => {
    const id = `repo:${repo}`;
    if (addedIds.has(id)) {
      removeAttachment(id);
    } else {
      setAttachments((prev) => [...prev, { id, type: 'repo', name: repo, repo, repoType }]);
    }
  };

  // ── Send ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (overrideText?: string, historyOverride?: Message[]) => {
    if (!overrideText) stopDictation('stop');
    const text = (overrideText ?? input).trim();
    const activeAttachments = overrideText ? [] : attachments;
    if ((!text && activeAttachments.length === 0) || loading) return;
    const targetProjectId = allowProjectSwitching
      ? inferProjectFromPrompt(text, projects, resolvedProjectId)
      : (resolvedProjectId ?? projectId ?? null);
    if (!targetProjectId) {
      setError(mode === 'thesis'
        ? 'Link a project on the thesis page before using Thesis AI.'
        : 'No accessible project is available for chat.');
      return;
    }
    const inferredProject = projects.find((project) => project.id === targetProjectId) ?? null;
    setResolvedProjectId(targetProjectId);

    // Build display attachments for the message bubble
    const displayAtts: MessageAttachment[] = activeAttachments.map((a) => ({
      type: a.type,
      name: a.name,
      previewUrl: a.previewUrl,
      mimeType: a.mimeType,
      base64: a.base64,
      textContent: a.textContent,
      repo: a.repo,
      repoType: a.repoType,
    }));

    // Build wire attachments for the API
    const wireAtts = activeAttachments.map((a) => ({
      type: a.type,
      name: a.name,
      base64: a.base64,
      mimeType: a.mimeType,
      textContent: a.textContent,
      repo: a.repo,
      repoType: a.repoType,
    }));

    const userMsg: Message = {
      role: 'user',
      content: allowProjectSwitching && inferredProject && inferredProject.id !== projectId ? `[Project: ${inferredProject.name}]\n${text}` : text,
      attachments: displayAtts.length ? displayAtts : undefined,
    };
    const next = [...(historyOverride ?? messages), userMsg];
    setMessages(next);
    if (!overrideText) setInput('');
    if (!overrideText) setAttachments([]);
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) authHeaders['Authorization'] = `Bearer ${authToken}`;

      // Detect report generation intent — route to generate-report endpoint
      if (GENERATE_INTENT.test(text) && !overrideText) {
        const fmt: ReportFormat = detectReportFormat(text) ?? 'pdf';
        const fmtLabel = fmt === 'pptx' ? 'PowerPoint slide deck' : fmt === 'docx' ? 'Word document' : 'PDF';
        setMessages((prev) => [...prev, { role: 'assistant', content: `Got it — generating your ${fmtLabel} now…` }]);

        const today = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const threeMonthsAgo = new Date(today);
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const fromStr = `${threeMonthsAgo.getFullYear()}-${pad(threeMonthsAgo.getMonth() + 1)}-${pad(threeMonthsAgo.getDate())}`;

        const rRes = await fetch('/api/ai/generate-report', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ agent, projectId: targetProjectId, format: fmt, prompt: text, dateFrom: fromStr, dateTo: todayStr }),
        });
        const rData = await rRes.json();
        if (!rRes.ok) {
          setError(rData.error ?? `Error ${rRes.status}`);
          showAIError(rData.error ?? `Error ${rRes.status}`, rRes.status);
        } else {
          if (rData.provider) notifyModelUsed(rData.provider);
                    let savedArtifactNote = '';
                    try {
                      const artifact = await saveGeneratedReportToProject({
                        projectId: targetProjectId,
                        format: fmt,
                        report: rData,
                        provider: rData.provider ?? null,
                        dateFrom: fromStr,
                        dateTo: todayStr,
                      });
                      if (artifact) {
                        rData.artifact = artifact;
                        savedArtifactNote = ' · saved to project documents';
                      }
                    } catch (saveError) {
                      console.error('Failed to persist generated report artifact:', saveError);
                    }
          const fmtLabel2 = fmt === 'pptx' ? 'PowerPoint' : fmt === 'pdf' ? 'PDF' : 'Word';
          setMessages((prev) => [
            ...prev.slice(0, -1), // replace the "generating…" message
            {
              role: 'assistant',
              content: `**${rData.title}** is ready — ${rData.sections?.length ?? 0} sections · ${fmtLabel2}${savedArtifactNote}`,
              provider: rData.provider,
              reportReady: {
                data: rData,
                format: fmt,
                autoDownloadKey: `project-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              },
            },
          ]);
        }
        setLoading(false);
        return;
      }

      // Detect meeting-notes task generation intent
      const NOTES_INTENT = /\b(create|generate|extract|make|pull|identify|list)\b.{0,60}\b(tasks?|action items?|to[- ]?dos?|action points?)\b/i;
      const hasTextFile = wireAtts.some((a) => a.type === 'text-file' || a.type === 'document');
      const isNotesTaskIntent = (hasTextFile && NOTES_INTENT.test(text)) ||
        /\b(from|based on|using|analyze)\b.{0,40}\b(meeting notes?|notes?|transcript|minutes)\b.{0,40}\b(tasks?|action)\b/i.test(text) ||
        /\b(meeting notes?|notes?|transcript|minutes)\b.{0,60}\b(tasks?|action items?)\b/i.test(text);

      if (isNotesTaskIntent && !overrideText) {
        // Find the text-file content to use as notes
        const notesAtt = wireAtts.find((a) => a.type === 'text-file' || a.type === 'document');
        const fileContent = notesAtt?.textContent ?? text;
        const fileName = notesAtt?.name ?? 'Meeting Notes';

        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Analyzing ${fileName} to generate tasks…`,
        }]);

        const { data: { session } } = await supabase.auth.getSession();
        const notesHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (session?.access_token) notesHeaders['Authorization'] = `Bearer ${session.access_token}`;

        const { data: goalsData } = await supabase
          .from('goals')
          .select('title')
          .eq('project_id', targetProjectId);
        const existingTitles = (goalsData ?? []).map((g: { title: string }) => g.title);

        const nRes = await fetch('/api/ai/meeting-notes-tasks', {
          method: 'POST',
          headers: notesHeaders,
          body: JSON.stringify({
            agent,
            projectId: targetProjectId,
            fileContent: fileContent.slice(0, 50_000),
            fileName,
            existingTaskTitles: existingTitles,
          }),
        });
        const nData = await nRes.json();
        if (!nRes.ok || nData.error) {
          setMessages((prev) => [...prev.slice(0, -1), {
            role: 'assistant',
            content: nData.error ?? 'Failed to extract tasks from the document.',
          }]);
        } else {
          const tasks: SuggestedTask[] = (nData.tasks ?? []).slice(0, 30);
          if (nData.provider) notifyModelUsed(nData.provider);
          setMessages((prev) => [...prev.slice(0, -1), {
            role: 'assistant',
            content: `Found **${tasks.length} task${tasks.length !== 1 ? 's' : ''}** from ${fileName}. Review and accept the ones you want to add:`,
            provider: nData.provider,
            suggestedTasks: tasks,
            taskSelections: Object.fromEntries(tasks.map((_, i) => [i, 'accepted' as const])),
            taskState: 'pending',
          }]);
        }
        setLoading(false);
        return;
      }

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          agent,
          projectId: targetProjectId,
          workspaceMode: mode,
          workspaceContext,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          attachments: wireAtts.length ? wireAtts : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
        showAIError(data.error ?? `Error ${res.status}`, res.status);
      } else {
        if (data.provider) notifyModelUsed(data.provider);
        const pendingActions: PendingAction[] = Array.isArray(data.pendingActions)
          ? data.pendingActions
          : data.pendingAction
            ? [data.pendingAction]
            : [];
        const actionStates: Record<string, TaskProposalState> | undefined = pendingActions.length
          ? Object.fromEntries(pendingActions.map((action, index) => [getProposalKey(action, index), 'pending' as const]))
          : undefined;
        const autoAppliedSummaries: string[] = [];

        if (mode === 'thesis') {
          for (const [index, action] of pendingActions.entries()) {
            if (action.type !== 'update_paper_draft' && action.type !== 'add_thesis_source') continue;
            try {
              const result = await executeAction(action);
              if (actionStates) actionStates[getProposalKey(action, index)] = 'approved';
              autoAppliedSummaries.push(result);
            } catch (autoApplyError) {
              const message = getActionErrorMessage(autoApplyError);
              const label = action.type === 'add_thesis_source' ? 'Source add failed' : 'Paper edit failed';
              setError(`${label}: ${message}`);
              showAIError(`${label}: ${message}`);
            }
          }
        }

        setMessages((prev) => {
          const nextMessages: Message[] = [...prev, {
            role: 'assistant',
            content: data.message,
            provider: data.provider,
            pendingActions: pendingActions.length ? pendingActions : undefined,
            actionStates,
          }];
          if (autoAppliedSummaries.length > 0) {
            nextMessages.push({
              role: 'assistant',
              content: `Applied in the thesis workspace: ${autoAppliedSummaries.join(' ')}`,
            });
          }
          return nextMessages;
        });
      }
    } catch {
      setError('Network error — is the server running?');
      showAIError('Network error — is the server running?', 502);
    }
    setLoading(false);
  }, [input, attachments, loading, messages, agent, projectId, projects, resolvedProjectId, notifyModelUsed, allowProjectSwitching, mode, workspaceContext, stopDictation]);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function executeAction(action: PendingAction): Promise<string> {
    const { type, args } = action;
    if (type === 'create_goal') {
      const requestedAssignees = Array.isArray(args.assignees)
        ? args.assignees.map((value) => String(value)).filter(Boolean)
        : (args.assignedTo ? [String(args.assignedTo)] : []);
      const { assignees, unresolved, ambiguous } = resolveAssigneeIdentifiers(requestedAssignees, projectMembers);
      if (unresolved.length > 0 || ambiguous.length > 0) {
        throw buildAssigneeResolutionError(unresolved, ambiguous);
      }
      const { data, error: err } = await supabase.from('goals').insert({
        project_id:  resolvedProjectId ?? projectId,
        title:       args.title as string,
        deadline:    (args.deadline as string) || null,
        category:    (args.category as string) || null,
        loe:         (args.loe as string) || null,
        assigned_to: assignees[0] ?? null,
        assignees,
        status:      'not_started',
        progress:    0,
      }).select().single();
      if (err) throw err;
      setProjectGoals((prev) => [...prev, { id: String(data.id), title: String(data.title ?? args.title ?? '') }]);
      return `Created goal: "${data.title}"`;
    }
    if (type === 'update_goal') {
      const updates = normalizeUpdateArgs(args);
      const hasAssignmentChange = Object.prototype.hasOwnProperty.call(updates, 'assigned_to')
        || Object.prototype.hasOwnProperty.call(updates, 'assignees');
      if (hasAssignmentChange) {
        const requestedAssignees = Array.isArray(updates.assignees)
          ? updates.assignees
          : (updates.assigned_to ? [updates.assigned_to] : []);
        const { assignees, unresolved, ambiguous } = resolveAssigneeIdentifiers(requestedAssignees, projectMembers);
        if ((requestedAssignees as unknown[]).length > 0 && (unresolved.length > 0 || ambiguous.length > 0)) {
          throw buildAssigneeResolutionError(unresolved, ambiguous);
        }
        updates.assignees = assignees;
        updates.assigned_to = assignees[0] ?? null;
      }
      const goalId = resolveGoalId(action, projectGoals);
      if (!goalId) throw new Error('Missing task target for update.');
      if (Object.keys(updates).length === 0) throw new Error('No valid task changes were included in this proposal.');
      const { error: err } = await supabase.from('goals')
        .update(updates).eq('id', goalId);
      if (err) throw err;
      if (typeof updates.title === 'string' && updates.title.trim()) {
        setProjectGoals((prev) => prev.map((goal) => (
          goal.id === goalId
            ? { ...goal, title: updates.title as string }
            : goal
        )));
      }
      return `Updated goal: "${action.title ?? action.description}"`;
    }
    if (type === 'extend_deadline' || type === 'contract_deadline') {
      const goalId = resolveGoalId(action, projectGoals);
      const deadline = typeof args.suggestedDeadline === 'string' ? args.suggestedDeadline : null;
      if (!goalId || !deadline) throw new Error('Missing task target or deadline for this proposal.');
      const { error: err } = await supabase.from('goals')
        .update({ deadline }).eq('id', goalId);
      if (err) throw err;
      return `Updated deadline for "${String(args.goalTitle ?? action.title ?? 'task')}"`;
    }
    if (type === 'delete_goal') {
      const goalId = resolveGoalId(action, projectGoals);
      const deletedGoal = goalId
        ? await supabase.from('goals').select('*').eq('id', goalId).maybeSingle()
        : { data: null, error: null };
      if (deletedGoal?.error) throw deletedGoal.error;
      const { error: err } = await supabase.from('goals').delete().eq('id', goalId);
      if (err) throw err;
      setProjectGoals((prev) => prev.filter((goal) => goal.id !== goalId));
      if (deletedGoal?.data) {
        pushUndoAction({
          label: `Deleted task ${String(deletedGoal.data.title ?? args.goalTitle ?? 'task')}`,
          undo: async () => {
            const { data, error } = await supabase
              .from('goals')
              .insert(deletedGoal.data)
              .select()
              .single();
            if (error) throw error;
            setProjectGoals((prev) => {
              if (prev.some((goal) => goal.id === data.id)) return prev;
              return [...prev, { id: String(data.id), title: String(data.title ?? args.goalTitle ?? '') }];
            });
            onGoalMutated?.();
          },
        });
      }
      return `Deleted goal: "${args.goalTitle}"`;
    }
    if (type === 'review_redundancy') {
      const goalTitles = Array.isArray(args.goalTitles) ? args.goalTitles.map((value) => String(value)).filter(Boolean) : [];
      return `Reviewed redundancy candidate: ${goalTitles.join(', ') || 'task set'}`;
    }
    if (type === 'update_paper_draft') {
      if (mode !== 'thesis') {
        throw new Error('Paper draft edits are only available in Thesis AI.');
      }
      const lineStart = Number(args.lineStart);
      const lineEnd = Number(args.lineEnd);
      const replacement = typeof args.replacement === 'string' ? args.replacement : '';
      const currentSnapshot = readStoredThesisPaperSnapshot();
      const currentWorkspace = getThesisWorkspaceFromSnapshot(
        currentSnapshot,
        currentSnapshot.draft,
        currentSnapshot.activeFilePath ?? DEFAULT_THESIS_EXAMPLE_PATH,
      );
      const activeFile = getThesisWorkspaceActiveFile(currentWorkspace);
      if (!activeFile) {
        throw new Error('No thesis file is currently open.');
      }

      const nextDraft = applyThesisPaperDraftEdit(activeFile.content, {
        lineStart,
        lineEnd,
        replacement,
      });
      const nextWorkspace = {
        ...currentWorkspace,
        files: currentWorkspace.files.map((file) => (
          file.id === activeFile.id ? { ...file, content: nextDraft } : file
        )),
        activeFileId: activeFile.id,
      };

      updateStoredThesisPaperSnapshot({
        draft: nextDraft,
        previewStatus: 'rendering',
        renderError: null,
        workspace: nextWorkspace,
        activeFileId: activeFile.id,
        activeFilePath: activeFile.path,
      });
      return `Updated thesis draft lines ${lineStart}-${lineEnd}.`;
    }
    if (type === 'add_thesis_source') {
      if (mode !== 'thesis') {
        throw new Error('Thesis source ingest is only available in Thesis AI.');
      }

      const url = typeof args.url === 'string' ? args.url.trim() : '';
      const attachmentName = typeof args.attachmentName === 'string' ? args.attachmentName.trim() : '';

      let parsed: ParsedThesisSourceRecord;
      let method: 'url' | 'pdf';
      let locator: string;
      let attachment: ThesisSourceAttachment | null = null;

      if (url) {
        parsed = await parseThesisSourceUrl(url);
        method = 'url';
        locator = parsed.locator || url;
      } else if (attachmentName) {
        const pdfAttachment = findAttachmentByName(messagesStateRef.current, attachmentName);
        if (!pdfAttachment?.base64) {
          throw new Error(`Could not find the attached PDF "${attachmentName}".`);
        }
        const mimeType = pdfAttachment.mimeType || 'application/pdf';
        if (!/pdf/i.test(mimeType) && !/\.pdf$/i.test(pdfAttachment.name)) {
          throw new Error('Only PDF attachments can be added as thesis sources right now.');
        }

        const binary = atob(pdfAttachment.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const file = new globalThis.File([bytes], pdfAttachment.name, { type: mimeType });
        parsed = await parseThesisSourcePdf(file);
        attachment = await uploadThesisSourcePdf(file);
        method = 'pdf';
        locator = pdfAttachment.name;
      } else {
        throw new Error('No URL or PDF attachment was provided for this source action.');
      }

      const queued = buildQueuedThesisSource(parsed, method, locator, attachmentName || undefined, attachment);
      const response = await queueThesisSource(queued);
      window.dispatchEvent(new CustomEvent(THESIS_SOURCE_SYNC_EVENT, {
        detail: {
          sourceLibrary: response.sourceLibrary,
          sourceQueueItems: response.sourceQueueItems,
        },
      }));

      return `Added source: "${queued.libraryItem.title}" (${parsed.sourceTypeLabel || parsed.sourceKind || method}).`;
    }
    throw new Error(`Unknown action type: ${type}`);
  }

  const setProposalState = useCallback((msgIdx: number, action: PendingAction, actionIdx: number, state: 'pending' | 'approved' | 'denied' | 'executing') => {
    setMessages((prev) => withProposalState(prev, msgIdx, action, actionIdx, state));
  }, [setMessages]);

  const handleApprove = async (msgIdx: number, action: PendingAction, actionIdx: number) => {
    setMessages((prev) => withProposalState(prev, msgIdx, action, actionIdx, 'executing'));
    try {
      const result = await executeAction(action);
      if (action.type !== 'review_redundancy' && action.type !== 'update_paper_draft' && action.type !== 'add_thesis_source') onGoalMutated?.();
      setMessages((prev) => ([
        ...withProposalState(prev, msgIdx, action, actionIdx, 'approved'),
        {
          role: 'assistant',
          content: action.type === 'review_redundancy'
            ? `Review noted: ${result}`
            : `Action completed: ${result}`,
        },
      ]));
    } catch (err) {
      console.error('Action failed:', err);
      setProposalState(msgIdx, action, actionIdx, 'pending');
      const message = getActionErrorMessage(err);
      setError(`Action failed: ${message}`);
      showAIError(`Action failed: ${message}`);
    }
  };

  const handleDeny = (msgIdx: number, action: PendingAction, actionIdx: number) => {
    const deniedMessages = withProposalState(messagesStateRef.current, msgIdx, action, actionIdx, 'denied');
    setMessages(deniedMessages);
    sendMessage(`User declined: "${action.description}". Please suggest an alternative.`, deniedMessages);
  };

  // ── Suggested-task actions ────────────────────────────────────────────────

  const handleAddSelectedTasks = async (msgIdx: number) => {
    const msg = messages[msgIdx];
    if (!msg.suggestedTasks || !resolvedProjectId) return;

    setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, taskState: 'adding' as const } : m));

    const toAdd = msg.suggestedTasks.filter((_, ti) => msg.taskSelections?.[ti] !== 'rejected');
    for (const t of toAdd) {
      try {
        await supabase.from('goals').insert({
          project_id:  resolvedProjectId,
          title:       t.title,
          description: t.description || null,
          category:    t.category || null,
          loe:         t.loe || null,
          deadline:    t.deadline || null,
          status:      'not_started',
          progress:    0,
        });
      } catch { /* continue on individual task failure */ }
    }

    onGoalMutated?.();
    setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, taskState: 'done' as const } : m));
  };

  const toggleTaskSelection = (msgIdx: number, taskIdx: number) => {
    setMessages((prev) => prev.map((m, i) => {
      if (i !== msgIdx) return m;
      const current = m.taskSelections?.[taskIdx];
      return {
        ...m,
        taskSelections: {
          ...(m.taskSelections ?? {}),
          [taskIdx]: current === 'rejected' ? 'accepted' : 'rejected',
        },
      };
    }));
  };

  // ── Context menu sections ────────────────────────────────────────────────

  const hasRepos = githubRepo.length > 0 || gitlabRepos.length > 0;

  function ContextMenu() {
    if (contextView === 'docs') {
      return (
        <div className="pc-ctx-panel">
          <div className="pc-ctx-header">
            <button type="button" onClick={() => setContextView('main')} className="pc-ctx-back">
              <ChevronRight size={11} className="rotate-180" /> Back
            </button>
            <span className="text-[10px] text-muted font-mono">Project Documents</span>
          </div>
          <div className="pc-ctx-list">
            {projectDocs.length === 0 && (
              <div className="px-3 py-4 text-center text-[10px] text-muted">No documents uploaded yet.</div>
            )}
            {projectDocs.map((doc) => {
              const checked = addedIds.has(doc.id);
              return (
                <button key={doc.id} type="button" onClick={() => toggleDoc(doc)}
                  className={`pc-ctx-item ${checked ? 'pc-ctx-item--active' : ''}`}>
                  <FileText size={11} className="text-muted shrink-0" />
                  <span className="truncate flex-1">{doc.name}</span>
                  {checked && <Check size={10} className="text-accent shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (contextView === 'repos') {
      return (
        <div className="pc-ctx-panel">
          <div className="pc-ctx-header">
            <button type="button" onClick={() => setContextView('main')} className="pc-ctx-back">
              <ChevronRight size={11} className="rotate-180" /> Back
            </button>
            <span className="text-[10px] text-muted font-mono">Repositories</span>
          </div>
          <div className="pc-ctx-list">
            {!hasRepos && (
              <div className="px-3 py-4 text-center text-[10px] text-muted">No repos linked.</div>
            )}
            {githubRepo.map((repo) => {
              const id = `repo:${repo}`;
              const checked = addedIds.has(id);
              return (
                <button key={repo} type="button" onClick={() => toggleRepo(repo, 'github')}
                  className={`pc-ctx-item ${checked ? 'pc-ctx-item--active' : ''}`}>
                  <Github size={11} className="shrink-0" />
                  <span className="truncate flex-1 font-mono">{repo}</span>
                  {checked && <Check size={10} className="text-accent shrink-0" />}
                </button>
              );
            })}
            {gitlabRepos.map((r) => {
              const id = `repo:${r}`;
              const checked = addedIds.has(id);
              return (
                <button key={r} type="button" onClick={() => toggleRepo(r, 'gitlab')}
                  className={`pc-ctx-item ${checked ? 'pc-ctx-item--active' : ''}`}>
                  <GitBranch size={11} className="text-[#FC6D26] shrink-0" />
                  <span className="truncate flex-1 font-mono">{r}</span>
                  {checked && <Check size={10} className="text-accent shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // Main menu
    return (
      <div className="pc-ctx-panel">
        <div className="pc-ctx-header">
          <span className="text-[10px] font-medium text-heading">Add context</span>
        </div>
        <div className="pc-ctx-list">
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="pc-ctx-item">
            <File size={11} className="text-accent shrink-0" />
            <span>Upload file or image…</span>
          </button>
          <button type="button" onClick={() => setContextView('docs')}
            className="pc-ctx-item justify-between">
            <div className="flex items-center gap-2">
              <FileText size={11} className="text-accent2 shrink-0" />
              <span>Project documents</span>
            </div>
            <span className="flex items-center gap-1 text-muted text-[10px]">
              {projectDocs.length}
              <ChevronRight size={10} />
            </span>
          </button>
          <button type="button" onClick={() => setContextView('repos')}
            className="pc-ctx-item justify-between" disabled={!resourcesReady}>
            <div className="flex items-center gap-2">
              <Github size={11} className="text-accent3 shrink-0" />
              <span>Repositories</span>
            </div>
            <span className="flex items-center gap-1 text-muted text-[10px]">
              {githubRepo.length + gitlabRepos.length}
              <ChevronRight size={10} />
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className={`pc-panel ${dragOver ? 'pc-panel--drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="pc-drag-overlay">
          <div className="text-center">
            <File size={32} className="text-accent mx-auto mb-2 opacity-60" />
            <div className="text-sm text-heading">Drop to attach</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="pc-panel-header">
        <div className="flex items-center gap-2 min-w-0">
          <Bot size={14} className="text-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-heading font-sans">{panelTitle}</div>
            <div className="relative" ref={projectPickerRef}>
              {allowProjectSwitching ? (
                <>
                  <button
                    type="button"
                    onClick={() => setProjectPickerOpen((o) => !o)}
                    className="flex items-center gap-0.5 text-[10px] text-muted font-mono hover:text-heading transition-colors"
                  >
                    <span className="truncate max-w-[140px]">{selectedProject?.name ?? projectName ?? 'No project selected'}</span>
                    <ChevronDown size={9} className={`shrink-0 transition-transform ${projectPickerOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {projectPickerOpen && projects.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 w-52 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 overflow-hidden">
                      {projects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setResolvedProjectId(p.id);
                            setProjectPickerOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--color-surface2)] ${
                            p.id === resolvedProjectId ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-heading)]'
                          }`}
                        >
                          {p.id === resolvedProjectId && <Check size={10} className="shrink-0 text-[var(--color-accent)]" />}
                          {p.id !== resolvedProjectId && <span className="w-[10px] shrink-0" />}
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[10px] text-muted font-mono">
                  {selectedProject?.name ?? projectName ?? 'No linked project'}
                </div>
              )}
            </div>
            {panelSubtitle && <div className="mt-0.5 text-[10px] text-muted">{panelSubtitle}</div>}
          </div>
        </div>
      </div>

      {mode === 'thesis' && (
        <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
          <div className="rounded border border-accent/20 bg-accent/5 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Thesis Workspace Context</div>
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-heading">
                {selectedProject?.name ?? projectName ?? 'No linked project'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesRef} className="pc-messages flex-1 p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot size={24} className="text-muted mx-auto mb-2" />
            <p className="text-xs text-muted font-mono">
              {mode === 'thesis'
                ? <>Ask me to strengthen your thesis using <span className="text-accent">{selectedProject?.name ?? projectName ?? 'the linked project context'}</span></>
                : <>Ask me anything about <span className="text-accent">{selectedProject?.name ?? projectName ?? 'your projects'}</span></>}
            </p>
            {mode !== 'thesis' && (
              <>
                <p className="mt-1 text-[10px] text-muted/60">I can create, edit, and delete tasks. I’ll always ask before acting.</p>
                <p className="mt-0.5 text-[10px] text-muted/40">
                  Use <span className="text-accent/60">+</span> to attach files, images, documents, or repos.
                </p>
              </>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={msg.id ?? i}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && msg.suggestedTasks ? (
                <div className="mr-2 max-w-[98%] w-full">
                  {/* Header */}
                  <div className="bg-surface2 border border-border rounded-t px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Plus size={13} className="text-accent3" />
                      <div>
                        <p className="text-xs font-bold text-heading font-sans">
                          Task Generation from Notes
                        </p>
                        <p className="text-[10px] text-muted mt-0.5">
                          <MarkdownWithFileLinks block={false} filePaths={new Map<string, FileRef>()} onFileClick={() => {}} githubRepo={null} gitlabRepos={[]} onRepoClick={() => {}} tasks={projectGoals}>
                            {msg.content}
                          </MarkdownWithFileLinks>
                        </p>
                      </div>
                    </div>
                    {msg.taskState === 'done' && (
                      <span className="text-[10px] text-accent3 font-mono flex items-center gap-1">
                        <Check size={10} /> Added
                      </span>
                    )}
                    {msg.provider && <span className="text-[9px] text-muted font-mono opacity-60">{msg.provider}</span>}
                  </div>

                  {/* Task cards */}
                  <div className="border-l border-r border-border divide-y divide-border/50 max-h-[60vh] overflow-y-auto">
                    {msg.suggestedTasks.map((task, ti) => {
                      const rejected = msg.taskSelections?.[ti] === 'rejected';
                      const isDone = msg.taskState === 'done';
                      return (
                        <div
                          key={ti}
                          className={`flex gap-3 px-4 py-3 transition-colors ${rejected ? 'opacity-40 bg-surface' : 'bg-surface hover:bg-surface2/50'}`}
                        >
                          {/* Accept/Reject toggle */}
                          <div className="shrink-0 pt-0.5">
                            <button
                              type="button"
                              disabled={isDone}
                              onClick={() => toggleTaskSelection(i, ti)}
                              title={rejected ? 'Include this task' : 'Exclude this task'}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                rejected
                                  ? 'border-border bg-surface text-muted'
                                  : 'border-accent3 bg-accent3/10 text-accent3'
                              } disabled:cursor-default`}
                            >
                              {!rejected && <Check size={10} />}
                            </button>
                          </div>

                          {/* Task info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-semibold text-heading leading-snug">{task.title}</p>
                              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-surface2 border border-border text-muted font-mono">
                                NOT STARTED
                              </span>
                            </div>
                            {task.description && (
                              <p className="text-[10px] text-muted mt-0.5 leading-relaxed">{task.description}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {task.priority && (
                                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wide ${
                                  task.priority.toLowerCase() === 'high' ? 'text-orange-400 border-orange-400/30 bg-orange-400/5' :
                                  task.priority.toLowerCase() === 'medium' ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5' :
                                  'text-muted border-border'
                                }`}>{task.priority}</span>
                              )}
                              {task.category && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent2/10 border border-accent2/20 text-accent2 uppercase tracking-wide">{task.category}</span>
                              )}
                              {task.loe && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface2 border border-border text-muted">{task.loe}</span>
                              )}
                              {task.deadline && (
                                <span className="text-[9px] font-mono text-muted">{new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer actions */}
                  <div className="bg-surface2 border border-border rounded-b px-4 py-3 flex items-center justify-between gap-3">
                    {msg.taskState === 'pending' && (
                      <>
                        <span className="text-[10px] text-muted font-mono">
                          {Object.values(msg.taskSelections ?? {}).filter((v) => v !== 'rejected').length} of {msg.suggestedTasks.length} selected
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setMessages((prev) => prev.map((m, mi) => mi !== i ? m : {
                              ...m,
                              taskSelections: Object.fromEntries((m.suggestedTasks ?? []).map((_, ti) => [ti, 'rejected' as const])),
                            }))}
                            className="px-3 py-1.5 border border-border text-muted text-[10px] font-semibold uppercase tracking-wider rounded hover:bg-surface transition-colors"
                          >
                            Reject All
                          </button>
                          <button
                            type="button"
                            onClick={() => setMessages((prev) => prev.map((m, mi) => mi !== i ? m : {
                              ...m,
                              taskSelections: Object.fromEntries((m.suggestedTasks ?? []).map((_, ti) => [ti, 'accepted' as const])),
                            }))}
                            className="px-3 py-1.5 border border-border text-muted text-[10px] font-semibold uppercase tracking-wider rounded hover:bg-surface2 hover:text-heading transition-colors"
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddSelectedTasks(i)}
                            disabled={Object.values(msg.taskSelections ?? {}).every((v) => v === 'rejected')}
                            className="flex items-center gap-1.5 px-4 py-1.5 border border-accent3/30 bg-accent3/10 text-accent3 text-[10px] font-semibold uppercase tracking-wider rounded hover:bg-accent3/20 transition-colors disabled:opacity-50"
                          >
                            <Check size={11} /> Accept All ({Object.values(msg.taskSelections ?? {}).filter((v) => v !== 'rejected').length})
                          </button>
                        </div>
                      </>
                    )}
                    {msg.taskState === 'adding' && (
                      <div className="flex items-center gap-2 text-[10px] text-muted font-mono">
                        <Loader2 size={11} className="animate-spin text-accent" /> Adding tasks…
                      </div>
                    )}
                    {msg.taskState === 'done' && (
                      <div className="flex items-center gap-1.5 text-[10px] text-accent3 font-mono">
                        <Check size={11} /> Tasks added to project
                      </div>
                    )}
                  </div>
                </div>
              ) : msg.role === 'assistant' && msg.reportReady ? (
                <div className="bg-surface2 border border-border rounded p-3 text-xs mr-2 max-w-[92%] space-y-2">
                  <div className="flex items-center gap-1.5 text-accent3 font-medium">
                    <FileText size={11} className="shrink-0" />
                    <span>{msg.content}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button"
                      onClick={async () => {
                        const { data, format: fmt } = msg.reportReady!;
                        await handleReportDownload(data, fmt);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-accent text-[var(--color-accent-fg)] text-[10px] font-medium rounded hover:bg-accent/90 transition-colors">
                      <Download size={10} />
                      Download {msg.reportReady.format.toUpperCase()}
                    </button>
                    {msg.reportReady.data.rawData?.goals?.length ? (
                      <button type="button" onClick={() => exportGoalsCSV(msg.reportReady!.data)}
                        className="flex items-center gap-1 text-[10px] text-muted hover:text-heading border border-border rounded px-2 py-1 hover:bg-surface2 transition-colors">
                        <TableIcon size={9} /> Export CSV
                      </button>
                    ) : null}
                  </div>
                  {msg.provider && <div className="text-[9px] text-muted opacity-60">{msg.provider}</div>}
                </div>
              ) : msg.role === 'assistant' ? (
                <div className="relative group mr-2 max-w-[92%]">
                  <button type="button" onClick={() => copyMessage(msg.content, i)} title="Copy response"
                    className="absolute -top-2 -right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity
                               w-6 h-6 flex items-center justify-center rounded
                               bg-surface border border-border text-muted hover:text-heading hover:bg-surface2">
                    {copiedIdx === i
                      ? <CheckCheck size={11} className="text-accent3" />
                      : <Copy size={11} />}
                  </button>
                  <div className="pc-bubble px-3 py-2 rounded text-xs leading-relaxed bg-surface2 border border-border text-heading pc-md">
                    <MarkdownWithFileLinks
                      block
                      filePaths={filePaths}
                      onFileClick={(ref: FileRef) => setRepoTreeTarget({ repo: ref.repo, type: ref.type, initialPath: ref.path, projectId: ref.projectId ?? resolvedProjectId })}
                      githubRepo={githubRepo}
                      gitlabRepos={gitlabRepos}
                      onRepoClick={(repo, type) => setRepoTreeTarget({ repo, type, projectId: type === 'gitlab' ? resolvedProjectId : null })}
                      tasks={projectGoals}
                    >
                      {msg.content}
                    </MarkdownWithFileLinks>
                    {msg.provider && (
                      <div className="text-[9px] text-muted mt-1 text-right opacity-60">{msg.provider}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pc-bubble px-3 py-2 rounded text-xs leading-relaxed bg-accent text-[var(--color-accent-fg)] ml-2">
                  {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className={`flex flex-wrap gap-1 ${msg.content ? 'mt-1.5' : ''}`}>
                      {msg.attachments.map((att, ai) => (
                        <AttachmentPill key={ai} att={att} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {msg.pendingActions?.length ? (
              <div className="mr-2 mt-2 space-y-2">
                {msg.pendingActions.map((action, actionIdx) => {
                  const actionKey = getProposalKey(action, actionIdx);
                  const actionState = msg.actionStates?.[actionKey] ?? 'pending';
                  const summaryLines = formatProposalSummary(action);
                  const isManualReview = action.type === 'review_redundancy';

                  return (
                    <div key={actionKey} className={`border rounded p-3 ${ACTION_COLORS[action.type] ?? 'border-border bg-surface2'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1 font-medium text-[10px] uppercase tracking-wider">
                            {ACTION_ICONS[action.type]}
                            {ACTION_LABELS[action.type]}
                          </div>
                          <p className="text-xs font-semibold text-heading leading-snug">
                            {sanitizeTaskText(action.title ?? action.description, projectGoals)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded border border-current/20 px-2 py-1 text-[9px] font-mono uppercase tracking-[0.18em] opacity-80">
                          {action.type.replace('_', ' ')}
                        </span>
                      </div>

                      {action.title && (
                        <p className="mt-1 text-xs text-heading">{sanitizeTaskText(action.description, projectGoals)}</p>
                      )}
                      {action.reasoning && (
                        <div className="mt-2">
                          <MarkdownWithFileLinks
                            block={false}
                            filePaths={new Map<string, FileRef>()}
                            onFileClick={() => {}}
                            githubRepo={null}
                            gitlabRepos={[]}
                            onRepoClick={() => {}}
                            tasks={projectGoals}
                            className="text-[10px] leading-relaxed text-muted"
                          >
                            {action.reasoning}
                          </MarkdownWithFileLinks>
                        </div>
                      )}

                      {summaryLines.length > 0 && (
                        <div className="mt-2 rounded border border-current/15 bg-black/10 px-3 py-2">
                          {summaryLines.map((line) => (
                            <p key={line} className="text-[10px] font-mono text-heading/90">
                              {sanitizeTaskText(line, projectGoals)}
                            </p>
                          ))}
                        </div>
                      )}

                      {actionState === 'pending' && (
                        <div className="mt-3 flex items-center gap-2">
                          <button type="button" onClick={() => handleApprove(i, action, actionIdx)}
                            className="odyssey-fill-accent3 flex items-center gap-1 px-3 py-1 text-[10px] rounded transition-colors hover:opacity-90 font-medium">
                            <Check size={10} /> {isManualReview ? 'Mark Reviewed' : 'Approve'}
                          </button>
                          <button type="button" onClick={() => handleDeny(i, action, actionIdx)}
                            className="flex items-center gap-1 px-3 py-1 text-[10px] border border-border text-muted rounded hover:text-heading hover:bg-surface2 transition-colors">
                            <Ban size={10} /> Decline
                          </button>
                        </div>
                      )}
                      {actionState === 'executing' && (
                        <div className="mt-3 flex items-center gap-1 text-[10px] text-muted">
                          <Loader2 size={10} className="animate-spin" /> Working…
                        </div>
                      )}
                      {actionState === 'approved' && (
                        <div className="mt-3 flex items-center gap-1 text-[10px] text-accent3">
                          <Check size={10} /> {isManualReview ? 'Marked reviewed' : 'Approved & executed'}
                        </div>
                      )}
                      {actionState === 'denied' && (
                        <div className="mt-3 flex items-center gap-1 text-[10px] text-muted">
                          <Ban size={10} /> Declined
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface2 border border-border px-3 py-2 rounded flex items-center gap-2 mr-2">
              <Loader2 size={11} className="animate-spin text-accent" />
              <span className="text-[10px] text-muted font-mono">Thinking…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="text-[10px] text-danger bg-danger/5 border border-danger/20 rounded px-3 py-2 font-mono">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-surface">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {attachments.map((att) => (
              <AttachmentChip key={att.id} att={att} onRemove={() => removeAttachment(att.id)} />
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="px-2 py-1 flex gap-1.5 items-stretch">
          {/* + / dictation stack */}
          <div className="relative shrink-0 flex self-stretch">
            <div className="pc-stack-control">
              <button
                type="button"
                ref={contextBtnRef}
                title="Add context"
                onClick={() => {
                  setContextOpen((o) => {
                    if (!o && contextBtnRef.current) {
                      const r = contextBtnRef.current.getBoundingClientRect();
                      setContextPos({ top: r.top, left: r.left });
                    }
                    return !o;
                  });
                  setContextView('main');
                }}
                className={`pc-stack-btn pc-stack-btn--top ${contextOpen ? 'pc-stack-btn--active' : ''}`}
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                title={
                  isDictating
                    ? 'Stop dictation'
                    : speechRecognitionSupported
                      ? 'Start dictation'
                      : 'Dictation unavailable'
                }
                aria-pressed={isDictating}
                onClick={toggleDictation}
                disabled={!speechRecognitionSupported && !isDictating}
                className={`pc-stack-btn pc-stack-btn--bottom ${isDictating ? 'pc-stack-btn--recording' : ''}`}
              >
                <Mic size={12} />
              </button>
            </div>
          </div>

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              if (isDictating) stopDictation('abort');
              setInput(e.target.value);
              resizeTextarea(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            onPaste={handlePaste}
            placeholder={inputPlaceholder}
            rows={1}
            className="pc-input flex-1 bg-surface2 border border-border text-heading text-xs font-mono placeholder:text-muted/50 px-3 py-1 focus:outline-none focus:border-accent/50 rounded"
          />

          {/* Send */}
          <button type="button" onClick={() => sendMessage()}
            disabled={(!input.trim() && attachments.length === 0) || loading}
            title="Send (Enter)"
            className="pc-send-btn bg-accent text-[var(--color-accent-fg)] hover:bg-accent/90 transition-colors disabled:opacity-40">
            <Send size={13} />
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="*/*"
        title="Attach files"
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; setContextOpen(false); }}
      />
      {repoTreeTarget && (
        <RepoTreeModal
          repo={repoTreeTarget.repo}
          type={repoTreeTarget.type}
          projectId={repoTreeTarget.projectId}
          initialPath={repoTreeTarget.initialPath}
          onClose={() => setRepoTreeTarget(null)}
        />
      )}
      {aiErrorDialog}
      {contextOpen && contextPos && createPortal(
        <div
          ref={contextRef}
          style={{
            position: 'fixed',
            top: contextPos.top,
            left: contextPos.left,
            transform: 'translateY(calc(-100% - 8px))',
            zIndex: 9999,
          }}
        >
          <ContextMenu />
        </div>,
        document.body,
      )}
    </div>
  );
}
