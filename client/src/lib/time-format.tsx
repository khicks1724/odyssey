import { createContext, useContext, useState, type ReactNode } from 'react';

// ── Storage keys ────────────────────────────────────────────────────────────

const TZ_KEY = 'odyssey-timezone';
const HC_KEY = 'odyssey-hour-cycle';

// ── Types ────────────────────────────────────────────────────────────────────

export type HourCycle = 'h12' | 'h23';

export interface TimeFormatSettings {
  timezone: string;
  hourCycle: HourCycle;
}

// ── Read from localStorage (works outside React) ─────────────────────────────

export function getTimeFormatSettings(): TimeFormatSettings {
  return {
    timezone:  localStorage.getItem(TZ_KEY) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    hourCycle: (localStorage.getItem(HC_KEY) as HourCycle | null) ?? 'h12',
  };
}

// ── Standalone format utilities (usable in report-download.ts etc.) ──────────

export function fmtDate(d: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const { timezone } = getTimeFormatSettings();
  return new Date(d as string).toLocaleDateString('en-US', { timeZone: timezone, ...opts });
}

export function fmtTime(d: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const { timezone, hourCycle } = getTimeFormatSettings();
  return new Date(d as string).toLocaleTimeString('en-US', { timeZone: timezone, hourCycle, ...opts });
}

export function fmtDateTimeStandalone(d: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const { timezone, hourCycle } = getTimeFormatSettings();
  return new Date(d as string).toLocaleString('en-US', { timeZone: timezone, hourCycle, ...opts });
}

// ── All IANA timezones grouped by region ────────────────────────────────────

export type TimezoneGroup = { region: string; zones: string[] };

function buildTimezoneGroups(): TimezoneGroup[] {
  const all: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [];
  const map = new Map<string, string[]>();
  for (const tz of all) {
    const region = tz.split('/')[0];
    if (!map.has(region)) map.set(region, []);
    map.get(region)!.push(tz);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, zones]) => ({ region, zones: zones.sort() }));
}

export const TIMEZONE_GROUPS: TimezoneGroup[] = buildTimezoneGroups();

// ── React context ────────────────────────────────────────────────────────────

interface TimeFormatCtx {
  settings: TimeFormatSettings;
  setTimezone:  (tz: string) => void;
  setHourCycle: (hc: HourCycle) => void;
  /** Format a date string/object using current settings */
  fmtDate:     (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  /** Format a time string/object using current settings */
  fmtTime:     (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  /** Format a date+time string/object using current settings */
  fmtDateTime: (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
}

const TimeFormatContext = createContext<TimeFormatCtx>({
  settings:     { timezone: 'UTC', hourCycle: 'h12' },
  setTimezone:  () => {},
  setHourCycle: () => {},
  fmtDate:      (d, o) => new Date(d as string).toLocaleDateString('en-US', o),
  fmtTime:      (d, o) => new Date(d as string).toLocaleTimeString('en-US', o),
  fmtDateTime:  (d, o) => new Date(d as string).toLocaleString('en-US', o),
});

export function TimeFormatProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<TimeFormatSettings>(getTimeFormatSettings);

  const setTimezone = (tz: string) => {
    localStorage.setItem(TZ_KEY, tz);
    setSettings((prev) => ({ ...prev, timezone: tz }));
  };

  const setHourCycle = (hc: HourCycle) => {
    localStorage.setItem(HC_KEY, hc);
    setSettings((prev) => ({ ...prev, hourCycle: hc }));
  };

  const fmtDateCtx = (d: string | Date, opts?: Intl.DateTimeFormatOptions) =>
    new Date(d as string).toLocaleDateString('en-US', { timeZone: settings.timezone, ...opts });

  const fmtTimeCtx = (d: string | Date, opts?: Intl.DateTimeFormatOptions) =>
    new Date(d as string).toLocaleTimeString('en-US', { timeZone: settings.timezone, hourCycle: settings.hourCycle, ...opts });

  const fmtDateTimeCtx = (d: string | Date, opts?: Intl.DateTimeFormatOptions) =>
    new Date(d as string).toLocaleString('en-US', { timeZone: settings.timezone, hourCycle: settings.hourCycle, ...opts });

  return (
    <TimeFormatContext.Provider value={{
      settings,
      setTimezone,
      setHourCycle,
      fmtDate:     fmtDateCtx,
      fmtTime:     fmtTimeCtx,
      fmtDateTime: fmtDateTimeCtx,
    }}>
      {children}
    </TimeFormatContext.Provider>
  );
}

export function useTimeFormat() {
  return useContext(TimeFormatContext);
}
