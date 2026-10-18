import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/* React calls whatever an effect returns as its cleanup. An effect written as `() => call()` returns
   the call's result, and browser APIs change what they return: Chrome made `window.scrollTo`
   return a Promise, so `useEffect(() => window.scrollTo(0, 0))` crashed every page it left with
   "is not a function". Effects either return nothing or return a cleanup function, spelled out. */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'pkg' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

describe('Effects', () => {
  it('never return the result of an expression', () => {
    const offenders: string[] = []
    for (const file of sources(new URL('.', import.meta.url).pathname)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // `() => () => cleanup()` is fine: that's a cleanup function. `() => something()` isn't.
          if (/use(Layout|Insertion)?Effect\(\s*\(\)\s*=>\s*[^\s{(]/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })
})
