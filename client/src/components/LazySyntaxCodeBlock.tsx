import { useEffect, useState, type CSSProperties, type ComponentType, type ReactNode } from 'react';

type ThemeStyle = Record<string, CSSProperties>;

interface LazySyntaxCodeBlockProps {
  language?: string;
  children: string;
  style?: ThemeStyle;
  customStyle?: CSSProperties;
  lineNumberStyle?: CSSProperties;
  showLineNumbers?: boolean;
  wrapLongLines?: boolean;
  useInlineStyles?: boolean;
  className?: string;
  fallbackClassName?: string;
  fallback?: ReactNode;
}

let syntaxAssetsPromise: Promise<[typeof import('react-syntax-highlighter/dist/esm/prism-async-light'), typeof import('react-syntax-highlighter/dist/esm/styles/prism')]> | null = null;

function loadSyntaxAssets() {
  if (!syntaxAssetsPromise) {
    syntaxAssetsPromise = Promise.all([
      import('react-syntax-highlighter/dist/esm/prism-async-light'),
      import('react-syntax-highlighter/dist/esm/styles/prism'),
    ]);
  }
  return syntaxAssetsPromise;
}

export default function LazySyntaxCodeBlock({
  language = 'text',
  children,
  style,
  customStyle,
  lineNumberStyle,
  showLineNumbers = false,
  wrapLongLines = false,
  useInlineStyles = true,
  className,
  fallbackClassName,
  fallback,
}: LazySyntaxCodeBlockProps) {
  const [SyntaxHighlighter, setSyntaxHighlighter] = useState<ComponentType<any> | null>(null);
  const [defaultStyle, setDefaultStyle] = useState<ThemeStyle | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    loadSyntaxAssets()
      .then(([syntaxModule, themeModule]) => {
        if (cancelled) return;
        setSyntaxHighlighter(() => syntaxModule.default as ComponentType<any>);
        setDefaultStyle(themeModule.oneDark);
      })
      .catch(() => {
        if (!cancelled) {
          setSyntaxHighlighter(null);
          setDefaultStyle(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const ResolvedSyntaxHighlighter = SyntaxHighlighter;

  if (!ResolvedSyntaxHighlighter) {
    return fallback ?? (
      <pre
        className={fallbackClassName ?? className}
        style={{
          margin: 0,
          overflow: 'auto',
          whiteSpace: wrapLongLines ? 'pre-wrap' : 'pre',
          ...customStyle,
        }}
      >
        <code>{children}</code>
      </pre>
    );
  }

  return (
    <ResolvedSyntaxHighlighter
      language={language}
      style={style ?? defaultStyle}
      customStyle={customStyle}
      lineNumberStyle={lineNumberStyle}
      showLineNumbers={showLineNumbers}
      wrapLongLines={wrapLongLines}
      useInlineStyles={useInlineStyles}
      className={className}
    >
      {children}
    </ResolvedSyntaxHighlighter>
  );
}
