import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  accent: string;
  accent2: string;
  accent3: string;
  danger: string;
  text: string;
  muted: string;
  heading: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
}

export const themes: Theme[] = [
  {
    id: 'odyssey-dark',
    name: 'Odyssey Dark',
    colors: {
      bg: '#13151c',
      surface: '#1a1d26',
      surface2: '#1f2330',
      border: '#2a3044',
      accent: '#6a9fd8',
      accent2: '#5a9e8a',
      accent3: '#e8a235',
      danger: '#e05555',
      text: '#c8d0dc',
      muted: '#6b7a8d',
      heading: '#e8edf4',
    },
  },
  {
    id: 'ivory',
    name: 'Odyssey Light',
    colors: {
      bg: '#f5f0e8',
      surface: '#ece7df',
      surface2: '#e2ddd4',
      border: '#c8c0b4',
      accent: '#1e3a5f',
      accent2: '#2a5a8f',
      accent3: '#3a7a6a',
      danger: '#b91c1c',
      text: '#1e3a5f',
      muted: '#6b7a8d',
      heading: '#0f1f33',
    },
  },
  {
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    colors: {
      bg: '#282c34',
      surface: '#2c313a',
      surface2: '#323842',
      border: '#3e4451',
      accent: '#e5c07b',
      accent2: '#61afef',
      accent3: '#98c379',
      danger: '#e06c75',
      text: '#abb2bf',
      muted: '#5c6370',
      heading: '#e5e9f0',
    },
  },
  {
    id: 'dark-modern',
    name: 'Dark Modern',
    colors: {
      bg: '#080c10',
      surface: '#0d1219',
      surface2: '#111820',
      border: '#1e2a38',
      accent: '#e8a235',
      accent2: '#3b8eea',
      accent3: '#52c98e',
      danger: '#e85555',
      text: '#d4dde8',
      muted: '#5a6a7e',
      heading: '#f0f4f8',
    },
  },
  {
    id: 'light-modern',
    name: 'Light Modern',
    colors: {
      bg: '#ffffff',
      surface: '#f5f5f5',
      surface2: '#e8e8e8',
      border: '#d1d5db',
      accent: '#c97b15',
      accent2: '#2563eb',
      accent3: '#16a34a',
      danger: '#dc2626',
      text: '#374151',
      muted: '#6b7280',
      heading: '#111827',
    },
  },
  {
    id: 'claude-dark',
    name: 'Claude Dark',
    colors: {
      bg: '#1e1e1e',
      surface: '#252525',
      surface2: '#2d2d2d',
      border: '#3a3a3a',
      accent: '#D4825E',
      accent2: '#5BA3D9',
      accent3: '#5CB85C',
      danger: '#E06B8A',
      text: '#d4d4d4',
      muted: '#858585',
      heading: '#f0f0f0',
    },
  },
  {
    id: 'claude-light',
    name: 'Claude Light',
    colors: {
      bg: '#FAF9F5',
      surface: '#F0EFE9',
      surface2: '#E5E4DE',
      border: '#D0CFC8',
      accent: '#C96442',
      accent2: '#1C6BBB',
      accent3: '#26831A',
      danger: '#D73A83',
      text: '#1F1E1D',
      muted: '#6F6F78',
      heading: '#1F1E1D',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    colors: {
      bg: '#0d1117',
      surface: '#161b22',
      surface2: '#1c2128',
      border: '#30363d',
      accent: '#f78166',
      accent2: '#58a6ff',
      accent3: '#3fb950',
      danger: '#f85149',
      text: '#c9d1d9',
      muted: '#8b949e',
      heading: '#f0f6fc',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    colors: {
      bg: '#2e3440',
      surface: '#3b4252',
      surface2: '#434c5e',
      border: '#4c566a',
      accent: '#ebcb8b',
      accent2: '#81a1c1',
      accent3: '#a3be8c',
      danger: '#bf616a',
      text: '#d8dee9',
      muted: '#7b88a1',
      heading: '#eceff4',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    colors: {
      bg: '#282a36',
      surface: '#2e303e',
      surface2: '#363949',
      border: '#44475a',
      accent: '#f1fa8c',
      accent2: '#bd93f9',
      accent3: '#50fa7b',
      danger: '#ff5555',
      text: '#c0c0d0',
      muted: '#6272a4',
      heading: '#f8f8f2',
    },
  },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const c = theme.colors;
  root.style.setProperty('--color-bg', c.bg);
  root.style.setProperty('--color-surface', c.surface);
  root.style.setProperty('--color-surface2', c.surface2);
  root.style.setProperty('--color-border', c.border);
  root.style.setProperty('--color-accent', c.accent);
  root.style.setProperty('--color-accent2', c.accent2);
  root.style.setProperty('--color-accent3', c.accent3);
  root.style.setProperty('--color-danger', c.danger);
  root.style.setProperty('--color-text', c.text);
  root.style.setProperty('--color-muted', c.muted);
  root.style.setProperty('--color-heading', c.heading);
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('odyssey-theme');
    return themes.find((t) => t.id === saved) ?? themes[0];
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (id: string) => {
    const t = themes.find((t) => t.id === id);
    if (t) {
      setThemeState(t);
      localStorage.setItem('odyssey-theme', id);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
