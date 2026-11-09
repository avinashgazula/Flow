import { queryOptions } from '@tanstack/react-query'
import { rememberItem, scope } from '../queries'
import { items, tmdb } from './client'
import type { Collection } from './types'

/* A film collection (a franchise), as FlowKit's TMDBClient.collection: its own chunk, fetched when a title page's Collection
   row is near the screen or the Collection page opens, so no other page carries it. */

/** A collection from TMDB's `/collection/{id}`: its films oldest first, as FlowKit sorts them, with the undated (not yet
 *  scheduled) last. */
export function buildCollection(raw: any): Collection {
  const date = (m: { date?: string }) => m.date ?? '9999'
  return {
    id: raw.id,
    name: raw.name ?? '',
    overview: raw.overview ?? '',
    poster: raw.poster_path ?? undefined,
    backdrop: raw.backdrop_path ?? undefined,
    parts: items(raw.parts, 'movie').sort((a, b) => date(a).localeCompare(date(b))),
  }
}

export const collectionQuery = (id: number) =>
  queryOptions({
    queryKey: [...scope(), 'collection', id],
    queryFn: async () => {
      const collection = buildCollection(await tmdb(`/collection/${id}`))
      // Opening one of its films shows what the card knew at once.
      collection.parts.forEach(rememberItem)
      return collection
    },
    staleTime: 24 * 60 * 60_000,
  })
