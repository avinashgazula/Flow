// Reads the v8 coverage summary vitest wrote (coverage/coverage-summary.json), prints line coverage for each folder of
// src/lib and src/features, and fails when a folder is under its floor in coverage-floors.json. A folder with no floor
// listed fails too, so a new folder has to be given one. Floors are what the tests reach, rounded down; raise them when
// the tests do. `node scripts/coverage-floors.mjs --write` prints a floors file from the current run.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const summary = JSON.parse(readFileSync(join(root, 'coverage', 'coverage-summary.json'), 'utf8'))
const writing = process.argv.includes('--write')
const floors = writing ? {} : JSON.parse(readFileSync(join(root, 'coverage-floors.json'), 'utf8'))

const folders = new Map()
for (const [file, data] of Object.entries(summary)) {
  if (file === 'total') continue
  const parts = relative(root, file).split('/')
  // src/lib/<folder>/… or src/features/<folder>/…; files directly in src/lib or src/features count as "(files)".
  const [, area, next] = parts
  const key = `${area}/${parts.length > 3 ? next : '(files)'}`
  const entry = folders.get(key) ?? { lines: 0, covered: 0, files: 0 }
  entry.lines += data.lines.total
  entry.covered += data.lines.covered
  entry.files++
  folders.set(key, entry)
}

const rows = [...folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, e]) => ({ key, pct: e.lines ? (100 * e.covered) / e.lines : 100, lines: e.lines, files: e.files }))
if (writing) {
  console.log(JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, Math.floor(r.pct)])), null, 2))
  process.exit(0)
}

let failed = false
const out = ['| Folder | Files | Lines | Covered | Floor |', '| --- | ---: | ---: | ---: | ---: |']
for (const r of rows) {
  const floor = floors[r.key]
  const bad = floor === undefined || r.pct < floor
  failed ||= bad
  out.push(`| ${r.key} | ${r.files} | ${r.lines} | ${r.pct.toFixed(1)}%${bad ? ' ✗' : ''} | ${floor === undefined ? 'none set' : `${floor}%`} |`)
}
const text = out.join('\n')
console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Unit test coverage\n\n${text}\n`)
if (failed) {
  console.error('\nA folder is under its coverage floor (or has none). Add tests, or if the code is not logic, say why in coverage-floors.json.')
  process.exit(1)
}
