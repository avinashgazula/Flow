import { cleanReview } from './reviewText'
import { settingsStore } from './store/settings'
import { tmdb } from './tmdb/client'
import { tmdbPath, type MediaType, type Review } from './tmdb/types'

/* Reviews for a title, as FlowKit's CatalogService.reviews: TMDB's, plus Trakt's most-liked comments when there is a
   Client ID to ask with, merged newest first so neither source crowds the other. Either failing leaves the other.
   Sample data takes its Trakt comments from the sample catalogue and never calls Trakt. */
export async function fetchReviews(type: MediaType, id: number, imdb?: string): Promise<Review[]> {
  const settings = settingsStore.get()
  const [tmdb, trakt] = await Promise.all([tmdbReviews(type, id).catch(() => [] as Review[]), traktComments(type, imdb, settings.demo, settings.traktClientID.trim())])
  return merged(tmdb, trakt)
}

/** TMDB's written reviews, in the order it returns them, cleaned of entities, tags and Markdown. */
export async function tmdbReviews(type: MediaType, id: number): Promise<Review[]> {
  const raw = await tmdb(`/${tmdbPath(type)}/${id}/reviews`)
  return (raw.results ?? []).map(review).filter((r: Review | undefined): r is Review => !!r)
}

function review(raw: any): Review | undefined {
  const text = cleanReview(typeof raw.content === 'string' ? raw.content : '')
  if (!text) return undefined
  const rating = raw.author_details?.rating
  const at = Date.parse(raw.created_at ?? '')
  return {
    id: `tmdb:${raw.id}`,
    source: 'tmdb',
    author: (typeof raw.author === 'string' && raw.author.trim()) || 'Anonymous',
    text,
    ...(typeof rating === 'number' ? { rating: Math.round(rating) } : {}),
    ...(Number.isFinite(at) ? { date: at } : {}),
    spoiler: false,
  }
}

/** Both lists interleaved, newest first. A review with no date sorts last. */
export const merged = (...lists: Review[][]): Review[] => lists.flat().sort((a, b) => (b.date ?? 0) - (a.date ?? 0))

async function traktComments(type: MediaType, imdb: string | undefined, demo: boolean, clientID: string): Promise<Review[]> {
  try {
    if (demo) {
      const [{ demoComments }, { readComments }] = await Promise.all([import('./tmdb/demo'), import('./trakt/client')])
      return readComments(demoComments())
    }
    if (!clientID || !imdb) return []
    const { createClient } = await import('./trakt/client')
    return await createClient({ clientID: () => clientID, accessToken: async () => null }, (...args) => fetch(...args)).comments(type, imdb)
  } catch {
    return []
  }
}
