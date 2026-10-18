// Fails the build when the code a first visit downloads grows past the budget: the entry script
// and stylesheet index.html loads, gzipped. Route chunks load on demand and aren't counted.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const budgetKB = { js: 125, css: 12 }
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const assets = [...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+\.(js|css))"/g)].map((m) => ({ file: m[1], kind: m[2] }))
const totals = { js: 0, css: 0 }
for (const a of assets) {
  const size = gzipSync(readFileSync(join(dist, a.file)), { level: 9 }).length / 1024
  totals[a.kind] += size
  console.log(`${a.file.padEnd(44)} ${size.toFixed(1).padStart(6)} KB gzipped`)
}
let failed = false
for (const kind of ['js', 'css']) {
  const over = totals[kind] > budgetKB[kind]
  failed ||= over
  console.log(`${kind.toUpperCase()} on first load: ${totals[kind].toFixed(1)} KB of ${budgetKB[kind]} KB${over ? '  ← over budget' : ''}`)
}
if (failed) process.exit(1)
