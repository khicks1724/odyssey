import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileRef } from '../hooks/useProjectFilePaths';
import { replaceTaskIdsWithTitles } from '../lib/task-refs';

export interface TaskRef { id: string; title: string }

interface MarkdownWithFileLinksProps {
  children: string;
  filePaths: Map<string, FileRef>;
  onFileClick: (ref: FileRef) => void;
  githubRepo?: string | string[] | null;
  gitlabRepos?: string[];
  onRepoClick?: (repo: string, type: 'github' | 'gitlab') => void;
  tasks?: TaskRef[];
  onTaskClick?: (taskId: string) => void;
  className?: string;
  /** Render as block-level elements (div root, proper p/ul/li/h* tags). Use for chat bubbles. */
  block?: boolean;
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
  const filePathRe = new RegExp(FILE_PATH_RE.source, 'g');

  while ((match = filePathRe.exec(text)) !== null) {
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
  block = false,
  extraComponents = {},
}: MarkdownWithFileLinksProps) {
  const refs = useMemo(() => {
    const unique = new Map<string, FileRef>();
    for (const ref of filePaths.values()) unique.set(`${ref.type}:${ref.repo}:${ref.path}`, ref);
    return Array.from(unique.values());
  }, [filePaths]);

  const githubRepos = useMemo(() => {
    if (Array.isArray(githubRepo)) return githubRepo.filter(Boolean);
    return githubRepo ? [githubRepo] : [];
  }, [githubRepo]);

  const sanitizedChildren = useMemo(
    () => replaceTaskIdsWithTitles(children, tasks),
    [children, tasks],
  );

  const taskMap = useMemo(() => {
    const m = new Map<string, string>();
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

    if (onRepoClick) {
      for (const ghRepo of githubRepos) {
        if (text === ghRepo || text === ghRepo.split('/').pop()) {
          return (
            <button
              type="button"
              onClick={() => onRepoClick(ghRepo, 'github')}
              title={`Browse ${ghRepo}`}
              className="font-mono text-[0.85em] bg-[var(--color-code-repo-bg)] text-[var(--color-code-repo)] px-1 py-0.5 rounded border border-[var(--color-code-repo-border)] hover:bg-[var(--color-code-repo-border)] cursor-pointer transition-colors underline-offset-2 hover:underline"
            >
              {text}
            </button>
          );
        }
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

  function extractText(node: React.ReactNode): string {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (node && typeof node === 'object' && 'props' in (node as any)) {
      return extractText((node as any).props?.children);
    }
    return '';
  }

  const repoButtonCls = 'font-mono text-[0.85em] bg-[var(--color-code-repo-bg)] text-[var(--color-code-repo)] px-1 py-0.5 rounded border border-[var(--color-code-repo-border)] hover:bg-[var(--color-code-repo-border)] cursor-pointer transition-colors underline-offset-2 hover:underline';
  const isInternalHref = (href: string | undefined) => Boolean(href && (/^(\/(?!\/)|#)/.test(href) || href.startsWith(window.location.origin)));

  const strongRenderer = ({ children: c }: { children?: React.ReactNode }) => {
    if (onRepoClick) {
      const text = extractText(c).trim();
      if (text) {
        for (const ghRepo of githubRepos) {
          if (text === ghRepo || text === ghRepo.split('/').pop()) {
            return <button type="button" onClick={() => onRepoClick(ghRepo, 'github')} title={`Browse ${ghRepo}`} className={repoButtonCls}>{c}</button>;
          }
        }
        for (const glRepo of gitlabRepos) {
          if (text === glRepo || text === glRepo.split('/').pop()) {
            return <button type="button" onClick={() => onRepoClick(glRepo, 'gitlab')} title={`Browse ${glRepo}`} className={repoButtonCls}>{c}</button>;
          }
        }
      }
    }
    return <strong className="font-semibold text-[var(--color-heading)]">{c}</strong>;
  };

  const Root = block ? 'div' : 'span';

  // Shared block-level components — used by all AI response surfaces
  const blockComponents = block ? {
    p:          ({ children: c }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0 leading-relaxed">{c}</p>,
    ul:         ({ children: c }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 my-2 space-y-1 leading-relaxed">{c}</ul>,
    ol:         ({ children: c }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 my-2 space-y-1 leading-relaxed">{c}</ol>,
    li:         ({ children: c }: { children?: React.ReactNode }) => <li className="leading-snug">{c}</li>,
    h1:         ({ children: c }: { children?: React.ReactNode }) => <h1 className="text-sm font-bold text-[var(--color-heading)] mt-4 mb-1.5 first:mt-0 border-b border-[var(--color-border)] pb-1">{c}</h1>,
    h2:         ({ children: c }: { children?: React.ReactNode }) => <h2 className="text-xs font-bold text-[var(--color-heading)] mt-3 mb-1 first:mt-0">{c}</h2>,
    h3:         ({ children: c }: { children?: React.ReactNode }) => <h3 className="text-xs font-semibold text-[var(--color-heading)] mt-2.5 mb-0.5 first:mt-0">{c}</h3>,
    blockquote: ({ children: c }: { children?: React.ReactNode }) => <blockquote className="border-l-2 border-[var(--color-accent)]/40 pl-3 my-2 text-[var(--color-muted)] italic">{c}</blockquote>,
    hr:         () => <hr className="my-3 border-[var(--color-border)]" />,
    pre:        ({ children: c }: { children?: React.ReactNode }) => <pre className="my-2 overflow-x-auto max-w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-2 text-[0.85em]">{c}</pre>,
    table:      ({ children: c }: { children?: React.ReactNode }) => <div className="my-2 overflow-x-auto"><table className="text-[0.85em] border-collapse w-full">{c}</table></div>,
    th:         ({ children: c }: { children?: React.ReactNode }) => <th className="border border-[var(--color-border)] px-2 py-1 text-left font-semibold bg-[var(--color-surface2)]">{c}</th>,
    td:         ({ children: c }: { children?: React.ReactNode }) => <td className="border border-[var(--color-border)] px-2 py-1">{c}</td>,
  } : {
    p: ({ children: c }: { children?: React.ReactNode }) => <span>{c} </span>,
  };

  return (
    <Root className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...blockComponents,
          strong: strongRenderer,
          em: ({ children: c }) => <em className="italic text-[var(--color-muted)]">{c}</em>,
          code: codeRenderer,
          text: textRenderer,
          a: ({ href, children: c }) => (
            isInternalHref(href)
              ? (
                <a href={href} className="text-[var(--color-accent2)] underline underline-offset-2 hover:opacity-80 transition-opacity">
                  {c}
                </a>
              )
              : (
                <a href={href} className="text-[var(--color-accent2)] underline underline-offset-2 hover:opacity-80 transition-opacity" target="_blank" rel="noreferrer">
                  {c}
                </a>
              )
          ),
          ...extraComponents,
        }}
      >
        {sanitizedChildren}
      </ReactMarkdown>
    </Root>
  );
}
