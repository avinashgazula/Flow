import { describe, expect, it } from 'vitest'
import { activeSegment, behaviourFor, contains, creditsRunToEnd, creditsStart, demoSegments, kindOfChapter, mediaSegments, parseSegments, plexMarkers, segmentsFromChapters, type SkipSegment } from './segments'

/* The first two describe blocks are FlowKit's tests (ServiceTests.testSkipSegmentParsing and ChapterSkipTests),
   with the same inputs and the same answers. */

describe('parseSegments', () => {
  it('reads a list of typed segments in seconds or milliseconds, and drops what it does not know', () => {
    const segments = parseSegments({
      segments: [
        { type: 'intro', start: 30, end: 90 },
        { segment_type: 'credits', start_ms: 2_500_000, end_ms: 2_600_000 },
        { type: 'unknown', start: 1, end: 2 },
      ],
    })
    expect(segments).toEqual<SkipSegment[]>([
      { kind: 'intro', start: 30, end: 90 },
      { kind: 'credits', start: 2500, end: 2600 },
    ])
    expect(activeSegment(segments, 45)?.kind).toBe('intro')
    expect(activeSegment(segments, 95)).toBeUndefined()
  })

  it('takes a bare list, or a list under data', () => {
    const list = [{ kind: 'Recap', startTime: 4, endTime: 40 }]
    expect(parseSegments(list)).toEqual([{ kind: 'recap', start: 4, end: 40 }])
    expect(parseSegments({ data: list })).toEqual([{ kind: 'recap', start: 4, end: 40 }])
  })

  it('knows the other names for each kind', () => {
    const names = ['opening', 'op', 'previously', 'outro', 'ending', 'ed', 'next', 'ad']
    const kinds = names.map((type) => parseSegments([{ type, start: 1, end: 9 }])[0]?.kind)
    expect(kinds).toEqual(['intro', 'intro', 'recap', 'credits', 'credits', 'credits', 'preview', 'commercial'])
  })

  it('drops a segment that ends before it starts, or has no times', () => {
    expect(parseSegments([{ type: 'intro', start: 50, end: 50 }, { type: 'intro', start: 60, end: 10 }, { type: 'intro' }])).toEqual([])
  })

  it('sorts by start', () => {
    const out = parseSegments([
      { type: 'credits', start: 900, end: 1000 },
      { type: 'intro', start: 10, end: 70 },
    ])
    expect(out.map((x) => x.kind)).toEqual(['intro', 'credits'])
  })

  it('reads an object keyed by kind', () => {
    expect(parseSegments({ intro: { start: 10, end: 70 }, credits: { start: 2400, end: 2500 }, recap: { start: 5, end: 3 } })).toEqual([
      { kind: 'intro', start: 10, end: 70 },
      { kind: 'credits', start: 2400, end: 2500 },
    ])
  })

  it('reads IntroDB’s answer: an object with "outro" for the credits, nulls for what is not known, and ids and flags beside', () => {
    const answer = {
      imdb_id: 'tt0944947',
      media_type: 'tv',
      is_movie: false,
      season: 1,
      episode: 1,
      intro: { start_sec: 437, end_sec: 531, start_ms: 437000, end_ms: 531000, confidence: 1 },
      recap: null,
      outro: { start_sec: 3631.5, end_sec: 3699.5, start_ms: 3631500, end_ms: 3699500 },
      post_credits: null,
      no_intro: false,
    }
    expect(parseSegments(answer)).toEqual([
      { kind: 'intro', start: 437, end: 531 },
      { kind: 'credits', start: 3631.5, end: 3699.5 },
    ])
  })

  it('reads PublicMetaDB’s flat records, the streaming cut first and one segment of each kind', () => {
    const answer = {
      items: [
        { source: 'physical', intro_start_ms: 1000, intro_end_ms: 61000, credits_start_ms: 3000000, credits_end_ms: 3100000, recap_start_ms: null, recap_end_ms: null },
        { source: 'streaming', intro_start_ms: 0, intro_end_ms: 62000, credits_start_ms: null, credits_end_ms: null, preview_start_ms: 3100000, preview_end_ms: 3120000 },
      ],
      total: 2,
    }
    expect(parseSegments(answer)).toEqual([
      { kind: 'intro', start: 0, end: 62 },
      { kind: 'credits', start: 3000, end: 3100 },
      { kind: 'preview', start: 3100, end: 3120 },
    ])
  })

  it('returns nothing for answers that are not segments', () => {
    for (const nothing of [null, undefined, 'no', 3, {}, [], { error: 'Invalid query params.' }, { message: 'File not found.', status: 404, data: {} }]) {
      expect(parseSegments(nothing)).toEqual([])
    }
  })
})

