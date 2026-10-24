/* Skip segments, as FlowKit's SkipSegments.swift: the parts of an episode or film worth skipping (an intro, a
   recap, the credits), where they come from, and which one is on at a given moment. Pure: the lookups that
   fetch them are in segmentSources.ts. The tolerant parsing and the chapter rules are ports, and
   segments.test.ts carries the Swift tests' cases. */

import type { Settings, SkipBehaviour } from '../../lib/store/settings'

export type SkipKind = 'intro' | 'recap' | 'credits' | 'preview' | 'commercial'

export interface SkipSegment {
  kind: SkipKind
  /** Seconds from the start of the stream. */
  start: number
  end: number
}

/** The button's words, as the apps': "Skip Intro", "Skip Recap", "Skip Credits". */
export const skipTitle: Record<SkipKind, string> = {
  intro: 'Skip Intro',
  recap: 'Skip Recap',
  credits: 'Skip Credits',
  preview: 'Skip Preview',
  commercial: 'Skip Ad',
}

/** What the note says after one is skipped by itself: "Skipped intro". */
export const skippedTitle: Record<SkipKind, string> = {
  intro: 'Skipped intro',
  recap: 'Skipped recap',
  credits: 'Skipped credits',
  preview: 'Skipped preview',
  commercial: 'Skipped ad',
}

/** Half a second before the end it is over: the button doesn't flicker in for the last frames. */
export const contains = (segment: SkipSegment, time: number) => time >= segment.start && time < segment.end - 0.5

/** The segment, if any, that its button should show for at `time`. */
export const activeSegment = (segments: readonly SkipSegment[], time: number): SkipSegment | undefined => segments.find((x) => contains(x, time))

/** What Settings says to do about a kind of segment. A preview or an ad is treated as an intro, as in the apps. */
export function behaviourFor(kind: SkipKind, settings: Pick<Settings, 'skipIntro' | 'skipRecap' | 'skipCredits'>): SkipBehaviour {
  switch (kind) {
    case 'recap':
      return settings.skipRecap
    case 'credits':
      return settings.skipCredits
    default:
      return settings.skipIntro
  }
}

// MARK: Keyed services (IntroDB, PublicMetaDB)

type Json = unknown
const isObject = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v)
const numberOf = (v: Json): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)

/** The names the services use for each kind, in any letter case. */
const kindNames: Record<string, SkipKind> = {
  intro: 'intro',
  opening: 'intro',
  op: 'intro',
  recap: 'recap',
  previously: 'recap',
  credits: 'credits',
  outro: 'credits',
  ending: 'credits',
  ed: 'credits',
  preview: 'preview',
  next: 'preview',
  commercial: 'commercial',
  ad: 'commercial',
}

const startKeys = ['start', 'start_sec', 'startTime', 'start_ms', 'startMs']
const endKeys = ['end', 'end_sec', 'endTime', 'end_ms', 'endMs']

/** The first of `keys` the record has as a number, in seconds (a key ending in "_ms" or "Ms" is milliseconds). */
function secondsOf(record: Record<string, Json>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberOf(record[key])
    if (value !== undefined) return key.endsWith('_ms') || key.endsWith('Ms') ? value / 1000 : value
  }
  return undefined
}

function segmentOf(kind: SkipKind | undefined, record: Json): SkipSegment | undefined {
  if (!kind || !isObject(record)) return undefined
  const start = secondsOf(record, startKeys)
  const end = secondsOf(record, endKeys)
  return start !== undefined && end !== undefined && end > start ? { kind, start, end } : undefined
}

/** PublicMetaDB's records are flat: `intro_start_ms`, `intro_end_ms`, `credits_start_ms` and so on, one record per source and contributor. */
function flatSegments(record: Json): SkipSegment[] {
  if (!isObject(record)) return []
  const out: SkipSegment[] = []
  for (const kind of ['intro', 'recap', 'credits', 'preview'] as const) {
    const start = numberOf(record[`${kind}_start_ms`])
    const end = numberOf(record[`${kind}_end_ms`])
    if (start !== undefined && end !== undefined && end > start) out.push({ kind, start: start / 1000, end: end / 1000 })
  }
  return out
}

/** Segments from a service's answer. The shape varies, so this takes what it can: a list (or `segments`,
 *  or `data`) of records with a type and a start and end in seconds or milliseconds, an object keyed by
 *  kind ({"intro": {"start": 10, "end": 70}}, IntroDB's way, with "outro" for the credits), or
 *  PublicMetaDB's flat records in `items`. Entries that make no sense are dropped. */
