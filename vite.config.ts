import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// `VITE_BASE` lets the same build be served from a sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // The optional API server (LLM gateway, RAG, token-protected NASA sources) runs on 8787.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 20000,
  },
});
