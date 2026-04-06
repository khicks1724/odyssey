import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Loader2, Bot, Check, Ban, Plus, Pencil, Trash2, Copy, CheckCheck,
  X, FileText, Github, GitBranch, Image, File, ChevronRight, ChevronDown,
  Download, TableIcon,
} from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { useChatPanel, type ChatMessage as Message, type MessageAttachment, type ReportFormat, type SuggestedTask } from '../lib/chat-panel';
import { downloadDocx, downloadPptx, downloadPdf, exportGoalsCSV } from '../lib/report-download';
import { supabase } from '../lib/supabase';
import { useProjectFilePaths, type FileRef } from '../hooks/useProjectFilePaths';
import MarkdownWithFileLinks from './MarkdownWithFileLinks';
import RepoTreeModal from './RepoTreeModal';
import type { Project } from '../types';
import { useAIErrorDialog } from '../lib/ai-error';
import { getGitLabRepoPaths, type GitLabIntegrationConfig } from '../lib/gitlab';
import { getGitHubRepos } from '../lib/github';
import './ProjectChat.css';

type PendingAction = NonNullable<Message['pendingAction']>;

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

// ── Action config ───────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create_goal: <Plus size={12} />,
  update_goal: <Pencil size={12} />,
  delete_goal: <Trash2 size={12} />,
};

