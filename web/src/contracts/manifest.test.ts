import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { manifest, vectorFiles } from './support'

/** The areas the contract tests in this folder run, read from their source: each calls `contract('<area>', …)`. */
const ranAreas = () => {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const names = readdirSync(here).filter((f) => f.endsWith('.test.ts') && f !== 'manifest.test.ts')
  return names.flatMap((f) => [...readFileSync(here + f, 'utf8').matchAll(/^contract\('([a-z0-9-]+)'/gm)].map((m) => m[1]!))
}

describe('contract manifest', () => {
  const web = Object.entries(manifest().areas).filter(([, who]) => who.web).map(([area]) => area)

  it('has a vector file for every listed area and lists every vector file', () => {
    expect(vectorFiles().map((f) => f.replace(/\.json$/, '')).sort()).toEqual(Object.keys(manifest().areas).sort())
  })

  it('has a website reader for every area marked for the website, and no other', () => {
    expect(ranAreas().sort()).toEqual([...web].sort())
  })
})
