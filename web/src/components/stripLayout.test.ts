import { describe, expect, it } from 'vitest'
import { composeStrip, estimateWidth, rank, toFacts, perfsWidth, gapAfterPerfs, type Fact } from './stripLayout'

const fact = (text: string, r: number, over: Partial<Fact> = {}): Fact => ({ text, rank: r, ...over })

/** A resume strip: S3 E7 · 18 MIN LEFT · ENDS 11:40 AM · 2160P · DV · WEB-DL, as the home screen builds it. */
const resume: Fact[] = [
  fact('S3 E7', rank.episode),
  fact('18m left', rank.left, { key: true }),
  fact('ends 11:40 AM', rank.ends),
  fact('2160p', rank.format),
  fact('DV', rank.format),
  fact('WEB-DL', rank.format),
]
const texts = (list: Fact[]) => list.map((f) => f.text)
const print = (list: Fact[]) => texts(list).join(' · ')

describe('what an edge strip can say', () => {
  it('estimates widths close to the real face', () => {
    // Measured in Barlow Condensed 600 at 12 px, 0.14em tracking: 346 px for the whole resume line.
    const whole = estimateWidth('S3 E7 · 18 MIN LEFT · ENDS 11:40 AM · 2160P · DV · WEB-DL', 'lead')
    expect(whole).toBeGreaterThan(330)
    expect(whole).toBeLessThan(380)
    // 11 px and 0.1em on a poster is narrower.
    expect(estimateWidth('2 H 47 · 8.2', 'poster')).toBeLessThan(estimateWidth('2 H 47 · 8.2', 'still'))
  })

  it('prints everything when there is room, and fills the rest with perforations', () => {
    const layout = composeStrip({ width: 740, facts: resume, kind: 'lead' })
    expect(texts(layout.facts)).toEqual(texts(resume))
    expect(layout.perfs).toBeGreaterThanOrEqual(8)
  })

  it('never cuts the end time: whatever else it drops, the time left and end time stay', () => {
    for (let width = 150; width <= 740; width += 10) {
      for (const kind of ['lead', 'still'] as const) {
        const { facts, perfs } = composeStrip({ width, facts: resume, kind })
        const used = facts.reduce((sum, f) => sum + estimateWidth(f.text, kind), 0) + estimateWidth(' · ', kind) * (facts.length - 1) + (perfs ? perfsWidth(perfs) + gapAfterPerfs(kind) : 0)
        // Room enough for the two facts that matter means they are both there, and it all fits.
        if (width >= 195) {
          expect(texts(facts)).toContain('ends 11:40 AM')
          expect(facts.some((f) => f.key)).toBe(true)
          expect(used).toBeLessThanOrEqual(width)
        }
      }
    }
  })

  it('drops by priority as the room shrinks: episode, then the end of the format, never the time left or end time', () => {
    const at = (width: number) => texts(composeStrip({ width, facts: resume, kind: 'lead' }).facts)
    let previous = resume.length
    let episodeGone = -1
    let formatGone = -1
    for (let width = 740; width >= 260; width -= 5) {
      const now = at(width)
      expect(now.length).toBeLessThanOrEqual(previous)
      previous = now.length
      if (episodeGone < 0 && !now.includes('S3 E7')) episodeGone = width
      if (formatGone < 0 && !now.includes('2160p')) formatGone = width
      expect(now).toContain('ends 11:40 AM')
    }
    // The episode code goes while the format is still there; the resolution is the last of the format to go.
    expect(episodeGone).toBeGreaterThan(formatGone)
  })

  it('spells the time left one way at every width: it is dropped last, never reworded', () => {
    const base: Fact[] = [fact('1h44 left', rank.left, { key: true }), fact('ends 1:06 PM', rank.ends), fact('2160p', rank.format)]
    for (let width = 120; width <= 740; width += 10) {
      for (const kind of ['lead', 'title', 'still'] as const) {
        const left = composeStrip({ width, facts: base, kind }).facts.find((f) => f.key)
        expect(left?.text).toBe('1h44 left')
      }
    }
  })

  it('keeps the format only as a unit of pieces, resolution last to go', () => {
    const { facts } = composeStrip({ width: 214, facts: resume, kind: 'still' })
    // Room for the two key facts and a little more: the episode is gone, the resolution outlives its companions.
    expect(texts(facts)).not.toContain('S3 E7')
    expect(texts(facts)).not.toContain('WEB-DL')
    if (texts(facts).includes('DV')) expect(texts(facts)).toContain('2160p')
  })

  it('gives every still and poster of a width the same perforations, whatever the print', () => {
    const a = composeStrip({ width: 260, facts: resume, kind: 'still' })
    const b = composeStrip({ width: 260, facts: [fact('Film', rank.facts), fact('8.2', rank.rating)], kind: 'still' })
    expect(a.perfs).toBe(b.perfs)
    expect(a.perfs).toBeGreaterThanOrEqual(3)
    const p1 = composeStrip({ width: 164, facts: [fact('new ep', rank.left), fact('8.6', rank.rating)], kind: 'poster' })
    const p2 = composeStrip({ width: 164, facts: [fact('5 seasons', rank.facts), fact('8.9', rank.rating)], kind: 'poster' })
    expect(p1.perfs).toBe(p2.perfs)
    expect(p1.perfs).toBeGreaterThan(0)
  })

  it('draws no perforations on a poster too narrow for them, and prints what fits', () => {
    const layout = composeStrip({ width: 96, facts: [fact('2 h 47', rank.facts), fact('8.2', rank.rating)], kind: 'poster' })
    expect(layout.perfs).toBe(0)
    expect(texts(layout.facts).length).toBeGreaterThan(0)
  })

  it('keeps the rating over the runtime on a squeezed poster', () => {
    const layout = composeStrip({ width: 50, facts: [fact('2 h 47', rank.facts), fact('8.2', rank.rating)], kind: 'poster' })
    expect(texts(layout.facts)).toEqual(['8.2'])
  })

  it('draws perforations alone for a strip with progress and no print', () => {
    const layout = composeStrip({ width: 400, facts: [], kind: 'lead' })
    expect(layout.facts).toEqual([])
    expect(layout.perfs).toBe(30)
  })

  it('reads callers’ parts: strings are the lowest priority, { key } is the time left, { text, rank } as given', () => {
    const facts = toFacts(['S1 E1', { key: '5m left' }, { text: 'ends 9:00', rank: rank.ends }, ''])
    expect(facts).toEqual([
      { text: 'S1 E1', rank: rank.facts },
      { text: '5m left', rank: rank.left, key: true },
      { text: 'ends 9:00', rank: rank.ends },
    ])
    expect(print(facts)).toBe('S1 E1 · 5m left · ends 9:00')
  })
})
