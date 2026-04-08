import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../types';
import { CheckCircle, Circle, Loader, ChevronDown, AlertTriangle } from 'lucide-react';
import ProgressRing from './ProgressRing';

const statusConfig = {
  not_started: { icon: Circle,        color: 'text-[#D94F4F]', bg: 'bg-[#D94F4F]/10', label: 'Not Started' },
  in_progress: { icon: Loader,        color: 'text-[#D97E2A]', bg: 'bg-[#D97E2A]/10', label: 'In Progress' },
  in_review:   { icon: AlertTriangle, color: 'text-[#facc15]', bg: 'bg-[#facc15]/10', label: 'In Review' },
  complete:    { icon: CheckCircle,   color: 'text-[#6DBE7D]', bg: 'bg-[#6DBE7D]/10', label: 'Complete' },
};

const STATUS_ORDER = ['not_started', 'in_progress', 'in_review', 'complete'] as const satisfies Goal['status'][];

interface GoalCardProps {
  goal: Goal;
  onUpdateProgress?: (id: string, progress: number) => void;
  onUpdateStatus?: (id: string, status: Goal['status']) => void;
  assigneeName?: string;
  assigneeAvatar?: string;
}

export default function GoalCard({ goal, onUpdateProgress, onUpdateStatus, assigneeName, assigneeAvatar }: GoalCardProps) {
  const config = statusConfig[goal.status as keyof typeof statusConfig] ?? statusConfig.not_started;
  const Icon = config.icon;
  const daysLeft = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="bg-surface border border-border p-4 hover:bg-surface2 transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className={config.color} />
          <h4 className="text-sm font-sans font-semibold text-heading">{goal.title}</h4>
        </div>
        <div ref={statusRef} className="relative">
          <button
            onClick={() => setStatusOpen(!statusOpen)}
            className={`flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 rounded cursor-pointer ${config.bg} ${config.color} hover:opacity-80 transition-opacity`}
          >
            {config.label}
            <ChevronDown size={10} />
          </button>
          {statusOpen && onUpdateStatus && (
            <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl z-50 py-1">
              {STATUS_ORDER.map((s) => {
                const sc = statusConfig[s];
                const SIcon = sc.icon;
                return (
                  <button
                    key={s}
                    onClick={() => { onUpdateStatus(goal.id, s); setStatusOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[10px] tracking-wider uppercase text-left transition-colors cursor-pointer ${
                      s === goal.status ? 'bg-[var(--color-surface2)]' : 'hover:bg-[var(--color-surface2)]'
                    }`}
                  >
                    <SIcon size={11} className={sc.color} />
                    <span className={sc.color}>{sc.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Progress ring */}
      <div className="flex items-center gap-3 mb-2">
        <ProgressRing progress={goal.progress} size={36} strokeWidth={3} />
        <span className="text-[10px] text-muted">Progress</span>
      </div>

      {/* Category + LOE + Assignee */}
      <div className="flex items-center gap-2 mb-2">
        {goal.category && goal.category !== 'General' && (
          <span className="text-[9px] tracking-wider uppercase px-1.5 py-0.5 bg-accent2/10 text-accent2 rounded">
            {goal.category}
          </span>
        )}
        {goal.loe && (
          <span className="text-[9px] tracking-wider uppercase px-1.5 py-0.5 bg-accent3/10 text-accent3 rounded">
            {goal.loe}
          </span>
        )}
        {assigneeName && (
          <div className="flex items-center gap-1 ml-auto">
            {assigneeAvatar ? (
              <img src={assigneeAvatar} alt="" className="w-4 h-4 rounded-full" />
            ) : (
              <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center">
                <span className="text-[7px] text-accent font-bold uppercase">{assigneeName[0]}</span>
              </div>
            )}
            <span className="text-[10px] text-muted">{assigneeName}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        {goal.deadline && (
          <span className={`text-[10px] font-mono ${daysLeft !== null && daysLeft < 0 ? 'text-danger' : daysLeft !== null && daysLeft <= 7 ? 'text-accent' : 'text-muted'}`}>
            {daysLeft !== null && daysLeft < 0
              ? `${Math.abs(daysLeft)}d overdue`
              : daysLeft !== null
              ? `${daysLeft}d remaining`
              : ''}
          </span>
        )}

        {/* Quick actions on hover */}
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
          {onUpdateProgress && goal.status !== 'complete' && (
            <button
              onClick={() => onUpdateProgress(goal.id, Math.min(100, goal.progress + 10))}
              className="text-[10px] px-2 py-0.5 border border-border text-muted hover:text-heading hover:bg-surface2 transition-colors rounded"
            >
              +10%
            </button>
          )}
          {onUpdateStatus && goal.status === 'in_progress' && goal.progress === 100 && (
            <button
              onClick={() => onUpdateStatus(goal.id, 'complete')}
              className="text-[10px] px-2 py-0.5 border border-accent3/30 text-accent3 hover:bg-accent3/10 transition-colors rounded"
            >
              Complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
