interface StatusBadgeProps {
  status: 'active' | 'at_risk' | 'complete' | 'missed' | 'on_track' | 'behind';
  size?: 'sm' | 'md';
}

const statusStyles: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  active: { label: 'Active', color: 'text-accent2', bg: 'bg-accent2/10', dot: 'bg-accent2' },
  on_track: { label: 'On Track', color: 'text-accent3', bg: 'bg-accent3/10', dot: 'bg-accent3' },
  at_risk: { label: 'At Risk', color: 'text-accent', bg: 'bg-accent/10', dot: 'bg-accent' },
  complete: { label: 'Complete', color: 'text-accent3', bg: 'bg-accent3/10', dot: 'bg-accent3' },
  missed: { label: 'Missed', color: 'text-danger', bg: 'bg-danger/10', dot: 'bg-danger' },
  behind: { label: 'Behind', color: 'text-danger', bg: 'bg-danger/10', dot: 'bg-danger' },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = statusStyles[status] || statusStyles.active;
  const sizeClasses = size === 'md' ? 'text-xs px-3 py-1' : 'text-[10px] px-2 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1.5 tracking-[0.15em] uppercase font-sans font-semibold rounded ${sizeClasses} ${config.bg} ${config.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
