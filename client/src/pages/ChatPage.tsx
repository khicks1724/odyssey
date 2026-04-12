import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ChatPage.css';
import {
  Bot,
  ChevronRight,
  File,
  FileText,
  FolderKanban,
  Github,
  GitBranch,
  Image as ImageIcon,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { useChatMessages, useChatThreads, type ChatParticipant } from '../hooks/useChatThreads';
import { useProjectFilePaths, type FileRef } from '../hooks/useProjectFilePaths';
import { useSharedProjectPeople } from '../hooks/useSharedProjectPeople';
import { useAuth } from '../lib/auth';
import { useAIAgent } from '../lib/ai-agent';
import { useProfile } from '../hooks/useProfile';
import { getGitLabRepoPaths, type GitLabIntegrationConfig } from '../lib/gitlab';
import { getGitHubRepos } from '../lib/github';
import { supabase } from '../lib/supabase';
import MarkdownWithFileLinks from '../components/MarkdownWithFileLinks';
import LazySyntaxCodeBlock from '../components/LazySyntaxCodeBlock';

// ── Syntax highlight helpers ─────────────────────────────────────────────────
const EXT_LANG: Record<string, string> = {
  py: 'python', js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown', sh: 'bash',
  html: 'html', css: 'css', toml: 'toml', rs: 'rust', go: 'go',
  java: 'java', c: 'c', cpp: 'cpp', h: 'c', rb: 'ruby', php: 'php',
  vue: 'html', svelte: 'html', kt: 'kotlin', swift: 'swift', cs: 'csharp',
  sql: 'sql', r: 'r', scala: 'scala', ini: 'ini', cfg: 'ini',
  txt: 'text', gitignore: 'bash', dockerfile: 'dockerfile',
};
function getLang(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  const ext = name.split('.').pop() ?? '';
  return EXT_LANG[ext] ?? 'text';
}

// Warm, low-contrast theme that matches the app's parchment palette
const odysseyCodeTheme: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': { color: '#1e3a5f', background: 'none', fontFamily: 'inherit', fontSize: '12px', lineHeight: '1.6' },
  'pre[class*="language-"]':  { color: '#1e3a5f', background: '#ece7df', margin: 0, padding: '16px 20px', overflow: 'auto' },
  comment:   { color: '#8a9bb0', fontStyle: 'italic' },
  prolog:    { color: '#8a9bb0' },
  doctype:   { color: '#8a9bb0' },
  cdata:     { color: '#8a9bb0' },
  punctuation: { color: '#6b7a8d' },
  property:  { color: '#1e3a5f' },
  keyword:   { color: '#2a5a8f', fontWeight: '600' },
  tag:       { color: '#2a5a8f' },
  'class-name': { color: '#3a7a6a', fontWeight: '600' },
  boolean:   { color: '#b91c1c' },
  constant:  { color: '#b91c1c' },
  symbol:    { color: '#b91c1c' },
  deleted:   { color: '#b91c1c' },
  number:    { color: '#9a3a1a' },
  selector:  { color: '#3a7a6a' },
  'attr-name': { color: '#3a7a6a' },
  string:    { color: '#2e6a3a' },
  char:      { color: '#2e6a3a' },
  builtin:   { color: '#2e6a3a' },
  inserted:  { color: '#2e6a3a' },
  operator:  { color: '#6b7a8d' },
  entity:    { color: '#9a3a1a', cursor: 'help' },
  url:       { color: '#2a5a8f', textDecoration: 'underline' },
  variable:  { color: '#6b3a8a' },
  atrule:    { color: '#2a5a8f', fontWeight: '600' },
  'attr-value': { color: '#2e6a3a' },
  function:  { color: '#1e3a5f', fontWeight: '600' },
  'function-variable': { color: '#1e3a5f', fontWeight: '600' },
  regex:     { color: '#9a3a1a' },
  important: { color: '#b91c1c', fontWeight: '600' },
  bold:      { fontWeight: '600' },
  italic:    { fontStyle: 'italic' },
};

type PendingContext =
  | { id: string; type: 'text-file' | 'document'; name: string; textContent: string }
  | { id: string; type: 'image'; name: string; base64: string; mimeType: string; previewUrl?: string }
  | { id: string; type: 'repo'; name: string; repo: string; repoType: 'github' | 'gitlab' }
  | { id: string; type: 'copied-text'; name: string; textContent: string };

// ── Slash command registry ──────────────────────────────────────────────────
interface SlashCommand {
  command: string;
  description: string;
  usage: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/ai',        usage: '/ai <prompt>',    description: 'Ask the AI a one-shot question'           },
  { command: '/ai on',     usage: '/ai on',          description: 'Enable persistent AI mode for this chat'  },
  { command: '/ai off',    usage: '/ai off',         description: 'Disable AI mode'                          },
  { command: '/summarize', usage: '/summarize',      description: 'Summarize this conversation'               },
  { command: '/standup',   usage: '/standup',        description: 'Generate a standup report for this project'},
  { command: '/tasks',     usage: '/tasks',          description: 'List active project goals & their status'  },
  { command: '/report',    usage: '/report',         description: 'Generate a quick project status snippet'   },
  { command: '/note',      usage: '/note <text>',    description: 'Save a note to the project timeline'       },
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function initials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'O';
}

function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance > 0.5) {
    const darken = (c: number) => Math.max(0, Math.round(c * 0.35));
    return `rgb(${darken(r)},${darken(g)},${darken(b)})`;
  }
  const lighten = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.75));
  return `rgb(${lighten(r)},${lighten(g)},${lighten(b)})`;
}

