import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Multi-page build: one input per manifest resource entry (tech design §2).
 * Entry HTML files must sit at the resource-path ROOT as full <html>
 * documents — Forge deploy validation rejects anything else (spike M0-7).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    rollupOptions: {
      input: {
        macro: resolve(__dirname, 'macro.html'),
        byline: resolve(__dirname, 'byline.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        settings: resolve(__dirname, 'settings.html'),
        config: resolve(__dirname, 'config.html'),
      },
    },
  },
});
