import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';
import type { NotificationItem } from '../types';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, loading, unreadCount, markRead, markAllRead, respondJoinRequest } = useNotifications();
  const [actingId, setActingId] = useState<string | null>(null);

  const getJoinRequestId = (metadata: Record<string, unknown> | null) => {
    return typeof metadata?.request_id === 'string' ? metadata.request_id : null;
  };

  const getJoinRequestStatus = (metadata: Record<string, unknown> | null) => {
    return typeof metadata?.status === 'string' ? metadata.status : null;
  };

  const getTaskOpenState = (notification: NotificationItem) => {
    if (notification.kind !== 'task_assigned') return null;
    const goalId = typeof notification.metadata?.goal_id === 'string' ? notification.metadata.goal_id : null;
    if (!goalId || !notification.project_id) return null;
    return {
      pathname: `/projects/${notification.project_id}`,
      state: { openTab: 'goals' as const, editGoalId: goalId },
    };
  };

  const handleOpenNotification = async (notification: NotificationItem) => {
    if (!notification.read_at) await markRead(notification.id);

    const taskOpenState = getTaskOpenState(notification);
    if (taskOpenState) {
      navigate(taskOpenState.pathname, { state: taskOpenState.state });
      return;
    }

    if (!notification.link) return;
    if (notification.link.startsWith('/')) navigate(notification.link);
    else window.location.href = notification.link;
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-10">
        <div>
          <p className="text-[11px] tracking-[0.25em] uppercase text-accent mb-2 font-mono">Notifications</p>
          <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">Platform Notifications</h1>
          <p className="text-sm text-muted mt-1">Join requests, approvals, and shared workspace updates that are relevant to your account.</p>
        </div>

        <button
          type="button"
          onClick={markAllRead}
          disabled={unreadCount === 0}
          className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md disabled:opacity-40"
        >
          <CheckCheck size={13} />
          Mark All Read
        </button>
      </div>

      <div className="border border-border bg-border">
        {loading ? (
          <div className="space-y-px">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface p-5 animate-pulse">
                <div className="h-4 bg-border rounded w-1/3 mb-3" />
                <div className="h-3 bg-border rounded w-full mb-2" />
                <div className="h-3 bg-border rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-surface p-16 text-center">
            <Bell size={36} className="text-muted/40 mx-auto mb-4" />
            <p className="text-sm text-muted">No notifications yet.</p>
          </div>
        ) : (
          <div className="space-y-px">
            {notifications.map((notification) => {
              const requestId = getJoinRequestId(notification.metadata);
              const requestStatus = getJoinRequestStatus(notification.metadata);
              const notificationLink = notification.link;
              const showJoinActions = notification.kind === 'join_request' && requestId && requestStatus === 'pending';
              const isActing = actingId === notification.id;

              return (
                <div
                  key={notification.id}
                  className={`bg-surface p-5 transition-colors ${notification.read_at ? '' : 'ring-1 ring-accent/20 ring-inset bg-surface2/30'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] tracking-[0.18em] uppercase text-muted font-mono">{notification.kind.replaceAll('_', ' ')}</span>
                        {!notification.read_at && <span className="text-[9px] px-1.5 py-0.5 border border-accent/30 text-accent rounded font-mono">New</span>}
                      </div>
                      <p className="text-sm text-heading font-sans font-semibold">{notification.title}</p>
                      {notification.body && <p className="text-xs text-muted mt-1.5 leading-relaxed">{notification.body}</p>}
                      <p className="text-[10px] text-muted font-mono mt-3">
                        {new Date(notification.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {showJoinActions ? (
                        <>
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={async () => {
                              try {
                                setActingId(notification.id);
                                await respondJoinRequest(notification.id, requestId, 'deny');
                              } catch (error) {
                                alert(error instanceof Error ? error.message : 'Unable to update join request');
                              } finally {
                                setActingId(null);
                              }
                            }}
                            className="px-3 py-1.5 border border-border text-muted text-[10px] font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors rounded disabled:opacity-50"
                          >
                            {isActing ? 'Working…' : 'Decline'}
                          </button>
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={async () => {
                              try {
                                setActingId(notification.id);
                                await respondJoinRequest(notification.id, requestId, 'approve');
                              } catch (error) {
                                alert(error instanceof Error ? error.message : 'Unable to update join request');
                              } finally {
                                setActingId(null);
                              }
                            }}
                            className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                          >
                            {isActing ? 'Working…' : 'Accept'}
                          </button>
                        </>
                      ) : (
                        <>
                          {!notification.read_at && (
                            <button
                              type="button"
                              onClick={() => markRead(notification.id)}
                              className="px-3 py-1.5 border border-border text-muted text-[10px] font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors rounded"
                            >
                              Read
                            </button>
                          )}

                          {notificationLink && (
                            <button
                              type="button"
                              onClick={() => void handleOpenNotification(notification)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded"
                            >
                              Open
                              <ExternalLink size={11} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="mt-4 text-[11px] text-muted">
        Notifications are account-scoped. Users only see notifications created for their own account and projects they are actually involved in.
      </p>
    </div>
  );
}