function Avatar({
  label,
  image,
  kind,
  className = '',
}: {
  label: string;
  image?: string | null;
  kind: 'project' | 'direct';
  className?: string;
}) {
  if (image?.startsWith('{')) {
    try {
      const custom = JSON.parse(image) as { initials?: string; color?: string };
      return (
        <div
          className={`rounded-full flex items-center justify-center text-[11px] font-semibold ${className}`}
          style={{ backgroundColor: custom.color ?? '#1d4ed8', color: contrastColor(custom.color ?? '#1d4ed8') }}
        >
          {custom.initials ?? initials(label)}
        </div>
      );
    } catch { /* fall through */ }
  }

  if (image) {
    return <img src={image} alt="" className={`rounded-full object-cover ${className}`} />;
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center text-[11px] font-semibold ${
        kind === 'project' ? 'bg-accent/15 text-accent' : 'bg-accent2/15 text-accent2'
      } ${className}`}
    >
      {initials(label)}
    </div>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { agent } = useAIAgent();
  const { projects } = useProjects();
  const {
    threads,
    participantsByThread,
    lastMessageByThread,
    threadStateByThread,
    loading: threadsLoading,
    createDirectThread,
    updateThread,
    markThreadRead,
    hideDirectThread,
  } = useChatThreads();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [hasInput, setHasInput] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [creatingDm, setCreatingDm] = useState(false);
  const [contexts, setContexts] = useState<PendingContext[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextView, setContextView] = useState<'main' | 'repos' | 'docs'>('main');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const [streamingMsg, setStreamingMsg] = useState<{ content: string; status: string } | null>(null);
  const [aiQueueLength, setAiQueueLength] = useState(0);
  // Queue of prompts waiting for AI to finish current response
  const aiQueueRef = useRef<Array<{ prompt: string; threadId: string }>>([]);
  const aiProcessingRef = useRef(false);
  const [gitlabRepos, setGitlabRepos] = useState<string[]>([]);
  const [projectDocs, setProjectDocs] = useState<Array<{ id: string; name: string; text: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contextRef = useRef<HTMLDivElement | null>(null);
  const creatingDmRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const { messages, loading: messagesLoading, sendMessage, toggleReaction, last24hMessages } = useChatMessages(selectedThreadId);
  const { people: dmCandidates, loading: dmCandidatesLoading } = useSharedProjectPeople();
  const groupedDmCandidates = useMemo(() => {
    const grouped = new Map<string, {
      id: string;
      displayName: string;
      avatarUrl: string | null;
      projectNames: string[];
      representativeProjectId: string | null;
    }>();

    for (const candidate of dmCandidates) {
      const existing = grouped.get(candidate.id);
      const displayName = candidate.display_name ?? candidate.id;
      if (!existing) {
        grouped.set(candidate.id, {
          id: candidate.id,
          displayName,
          avatarUrl: candidate.avatar_url,
          projectNames: candidate.project_name ? [candidate.project_name] : [],
          representativeProjectId: candidate.project_id ?? null,
        });
        continue;
      }
      if (candidate.project_name && !existing.projectNames.includes(candidate.project_name)) {
        existing.projectNames.push(candidate.project_name);
      }
      if (!existing.avatarUrl && candidate.avatar_url) {
        existing.avatarUrl = candidate.avatar_url;
      }
      if (!existing.representativeProjectId && candidate.project_id) {
        existing.representativeProjectId = candidate.project_id;
      }
    }

    return [...grouped.values()]
      .map((candidate) => ({
        ...candidate,
        projectNames: [...candidate.projectNames].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [dmCandidates]);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, selectedThreadId]);

  useEffect(() => {
    if (selectedThreadId && !threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threads[0]?.id ?? null);
    }
  }, [threads, selectedThreadId]);

  const needsInstantScroll = useRef(false);
  // When thread switches, flag that the next scroll should be instant
  useEffect(() => {
    needsInstantScroll.current = true;
  }, [selectedThreadId]);

  useEffect(() => {
    const behavior = needsInstantScroll.current ? 'instant' : 'smooth';
    needsInstantScroll.current = false;
    bottomRef.current?.scrollIntoView({ behavior });
  }, [messages]);

  useEffect(() => {
    if (!selectedThreadId || document.visibilityState !== 'visible') return;
    void markThreadRead(selectedThreadId).catch((error) => {
      console.error('Failed to mark thread read:', error);
    });
  }, [selectedThreadId, messages.length, markThreadRead]);

  // Clear the AI queue when the user switches threads
  useEffect(() => {
    aiQueueRef.current = [];
    setAiQueueLength(0);
    aiProcessingRef.current = false;
  }, [selectedThreadId]);

  const relatedProjectId = selectedThread?.project_id ?? selectedThread?.related_project_id ?? null;

  useEffect(() => {
    if (!relatedProjectId) {
      setGitlabRepos([]);
      setProjectDocs([]);
      return;
    }

    Promise.all([
      supabase.from('integrations').select('config').eq('project_id', relatedProjectId).eq('type', 'gitlab').maybeSingle(),
      supabase
        .from('events')
        .select('id, title, metadata')
        .eq('project_id', relatedProjectId)
        .eq('event_type', 'file_upload')
        .order('occurred_at', { ascending: false })
        .limit(8),
    ]).then(([gitlabRes, docsRes]) => {
      const cfg = gitlabRes.data?.config as GitLabIntegrationConfig | null;
      setGitlabRepos(getGitLabRepoPaths(cfg));
      const docs = (docsRes.data ?? []).map((doc) => {
        const meta = (doc.metadata ?? {}) as { extracted_text?: string; filename?: string };
        return {
          id: doc.id,
          name: meta.filename ?? doc.title ?? 'Project document',
          text: meta.extracted_text ?? '',
        };
      }).filter((doc) => doc.text.trim());
      setProjectDocs(docs);
    });
  }, [selectedThread?.project_id, selectedThread?.related_project_id]);

  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  // Derive relatedProject early so we can pass GitHub repos to the file paths hook
  const relatedProjectEarly = selectedThread
    ? projectMap.get(selectedThread.project_id ?? selectedThread.related_project_id ?? '')
    : null;
  const relatedGithubRepos = getGitHubRepos(relatedProjectEarly);

  const { filePaths: chatFilePaths, fetchFileContent } = useProjectFilePaths(
    relatedProjectId,
    getGitHubRepos(relatedProjectEarly),
    gitlabRepos,
  );

  const [filePreview, setFilePreview] = useState<{ ref: FileRef; content: string | null; loading: boolean } | null>(null);
  const [repoPreview, setRepoPreview] = useState<{ repo: string; type: 'github' | 'gitlab'; projectId?: string | null } | null>(null);

  const handleChatFileClick = async (ref: FileRef) => {
    setFilePreview({ ref, content: null, loading: true });
    try {
      const content = await fetchFileContent(ref);
      setFilePreview({ ref, content, loading: false });
    } catch {
      setFilePreview({ ref, content: '(Could not load file content)', loading: false });
    }
  };

  const handleRepoClick = (repo: string, type: 'github' | 'gitlab') => {
    setRepoPreview({ repo, type, projectId: type === 'gitlab' ? relatedProjectId : null });
  };

  const getOtherParticipant = (threadId: string): ChatParticipant | null =>
    (participantsByThread[threadId] ?? []).find((person) => person.id !== user?.id) ?? null;

  const getThreadTitle = (threadId: string) => {
    const thread = threads.find((item) => item.id === threadId);
    if (!thread) return 'Conversation';
    if (thread.kind === 'project') {
      return projectMap.get(thread.project_id ?? '')?.name ?? thread.title ?? 'Project Chat';
    }
    return getOtherParticipant(threadId)?.display_name ?? 'Direct Message';
  };

  const getLastSender = (threadId: string) => {
    const preview = lastMessageByThread[threadId];
    if (!preview) return null;
    if (preview.role === 'assistant') return 'AI';
    if (preview.role === 'system') return 'System';
    if (preview.sender_id === user?.id) return profile?.display_name ?? 'You';
    return getOtherParticipant(threadId)?.display_name ?? 'Member';
  };

  const getPreviewText = (threadId: string) => {
    const preview = lastMessageByThread[threadId];
    if (!preview) {
      const thread = threads.find((item) => item.id === threadId);
      return thread?.kind === 'project' ? 'Project chat ready.' : 'No messages yet.';
    }
    const prefix =
      preview.role === 'assistant' ? 'AI' :
      preview.role === 'system' ? 'System' :
      preview.sender_id === user?.id ? 'You' : getOtherParticipant(threadId)?.display_name ?? 'Member';
    return `${prefix}: ${preview.content.replace(/\s+/g, ' ').trim()}`;
  };

  const threadCards = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return threads.filter((thread) => {
      if (!lowered) return true;
      const haystack = [getThreadTitle(thread.id), getPreviewText(thread.id), thread.kind].join(' ').toLowerCase();
      return haystack.includes(lowered);
    });
  }, [threads, search, participantsByThread, lastMessageByThread, projects, user?.id]);

  const groupedThreads = useMemo(() => ({
    project: threadCards.filter((thread) => thread.kind === 'project'),
    direct: threadCards.filter((thread) => thread.kind === 'direct'),
  }), [threadCards]);

  const relatedProject = relatedProjectEarly;

  // Close context menu on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextOpen(false);
        setContextView('main');
      }
      if (creatingDmRef.current && !creatingDmRef.current.contains(e.target as Node)) {
        setCreatingDm(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const addRepoContext = (repo: string, repoType: 'github' | 'gitlab') => {
    setContexts((prev) => [...prev, { id: makeId(), type: 'repo', name: repo, repo, repoType }]);
  };

  const removeContext = (id: string) => setContexts((prev) => prev.filter((ctx) => ctx.id !== id));

  const lightweightContexts = contexts.map((ctx) => {
    if (ctx.type === 'repo') return { type: ctx.type, name: ctx.name, repo: ctx.repo, repoType: ctx.repoType };
    if (ctx.type === 'image') return { type: ctx.type, name: ctx.name, mimeType: ctx.mimeType };
    return { type: ctx.type, name: ctx.name };
  });

  const handleUpload = async (file: File) => {
    if (file.type.startsWith('image/')) {
      const base64 = await file.arrayBuffer().then((buf) => btoa(String.fromCharCode(...new Uint8Array(buf))));
      setContexts((prev) => [...prev, { id: makeId(), type: 'image', name: file.name, mimeType: file.type, base64, previewUrl: URL.createObjectURL(file) }]);
      return;
    }

    const textContent = await file.text();
    setContexts((prev) => [...prev, { id: makeId(), type: file.type.includes('pdf') ? 'document' : 'text-file', name: file.name, textContent: textContent.slice(0, 20000) }]);
  };

  const invokeAI = async (prompt: string, threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    const projectId = thread.project_id ?? thread.related_project_id;
    if (!projectId) {
      await sendMessage({ thread_id: threadId, sender_id: null, role: 'system', content: 'AI is only available in chats linked to a project context.', metadata: {} });
      return;
    }

    const convo = [...last24hMessages, {
      id: 'pending', thread_id: threadId, sender_id: user?.id ?? null,
      role: 'user' as const, content: prompt, metadata: null, created_at: new Date().toISOString(),
    }]
      .slice(-20)
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: msg.role === 'system' ? `[System] ${msg.content}` : msg.content,
      }));

    const wireAttachments = contexts.map((ctx) => {
      if (ctx.type === 'repo') return { type: 'repo', name: ctx.name, repo: ctx.repo, repoType: ctx.repoType };
      if (ctx.type === 'image') return { type: 'image', name: ctx.name, base64: ctx.base64, mimeType: ctx.mimeType };
      return { type: ctx.type === 'copied-text' ? 'document' : ctx.type, name: ctx.name, textContent: ctx.textContent };
    });

    setStreamingMsg({ content: '', status: 'Loading context…' });
    let fullText = '';
    let finalProvider = '';

    const { data: sessionData } = await supabase.auth.getSession();
    const authToken = sessionData.session?.access_token;
    const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;

    try {
      const res = await fetch('/api/ai/chat-stream', {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({ agent, projectId, messages: convo, attachments: wireAttachments.length ? wireAttachments : undefined }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `AI request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw);
            if (event.type === 'status') {
              setStreamingMsg((prev) => prev ? { ...prev, status: event.text } : null);
            } else if (event.type === 'token') {
              fullText += event.text as string;
              setStreamingMsg({ content: fullText, status: '' });
            } else if (event.type === 'done') {
              fullText = event.message ?? fullText;
              finalProvider = event.provider ?? '';
            } else if (event.type === 'error') {
              throw new Error(event.message ?? 'AI error');
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (fullText) {
        await sendMessage({
          thread_id: threadId,
          sender_id: null,
          role: 'assistant',
          content: fullText,
          metadata: { provider: finalProvider, ai_requested_by: user?.id ?? null },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unknown error occurred';
      await sendMessage({
        thread_id: threadId,
        sender_id: null,
        role: 'system',
        content: `⚠ AI error: ${msg}`,
        metadata: { command: 'error' },
      }).catch(() => {/* ignore secondary errors */});
    } finally {
      setStreamingMsg(null);
    }
  };

  // Process AI queue one entry at a time
  const processAIQueue = async () => {
    if (aiProcessingRef.current) return;
    aiProcessingRef.current = true;

    while (aiQueueRef.current.length > 0) {
      const next = aiQueueRef.current[0];
      setAiQueueLength(aiQueueRef.current.length);
      await invokeAI(next.prompt, next.threadId);
      aiQueueRef.current.shift();
      setAiQueueLength(aiQueueRef.current.length);
    }

    aiProcessingRef.current = false;
  };

  const enqueueAI = (prompt: string, threadId: string) => {
    aiQueueRef.current.push({ prompt, threadId });
    setAiQueueLength(aiQueueRef.current.length);
    void processAIQueue();
  };

  // ── Slash command helpers ──────────────────────────────────────────────────

  const postSystem = (content: string, cmd: string) =>
    sendMessage({ thread_id: selectedThread!.id, sender_id: null, role: 'system', content, metadata: { command: cmd } });

  const postAssistant = (content: string, provider?: string) =>
    sendMessage({ thread_id: selectedThread!.id, sender_id: null, role: 'assistant', content, metadata: { provider, ai_requested_by: user?.id ?? null } });

  const requireProject = (): string | null => {
    const id = selectedThread?.project_id ?? selectedThread?.related_project_id ?? null;
    if (!id) {
      void postSystem('This command requires a project-linked chat.', 'error');
    }
    return id;
  };

  const invokeAIWithPrompt = async (systemOverride: string, userPrompt: string) => {
    const projectId = requireProject();
    if (!projectId) return;
    const convo = messages
      .filter((m) => m.role !== 'system')
      .slice(-20)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content }));
    const { data: sessionData } = await supabase.auth.getSession();
    const authToken = sessionData.session?.access_token;
    const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: aiHeaders,
      body: JSON.stringify({ agent, projectId, systemOverride, messages: [...convo, { role: 'user', content: userPrompt }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `AI error ${res.status}`);
    await postAssistant(data.message, data.provider);
  };

  const runSummarize = async () => {
    if (messages.length === 0) { await postSystem('Nothing to summarize yet.', '/summarize'); return; }
    await postSystem('Summarizing conversation…', '/summarize');
    const transcript = messages
      .filter((m) => m.role !== 'system')
      .slice(-30)
      .map((m) => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`)
      .join('\n');
    await invokeAIWithPrompt(
      'You are a concise summarizer. Summarize the conversation transcript the user provides. Use bullet points. Be brief and factual.',
      `Summarize this conversation:\n\n${transcript}`,
    );
  };

  const runStandup = async () => {
    const projectId = requireProject();
    if (!projectId) return;
    await postSystem('Generating standup report…', '/standup');
    const { data: sessionData } = await supabase.auth.getSession();
    const authToken = sessionData.session?.access_token;
    const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch('/api/ai/standup', {
      method: 'POST',
      headers: aiHeaders,
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    if (!res.ok) { await postSystem(`Standup failed: ${data.error ?? res.status}`, '/standup'); return; }
    const lines = [
      `**${data.highlights ?? '2-Week Standup'}**`,
      '',
      '**Accomplished**',
      ...(data.accomplished ?? []).map((x: string) => `- ${x}`),
      '',
      '**In Progress**',
      ...(data.inProgress ?? []).map((x: string) => `- ${x}`),
      ...(data.blockers?.length ? ['', '**Blockers**', ...(data.blockers as string[]).map((x) => `- ${x}`)] : []),
    ].join('\n');
    await postAssistant(lines, data.provider);
  };

  const runTasks = async () => {
    const projectId = requireProject();
    if (!projectId) return;
    const { data: goals, error } = await supabase
      .from('goals')
      .select('title, status, progress, deadline, category')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error || !goals) { await postSystem('Could not fetch tasks.', '/tasks'); return; }
    if (goals.length === 0) { await postSystem('No tasks found for this project.', '/tasks'); return; }
    const statusIcon: Record<string, string> = {
      completed: '✓', in_progress: '◑', not_started: '○', blocked: '✗', on_hold: '⏸',
    };
    const lines = goals.map((g) => {
      const icon = statusIcon[g.status] ?? '○';
      const pct = g.progress != null ? ` ${g.progress}%` : '';
      const due = g.deadline ? ` · due ${new Date(g.deadline).toLocaleDateString()}` : '';
      const cat = g.category ? ` [${g.category}]` : '';
      return `${icon} **${g.title}**${pct}${due}${cat}`;
    });
    await postAssistant(`**Project Tasks (${goals.length})**\n\n${lines.join('\n')}`);
  };

  const runReport = async () => {
    const projectId = requireProject();
    if (!projectId) return;
    await postSystem('Generating project status report…', '/report');
    const { data: sessionData2 } = await supabase.auth.getSession();
    const authToken2 = sessionData2.session?.access_token;
    const aiHeaders2: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken2) aiHeaders2['Authorization'] = `Bearer ${authToken2}`;
    const res = await fetch('/api/ai/project-insights', {
      method: 'POST',
      headers: aiHeaders2,
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    if (!res.ok) { await postSystem(`Report failed: ${data.error ?? res.status}`, '/report'); return; }
    const lines = [
      `**Project Status**`,
      '',
      data.status ?? '',
      ...(data.nextSteps?.length ? ['', '**Next Steps**', ...(data.nextSteps as string[]).map((x) => `- ${x}`)] : []),
      ...(data.codeInsights?.length ? ['', '**Code Insights**', ...(data.codeInsights as string[]).map((x) => `- ${x}`)] : []),
    ].join('\n');
    await postAssistant(lines, data.provider);
  };

  const runNote = async (noteText: string) => {
    const projectId = requireProject();
    if (!projectId) return;
    if (!noteText.trim()) { await postSystem('Usage: /note <your note text>', '/note'); return; }
    const { error } = await supabase.from('events').insert({
      project_id: projectId,
      event_type: 'note',
      title: noteText.trim(),
      occurred_at: new Date().toISOString(),
      source: 'manual',
      metadata: { thread_id: selectedThread!.id, author_id: user?.id },
    });
    if (error) { await postSystem(`Failed to save note: ${error.message}`, '/note'); return; }
    await postSystem(`Note saved to project timeline: "${noteText.trim()}"`, '/note');
  };

  const clearTextarea = () => {
    if (textareaRef.current) textareaRef.current.value = '';
    setHasInput(false);
  };

  const handleSend = async (overrideInput?: string) => {
    const text = (overrideInput ?? textareaRef.current?.value ?? '').trim();
    if (!selectedThread || !text || sending) return;
    setSending(true);
    try {
      // /ai on — enable persistent AI mode
      if (text === '/ai on') {
        await updateThread(selectedThread.id, { ai_mode: true, ai_mode_by: user?.id ?? null, ai_mode_started_at: new Date().toISOString() });
        await sendMessage({
          thread_id: selectedThread.id,
          sender_id: null,
          role: 'system',
          content: `${profile?.display_name ?? user?.email ?? 'A user'} enabled AI mode. Every message will get an AI response. Type /ai off to stop.`,
          metadata: { command: '/ai on' },
        });
        clearTextarea();
        setContexts([]);
        return;
      }

      // /ai off — disable persistent AI mode
      if (text === '/ai off') {
        await updateThread(selectedThread.id, { ai_mode: false, ai_mode_by: null, ai_mode_started_at: null });
        await postSystem(`${profile?.display_name ?? user?.email ?? 'A user'} disabled AI mode.`, '/ai off');
        clearTextarea();
        setContexts([]);
        return;
      }

      // Other slash commands
      if (text === '/summarize') { clearTextarea(); await runSummarize(); setContexts([]); return; }
      if (text === '/standup')   { clearTextarea(); await runStandup();   setContexts([]); return; }
      if (text === '/tasks')     { clearTextarea(); await runTasks();     setContexts([]); return; }
      if (text === '/report')    { clearTextarea(); await runReport();    setContexts([]); return; }
      if (text.startsWith('/note')) {
        const noteText = text.slice(5).trim();
        clearTextarea();
        await runNote(noteText);
        setContexts([]);
        return;
      }

      // /ai <prompt> — one-shot AI invocation
      const isSlashAI = text.startsWith('/ai ') || text === '/ai';
      const prompt = isSlashAI ? text.slice(4).trim() : text;

      if (isSlashAI && !prompt) {
        clearTextarea();
        return;
      }

      // Save the full text (including slash command) so it's visible in chat
      await sendMessage({
        thread_id: selectedThread.id,
        sender_id: user?.id ?? null,
        role: 'user',
        content: text,
        metadata: { contexts: lightweightContexts, ai_request: isSlashAI || selectedThread.ai_mode },
      });

      clearTextarea();
      setContexts([]);
      // Enqueue AI — non-blocking so new messages can be sent while AI processes
      if (isSlashAI || selectedThread.ai_mode) enqueueAI(prompt, selectedThread.id);
    } finally {
      setSending(false);
    }
  };

  // ── Context menu popover ────────────────────────────────────────────────
  const ctxItemCls = 'flex items-center gap-2 w-full px-3 py-2 text-[11px] text-left text-[var(--color-text)] hover:bg-[var(--color-surface2)] hover:text-[var(--color-heading)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default';
  const ctxPanelCls = 'absolute bottom-[calc(100%+8px)] left-0 z-60 w-[min(380px,calc(100vw-3rem))] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.35)] overflow-hidden';

  function ContextMenu() {
    if (contextView === 'repos') {
      return (
        <div className={ctxPanelCls}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface2)]">
            <button type="button" onClick={() => setContextView('main')}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-heading transition-colors">
              <ChevronRight size={11} className="rotate-180" /> Back
            </button>
            <span className="text-[10px] text-muted font-mono ml-auto">Repositories</span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {relatedGithubRepos.length === 0 && gitlabRepos.length === 0 && (
              <div className="px-3 py-4 text-center text-[10px] text-muted">No repos linked to this project.</div>
            )}
            {relatedGithubRepos.map((repo) => (
              <button key={repo} type="button"
                onClick={() => { addRepoContext(repo, 'github'); setContextOpen(false); setContextView('main'); }}
                className={ctxItemCls}>
                <Github size={11} className="shrink-0" />
                <span className="truncate flex-1 font-mono">{repo}</span>
              </button>
            ))}
            {gitlabRepos.map((repo) => (
              <button key={repo} type="button"
                onClick={() => { addRepoContext(repo, 'gitlab'); setContextOpen(false); setContextView('main'); }}
                className={ctxItemCls}>
                <GitBranch size={11} className="text-[#FC6D26] shrink-0" />
                <span className="truncate flex-1 font-mono">{repo}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (contextView === 'docs') {
      return (
        <div className={ctxPanelCls}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface2)]">
            <button type="button" onClick={() => setContextView('main')}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-heading transition-colors">
              <ChevronRight size={11} className="rotate-180" /> Back
            </button>
            <span className="text-[10px] text-muted font-mono ml-auto">Project Documents</span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {projectDocs.length === 0 && <div className="px-3 py-4 text-center text-[10px] text-muted">No documents found.</div>}
            {projectDocs.map((doc) => (
              <button key={doc.id} type="button"
                onClick={() => {
                  setContexts((prev) => [...prev, { id: makeId(), type: 'document', name: doc.name, textContent: doc.text.slice(0, 20000) }]);
                  setContextOpen(false);
                  setContextView('main');
                }}
                className={ctxItemCls}>
                <FileText size={11} className="text-muted shrink-0" />
                <span className="truncate flex-1">{doc.name}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className={ctxPanelCls}>
        <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface2)]">
          <span className="text-[10px] font-medium text-heading">Add context</span>
        </div>
        <div className="py-1">
          <button type="button" onClick={() => { fileInputRef.current?.click(); setContextOpen(false); }}
            className={ctxItemCls}>
            <File size={11} className="text-accent shrink-0" />
            <span>Upload file or image…</span>
          </button>
          <button type="button" onClick={() => setContextView('repos')}
            className={`${ctxItemCls} justify-between`} disabled={!relatedProject}>
            <div className="flex items-center gap-2">
              <Github size={11} className="text-accent3 shrink-0" />
              <span>Repo context</span>
            </div>
            <span className="flex items-center gap-1 text-muted text-[10px]">
              {relatedGithubRepos.length + gitlabRepos.length}
              <ChevronRight size={10} />
            </span>
          </button>
          <button type="button" onClick={() => setContextView('docs')}
            className={`${ctxItemCls} justify-between`} disabled={!relatedProject}>
            <div className="flex items-center gap-2">
              <FileText size={11} className="text-accent2 shrink-0" />
              <span>Document context</span>
            </div>
            <span className="flex items-center gap-1 text-muted text-[10px]">
              {projectDocs.length}
              <ChevronRight size={10} />
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-chat-page h-full min-h-0 bg-surface">
      <div className="h-full min-h-0 grid grid-cols-[280px_minmax(0,1fr)] items-stretch">
        <aside className="border-r border-border bg-surface2/40 flex flex-col min-h-0">
          <div ref={creatingDmRef} className="shrink-0">
            <div className="px-5 pt-5 pb-4 border-b border-border/80">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] tracking-[0.24em] uppercase text-accent2 mb-2 font-mono">Chat</p>
                <h1 className="font-sans text-3xl font-extrabold tracking-tight text-heading">Chat</h1>
              </div>
              <button
                type="button"
                onClick={() => setCreatingDm((prev) => !prev)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-accent/30 text-accent text-[11px] font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors"
              >
                <Plus size={13} />
                New Chat
              </button>
            </div>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-surface text-sm text-heading placeholder:text-muted/60 focus:outline-none focus:border-accent/40"
              />
            </div>
            </div>

            {creatingDm && (
              <div className="mx-4 mt-4 border border-border rounded-2xl bg-surface overflow-hidden shrink-0">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[10px] tracking-[0.18em] uppercase text-muted font-semibold">New direct message</p>
                </div>
                <div className="max-h-56 overflow-y-auto p-2">
                  {dmCandidatesLoading ? (
                    <p className="px-3 py-4 text-xs text-muted">Loading eligible users…</p>
                  ) : groupedDmCandidates.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-muted">No eligible users yet.</p>
                  ) : groupedDmCandidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={async () => {
                        const threadId = await createDirectThread(candidate.id, candidate.representativeProjectId);
                        setSelectedThreadId(threadId);
                        setCreatingDm(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface2 transition-colors text-left"
                    >
                      <Avatar label={candidate.displayName} image={candidate.avatarUrl} kind="direct" className="w-9 h-9" />
                      <div className="min-w-0">
                        <p className="text-sm text-heading font-semibold truncate">{candidate.displayName}</p>
                        <p className="text-[11px] text-muted truncate">
                          {candidate.projectNames.length > 0 ? candidate.projectNames.join(', ') : 'Eligible for DM'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
            {threadsLoading ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-border/50 animate-pulse" />)
            ) : (
              <>
                <section>
                  <div className="flex items-center gap-2 px-2 mb-2">
                    <FolderKanban size={13} className="text-accent" />
                    <h2 className="text-[11px] tracking-[0.2em] uppercase text-muted font-semibold">Projects</h2>
                  </div>
                  <div className="space-y-1.5">
                    {groupedThreads.project.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted">No project chats found.</p>
                    ) : groupedThreads.project.map((thread) => {
                      const title = getThreadTitle(thread.id);
                      const preview = lastMessageByThread[thread.id];
                      const unreadCount = threadStateByThread[thread.id]?.unread_count ?? 0;
                      const project = projectMap.get(thread.project_id ?? '');
                      return (
                        <button
                          key={thread.id}
                          type="button"
                          onClick={() => setSelectedThreadId(thread.id)}
                          className={`w-full flex items-start gap-3 px-3 py-3 rounded-2xl border transition-colors ${
                            selectedThreadId === thread.id ? 'border-accent/40 bg-accent/8' : 'border-transparent hover:border-border hover:bg-surface'
                          }`}
                        >
                          <Avatar label={title} image={project?.image_url ?? null} kind="project" className="w-10 h-10 shrink-0" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-heading truncate">{title}</p>
                              <div className="flex items-center gap-2 shrink-0">
                                {unreadCount > 0 && (
                                  <span className="odyssey-text-on-accent min-w-5 h-5 px-1.5 rounded-full bg-accent text-[10px] font-mono font-semibold flex items-center justify-center">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                  </span>
                                )}
                                {preview?.created_at && <span className="text-[10px] text-muted font-mono">{formatTimestamp(preview.created_at)}</span>}
                              </div>
                            </div>
                            <p className="text-[11px] text-muted mt-0.5 truncate">{getLastSender(thread.id) ?? (project?.description || 'Project group conversation')}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-2 px-2 mb-2">
                    <MessageCircle size={13} className="text-accent2" />
                    <h2 className="text-[11px] tracking-[0.2em] uppercase text-muted font-semibold">Direct Messages</h2>
                  </div>
                  <div className="space-y-1.5">
                    {groupedThreads.direct.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted">No direct messages yet.</p>
                    ) : groupedThreads.direct.map((thread) => {
                      const title = getThreadTitle(thread.id);
                      const preview = lastMessageByThread[thread.id];
                      const unreadCount = threadStateByThread[thread.id]?.unread_count ?? 0;
                      const other = getOtherParticipant(thread.id);
                      const threadProject = projectMap.get(thread.related_project_id ?? '');
                      return (
                        <div
                          key={thread.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedThreadId(thread.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedThreadId(thread.id);
                            }
                          }}
                          className={`w-full flex items-start gap-3 px-3 py-3 rounded-2xl border transition-colors ${
                            selectedThreadId === thread.id ? 'border-accent2/40 bg-accent2/8' : 'border-transparent hover:border-border hover:bg-surface'
                          }`}
                        >
                          <Avatar label={title} image={other?.avatar_url} kind="direct" className="w-10 h-10 shrink-0" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-heading truncate">{title}</p>
                              <div className="flex items-center gap-2 shrink-0">
                                {unreadCount > 0 && (
                                  <span className="odyssey-text-on-accent2 min-w-5 h-5 px-1.5 rounded-full bg-accent2 text-[10px] font-mono font-semibold flex items-center justify-center">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                  </span>
                                )}
                                {preview?.created_at && <span className="text-[10px] text-muted font-mono">{formatTimestamp(preview.created_at)}</span>}
                              </div>
                            </div>
                            <p className="text-[11px] text-muted mt-0.5 truncate">{getLastSender(thread.id) ?? (threadProject ? `Linked to ${threadProject.name}` : 'Direct conversation')}</p>
                          </div>
                          <button
                            type="button"
                            title={`Delete conversation with ${title}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void hideDirectThread(thread.id).then(() => {
                                if (selectedThreadId === thread.id) {
                                  setSelectedThreadId(null);
                                }
                              }).catch((error) => {
                                console.error('Failed to delete direct thread:', error);
                              });
                            }}
                            className="shrink-0 p-1 text-muted hover:text-danger transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>
        </aside>

        <section className="h-full min-h-0 flex flex-col bg-surface">
          {selectedThread ? (
            <>
              <div className="px-5 py-3 border-b border-border bg-surface">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      label={getThreadTitle(selectedThread.id)}
                      image={selectedThread.kind === 'direct' ? getOtherParticipant(selectedThread.id)?.avatar_url : (relatedProject?.image_url ?? null)}
                      kind={selectedThread.kind}
                      className="w-9 h-9 shrink-0"
                    />
                    <div className="min-w-0">
                      <h2 className="text-base font-sans font-bold text-heading truncate">{getThreadTitle(selectedThread.id)}</h2>
                      <p className="text-xs text-muted truncate">
                        {selectedThread.kind === 'project'
                          ? 'Project chat'
                          : relatedProject
                            ? `DM · ${relatedProject.name}`
                            : 'Direct message'}
                        {selectedThread.ai_mode ? ' · AI mode on' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {selectedThread.kind === 'direct' && (
                      <button
                        type="button"
                        onClick={() => {
                          void hideDirectThread(selectedThread.id).then(() => {
                            setSelectedThreadId(null);
                          }).catch((error) => {
                            console.error('Failed to delete direct thread:', error);
                          });
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-danger/30 text-danger text-[10px] font-semibold tracking-wider uppercase hover:bg-danger/5 transition-colors"
                      >
                        <Trash2 size={11} />
                        Delete Chat
                      </button>
                    )}
                    <div className="text-[10px] text-muted font-mono">
                      {lastMessageByThread[selectedThread.id]?.created_at ? `Updated ${formatTimestamp(lastMessageByThread[selectedThread.id]!.created_at)}` : 'Ready'}
                    </div>
                          </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 bg-surface">
                {messagesLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-2xl bg-border/50 animate-pulse" />)}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center">
                    <div>
                      <MessageSquare size={28} className="text-muted/40 mx-auto mb-4" />
                      <p className="text-base text-muted">No messages yet. Start the conversation or type <span className="font-mono text-accent">/ai</span> to invoke AI.</p>
                    </div>
                  </div>
                ) : (
                  <div className="app-chat-thread-width max-w-4xl mx-auto">
                    {messages.map((message, idx) => {
                      const mine = message.sender_id && message.sender_id === user?.id;
                      const sender =
                        message.role === 'assistant' ? { label: 'AI', avatar: null, kind: 'direct' as const } :
                        message.role === 'system' ? { label: 'System', avatar: null, kind: 'project' as const } :
                        mine ? { label: profile?.display_name ?? 'You', avatar: null, kind: 'direct' as const } :
                        { label: getOtherParticipant(selectedThread.id)?.display_name ?? 'Member', avatar: getOtherParticipant(selectedThread.id)?.avatar_url ?? null, kind: 'direct' as const };
                      const metadata = (message.metadata ?? {}) as { provider?: string; reactions?: Record<string, string[]> };
                      const reactions = metadata.reactions ?? {};
                      const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '✅', '❗'];

                      const prev = messages[idx - 1];
                      const GROUP_MS = 2 * 60 * 1000;
                      const isGrouped = !!prev
                        && prev.sender_id === message.sender_id
                        && prev.role === message.role
                        && new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_MS;

                      return (
                        <div key={message.id} className={`flex gap-2.5 ${mine ? 'justify-end' : 'justify-start'} ${isGrouped ? 'mt-1' : 'mt-3'}`}>
                          {!mine && (
                            isGrouped
                              ? <div className="w-8 h-8 shrink-0" />
                              : <Avatar
                                  label={sender.label}
                                  image={sender.avatar}
                                  kind={sender.kind}
                                  className="w-8 h-8 shrink-0 mt-0.5"
                                />
                          )}
                          <div className={`max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col group/msg`}>
                            {!isGrouped && <div className={`flex items-center gap-2 mb-0.5 ${mine ? 'justify-end' : 'justify-start'} w-full`}>
                              <span className="text-[11px] text-heading font-semibold">{sender.label}</span>
                              <span className="text-[10px] text-muted font-mono">{new Date(message.created_at).toLocaleString()}</span>
                              {metadata.provider && <span className="text-[10px] text-accent2 font-mono">{metadata.provider}</span>}
                            </div>}
                            <div className="relative">
                              <div
                                className={`rounded-2xl border px-3.5 py-2.5 shadow-sm ${
                                  mine
                                    ? 'bg-accent/12 border-accent/25 text-heading'
                                    : message.role === 'assistant'
                                      ? 'bg-surface2 border-accent2/25 text-heading'
                                      : message.role === 'system'
                                        ? 'bg-surface2/70 border-border text-muted'
                                        : 'bg-surface2 border-border text-heading'
                                }`}
                              >
                                {message.role === 'assistant' ? (
                                  <MarkdownWithFileLinks block filePaths={chatFilePaths} onFileClick={handleChatFileClick} onRepoClick={handleRepoClick} githubRepo={relatedGithubRepos} gitlabRepos={gitlabRepos} className="text-sm leading-snug break-words cp-prose">
                                    {message.content}
                                  </MarkdownWithFileLinks>
                                ) : (
                                  <div className="text-sm leading-snug whitespace-pre-wrap break-words">
                                    {message.content.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                                      /^https?:\/\//.test(part)
                                        ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:opacity-80 break-all">{part}</a>
                                        : part
                                    )}
                                  </div>
                                )}
                              </div>
                              {/* Reaction picker — shown on hover */}
                              {message.role === 'user' && (
                                <div className={`absolute ${mine ? 'right-0' : 'left-0'} -bottom-7 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10`}>
                                  <div className="flex gap-0.5 bg-surface border border-border rounded-full px-1.5 py-1 shadow-md">
                                    {REACTION_EMOJIS.map((emoji) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => toggleReaction(message.id, emoji)}
                                        className="text-sm leading-none hover:scale-125 transition-transform px-0.5"
                                        title={emoji}
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Reaction counts */}
                            {Object.keys(reactions).length > 0 && (
                              <div className={`flex flex-wrap gap-1 mt-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                                {Object.entries(reactions).map(([emoji, userIds]) =>
                                  userIds.length > 0 && (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => toggleReaction(message.id, emoji)}
                                      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${
                                        user && userIds.includes(user.id)
                                          ? 'bg-accent/15 border-accent/30 text-accent'
                                          : 'bg-surface2 border-border text-muted hover:border-accent/30'
                                      }`}
                                    >
                                      <span>{emoji}</span>
                                      <span className="font-mono text-[10px]">{userIds.length}</span>
                                    </button>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {/* Live streaming bubble */}
                    {streamingMsg && (
                      <div className="flex gap-2.5 justify-start">
                        <Avatar label="AI" kind="project" className="w-8 h-8 shrink-0 mt-0.5" />
                        <div className="max-w-[72%] flex flex-col items-start">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[11px] text-heading font-semibold">AI</span>
                            {streamingMsg.status && !streamingMsg.content && (
                              <span className="text-[10px] text-muted font-mono animate-pulse">{streamingMsg.status}</span>
                            )}
                          </div>
                          <div className="rounded-2xl border border-accent2/25 bg-surface2 px-3.5 py-2.5 shadow-sm text-heading">
                            {streamingMsg.content ? (
                              <div className="text-sm leading-snug break-words cp-prose">
                                <MarkdownWithFileLinks block filePaths={chatFilePaths} onFileClick={handleChatFileClick} onRepoClick={handleRepoClick} githubRepo={relatedGithubRepos} gitlabRepos={gitlabRepos}>
                                  {streamingMsg.content}
                                </MarkdownWithFileLinks>
                                <span className="inline-block w-0.5 h-[1em] bg-accent2 opacity-75 animate-pulse align-middle ml-0.5" />
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="cp-dot cp-dot--1" />
                                <span className="cp-dot cp-dot--2" />
                                <span className="cp-dot cp-dot--3" />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>
              <div className="mt-auto shrink-0 border-t border-border bg-surface px-5 py-3">
                <div className="app-chat-thread-width max-w-4xl mx-auto space-y-2">
                  {contexts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {contexts.map((ctx) => (
                        <span key={ctx.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-surface2 text-[11px] font-mono text-heading">
                          {ctx.type === 'image' ? <ImageIcon size={12} className="text-accent2" /> : <Paperclip size={12} className="text-accent" />}
                          {ctx.name}
                          <button type="button" title={`Remove ${ctx.name}`} onClick={() => removeContext(ctx.id)} className="text-muted hover:text-danger">
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Slash command palette — floats above the input card */}
                  {slashOpen && (() => {
                    const curVal = textareaRef.current?.value ?? '';
                    const filtered = SLASH_COMMANDS.filter((cmd) =>
                      curVal.trim() === '/' || cmd.command.startsWith(curVal.trim())
                    );
                    if (filtered.length === 0) return null;
                    const hi = Math.min(slashHighlight, filtered.length - 1);
                    return (
                      <div className="rounded-2xl border border-border bg-surface shadow-xl overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-surface2 flex items-center gap-2">
                          <span className="text-[10px] tracking-[0.18em] uppercase text-accent font-semibold font-mono">/</span>
                          <span className="text-[10px] tracking-[0.15em] uppercase text-muted font-semibold">Slash Commands</span>
                          <span className="ml-auto text-[10px] text-muted/60 font-mono">↑↓ navigate · Tab/Enter select</span>
                        </div>
                        {filtered.map((cmd, idx) => (
                          <button
                            key={cmd.command}
                            type="button"
                            onClick={() => {
                              const needsArgs = cmd.command === '/ai' || cmd.command === '/note';
                              const selectedCmd = needsArgs ? cmd.command + ' ' : cmd.command;
                              if (textareaRef.current) { textareaRef.current.value = selectedCmd; setHasInput(true); }
                              setSlashOpen(false);
                              setSlashHighlight(0);
                              if (!needsArgs) void handleSend(cmd.command);
                            }}
                            className={`w-full flex items-center gap-4 px-4 py-2.5 text-left transition-colors ${idx === hi ? 'bg-surface2' : 'hover:bg-surface2'}`}
                          >
                            {idx === hi && <span className="w-1 h-4 rounded-full bg-accent shrink-0 -ml-1" />}
                            <span className="text-[11px] font-mono font-semibold text-accent w-36 shrink-0">{cmd.usage}</span>
                            <span className="text-[11px] text-muted">{cmd.description}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="rounded-2xl border border-border bg-surface2 p-2">

                    <div className="flex items-end gap-2">
                      <div className="relative shrink-0 pb-0.5" ref={contextRef}>
                        <button
                          type="button"
                          onClick={() => { setContextOpen((o) => !o); setContextView('main'); setSlashOpen(false); }}
                          className="w-8 h-8 rounded-lg border border-border text-muted hover:text-heading hover:bg-surface transition-colors flex items-center justify-center"
                          title="Add context"
                        >
                          <Plus size={13} />
                        </button>
                        {contextOpen && <ContextMenu />}
                      </div>

                      <textarea
                        ref={textareaRef}
                        onChange={(e) => {
                          const val = e.target.value;
                          const nowHasInput = val.trim().length > 0;
                          if (nowHasInput !== hasInput) setHasInput(nowHasInput);
                          setSlashOpen(val.startsWith('/'));
                          setSlashHighlight(0);
                          if (!val.startsWith('/')) setContextOpen(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setSlashOpen(false); setSlashHighlight(0); return; }

                          // Slash palette navigation
                          if (slashOpen) {
                            const curVal = textareaRef.current?.value ?? '';
                            const filtered = SLASH_COMMANDS.filter((cmd) =>
                              curVal.trim() === '/' || cmd.command.startsWith(curVal.trim())
                            );
                            if (filtered.length > 0) {
                              if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                                e.preventDefault();
                                setSlashHighlight((h) => (h + 1) % filtered.length);
                                return;
                              }
                              if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                                e.preventDefault();
                                setSlashHighlight((h) => (h - 1 + filtered.length) % filtered.length);
                                return;
                              }
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                const cmd = filtered[Math.min(slashHighlight, filtered.length - 1)];
                                const needsArgs = cmd.command === '/ai' || cmd.command === '/note';
                                const selectedCmd = needsArgs ? cmd.command + ' ' : cmd.command;
                                if (textareaRef.current) { textareaRef.current.value = selectedCmd; setHasInput(true); }
                                setSlashOpen(false);
                                setSlashHighlight(0);
                                if (!needsArgs) void handleSend(cmd.command);
                                return;
                              }
                            }
                          }

                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            setSlashOpen(false);
                            setSlashHighlight(0);
                            void handleSend();
                          }
                        }}
                        rows={2}
                        placeholder={selectedThread?.ai_mode
                          ? 'AI mode on — every message gets a response. Type /ai off to stop.'
                          : 'Message… or type / for slash commands'}
                        className="flex-1 min-h-[56px] px-3 py-2 rounded-xl border border-border bg-surface text-sm text-heading placeholder:text-muted/60 resize-none focus:outline-none focus:border-accent/40"
                      />

                      <button
                        type="button"
                        onClick={() => { setSlashOpen(false); void handleSend(); }}
                        disabled={!hasInput || sending}
                        className="w-8 h-8 rounded-lg border border-accent/30 text-accent hover:bg-accent/5 transition-colors flex items-center justify-center disabled:opacity-40"
                        title="Send"
                      >
                        <Send size={15} />
                      </button>
                    </div>

                    {(selectedThread?.ai_mode || streamingMsg || aiQueueLength > 0) && (
                      <div className="mt-1.5 flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          {selectedThread?.ai_mode && (
                            <span className="text-[10px] text-accent2 font-mono">AI mode active</span>
                          )}
                          {streamingMsg && (
                            <span className="text-[10px] text-accent2 font-mono animate-pulse">responding…</span>
                          )}
                          {aiQueueLength > 0 && !streamingMsg && (
                            <span className="text-[10px] text-muted font-mono">{aiQueueLength} queued</span>
                          )}
                          {aiQueueLength > 0 && streamingMsg && (
                            <span className="text-[10px] text-muted font-mono">+{aiQueueLength} queued</span>
                          )}
                        </div>
                        {selectedThread?.ai_mode && (
                          <button
                            type="button"
                            onClick={() => { if (textareaRef.current) { textareaRef.current.value = '/ai off'; setHasInput(true); } void handleSend(); }}
                            className="text-[10px] text-muted hover:text-heading transition-colors"
                          >
                            /ai off
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-center">
              <div>
                <Bot size={30} className="text-muted/40 mx-auto mb-4" />
                <p className="text-base text-muted">Select a chat to begin.</p>
              </div>
            </div>
          )}
        </section>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        title="Attach a file"
        className="hidden"
        multiple={false}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.currentTarget.value = '';
        }}
      />

      {/* Repo browser modal */}
      {repoPreview && (() => {
        const repoFiles = Array.from(chatFilePaths.values())
          .filter((ref) => ref.repo === repoPreview.repo && ref.type === repoPreview.type)
          .reduce((acc, ref) => {
            if (!acc.find((r) => r.path === ref.path)) acc.push(ref);
            return acc;
          }, [] as FileRef[])
          .sort((a, b) => a.path.localeCompare(b.path));
        return (
          <div className="fixed inset-0 z-50 bg-heading/40 flex items-center justify-center p-6" onClick={() => setRepoPreview(null)}>
            <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {repoPreview.type === 'github' ? <Github size={14} className="text-muted shrink-0" /> : <GitBranch size={14} className="text-muted shrink-0" />}
                  <span className="font-mono text-sm text-[var(--color-code-repo)] font-semibold truncate">{repoPreview.repo}</span>
                </div>
                <button type="button" title="Close" onClick={() => setRepoPreview(null)} className="text-muted hover:text-heading transition-colors ml-4 shrink-0">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-auto py-2">
                {repoFiles.length === 0 ? (
                  <p className="text-sm text-muted px-5 py-3">No files indexed yet — file paths will appear after the repo is fetched.</p>
                ) : repoFiles.map((ref) => (
                  <button
                    key={ref.path}
                    type="button"
                    onClick={() => { setRepoPreview(null); void handleChatFileClick(ref); }}
                    className="w-full flex items-center gap-2 px-5 py-1.5 text-left hover:bg-surface2 transition-colors group"
                  >
                    <File size={11} className="text-muted shrink-0" />
                    <span className="font-mono text-xs text-[var(--color-code-file)] group-hover:underline truncate">{ref.path}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* File preview modal */}
      {filePreview && (
        <div
          className="fixed inset-0 z-50 bg-heading/40 flex items-center justify-center p-6"
          onClick={() => setFilePreview(null)}
        >
          <div
            className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <File size={13} className="text-[var(--color-code-file)] shrink-0" />
                <span className="font-mono text-sm text-[var(--color-code-file)] truncate">{filePreview.ref.path}</span>
                <span className="text-[10px] text-muted font-mono shrink-0">{filePreview.ref.repo}</span>
              </div>
              <button type="button" title="Close" onClick={() => setFilePreview(null)} className="text-muted hover:text-heading transition-colors ml-4 shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {filePreview.loading ? (
                <p className="text-sm text-muted px-5 py-4">Loading…</p>
              ) : (
                <LazySyntaxCodeBlock
                  language={getLang(filePreview.ref.path)}
                  useInlineStyles={true}
                  style={odysseyCodeTheme}
                  showLineNumbers
                  lineNumberStyle={{ color: '#8a9bb0', fontSize: '11px', minWidth: '2.5em', paddingRight: '1em', userSelect: 'none' }}
                  customStyle={{ margin: 0, background: 'transparent', fontSize: '12px', lineHeight: '1.6', padding: '16px 20px' }}
                  wrapLongLines={false}
                >
                  {filePreview.content ?? ''}
                </LazySyntaxCodeBlock>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
