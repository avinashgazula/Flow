import { queryOptions } from '@tanstack/react-query'
import { q, scope } from '../queries'
import { queryClient } from '../queryClient'
import { settingsStore } from '../store/settings'
import { api } from '../tmdb/client'
import type { Episode } from '../tmdb/types'
import { tvdbEpisodes } from './client'
import { bySeason, fromTVDB, fromTrakt, tvdbLanguage, withTMDB, type TraktSeason } from './episodes'

/* A season's episodes in the viewer's chosen numbering (Settings → Metadata → Episode Source). The whole series is
   fetched once, from TVDB (or Trakt), and matched to TMDB's seasons for pictures; each season then reads its part,
   so opening a series doesn't make one request per season to the other source. Anything that goes wrong falls back
   to TMDB's own list, as the apps do, so a page never has fewer episodes for trying. */

/** TMDB's episodes for every season the series lists, specials included. */
async function tmdbEpisodes(showId: number, seasons: { number: number }[]): Promise<Episode[]> {
  const lists = await Promise.all(seasons.map((s) => api.season(showId, s.number).catch(() => [] as Episode[])))
  return lists.flat()
}

async function traktEpisodes(imdb: string, clientID: string): Promise<Episode[]> {
  const response = await fetch(`https://api.trakt.tv/shows/${encodeURIComponent(imdb)}/seasons?extended=episodes,full`, { headers: { 'trakt-api-version': '2', 'trakt-api-key': clientID }, credentials: 'omit' })
  return response.ok ? fromTrakt((await response.json()) as TraktSeason[]) : []
}

const show = (showId: number) =>
  queryOptions({
    queryKey: [...scope(), 'numbered-episodes', showId, settingsStore.get().episodeSource ?? 'tvdb'],
    staleTime: 24 * 60 * 60_000,
    queryFn: async (): Promise<Record<number, Episode[]>> => {
      const s = settingsStore.get()
      const d = await queryClient.ensureQueryData(q.detail('show', showId))
      const tmdb = await tmdbEpisodes(showId, d.seasons)
      let other: Episode[] = []
      try {
        if (s.episodeSource === 'trakt') other = d.imdb && s.traktClientID.trim() ? await traktEpisodes(d.imdb, s.traktClientID.trim()) : []
        else if (d.tvdb && s.tvdbKey?.trim()) other = fromTVDB(await tvdbEpisodes(d.tvdb, s.tvdbKey.trim(), tvdbLanguage(s.language)))
      } catch {
        other = []
      }
      return bySeason(other.length ? withTMDB(other, tmdb) : tmdb)
    },
  })

export async function seasonEpisodes(showId: number, season: number): Promise<Episode[]> {
  return (await queryClient.ensureQueryData(show(showId)))[season] ?? []
}
