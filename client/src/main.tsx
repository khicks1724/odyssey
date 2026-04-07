import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { appBasePath, withBasePath } from './lib/base-path'

if (typeof window !== 'undefined' && appBasePath !== '/') {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')) {
      return nativeFetch(withBasePath(input), init);
    }

    return nativeFetch(input, init);
  }) as typeof window.fetch;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
