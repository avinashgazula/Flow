import type { EpisodeRef, HistoryEntry, Progress } from '../../lib/store/library'
import type { MediaDetail, MediaItem } from '../../lib/tmdb/types'

/* What to carry on with, as plain functions: which episodes of a series are out, which is next, how many are
   left. The apps get this from their tracker (ShowWatchState.nextUp); the website has the episodes marked
   watched on this device (`watchedEpisodes`) and TMDB's seasons, and works it out from those. */

const day = 24 * 60 * 60_000
/** TMDB dates are calendar days, not instants: read one as local midnight. */
const localDay = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** "show:1396:s3e7" back into its parts; anything else is not an episode mark. */
export function parseEpisodeKey(key: string): { showId: number; season: number; episode: number } | undefined {
  const m = /^show:(\d+):s(\d+)e(\d+)$/.exec(key)
  return m ? { showId: Number(m[1]), season: Number(m[2]), episode: Number(m[3]) } : undefined
}

/** Every show's watched episodes, from the library's marks. */
export function watchedByShow(marks: Record<string, number>): Map<number, EpisodeRef[]> {
  const byShow = new Map<number, EpisodeRef[]>()
  for (const key of Object.keys(marks)) {
    const p = parseEpisodeKey(key)
    if (!p) continue
    const list = byShow.get(p.showId) ?? []
    list.push({ season: p.season, episode: p.episode })
    byShow.set(p.showId, list)
  }
  return byShow
}

/** Season then episode, the order they air in. */
export const byAir = (a: EpisodeRef, b: EpisodeRef) => a.season - b.season || a.episode - b.episode
const same = (a: EpisodeRef, b: EpisodeRef) => a.season === b.season && a.episode === b.episode

export type AiringDetail = Pick<MediaDetail, 'seasons' | 'nextEpisode' | 'lastEpisode'>

/** The episodes that have aired, in order, outside Specials. A season counts all its episodes once a later
 *  one has begun; the season TMDB says is still airing counts up to its last aired episode (the one before
 *  `nextEpisode`, or `lastEpisode` itself); a season that starts in the future counts none. */
export function airedEpisodes(detail: AiringDetail, now: number): EpisodeRef[] {
  const next = detail.nextEpisode
  // The next episode may already be out (TMDB lags a day behind): then it is the latest that has aired.
  const nextOut = !!next && !!next.airDate && localDay(next.airDate) <= now
  const coming = next && !nextOut ? next : undefined
  const latest = nextOut ? next : detail.lastEpisode
  const aired: EpisodeRef[] = []
  for (const season of [...detail.seasons].filter((s) => s.number > 0).sort((a, b) => a.number - b.number)) {
    let count = season.episodeCount
    if (season.airDate && localDay(season.airDate) > now) count = 0
    else if (coming) {
      if (season.number > coming.season) count = 0
      else if (season.number === coming.season) count = Math.min(count, coming.number - 1)
    } else if (latest) {
      if (season.number > latest.season) count = 0
      else if (season.number === latest.season) count = Math.min(count, latest.number)
    }
    for (let e = 1; e <= count; e++) aired.push({ season: season.number, episode: e })
  }
  return aired
}

/** The first aired episode after the furthest one watched that isn't itself watched; the first episode when
 *  nothing is watched; nothing when the viewer is caught up. As the apps' ShowWatchState.nextUp. */
export function nextUp(watched: readonly EpisodeRef[], aired: readonly EpisodeRef[]): EpisodeRef | undefined {
  const regular = aired.filter((e) => e.season > 0).sort(byAir)
  const seen = watched.filter((e) => e.season > 0)
  if (seen.length === 0) return regular[0]
  const furthest = [...seen].sort(byAir).at(-1)!
  return regular.find((e) => byAir(e, furthest) > 0 && !seen.some((w) => same(w, e)))
}

export interface ShowStatus {
  /** Aired episodes watched, and aired in all: the "3/10" of a poster. */
  watched: number
  aired: number
  /** Aired and not watched: the "5 episodes left" of a card. */
  left: number
  next?: EpisodeRef
  /** Everything that has aired is watched (and something has aired). */
  complete: boolean
}

export function showStatus(watched: readonly EpisodeRef[], detail: AiringDetail, now: number): ShowStatus {
  const aired = airedEpisodes(detail, now)
  const done = aired.filter((e) => watched.some((w) => same(w, e))).length
  return { watched: done, aired: aired.length, left: aired.length - done, next: nextUp(watched, aired), complete: aired.length > 0 && done === aired.length }
}

/** "5 episodes left", "1 episode left". */
export const episodesLeftText = (n: number) => `${n} ${n === 1 ? 'episode' : 'episodes'} left`

// MARK: Continue Watching

export interface ContinueEntry {
  /** The title's key, "show:1396". One entry per title: what's in progress wins over a next episode. */
  key: string
  item: MediaItem
  /** Where the viewer left off; absent for a next episode. */
  progress?: Progress
  episode?: EpisodeRef
  /** When it was last watched, for the order. */
  updatedAt: number
  nextUp: boolean
}

export interface NextUpInput {
  key: string
  item: MediaItem
  episode: EpisodeRef
  updatedAt: number
}

/** What's in progress and the next episodes of shows being followed, most recently watched first, each title
 *  once. `limit` keeps the most recent; null keeps all. */
export function continueEntries(resumes: readonly Progress[], nexts: readonly NextUpInput[], limit: number | null = null): ContinueEntry[] {
  const entries = new Map<string, ContinueEntry>()
  for (const p of resumes) entries.set(p.key, { key: p.key, item: p.item, progress: p, episode: p.episode, updatedAt: p.updatedAt, nextUp: false })
  for (const n of nexts) if (!entries.has(n.key)) entries.set(n.key, { key: n.key, item: n.item, episode: n.episode, updatedAt: n.updatedAt, nextUp: true })
  const sorted = [...entries.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  return limit === null ? sorted : sorted.slice(0, limit)
}

/** The shows to look for a next episode of: those in the history, the most recently watched first, without the
 *  ones already in progress. */
export function followedShows(history: readonly HistoryEntry[], inProgress: ReadonlySet<string>, max: number): { key: string; item: MediaItem; watchedAt: number }[] {
  const shows = new Map<string, { key: string; item: MediaItem; watchedAt: number }>()
  for (const h of history) {
    if (h.item.type !== 'show' || inProgress.has(h.key)) continue
    const have = shows.get(h.key)
    if (!have || h.watchedAt > have.watchedAt) shows.set(h.key, { key: h.key, item: h.item, watchedAt: h.watchedAt })
  }
  return [...shows.values()].sort((a, b) => b.watchedAt - a.watchedAt).slice(0, max)
}

export const msPerDay = day
