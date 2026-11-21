import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../lib/store/settings'
import { resolveTypeface, typefaceIds } from '../../lib/typeface'
import { backupFormat, parseBackup } from './backup'
import { typefaces } from './options'

const web = new URL('../../../', import.meta.url).pathname
const html = readFileSync(`${web}index.html`, 'utf8')
const tokens = readFileSync(`${web}src/styles/tokens.css`, 'utf8')
const fontsCss = readFileSync(`${web}src/styles/fonts.css`, 'utf8')

describe('Typefaces', () => {
  it('start on System, which downloads nothing', () => {
    expect(defaultSettings.font).toBe('system')
  })

  it('are the five the picker offers, in step with the lists the page script and the rules use', () => {
    expect(typefaces.map((f) => f.value)).toEqual(['system', 'inter', 'geist', 'manrope', 'mono'])
    expect([...typefaceIds]).toEqual(typefaces.map((f) => f.value))
    for (const f of typefaces) expect(tokens, f.value).toContain(`[data-font='${f.value}']`)
    // index.html names every face but System (the fallback) when it sets data-font before first paint.
    for (const f of typefaces.filter((x) => x.value !== 'system')) expect(html, f.value).toContain(`'${f.value}'`)
  })

  it('each web font has a face declaration, a stand-in and its licence beside the files', () => {
    for (const family of ['Inter', 'Geist', 'Manrope']) {
      expect(fontsCss).toContain(`font-family: "${family} Variable"`)
      expect(fontsCss).toContain(`font-family: "${family} Fallback"`)
      expect(existsSync(`${web}public/fonts/OFL-${family}.txt`), family).toBe(true)
    }
  })

  it('read a saved value as the face it stands for', () => {
    expect(resolveTypeface('geist')).toBe('geist')
    expect(resolveTypeface('mono')).toBe('mono')
    // An older build saved Ioskeley Mono under this name.
    expect(resolveTypeface('ioskeley')).toBe('mono')
    expect(resolveTypeface('comic-sans')).toBe('system')
    expect(resolveTypeface(undefined)).toBe('system')
  })

  it('come back from a backup only when the name is known, with Ioskeley as Mono', () => {
    const read = (font: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { font, autoplayNext: false } }))
    expect(read('geist')).toMatchObject({ ok: true, settings: { font: 'geist', autoplayNext: false }, skipped: [] })
    expect(read('ioskeley')).toMatchObject({ ok: true, settings: { font: 'mono' }, skipped: [] })
    expect(read('comic-sans')).toMatchObject({ ok: true, settings: { autoplayNext: false }, skipped: ['font'] })
  })
})
