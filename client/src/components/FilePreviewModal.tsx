import { X, Loader2, Github, GitBranch } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { FileRef } from '../hooks/useProjectFilePaths';
import './FilePreviewModal.css';

interface FilePreviewModalProps {
  fileRef: FileRef;
  content: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', go: 'go', rs: 'rust', java: 'java',
  cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp',
  rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  sql: 'sql', html: 'html', css: 'css', scss: 'scss',
  json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
  toml: 'toml', xml: 'xml', ini: 'ini', cfg: 'ini', env: 'bash',
};

const LANG_LABEL: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', cpp: 'C++',
  c: 'C', h: 'C/C++', cs: 'C#', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', sh: 'Shell', bash: 'Shell', html: 'HTML', css: 'CSS', scss: 'SCSS',
  toml: 'TOML', sql: 'SQL', rb: 'Ruby', php: 'PHP', xml: 'XML',
};

export default function FilePreviewModal({ fileRef, content, loading, error, onClose }: FilePreviewModalProps) {
  const filename = fileRef.path.split('/').pop() ?? fileRef.path;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const lang = EXT_LANG[ext] ?? 'text';
  const lineCount = content ? content.split('\n').length : 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fpm-root fixed inset-4 z-50 flex flex-col border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="fpm-header flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {fileRef.type === 'github'
              ? <Github size={13} className="text-white/40 shrink-0" />
              : <GitBranch size={13} className="text-white/40 shrink-0" />
            }
            <code className="text-xs font-mono text-[#e5c07b] truncate">{fileRef.path}</code>
            <span className="text-[10px] text-white/30 shrink-0 font-mono">{fileRef.repo}</span>
            {LANG_LABEL[ext] && (
              <span className="text-[10px] bg-white/10 border border-white/10 px-1.5 py-0.5 rounded font-mono text-white/40 shrink-0">
                {LANG_LABEL[ext]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {content && !loading && (
              <span className="text-[10px] text-white/30 font-mono">{lineCount} lines</span>
            )}
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="fpm-body flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-full gap-3">
              <Loader2 size={18} className="animate-spin text-[#e5c07b]" />
              <span className="text-sm text-white/50 font-mono">Loading {filename}…</span>
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-red-400 font-mono">{error}</p>
            </div>
          )}
          {content && !loading && (
            <SyntaxHighlighter
              language={lang}
              style={oneDark}
              showLineNumbers
              lineNumberStyle={{
                color: '#636d83',
                minWidth: '3.5em',
                paddingRight: '1.5em',
                userSelect: 'none',
                fontSize: '11px',
              }}
              customStyle={{
                margin: 0,
                padding: '1rem 0',
                background: 'transparent',
                fontSize: '12px',
                lineHeight: '1.65',
              }}
              wrapLongLines={false}
            >
              {content}
            </SyntaxHighlighter>
          )}
        </div>
      </div>
    </>
  );
}
