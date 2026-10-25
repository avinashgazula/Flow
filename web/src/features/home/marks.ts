import { rank, type PrintPart } from '../../components/stripLayout'
import type { EpisodeRef, HistoryEntry, Library } from '../../lib/store/library'
import { parseCode } from '../../lib/watching'
import type { MediaItem } from '../../lib/tmdb/types'
import { showStatus, watchedByShow, type AiringDetail } from './continue'

/* What a poster says about what has been watched: "WATCHED" printed on its strip (nothing drawn over the
   artwork), with the perforations filled to match, and "3/10" for a series part way through. As the apps'
   posters (`EdgePrint.poster(watched:, episodesWatched:, episodesAired:)`). */

const movieSets = new WeakMap<readonly HistoryEntry[], Set<string>>()
/** The keys of films that are in the history. Cached per history list, so a grid of hundreds of posters
 *  builds it once per change, not once per poster. */
export function watchedMovieKeys(history: readonly HistoryEntry[]): ReadonlySet<string> {
  let set = movieSets.get(history)
  if (!set) {
    set = new Set(history.filter((h) => h.item.type === 'movie').map((h) => h.key))
    movieSets.set(history, set)
  }
  return set
}

const showMaps = new WeakMap<object, Map<number, EpisodeRef[]>>()
const rewatchMaps = new WeakMap<object, WeakMap<object, Map<number, EpisodeRef[]>>>()
/** Each show's watched episodes, cached per marks object for the same reason. During a rewatch only the episodes
 *  watched again count, as on the title page (lib/watching.ts), so Up Next follows the rewatch. */
export function watchedShowsOf(marks: Record<string, number>, rewatches?: Library['rewatches']): ReadonlyMap<number, EpisodeRef[]> {
  let map = showMaps.get(marks)
  if (!map) {
    map = watchedByShow(marks)
    showMaps.set(marks, map)
  }
  if (!rewatches || Object.keys(rewatches).length === 0) return map
  let byRewatch = rewatchMaps.get(marks)
  if (!byRewatch) rewatchMaps.set(marks, (byRewatch = new WeakMap()))
  let merged = byRewatch.get(rewatches)
  if (!merged) {
    merged = new Map(map)
    for (const [key, rewatch] of Object.entries(rewatches)) {
      const id = /^show:(\d+)$/.exec(key)?.[1]
      if (id) merged.set(Number(id), rewatch.watched.flatMap((c) => parseCode(c) ?? []))
    }
    byRewatch.set(rewatches, merged)
  }
  return merged
}

export interface PosterMarks {
  /** Print for the strip, set first so the narrowest strip keeps it. */
  parts: PrintPart[]
  /** How much of the reel is watched, 0 to 1: the strip's perforations. Absent when nothing is. */
  progress?: number
  /** For a screen reader. */
  spoken?: string
}

const none: PosterMarks = { parts: [] }

export function posterMarks(
  item: Pick<MediaItem, 'type' | 'id'>,
  watched: { movies: ReadonlySet<string>; shows: ReadonlyMap<number, EpisodeRef[]> },
  detail: AiringDetail | undefined,
  now: number,
  show: { watched: boolean; episodes: boolean },
): PosterMarks {
  if (item.type === 'movie') {
    if (!show.watched || !watched.movies.has(`movie:${item.id}`)) return none
    return { parts: [{ text: 'watched', rank: rank.left }], progress: 1, spoken: 'watched' }
  }
  const episodes = watched.shows.get(item.id)
  if (!episodes || !detail) return none
  const status = showStatus(episodes, detail, now)
  if (status.aired === 0 || status.watched === 0) return none
  if (status.complete) return show.watched ? { parts: [{ text: 'watched', rank: rank.left }], progress: 1, spoken: 'watched' } : none
  if (!show.episodes) return none
  return { parts: [{ text: `${status.watched}/${status.aired}`, rank: rank.episode }], progress: status.watched / status.aired, spoken: `${status.watched} of ${status.aired} episodes watched` }
}
