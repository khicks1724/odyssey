import { useState, useEffect } from 'react';
import { useTimeFormat } from '../lib/time-format';

export default function DateTime() {
  const [now, setNow] = useState(new Date());
  const { settings } = useTimeFormat();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const formatted =
    now.toLocaleDateString('en-US', {
      timeZone: settings.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    '  ·  ' +
    now.toLocaleTimeString('en-US', {
      timeZone: settings.timezone,
      hourCycle: settings.hourCycle,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  return (
    <span className="text-xs tracking-wide text-[var(--color-muted)] font-mono whitespace-nowrap">
      {formatted}
    </span>
  );
}
