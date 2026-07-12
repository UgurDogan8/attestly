import { defineConfig } from 'vite';

/**
 * The one Vite build in this repo (docs/07 §5, README "Hard rules") —
 * everything else is UI Kit, bundled directly by the Forge CLI with no
 * build step. This surface exists only because UI Kit cannot trigger a
 * browser download; keeping it a small, framework-free bundle (see
 * src/main.ts — no React, `@forge/react` is UI-Kit-only anyway) keeps that
 * exception as narrow as possible.
 */
export default defineConfig({
  build: {
    outDir: 'build',
    emptyOutDir: true,
  },
});
