/* Reads the language-neutral contract vectors in `testdata/contracts` (see the README there). The Swift side reads the
   same files in Packages/FlowKit/Tests/FlowKitTests/ContractTests.swift, so a rule changed on one side and not the
   other fails a test on whichever side is behind. */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = fileURLToPath(new URL('../../../testdata/contracts/', import.meta.url))

export interface Case {
  name: string
  op?: string
  // Vectors are plain JSON: each area's runner knows the shape of its own inputs.
  input: any
  expected: any
}

interface Manifest {
  areas: Record<string, { swift: boolean; web: boolean }>
}

export const manifest = (): Manifest => JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as Manifest

export const vectorFiles = () => readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json')

export function loadCases(area: string): Case[] {
  const file = JSON.parse(readFileSync(`${dir}${area}.json`, 'utf8')) as { area: string; cases: Case[] }
  if (file.area !== area) throw new Error(`${area}.json says it is "${file.area}"`)
  return file.cases
}

/** What a runner returned, as JSON would carry it (undefined fields gone), so it compares with `expected`. */
const plain = (value: unknown): unknown => (value === undefined ? null : JSON.parse(JSON.stringify(value)))

/** Runs every case of an area through `run` and compares with `expected`. The area must be in the manifest for the web. */
export function contract(area: string, run: (c: Case) => unknown | Promise<unknown>) {
  describe(`contract ${area}`, () => {
    const entry = manifest().areas[area]
    it('is listed in the manifest for the website', () => {
      expect(entry?.web, `${area} must be listed with "web": true in testdata/contracts/manifest.json`).toBe(true)
    })
    const cases = loadCases(area)
    it('has cases with distinct names', () => {
      expect(cases.length).toBeGreaterThan(0)
      expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length)
    })
    for (const c of cases) {
      it(c.name, async () => {
        expect(plain(await run(c))).toEqual(c.expected)
      })
    }
  })
}
