/* JASSUB imports this to add requestVideoFrameCallback to old browsers. Flow only starts JASSUB where the browser
   has it (features/player/ass.ts checks), so the polyfill, a CommonJS file that would pull a module-wrapper helper
   into the first load, is left out. See vite.config.ts. */
export {}
