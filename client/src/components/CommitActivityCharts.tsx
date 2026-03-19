import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './CommitActivityCharts.css';

interface RepoBreakdown {
  source: 'github' | 'gitlab';
  repo: string;
  dateMap: Record<string, number>;
}

interface Props {
  projectId: string;
  onHasData?: (hasData: boolean) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

const CELL = 13; // px per cell
const GAP  = 3;  // px gap
const STEP = CELL + GAP;
const WEEKS = 53;
const DAYS  = 7;

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function commitColor(count: number): string {
  if (count === 0) return 'var(--commit-0)';
  if (count <= 2)  return 'var(--commit-1)';
  if (count <= 5)  return 'var(--commit-2)';
  if (count <= 10) return 'var(--commit-3)';
  return 'var(--commit-4)';
}

interface TooltipState {
  date: string;
  count: number;
  repos: { label: string; count: number }[];
  x: number;
  y: number;
}

interface HeatmapProps {
  countByDate: Map<string, number>;
  totalCommits: number;
  byRepo: RepoBreakdown[];
}

function CommitHeatmap({ countByDate, totalCommits, byRepo }: HeatmapProps) {
  const today = useMemo(() => new Date(), []);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Start on the Sunday 52 full weeks + current week ago
  const startDate = useMemo(() => {
    const s = new Date(today);
    s.setDate(s.getDate() - (WEEKS - 1) * 7 - s.getDay());
    return s;
  }, [today]);

  // Build grid: [week][day] = { date, count }
  const grid = useMemo(() => {
    const g: { date: string; count: number; future: boolean }[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const col: { date: string; count: number; future: boolean }[] = [];
      for (let d = 0; d < DAYS; d++) {
        const cell = addDays(startDate, w * 7 + d);
        const ds = isoDate(cell);
        col.push({ date: ds, count: countByDate.get(ds) ?? 0, future: cell > today });
      }
      g.push(col);
    }
    return g;
  }, [startDate, countByDate, today]);

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: { label: string; x: number }[] = [];
    let last = '';
    grid.forEach((col, w) => {
      const d = addDays(startDate, w * 7);
      const m = d.toLocaleDateString('en-US', { month: 'short' });
      if (m !== last) { labels.push({ label: m, x: w * STEP }); last = m; }
    });
    return labels;
  }, [grid, startDate]);

  const handleCellEnter = useCallback((e: React.MouseEvent<SVGRectElement>, cell: { date: string; count: number }) => {
    if (cell.count === 0) { setTooltip(null); return; }
    const repos = byRepo
      .map((r) => {
        const shortName = r.repo.split('/').pop() ?? r.repo;
        const prefix = r.source === 'github' ? 'GH' : 'GL';
        return { label: `${prefix}: ${shortName}`, count: r.dateMap[cell.date] ?? 0 };
      })
      .filter((r) => r.count > 0);
    setTooltip({ date: cell.date, count: cell.count, repos, x: e.clientX, y: e.clientY });
  }, [byRepo]);

  const handleCellMove = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
  }, []);

  const svgW = WEEKS * STEP;
  const svgH = 20 + DAYS * STEP; // 20px for month labels

  return (
    <div className="cac-heatmap-wrap">
      <div className="cac-heatmap-header">
        <span className="cac-section-title">Commit Activity</span>
        <span className="cac-total">{totalCommits.toLocaleString()} commits · last 12 months</span>
      </div>

      <div className="cac-heatmap-grid-wrap">
        {/* Day labels */}
        <div className="cac-day-labels">
          {DAY_LABELS.map((l, i) => (
            <div key={i} className="cac-day-label">{l}</div>
          ))}
        </div>

        <svg ref={svgRef} width={svgW} height={svgH} className="cac-heatmap-svg" onMouseLeave={() => setTooltip(null)}>
          {/* Month labels */}
          {monthLabels.map(({ label, x }) => (
            <text key={label + x} x={x} y={12} className="cac-month-label">{label}</text>
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
                fill={cell.future ? 'transparent' : commitColor(cell.count)}
                className="cac-cell"
                onMouseEnter={(e) => handleCellEnter(e, cell)}
                onMouseMove={handleCellMove}
                onMouseLeave={() => setTooltip(null)}
              />
            ))
          )}
        </svg>
      </div>

      {/* Legend */}
      <div className="cac-legend">
        <span className="cac-legend-label">Less</span>
        {(['var(--commit-0)', 'var(--commit-1)', 'var(--commit-2)', 'var(--commit-3)', 'var(--commit-4)'] as const).map((c, i) => (
          <svg key={i} width={CELL} height={CELL} className="cac-legend-cell">
            <rect width={CELL} height={CELL} rx={2} fill={c} />
          </svg>
        ))}
        <span className="cac-legend-label">More</span>
      </div>

      {/* Per-repo tooltip */}
      {tooltip && (
        <div
          className="cac-tooltip"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ style: { '--cac-tip-x': `${tooltip.x + 12}px`, '--cac-tip-y': `${tooltip.y - 8}px` } } as any)}
        >
          <div className="cac-tooltip-date">{tooltip.date}</div>
          <div className="cac-tooltip-total">{tooltip.count} commit{tooltip.count !== 1 ? 's' : ''}</div>
          {tooltip.repos.length > 0 && (
            <div className="cac-tooltip-repos">
              {tooltip.repos.map((r) => (
                <div key={r.label} className="cac-tooltip-repo">
                  <span className="cac-tooltip-repo-name">{r.label}</span>
                  <span className="cac-tooltip-repo-count">{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Commit Bar Chart ──────────────────────────────────────────────────────────

interface BarChartProps {
  countByDate: Map<string, number>;
  firstDate: string;
}

interface BarPoint { date: string; count: number; x: number; }

function CommitBarChart({ countByDate, firstDate }: BarChartProps) {
  const today = useMemo(() => new Date(), []);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<{ bar: BarPoint; screenX: number; screenY: number } | null>(null);

  const { bars, yMax, xLabels, numDays } = useMemo(() => {
    const start = new Date(firstDate);
    const days: string[] = [];
    for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
      days.push(isoDate(d));
    }
    if (days.length < 2) return { bars: [] as BarPoint[], yMax: 1, xLabels: [] as { label: string; pct: number }[], numDays: 0 };

    const counts = days.map((d) => countByDate.get(d) ?? 0);
    const yMax = Math.max(...counts, 1);
    const bars: BarPoint[] = days.map((d, i) => ({ date: d, count: counts[i], x: i }));

    const xLabels: { label: string; pct: number }[] = [];
    let lastMonth = '';
    days.forEach((d, i) => {
      const m = new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      if (m !== lastMonth) { xLabels.push({ label: m, pct: (i / (days.length - 1)) * 100 }); lastMonth = m; }
    });

    return { bars, yMax, xLabels, numDays: days.length };
  }, [countByDate, firstDate, today]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || bars.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(pct * (bars.length - 1));
    const bar = bars[Math.max(0, Math.min(bars.length - 1, idx))];
    setHovered({ bar, screenX: e.clientX, screenY: e.clientY });
  }, [bars]);

  if (bars.length < 2) return null;

  return (
    <div className="cac-linechart-wrap">
      <div className="cac-heatmap-header">
        <span className="cac-section-title">Commit Velocity</span>
        <span className="cac-total">daily commits</span>
      </div>

      <div className="cac-linechart-body">
        <div className="cac-y-axis">
          <span>{yMax}</span>
          <span>{Math.round(yMax / 2)}</span>
          <span>0</span>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${numDays} 100`}
          preserveAspectRatio="none"
          className="cac-linechart-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          <line x1="0" y1="0"   x2={numDays} y2="0"   className="cac-grid-line" />
          <line x1="0" y1="50"  x2={numDays} y2="50"  className="cac-grid-line" />
          <line x1="0" y1="100" x2={numDays} y2="100" className="cac-grid-line" />

          {bars.map((bar) => {
            const h = (bar.count / yMax) * 100;
            const isHov = hovered?.bar.date === bar.date;
            return (
              <rect
                key={bar.date}
                x={bar.x + 0.1}
                y={100 - h}
                width={0.8}
                height={h}
                className={isHov ? 'cac-bar cac-bar-hovered' : 'cac-bar'}
              />
            );
          })}
        </svg>
      </div>

      <div className="cac-x-axis">
        {xLabels.map(({ label, pct }) => (
          <span
            key={label}
            className="cac-x-label"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({ style: { '--cac-x-pct': `${pct}%` } } as any)}
          >{label}</span>
        ))}
      </div>

      {hovered && hovered.bar.count > 0 && (
        <div
          className="cac-tooltip"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ style: { '--cac-tip-x': `${hovered.screenX + 12}px`, '--cac-tip-y': `${hovered.screenY - 8}px` } } as any)}
        >
          <div className="cac-tooltip-date">{hovered.bar.date}</div>
          <div className="cac-tooltip-total">{hovered.bar.count} commit{hovered.bar.count !== 1 ? 's' : ''}</div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommitActivityCharts({ projectId, onHasData }: Props) {
  const [countByDate, setCountByDate] = useState<Map<string, number>>(new Map());
  const [byRepo, setByRepo]           = useState<RepoBreakdown[]>([]);
  const [firstDate, setFirstDate]     = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/projects/${projectId}/commit-history`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { commits: { date: string; count: number }[]; byRepo?: RepoBreakdown[] } | null) => {
        if (!data?.commits?.length) { setLoading(false); onHasData?.(false); return; }
        const counts = new Map<string, number>();
        let earliest = data.commits[0].date;
        for (const c of data.commits) {
          counts.set(c.date, c.count);
          if (c.date < earliest) earliest = c.date;
        }
        setCountByDate(counts);
        setByRepo(data.byRepo ?? []);
        setFirstDate(earliest);
        setLoading(false);
        onHasData?.(true);
      })
      .catch(() => { setLoading(false); onHasData?.(false); });
  }, [projectId, onHasData]);

  if (loading) {
    return (
      <div className="cac-skeleton">
        <div className="cac-skeleton-bar cac-skeleton-heatmap" />
        <div className="cac-skeleton-bar cac-skeleton-line" />
      </div>
    );
  }

  const totalCommits = Array.from(countByDate.values()).reduce((a, b) => a + b, 0);

  if (totalCommits === 0) return null;

  return (
    <div className="cac-root">
      <CommitHeatmap countByDate={countByDate} totalCommits={totalCommits} byRepo={byRepo} />
      {firstDate && <CommitBarChart countByDate={countByDate} firstDate={firstDate} />}
    </div>
  );
}
