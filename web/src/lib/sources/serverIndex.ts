import type { MediaItem, MediaType } from '../tmdb/types'
import type { ServerTitle } from './types'

/* What is on the viewer's servers, kept small: FlowKit's MediaServerIndex. Every film and series the servers
   list is reduced to its TMDB id; the few that carry none (a library the server never matched) are kept by title
   and year instead. That is all "Server" on a poster and "Only Show My Server's Content" need to ask. Pure, so it
   is tested without a browser; the query that fills it is in useServerIndex.ts. */

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
