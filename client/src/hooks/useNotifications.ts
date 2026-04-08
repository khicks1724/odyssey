import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { NotificationItem } from '../types';

type NotificationStoreSnapshot = {
  userId: string | null;
  notifications: NotificationItem[];
  loading: boolean;
};

const notificationStore: NotificationStoreSnapshot = {
  userId: null,
  notifications: [],
  loading: true,
};

const listeners = new Set<(snapshot: NotificationStoreSnapshot) => void>();
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let activeFetchToken = 0;

function emitNotificationStore() {
  const snapshot = {
    userId: notificationStore.userId,
    notifications: notificationStore.notifications,
    loading: notificationStore.loading,
  };
  for (const listener of listeners) listener(snapshot);
}

function setNotificationStore(updates: Partial<NotificationStoreSnapshot>) {
  if (updates.userId !== undefined) notificationStore.userId = updates.userId;
  if (updates.notifications !== undefined) notificationStore.notifications = updates.notifications;
  if (updates.loading !== undefined) notificationStore.loading = updates.loading;
  emitNotificationStore();
}

function subscribeNotifications(listener: (snapshot: NotificationStoreSnapshot) => void) {
  listeners.add(listener);
  listener({ ...notificationStore, notifications: notificationStore.notifications });
  return () => {
    listeners.delete(listener);
  };
}

async function fetchNotificationsForUser(userId: string) {
  const fetchToken = ++activeFetchToken;
  setNotificationStore({ userId, loading: true });
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (notificationStore.userId !== userId || fetchToken !== activeFetchToken) return;
  setNotificationStore({
    userId,
    notifications: (data ?? []) as NotificationItem[],
    loading: false,
  });
}

function ensureRealtimeSubscription(userId: string) {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
      void fetchNotificationsForUser(userId);
    })
    .subscribe();
}

function resetNotificationStore() {
  activeFetchToken += 1;
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  setNotificationStore({
    userId: null,
    notifications: [],
    loading: false,
  });
}

export function useNotifications() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<NotificationStoreSnapshot>(() => ({
    userId: notificationStore.userId,
    notifications: notificationStore.notifications,
    loading: notificationStore.loading,
  }));

  useEffect(() => subscribeNotifications(setSnapshot), []);

  useEffect(() => {
    if (!user?.id) {
      resetNotificationStore();
      return;
    }
    if (notificationStore.userId !== user.id) {
      setNotificationStore({
        userId: user.id,
        notifications: [],
        loading: true,
      });
    }
    ensureRealtimeSubscription(user.id);
    void fetchNotificationsForUser(user.id);
  }, [user?.id]);

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    setNotificationStore({
      notifications: notificationStore.notifications.map((notification) => (
        notification.id === id
          ? { ...notification, read_at: notification.read_at ?? now }
          : notification
      )),
    });
    await supabase.from('notifications').update({ read_at: now }).eq('id', id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    setNotificationStore({
      notifications: notificationStore.notifications.map((notification) => ({
        ...notification,
        read_at: notification.read_at ?? now,
      })),
    });
    await supabase.from('notifications').update({ read_at: now }).eq('user_id', user.id).is('read_at', null);
  }, [user?.id]);

  const respondJoinRequest = useCallback(async (notificationId: string, requestId: string, action: 'approve' | 'deny') => {
    const { data } = await supabase.rpc('respond_join_request', {
      p_request_id: requestId,
      p_action: action,
    });

    if ((data as { error?: string } | null)?.error) {
      throw new Error((data as { error: string }).error);
    }

    const now = new Date().toISOString();
    setNotificationStore({
      notifications: notificationStore.notifications.map((notification) => (
        notification.id === notificationId
          ? {
              ...notification,
              read_at: notification.read_at ?? now,
              metadata: {
                ...(notification.metadata ?? {}),
                status: action === 'approve' ? 'approved' : 'denied',
              },
            }
          : notification
      )),
    });

    await supabase
      .from('notifications')
      .update({
        read_at: now,
        metadata: {
          ...(notificationStore.notifications.find((notification) => notification.id === notificationId)?.metadata ?? {}),
          status: action === 'approve' ? 'approved' : 'denied',
        },
      })
      .eq('id', notificationId);
  }, []);

  const refetch = useCallback(async () => {
    if (!user?.id) return;
    await fetchNotificationsForUser(user.id);
  }, [user?.id]);

  const unreadCount = snapshot.notifications.filter((notification) => !notification.read_at).length;

  return {
    notifications: snapshot.notifications,
    loading: snapshot.loading,
    unreadCount,
    markRead,
    markAllRead,
    respondJoinRequest,
    refetch,
  };
}
