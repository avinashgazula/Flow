import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cssPalette } from '../../contracts/themeTokens'
import { defaultPalette, paletteIds, resolvePalette } from '../../lib/palette'
import { defaultSettings } from '../../lib/store/settings'
import { exportSetup, settingsFromSetup, setupFormat, setupVersion, type SetupBundle } from '../../lib/setup/codec'
import { backupFormat, parseBackup } from './backup'
import { palettes } from './options'

const web = new URL('../../../', import.meta.url).pathname
const html = readFileSync(`${web}index.html`, 'utf8')
const tokens = readFileSync(`${web}src/styles/tokens.css`, 'utf8')
const file = JSON.parse(readFileSync(`${web}../testdata/contracts/themes.json`, 'utf8')) as { cases: { op: string; input: { theme: string; side: string }; expected: Record<string, string> }[] }
const sides = file.cases.filter((c) => c.op === 'palette')

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
/** WCAG contrast ratio of two #rrggbb colours. */
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Every text or mark and the paper it sits on, with the least WCAG AA allows (4.5 for text, 3 for large text and the parts
 *  of controls). The same list is FlowKit's `ThemePalette.requiredPairs`. */
const pairs: [string, string, number][] = [
  ['fg', 'bg', 4.5], ['fg', 'tint1', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'tint1', 4.5], ['muted', 'tint2', 4.5],
  ['faint', 'bg', 4.5], ['faint', 'tint1', 4.5],
  ['mark', 'bg', 4.5], ['mark', 'tint1', 4.5], ['mark', 'tint2', 3],
  ['spot', 'bg', 4.5], ['spot', 'tint1', 4.5], ['spot', 'tint2', 3],
  ['onSpot', 'spot', 4.5], ['onSpot', 'spotPressed', 4.5],
  ['warn', 'bg', 4.5],
  ['spotPressed', 'bg', 3],
  ['bg', 'mark', 4.5],
]

describe('Colour themes', () => {
  it('are three, Admit One first and the default', () => {
    expect(palettes.map((p) => p.value)).toEqual(['admitOne', 'index', 'openingNight'])
    expect([...paletteIds]).toEqual(palettes.map((p) => p.value))
    expect(defaultPalette).toBe('admitOne')
    expect(defaultSettings.palette).toBe('admitOne')
    expect(sides).toHaveLength(6)
  })

  it('meet WCAG AA for every pair the design uses, on both sides', () => {
    for (const c of sides) {
      for (const [fg, bg, min] of pairs) {
        const ratio = contrast(c.expected[fg]!, c.expected[bg]!)
        expect(ratio, `${c.input.theme} ${c.input.side}: ${fg} on ${bg} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min)
      }
    }
  })

  it('give the stylesheet the shared file’s colours (the contract test checks the same, case by case)', () => {
    for (const c of sides) expect(cssPalette(c.input.theme, c.input.side)).toEqual(c.expected)
  })

  it('repeat each theme’s paper and ink in index.html, which paints the first frame before the stylesheet arrives', () => {
    for (const c of sides) {
      const { theme, side } = c.input
      const selector = `html${theme === 'admitOne' ? '' : `[data-palette='${theme}']`}${side === 'dark' ? "[data-theme='dark']" : ''}`
      expect(html, `${theme} ${side}`).toContain(`${selector} { background: ${c.expected.bg}; color: ${c.expected.fg}; }`)
    }
    // The address bar's colour, set by the pre-paint script, is the same paper.
    for (const theme of ['admitOne', 'index', 'openingNight']) {
      const [light, dark] = ['light', 'dark'].map((side) => sides.find((c) => c.input.theme === theme && c.input.side === side)!.expected.bg)
      expect(html).toContain(`${theme}: ['${light}', '${dark}']`)
    }
    expect(html).toContain('<meta name="theme-color" content="#f4f1ea"')
  })

  it('have a rule in the stylesheet for every theme the page script can set', () => {
    for (const id of paletteIds) {
      expect(tokens).toContain(id === 'admitOne' ? ':root,\n[data-theme=\'light\']' : `:root[data-palette='${id}']`)
      expect(html, id).toContain(id === 'admitOne' ? 'admitOne' : `'${id}'`)
    }
  })

  it('read a saved value as the theme it stands for, else Admit One', () => {
    expect(resolvePalette('index')).toBe('index')
    expect(resolvePalette('openingNight')).toBe('openingNight')
    expect(resolvePalette('matinee')).toBe('admitOne')
    expect(resolvePalette(undefined)).toBe('admitOne')
  })

  it('come back from a backup only when the name is known', () => {
    const read = (palette: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { palette, autoplayNext: false } }))
    expect(read('openingNight')).toMatchObject({ ok: true, settings: { palette: 'openingNight', autoplayNext: false }, skipped: [] })
    expect(read('matinee')).toMatchObject({ ok: true, settings: { autoplayNext: false }, skipped: ['palette'] })
  })

  it('travel in a setup file as the apps’ general.theme', () => {
    const out = exportSetup({ ...defaultSettings, palette: 'openingNight' }, { includeSecrets: false }).settings as { general: { theme?: string } }
    expect(out.general.theme).toBe('openingNight')
    const bundle = (theme: unknown): SetupBundle => ({ format: setupFormat, version: setupVersion, exportedAt: '2026-01-01T00:00:00Z', settings: { general: { theme } } })
    expect(settingsFromSetup(bundle('index'), defaultSettings).palette).toBe('index')
    // A theme from a newer build reads as the default, as the apps read it, and the rest of the file still comes in.
    expect(settingsFromSetup(bundle('matinee'), defaultSettings).palette).toBe('admitOne')
    // An older file with no theme leaves the website's own alone.
    expect(settingsFromSetup({ ...bundle('x'), settings: { general: { accent: 'teal' } } }, { ...defaultSettings, palette: 'index' }).palette).toBeUndefined()
  })
})
