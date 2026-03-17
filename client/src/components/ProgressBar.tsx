interface ProgressBarProps {
  value: number;
  max?: number;
  color?: 'accent' | 'accent2' | 'accent3' | 'danger';
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const colorMap = {
  accent: 'bg-accent',
  accent2: 'bg-accent2',
  accent3: 'bg-accent3',
  danger: 'bg-danger',
};

export default function ProgressBar({ value, max = 100, color = 'accent2', size = 'sm', showLabel }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between text-[10px] text-muted mb-1">
          <span>Progress</span>
          <span className="text-heading font-mono">{Math.round(percent)}%</span>
        </div>
      )}
      <div className={`w-full bg-border rounded-full overflow-hidden ${size === 'md' ? 'h-2' : 'h-1.5'}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorMap[color]}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
