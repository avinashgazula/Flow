/* Arranging ranked sources the way the viewer asked: a port of FlowKit's SourceRanker. Category order, then
   provider order, then (with custom ordering on) the sort rules, after the filters and before the result cap.

   rank.ts has already scored every source for this browser, so a tie in the rules, and the order inside a
   provider when no rule is set, is that score, where the apps keep the add-on's own order. */

import { languageName } from '../language'
import { isCinemaCapture, releaseQualities, type ParsedQuality } from './parser'
import { sourceCategories, type SourceCategory, type SourceFilters, type SourceOrdering, type SourceSortKey, type SourceSortRule } from './sourceSettings'
import type { Source, SourceOrigin } from './types'

/** Where a source comes from: the viewer's own servers, a WebDAV share, or an add-on. */
export const categoryOf = (origin: SourceOrigin): SourceCategory => (origin === 'jellyfin' || origin === 'emby' || origin === 'plex' ? 'mediaServers' : origin === 'webdav' ? 'webDAV' : 'addons')

/** What tells one provider's sources from another's: the add-on's address or the server's id. */
export const providerKey = (s: Pick<Source, 'providerId' | 'provider'>): string => s.providerId ?? s.provider

export interface ProviderRef {
  id: string
  category: SourceCategory
}

/** The providers in the order the viewer set: those named in `saved` first, in that order, then the rest as
 *  they come. A saved id whose provider has since been removed is ignored. */
export function effectiveProviderOrder(known: string[], saved: string[] | undefined): string[] {
  const named = (saved ?? []).filter((id, i, all) => known.includes(id) && all.indexOf(id) === i)
  return [...named, ...known.filter((id) => !named.includes(id))]
}

