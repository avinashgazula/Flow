import { useQuery } from '@tanstack/react-query'
import { scope } from '../../lib/queries'
import { ratingLink, ratingTitle, scoreText, shownSources, spokenScore, type Ratings as Scores, type RatingSource } from '../../lib/ratings/sources'
import { useSettings } from '../../lib/store/settings'
import type { MediaDetail } from '../../lib/tmdb/types'
import s from './DetailScreen.module.css'

/** The scores Settings → Metadata chooses, in its order: each an aligned number with the site's name under it, as the
 *  apps print them, and no logos or boxes. TMDB's own score is there at once; the rest (MDBList, with the viewer's key)
 *  join it when they arrive. A score is a link to that site's page for the title unless Settings turns that off. */
export function Ratings({ detail: d, ready }: { detail: MediaDetail; ready: boolean }) {
  const chosen = useSettings((x) => x.ratingsShown)
  const links = useSettings((x) => x.tapRatingOpensReviews !== false)
  const mdblist = useSettings((x) => !!x.mdblistKey?.trim())
  const trakt = useSettings((x) => !!x.traktClientID.trim())
  const { data } = useQuery({
    queryKey: [...scope(), 'ratings', d.type, d.id, mdblist, trakt],
    queryFn: ({ signal }) => import('../../lib/ratings/load').then((m) => m.loadRatings(d, signal)),
    enabled: ready,
    staleTime: 24 * 60 * 60_000,
  })
  const ratings: Scores = data ?? { tmdb: d.rating, tmdbVotes: d.voteCount }
  const shown = shownSources(chosen).flatMap((source) => {
    const text = scoreText(source, ratings)
    return text ? [{ source, text }] : []
  })
  if (shown.length === 0) return null

  return (
    <ul className={s.ratings} aria-label="Ratings">
      {shown.map(({ source, text }) => {
        const href = links ? ratingLink(source, { type: d.type, title: d.title, tmdb: d.id, imdb: d.imdb }) : undefined
        const spoken = spokenScore(source, text) + votesFor(source, ratings)
        const inside = (
          <>
            <b className={s.score}>{text}</b>
            <span className={s.source}>{ratingTitle(source)}</span>
          </>
        )
        return (
          <li key={source}>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" aria-label={`${spoken}. Opens ${ratingTitle(source)}.`}>
                {inside}
              </a>
            ) : (
              <div className={s.plain} role="group" aria-label={spoken}>
                {inside}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const compact = new Intl.NumberFormat('en', { notation: 'compact' })

/** ", from 640K votes" for the sources that report a count. */
function votesFor(source: RatingSource, r: Scores): string {
  const votes = source === 'imdb' ? r.imdbVotes : source === 'tmdb' ? r.tmdbVotes : undefined
  return votes ? `, from ${compact.format(votes)} votes` : ''
}
