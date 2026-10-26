import { useQuery } from '@tanstack/react-query'
import { rank, type PrintPart } from '../../components/stripLayout'
import { queryClient } from '../../lib/queryClient'
import { useSettings, type ServerConfig } from '../../lib/store/settings'
import type { ServerTitle } from '../../lib/sources/types'
import type { EpisodeRef, HistoryEntry, Library } from '../../lib/store/library'
import { parseCode } from '../../lib/watching'
import type { MediaItem, MediaType } from '../../lib/tmdb/types'
import { showStatus, watchedByShow, type AiringDetail } from './continue'

/* What a poster says about what has been watched: "WATCHED" printed on its strip (nothing drawn over the
   artwork), with the perforations filled to match, and "3/10" for a series part way through. As the apps'
   posters (`EdgePrint.poster(watched:, episodesWatched:, episodesAired:, onServer:)`). A title that is on one of the
   viewer's media servers says SERVER after its rating: print about where to find it, never a badge on the artwork. */

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
  /** Print that goes after the rest of the strip's facts (after the rating), the lowest priority: SERVER. */
  tail?: PrintPart[]
  /** For a screen reader. */
  spoken?: string
}

const none: PosterMarks = { parts: [] }

const serverPrint: PrintPart[] = [{ text: 'server', rank: rank.year }]

/** What has been watched, plus SERVER for a title on one of the viewer's media servers. */
export function posterMarks(
  item: Pick<MediaItem, 'type' | 'id'>,
  watched: { movies: ReadonlySet<string>; shows: ReadonlyMap<number, EpisodeRef[]> },
  detail: AiringDetail | undefined,
  now: number,
  show: { watched: boolean; episodes: boolean },
  onServer = false,
): PosterMarks {
  const marks = watchMarks(item, watched, detail, now, show)
  if (!onServer) return marks
  return { ...marks, tail: serverPrint, spoken: [marks.spoken, 'on your server'].filter(Boolean).join(', ') }
}