describe('segments from chapter names', () => {
  it('finds the opening, ending and preview of an anime episode', () => {
    const chapters = [
      { title: 'Prologue', start: 0 },
      { title: 'Opening', start: 95 },
      { title: 'Part A', start: 185 },
      { title: 'Part B', start: 800 },
      { title: 'Ending', start: 1290 },
      { title: 'Preview', start: 1380 },
    ]
    const segments = segmentsFromChapters(chapters, 1420)
    expect(segments.map((x) => x.kind)).toEqual(['intro', 'credits', 'preview'])
    expect(segments[0]).toMatchObject({ start: 95, end: 185 })
    expect(segments.at(-1)?.end).toBe(1420)
  })

  it('reads names and ignores what is not one', () => {
    expect(kindOfChapter('Opening Credits')).toBe('intro')
    expect(kindOfChapter('End Credits')).toBe('credits')
    expect(kindOfChapter('Previously on...')).toBe('recap')
    expect(kindOfChapter('OP')).toBe('intro')
    expect(kindOfChapter('Introduction')).toBeUndefined()
    expect(kindOfChapter('Chapter 02')).toBeUndefined()
    expect(kindOfChapter('Next Episode')).toBe('preview')
  })

  it('ignores an “intro” chapter half an hour long, and one too short to be real', () => {
    expect(segmentsFromChapters([{ title: 'Intro', start: 0 }, { title: 'Main', start: 1800 }], 3600)).toEqual([])
    expect(segmentsFromChapters([{ title: 'Intro', start: 0 }, { title: 'Main', start: 5 }], 3600)).toEqual([])
  })

  it('does not need the chapters in order', () => {
    const out = segmentsFromChapters([{ title: 'Main', start: 120 }, { title: 'Intro', start: 10 }], 3000)
    expect(out).toEqual([{ kind: 'intro', start: 10, end: 120 }])
  })
})

describe('server segments', () => {
  it('maps Jellyfin media segments from ticks', () => {
    const answer = {
      Items: [
        { Type: 'Intro', StartTicks: 300_000_000, EndTicks: 900_000_000 },
        { Type: 'Outro', StartTicks: 25_000_000_000, EndTicks: 26_000_000_000 },
        { Type: 'Recap', StartTicks: 0, EndTicks: 200_000_000 },
        { Type: 'Unknown', StartTicks: 1, EndTicks: 2 },
      ],
    }
    expect(mediaSegments(answer)).toEqual([
      { kind: 'intro', start: 30, end: 90 },
      { kind: 'credits', start: 2500, end: 2600 },
      { kind: 'recap', start: 0, end: 20 },
    ])
    expect(mediaSegments({})).toEqual([])
    expect(mediaSegments(null)).toEqual([])
  })

  it('maps Plex intro and credits markers from milliseconds', () => {
    expect(
      plexMarkers([
        { type: 'intro', startTimeOffset: 15000, endTimeOffset: 75000 },
        { type: 'credits', startTimeOffset: 2_400_000, endTimeOffset: 2_500_000 },
        { type: 'commercial', startTimeOffset: 1, endTimeOffset: 2 },
      ]),
    ).toEqual([
      { kind: 'intro', start: 15, end: 75 },
      { kind: 'credits', start: 2400, end: 2500 },
    ])
    expect(plexMarkers(undefined)).toEqual([])
  })
})

describe('which segment is on', () => {
  const intro: SkipSegment = { kind: 'intro', start: 10, end: 70 }

  it('is on from its start to half a second before its end', () => {
    expect(contains(intro, 9.9)).toBe(false)
    expect(contains(intro, 10)).toBe(true)
    expect(contains(intro, 69.4)).toBe(true)
    expect(contains(intro, 69.5)).toBe(false)
  })

  it('follows the setting for its kind, and a preview or ad follows the intro’s', () => {
    const settings = { skipIntro: 'automatic', skipRecap: 'off', skipCredits: 'button' } as const
    expect(behaviourFor('intro', settings)).toBe('automatic')
    expect(behaviourFor('recap', settings)).toBe('off')
    expect(behaviourFor('credits', settings)).toBe('button')
    expect(behaviourFor('preview', settings)).toBe('automatic')
    expect(behaviourFor('commercial', settings)).toBe('automatic')
  })
})

describe('credits and the next episode', () => {
  const credits: SkipSegment = { kind: 'credits', start: 2600, end: 2700 }

  it('starts the Up Next card where the credits begin', () => {
    expect(creditsStart([{ kind: 'intro', start: 10, end: 70 }, credits], 2700)).toBe(2600)
    expect(creditsStart([{ kind: 'intro', start: 10, end: 70 }], 2700)).toBeUndefined()
  })

  it('does not trust “credits” in the first half of the stream', () => {
    expect(creditsStart([{ kind: 'credits', start: 300, end: 360 }], 2700)).toBeUndefined()
  })

  it('moves on to the next episode only when the credits run to the end', () => {
    expect(creditsRunToEnd(credits, 2700)).toBe(true)
    expect(creditsRunToEnd(credits, 2702)).toBe(true)
    expect(creditsRunToEnd(credits, 2800)).toBe(false)
    expect(creditsRunToEnd({ kind: 'intro', start: 2650, end: 2700 }, 2700)).toBe(false)
  })
})

describe('sample data', () => {
  it('has an intro near the start and credits at the end', () => {
    expect(demoSegments(48)).toEqual([
      { kind: 'intro', start: 5, end: 20 },
      { kind: 'credits', start: 30, end: 48 },
    ])
  })

  it('has nothing for a stream too short, or one of unknown length', () => {
    expect(demoSegments(30)).toEqual([])
    expect(demoSegments(Number.NaN)).toEqual([])
  })
})
