import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { supabase, supabaseRealtimeEnabled } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { ChatMessageRow, ChatThread } from '../types';

export const CHAT_THREAD_READ_EVENT = 'odyssey:chat-thread-read';

export interface ChatParticipant {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface ChatThreadPreview {
  id: string;
  thread_id: string;
  sender_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface ChatThreadState {
  thread_id: string;
  last_read_at: string | null;
  hidden_at: string | null;
  unread_count: number;
}

interface ChatThreadSummaryRow {
  thread: ChatThread;
  participants: ChatParticipant[];
  last_message: ChatThreadPreview | null;
  last_read_at: string | null;
  hidden_at: string | null;
  unread_count: number | string;
}

type FetchThreadOptions = {
  force?: boolean;
  syncMemberships?: boolean;
};

const CHAT_THREAD_POLL_INTERVAL_MS = 30_000;
const CHAT_THREAD_MAX_RETRY_MS = 5 * 60_000;

function getSupabaseErrorText(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase();
  }
  return String(error).toLowerCase();
}

function isMissingChatRpc(error: unknown, functionName: string): boolean {
  const message = getSupabaseErrorText(error);
  return message.includes(`public.${functionName}`)
    && (message.includes('could not find') || message.includes('schema cache') || message.includes('pgrst202'));
}

function isTransientSupabaseError(error: unknown): boolean {
  const message = getSupabaseErrorText(error);
  return (
    message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed')
    || message.includes('aborted')
    || message.includes('502')
    || message.includes('503')
    || message.includes('504')
    || message.includes('bad gateway')
    || message.includes('gateway time')
    || message.includes('service unavailable')
    || message.includes('<html')
    || message.includes('<!doctype')
  );
}

async function loadLegacyChatThreadSummaries(userId: string): Promise<ChatThreadSummaryRow[]> {
  const membershipResult = await supabase
    .from('chat_thread_members')
    .select('thread_id')
    .eq('user_id', userId);
  if (membershipResult.error) throw membershipResult.error;

  const ids = (membershipResult.data ?? []).map((membership) => membership.thread_id);
  if (ids.length === 0) return [];

  const [threadsResult, membersResult, messagesResult, statesResult] = await Promise.all([
    supabase.from('chat_threads').select('*').in('id', ids).order('updated_at', { ascending: false }),
    supabase.from('chat_thread_members').select('thread_id, user_id').in('thread_id', ids),
    supabase
      .from('chat_messages')
      .select('id, thread_id, sender_id, role, content, created_at')
      .in('thread_id', ids)
      .order('created_at', { ascending: false }),
    supabase
      .from('chat_thread_user_state')
      .select('thread_id, last_read_at, hidden_at')
      .eq('user_id', userId)
      .in('thread_id', ids),
  ]);

  const firstError = threadsResult.error || membersResult.error || messagesResult.error || statesResult.error;
  if (firstError) throw firstError;

  const memberIds = [...new Set((membersResult.data ?? []).map((row) => row.user_id))];
  const profileResult = memberIds.length
    ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', memberIds)
    : { data: [] as ChatParticipant[], error: null };
  if (profileResult.error) throw profileResult.error;

  const profiles = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile]));
  const states = new Map((statesResult.data ?? []).map((state) => [state.thread_id, state]));
  const membersByThread = (membersResult.data ?? []).reduce<Record<string, ChatParticipant[]>>((acc, member) => {
    const profile = profiles.get(member.user_id);
    (acc[member.thread_id] ??= []).push({
      id: member.user_id,
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
    });
    return acc;
  }, {});
  const latestByThread = (messagesResult.data ?? []).reduce<Record<string, ChatThreadPreview>>((acc, message) => {
    if (!acc[message.thread_id]) acc[message.thread_id] = message as ChatThreadPreview;
    return acc;
  }, {});
  const unreadByThread = (messagesResult.data ?? []).reduce<Record<string, number>>((acc, message) => {
    const lastReadAt = states.get(message.thread_id)?.last_read_at;
    if (message.sender_id !== userId && (!lastReadAt || message.created_at > lastReadAt)) {
      acc[message.thread_id] = (acc[message.thread_id] ?? 0) + 1;
    }
    return acc;
  }, {});

  return ((threadsResult.data ?? []) as ChatThread[]).map((thread) => ({
    thread,
    participants: membersByThread[thread.id] ?? [],
    last_message: latestByThread[thread.id] ?? null,
    last_read_at: states.get(thread.id)?.last_read_at ?? null,
    hidden_at: states.get(thread.id)?.hidden_at ?? null,
    unread_count: unreadByThread[thread.id] ?? 0,
  }));
}