export function parseSegments(json: Json): SkipSegment[] {
  const list = Array.isArray(json) ? json : isObject(json) ? (Array.isArray(json.segments) ? json.segments : Array.isArray(json.data) ? json.data : []) : []
  let out = list.flatMap((entry): SkipSegment[] => {
    if (!isObject(entry)) return []
    const raw = [entry.type, entry.segment_type, entry.kind].find((v) => v !== undefined && v !== null)
    const name = typeof raw === 'string' ? raw.toLowerCase() : ''
    const found = segmentOf(kindNames[name], entry)
    return found ? [found] : []
  })

  // Object form: {"intro": {"start": 10, "end": 70}, ...}
  if (out.length === 0 && isObject(json)) {
    const object = isObject(json.data) ? json.data : json
    out = Object.entries(object).flatMap(([key, value]) => {
      const found = segmentOf(kindNames[key.toLowerCase()], value)
      return found ? [found] : []
    })
  }

  // PublicMetaDB: one flat record per source, the streaming cut first; the first record to name a kind has it.
  if (out.length === 0 && isObject(json) && Array.isArray(json.items)) {
    const records = (json.items as Json[]).filter(isObject).sort((a, b) => Number(b.source === 'streaming') - Number(a.source === 'streaming'))
    const seen = new Set<SkipKind>()
    for (const record of records) {
      for (const found of flatSegments(record)) {
        if (seen.has(found.kind)) continue
        seen.add(found.kind)
        out.push(found)
      }
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

// MARK: Media servers

/** Jellyfin 10.10+ media segments: Intro, Outro, Recap, Preview, Commercial, in 100-nanosecond ticks. */
export function mediaSegments(json: Json): SkipSegment[] {
  const items = isObject(json) && Array.isArray(json.Items) ? (json.Items as Json[]) : []
  const kinds: Record<string, SkipKind> = { Intro: 'intro', Outro: 'credits', Recap: 'recap', Preview: 'preview', Commercial: 'commercial' }
  return items.flatMap((item): SkipSegment[] => {
    if (!isObject(item) || typeof item.Type !== 'string') return []
    const kind = kinds[item.Type]
    const start = numberOf(item.StartTicks)
    const end = numberOf(item.EndTicks)
    return kind && start !== undefined && end !== undefined && end > start ? [{ kind, start: start / 1e7, end: end / 1e7 }] : []
  })
}

/** Plex markers: type "intro" or "credits", offsets in milliseconds. */
export function plexMarkers(markers: Json): SkipSegment[] {
  if (!Array.isArray(markers)) return []
  return markers.flatMap((m): SkipSegment[] => {
    if (!isObject(m)) return []
    const kind: SkipKind | undefined = m.type === 'intro' ? 'intro' : m.type === 'credits' ? 'credits' : undefined
    const start = numberOf(m.startTimeOffset)
    const end = numberOf(m.endTimeOffset)
    return kind && start !== undefined && end !== undefined && end > start ? [{ kind, start: start / 1000, end: end / 1000 }] : []
  })
}

// MARK: Chapter names

export interface Chapter {
  title: string
  /** Seconds. */
  start: number
}

/** What a chapter's name says it is ("Opening", "Ending", "Recap", "Preview"), as anime and many TV releases name them. */
export function kindOfChapter(title: string): SkipKind | undefined {
  const t = title.toLowerCase().trim()
  const words = new Set(t.split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const has = (phrase: string) => t.includes(phrase)
  if (words.has('recap') || has('previously')) return 'recap'
  if (words.has('preview') || has('next episode') || has('next time')) return 'preview'
  if (words.has('op') || words.has('opening') || words.has('intro') || has('title sequence') || has('main title')) return 'intro'
  if (words.has('ed') || words.has('ending') || words.has('credits') || words.has('outro')) return 'credits'
  return undefined
}

/** Segments read from chapter names. Each runs to the next chapter. Implausibly short or long ones are ignored. */
export function segmentsFromChapters(chapters: readonly Chapter[], duration: number): SkipSegment[] {
  const sorted = [...chapters].sort((a, b) => a.start - b.start)
  const out: SkipSegment[] = []
  sorted.forEach((chapter, i) => {
    const kind = kindOfChapter(chapter.title)
    if (!kind) return
    const end = i + 1 < sorted.length ? sorted[i + 1]!.start : duration
    const length = end - chapter.start
    const longest = kind === 'credits' ? 900 : 360
    if (length >= 8 && length <= longest) out.push({ kind, start: chapter.start, end })
  })
  return out
}

// MARK: Sample data

/** Sample data's skip times: an intro near the start and credits for the last stretch, so the buttons can be
 *  seen on any sample stream. Nothing for a stream too short to hold them. */
export function demoSegments(duration: number): SkipSegment[] {
  if (!(duration >= 40)) return []
  return [
    { kind: 'intro', start: 5, end: 20 },
    { kind: 'credits', start: duration - 18, end: duration },
  ]
}

// MARK: Credits and the next episode

/** Where the credits begin, when a segment says. One that starts in the first half of the stream is a mislabelled
 *  chapter, not the credits. */
export function creditsStart(segments: readonly SkipSegment[], duration: number): number | undefined {
  const credits = segments.find((x) => x.kind === 'credits' && x.start >= duration * 0.5)
  return credits?.start
}

/** Skipping these credits moves on to the next episode: they run to the end of the file (within five seconds,
 *  as in the apps), so there is nothing after them to watch. */
export const creditsRunToEnd = (segment: SkipSegment, duration: number) => segment.kind === 'credits' && segment.end >= duration - 5
