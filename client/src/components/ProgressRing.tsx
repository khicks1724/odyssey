interface Props {
  progress: number; // 0–100
  size?: number;
  strokeWidth?: number;
  label?: string;
}

// Interpolate between two hex colors
function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function lerpColor(from: string, to: string, t: number) {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
}

// Red → Orange → Yellow → Green gradient by progress %
function progressColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  if (p < 33)  return lerpColor('#ef4444', '#f97316', p / 33);
  if (p < 66)  return lerpColor('#f97316', '#facc15', (p - 33) / 33);
  return               lerpColor('#facc15', '#22c55e', (p - 66) / 34);
}

export default function ProgressRing({ progress, size = 44, strokeWidth = 3.5, label }: Props) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, progress)) / 100) * circumference;
  const color = progressColor(progress);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Label */}
      <text
        x={cx} y={cy + 3.5}
        textAnchor="middle"
        fontSize="9"
        fontFamily="monospace"
        fontWeight="bold"
        fill="var(--color-heading)"
      >
        {label ?? `${progress}%`}
      </text>
    </svg>
  );
}
