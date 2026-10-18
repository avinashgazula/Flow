import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../lib/store/settings'
import { parseBackup, backupFormat } from './backup'
import { typefaces } from './options'

const web = new URL('../../../', import.meta.url).pathname
const html = readFileSync(`${web}index.html`, 'utf8')
const tokens = readFileSync(`${web}src/styles/tokens.css`, 'utf8')

describe('Typefaces', () => {
  it('start on System, which downloads nothing', () => {
    expect(defaultSettings.font).toBe('system')
  })

  it('each have a rule in tokens.css', () => {
    for (const f of typefaces) expect(tokens, f.value).toContain(`[data-font='${f.value}']`)
  })

  it('each web font is preloaded by index.html, and the file exists', () => {
    const script = html.slice(html.indexOf('var files = {'), html.indexOf('}', html.indexOf('var files = {')))
    const preloaded = [...script.matchAll(/(\w+): '([\w-]+)'/g)].map((m) => ({ id: m[1], file: m[2] }))
    expect(preloaded.map((p) => p.id).sort()).toEqual(typefaces.filter((f) => f.value !== 'system').map((f) => f.value).sort())
    for (const p of preloaded) expect(existsSync(`${web}public/fonts/${p.file}.woff2`), p.file).toBe(true)
  })

  it('ship with a licence beside the files', () => {
    for (const name of ['Inter', 'Geist', 'Manrope', 'Ioskeley-Mono']) expect(existsSync(`${web}public/fonts/OFL-${name}.txt`), name).toBe(true)
  })

  it('come back from a backup only when the name is known', () => {
    const read = (font: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { font, autoplayNext: false } }))
    expect(read('geist')).toMatchObject({ ok: true, settings: { font: 'geist', autoplayNext: false }, skipped: [] })
    expect(read('comic-sans')).toMatchObject({ ok: true, settings: { autoplayNext: false }, skipped: ['font'] })
  })
})
