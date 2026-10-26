import { settingsStore } from '../store/settings'
import type { MediaType } from '../tmdb/types'

/* RatingPosterDB: the poster with its ratings drawn on, as FlowKit's RatingPosterDB. It is an image-address swap and
   nothing else: the same <img> shows the swapped poster, and the service answers with the plain poster when it has no
   ratings art for a title (`fallback=true`). api.ratingposterdb.com sends `Access-Control-Allow-Origin: *`, and an
   image needs no CORS anyway, so the page asks it directly. */

const base = 'https://api.ratingposterdb.com'

/** The address of a title's rated poster, or undefined without a key. Lists from TMDB carry no IMDb id, so the TMDB id
 *  stands in for it and every shelf gets rated posters. */
export function rpdbPoster(key: string | undefined, t: { type: MediaType; id: number; imdb?: string }): string | undefined {
  const k = key?.trim()
  if (!k) return undefined
  const imdb = t.imdb?.trim()
  const lookup = imdb ? `imdb/poster-default/${encodeURIComponent(imdb)}` : `tmdb/poster-default/${t.type === 'movie' ? 'movie' : 'series'}-${t.id}`
  return `${base}/${encodeURIComponent(k)}/${lookup}.jpg?fallback=true`
}

/** The poster a card shows: the rated one when Poster Enhancement is on and has a key, else TMDB's own (a path
 *  Artwork turns into a sized, lazy image). A change applies to posters rendered after it, as in the apps. */
export function posterOf<T extends { type: MediaType; id: number; poster?: string; imdb?: string }>(item: T): string | undefined {
  const s = settingsStore.get()
  if (s.posterEnhancement !== 'rpdb' || s.demo || !item.poster) return item.poster
  return rpdbPoster(s.rpdbKey, item) ?? item.poster
}

/** Asks RatingPosterDB whether it knows the key. */
export async function checkRPDBKey(key: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = key.trim()
  if (!value) return { ok: false, error: 'Paste your RatingPosterDB API key.' }
  try {
    const response = await fetch(`${base}/${encodeURIComponent(value)}/isValid`, { signal, credentials: 'omit' })
    if (response.ok) return { ok: true }
    if (response.status === 401 || response.status === 403) return { ok: false, error: 'RatingPosterDB didn’t accept that key. Copy it again from ratingposterdb.com.' }
    return { ok: false, error: `RatingPosterDB answered ${response.status}. Try again in a moment.` }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { ok: false, error: '' }
    return { ok: false, error: 'Couldn’t reach RatingPosterDB. Check your connection and try again.' }
  }
}
