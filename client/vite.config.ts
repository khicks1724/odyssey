import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiProxyTarget = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('jspdf') || id.includes('pptxgenjs') || id.includes('html2canvas') || id.includes('xlsx') || id.includes('docx')) {
            return 'reporting';
          }
          if (id.includes('world-atlas') || id.includes('topojson-client')) return 'globe';
          if (id.includes('react-markdown') || id.includes('remark-gfm')) return 'markdown';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': apiProxyTarget,
    },
  },
})
