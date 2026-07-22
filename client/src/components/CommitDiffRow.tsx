import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  FileDiff,
  GitCommitHorizontal,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface CommitDiffItem {
  source: 'github' | 'gitlab';
  repo: string;
  sha?: string;
  message: string;
  author?: string;
  date?: string;
  url?: string;
}

interface CommitDiffFile {
  oldPath: string;
  newPath: string;
  status: 'added' | 'deleted' | 'renamed' | 'modified' | 'copied' | 'unknown';
  additions: number;
  deletions: number;
  patch: string | null;
  binary: boolean;
  truncated: boolean;
}

interface CommitDiffResponse {
  files: CommitDiffFile[];
  stats: { files: number; additions: number; deletions: number };
  truncated: boolean;
}

interface CommitDiffRowProps {
  projectId: string;
  commit: CommitDiffItem;
  showRepository?: boolean;
  comfortable?: boolean;
}

const MAX_RENDERED_LINES = 1_200;

function formatCommitDate(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function diffLineClass(line: string) {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-accent3/10 text-accent3';
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-danger/10 text-danger';
  if (line.startsWith('@@')) return 'bg-accent/10 text-accent';
  if (line.includes('diff truncated by Odyssey')) return 'bg-accent2/10 text-accent2';
  return 'text-[var(--color-text)]';
}

function statusClass(status: CommitDiffFile['status']) {
  if (status === 'added') return 'border-accent3/30 bg-accent3/10 text-accent3';
  if (status === 'deleted') return 'border-danger/30 bg-danger/10 text-danger';
  if (status === 'renamed' || status === 'copied') return 'border-accent2/30 bg-accent2/10 text-accent2';
  return 'border-border bg-surface2 text-muted';
}

function DiffFileBlock({ file, initiallyOpen }: { file: CommitDiffFile; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const path = file.newPath || file.oldPath;
  const patchLines = file.patch?.split('\n') ?? [];
  const visibleLines = patchLines.slice(0, MAX_RENDERED_LINES);
  const omittedLineCount = Math.max(0, patchLines.length - visibleLines.length);

  return (
    <div className="overflow-hidden rounded-lg border border-border/80 bg-surface">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface2/70"
      >
        <ChevronDown size={13} className={`shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusClass(file.status)}`}>
          {file.status}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-heading" title={path}>{path}</span>
        {file.status === 'renamed' && file.oldPath !== file.newPath && (
          <span className="hidden max-w-44 truncate font-mono text-[9px] text-muted lg:block" title={file.oldPath}>
            from {file.oldPath}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] text-accent3">+{file.additions}</span>
        <span className="shrink-0 font-mono text-[10px] text-danger">−{file.deletions}</span>
      </button>

      {open && (
        <div className="border-t border-border/70 bg-[var(--color-bg)]">
          {file.patch ? (
            <pre className="max-h-80 overflow-auto py-2 text-[10px] leading-5">
              <code>
                {visibleLines.map((line, index) => (
                  <span key={`${index}-${line.slice(0, 12)}`} className={`block min-h-5 whitespace-pre px-3 font-mono ${diffLineClass(line)}`}>
                    {line || ' '}
                  </span>
                ))}
                {omittedLineCount > 0 && (
                  <span className="block bg-accent2/10 px-3 py-1 font-mono text-accent2">
                    … {omittedLineCount.toLocaleString()} more lines hidden in this browser view …
                  </span>
                )}
              </code>
            </pre>
          ) : (
            <div className="flex items-center gap-2 px-4 py-4 text-[11px] text-muted">
              <FileDiff size={13} className="shrink-0" />
              {file.binary
                ? 'Binary file — no inline text diff is available.'
                : 'This patch is too large or unavailable for inline display.'}
            </div>
          )}
          {file.truncated && (
            <div className="border-t border-accent2/20 bg-accent2/5 px-3 py-2 text-[10px] text-accent2">
              This file diff was shortened to keep the page responsive.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommitDiffRow({
  projectId,
  commit,
  showRepository = false,
  comfortable = false,
}: CommitDiffRowProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<CommitDiffResponse | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadDiff = async () => {
    if (!commit.sha || loading) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Sign in again to view this commit diff.');

      let endpoint: string;
      if (commit.source === 'github') {
        const [owner, repo, ...extra] = commit.repo.split('/');
        if (!owner || !repo || extra.length > 0) throw new Error('The linked GitHub repository path is invalid.');
        endpoint = `/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit-diff`;
      } else {
        endpoint = '/api/gitlab/commit-diff';
      }

      const query = new URLSearchParams({ projectId, sha: commit.sha });
      if (commit.source === 'gitlab') query.set('repo', commit.repo);
      const response = await fetch(`${endpoint}?${query.toString()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null) as (CommitDiffResponse & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error || `Unable to load this diff (${response.status}).`);
      if (!body?.files || !body.stats) throw new Error('The repository returned an invalid diff response.');
      setDiff(body);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this commit diff.');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };

  const toggle = () => {
    if (!commit.sha) return;
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !diff && !loading) void loadDiff();
  };

  const date = formatCommitDate(commit.date);
  const shortSha = commit.sha?.slice(0, 7);

  return (
    <div className="border-b border-border/70 last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        disabled={!commit.sha}
        className={`flex w-full items-start gap-3 text-left transition-colors hover:bg-surface2/60 disabled:cursor-default ${comfortable ? 'px-4 py-3.5' : 'px-6 py-3'}`}
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/80 bg-surface2 text-muted">
          <GitCommitHorizontal size={12} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-heading" title={commit.message}>{commit.message}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted">
            {commit.author && <span>{commit.author}</span>}
            {date && <span>{date}</span>}
            {showRepository && (
              <span className="max-w-60 truncate font-mono">
                <span className="uppercase text-[9px] tracking-wider text-accent">{commit.source}</span> · {commit.repo}
              </span>
            )}
            {shortSha && <span className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-[9px] text-muted">{shortSha}</span>}
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
          {loading && open ? <Loader2 size={11} className="animate-spin" /> : <FileDiff size={11} />}
          <span className="hidden sm:inline">{commit.sha ? (open ? 'Hide diff' : 'View diff') : 'Diff unavailable'}</span>
          {commit.sha && <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/70 bg-surface2/25 px-4 py-4 sm:px-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading commit diff…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-xs text-danger" role="alert">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void loadDiff()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-danger/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider hover:bg-danger/10"
              >
                <RotateCcw size={10} /> Retry
              </button>
            </div>
          )}

          {!loading && !error && diff && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
                  <span className="text-heading">{diff.stats.files} changed {diff.stats.files === 1 ? 'file' : 'files'}</span>
                  <span className="text-accent3">+{diff.stats.additions.toLocaleString()}</span>
                  <span className="text-danger">−{diff.stats.deletions.toLocaleString()}</span>
                </div>
                {diff.truncated && <span className="text-[10px] text-accent2">Large diff · partial inline view</span>}
              </div>

              {diff.files.length > 0 ? (
                <div className="space-y-2">
                  {diff.files.map((file, index) => (
                    <DiffFileBlock
                      key={`${file.oldPath}:${file.newPath}:${index}`}
                      file={file}
                      initiallyOpen={index === 0}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-border/70 bg-surface px-4 py-6 text-center text-xs text-muted">
                  This commit does not contain any file changes.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
