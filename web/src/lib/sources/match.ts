/* Finding a TMDB title on a media server, as FlowKit's ServerMatching: by TMDB id, then IMDb id, then
   by title and year (within a year, since servers and TMDB disagree about premieres). */

import { normalizeTitle } from './parser'
import type { MediaType } from '../tmdb/types'

export interface ServerCandidate {
  itemId: string
  type: MediaType
  title: string
  year?: number
  tmdb?: number
  imdb?: string
}

export interface MatchTarget {
  type: MediaType
  title: string
  year?: number
  tmdb?: number
  imdb?: string
}

export function bestMatch<C extends ServerCandidate>(candidates: C[], want: MatchTarget): C | undefined {
  if (want.tmdb !== undefined) {
    const byTMDB = candidates.find((c) => c.tmdb === want.tmdb && c.type === want.type)
    if (byTMDB) return byTMDB
  }
  if (want.imdb) {
    const byIMDb = candidates.find((c) => c.imdb === want.imdb)
    if (byIMDb) return byIMDb
  }
  const title = normalizeTitle(want.title)
  return candidates.find(
    (c) => c.type === want.type && normalizeTitle(c.title) === title && (want.year === undefined || c.year === undefined || Math.abs(c.year - want.year) <= 1),
  )
}
