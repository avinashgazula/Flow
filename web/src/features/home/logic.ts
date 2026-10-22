import type { LastSource } from '../../lib/sources/lastSource'
import { genreNames } from '../../lib/genres'
import type { Progress } from '../../lib/store/library'
import type { ListingWhen } from '../../components/Listing'
import type { MediaDetail, MediaItem } from '../../lib/tmdb/types'
import { endTime, formatClock, formatShortDay, spokenDuration } from '../../lib/time'

/** What's left of an in-progress title, in seconds. */
export const secondsLeft = (p: Pick<Progress, 'position' | 'duration'>) => Math.max(0, p.duration - p.position)

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

const hdrNames: Record<string, string> = { DV: 'Dolby Vision', 'HDR10+': 'HDR10+', HDR10: 'HDR10', HDR: 'HDR', HLG: 'HLG' }

/** The version line from the source a title was last played from: "2160p · Dolby Vision · REMUX". Plain
 *  text in the order a viewer reads it. Undefined when nothing is known, so nothing is invented. */
export function versionLine(last?: Pick<LastSource, 'resolution' | 'hdr' | 'quality'>): string | undefined {
  if (!last) return undefined
  const parts = [last.resolution, ...(last.hdr?.slice(0, 1).map((h) => hdrNames[h] ?? h) ?? []), last.quality].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

/** The rating as plain text, "8.4 TMDB", or nothing when there isn't one. */
export const ratingText = (item: Pick<MediaItem, 'rating'>) => (item.rating ? `${item.rating.toFixed(1)} TMDB` : undefined)

/** "Film · 2024 · Science Fiction, Adventure · 8.4 TMDB": the plain facts under a pick's title. */
export function pickMeta(item: MediaItem): string {
  const genres = genreNames(item.genres, item.type).slice(0, 2).join(', ')
  return [item.type === 'movie' ? 'Film' : 'Series', item.year, genres, ratingText(item)].filter(Boolean).join(' · ')
}

/** The part of a title's detail a pick's time column needs. */
export type PickDetail = Pick<MediaDetail, 'runtime' | 'nextEpisode' | 'lastEpisode' | 'seasons'>

const day = 24 * 60 * 60_000
/** TMDB dates are plain "2026-10-27": a calendar day, not an instant, so read it as local midnight. */
const localDay = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** What a pick's time column says. A film: when it would end if started now. A series: when its next
 *  episode airs, or when the latest one aired (within a month), or how many episodes there are. Until the
 *  detail arrives, a dash, so the column keeps its place. */
export function pickWhen(item: Pick<MediaItem, 'type'>, detail: PickDetail | undefined, now: number, locale?: string): ListingWhen {
  if (!detail) return { time: '–' }
  if (item.type === 'movie') return detail.runtime ? { ends: detail.runtime * 60 } : { time: '–' }
  const next = detail.nextEpisode?.airDate
  if (next && localDay(next).getTime() + day > now) return { time: formatShortDay(localDay(next), locale), label: 'airs' }
  const last = detail.lastEpisode?.airDate
  if (last && now - localDay(last).getTime() < 30 * day) return { time: formatShortDay(localDay(last), locale), label: 'aired' }
  const episodes = detail.seasons.filter((s) => s.number > 0).reduce((sum, s) => sum + s.episodeCount, 0)
  if (episodes) return { time: String(episodes), label: 'eps' }
  return { time: '–' }
}

/** What a screen reader says for a resume row: "Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:48 PM". */
export function spokenResume(p: Progress, now: number, locale?: string): string {
  const left = secondsLeft(p)
  const where = p.episode ? `season ${p.episode.season} episode ${p.episode.episode}` : undefined
  return [p.item.title, where, `${spokenDuration(left)} left`, `ends ${formatClock(endTime(now, left), locale)}`].filter(Boolean).join(', ')
}

/** And for a pick: "Dune: Part Two, film, 2024, rated 8.2 on TMDB". */
export function spokenPick(item: MediaItem): string {
  return [item.title, item.type === 'movie' ? 'film' : 'series', item.year, item.rating ? `rated ${item.rating.toFixed(1)} on TMDB` : undefined].filter(Boolean).join(', ')
}

/** The first titles of a list that have a still to show, for the lead and as a stand-in while the
 *  catalogue loads. */
export const firstWithStill = (items: MediaItem[] | undefined) => items?.find((i) => i.backdrop)
