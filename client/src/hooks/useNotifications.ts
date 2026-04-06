import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { NotificationItem } from '../types';

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    setNotifications((data ?? []) as NotificationItem[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchNotifications();
  }, [user, fetchNotifications]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        fetchNotifications();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  };

  const markAllRead = async () => {
    if (!user) return;
    const now = new Date().toISOString();
    await supabase.from('notifications').update({ read_at: now }).eq('user_id', user.id).is('read_at', null);
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
  };

  const respondJoinRequest = async (notificationId: string, requestId: string, action: 'approve' | 'deny') => {
    const { data } = await supabase.rpc('respond_join_request', {
      p_request_id: requestId,
      p_action: action,
    });

    if ((data as { error?: string } | null)?.error) {
      throw new Error((data as { error: string }).error);
    }

    const now = new Date().toISOString();
    const existingMetadata = notifications.find((notification) => notification.id === notificationId)?.metadata ?? {};
    await supabase
      .from('notifications')
      .update({
        read_at: now,
        metadata: {
          ...existingMetadata,
          status: action === 'approve' ? 'approved' : 'denied',
        },
      })
      .eq('id', notificationId);

    await fetchNotifications();
  };

  return { notifications, loading, unreadCount, markRead, markAllRead, respondJoinRequest, refetch: fetchNotifications };
}