function watchMarks(
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

// MARK: What is on the viewer's servers

/* Which titles are on a media server, kept small: FlowKit's MediaServerIndex. Every film and series the servers list
   is reduced to its TMDB id; the few that carry none (a library the server never matched) are kept by title and year
   instead. That is all "Server" on a poster and "Only Show My Server's Content" need to ask. The questions are pure
   and tested without a browser; below them are the query that fills the index and the hooks that read it (posters,
   Search and Home's shelves ask through `useServerLookup`, and nothing is asked of a server until one needs the
   answer). They live with the poster marks so the code every poster shares is one chunk. */

export interface ServerIndex {
  movies: number[]
  shows: number[]
  /** `titleKey`s of titles with no TMDB id. */
  titles: string[]
  /** Titles listed in all, with or without an id. */
  count: number
  /** Servers that didn't answer, by name, so Settings can say which. */
  failed: string[]
}

/** Lower case, accents and punctuation gone ("Amélie" and "Amelie!" are one title), as the matcher in
 *  parser.ts does it; kept here so this file loads with a poster and nothing else. */
export function normaliseTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export const titleKey = (type: MediaType, title: string, year?: number) => `${type}|${normaliseTitle(title)}|${year ?? ''}`

export function buildIndex(titles: readonly ServerTitle[], failed: string[] = []): ServerIndex {
  const movies = new Set<number>()
  const shows = new Set<number>()
  const byTitle = new Set<string>()
  for (const t of titles) {
    if (t.tmdb) (t.type === 'movie' ? movies : shows).add(t.tmdb)
    else if (t.title) byTitle.add(titleKey(t.type, t.title, t.year))
  }
  return { movies: [...movies], shows: [...shows], titles: [...byTitle], count: titles.length, failed }
}

export type OnServer = (item: { type: MediaType; id: number; title: string; year?: number }) => boolean

const lookups = new WeakMap<ServerIndex, OnServer>()

/** The question "is this title on a server?", answered from the index. A TMDB id decides; a title the server
 *  lists without an id matches on its name and year (within a year either side, since servers and TMDB disagree
 *  about premieres), or on its name alone when the server gives no year. Built once per index. */
export function lookup(index: ServerIndex): OnServer {
  let found = lookups.get(index)
  if (!found) {
    const movies = new Set(index.movies)
    const shows = new Set(index.shows)
    const titles = new Set(index.titles)
    found = (item) => {
      if ((item.type === 'movie' ? movies : shows).has(item.id)) return true
      if (titles.size === 0) return false
      if (titles.has(titleKey(item.type, item.title))) return true
      if (item.year === undefined) return false
      return [0, -1, 1].some((d) => titles.has(titleKey(item.type, item.title, item.year! + d)))
    }
    lookups.set(index, found)
  }
  return found
}

/** A server's title as a card needs it, or undefined when TMDB doesn't know it (so its page can't open). With
 *  `artwork` the server's own pictures lead, as Use Server Artwork asks; otherwise TMDB's. */
export function asMediaItem(t: ServerTitle, from?: MediaItem, artwork = false): MediaItem | undefined {
  if (!t.tmdb) return undefined
  const base: MediaItem = from ?? { type: t.type, id: t.tmdb, title: t.title, year: t.year, overview: t.overview ?? '', poster: t.poster, backdrop: t.backdrop, genres: [] }
  if (!artwork) return base
  return { ...base, poster: t.poster ?? base.poster, backdrop: t.backdrop ?? base.backdrop }
}

// MARK: The query and the hooks

const minute = 60_000

/** What the viewer's servers list, refreshed when they change (or every half hour of use), as the apps do at launch. */
export const serverIndexQuery = (servers: readonly ServerConfig[]) => ({
  queryKey: ['servers', 'index', servers.map((s) => s.id).join(',')] as const,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ServerIndex> => (await import('../../lib/sources/serverCatalogue')).loadIndex(servers, signal),
  staleTime: 30 * minute,
  retry: 1,
})

/* The saved copy of the query cache holds the index, which is only ids, but not what a shelf shows: Plex's picture
   addresses carry the sign-in. Those shelves are asked for again on every visit. */
queryClient.setDefaultOptions({
  ...queryClient.getDefaultOptions(),
  dehydrate: { shouldDehydrateQuery: (query) => query.state.status === 'success' && (query.queryKey[0] !== 'servers' || query.queryKey[1] === 'index') },
})

export const enabledServers = (servers: readonly ServerConfig[]) => servers.filter((s) => s.enabled)

export interface ServerLookup {
  /** The viewer has a server on, so "Server" can print and the filter can apply. */
  active: boolean
  /** Print Server on posters of titles that are on one. */
  badge: boolean
  /** Hide everything that isn't on one. */
  only: boolean
  /** The index hasn't answered yet. */
  pending: boolean
  /** The index couldn't be read from any server. */
  failed: boolean
  /** Whether a title is on a server; absent until the index is in. */
  has?: OnServer
  index?: ServerIndex
}

/** The index and the three settings that use it. Without a server, or with both uses off, it asks nothing. */
export function useServerLookup(): ServerLookup {
  const servers = useSettings((s) => s.servers)
  const badgeSetting = useSettings((s) => s.showBadgeOnPosters)
  const onlySetting = useSettings((s) => s.onlyShowServerContent)
  const on = enabledServers(servers)
  const badge = on.length > 0 && badgeSetting !== false
  const only = on.length > 0 && onlySetting === true
  const index = useQuery({ ...serverIndexQuery(on), enabled: badge || only })
  return { active: on.length > 0, badge, only, pending: (badge || only) && index.isPending, failed: index.isError && !index.data, has: index.data && lookup(index.data), index: index.data }
}

/** Whether a title is on a server and should say so. */
export function useOnServer(item: { type: MediaType; id: number; title: string; year?: number }): boolean {
  const server = useServerLookup()
  return server.badge && !!server.has?.(item)
}

/** Drops what is known of the servers' titles and asks again: Settings → Media Servers → Refresh Library Index. */
export const refreshServerIndex = () => queryClient.invalidateQueries({ queryKey: ['servers'] })
