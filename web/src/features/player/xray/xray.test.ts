import { describe, expect, it } from 'vitest'
import type { CastMember } from '../../../lib/tmdb/types'
import { crewOf, dialogueLines, episodeCast, inScene, mentioned, pauseOpensXRay, words } from './xray'

const member = (id: number, name: string, role: string): CastMember => ({ id, name, role })
const cast = [
  member(1, 'Bryan Cranston', 'Walter White'),
  member(2, 'Anna Gunn', 'Skyler White'),
  member(3, 'Aaron Paul', 'Jesse Pinkman'),
  member(4, 'Dean Norris', 'Hank Schrader'),
  member(5, 'Jonathan Banks', 'Mike Ehrmantraut'),
  member(6, 'Extra', 'Police Officer #2'),
  member(7, 'Someone', 'Himself'),
]
const ids = (list: CastMember[]) => list.map((m) => m.id)

// The same cases as FlowKit's XRayTests, so the two matchers can't drift apart.
describe('who is named in the dialogue', () => {
  it('matches first names and possessives', () => {
    expect(new Set(ids(mentioned(['Jesse, get in the car.', "Hank's on his way."], cast)))).toEqual(new Set([3, 4]))
    expect(new Set(ids(mentioned(['Jesse, get in the car.', 'Hank’s on his way.'], cast)))).toEqual(new Set([3, 4]))
  })

  it('matches nobody from a surname two characters share', () => {
    expect(mentioned(['Mr. White, yo!'], cast)).toEqual([])
  })

  it('lets a full name settle which of them it is', () => {
    expect(ids(mentioned(['My name is Walter White.'], cast))).toEqual([1])
  })

  it('reads speaker labels in capitals', () => {
    expect(ids(mentioned(['MIKE: No more half measures.'], cast))).toEqual([5])
  })

  it('puts the most mentioned first', () => {
    expect(ids(mentioned(['Hank?', 'Jesse, Jesse, listen.', 'Jesse!'], cast))).toEqual([3, 4])
  })

  it('keeps billing order between equal scores', () => {
    expect(ids(mentioned(['Hank, Jesse.', 'Mike!'], cast))).toEqual([3, 4, 5])
    expect(ids(mentioned(['Mike, Hank, Jesse.'], cast))).toEqual([3, 4, 5])
  })

  it('ignores lowercase words and generic credits', () => {
    // "police" in dialogue, a generic "Police Officer" credit, and "himself" never match.
    expect(mentioned(['Call the police, the officer said so himself.'], cast)).toEqual([])
  })

  it('counts an everyday-word name only where its capital means a name', () => {
    const strangerThings = [member(10, 'Noah Schnapp', 'Will Byers')]
    expect(mentioned(['Will you stop that?'], strangerThings)).toEqual([])
    expect(ids(mentioned(['Where is Will?'], strangerThings))).toEqual([10])
  })

  it('knows a character by any of their aliases and ignores notes in brackets', () => {
    const members = [member(20, 'Bryan Cranston', 'Walter White / Heisenberg (voice)')]
    expect(ids(mentioned(['They call him Heisenberg.'], members))).toEqual([20])
    expect(mentioned(['It was a voice.'], members)).toEqual([])
  })

  it('finds a full name across punctuation and a curly apostrophe', () => {
    const found = mentioned(['“Walter White.” That’s the name.'], cast)
    expect(ids(found)).toEqual([1])
  })

  it('is not fooled by titles and credits that are descriptions', () => {
    const house = [member(30, 'Hugh Laurie', 'Dr. Gregory House'), member(31, 'Someone', 'Man in Bar'), member(32, 'Narrator', 'Narrator')]
    expect(ids(mentioned(['Dr. House is in.', 'The man in the bar said Narrator.'], house))).toEqual([30])
  })

  it('counts a person listed twice once', () => {
    const twice = [member(40, 'Actor', 'Jesse Pinkman'), member(40, 'Actor', 'Young Jesse')]
    expect(ids(mentioned(['Jesse!'], twice))).toEqual([40])
  })

  it('reads capitalised words only, and says which start a sentence', () => {
    expect(words('Where is Will? get Jesse')).toEqual([
      { key: 'where', startsSentence: true },
      { key: 'will', startsSentence: false },
      { key: 'jesse', startsSentence: false },
    ])
    expect(words("Hank's here")).toEqual([{ key: 'hank', startsSentence: true }])
  })
})

