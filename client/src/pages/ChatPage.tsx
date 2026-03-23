import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  FolderKanban,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { useChatMessages, useChatThreads, type ChatParticipant } from '../hooks/useChatThreads';
import type { FileRef } from '../hooks/useProjectFilePaths';
import { useAuth } from '../lib/auth';
import { useAIAgent } from '../lib/ai-agent';
import { useProfile } from '../hooks/useProfile';
import { supabase } from '../lib/supabase';
import MarkdownWithFileLinks from '../components/MarkdownWithFileLinks';

type PendingContext =
  | { id: string; type: 'text-file' | 'document'; name: string; textContent: string }
  | { id: string; type: 'image'; name: string; base64: string; mimeType: string; previewUrl?: string }
  | { id: string; type: 'repo'; name: string; repo: string; repoType: 'github' | 'gitlab' }
  | { id: string; type: 'copied-text'; name: string; textContent: string };

const AI_EXIT_WORDS = new Set(['quit', 'exit', 'stop', 'end']);

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
    loading: threadsLoading,
    createDirectThread,
    updateThread,
  } = useChatThreads();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [creatingDm, setCreatingDm] = useState(false);
  const [dmCandidates, setDmCandidates] = useState<Array<{ id: string; display_name: string | null; avatar_url: string | null; project_id: string | null }>>([]);
  const [contextText, setContextText] = useState('');
  const [contexts, setContexts] = useState<PendingContext[]>([]);
  const [gitlabRepos, setGitlabRepos] = useState<string[]>([]);
  const [projectDocs, setProjectDocs] = useState<Array<{ id: string; name: string; text: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const { messages, loading: messagesLoading, sendMessage, last24hMessages } = useChatMessages(selectedThreadId);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, selectedThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedThreadId]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', user.id);
      const projectIds = (memberships ?? []).map((row) => row.project_id);
      if (projectIds.length === 0) {
        setDmCandidates([]);
        return;
      }

      const { data: memberRows } = await supabase
        .from('project_members')
        .select('project_id, user_id')
        .in('project_id', projectIds)
        .neq('user_id', user.id);
      const uniqueUsers = [...new Map((memberRows ?? []).map((row) => [`${row.user_id}:${row.project_id}`, row])).values()];
      const { data: profiles } = uniqueUsers.length
        ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', uniqueUsers.map((row) => row.user_id))
        : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
      const profileMap = new Map((profiles ?? []).map((item) => [item.id, item]));
      setDmCandidates(uniqueUsers.map((row) => ({
        id: row.user_id,
        display_name: profileMap.get(row.user_id)?.display_name ?? null,
        avatar_url: profileMap.get(row.user_id)?.avatar_url ?? null,
        project_id: row.project_id,
      })));
    })();
  }, [user]);

  useEffect(() => {
    const relatedProjectId = selectedThread?.project_id ?? selectedThread?.related_project_id ?? null;
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
      const cfg = gitlabRes.data?.config as { repos?: string[]; repo?: string } | null;
      setGitlabRepos(cfg?.repos ?? (cfg?.repo ? [cfg.repo] : []));
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
  const emptyFilePaths = useMemo(() => new Map<string, FileRef>(), []);

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

  const relatedProject = selectedThread
    ? projectMap.get(selectedThread.project_id ?? selectedThread.related_project_id ?? '')
    : null;

  const addCopiedTextContext = () => {
    const trimmed = contextText.trim();
    if (!trimmed) return;
    setContexts((prev) => [...prev, { id: makeId(), type: 'copied-text', name: 'Copied text', textContent: trimmed }]);
    setContextText('');
  };

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

  const invokeAI = async (prompt: string) => {
    if (!selectedThread) return;
    const projectId = selectedThread.project_id ?? selectedThread.related_project_id;
    if (!projectId) {
      await sendMessage({ thread_id: selectedThread.id, sender_id: null, role: 'system', content: 'AI is only available in chats linked to a project context.', metadata: {} });
      return;
    }

    const convo = [...last24hMessages, {
      id: 'pending',
      thread_id: selectedThread.id,
      sender_id: user?.id ?? null,
      role: 'user' as const,
      content: prompt,
      metadata: null,
      created_at: new Date().toISOString(),
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

    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, projectId, messages: convo, attachments: wireAttachments.length ? wireAttachments : undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `AI request failed (${res.status})`);

    await sendMessage({
      thread_id: selectedThread.id,
      sender_id: null,
      role: 'assistant',
      content: data.message,
      metadata: { provider: data.provider, ai_requested_by: user?.id ?? null },
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!selectedThread || !text || sending) return;
    setSending(true);
    try {
      if (text.startsWith(',/ai')) {
        await updateThread(selectedThread.id, { ai_mode: true, ai_mode_by: user?.id ?? null, ai_mode_started_at: new Date().toISOString() });
        await sendMessage({
          thread_id: selectedThread.id,
          sender_id: null,
          role: 'system',
          content: `${profile?.display_name ?? user?.email ?? 'A user'} enabled AI mode for this chat.`,
          metadata: { command: ',/ai' },
        });
        const trailingPrompt = text.replace(',/ai', '').trim();
        setInput('');
        if (trailingPrompt) {
          await sendMessage({
            thread_id: selectedThread.id,
            sender_id: user?.id ?? null,
            role: 'user',
            content: trailingPrompt,
            metadata: { ai_request: true, mode: 'persistent', contexts: lightweightContexts },
          });
          await invokeAI(trailingPrompt);
        }
        setContexts([]);
        return;
      }

      if (selectedThread.ai_mode && AI_EXIT_WORDS.has(text.toLowerCase())) {
        await updateThread(selectedThread.id, { ai_mode: false, ai_mode_by: null, ai_mode_started_at: null });
        await sendMessage({
          thread_id: selectedThread.id,
          sender_id: null,
          role: 'system',
          content: `${profile?.display_name ?? user?.email ?? 'A user'} ended AI mode for this chat.`,
          metadata: { command: 'exit-ai' },
        });
        setInput('');
        setContexts([]);
        return;
      }

      const oneShotAI = text.startsWith('./ai');
      const prompt = oneShotAI ? text.replace('./ai', '').trim() : text;

      await sendMessage({
        thread_id: selectedThread.id,
        sender_id: user?.id ?? null,
        role: 'user',
        content: prompt,
        metadata: { contexts: lightweightContexts, ai_request: oneShotAI || selectedThread.ai_mode },
      });

      setInput('');
      if (oneShotAI || selectedThread.ai_mode) await invokeAI(prompt);
      setContexts([]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full min-h-0 bg-surface">
      <div className="h-full min-h-0 grid grid-cols-[340px_minmax(0,1fr)]">
        <aside className="border-r border-border bg-surface2/40 flex flex-col min-h-0">
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
                New DM
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
                <p className="text-[11px] text-muted mt-1">Only users who currently share a project with you can be selected.</p>
              </div>
              <div className="max-h-56 overflow-y-auto p-2">
                {dmCandidates.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted">No eligible users yet.</p>
                ) : dmCandidates.map((candidate) => (
                  <button
                    key={`${candidate.id}-${candidate.project_id ?? 'none'}`}
                    type="button"
                    onClick={async () => {
                      const threadId = await createDirectThread(candidate.id, candidate.project_id);
                      setSelectedThreadId(threadId);
                      setCreatingDm(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface2 transition-colors text-left"
                  >
                    <Avatar label={candidate.display_name ?? candidate.id} image={candidate.avatar_url} kind="direct" className="w-9 h-9" />
                    <div className="min-w-0">
                      <p className="text-sm text-heading font-semibold truncate">{candidate.display_name ?? candidate.id}</p>
                      <p className="text-[11px] text-muted truncate">
                        {candidate.project_id ? `Shared project: ${projectMap.get(candidate.project_id)?.name ?? 'Project'}` : 'Eligible for DM'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

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
                          <Avatar label={title} kind="project" className="w-10 h-10 shrink-0" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-heading truncate">{title}</p>
                              {preview?.created_at && <span className="text-[10px] text-muted font-mono shrink-0">{formatTimestamp(preview.created_at)}</span>}
                            </div>
                            <p className="text-[11px] text-muted mt-0.5 truncate">{project?.description || 'Project group conversation'}</p>
                            <p className="text-[11px] text-muted/90 mt-1 line-clamp-2 break-words">{getPreviewText(thread.id)}</p>
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
                      const other = getOtherParticipant(thread.id);
                      const threadProject = projectMap.get(thread.related_project_id ?? '');
                      return (
                        <button
                          key={thread.id}
                          type="button"
                          onClick={() => setSelectedThreadId(thread.id)}
                          className={`w-full flex items-start gap-3 px-3 py-3 rounded-2xl border transition-colors ${
                            selectedThreadId === thread.id ? 'border-accent2/40 bg-accent2/8' : 'border-transparent hover:border-border hover:bg-surface'
                          }`}
                        >
                          <Avatar label={title} image={other?.avatar_url} kind="direct" className="w-10 h-10 shrink-0" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-heading truncate">{title}</p>
                              {preview?.created_at && <span className="text-[10px] text-muted font-mono shrink-0">{formatTimestamp(preview.created_at)}</span>}
                            </div>
                            <p className="text-[11px] text-muted mt-0.5 truncate">{threadProject ? `Linked to ${threadProject.name}` : 'Direct conversation'}</p>
                            <p className="text-[11px] text-muted/90 mt-1 line-clamp-2 break-words">{getPreviewText(thread.id)}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>
        </aside>

        <section className="min-h-0 flex flex-col bg-surface">
          {selectedThread ? (
            <>
              <div className="px-6 py-5 border-b border-border bg-surface">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      label={getThreadTitle(selectedThread.id)}
                      image={selectedThread.kind === 'direct' ? getOtherParticipant(selectedThread.id)?.avatar_url : null}
                      kind={selectedThread.kind}
                      className="w-11 h-11 shrink-0"
                    />
                    <div className="min-w-0">
                      <h2 className="text-xl font-sans font-bold text-heading truncate">{getThreadTitle(selectedThread.id)}</h2>
                      <p className="text-sm text-muted mt-1 truncate">
                        {selectedThread.kind === 'project'
                          ? 'Project chat'
                          : relatedProject
                            ? `Direct message tied to ${relatedProject.name}`
                            : 'Direct message'}
                        {selectedThread.ai_mode ? ' | AI mode on' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-muted font-mono">
                    {lastMessageByThread[selectedThread.id]?.created_at ? `Updated ${formatTimestamp(lastMessageByThread[selectedThread.id]!.created_at)}` : 'Ready'}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 bg-surface">
                {messagesLoading ? (
                  <div className="space-y-5">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 rounded-3xl bg-border/50 animate-pulse" />)}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center">
                    <div>
                      <MessageSquare size={28} className="text-muted/40 mx-auto mb-4" />
                      <p className="text-base text-muted">No messages yet. Start the conversation or use `./ai` for one AI prompt.</p>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-5xl mx-auto space-y-5">
                    {messages.map((message) => {
                      const mine = message.sender_id && message.sender_id === user?.id;
                      const sender =
                        message.role === 'assistant' ? { label: 'AI', avatar: null, kind: 'direct' as const } :
                        message.role === 'system' ? { label: 'System', avatar: null, kind: 'project' as const } :
                        mine ? { label: profile?.display_name ?? 'You', avatar: null, kind: 'direct' as const } :
                        { label: getOtherParticipant(selectedThread.id)?.display_name ?? 'Member', avatar: getOtherParticipant(selectedThread.id)?.avatar_url ?? null, kind: 'direct' as const };
                      const metadata = (message.metadata ?? {}) as { provider?: string };

                      return (
                        <div key={message.id} className={`flex gap-3 ${mine ? 'justify-end' : 'justify-start'}`}>
                          {!mine && (
                            <Avatar
                              label={sender.label}
                              image={sender.avatar}
                              kind={sender.kind}
                              className="w-9 h-9 shrink-0 mt-1"
                            />
                          )}
                          <div className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                            <div className={`flex items-center gap-2 mb-1 ${mine ? 'justify-end' : 'justify-start'} w-full`}>
                              <span className="text-xs text-heading font-semibold">{sender.label}</span>
                              <span className="text-[10px] text-muted font-mono">{new Date(message.created_at).toLocaleString()}</span>
                              {metadata.provider && <span className="text-[10px] text-accent2 font-mono">{metadata.provider}</span>}
                            </div>
                            <div
                              className={`rounded-[1.5rem] border px-5 py-4 shadow-sm ${
                                mine
                                  ? 'bg-accent/12 border-accent/25 text-heading'
                                  : message.role === 'assistant'
                                    ? 'bg-surface2 border-accent2/25 text-heading'
                                    : message.role === 'system'
                                      ? 'bg-surface2/70 border-border text-muted'
                                      : 'bg-surface2 border-border text-heading'
                              }`}
                            >
                              <div className="text-sm leading-7 whitespace-pre-wrap break-words">
                                {message.role === 'assistant' ? (
                                  <MarkdownWithFileLinks filePaths={emptyFilePaths} onFileClick={() => {}} githubRepo={relatedProject?.github_repo ?? null} gitlabRepos={gitlabRepos}>
                                    {message.content}
                                  </MarkdownWithFileLinks>
                                ) : message.content}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>
              <div className="border-t border-border bg-surface px-6 py-4">
                <div className="max-w-5xl mx-auto space-y-3">
                  {relatedProject && (
                    <div className="flex flex-wrap gap-2">
                      {relatedProject.github_repo && (
                        <button
                          type="button"
                          onClick={() => addRepoContext(relatedProject.github_repo!, 'github')}
                          className="px-3 py-1.5 rounded-full border border-border text-[11px] font-mono text-muted hover:text-heading hover:bg-surface2 transition-colors"
                        >
                          + Repo: {relatedProject.github_repo}
                        </button>
                      )}
                      {gitlabRepos.map((repo) => (
                        <button
                          key={repo}
                          type="button"
                          onClick={() => addRepoContext(repo, 'gitlab')}
                          className="px-3 py-1.5 rounded-full border border-border text-[11px] font-mono text-muted hover:text-heading hover:bg-surface2 transition-colors"
                        >
                          + Repo: {repo}
                        </button>
                      ))}
                      {projectDocs.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setContexts((prev) => [...prev, { id: makeId(), type: 'document', name: doc.name, textContent: doc.text.slice(0, 20000) }])}
                          className="px-3 py-1.5 rounded-full border border-border text-[11px] font-mono text-muted hover:text-heading hover:bg-surface2 transition-colors"
                        >
                          + Doc: {doc.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {contexts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {contexts.map((ctx) => (
                        <span key={ctx.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-surface2 text-[11px] font-mono text-heading">
                          {ctx.type === 'image' ? <ImageIcon size={12} className="text-accent2" /> : <Paperclip size={12} className="text-accent" />}
                          {ctx.name}
                          <button type="button" onClick={() => removeContext(ctx.id)} className="text-muted hover:text-danger">
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="rounded-[1.5rem] border border-border bg-surface2 p-3">
                    <div className="flex items-end gap-3">
                      <div className="flex flex-col gap-2 pb-1">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-10 h-10 rounded-xl border border-border text-muted hover:text-heading hover:bg-surface transition-colors flex items-center justify-center"
                          title="Upload file"
                        >
                          <Upload size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={addCopiedTextContext}
                          disabled={!contextText.trim()}
                          className="w-10 h-10 rounded-xl border border-border text-muted hover:text-heading hover:bg-surface transition-colors flex items-center justify-center disabled:opacity-40"
                          title="Add copied text context"
                        >
                          <Link2 size={15} />
                        </button>
                      </div>

                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                        rows={3}
                        placeholder="Type a message. Use `./ai` for one prompt or `,/ai` to keep AI mode on."
                        className="flex-1 min-h-[88px] px-4 py-3 rounded-2xl border border-border bg-surface text-sm text-heading placeholder:text-muted/60 resize-none focus:outline-none focus:border-accent/40"
                      />

                      <button
                        type="button"
                        onClick={() => void handleSend()}
                        disabled={!input.trim() || sending}
                        className="w-11 h-11 mb-1 rounded-xl border border-accent/30 text-accent hover:bg-accent/5 transition-colors flex items-center justify-center disabled:opacity-40"
                        title="Send"
                      >
                        <Send size={15} />
                      </button>
                    </div>

                    <div className="mt-3">
                      <textarea
                        value={contextText}
                        onChange={(e) => setContextText(e.target.value)}
                        rows={2}
                        placeholder="Paste extra context to attach to the next AI request or message."
                        className="w-full px-4 py-3 rounded-2xl border border-border bg-surface text-xs text-heading placeholder:text-muted/60 resize-none focus:outline-none focus:border-accent2/40"
                      />
                    </div>
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
        className="hidden"
        multiple={false}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
