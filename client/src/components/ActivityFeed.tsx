import type { OdysseyEvent } from '../../types';
import { GitCommit, MessageSquare, FileEdit, StickyNote, Video } from 'lucide-react';

const eventIcons = {
  commit: GitCommit,
  message: MessageSquare,
  file_edit: FileEdit,
  note: StickyNote,
  meeting: Video,
};

const sourceColors: Record<string, string> = {
  github: 'text-heading',
  teams: 'text-accent2',
  onedrive: 'text-accent2',
  onenote: 'text-accent3',
  manual: 'text-muted',
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
        const Icon = eventIcons[event.event_type] || GitCommit;
        const color = sourceColors[event.source] || 'text-muted';
        const timeAgo = getTimeAgo(event.occurred_at);

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
              {event.summary && (
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
