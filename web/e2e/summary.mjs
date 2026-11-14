// Writes the browser-test run into the job summary: totals, and any test that needed its one retry to pass (a flake,
// which is a bug to fix, not a pass to hide). Reads the JSON report Playwright wrote.
import { readFileSync, appendFileSync } from 'node:fs'

const file = process.argv[2] ?? 'test-results/results.json'
const out = process.env.GITHUB_STEP_SUMMARY
let report
try {
  report = JSON.parse(readFileSync(file, 'utf8'))
} catch {
  console.log(`No report at ${file}.`)
  process.exit(0)
}

const flaky = []
const walk = (suite, trail) => {
  const here = suite.title ? [...trail, suite.title] : trail
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) if (test.status === 'flaky') flaky.push(`${test.projectName}: ${[...here, spec.title].join(' › ')}`)
  for (const child of suite.suites ?? []) walk(child, here)
}
for (const suite of report.suites ?? []) walk(suite, [])

const { expected = 0, unexpected = 0, flaky: flakyCount = 0, skipped = 0 } = report.stats ?? {}
const lines = [`**${expected} passed, ${unexpected} failed, ${flakyCount} flaky, ${skipped} skipped**`]
if (flaky.length) lines.push('', 'Flaky (passed only on the retry; fix these):', ...flaky.map((f) => `- ${f}`))
const text = lines.join('\n')
console.log(text)
if (out) appendFileSync(out, `${text}\n`)
