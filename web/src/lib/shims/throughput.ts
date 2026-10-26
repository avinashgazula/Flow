/* JASSUB's debug overlay counts frames with this CommonJS package. Flow never turns the overlay on, so the
   counter is a stand-in; the real one would pull a module-wrapper helper into the first load. See vite.config.ts. */
export default function throughput(): (delta?: number) => number {
  return () => 0
}
