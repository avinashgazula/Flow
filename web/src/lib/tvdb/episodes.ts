import type { Episode } from '../tmdb/types'
import type { TVDBEpisode } from './client'

/* Episode numbering from another source than TMDB, as FlowKit's EpisodeProvider. TVDB (and Trakt, which numbers the
   same way) match what most stream sources and media servers use: multi-part premieres, specials and anime split the
   seasons as the releases do, where TMDB follows its own editors. Picking a source changes which episode is S2 E5
   everywhere in Flow, so progress, Next Up and the player all follow it.

   The episodes keep TMDB's pictures where the numbering lines up, since stills always come from TMDB, and fall back to
   TMDB's whole list when the other source has nothing (no key, no id for the series, an error). */

const artwork = 'https://artworks.thetvdb.com'

/** TVDB's picture addresses are whole, but one that isn't (a bare path) is read as an artwork path. */
const pictureURL = (image: string | null | undefined) => (image ? (/^https?:\/\//i.test(image) ? image : `${artwork}${image.startsWith('/') ? '' : '/'}${image}`) : undefined)

/** TVDB's episodes as Flow's. One without a season or an episode number can't be placed and is left out. */
export function fromTVDB(list: readonly TVDBEpisode[]): Episode[] {
  return list.flatMap((e) => {
    if (typeof e.seasonNumber !== 'number' || typeof e.number !== 'number') return []
    return [
      {
        id: e.id,
        season: e.seasonNumber,
        number: e.number,
        name: e.name?.trim() || `Episode ${e.number}`,
        overview: e.overview?.trim() ?? '',
        still: pictureURL(e.image),
        airDate: e.aired?.slice(0, 10) || undefined,
        runtime: e.runtime || undefined,
      },
    ]
  })
}

/** A Trakt season as `/shows/{id}/seasons?extended=episodes,full` returns it. */
export interface TraktSeason {
  number?: number
  episodes?: { season?: number; number?: number; title?: string | null; overview?: string | null; first_aired?: string | null; runtime?: number | null; ids?: { trakt?: number } }[]
}

/** Trakt's episodes as Flow's. `first_aired` is a moment in UTC; the day is what a card shows. */
export function fromTrakt(seasons: readonly TraktSeason[]): Episode[] {
  return seasons.flatMap((s) =>
    (s.episodes ?? []).flatMap((e) => {
      const season = e.season ?? s.number
      if (typeof season !== 'number' || typeof e.number !== 'number') return []
      return [{ id: e.ids?.trakt ?? season * 1000 + e.number, season, number: e.number, name: e.title?.trim() || `Episode ${e.number}`, overview: e.overview?.trim() ?? '', airDate: e.first_aired?.slice(0, 10) || undefined, runtime: e.runtime || undefined }]
    }),
  )
}

const refOf = (e: Episode) => `${e.season}x${e.number}`
const byRef = (a: Episode, b: Episode) => a.season - b.season || a.number - b.number

/** The other source's episodes with what TMDB adds where the numbering lines up: TMDB's still (the other source's own
 *  picture stays where TMDB has none), its score, and its runtime and synopsis where the other source left them empty. */
export function withTMDB(episodes: readonly Episode[], tmdb: readonly Episode[]): Episode[] {
  const index = new Map(tmdb.map((e) => [refOf(e), e]))
  return episodes
    .map((e) => {
      const match = index.get(refOf(e))
      if (!match) return e
      return { ...e, still: match.still ?? e.still, rating: e.rating ?? match.rating, runtime: e.runtime ?? match.runtime, overview: e.overview || match.overview }
    })
    .sort(byRef)
}

/** Episodes by season number, each season in order. */
export function bySeason(episodes: readonly Episode[]): Record<number, Episode[]> {
  const out: Record<number, Episode[]> = {}
  for (const e of [...episodes].sort(byRef)) (out[e.season] ??= []).push(e)
  return out
}

/** Maps the viewer's language (BCP 47, "pt-BR") to TVDB's three-letter code, for the languages TVDB translates most. */
export function tvdbLanguage(language: string): string {
  const map: Record<string, string> = {
    en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', ja: 'jpn', ko: 'kor', zh: 'zho', ru: 'rus', nl: 'nld', sv: 'swe',
    da: 'dan', no: 'nor', nb: 'nor', fi: 'fin', pl: 'pol', tr: 'tur', hi: 'hin', ar: 'ara', he: 'heb', cs: 'ces', hu: 'hun', el: 'ell', th: 'tha',
  }
  return map[language.slice(0, 2).toLowerCase()] ?? 'eng'
}
