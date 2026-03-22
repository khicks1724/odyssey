import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileRef } from '../hooks/useProjectFilePaths';

export interface TaskRef { id: string; title: string }

interface MarkdownWithFileLinksProps {
  children: string;
  filePaths: Map<string, FileRef>;
  onFileClick: (ref: FileRef) => void;
  githubRepo?: string | null;
  gitlabRepos?: string[];
  onRepoClick?: (repo: string, type: 'github' | 'gitlab') => void;
  tasks?: TaskRef[];
  onTaskClick?: (taskId: string) => void;
  className?: string;
  /** Extra ReactMarkdown component overrides merged on top of defaults */
  extraComponents?: Record<string, React.ComponentType<any>>;
}

/** Regex: matches file paths like server/src/foo.ts or just foo.tsx outside backticks */
const FILE_PATH_RE =
  /\b((?:[\w\-]+\/)*[\w\-\.]+\.(?:ts|tsx|py|js|jsx|json|yaml|yml|md|sh|html|css|toml|ini|cfg|rs|go|java|c|cpp|h|rb|php|vue|svelte|kt|swift|sql|txt|env))\b/g;

function normalizePathCandidate(value: string) {
  return value.trim().replace(/^`+|`+$/g, '').replace(/^\.?\//, '').replace(/\\/g, '/');
}

function repoPrefixes(ref: FileRef) {
  const parts = ref.repo.split('/');
  const repoName = parts[parts.length - 1] ?? ref.repo;
  return [ref.repo, repoName];
}

function resolveFileRef(candidateRaw: string, filePaths: Map<string, FileRef>, refs: FileRef[]) {
  const candidate = normalizePathCandidate(candidateRaw);
  if (!candidate) return null;

  const direct = filePaths.get(candidate) ?? filePaths.get(candidate.split('/').pop()!);
  if (direct) return direct;

  const stripped = candidate.replace(/^.*?:\//, '').replace(/^.*?:/, '');
  const normalizedVariants = new Set<string>([candidate, stripped]);

  for (const variant of Array.from(normalizedVariants)) {
    for (const ref of refs) {
      const normalizedPath = normalizePathCandidate(ref.path);
      if (normalizedPath === variant) return ref;
      if (normalizedPath.endsWith(`/${variant}`)) return ref;

      for (const prefix of repoPrefixes(ref)) {
        const withPrefix = `${prefix}/${normalizedPath}`;
        if (variant === withPrefix) return ref;
        if (variant.startsWith(`${prefix}/`) && variant.endsWith(`/${normalizedPath}`)) return ref;
      }
    }
  }

  return null;
}

/** Render plain text, turning any file-path tokens into clickable spans */
function TextWithFilePaths({
  text,
  filePaths,
  refs,
  onFileClick,
}: {
  text: string;
  filePaths: Map<string, FileRef>;
  refs: FileRef[];
  onFileClick: (ref: FileRef) => void;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  FILE_PATH_RE.lastIndex = 0;

  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    const candidate = match[1];
    const ref = resolveFileRef(candidate, filePaths, refs);
    if (!ref) continue;

    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <button
        key={match.index}
        type="button"
        onClick={() => onFileClick(ref)}
        title={`Open ${ref.path} from ${ref.repo}`}
        className="font-mono text-[0.85em] bg-[var(--color-code-file-bg)] text-[var(--color-code-file)] px-1 py-0.5 rounded border border-[var(--color-code-file-border)] hover:bg-[var(--color-code-file-border)] cursor-pointer transition-colors underline-offset-2 hover:underline"
      >
        {candidate}
      </button>,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function MarkdownWithFileLinks({
  children,
  filePaths,
  onFileClick,
  githubRepo,
  gitlabRepos = [],
  onRepoClick,
  tasks = [],
  onTaskClick,
  className,
  extraComponents = {},
}: MarkdownWithFileLinksProps) {
  const refs = useMemo(() => {
    const unique = new Map<string, FileRef>();
    for (const ref of filePaths.values()) unique.set(`${ref.type}:${ref.repo}:${ref.path}`, ref);
    return Array.from(unique.values());
  }, [filePaths]);

  // Build a case-insensitive task title lookup once
  const taskMap = useMemo(() => {
    const m = new Map<string, string>(); // lowercase title → id
    for (const t of tasks) m.set(t.title.toLowerCase(), t.id);
    return m;
  }, [tasks]);

  const codeRenderer = ({ children: codeContent }: { children?: React.ReactNode }) => {
    const text = String(codeContent ?? '').trim();

    const ref = resolveFileRef(text, filePaths, refs);
    if (ref) {
      return (
        <button
          type="button"
          onClick={() => onFileClick(ref)}
          title={`Open ${ref.path} from ${ref.repo}`}
          className="font-mono text-[0.85em] bg-[var(--color-code-file-bg)] text-[var(--color-code-file)] px-1 py-0.5 rounded border border-[var(--color-code-file-border)] hover:bg-[var(--color-code-file-border)] cursor-pointer transition-colors underline-offset-2 hover:underline"
        >
          {text}
        </button>
      );
    }

    // Check if the code text matches a task title
    if (onTaskClick && taskMap.size > 0) {
      const taskId = taskMap.get(text.toLowerCase());
      if (taskId) {
        return (
          <button
            type="button"
            onClick={() => onTaskClick(taskId)}
            title="Open task"
            className="font-mono text-[0.85em] bg-[var(--color-code-task-bg)] text-[var(--color-code-task)] px-1 py-0.5 rounded border border-[var(--color-code-task-border)] hover:bg-[var(--color-code-task-border)] cursor-pointer transition-colors underline-offset-2 hover:underline"
          >
            {text}
          </button>
        );
      }
    }

    // Check if the code text matches a linked repo name
    if (onRepoClick) {
      if (githubRepo && (text === githubRepo || text === githubRepo.split('/').pop())) {
        return (
          <button
            type="button"
            onClick={() => onRepoClick(githubRepo, 'github')}
            title={`Browse ${githubRepo}`}
            className="font-mono text-[0.85em] bg-[var(--color-code-repo-bg)] text-[var(--color-code-repo)] px-1 py-0.5 rounded border border-[var(--color-code-repo-border)] hover:bg-[var(--color-code-repo-border)] cursor-pointer transition-colors underline-offset-2 hover:underline"
          >
            {text}
          </button>
        );
      }
      for (const glRepo of gitlabRepos) {
        if (text === glRepo || text === glRepo.split('/').pop()) {
          return (
            <button
              type="button"
              onClick={() => onRepoClick(glRepo, 'gitlab')}
              title={`Browse ${glRepo}`}
              className="font-mono text-[0.85em] bg-[var(--color-code-repo-bg)] text-[var(--color-code-repo)] px-1 py-0.5 rounded border border-[var(--color-code-repo-border)] hover:bg-[var(--color-code-repo-border)] cursor-pointer transition-colors underline-offset-2 hover:underline"
            >
              {text}
            </button>
          );
        }
      }
    }

    return (
      <code className="font-mono text-[0.85em] bg-[var(--color-code-static-bg)] text-[var(--color-code-static)] px-1 py-0.5 rounded border border-[var(--color-code-static-border)]">
        {codeContent}
      </code>
    );
  };

  const textRenderer = ({ children: textContent }: { children?: React.ReactNode }) => {
    if (typeof textContent !== 'string' || filePaths.size === 0) return <>{textContent}</>;
    return <TextWithFilePaths text={textContent} filePaths={filePaths} refs={refs} onFileClick={onFileClick} />;
  };

  return (
    <span className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: c }) => <span>{c}</span>,
          strong: ({ children: c }) => <strong className="font-semibold text-[var(--color-heading)]">{c}</strong>,
          em: ({ children: c }) => <em className="italic">{c}</em>,
          code: codeRenderer,
          text: textRenderer,
          a: ({ href, children: c }) => (
            <a href={href} className="text-[var(--color-accent2)] underline" target="_blank" rel="noreferrer">
              {c}
            </a>
          ),
          ...extraComponents,
        }}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}
