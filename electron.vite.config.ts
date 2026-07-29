import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Electron 39 ships Node 22 in main and Chromium ~132 in renderer; targeting
// those directly skips the down-leveling Vite would otherwise do for older
// runtimes, shrinking bundles and parse time.
export default defineConfig({
  main: {
    build: {
      sourcemap: false,
      minify: 'esbuild',
      target: 'node22',
      rollupOptions: {
        // Two entries, not one. `log-worker` is loaded by path at runtime
        // through `worker_threads`, so it has to exist as its own file beside
        // the main bundle rather than being inlined into it.
        input: {
          index: resolve('src/main/index.ts'),
          'log-worker': resolve('src/main/latex/log-worker.ts')
        },
        // Heavy Node-only deps stay as runtime requires (lazy-loaded via the
        // dynamic-import accessors in src/main/index.ts) so the cold-parsed
        // main bundle stays small.
        external: [
          'express',
          'cors',
          'electron-store',
          'pdfjs-dist',
          '@modelcontextprotocol/sdk',
          '@unified-latex/unified-latex-util-parse',
          '@unified-latex/unified-latex-util-print-raw',
          '@retorquere/bibtex-parser'
        ]
      }
    }
  },
  preload: {
    build: {
      sourcemap: false,
      minify: 'esbuild',
      target: 'node22'
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      sourcemap: false,
      minify: 'esbuild',
      target: 'chrome130',
      rollupOptions: {
        output: {
          // Heavy renderer libs split off the critical path so first paint
          // doesn't have to parse them.
          manualChunks: {
            codemirror: [
              '@codemirror/state',
              '@codemirror/view',
              '@codemirror/commands',
              '@codemirror/language',
              '@codemirror/autocomplete',
              '@codemirror/lint',
              '@codemirror/search',
              '@codemirror/legacy-modes/mode/stex'
            ],
            prosemirror: [
              'prosemirror-model',
              'prosemirror-state',
              'prosemirror-view',
              'prosemirror-commands',
              'prosemirror-history',
              'prosemirror-keymap',
              'prosemirror-inputrules',
              'prosemirror-schema-basic'
            ],
            katex: ['katex'],
            pdfjs: ['pdfjs-dist']
          }
        }
      }
    },
    plugins: [react()]
  }
})