const heights: Record<NonNullable<Source['resolution']>, number> = { SD: 480, '480p': 480, '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 }
const heightOf = (s: Pick<Source, 'resolution'>) => (s.resolution ? heights[s.resolution] : 0)

const codecAliases: Record<string, string> = { x264: 'h264', avc: 'h264', x265: 'hevc', h265: 'hevc' }
/** "H.264", "x264" and "h264" are one codec; "HEVC", "x265" and "h.265" another. */
const codecName = (codec: string) => {
  const plain = codec.toLowerCase().replace(/[^a-z0-9]/g, '')
  return codecAliases[plain] ?? plain
}

const GB = 1_073_741_824

/** Whether the filters let this source through. Mirrors FlowKit's `passes`: a size is only judged when the
 *  source states one, and a resolution only when it's known. Keywords are matched against the release name,
 *  the file name and the add-on's own text, ignoring case. */
export function passes(s: Source, f: SourceFilters): boolean {
  if (f.excludeCinemaCaptures && isCinemaCapture(s.quality as ParsedQuality)) return false
  if (f.excludeUncached && s.cached === false) return false
  const height = heightOf(s)
  if (f.minResolution && height && height < f.minResolution) return false
  if (s.sizeBytes) {
    const gb = s.sizeBytes / GB
    if (f.minSizeGB && gb < f.minSizeGB) return false
    if (f.maxSizeGB && gb > f.maxSizeGB) return false
  }
  const text = [s.title, s.detail, s.filename].filter(Boolean).join(' ').toLowerCase()
  if (f.excludedKeywords.some((k) => k.trim() && text.includes(k.trim().toLowerCase()))) return false
  const required = f.requiredKeywords.filter((k) => k.trim())
  if (required.length > 0 && !required.some((k) => text.includes(k.trim().toLowerCase()))) return false
  if (s.videoCodec && f.excludedCodecs.some((c) => codecName(c) === codecName(s.videoCodec!))) return false
  return true
}

/** What the sources are compared by. */
export interface RuleContext {
  /** How well the resolution fits the viewer's Preferred Quality; larger is a better fit. */
  resolutionFit: (s: Source) => number
}

/** A number for a source under one sort key, larger being "best". Mirrors FlowKit's `value`, except that
 *  Resolution follows Preferred Quality (the quality chosen first, then higher ones, then lower), since a
 *  browser can't always play the highest. */
export function sortValue(s: Source, key: SourceSortKey, filters: Pick<SourceFilters, 'preferredLanguages'>, context: RuleContext): number {
  switch (key) {
    case 'resolution':
      return context.resolutionFit(s)
    case 'quality':
      return Math.max(0, releaseQualities.indexOf((s.quality ?? 'Unknown') as ParsedQuality))
    case 'size':
      return s.sizeBytes ?? 0
    case 'cached':
      return s.cached === true ? 2 : s.cached === undefined ? 1 : 0
    case 'seeders':
      return s.seeders ?? 0
    case 'hdr':
      return s.hdr?.includes('DV') ? 3 : s.hdr?.includes('HDR10+') ? 2 : s.hdr?.length ? 1 : 0
    case 'language': {
      const wanted = filters.preferredLanguages.map((l) => (languageName(l) ?? l).trim().toLowerCase()).filter(Boolean)
      if (wanted.length === 0) return 0
      const have = new Set((s.languages ?? []).map((l) => l.toLowerCase()))
      const first = wanted.findIndex((l) => have.has(l))
      return first < 0 ? 0 : wanted.length - first
    }
  }
}

/** Negative when `a` goes first, positive when `b` does, zero when every rule ties. */
export function compareByRules(a: Source, b: Source, rules: SourceSortRule[], filters: SourceFilters, context: RuleContext): number {
  for (const rule of rules) {
    const va = sortValue(a, rule.key, filters, context)
    const vb = sortValue(b, rule.key, filters, context)
    if (va !== vb) return rule.descending ? vb - va : va - vb
  }
  return 0
}

/** Within each provider and resolution, SDR before HDR; every group keeps the places it had, so the overall
 *  order doesn't change. For a screen that can't show HDR. */
export function sdrFirst(list: Source[]): Source[] {
  return reorderGroups(list, (s) => `${providerKey(s)}|${heightOf(s)}`, (s) => !s.hdr?.length)
}

/** Within each provider, releases that name the language first (a "Multi" release carries it among others);
 *  every group keeps the places it had. */
export function audioLanguageFirst(list: Source[], language: string): Source[] {
  const name = languageName(language)?.toLowerCase()
  if (!name) return list
  return reorderGroups(list, providerKey, (s) => !!s.languages?.some((l) => l.toLowerCase() === name || l === 'Multi'))
}

/** Moves the members of each group that satisfy `first` ahead of the others, within the places the group
 *  already occupies. */
function reorderGroups(list: Source[], group: (s: Source) => string, first: (s: Source) => boolean): Source[] {
  const slots = new Map<string, number[]>()
  list.forEach((s, i) => {
    const key = group(s)
    slots.set(key, [...(slots.get(key) ?? []), i])
  })
  const out = [...list]
  for (const indices of slots.values()) {
    if (indices.length < 2) continue
    const members = indices.map((i) => list[i]!)
    const reordered = [...members.filter(first), ...members.filter((s) => !first(s))]
    indices.forEach((slot, n) => (out[slot] = reordered[n]!))
  }
  return out
}

export interface ArrangeContext extends RuleContext {
  /** Every provider being asked, in the order Settings lists them. */
  providers: ProviderRef[]
  /** The viewer's first audio language, as a code ("en"). */
  audioLanguage?: string
  /** Whether this screen shows HDR. */
  hdrScreen: boolean
}

export interface Arranged {
  sources: Source[]
  /** How many the filters and the result cap left out. */
  hidden: number
}

/** Orders `ranked` (best first by score) by category, then provider, then the sort rules; with custom ordering
 *  on it also drops what the filters exclude and stops at the result cap.
 *
 *  Whatever the settings, a source that won't play in this browser goes last, and one known to stutter just
 *  before it: the web's version of FlowKit moving what a device can't decode behind the rest. */
export function arrangeSources(ranked: Source[], ordering: SourceOrdering, context: ArrangeContext): Arranged {
  const custom = ordering.useCustomOrdering
  const kept = custom ? ranked.filter((s) => passes(s, ordering.filters)) : ranked

  const categoryIndex = (s: Source) => {
    const i = ordering.categoryOrder.indexOf(categoryOf(s.origin))
    return i < 0 ? sourceCategories.length : i
  }
  const providerRank = new Map<string, number>()
  for (const category of sourceCategories) {
    const known = context.providers.filter((p) => p.category === category).map((p) => p.id)
    effectiveProviderOrder(known, ordering.providerOrder[category]).forEach((id, i) => providerRank.set(id, i))
  }
  // A provider Settings doesn't know (a source from an earlier search) follows the rest, in the order it appeared.
  for (const s of kept) if (!providerRank.has(providerKey(s))) providerRank.set(providerKey(s), providerRank.size + 1000)

  let list = [...kept].sort((a, b) => {
    const byCategory = categoryIndex(a) - categoryIndex(b)
    if (byCategory) return byCategory
    const byProvider = providerRank.get(providerKey(a))! - providerRank.get(providerKey(b))!
    if (byProvider) return byProvider
    return custom ? compareByRules(a, b, ordering.sortRules, ordering.filters, context) : 0
  })

  // Within-provider preferences first: the demotions below are stable, so nothing a browser can't play
  // is pulled back ahead of what it can. Without custom ordering the score already carries both.
  if (custom) {
    if (!context.hdrScreen) list = sdrFirst(list)
    if (context.audioLanguage) list = audioLanguageFirst(list, context.audioLanguage)
  }
  list = [...list.filter((s) => !s.unsupported && !s.mayStutter), ...list.filter((s) => !s.unsupported && s.mayStutter), ...list.filter((s) => s.unsupported)]

  if (custom && ordering.resultCap && list.length > ordering.resultCap) list = list.slice(0, ordering.resultCap)
  return { sources: list, hidden: ranked.length - list.length }
}

/** The list with the item at `index` one place earlier (-1) or later (1); unchanged at either end. */
export function moveWithin<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const out = [...list]
  const to = index + delta
  if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out
  ;[out[index], out[to]] = [out[to]!, out[index]!]
  return out
}
