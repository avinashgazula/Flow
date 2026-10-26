import { settingsStore } from '../store/settings'
import type { MediaDetail } from '../tmdb/types'
import { mdblistRatings, mergeRatings, traktRating } from './mdblist'
import type { Ratings } from './sources'

/* A title page's scores, as FlowKit's CatalogService.ratings: MDBList's (with the viewer's key), filled in with TMDB's
   own score from the details and with Trakt's community score when MDBList lacks it. Every source fails on its own:
   a title with only TMDB's score still shows that one. Sample data answers from the sample catalogue and asks no one. */

type Subject = Pick<MediaDetail, 'type' | 'id' | 'imdb' | 'rating' | 'voteCount'>

/** The sample catalogue's scores, from its TMDB rating with the apps' formulas (DemoTransport.mdblist), so the
 *  numbers are the same on every device and in every capture. */
export function demoRatings(base: number): Ratings {
  return {
    imdb: Math.round(Math.min(9.6, base + 0.2) * 10) / 10,
    imdbVotes: 1_200_000,
    tomatometer: Math.trunc(Math.min(99, base * 11)),
    popcornmeter: Math.trunc(Math.min(98, base * 10.8)),
    metacritic: Math.trunc(Math.min(96, base * 9.6)),
    tmdb: Math.trunc(base * 10) / 10,
    letterboxd: Math.round((base / 2) * 10) / 10,
    trakt: Math.trunc(base * 10),
  }
}

export async function loadRatings(d: Subject, signal?: AbortSignal): Promise<Ratings> {
  const s = settingsStore.get()
  const own: Ratings = { tmdb: d.rating, tmdbVotes: d.voteCount }
  if (s.demo) return mergeRatings(demoRatings(d.rating ?? 7), own)
  let found: Ratings = {}
  const key = s.mdblistKey?.trim()
  // A refused key or a busy MDBList leaves TMDB's score and Trakt's; Settings is where a bad key is reported.
  if (key) found = await mdblistRatings(d.type, d.id, key, { signal }).catch(() => ({}))
  let ratings = mergeRatings(found, own)
  const clientID = s.traktClientID.trim()
  if (ratings.trakt === undefined && clientID && d.imdb) {
    const trakt = await traktRating(d.type, d.imdb, clientID, { signal })
    if (trakt !== undefined) ratings = { ...ratings, trakt }
  }
  return ratings
}