const ACTION_COLORS: Record<string, string> = {
  create_goal: 'border-accent3/30 bg-accent3/5 text-accent3',
  update_goal: 'border-accent2/30 bg-accent2/5 text-accent2',
  delete_goal: 'border-danger/30  bg-danger/5  text-danger',
};

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
  const { messages, setMessages } = useChatPanel();
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

  // Project resources (fetched once)
  const [projectDocs,  setProjectDocs]  = useState<ProjectDoc[]>([]);
  const [githubRepo,   setGithubRepo]   = useState<string[]>([]);
  const [gitlabRepos,  setGitlabRepos]  = useState<string[]>([]);
  const [resourcesReady, setResourcesReady] = useState(false);
  const { filePaths } = useProjectFilePaths(resolvedProjectId, githubRepo, gitlabRepos);
  const [repoTreeTarget, setRepoTreeTarget] = useState<{ repo: string; type: 'github' | 'gitlab'; initialPath?: string; projectId?: string | null } | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const projectPickerRef = useRef<HTMLDivElement>(null);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const messagesRef  = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextRef  = useRef<HTMLDivElement>(null);

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

  // ── Fetch project resources ──────────────────────────────────────────────

  useEffect(() => {
    if (projectId) {
      setResolvedProjectId(projectId);
    } else if (!resolvedProjectId && projects.length > 0) {
      setResolvedProjectId(projects[0].id);
    }
  }, [projectId, projects, resolvedProjectId]);

  useEffect(() => {
    let cancelled = false;
    if (!resolvedProjectId) {
      setGithubRepo(null);
      setGitlabRepos([]);
      setProjectDocs([]);
      setResourcesReady(true);
      return () => { cancelled = true; };
    }

    async function load() {
      // Project record (GitHub repos)
      const { data: proj } = await supabase
        .from('projects')
        .select('github_repo, github_repos')
        .eq('id', resolvedProjectId)
        .maybeSingle();
      if (!cancelled) setGithubRepo(getGitHubRepos(proj));

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
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
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
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if ((!text && attachments.length === 0) || loading) return;
    const targetProjectId = inferProjectFromPrompt(text, projects, resolvedProjectId);
    if (!targetProjectId) {
      setError('No accessible project is available for chat.');
      return;
    }
    const inferredProject = projects.find((project) => project.id === targetProjectId) ?? null;
    setResolvedProjectId(targetProjectId);

    // Build display attachments for the message bubble
    const displayAtts: MessageAttachment[] = attachments.map((a) => ({
      type: a.type,
      name: a.name,
      previewUrl: a.previewUrl,
      mimeType: a.mimeType,
      repo: a.repo,
      repoType: a.repoType,
    }));

    // Build wire attachments for the API
    const wireAtts = attachments.map((a) => ({
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
      content: inferredProject && inferredProject.id !== projectId ? `[Project: ${inferredProject.name}]\n${text}` : text,
      attachments: displayAtts.length ? displayAtts : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    if (!overrideText) setInput('');
    setAttachments([]);
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
          const fmtLabel2 = fmt === 'pptx' ? 'PowerPoint' : fmt === 'pdf' ? 'PDF' : 'Word';
          setMessages((prev) => [
            ...prev.slice(0, -1), // replace the "generating…" message
            {
              role: 'assistant',
              content: `**${rData.title}** is ready — ${rData.sections?.length ?? 0} sections · ${fmtLabel2}`,
              provider: rData.provider,
              reportReady: { data: rData, format: fmt },
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
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: data.message,
          provider: data.provider,
          pendingAction: data.pendingAction ?? undefined,
          actionState: data.pendingAction ? 'pending' : undefined,
        }]);
      }
    } catch {
      setError('Network error — is the server running?');
      showAIError('Network error — is the server running?', 502);
    }
    setLoading(false);
  }, [input, attachments, loading, messages, agent, projectId, projects, resolvedProjectId, notifyModelUsed]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const executeAction = async (action: PendingAction): Promise<string> => {
    const { type, args } = action;
    if (type === 'create_goal') {
      const { data, error: err } = await supabase.from('goals').insert({
        project_id:  projectId,
        title:       args.title as string,
        deadline:    (args.deadline as string) || null,
        category:    (args.category as string) || null,
        assigned_to: (args.assignedTo as string) || null,
        status:      'not_started',
        progress:    0,
      }).select().single();
      if (err) throw err;
      return `Created goal: "${data.title}"`;
    }
    if (type === 'update_goal') {
      const updates = args.updates as Record<string, unknown>;
      const { data, error: err } = await supabase.from('goals')
        .update(updates).eq('id', args.goalId as string).select().single();
      if (err) throw err;
      return `Updated goal: "${data.title}"`;
    }
    if (type === 'delete_goal') {
      const { error: err } = await supabase.from('goals').delete().eq('id', args.goalId as string);
      if (err) throw err;
      return `Deleted goal: "${args.goalTitle}"`;
    }
    throw new Error(`Unknown action type: ${type}`);
  };

  const handleApprove = async (msgIdx: number, action: PendingAction) => {
    setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, actionState: 'approved' } : m));
    try {
      const result = await executeAction(action);
      onGoalMutated?.();
      sendMessage(`Action completed: ${result}`);
    } catch (err) {
      console.error('Action failed:', err);
      setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, actionState: 'pending' } : m));
      setError(`Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      showAIError(`Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDeny = (msgIdx: number, action: PendingAction) => {
    setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, actionState: 'denied' } : m));
    sendMessage(`User declined: "${action.description}". Please suggest an alternative.`);
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
            <div className="text-xs font-bold text-heading font-sans">Project AI</div>
            {/* Clickable project switcher */}
            <div className="relative" ref={projectPickerRef}>
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
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="pc-messages flex-1 p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot size={24} className="text-muted mx-auto mb-2" />
            <p className="text-xs text-muted font-mono">
              Ask me anything about <span className="text-accent">{selectedProject?.name ?? projectName ?? 'your projects'}</span>
            </p>
            <p className="text-[10px] text-muted/60 mt-1">
              I can create, edit, and delete tasks — I'll always ask before acting.
            </p>
            <p className="text-[10px] text-muted/40 mt-0.5">
              Use <span className="text-accent/60">+</span> to attach files, images, documents, or repos.
            </p>
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
                          <MarkdownWithFileLinks block={false} filePaths={[]} onFileClick={() => {}} githubRepo={null} gitlabRepos={[]} onRepoClick={() => {}}>
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
                        if (fmt === 'docx') await downloadDocx(data);
                        else if (fmt === 'pptx') await downloadPptx(data);
                        else await downloadPdf(data);
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

            {msg.pendingAction && msg.actionState && (
              <div className="mr-2 mt-2">
                <div className={`border rounded p-3 ${ACTION_COLORS[msg.pendingAction.type] ?? 'border-border bg-surface2'}`}>
                  <div className="flex items-center gap-1.5 mb-1.5 font-medium text-[10px] uppercase tracking-wider">
                    {ACTION_ICONS[msg.pendingAction.type]}
                    Proposed Action
                  </div>
                  <p className="text-xs text-heading leading-snug mb-2">{msg.pendingAction.description}</p>
                  {msg.actionState === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => handleApprove(i, msg.pendingAction!)}
                        className="flex items-center gap-1 px-3 py-1 text-[10px] bg-accent3 text-white rounded hover:bg-accent3/90 transition-colors font-medium">
                        <Check size={10} /> Approve
                      </button>
                      <button type="button" onClick={() => handleDeny(i, msg.pendingAction!)}
                        className="flex items-center gap-1 px-3 py-1 text-[10px] border border-border text-muted rounded hover:text-heading hover:bg-surface2 transition-colors">
                        <Ban size={10} /> Decline
                      </button>
                    </div>
                  )}
                  {msg.actionState === 'approved' && (
                    <div className="flex items-center gap-1 text-[10px] text-accent3">
                      <Check size={10} /> Approved &amp; executed
                    </div>
                  )}
                  {msg.actionState === 'denied' && (
                    <div className="flex items-center gap-1 text-[10px] text-muted">
                      <Ban size={10} /> Declined
                    </div>
                  )}
                </div>
              </div>
            )}
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
          {/* + context button */}
          <div className="relative shrink-0 flex self-stretch" ref={contextRef}>
            <button
              type="button"
              title="Add context"
              onClick={() => { setContextOpen((o) => !o); setContextView('main'); }}
              className="pc-add-btn h-full"
            >
              <Plus size={14} />
            </button>
            {contextOpen && <ContextMenu />}
          </div>

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); resizeTextarea(e.target); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            onPaste={handlePaste}
            placeholder="Prompt or add files…"
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
    </div>
  );
}
