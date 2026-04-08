import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { ChatMessageRow, ChatThread } from '../types';

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

export function useChatThreads() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadIds, setThreadIds] = useState<string[]>([]);
  const [participantsByThread, setParticipantsByThread] = useState<Record<string, ChatParticipant[]>>({});
  const [lastMessageByThread, setLastMessageByThread] = useState<Record<string, ChatThreadPreview | null>>({});
  const [threadStateByThread, setThreadStateByThread] = useState<Record<string, ChatThreadState>>({});
  const [loading, setLoading] = useState(true);

  const fetchThreads = useCallback(async () => {
    if (!user) {
      setThreads([]);
      setThreadIds([]);
      setParticipantsByThread({});
      setLastMessageByThread({});
      setThreadStateByThread({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const syncResult = await supabase.rpc('sync_my_project_chat_memberships');
    if (syncResult.error) {
      const msg = syncResult.error.message.toLowerCase();
      const missing = msg.includes('could not find the function public.sync_my_project_chat_memberships') || msg.includes('schema cache');
      if (!missing) {
        console.error('Failed to sync chat memberships:', syncResult.error);
      }
    }

    const { data: memberships } = await supabase
      .from('chat_thread_members')
      .select('thread_id')
      .eq('user_id', user.id);
    const ids = (memberships ?? []).map((m) => m.thread_id);
    setThreadIds(ids);
    if (ids.length === 0) {
      setThreads([]);
      setParticipantsByThread({});
      setLastMessageByThread({});
      setLoading(false);
      return;
    }
    const threadIds = ids;

    const [{ data: threadsData }, { data: memberRows }, { data: previewRows }, { data: stateRows }] = await Promise.all([
      supabase.from('chat_threads').select('*').in('id', threadIds).order('updated_at', { ascending: false }),
      supabase.from('chat_thread_members').select('thread_id, user_id').in('thread_id', threadIds),
      supabase
        .from('chat_messages')
        .select('id, thread_id, sender_id, role, content, created_at')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('chat_thread_user_state')
        .select('thread_id, last_read_at, hidden_at')
        .eq('user_id', user.id)
        .in('thread_id', threadIds),
    ]);

    const rawThreads = (threadsData ?? []) as ChatThread[];
    const stateMap = new Map(
      (stateRows ?? []).map((row) => [
        row.thread_id,
        {
          thread_id: row.thread_id,
          last_read_at: row.last_read_at,
          hidden_at: row.hidden_at,
          unread_count: 0,
        } satisfies ChatThreadState,
      ]),
    );

    const memberIds = [...new Set((memberRows ?? []).map((row) => row.user_id))];
    const { data: profiles } = memberIds.length
      ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', memberIds)
      : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const nextParticipants = (memberRows ?? []).reduce<Record<string, ChatParticipant[]>>((acc, row) => {
      const profile = profileMap.get(row.user_id);
      if (!acc[row.thread_id]) acc[row.thread_id] = [];
      acc[row.thread_id].push({
        id: row.user_id,
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
      });
      return acc;
    }, {});

    setParticipantsByThread(nextParticipants);
    const nextPreviews = (previewRows ?? []).reduce<Record<string, ChatThreadPreview | null>>((acc, row) => {
      if (!acc[row.thread_id]) {
        acc[row.thread_id] = row as ChatThreadPreview;
      }
      return acc;
    }, {});
    setLastMessageByThread(nextPreviews);
    const unreadCounts = (previewRows ?? []).reduce<Record<string, number>>((acc, row) => {
      if (row.sender_id === user.id) return acc;
      const lastReadAt = stateMap.get(row.thread_id)?.last_read_at;
      if (!lastReadAt || row.created_at > lastReadAt) {
        acc[row.thread_id] = (acc[row.thread_id] ?? 0) + 1;
      }
      return acc;
    }, {});

    const nextThreadState = rawThreads.reduce<Record<string, ChatThreadState>>((acc, thread) => {
      const existing = stateMap.get(thread.id);
      acc[thread.id] = {
        thread_id: thread.id,
        last_read_at: existing?.last_read_at ?? null,
        hidden_at: existing?.hidden_at ?? null,
        unread_count: unreadCounts[thread.id] ?? 0,
      };
      return acc;
    }, {});

    setThreadStateByThread(nextThreadState);
    setThreads(
      rawThreads.filter((thread) => !(thread.kind === 'direct' && nextThreadState[thread.id]?.hidden_at)),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchThreads();
  }, [user, fetchThreads]);

  useEffect(() => {
    if (!user) return;
    const handleRefresh = () => { void fetchThreads(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchThreads();
      }
    };
    window.addEventListener('focus', handleRefresh);
    window.addEventListener('odyssey:projects-changed', handleRefresh);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchThreads();
      }
    }, 10000);
    return () => {
      window.removeEventListener('focus', handleRefresh);
      window.removeEventListener('odyssey:projects-changed', handleRefresh);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, [user, fetchThreads]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat-threads:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, () => fetchThreads())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_members', filter: `user_id=eq.${user.id}` }, () => fetchThreads())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_user_state', filter: `user_id=eq.${user.id}` }, () => fetchThreads())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchThreads]);

  // Keep lastMessageByThread up-to-date as new messages arrive
  useEffect(() => {
    if (!user || threadIds.length === 0) return;
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

  const createDirectThread = async (otherUserId: string, relatedProjectId?: string | null) => {
    const { data, error } = await supabase.rpc('create_direct_chat_thread', {
      p_other_user_id: otherUserId,
      p_related_project_id: relatedProjectId ?? null,
    });
    if (error) throw error;
    await fetchThreads();
    return data as string;
  };

  const updateThread = async (threadId: string, updates: Partial<Pick<ChatThread, 'ai_mode' | 'ai_mode_by' | 'ai_mode_started_at' | 'title'>>) => {
    const { error } = await supabase.from('chat_threads').update(updates).eq('id', threadId);
    if (error) throw error;
    setThreads((prev) => prev.map((thread) => (thread.id === threadId ? { ...thread, ...updates } : thread)));
  };

  const markThreadRead = async (threadId: string) => {
    if (!user) return;
    const { data, error } = await supabase.rpc('mark_chat_thread_read', { p_thread_id: threadId });
    if (error) throw error;
    if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
    const now = new Date().toISOString();
    setThreadStateByThread((prev) => ({
      ...prev,
      [threadId]: {
        thread_id: threadId,
        last_read_at: now,
        hidden_at: null,
        unread_count: 0,
      },
    }));
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
    if (!threadId) return;
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
