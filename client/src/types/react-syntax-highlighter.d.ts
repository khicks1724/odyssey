declare module 'react-syntax-highlighter/dist/esm/prism-async-light' {
  import type { ComponentType } from 'react';

  const SyntaxHighlighter: ComponentType<any>;
  export default SyntaxHighlighter;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const oneDark: Record<string, import('react').CSSProperties>;
}
