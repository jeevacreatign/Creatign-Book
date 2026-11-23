import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'client',
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss({ config: path.join(here, 'tailwind.config.js') }), autoprefixer()] } },
  resolve: { alias: { '@shared': path.join(here, 'shared') } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/uploads': 'http://localhost:4000' },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
