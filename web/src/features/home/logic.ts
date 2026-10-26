import { rank, type PrintPart } from '../../components/Frame'
import { genreNames } from '../../lib/genres'
import type { LastSource } from '../../lib/sources/lastSource'
import type { Progress } from '../../lib/store/library'
import type { MediaDetail, MediaItem } from '../../lib/tmdb/types'
import { endTime, formatClock, formatLeftShort, formatRuntime, spokenDuration } from '../../lib/time'

/** What's left of an in-progress title, in seconds. */
export const secondsLeft = (p: Pick<Progress, 'position' | 'duration'>) => Math.max(0, p.duration - p.position)

/** How far through, 0 to 1. */
export const watchedFraction = (p: Pick<Progress, 'position' | 'duration'>) => (p.duration > 0 ? Math.min(1, p.position / p.duration) : 0)

/** In-progress titles, the one most recently watched first. */
export function inProgress(progress: Record<string, Progress>): Progress[] {
  return Object.values(progress)
    .filter((p) => p.duration > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** "S3 E7 · Fly" for an episode, nothing for a film. */
export function episodeLine(episode?: Progress['episode']): string | undefined {
  if (!episode) return undefined
  const label = `S${episode.season} E${episode.episode}`
  return episode.name ? `${label} · ${episode.name}` : label
}

/** "S3 E7": the episode alone, for edge print. */
export const episodeShort = (episode?: Progress['episode']) => (episode ? `S${episode.season} E${episode.episode}` : undefined)

const hdrNames: Record<string, string> = { DV: 'Dolby Vision', 'HDR10+': 'HDR10+', HDR10: 'HDR10', HDR: 'HDR', HLG: 'HLG' }

type Format = Pick<LastSource, 'resolution' | 'hdr' | 'quality' | 'audio' | 'audioChannels'>

/** The format of the source a title was last played from, as edge print: ["2160p", "DV", "TrueHD 7.1"], in the
 *  order a viewer reads it: picture, then sound (the release's kind, "REMUX", when its sound isn't known).
 *  Empty when nothing is known, so nothing is invented. */
export function formatPrint(last?: Format): string[] {
  if (!last) return []
  const sound = [last.audio?.[0], last.audioChannels].filter(Boolean).join(' ')
  const parts: (string | undefined)[] = [last.resolution, last.hdr?.[0], sound || last.quality]
  return parts.filter((p): p is string => !!p)
}

/** The time left as print: the one fact in yellow, spelled the same ("1h44 left", "18m left") on every strip at
 *  every width. */
export const leftPart = (seconds: number): PrintPart => ({ key: formatLeftShort(seconds), rank: rank.left })

/** When it would end, the fact that must never be cut: it ranks just under the time left. */
export const endsPart = (seconds: number, now: number, locale?: string): PrintPart => ({ text: `ends ${formatClock(endTime(now, seconds), locale)}`, rank: rank.ends })

/** The format as print, each piece its own fact so a narrow strip keeps the resolution and drops the rest. */
export const formatParts = (last?: Format): PrintPart[] => formatPrint(last).map((text) => ({ text, rank: rank.format }))

/** The same in words for the label a screen reader reads: "2160p Dolby Vision REMUX". */
export function formatSpoken(last?: Format): string | undefined {
  if (!last) return undefined
  const words = [last.resolution, last.hdr?.[0] ? (hdrNames[last.hdr[0]] ?? last.hdr[0]) : undefined, last.quality].filter(Boolean)
  return words.length ? words.join(' ') : undefined
}

/** The edge print of something started: "S3 E7 · 18M LEFT · ENDS 21:30 · 2160P · DV". The time left is
 *  the one fact in yellow. */
export function resumePrint(p: Progress, now: number, last?: Format, locale?: string, extra: PrintPart[] = []): PrintPart[] {
  const left = secondsLeft(p)
  const episode = episodeShort(p.episode)
  // `extra` (a series' episodes left) goes right after the time left, where its rank puts it.
  return [...(episode ? [{ text: episode, rank: rank.episode }] : []), leftPart(left), ...extra, endsPart(left, now, locale), ...formatParts(last)]
}

/** The part of a title's detail edge print needs. */
export type PickDetail = Pick<MediaDetail, 'runtime' | 'nextEpisode' | 'lastEpisode' | 'seasons'>

const day = 24 * 60 * 60_000
/** TMDB dates are plain "2026-10-27": a calendar day, not an instant, so read it as local midnight. */
const localDay = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** A series with an episode that aired in the last two weeks is new again. */
const hasNewEpisode = (detail: PickDetail, now: number) => {
  const last = detail.lastEpisode?.airDate
  return !!last && now - localDay(last).getTime() < 14 * day
}

/** The edge print of a title not started, as plain facts. A film: runtime, then (when `ends`) when it
 *  would end if started now, then the rating. A series: NEW EP when one just aired, else how many
 *  seasons, then the rating. Until the detail arrives it says only what the list knew. NEW EP is print like
 *  the rest (yellow is for what you act on), set first. */
export function pickPrint(item: Pick<MediaItem, 'type' | 'rating'>, detail: PickDetail | undefined, now: number, opts: { ends?: boolean; locale?: string } = {}): PrintPart[] {
  const score: PrintPart = { text: item.rating ? item.rating.toFixed(1) : '', rank: rank.rating }
  if (item.type === 'movie') {
    if (!detail?.runtime) return [{ text: 'Film', rank: rank.facts }, score]
    const seconds = detail.runtime * 60
    return [{ text: formatRuntime(seconds), rank: rank.facts }, ...(opts.ends ? [endsPart(seconds, now, opts.locale)] : []), score]
  }
  if (!detail) return [{ text: 'Series', rank: rank.facts }, score]
  const seasons = detail.seasons.filter((s) => s.number > 0).length
  const state: PrintPart = hasNewEpisode(detail, now) ? { text: 'new ep', rank: rank.left } : { text: seasons ? `${seasons} ${seasons === 1 ? 'season' : 'seasons'}` : 'Series', rank: rank.facts }
  return [state, ...(detail.runtime && opts.ends ? [{ text: formatRuntime(detail.runtime * 60), rank: rank.facts }] : []), score]
}

/** "Film · 2024 · Science Fiction, Adventure": the plain facts under a title. `kind: false` leaves out Film or Series,
 *  for a card whose strip already says it. */
export function pickMeta(item: MediaItem, opts: { kind?: boolean } = {}): string {
  const genres = genreNames(item.genres, item.type).slice(0, 2).join(', ')
  return [opts.kind === false ? undefined : item.type === 'movie' ? 'Film' : 'Series', item.year, genres].filter(Boolean).join(' · ')
}

/** What a screen reader says for a started title: "Breaking Bad, season 3 episode 7, 18 minutes left,
 *  ends 9:48 PM, 2160p Dolby Vision". */
export function spokenResume(p: Progress, now: number, locale?: string, last?: Format): string {
  const left = secondsLeft(p)
  const where = p.episode ? `season ${p.episode.season} episode ${p.episode.episode}` : undefined
  return [p.item.title, where, `${spokenDuration(left)} left`, `ends ${formatClock(endTime(now, left), locale)}`, formatSpoken(last)].filter(Boolean).join(', ')
}

/** And for a title not started: "Dune: Part Two, film, 2024, 2 hours 47 minutes, rated 8.2 on TMDB". */
export function spokenPick(item: MediaItem, detail?: PickDetail): string {
  const runtime = detail?.runtime ? spokenDuration(detail.runtime * 60) : undefined
  return [item.title, item.type === 'movie' ? 'film' : 'series', item.year, runtime, item.rating ? `rated ${item.rating.toFixed(1)} on TMDB` : undefined].filter(Boolean).join(', ')
}

/** The first title of a list that has a still to show. */
export const firstWithStill = (items: MediaItem[] | undefined) => items?.find((i) => i.backdrop)
