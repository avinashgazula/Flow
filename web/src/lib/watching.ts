import { episodeCode, episodeKey, type EpisodeRef, type Library } from './store/library'

/* What a series's watching means, as FlowKit's ShowWatchState, Rewatch and LocalTracker.nextShuffle: which
   episodes count as watched, which is next, and which Shuffle picks. Pure functions over the library's plain data,
   so the title page and Home (Up Next) read one answer. */

/** "s3e7" back to an episode. */
export function parseCode(code: string): EpisodeRef | undefined {
  const m = /^s(\d+)e(\d+)$/.exec(code)
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : undefined
}

const compare = (a: EpisodeRef, b: EpisodeRef) => a.season - b.season || a.episode - b.episode

/** Season 0 is Specials: Next Up, Shuffle and the aired count leave them out, as the apps do. */
const regular = (list: EpisodeRef[]) => list.filter((e) => e.season > 0).sort(compare)

/** The first unwatched episode after the furthest one watched, among the aired ones; the first episode when
 *  nothing is watched. As ShowWatchState.nextUp. */
export function nextUp(aired: EpisodeRef[], watched: Iterable<EpisodeRef>): EpisodeRef | undefined {
  const episodes = regular(aired)
  const seen = [...watched].filter((e) => e.season > 0)
  if (!seen.length) return episodes[0]
  const furthest = seen.reduce((a, b) => (compare(a, b) >= 0 ? a : b))
  const done = new Set(seen.map(episodeCode))
  return episodes.find((e) => compare(e, furthest) > 0 && !done.has(episodeCode(e)))
}

/** The episodes of a show that count as watched. During a rewatch only the ones watched again do (the plays before
 *  it stay in History), as the apps' `isEpisodeWatched`; otherwise every episode marked watched. */
export function watchedEpisodes(library: Pick<Library, 'watchedEpisodes' | 'rewatches'>, showId: number): EpisodeRef[] {
  const rewatch = library.rewatches?.[`show:${showId}`]
  if (rewatch) return rewatch.watched.flatMap((c) => parseCode(c) ?? [])
  const prefix = `show:${showId}:`
  return Object.keys(library.watchedEpisodes).flatMap((k) => (k.startsWith(prefix) ? (parseCode(k.slice(prefix.length)) ?? []) : []))
}

/** Whether one episode counts as watched, by the same rule. */
export function isWatched(library: Pick<Library, 'watchedEpisodes' | 'rewatches'>, showId: number, e: EpisodeRef): boolean {
  const rewatch = library.rewatches?.[`show:${showId}`]
  return rewatch ? rewatch.watched.includes(episodeCode(e)) : episodeKey(showId, e) in library.watchedEpisodes
}

/** Aired when it has an air date that is today or earlier; an episode TMDB gives no date is not yet scheduled. */
export const isAired = (airDate: string | undefined, today: string) => !!airDate && airDate <= today

/** Whether every aired episode is watched (and there is one): what makes a show "Watched". */
export function allWatched(aired: EpisodeRef[], watched: Iterable<EpisodeRef>): boolean {
  const episodes = regular(aired)
  const done = new Set([...watched].map(episodeCode))
  return episodes.length > 0 && episodes.every((e) => done.has(episodeCode(e)))
}

/** Picks the episode Shuffle plays: one not yet picked in this round (the round starts over once every episode
 *  has been picked), preferring one not yet watched, and any when all are. Returns the new list of picks to keep. */
export function pickShuffle(aired: EpisodeRef[], played: string[], watched: Iterable<EpisodeRef>, random: () => number = Math.random): { pick: EpisodeRef; played: string[] } | undefined {
  const pool = regular(aired)
  if (!pool.length) return undefined
  let round = played
  let remaining = pool.filter((e) => !round.includes(episodeCode(e)))
  if (!remaining.length) {
    round = []
    remaining = pool
  }
  const seen = new Set([...watched].map(episodeCode))
  const fresh = remaining.filter((e) => !seen.has(episodeCode(e)))
  const choices = fresh.length ? fresh : remaining
  const pick = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!
  return { pick, played: [...round, episodeCode(pick)] }
}