describe('the dialogue around the playhead', () => {
  const cues = [
    { startTime: 10, text: 'a' },
    { startTime: 50, text: 'b' },
    { startTime: 100, text: 'c' },
  ]

  it('takes the cues that started inside the window', () => {
    expect(dialogueLines(cues, 40, 100)).toEqual(['b', 'c'])
    expect(dialogueLines(cues, 101, 200)).toEqual([])
  })

  it('applies the subtitle delay: delayed by 5 s, 55 shows the cue that starts at 50', () => {
    expect(dialogueLines(cues, 0, 54, 5)).toEqual(['a'])
    expect(dialogueLines(cues, 0, 55, 5)).toEqual(['a', 'b'])
  })

  it('drops markup but keeps a voice tag as a speaker label', () => {
    const marked = [{ startTime: 1, text: '<i>Jesse</i>, <b>listen</b>' }, { startTime: 2, text: '<v Hank>Where is he?' }]
    expect(dialogueLines(marked, 0, 3)).toEqual(['Jesse, listen', 'Hank: Where is he?'])
  })

  it('reads three minutes back from the playhead', () => {
    const talk = [
      { startTime: 5, text: 'Where is Hank?' },
      { startTime: 400, text: 'Jesse, get in.' },
      { startTime: 500, text: 'Mike called.' },
    ]
    expect(ids(inScene(talk, 520, cast))).toEqual([3, 5])
    // Hank was named too long ago, and the rest hasn't been said yet.
    expect(ids(inScene(talk, 450, cast))).toEqual([3])
  })

  it('shows at most eight people', () => {
    const many = Array.from({ length: 12 }, (_, i) => member(100 + i, `Actor ${i}`, `Character${String.fromCharCode(65 + i)}${'x'.repeat(i)}`))
    const talk = [{ startTime: 1, text: many.map((m) => m.role).join(' ') }]
    expect(inScene(talk, 10, many)).toHaveLength(8)
  })
})

describe("an episode's cast", () => {
  it('lists the regular cast, then the guest stars, each in billing order', () => {
    const list = episodeCast({
      cast: [
        { id: 2, name: 'B', character: 'Second', order: 1 },
        { id: 1, name: 'A', character: 'First', order: 0, profile_path: '/a.jpg' },
      ],
      guest_stars: [
        { id: 9, name: 'Guest Z', character: 'Visitor', order: 5 },
        { id: 8, name: 'Guest Y', order: 1 },
      ],
    })
    expect(list.map((m) => m.name)).toEqual(['A', 'B', 'Guest Y', 'Guest Z'])
    expect(list[0]).toEqual({ id: 1, name: 'A', role: 'First', profile: '/a.jpg' })
    expect(list[2]!.role).toBe('')
  })

  it('lists a person who is both regular and guest once, as a regular', () => {
    const list = episodeCast({ cast: [{ id: 1, name: 'A', character: 'Lead', order: 0 }], guest_stars: [{ id: 1, name: 'A', character: 'Lead (flashback)', order: 0 }] })
    expect(list).toHaveLength(1)
    expect(list[0]!.role).toBe('Lead')
  })

  it('has nobody when TMDB has no credits', () => {
    expect(episodeCast(undefined)).toEqual([])
    expect(episodeCast({})).toEqual([])
  })

  it('names the director or creator as the crew, and no one else', () => {
    const crew = [member(1, 'V', 'Creator'), member(2, 'W', 'Writer'), member(3, 'D', 'Director'), member(4, 'C', 'Original Music Composer')]
    expect(ids(crewOf(crew))).toEqual([1, 3])
  })
})

describe('when a pause brings X-Ray up', () => {
  const base = { enabled: true, paused: true, ended: false, scrubbing: false, seeking: false, hidden: false, blocked: false, panel: null }
  it('does when the picture has stopped and nothing else is open', () => {
    expect(pauseOpensXRay(base)).toBe(true)
  })
  it('does not when it is off, playing, finished, scrubbing, seeking, hidden or blocked', () => {
    for (const change of [{ enabled: false }, { paused: false }, { ended: true }, { scrubbing: true }, { seeking: true }, { hidden: true }, { blocked: true }]) {
      expect(pauseOpensXRay({ ...base, ...change })).toBe(false)
    }
  })
  it('leaves an open panel alone', () => {
    expect(pauseOpensXRay({ ...base, panel: 'options' })).toBe(false)
    expect(pauseOpensXRay({ ...base, panel: 'xray' })).toBe(false)
  })
})
