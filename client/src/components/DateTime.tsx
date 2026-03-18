import { useState, useEffect } from 'react';

export default function DateTime() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const formatted = now.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + '  ·  ' + now.toLocaleTimeString(undefined, {
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
