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

/** Render plain text, turning any file-path tokens into clickable spans */
function TextWithFilePaths({
  text,
  filePaths,
  onFileClick,
}: {
  text: string;
  filePaths: Map<string, FileRef>;
  onFileClick: (ref: FileRef) => void;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  FILE_PATH_RE.lastIndex = 0;

  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    const candidate = match[1];
    // Try full path first, then basename fallback
    const ref = filePaths.get(candidate) ?? filePaths.get(candidate.split('/').pop()!);
    if (!ref) continue;

    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <button
        key={match.index}
        type="button"
        onClick={() => onFileClick(ref)}
        title={`Open ${ref.path} from ${ref.repo}`}
        className="font-mono text-[0.85em] bg-[var(--color-accent)]/10 text-[var(--color-accent)] px-1 py-0.5 rounded border border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/25 cursor-pointer transition-colors underline-offset-2 hover:underline"
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
  // Build a case-insensitive task title lookup once
  const taskMap = useMemo(() => {
    const m = new Map<string, string>(); // lowercase title → id
    for (const t of tasks) m.set(t.title.toLowerCase(), t.id);
    return m;
  }, [tasks]);

  const codeRenderer = ({ children: codeContent }: { children?: React.ReactNode }) => {
    const text = String(codeContent ?? '').trim();

    // Try full path match, then basename fallback
    const ref = filePaths.get(text) ?? filePaths.get(text.split('/').pop()!);
    if (ref) {
      return (
        <button
          type="button"
          onClick={() => onFileClick(ref)}
          title={`Open ${ref.path} from ${ref.repo}`}
          className="font-mono text-[0.85em] bg-[var(--color-accent)]/10 text-[var(--color-accent)] px-1 py-0.5 rounded border border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/25 cursor-pointer transition-colors underline-offset-2 hover:underline"
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
            className="font-mono text-[0.85em] bg-[var(--color-accent3)]/10 text-[var(--color-accent3)] px-1 py-0.5 rounded border border-[var(--color-accent3)]/20 hover:bg-[var(--color-accent3)]/25 cursor-pointer transition-colors underline-offset-2 hover:underline"
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
            className="font-mono text-[0.85em] bg-[var(--color-accent2)]/10 text-[var(--color-accent2)] px-1 py-0.5 rounded border border-[var(--color-accent2)]/20 hover:bg-[var(--color-accent2)]/25 cursor-pointer transition-colors underline-offset-2 hover:underline"
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
              className="font-mono text-[0.85em] bg-[var(--color-accent2)]/10 text-[var(--color-accent2)] px-1 py-0.5 rounded border border-[var(--color-accent2)]/20 hover:bg-[var(--color-accent2)]/25 cursor-pointer transition-colors underline-offset-2 hover:underline"
            >
              {text}
            </button>
          );
        }
      }
    }

    return (
      <code className="font-mono text-[0.85em] bg-[var(--color-accent)]/10 text-[var(--color-accent)] px-1 py-0.5 rounded border border-[var(--color-accent)]/20">
        {codeContent}
      </code>
    );
  };

  const textRenderer = ({ children: textContent }: { children?: React.ReactNode }) => {
    if (typeof textContent !== 'string' || filePaths.size === 0) return <>{textContent}</>;
    return <TextWithFilePaths text={textContent} filePaths={filePaths} onFileClick={onFileClick} />;
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
