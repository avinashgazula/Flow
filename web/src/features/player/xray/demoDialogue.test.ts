import { describe, expect, it } from 'vitest'
import type { CastMember } from '../../../lib/tmdb/types'
import { demoDialogue } from './demoDialogue'
import { inScene } from './xray'

const cast: CastMember[] = [
  { id: 1, name: 'Bryan Cranston', role: 'Walter White' },
  { id: 2, name: 'Aaron Paul', role: 'Jesse Pinkman' },
  { id: 3, name: 'Anna Gunn', role: 'Skyler White' },
  { id: 4, name: 'Dean Norris', role: 'Hank Schrader' },
  { id: 5, name: 'Hugh Laurie', role: 'Dr. Gregory House' },
  { id: 6, name: 'Someone', role: 'Himself' },
]

describe('the sample dialogue', () => {
  it('names a few of the cast at any point in the first half hour', () => {
    const cues = demoDialogue(cast)
    for (const time of [30, 400, 900, 1700]) {
      const found = inScene(cues, time, cast)
      expect(found.length).toBeGreaterThan(0)
      expect(found.length).toBeLessThanOrEqual(6)
    }
  })

  it('moves on from scene to scene', () => {
    const cues = demoDialogue(cast)
    const early = inScene(cues, 170, cast).map((m) => m.id)
    const later = inScene(cues, 900, cast).map((m) => m.id)
    expect(early).not.toEqual(later)
  })

  it('has nothing to say when the cast has no named characters', () => {
    expect(demoDialogue([])).toEqual([])
    expect(demoDialogue([{ id: 1, name: 'A', role: 'Himself' }, { id: 2, name: 'B', role: '' }])).toEqual([])
  })
})
