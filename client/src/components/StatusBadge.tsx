interface StatusBadgeProps {
  status: 'active' | 'at_risk' | 'complete' | 'missed' | 'on_track' | 'behind' | 'on_plan' | 'off_track';
  size?: 'sm' | 'md';
}

const statusStyles: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  // Project health statuses — explicit colors so theme variables don't override
  on_plan:  { label: 'On Plan',   color: 'text-emerald-400', bg: 'bg-emerald-400/10', dot: 'bg-emerald-400' },
  at_risk:  { label: 'At Risk',   color: 'text-yellow-400',  bg: 'bg-yellow-400/10',  dot: 'bg-yellow-400'  },
  off_track:{ label: 'Off Track', color: 'text-red-400',     bg: 'bg-red-400/10',     dot: 'bg-red-400'     },
  // Legacy statuses
  on_track: { label: 'On Track',  color: 'text-emerald-400', bg: 'bg-emerald-400/10', dot: 'bg-emerald-400' },
  active:   { label: 'Active',    color: 'text-[var(--color-accent2)]', bg: 'bg-[var(--color-accent2)]/10', dot: 'bg-[var(--color-accent2)]' },
  complete: { label: 'Complete',  color: 'text-emerald-400', bg: 'bg-emerald-400/10', dot: 'bg-emerald-400' },
  missed:   { label: 'Missed',    color: 'text-red-400',     bg: 'bg-red-400/10',     dot: 'bg-red-400'     },
  behind:   { label: 'Behind',    color: 'text-red-400',     bg: 'bg-red-400/10',     dot: 'bg-red-400'     },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = statusStyles[status] ?? statusStyles.on_track;
  const sizeClasses = size === 'md' ? 'text-xs px-3 py-1' : 'text-[10px] px-2 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1.5 tracking-[0.15em] uppercase font-sans font-semibold rounded ${sizeClasses} ${config.bg} ${config.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