function applyLocalThreadRead(
  threadId: string,
  readAt: string,
  setThreadStateByThread: Dispatch<SetStateAction<Record<string, ChatThreadState>>>,
) {
  setThreadStateByThread((prev) => ({
    ...prev,
    [threadId]: {
      ...(prev[threadId] ?? {
        thread_id: threadId,
        last_read_at: null,
        hidden_at: null,
        unread_count: 0,
      }),
      thread_id: threadId,
      last_read_at: readAt,
      hidden_at: null,
      unread_count: 0,
    },
  }));
}

function useChatThreadsState() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadIds, setThreadIds] = useState<string[]>([]);
  const [participantsByThread, setParticipantsByThread] = useState<Record<string, ChatParticipant[]>>({});
  const [lastMessageByThread, setLastMessageByThread] = useState<Record<string, ChatThreadPreview | null>>({});
  const [threadStateByThread, setThreadStateByThread] = useState<Record<string, ChatThreadState>>({});
  const [loading, setLoading] = useState(true);
  const fetchSequenceRef = useRef(0);
  const fetchRequestRef = useRef<symbol | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const failureCountRef = useRef(0);
  const retryAfterRef = useRef(0);

  const fetchThreads = useCallback(async (options: FetchThreadOptions = {}) => {
    if (!user) {
      fetchSequenceRef.current += 1;
      fetchRequestRef.current = null;
      hasLoadedOnceRef.current = false;
      failureCountRef.current = 0;
      retryAfterRef.current = 0;
      setThreads([]);
      setThreadIds([]);
      setParticipantsByThread({});
      setLastMessageByThread({});
      setThreadStateByThread({});
      setLoading(false);
      return;
    }

    if (!options.force && Date.now() < retryAfterRef.current) return;
    if (fetchRequestRef.current) return;

    const requestToken = Symbol('chat-thread-fetch');
    fetchRequestRef.current = requestToken;
    const fetchSequence = ++fetchSequenceRef.current;
    const isInitialLoad = !hasLoadedOnceRef.current;
    if (isInitialLoad) setLoading(true);

    try {
      if (options.syncMemberships) {
        const syncResult = await supabase.rpc('sync_my_project_chat_memberships');
        if (syncResult.error && !isMissingChatRpc(syncResult.error, 'sync_my_project_chat_memberships')) {
          if (isTransientSupabaseError(syncResult.error)) throw syncResult.error;
          console.error('Failed to sync chat memberships:', syncResult.error);
        }
      }

      const summaryResult = await supabase.rpc('get_my_chat_thread_summaries');
      const summaries = summaryResult.error
        ? isMissingChatRpc(summaryResult.error, 'get_my_chat_thread_summaries')
          ? await loadLegacyChatThreadSummaries(user.id)
          : (() => { throw summaryResult.error; })()
        : ((summaryResult.data ?? []) as unknown as ChatThreadSummaryRow[]);

      if (fetchSequence !== fetchSequenceRef.current) return;

      const validSummaries = summaries.filter((summary) => summary?.thread?.id);
      const nextThreadIds = validSummaries.map((summary) => summary.thread.id);
      const nextParticipants = validSummaries.reduce<Record<string, ChatParticipant[]>>((acc, summary) => {
        acc[summary.thread.id] = Array.isArray(summary.participants) ? summary.participants : [];
        return acc;
      }, {});
      const nextPreviews = validSummaries.reduce<Record<string, ChatThreadPreview | null>>((acc, summary) => {
        acc[summary.thread.id] = summary.last_message ?? null;
        return acc;
      }, {});
      const nextThreadState = validSummaries.reduce<Record<string, ChatThreadState>>((acc, summary) => {
        acc[summary.thread.id] = {
          thread_id: summary.thread.id,
          last_read_at: summary.last_read_at ?? null,
          hidden_at: summary.hidden_at ?? null,
          unread_count: Math.max(0, Number(summary.unread_count) || 0),
        };
        return acc;
      }, {});
      const nextThreads = validSummaries
        .map((summary) => summary.thread)
        .filter((thread) => !(thread.kind === 'direct' && nextThreadState[thread.id]?.hidden_at));

      setThreadIds(nextThreadIds);
      setParticipantsByThread(nextParticipants);
      setLastMessageByThread(nextPreviews);
      setThreadStateByThread(nextThreadState);
      setThreads(nextThreads);
      hasLoadedOnceRef.current = true;
      failureCountRef.current = 0;
      retryAfterRef.current = 0;
      setLoading(false);
    } catch (error) {
      if (fetchSequence !== fetchSequenceRef.current) return;

      failureCountRef.current += 1;
      const retryDelay = Math.min(
        CHAT_THREAD_POLL_INTERVAL_MS * (2 ** Math.min(failureCountRef.current - 1, 4)),
        CHAT_THREAD_MAX_RETRY_MS,
      );
      retryAfterRef.current = Date.now() + retryDelay;
      setLoading(false);

      if (!isTransientSupabaseError(error)) {
        console.error('Failed to refresh chat threads:', error);
      }
    } finally {
      if (fetchRequestRef.current === requestToken) {
        fetchRequestRef.current = null;
      }
    }
  }, [user]);

  useEffect(() => {
    fetchSequenceRef.current += 1;
    fetchRequestRef.current = null;
    hasLoadedOnceRef.current = false;
    failureCountRef.current = 0;
    retryAfterRef.current = 0;
    void fetchThreads({ force: true, syncMemberships: Boolean(user) });

    return () => {
      fetchSequenceRef.current += 1;
      fetchRequestRef.current = null;
    };
  }, [user, fetchThreads]);

  useEffect(() => {
    if (!user) return;

    const handleFocus = () => {
      void fetchThreads({ force: true });
    };
    const handleProjectsChanged = () => {
      void fetchThreads({ force: true, syncMemberships: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchThreads({ force: true });
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('odyssey:projects-changed', handleProjectsChanged);
    document.addEventListener('visibilitychange', handleVisibility);

    const interval = supabaseRealtimeEnabled
      ? null
      : window.setInterval(() => {
          if (document.visibilityState === 'visible') {
            void fetchThreads();
          }
        }, CHAT_THREAD_POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('odyssey:projects-changed', handleProjectsChanged);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [user, fetchThreads]);

  useEffect(() => {
    if (!user || !supabaseRealtimeEnabled) return;
    const channel = supabase
      .channel(`chat-threads:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, () => { void fetchThreads({ force: true }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_members', filter: `user_id=eq.${user.id}` }, () => { void fetchThreads({ force: true }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_user_state', filter: `user_id=eq.${user.id}` }, () => { void fetchThreads({ force: true }); })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchThreads]);

  // Keep lastMessageByThread up-to-date as new messages arrive
  useEffect(() => {
    if (!user || threadIds.length === 0 || !supabaseRealtimeEnabled) return;
    const channel = supabase
      .channel(`chat-previews:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const row = payload.new as ChatThreadPreview;
        if (!threadIds.includes(row.thread_id)) return;
        setThreads((prev) => {
          const match = prev.find((thread) => thread.id === row.thread_id);
          if (!match) return prev;
          const next = [{ ...match, updated_at: row.created_at }, ...prev.filter((thread) => thread.id !== row.thread_id)];
          return next;
        });
        setLastMessageByThread((prev) => {
          const existing = prev[row.thread_id];
          if (!existing || row.created_at > existing.created_at) {
            return { ...prev, [row.thread_id]: row };
          }
          return prev;
        });
        setThreadStateByThread((prev) => {
          const existing = prev[row.thread_id];
          if (!existing) return prev;
          const hiddenReset = existing.hidden_at ? { hidden_at: null } : {};
          const unreadIncrement = row.sender_id && row.sender_id !== user.id ? 1 : 0;
          return {
            ...prev,
            [row.thread_id]: {
              ...existing,
              ...hiddenReset,
              unread_count: (existing.unread_count ?? 0) + unreadIncrement,
            },
          };
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, threadIds]);

  useEffect(() => {
    const handleThreadRead = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; readAt?: string }>).detail;
      const threadId = detail?.threadId;
      if (!threadId) return;
      const readAt = detail.readAt ?? new Date().toISOString();
      setThreadStateByThread((prev) => {
        const existing = prev[threadId];
        if (!existing) return prev;
        return {
          ...prev,
          [threadId]: {
            ...existing,
            last_read_at: readAt,
            hidden_at: null,
            unread_count: 0,
          },
        };
      });
    };

    window.addEventListener(CHAT_THREAD_READ_EVENT, handleThreadRead as EventListener);
    return () => window.removeEventListener(CHAT_THREAD_READ_EVENT, handleThreadRead as EventListener);
  }, []);

  const createDirectThread = async (otherUserId: string, relatedProjectId?: string | null) => {
    const { data, error } = await supabase.rpc('create_direct_chat_thread', {
      p_other_user_id: otherUserId,
      p_related_project_id: relatedProjectId ?? null,
    });
    if (error) throw error;
    await fetchThreads({ force: true });
    return data as string;
  };

  const updateThread = async (threadId: string, updates: Partial<Pick<ChatThread, 'ai_mode' | 'ai_mode_by' | 'ai_mode_started_at' | 'title'>>) => {
    const { error } = await supabase.from('chat_threads').update(updates).eq('id', threadId);
    if (error) throw error;
    setThreads((prev) => prev.map((thread) => (thread.id === threadId ? { ...thread, ...updates } : thread)));
  };

  const markThreadRead = async (threadId: string) => {
    if (!user) return;
    const now = new Date().toISOString();
    applyLocalThreadRead(threadId, now, setThreadStateByThread);
    window.dispatchEvent(new CustomEvent(CHAT_THREAD_READ_EVENT, {
      detail: {
        threadId,
        readAt: now,
      },
    }));
    const { data, error } = await supabase.rpc('mark_chat_thread_read', { p_thread_id: threadId });
    if (error) {
      void fetchThreads({ force: true });
      throw error;
    }
    if ((data as { error?: string } | null)?.error) {
      void fetchThreads({ force: true });
      throw new Error((data as { error: string }).error);
    }
  };

  const hideDirectThread = async (threadId: string) => {
    const { data, error } = await supabase.rpc('hide_direct_chat_thread', { p_thread_id: threadId });
    if (error) throw error;
    if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId));
    setThreadStateByThread((prev) => ({
      ...prev,
      [threadId]: {
        ...(prev[threadId] ?? { thread_id: threadId, last_read_at: null, unread_count: 0 }),
        hidden_at: new Date().toISOString(),
      },
    }));
  };

  return {
    threads,
    participantsByThread,
    lastMessageByThread,
    threadStateByThread,
    loading,
    createDirectThread,
    updateThread,
    markThreadRead,
    hideDirectThread,
    refetch: fetchThreads,
  };
}

const ChatThreadsContext = createContext<ReturnType<typeof useChatThreadsState> | null>(null);

export function ChatThreadsProvider({ children }: { children: ReactNode }) {
  const value = useChatThreadsState();
  return createElement(ChatThreadsContext.Provider, { value }, children);
}

export function useChatThreads() {
  const context = useContext(ChatThreadsContext);
  if (!context) {
    throw new Error('useChatThreads must be used within ChatThreadsProvider');
  }
  return context;
}

export function useChatMessages(threadId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    if (!user || !threadId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(500);
    setMessages((data ?? []) as ChatMessageRow[]);
    setLoading(false);
  }, [user, threadId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (!threadId || !supabaseRealtimeEnabled) return;
    const channel = supabase
      .channel(`chat-messages:${threadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const next = payload.new as ChatMessageRow;
          setMessages((prev) => (prev.some((msg) => msg.id === next.id) ? prev : [...prev, next]));
          return;
        }
        if (payload.eventType === 'UPDATE') {
          const next = payload.new as ChatMessageRow;
          setMessages((prev) => prev.map((msg) => (msg.id === next.id ? next : msg)));
          return;
        }
        if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as ChatMessageRow;
          setMessages((prev) => prev.filter((msg) => msg.id !== oldRow.id));
          return;
        }
        void fetchMessages();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, fetchMessages]);

  const last24hMessages = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return messages.filter((msg) => new Date(msg.created_at).getTime() >= cutoff);
  }, [messages]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;
    const reactions = ((message.metadata ?? {}) as { reactions?: Record<string, string[]> }).reactions ?? {};
    const current = reactions[emoji] ?? [];
    const next = current.includes(user.id)
      ? current.filter((id) => id !== user.id)
      : [...current, user.id];
    const nextReactions = { ...reactions, [emoji]: next };
    if (nextReactions[emoji].length === 0) delete nextReactions[emoji];
    const nextMetadata = { ...(message.metadata ?? {}), reactions: nextReactions };
    const { error } = await supabase
      .from('chat_messages')
      .update({ metadata: nextMetadata })
      .eq('id', messageId);
    if (error) throw error;
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, metadata: nextMetadata } : m));
  };

  const sendMessage = async (payload: Omit<ChatMessageRow, 'id' | 'created_at'>) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    setMessages((prev) => (prev.some((msg) => msg.id === data.id) ? prev : [...prev, data as ChatMessageRow]));
    return data as ChatMessageRow;
  };

  return { messages, loading, sendMessage, toggleReaction, last24hMessages, refetch: fetchMessages };
}
