import type { OdysseyEvent } from '../../types';
import './ActivityFeed.css';
import { GitCommit, MessageSquare, FileEdit, StickyNote, Video, Upload, TrendingUp, File } from 'lucide-react';

const eventIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  commit: GitCommit,
  message: MessageSquare,
  file_edit: FileEdit,
  note: StickyNote,
  meeting: Video,
  file_upload: Upload,
  goal_progress_updated: TrendingUp,
};

const sourceColors: Record<string, string> = {
  github: 'text-heading',
  gitlab: 'text-accent',
  manual: 'text-muted',
  local: 'text-accent3',
  ai: 'text-accent',
};

interface ActivityFeedProps {
  events: OdysseyEvent[];
  loading?: boolean;
  emptyMessage?: string;
}

export default function ActivityFeed({ events, loading, emptyMessage }: ActivityFeedProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-border" />
            <div className="flex-1">
              <div className="h-3 bg-border rounded w-3/4 mb-2" />
              <div className="h-2 bg-border rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    if (emptyMessage === undefined) return null;
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-muted tracking-wide">{emptyMessage || 'No activity yet'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((event) => {
        const Icon = eventIcons[event.event_type] ?? File;
        const color = sourceColors[event.source] || 'text-muted';
        const timeAgo = getTimeAgo(event.occurred_at);
        const meta = event.metadata as Record<string, unknown> | null;

        // Goal progress update: show before → after
        const isGoalProgress = event.event_type === 'goal_progress_updated';
        const oldPct = isGoalProgress ? (meta?.old_progress as number | undefined) : undefined;
        const newPct = isGoalProgress ? (meta?.new_progress as number | undefined) : undefined;
        const completedBy = isGoalProgress ? (meta?.completed_by as string | null | undefined) : undefined;

        return (
          <div
            key={event.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded hover:bg-surface2 transition-colors group"
          >
            <div className={`mt-0.5 p-1.5 rounded bg-border/50 ${color}`}>
              <Icon size={12} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-heading font-medium truncate">
                  {event.title || event.event_type}
                </span>
                <span className="text-[10px] text-muted font-mono shrink-0">{event.source}</span>
              </div>
              {isGoalProgress && oldPct !== undefined && newPct !== undefined && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-muted">{oldPct}%</span>
                  <div className="flex items-center gap-1">
                    <div className="w-16 h-1 rounded-full bg-border overflow-hidden">
                      <div className="af-progress-bar af-progress-bar--before" style={{ '--af-pct': `${oldPct}%` } as React.CSSProperties} />
                    </div>
                    <span className="text-[10px] text-muted">→</span>
                    <div className="w-16 h-1 rounded-full bg-border overflow-hidden">
                      <div className="af-progress-bar af-progress-bar--after" style={{ '--af-pct': `${newPct}%` } as React.CSSProperties} />
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-accent">{newPct}%</span>
                  {completedBy && (
                    <span className="text-[10px] text-muted">by {completedBy}</span>
                  )}
                </div>
              )}
              {event.summary && !isGoalProgress && (
                <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{event.summary}</p>
              )}
              {isGoalProgress && event.summary && (
                <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{event.summary}</p>
              )}
            </div>
            <span className="text-[10px] text-muted font-mono shrink-0 mt-0.5">{timeAgo}</span>
          </div>
        );
      })}
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
