import { describe, expect, it } from 'vitest'
import { defaultSubtitleStyle, isDefaultSubtitleStyle, normaliseSubtitleStyle, subtitleBackgrounds, subtitleColors, subtitleEdges, subtitleFonts, subtitleWeights, type SubtitleStyle } from '../../lib/store/subtitleStyle'
import { subtitleCSS } from './subtitleStyle'

const style = (patch: Partial<SubtitleStyle>): SubtitleStyle => ({ ...defaultSubtitleStyle, ...patch })

describe('subtitleCSS', () => {
  it('keeps the look subtitles had before there were options', () => {
    const css = subtitleCSS(defaultSubtitleStyle)
    expect(css.fontFamily).toBe('var(--font)')
    expect(css.fontWeight).toBe(600)
    expect(css.color).toBe('#fff')
    expect(css.textShadow).toBe('0 1px 2px rgb(0 0 0 / 0.95), 0 0 6px rgb(0 0 0 / 0.55), 0 2px 14px rgb(0 0 0 / 0.35)')
    expect(css['--sub-scale']).toBe(1)
    expect(css['--sub-lift']).toBe(0)
    expect(css['--sub-box']).toBe('transparent')
    expect(css['--sub-pad']).toBe('0')
    expect(css.fontStretch).toBeUndefined()
  })

  it('has a font stack for every font, and only condensed narrows the letters', () => {
    const stacks = subtitleFonts.map((f) => subtitleCSS(style({ font: f.value })).fontFamily)
    expect(new Set(stacks).size).toBe(subtitleFonts.length)
    expect(subtitleCSS(style({ font: 'monospaced' })).fontFamily).toContain('monospace')
    expect(subtitleCSS(style({ font: 'serif' })).fontFamily).toContain('serif')
    expect(subtitleCSS(style({ font: 'condensed' })).fontStretch).toBe('75%')
    expect(subtitleCSS(style({ font: 'rounded' })).fontStretch).toBeUndefined()
  })

  it('steps the weight up, and keeps bold runs heavier than the text', () => {
    const w = subtitleWeights.map((x) => subtitleCSS(style({ weight: x.value })))
    expect(w.map((x) => x.fontWeight)).toEqual([400, 500, 600, 700, 800])
    for (const css of w) expect(Number(css['--sub-bold'])).toBeGreaterThan(Number(css.fontWeight))
    expect(w[4]!['--sub-bold']).toBe(900)
    expect(w[0]!['--sub-bold']).toBe(800)
  })

  it('has a colour for each choice', () => {
    const c = subtitleColors.map((x) => subtitleCSS(style({ color: x.value })).color)
    expect(c).toEqual(['#fff', '#ffd60a', '#64d2ff', '#30d158'])
  })

  it('draws each edge differently, and none as no shadow', () => {
    const shadows = subtitleEdges.map((e) => subtitleCSS(style({ edgeStyle: e.value })).textShadow)
    expect(new Set(shadows).size).toBe(subtitleEdges.length)
    expect(subtitleCSS(style({ edgeStyle: 'none' })).textShadow).toBe('none')
    // An outline is eight copies around the text, sized in ems so it follows the font size.
    const outline = subtitleCSS(style({ edgeStyle: 'outline' })).textShadow as string
    expect(outline.split('), ').length).toBe(8)
    expect(outline).toContain('em')
    expect(outline).not.toContain('px')
  })

  it('draws a box behind each line only when asked, at the chosen opacity', () => {
    for (const b of subtitleBackgrounds) {
      const css = subtitleCSS(style({ background: b.value, backgroundOpacity: 0.4 }))
      if (b.value === 'none') {
        expect(css['--sub-box']).toBe('transparent')
        expect(css['--sub-pad']).toBe('0')
      } else {
        expect(css['--sub-box']).toBe('rgb(0 0 0 / 0.4)')
        expect(css['--sub-pad']).not.toBe('0')
      }
    }
    expect(subtitleCSS(style({ background: 'solid', backgroundOpacity: 1 }))['--sub-box']).toBe('rgb(0 0 0 / 1)')
    expect(subtitleCSS(style({ background: 'translucent', backgroundOpacity: 0 }))['--sub-box']).toBe('rgb(0 0 0 / 0)')
  })

  it('passes the size and the lift through for the stylesheet to combine', () => {
    const css = subtitleCSS(style({ fontScale: 1.5, verticalPosition: 0.2 }))
    expect(css['--sub-scale']).toBe(1.5)
    expect(css['--sub-lift']).toBe(0.2)
  })

  it('never produces a style from nonsense', () => {
    const css = subtitleCSS({ fontScale: 99, font: 'wingdings', weight: 7, color: null, edgeStyle: undefined, background: 'glass', backgroundOpacity: -4, verticalPosition: 3 } as never)
    expect(css['--sub-scale']).toBe(2)
    expect(css['--sub-lift']).toBe(0.4)
    expect(css.fontFamily).toBe('var(--font)')
    expect(css.color).toBe('#fff')
    expect(css['--sub-box']).toBe('transparent')
  })
})

describe('normaliseSubtitleStyle', () => {
  it('fills a missing or empty value with the defaults', () => {
    expect(normaliseSubtitleStyle(undefined)).toEqual(defaultSubtitleStyle)
    expect(normaliseSubtitleStyle({})).toEqual(defaultSubtitleStyle)
    expect(normaliseSubtitleStyle('big')).toEqual(defaultSubtitleStyle)
  })

  it('holds numbers to their range and step', () => {
    expect(normaliseSubtitleStyle({ fontScale: 0.1 }).fontScale).toBe(0.6)
    expect(normaliseSubtitleStyle({ fontScale: 9 }).fontScale).toBe(2)
    expect(normaliseSubtitleStyle({ fontScale: 1.17 }).fontScale).toBe(1.15)
    expect(normaliseSubtitleStyle({ backgroundOpacity: 0.1 + 0.2 }).backgroundOpacity).toBe(0.3)
    expect(normaliseSubtitleStyle({ verticalPosition: 0.41 }).verticalPosition).toBe(0.4)
    expect(normaliseSubtitleStyle({ verticalPosition: -1 }).verticalPosition).toBe(0)
    expect(normaliseSubtitleStyle({ fontScale: Number.NaN }).fontScale).toBe(1)
  })

  it('reads the apps’ older shadow background as none', () => {
    expect(normaliseSubtitleStyle({ background: 'shadow' }).background).toBe('none')
  })

  it('keeps valid choices and detects the default', () => {
    const custom = style({ font: 'serif', weight: 'bold', color: 'green', edgeStyle: 'raised', background: 'solid' })
    expect(normaliseSubtitleStyle(custom)).toEqual(custom)
    expect(isDefaultSubtitleStyle(defaultSubtitleStyle)).toBe(true)
    expect(isDefaultSubtitleStyle(custom)).toBe(false)
  })
})
