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
  build: {
    target: 'es2022',
    cssMinify: true,
    reportCompressedSize: true,
  },
  worker: { format: 'es' },
  server: { port: 5173 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
