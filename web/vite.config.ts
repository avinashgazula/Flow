import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { pwa } from './scripts/pwa.ts'
import { fileURLToPath } from 'node:url'

// FLOW_BASE is the path the site is served from: "/" locally, "/Flow/" on GitHub Pages.
export default defineConfig({
  base: process.env.FLOW_BASE ?? '/',
  plugins: [
    // Every route becomes its own chunk, loaded on intent (hover, focus, touch) before the click lands.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    // The React Compiler memoises components and hooks, so scrolling shelves never re-renders the page.
    babel({ presets: [reactCompilerPreset()] }),
    // The service worker and the address-bar search descriptor, written after the site is built.
    pwa(),
  ],
  resolve: {
    // JASSUB (ASS subtitles, loaded only when needed) imports two CommonJS packages it doesn't need here; standing in
    // for them keeps the module-wrapper helper they require out of the first load (see src/lib/shims).
    alias: {
      'rvfc-polyfill': fileURLToPath(new URL('./src/lib/shims/rvfc-polyfill.ts', import.meta.url)),
      throughput: fileURLToPath(new URL('./src/lib/shims/throughput.ts', import.meta.url)),
    },
  },
  // Pre-bundling would break the worker and wasm addresses JASSUB builds from its own location.
  optimizeDeps: { exclude: ['jassub'] },
  define: {
    // Shown in error details, so a report says which build it came from.
    'import.meta.env.VITE_BUILD': JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'),
    // Where Settings links the stream proxy's instructions: this repository's web/proxy folder, as CI
    // builds it. Empty on a local build, where Settings just names the folder.
    'import.meta.env.VITE_PROXY_GUIDE': JSON.stringify(
      process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/tree/${process.env.GITHUB_REF_NAME ?? 'main'}/web/proxy` : '',
    ),
  },
  build: {
    target: 'es2022',
    // Published maps let the browser's developer tools show real names in a stack trace. The source
    // is public anyway, and maps load only when the tools are open.
    sourcemap: true,
    cssMinify: true,
    reportCompressedSize: true,
  },
  worker: { format: 'es' },
  server: { port: 5173 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'proxy/**/*.test.js'] },
})
