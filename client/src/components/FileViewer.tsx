import { useEffect, useState } from 'react';
import { X, ExternalLink, Loader2, AlertTriangle, Copy, Check } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const API_BASE = '/api';

// Map file extensions to Prism language identifiers
const EXT_LANG: Record<string, string> = {
  py:   'python',
  js:   'javascript',
  jsx:  'jsx',
  ts:   'typescript',
  tsx:  'tsx',
  rs:   'rust',
  go:   'go',
  java: 'java',
  c:    'c',
  cpp:  'cpp',
  cs:   'csharp',
  rb:   'ruby',
  php:  'php',
  sh:   'bash',
  bash: 'bash',
  zsh:  'bash',
  ps1:  'powershell',
  sql:  'sql',
  html: 'html',
  htm:  'html',
  css:  'css',
  scss: 'scss',
  sass: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml:  'yaml',
  toml: 'toml',
  xml:  'xml',
  md:   'markdown',
  mdx:  'markdown',
  tf:   'hcl',
  r:    'r',
  lua:  'lua',
  kt:   'kotlin',
  swift:'swift',
  dart: 'dart',
  vue:  'html',
  svelte:'html',
  dockerfile: 'docker',
};

function getLang(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'docker';
  if (lower === 'makefile') return 'makefile';
  const ext = lower.split('.').pop() ?? '';
  return EXT_LANG[ext] ?? 'text';
}

export type FileSource = 'github' | 'gitlab';

interface FileViewerProps {
  source: FileSource;
  /** For GitHub: "owner/repo"; for GitLab: the encoded repo path */
  repo: string;
  path: string;
  /** GitHub: optional token passed as x-github-token header */
  githubToken?: string;
  /** Link to open on GitHub/GitLab directly */
  externalUrl?: string;
  onClose: () => void;
}

export default function FileViewer({ source, repo, path, githubToken, externalUrl, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const filename = path.split('/').pop() ?? path;
  const lang = getLang(filename);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);

    let url: string;
    const headers: Record<string, string> = {};

    if (source === 'github') {
      const [owner, repoName] = repo.split('/');
      url = `${API_BASE}/github/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/file?path=${encodeURIComponent(path)}`;
      if (githubToken) headers['x-github-token'] = githubToken;
    } else {
      url = `${API_BASE}/gitlab/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`;
    }

    fetch(url, { headers })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to load file');
        setContent(data.content ?? '');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [source, repo, path, githubToken]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const lineCount = content?.split('\n').length ?? 0;

  // Custom style overrides — use app surface color so it matches the theme
  const highlighterStyle: SyntaxHighlighterProps['customStyle'] = {
    margin: 0,
    padding: '1rem 1.25rem',
    background: 'transparent',
    fontSize: '12px',
    lineHeight: '1.6',
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dim overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Slide-in panel */}
      <div className="relative z-10 w-full max-w-4xl flex flex-col bg-[#1a1b26] shadow-2xl border-l border-white/10 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 font-mono uppercase tracking-wider shrink-0">
              {lang}
            </span>
            <span className="text-sm font-mono text-white truncate">{filename}</span>
            <span className="text-[10px] text-white/30 font-mono truncate hidden sm:block">{path}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {content && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                <ExternalLink size={11} /> Open
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Meta bar */}
        {!loading && !error && content && (
          <div className="flex items-center gap-4 px-5 py-1.5 border-b border-white/10 text-[10px] text-white/30 font-mono shrink-0">
            <span>{lineCount} lines</span>
            <span>{(content.length / 1024).toFixed(1)} KB</span>
            <span>{source === 'github' ? 'GitHub' : 'GitLab'} · {repo}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-20 text-white/40 text-xs">
              <Loader2 size={14} className="animate-spin" /> Loading {filename}…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center gap-2 py-20 text-red-400 text-xs">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {!loading && !error && content !== null && (
            <SyntaxHighlighter
              language={lang}
              style={oneDark}
              customStyle={highlighterStyle}
              showLineNumbers
              lineNumberStyle={{ color: 'rgba(255,255,255,0.2)', minWidth: '3em', paddingRight: '1em', userSelect: 'none', fontSize: '11px' }}
              wrapLongLines={false}
            >
              {content}
            </SyntaxHighlighter>
          )}
        </div>
      </div>
    </div>
  );
}
