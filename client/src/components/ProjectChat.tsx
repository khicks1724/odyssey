import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Loader2, Bot, Check, Ban, Plus, Pencil, Trash2, Copy, CheckCheck,
  X, FileText, Github, GitBranch, Image, File, ChevronRight,
} from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { useChatPanel, type ChatMessage as Message, type MessageAttachment } from '../lib/chat-panel';
import { supabase } from '../lib/supabase';
import { useProjectFilePaths, type FileRef } from '../hooks/useProjectFilePaths';
import MarkdownWithFileLinks from './MarkdownWithFileLinks';
import RepoTreeModal from './RepoTreeModal';
import type { Project } from '../types';
import { useAIErrorDialog } from '../lib/ai-error';
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
  const [githubRepo,   setGithubRepo]   = useState<string | null>(null);
  const [gitlabRepos,  setGitlabRepos]  = useState<string[]>([]);
  const [resourcesReady, setResourcesReady] = useState(false);
  const { filePaths } = useProjectFilePaths(githubRepo, gitlabRepos);
  const [repoTreeTarget, setRepoTreeTarget] = useState<{ repo: string; type: 'github' | 'gitlab'; initialPath?: string } | null>(null);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextRef  = useRef<HTMLDivElement>(null);

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
      // Project record (github_repo)
      const { data: proj } = await supabase
        .from('projects')
        .select('github_repo')
        .eq('id', resolvedProjectId)
        .maybeSingle();
      if (!cancelled) setGithubRepo(proj?.github_repo ?? null);

      // GitLab repos
      const { data: gl } = await supabase
        .from('integrations')
        .select('config')
        .eq('project_id', resolvedProjectId)
        .eq('type', 'gitlab')
        .maybeSingle();
      if (!cancelled && gl?.config) {
        const cfg = gl.config as { repos?: string[]; repo?: string };
        setGitlabRepos(cfg.repos ?? (cfg.repo ? [cfg.repo] : []));
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

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

  // ── Context menu sections ────────────────────────────────────────────────

  const hasRepos = githubRepo || gitlabRepos.length > 0;

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
            {githubRepo && (() => {
              const id = `repo:${githubRepo}`;
              const checked = addedIds.has(id);
              return (
                <button type="button" onClick={() => toggleRepo(githubRepo, 'github')}
                  className={`pc-ctx-item ${checked ? 'pc-ctx-item--active' : ''}`}>
                  <Github size={11} className="shrink-0" />
                  <span className="truncate flex-1 font-mono">{githubRepo}</span>
                  {checked && <Check size={10} className="text-accent shrink-0" />}
                </button>
              );
            })()}
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
              {(githubRepo ? 1 : 0) + gitlabRepos.length}
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
          <div className="min-w-0">
            <div className="text-xs font-bold text-heading font-sans">Project AI</div>
            <div className="text-[10px] text-muted font-mono truncate">{selectedProject?.name ?? projectName ?? 'No project selected'}</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="pc-messages flex-1 p-4 space-y-3">
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
              {msg.role === 'assistant' ? (
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
                      onFileClick={(ref: FileRef) => setRepoTreeTarget({ repo: ref.repo, type: ref.type, initialPath: ref.path })}
                      githubRepo={githubRepo}
                      gitlabRepos={gitlabRepos}
                      onRepoClick={(repo, type) => setRepoTreeTarget({ repo, type })}
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
        <div className="p-2 flex gap-1.5 items-stretch">
          {/* + context button */}
          <div className="relative shrink-0" ref={contextRef}>
            <button
              type="button"
              title="Add context"
              onClick={() => { setContextOpen((o) => !o); setContextView('main'); }}
              className="pc-add-btn"
            >
              <Plus size={14} />
            </button>
            {contextOpen && <ContextMenu />}
          </div>

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            onPaste={handlePaste}
            placeholder="Ask or instruct the AI… (paste images, drag & drop files)"
            rows={3}
            className="pc-input flex-1 bg-surface2 border border-border text-heading text-xs font-mono placeholder:text-muted/50 px-3 py-2 focus:outline-none focus:border-accent/50 transition-colors rounded"
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 120) + 'px';
            }}
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
          initialPath={repoTreeTarget.initialPath}
          onClose={() => setRepoTreeTarget(null)}
        />
      )}
      {aiErrorDialog}
    </div>
  );
}
