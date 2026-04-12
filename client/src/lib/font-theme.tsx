import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface FontTheme {
  id: string;
  name: string;
  /** Short label shown in the dropdown button */
  label: string;
  /** Preview sample string */
  sample: string;
  vars: {
    /** Body / general UI text */
    fontUi: string;
    /** Heading / display / label font (font-sans class) */
    fontSans: string;
    /** Serif accent font */
    fontSerif: string;
    /** Actual monospace — only override if intentional */
    fontMono?: string;
    /** Scale multiplier for font-size (default 1) */
    fontScale?: string;
    /** Letter-spacing override */
    fontTracking?: string;
  };
}

export const fontThemes: FontTheme[] = [
  {
    id: 'default',
    name: 'Default',
    label: 'Default',
    sample: 'Aa',
    vars: {
      fontUi: '"DM Mono", monospace',
      fontSans: '"Syne", sans-serif',
      fontSerif: '"Fraunces", serif',
    },
  },
  {
    id: 'bahnschrift',
    name: 'Bahnschrift',
    label: 'Bahn',
    sample: 'Aa',
    vars: {
      // Bahnschrift is built into Windows 10+; Barlow Condensed is the web fallback
      fontUi: 'Bahnschrift, "Barlow Condensed", "DIN Alternate", "Franklin Gothic Medium", Arial, sans-serif',
      fontSans: 'Bahnschrift, "Barlow Condensed", "DIN Alternate", "Franklin Gothic Medium", Arial, sans-serif',
      fontSerif: 'Bahnschrift, "Barlow Condensed", "DIN Alternate", Arial, sans-serif',
      fontMono: '"DM Mono", Bahnschrift, monospace',
      fontScale: '1.04',
      fontTracking: '0.01em',
    },
  },
  {
    id: 'ubuntu',
    name: 'Inter',
    label: 'Inter',
    sample: 'Aa',
    vars: {
      fontUi: '"Inter", "Segoe UI", system-ui, sans-serif',
      fontSans: '"Inter", "Segoe UI", system-ui, sans-serif',
      fontSerif: '"Inter", Georgia, serif',
      fontMono: '"Roboto Mono", "DM Mono", monospace',
      fontScale: '1.02',
      fontTracking: '0.005em',
    },
  },
  {
    id: 'consolas',
    name: 'Consolas',
    label: 'Cons',
    sample: 'Aa',
    vars: {
      // Consolas — Windows monospace ClearType font; Fira Code as cross-platform fallback
      fontUi: 'Consolas, "Fira Code", "Cascadia Code", "Courier New", monospace',
      fontSans: 'Consolas, "Fira Code", "Cascadia Code", "Courier New", monospace',
      fontSerif: 'Consolas, "Courier New", monospace',
      fontMono: 'Consolas, "Fira Code", "Cascadia Code", monospace',
      fontScale: '1.0',
      fontTracking: '0em',
    },
  },
  {
    id: 'courier-new',
    name: 'Roboto',
    label: 'Robo',
    sample: 'Aa',
    vars: {
      fontUi: '"Roboto", "Segoe UI", system-ui, sans-serif',
      fontSans: '"Roboto", "Segoe UI", system-ui, sans-serif',
      fontSerif: '"Roboto", Georgia, serif',
      fontMono: '"Roboto Mono", "DM Mono", monospace',
      fontScale: '1.0',
      fontTracking: '0em',
    },
  },
  {
    id: 'mfd',
    name: 'MFD',
    label: 'MFD',
    sample: 'Aa',
    vars: {
      fontUi: '"Hornet Display Bold", "Hornet Display", Bahnschrift, "DIN Alternate", "Barlow Condensed", "Arial Narrow", Arial, sans-serif',
      fontSans: '"Hornet Display Bold", "Hornet Display", Bahnschrift, "DIN Alternate", "Barlow Condensed", "Arial Narrow", Arial, sans-serif',
      fontSerif: '"Hornet Display Bold", "Hornet Display", Bahnschrift, "DIN Alternate", "Barlow Condensed", Arial, sans-serif',
      fontMono: 'Consolas, "Lucida Console", "Cascadia Mono", monospace',
      fontScale: '1.01',
      fontTracking: '0.035em',
    },
  },
];

export function applyFontTheme(theme: FontTheme) {
  const root = document.documentElement;
  root.style.setProperty('--font-ui', theme.vars.fontUi);
  root.style.setProperty('--font-sans', theme.vars.fontSans);
  root.style.setProperty('--font-serif', theme.vars.fontSerif);
  root.style.setProperty('--font-mono', theme.vars.fontMono ?? '"DM Mono", monospace');
  root.style.setProperty('--font-scale', theme.vars.fontScale ?? '1');
  root.style.setProperty('--font-tracking', theme.vars.fontTracking ?? 'normal');
  root.setAttribute('data-font-theme', theme.id);
}

export function getFontThemeById(id: string) {
  return fontThemes.find((theme) => theme.id === id) ?? null;
}

interface FontThemeContextValue {
  fontTheme: FontTheme;
  setFontTheme: (id: string) => void;
}

const FontThemeContext = createContext<FontThemeContextValue | null>(null);

export function FontThemeProvider({ children }: { children: ReactNode }) {
  const [fontTheme, setFontThemeState] = useState<FontTheme>(() => {
    const saved = localStorage.getItem('odyssey-font-theme');
    return fontThemes.find((t) => t.id === saved) ?? fontThemes[0];
  });

  useEffect(() => {
    applyFontTheme(fontTheme);
  }, [fontTheme]);

  const setFontTheme = (id: string) => {
    const t = fontThemes.find((t) => t.id === id);
    if (t) {
      setFontThemeState(t);
      localStorage.setItem('odyssey-font-theme', id);
    }
  };

  return (
    <FontThemeContext.Provider value={{ fontTheme, setFontTheme }}>
      {children}
    </FontThemeContext.Provider>
  );
}

export function useFontTheme() {
  const ctx = useContext(FontThemeContext);
  if (!ctx) throw new Error('useFontTheme must be used within FontThemeProvider');
  return ctx;
}
