import { useState, useEffect } from 'react';
import { X, Loader2, Github, GitBranch, Folder, ChevronRight, FileText, Search } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { FileRef } from '../hooks/useProjectFilePaths';
import './RepoTreeModal.css';

const API_BASE = '/api';

interface FileEntry { path: string }

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const f of files) {
    const parts = f.path.split('/');
    let nodes = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      let node = nodes.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path: parts.slice(0, i + 1).join('/'), children: [], isFile };
        nodes.push(node);
      }
      nodes = node.children;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sort(n.children));
  };
  sort(root);
  return root;
}

const DEPTH_FILE_PL = ['pl-4', 'pl-7', 'pl-10', 'pl-14', 'pl-[68px]', 'pl-20', 'pl-24', 'pl-28'];
const DEPTH_DIR_PL  = ['pl-1', 'pl-4', 'pl-7',  'pl-10', 'pl-14',     'pl-16', 'pl-20', 'pl-24'];

function TreeNodeRow({
  node,
  depth = 0,
  activePath,
  onOpenFile,
}: {
  node: TreeNode;
  depth?: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const filePl = DEPTH_FILE_PL[Math.min(depth, 7)];
  const dirPl  = DEPTH_DIR_PL[Math.min(depth, 7)];
  const isActive = node.isFile && node.path === activePath;

  if (node.isFile) {
    const ext = node.name.includes('.') ? node.name.split('.').pop() : '';
    return (
      <button
        type="button"
        onClick={() => onOpenFile(node.path)}
        className={`flex items-center gap-1.5 py-1 pr-4 w-full text-left cursor-pointer transition-colors ${filePl} ${
          isActive
            ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
            : 'hover:bg-[var(--color-surface2)]'
        }`}
      >
        <FileText size={10} className="text-[var(--color-muted)] shrink-0" />
        <span className={`text-[11px] font-mono truncate flex-1 transition-colors ${
          isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-heading)] hover:text-[var(--color-accent)]'
        }`}>
          {node.name}
        </span>
        {ext && !isActive && (
          <span className="text-[9px] text-[var(--color-muted)]/50 font-mono shrink-0">.{ext}</span>
        )}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 w-full py-1 hover:bg-[var(--color-surface2)] pr-4 text-left ${dirPl}`}
      >
        <ChevronRight
          size={11}
          className={`text-[var(--color-muted)] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Folder size={11} className="text-[var(--color-accent)]/70 shrink-0" />
        <span className="text-[11px] text-[var(--color-heading)] font-mono font-medium truncate flex-1">
          {node.name}
        </span>
        <span className="text-[9px] text-[var(--color-muted)]/50 font-mono shrink-0">
          {node.children.length}
        </span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
    </div>
  );
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

interface RepoTreeModalProps {
  repo: string;
  type: 'github' | 'gitlab';
  onClose: () => void;
}

export default function RepoTreeModal({ repo, type, onClose }: RepoTreeModalProps) {
  const [files, setFiles]   = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Inline preview state
  const [activePath,    setActivePath]    = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError,   setPreviewError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    let endpoint: string;
    if (type === 'github') {
      const [owner, repoName] = repo.split('/');
      endpoint = `${API_BASE}/github/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/tree`;
    } else {
      endpoint = `${API_BASE}/gitlab/tree?repo=${encodeURIComponent(repo)}`;
    }

    fetch(endpoint)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { files?: FileEntry[] } | FileEntry[]) => {
        const list = Array.isArray(data) ? data : (data.files ?? []);
        setFiles(list);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [repo, type]);

  const handleOpenFile = async (path: string) => {
    if (path === activePath) return; // already open
    setActivePath(path);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);

    try {
      let endpoint: string;
      if (type === 'github') {
        const [owner, repoName] = repo.split('/');
        endpoint = `${API_BASE}/github/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/file?path=${encodeURIComponent(path)}`;
      } else {
        endpoint = `${API_BASE}/gitlab/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`;
      }

      const r = await fetch(endpoint);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setPreviewContent(data.content ?? '');
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const filteredFiles = search
    ? files.filter((f) => f.path.toLowerCase().includes(search.toLowerCase()))
    : files;

  const tree = buildTree(filteredFiles);
  const repoLabel = repo.split('/').slice(-2).join('/');

  // Preview panel details
  const activeFilename = activePath ? activePath.split('/').pop() ?? activePath : '';
  const activeExt      = activeFilename.split('.').pop()?.toLowerCase() ?? '';
  const activeLang     = EXT_LANG[activeExt] ?? 'text';
  const lineCount      = previewContent ? previewContent.split('\n').length : 0;

  const hasPreview = activePath !== null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel — anchored LEFT, expands to right edge when file is open */}
      <div
        className={`rtm-panel fixed inset-y-4 left-4 z-50 flex border border-[var(--color-border)] bg-[var(--color-surface)] rounded-lg shadow-2xl overflow-hidden transition-all duration-200 ${
          hasPreview ? 'right-4' : 'w-[340px]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Tree pane ── */}
        <div className="flex flex-col w-[340px] shrink-0 border-r border-[var(--color-border)]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface2)] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {type === 'github'
                ? <Github size={13} className="text-[var(--color-muted)] shrink-0" />
                : <GitBranch size={13} className="text-[var(--color-muted)] shrink-0" />
              }
              <span className="text-xs font-mono text-[var(--color-heading)] truncate">{repoLabel}</span>
              {!loading && !error && (
                <span className="text-[10px] text-[var(--color-muted)] font-mono shrink-0">
                  {files.length} files
                </span>
              )}
            </div>
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Search */}
          {!loading && !error && files.length > 0 && (
            <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded">
                <Search size={11} className="text-[var(--color-muted)] shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter files…"
                  className="flex-1 bg-transparent text-[11px] text-[var(--color-heading)] placeholder:text-[var(--color-muted)] focus:outline-none font-mono"
                />
              </div>
            </div>
          )}

          {/* Tree body */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12">
                <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                <span className="text-xs text-[var(--color-muted)] font-mono">Loading repository…</span>
              </div>
            )}
            {error && !loading && (
              <div className="px-4 py-8 text-center">
                <p className="text-xs text-red-400 font-mono">{error}</p>
              </div>
            )}
            {!loading && !error && files.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-[var(--color-muted)]">
                No files found.
              </div>
            )}
            {!loading && !error && files.length > 0 && (
              <>
                {search ? (
                  <div className="divide-y divide-[var(--color-border)]/50">
                    {filteredFiles.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-[var(--color-muted)]">
                        No files match.
                      </div>
                    )}
                    {filteredFiles.slice(0, 200).map((f) => {
                      const parts = f.path.split('/');
                      const name = parts[parts.length - 1];
                      const dir = parts.slice(0, -1).join('/');
                      return (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => handleOpenFile(f.path)}
                          className={`flex items-center gap-2 px-4 py-1.5 w-full text-left cursor-pointer transition-colors ${
                            f.path === activePath
                              ? 'bg-[var(--color-accent)]/15'
                              : 'hover:bg-[var(--color-surface2)]'
                          }`}
                        >
                          <FileText size={10} className="text-[var(--color-muted)] shrink-0" />
                          <span className={`text-[11px] font-mono truncate flex-1 transition-colors ${
                            f.path === activePath ? 'text-[var(--color-accent)]' : 'text-[var(--color-heading)] hover:text-[var(--color-accent)]'
                          }`}>
                            {name}
                          </span>
                          {dir && (
                            <span className="text-[9px] text-[var(--color-muted)]/50 truncate shrink-0 max-w-[120px] font-mono">
                              {dir}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {filteredFiles.length > 200 && (
                      <div className="px-4 py-2 text-center text-[10px] text-[var(--color-muted)]">
                        Showing 200 of {filteredFiles.length}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-1">
                    {tree.map((node) => (
                      <TreeNodeRow
                        key={node.path}
                        node={node}
                        activePath={activePath}
                        onOpenFile={handleOpenFile}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Preview pane ── */}
        {hasPreview && (
          <div className="flex flex-col flex-1 min-w-0 bg-[#1e2127]">
            {/* Preview header */}
            <div className="rtm-prev-hdr flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {type === 'github'
                  ? <Github size={12} className="text-white/40 shrink-0" />
                  : <GitBranch size={12} className="text-white/40 shrink-0" />
                }
                <code className="text-[11px] font-mono text-[#e5c07b] truncate">{activePath}</code>
                {LANG_LABEL[activeExt] && (
                  <span className="text-[9px] bg-white/10 border border-white/10 px-1.5 py-0.5 rounded font-mono text-white/40 shrink-0">
                    {LANG_LABEL[activeExt]}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {previewContent && !previewLoading && (
                  <span className="text-[10px] text-white/30 font-mono">{lineCount} lines</span>
                )}
                <button
                  type="button"
                  title="Close preview"
                  onClick={() => { setActivePath(null); setPreviewContent(null); }}
                  className="text-white/40 hover:text-white/80 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Preview body */}
            <div className="flex-1 overflow-auto">
              {previewLoading && (
                <div className="flex items-center justify-center h-full gap-3">
                  <Loader2 size={16} className="animate-spin text-[#e5c07b]" />
                  <span className="text-xs text-white/50 font-mono">Loading {activeFilename}…</span>
                </div>
              )}
              {previewError && !previewLoading && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-red-400 font-mono">{previewError}</p>
                </div>
              )}
              {previewContent && !previewLoading && (
                <SyntaxHighlighter
                  language={activeLang}
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
                  {previewContent}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
