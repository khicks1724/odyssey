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

export function useChatThreads() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadIds, setThreadIds] = useState<string[]>([]);
  const [participantsByThread, setParticipantsByThread] = useState<Record<string, ChatParticipant[]>>({});
  const [lastMessageByThread, setLastMessageByThread] = useState<Record<string, ChatThreadPreview | null>>({});
  const [loading, setLoading] = useState(true);

  const fetchThreads = useCallback(async () => {
    if (!user) return;
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

    const [{ data: threadsData }, { data: memberRows }, { data: previewRows }] = await Promise.all([
      supabase.from('chat_threads').select('*').in('id', threadIds).order('updated_at', { ascending: false }),
      supabase.from('chat_thread_members').select('thread_id, user_id').in('thread_id', threadIds),
      supabase
        .from('chat_messages')
        .select('id, thread_id, sender_id, role, content, created_at')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false }),
    ]);

    setThreads((threadsData ?? []) as ChatThread[]);

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
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchThreads();
  }, [user, fetchThreads]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat-threads:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, () => fetchThreads())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_members', filter: `user_id=eq.${user.id}` }, () => fetchThreads())
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
        setLastMessageByThread((prev) => {
          const existing = prev[row.thread_id];
          if (!existing || row.created_at > existing.created_at) {
            return { ...prev, [row.thread_id]: row };
          }
          return prev;
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

  return {
    threads,
    participantsByThread,
    lastMessageByThread,
    loading,
    createDirectThread,
    updateThread,
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` }, () => {
        fetchMessages();
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

  const sendMessage = async (payload: Omit<ChatMessageRow, 'id' | 'created_at'>) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    setMessages((prev) => [...prev, data as ChatMessageRow]);
    return data as ChatMessageRow;
  };

  return { messages, loading, sendMessage, last24hMessages, refetch: fetchMessages };
}
