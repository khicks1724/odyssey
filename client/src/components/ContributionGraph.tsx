interface ContributionGraphProps {
  data: { date: string; count: number }[];
}

export default function ContributionGraph({ data }: ContributionGraphProps) {
  // Build a 12-week × 7-day grid (last ~3 months)
  const weeks = 12;
  const today = new Date();
  const grid: { date: string; count: number; level: number }[][] = [];

  // Build date lookup
  const countMap = new Map(data.map((d) => [d.date, d.count]));

  // Find max for level scaling
  const maxCount = Math.max(1, ...data.map((d) => d.count));

  for (let w = weeks - 1; w >= 0; w--) {
    const week: { date: string; count: number; level: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - (w * 7 + (6 - d)));
      const key = date.toISOString().slice(0, 10);
      const count = countMap.get(key) ?? 0;
      const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4));
      week.push({ date: key, count, level });
    }
    grid.push(week);
  }

  const levelColors = [
    'bg-border/40',
    'bg-accent3/20',
    'bg-accent3/40',
    'bg-accent3/60',
    'bg-accent3/80',
  ];

  const monthLabels: { label: string; col: number }[] = [];
  let lastMonth = -1;
  grid.forEach((week, i) => {
    const month = new Date(week[0].date).getMonth();
    if (month !== lastMonth) {
      monthLabels.push({
        label: new Date(week[0].date).toLocaleDateString('en-US', { month: 'short' }),
        col: i,
      });
      lastMonth = month;
    }
  });

  return (
    <div>
      {/* Month labels */}
      <div className="flex mb-1" style={{ paddingLeft: '28px' }}>
        {monthLabels.map((m) => (
          <span
            key={m.col}
            className="text-[9px] text-muted font-mono"
            style={{ position: 'relative', left: `${m.col * 14}px` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex gap-0.5">
        {/* Day labels */}
        <div className="flex flex-col gap-0.5 mr-1">
          {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
            <div key={i} className="h-[10px] text-[8px] text-muted font-mono leading-[10px]">
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        {grid.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day) => (
              <div
                key={day.date}
                className={`w-[10px] h-[10px] rounded-[2px] ${levelColors[day.level]}`}
                title={`${day.date}: ${day.count} events`}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-2 justify-end">
        <span className="text-[9px] text-muted font-mono mr-1">Less</span>
        {levelColors.map((c, i) => (
          <div key={i} className={`w-[10px] h-[10px] rounded-[2px] ${c}`} />
        ))}
        <span className="text-[9px] text-muted font-mono ml-1">More</span>
      </div>
    </div>
  );
}
