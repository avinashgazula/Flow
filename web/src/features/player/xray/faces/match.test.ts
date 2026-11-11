import { describe, expect, it } from 'vitest'
import fixture from './prints.fixture.json'
import { cosine, matchFaces, minLead, minSimilarity, normalise, type CastPrint, type FoundFace } from './match'

/* Prints made by the real pipeline (YuNet and SFace) from public-domain photographs: four portraits as the cast, and the faces
   found in two group photographs, one of the Obama family (four faces, two of them in the cast) and one of the cabinet in 2009
   (23 faces, three of them in the cast). They make the matcher's thresholds a measured thing, not a guess. */

const unit = (v: number[]) => normalise(Float32Array.from(v))
const ids = { obama: 1, michelle: 2, biden: 3, clinton: 4 } as const
const cast: CastPrint[] = Object.entries(fixture.cast).map(([name, v]) => ({ id: ids[name as keyof typeof ids], print: unit(v) }))
const faces = (frame: keyof typeof fixture.frames): FoundFace[] =>
  fixture.frames[frame].map((f) => ({ box: f.box, score: 0.9, print: unit(f.print) }))

describe('matching faces to the cast', () => {
  it('names the two cast members in a family photograph, left to right, and nobody else', () => {
    const found = matchFaces(faces('family'), cast)
    // Michelle Obama sits left of Barack Obama; the two daughters aren't in the cast.
    expect(found.map((m) => m.id)).toEqual([ids.michelle, ids.obama])
    expect(found.every((m) => m.similarity >= minSimilarity)).toBe(true)
  })

  it('names three cast members among 23 faces in a cabinet photograph, with no false names', () => {
    const found = matchFaces(faces('cabinet'), cast)
    expect(found.map((m) => m.id)).toEqual([ids.obama, ids.biden, ids.clinton])
  })

  it('keeps the threshold clear of every stranger in the fixtures, and every genuine pair above it', () => {
    // The strangers: the best a cast member's print scores against a face that is someone else's.
    const genuine = new Set(['family:0:obama', 'family:1:michelle', 'cabinet:6:obama', 'cabinet:9:biden', 'cabinet:0:clinton'])
    let strangers = -1
    let weakest = 1
    for (const frame of ['family', 'cabinet'] as const) {
      fixture.frames[frame].forEach((f, i) => {
        for (const [name, v] of Object.entries(fixture.cast)) {
          const s = cosine(unit(f.print), unit(v))
          if (genuine.has(`${frame}:${i}:${name}`)) weakest = Math.min(weakest, s)
          else strangers = Math.max(strangers, s)
        }
      })
    }
    expect(strangers).toBeLessThan(minSimilarity - 0.05)
    expect(weakest).toBeGreaterThan(minSimilarity + 0.05)
  })

  it('recognises an actor from a different photograph of them', () => {
    // Hillary Clinton's portrait against a snapshot taken years apart.
    expect(cosine(unit(fixture.cast.clinton), unit(fixture.clinton2010))).toBeGreaterThan(minSimilarity + 0.05)
  })

  it('names no one when the cast is only strangers', () => {
    const strangers = cast.filter((c) => c.id === ids.michelle || c.id === ids.clinton)
    expect(matchFaces([faces('cabinet')[6]!], strangers)).toEqual([])
  })

  it('never names a face below the threshold, whatever else is in the cast', () => {
    expect(matchFaces(faces('cabinet'), cast, { threshold: 0.99 })).toEqual([])
    for (const m of matchFaces(faces('cabinet'), cast)) expect(m.similarity).toBeGreaterThanOrEqual(minSimilarity)
  })
})

describe('the rules in the small', () => {
  const v = (...n: number[]) => unit(n)
  const face = (x: number, ...print: number[]): FoundFace => ({ box: { x, y: 0, width: 10, height: 10 }, score: 1, print: v(...print) })

  it('scales a print to length one and leaves zeros alone', () => {
    expect(Math.hypot(...normalise(Float32Array.from([3, 4])))).toBeCloseTo(1)
    expect([...normalise(new Float32Array(3))]).toEqual([0, 0, 0])
  })

  it('is 1 for the same print and 0 for ones at right angles', () => {
    expect(cosine(v(1, 2, 3), v(1, 2, 3))).toBeCloseTo(1)
    expect(cosine(v(1, 0), v(0, 1))).toBeCloseTo(0)
  })

  it('gives an actor to one face only, the nearer', () => {
    const a = face(0, 1, 0.2)
    const b = face(50, 1, 0.05)
    const found = matchFaces([a, b], [{ id: 7, print: v(1, 0.02) }])
    expect(found.map((m) => [m.id, m.face.box.x])).toEqual([[7, 50]])
  })

  it('leaves a face out when two actors are too alike to say', () => {
    const twins = [{ id: 1, print: v(1, 0.1) }, { id: 2, print: v(1, 0.12) }]
    expect(matchFaces([face(0, 1, 0.11)], twins)).toEqual([])
    // With the lead it asks for, the nearer of two is named.
    expect(matchFaces([face(0, 1, 0)], [{ id: 1, print: v(1, 0) }, { id: 2, print: v(1, 1) }]).map((m) => m.id)).toEqual([1])
    expect(minLead).toBeGreaterThan(0)
  })

  it('orders by where the face is on screen, not by billing', () => {
    const cast2 = [{ id: 1, print: v(1, 0, 0) }, { id: 2, print: v(0, 1, 0) }, { id: 3, print: v(0, 0, 1) }]
    const found = matchFaces([face(300, 0, 0, 1), face(20, 1, 0, 0), face(160, 0, 1, 0)], cast2)
    expect(found.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('matches nobody when the cast is empty', () => {
    expect(matchFaces([face(0, 1, 0)], [])).toEqual([])
  })
})
