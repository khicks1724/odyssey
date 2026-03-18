import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../../types';
import { Target, AlertTriangle, CheckCircle, XCircle, Circle, Loader, ChevronDown } from 'lucide-react';

const statusConfig = {
  not_started: { icon: Circle, color: 'text-muted', bg: 'bg-muted/10', label: 'Not Started' },
  active: { icon: Target, color: 'text-accent2', bg: 'bg-accent2/10', label: 'Active' },
  in_progress: { icon: Loader, color: 'text-accent2', bg: 'bg-accent2/10', label: 'In Progress' },
  at_risk: { icon: AlertTriangle, color: 'text-accent', bg: 'bg-accent/10', label: 'At Risk' },
  complete: { icon: CheckCircle, color: 'text-accent3', bg: 'bg-accent3/10', label: 'Complete' },
  missed: { icon: XCircle, color: 'text-danger', bg: 'bg-danger/10', label: 'Missed' },
};

const STATUS_ORDER: Goal['status'][] = ['not_started', 'in_progress', 'active', 'at_risk', 'complete', 'missed'];

interface GoalCardProps {
  goal: Goal;
  onUpdateProgress?: (id: string, progress: number) => void;
  onUpdateStatus?: (id: string, status: Goal['status']) => void;
}

export default function GoalCard({ goal, onUpdateProgress, onUpdateStatus }: GoalCardProps) {
  const config = statusConfig[goal.status] || statusConfig.active;
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

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex justify-between text-[10px] text-muted mb-1">
          <span>Progress</span>
          <span className="text-heading font-mono">{goal.progress}%</span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              goal.status === 'at_risk' ? 'bg-accent' :
              goal.status === 'complete' ? 'bg-accent3' :
              goal.status === 'missed' ? 'bg-danger' : 'bg-accent2'
            }`}
            style={{ width: `${goal.progress}%` }}
          />
        </div>
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
          {onUpdateStatus && goal.status === 'active' && goal.progress === 100 && (
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
