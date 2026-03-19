import { useState, useCallback } from 'react';
import './ContributionGraph.css';

interface ContributionGraphProps {
  data: { date: string; count: number }[];
}

const CELL = 13;
const GAP  = 2;
const STEP = CELL + GAP;
const WEEKS = 52;
const DAYS  = 7;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function cellColor(count: number): string {
  if (count === 0) return 'var(--commit-0)';
  if (count <= 2)  return 'var(--commit-1)';
  if (count <= 5)  return 'var(--commit-2)';
  if (count <= 10) return 'var(--commit-3)';
  return 'var(--commit-4)';
}

interface TooltipState {
  date: string;
  count: number;
  x: number;
  y: number;
}

export default function ContributionGraph({ data }: ContributionGraphProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const today = new Date();
  const countMap = new Map(data.map((d) => [d.date, d.count]));
  const totalCount = data.reduce((s, d) => s + d.count, 0);

  // Start on the Sunday 52 full weeks ago
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (WEEKS - 1) * 7 - startDate.getDay());

  // Build grid[week][day]
  const grid = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: DAYS }, (_, d) => {
      const cell = addDays(startDate, w * 7 + d);
      const ds = isoDate(cell);
      return { date: ds, count: countMap.get(ds) ?? 0, future: cell > today };
    })
  );

  // Month labels
  const monthLabels: { label: string; x: number }[] = [];
  let lastMonth = '';
  grid.forEach((col, w) => {
    const d = addDays(startDate, w * 7);
    const m = d.toLocaleDateString('en-US', { month: 'short' });
    if (m !== lastMonth) { monthLabels.push({ label: m, x: w * STEP }); lastMonth = m; }
    void col; // suppress unused variable warning
  });

  const svgW = WEEKS * STEP;
  const svgH = 20 + DAYS * STEP;

  const handleEnter = useCallback((e: React.MouseEvent<SVGRectElement>, cell: { date: string; count: number }) => {
    if (cell.count === 0) { setTooltip(null); return; }
    setTooltip({ date: cell.date, count: cell.count, x: e.clientX, y: e.clientY });
  }, []);

  const handleMove = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
  }, []);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[10px] font-mono text-muted">
          {totalCount.toLocaleString()} contributions · last 12 months
        </span>
      </div>

      <div className="flex items-start gap-1.5 w-full">
        {/* Day labels */}
        <div className="flex flex-col shrink-0 pt-5">
          {DAY_LABELS.map((l, i) => (
            <div key={i} style={{ height: STEP, lineHeight: `${STEP}px` }} className="cg-day-label">
              {l}
            </div>
          ))}
        </div>

        {/* SVG heatmap — scales to fill container */}
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          style={{ display: 'block' }}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Month labels */}
          {monthLabels.map(({ label, x }) => (
            <text key={label + x} x={x} y={12} className="cg-month-label">
              {label}
            </text>
          ))}

          {/* Cells */}
          {grid.map((col, w) =>
            col.map((cell, d) => (
              <rect
                key={cell.date}
                x={w * STEP}
                y={20 + d * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                fill={cell.future ? 'transparent' : cellColor(cell.count)}
                style={{ cursor: cell.count > 0 ? 'default' : undefined, transition: 'opacity 0.1s' }}
                onMouseEnter={(e) => handleEnter(e, cell)}
                onMouseMove={handleMove}
                onMouseLeave={() => setTooltip(null)}
              />
            ))
          )}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-2 justify-end">
        <span className="text-[9px] text-muted font-mono mr-1">Less</span>
        {(['var(--commit-0)', 'var(--commit-1)', 'var(--commit-2)', 'var(--commit-3)', 'var(--commit-4)'] as const).map((c, i) => (
          <svg key={i} width={CELL} height={CELL} style={{ display: 'block' }}>
            <rect width={CELL} height={CELL} rx={2} fill={c} />
          </svg>
        ))}
        <span className="text-[9px] text-muted font-mono ml-1">More</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="cg-tooltip"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <div className="cg-tooltip-date">{tooltip.date}</div>
          <div className="cg-tooltip-count">
            {tooltip.count} contribution{tooltip.count !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
