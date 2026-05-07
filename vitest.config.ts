import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Vitest config for the renderer-side parser / serializer / schema. We
// run these tests in jsdom so DOM-touching code (KaTeX node views, the
// link mark's `toDOM`) works without spinning up Electron.
//
// The main process and preload aren't exercised here — they're thin
// IPC wrappers around the renderer logic. If we ever add main-side
// pure helpers (engine-detect parsing, log-parser), point a second
// project here at them with a `node` environment.

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    // unified-latex packages and prosemirror are ESM; vitest handles them
    // natively. No special inline config needed.
    globals: false
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  }
})
