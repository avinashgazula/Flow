import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// FLOW_BASE is the path the site is served from: "/" locally, "/Flow/" on GitHub Pages.
export default defineConfig({
  base: process.env.FLOW_BASE ?? '/',
  plugins: [
    // Every route becomes its own chunk, loaded on intent (hover, focus, touch) before the click lands.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    // The React Compiler memoises components and hooks, so scrolling shelves never re-renders the page.
    babel({ presets: [reactCompilerPreset()] }),
  ],
  define: {
    // Shown in error details, so a report says which build it came from.
    'import.meta.env.VITE_BUILD': JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'),
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
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
