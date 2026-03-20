/// <reference types="vite/client" />

declare module 'world-atlas/countries-110m.json' {
  const data: import('topojson-specification').Topology;
  export default data;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
