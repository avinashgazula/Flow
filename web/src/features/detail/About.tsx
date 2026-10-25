import { useSettings } from '../../lib/store/settings'
import { userLocale } from '../../lib/time'
import type { MediaDetail } from '../../lib/tmdb/types'
import { aboutRows, formatDay } from './logic'
import s from './DetailScreen.module.css'

/** Everything factual about a title in one table at the foot of its page: the essentials (release, runtime, seasons,
 *  director, rating) always, and with About on in Settings the rest (status, language, country, budget, revenue,
 *  production companies, network), as the apps list them. Then what only a page has room for: the next episode, the
 *  collection and links out. */
export function About({ detail: d }: { detail: MediaDetail }) {
  const full = useSettings((x) => x.showAboutSection)
  const rows = aboutRows(d, { full, locale: userLocale })
  const extra: { label: string; value: string }[] = []
  if (full && d.nextEpisode) extra.push({ label: 'Next Episode', value: `S${d.nextEpisode.season} E${d.nextEpisode.number} · ${formatDay(d.nextEpisode.airDate, userLocale) ?? 'soon'}` })
  if (full && d.collection) extra.push({ label: 'Collection', value: d.collection.name })
  const kind = d.type === 'movie' ? 'movie' : 'tv'
  return (
    <section className={s.section} aria-labelledby="about-title">
      <h2 id="about-title" className={s.sectionTitle}>
        About
      </h2>
      <dl className={s.facts}>
        {[...rows, ...extra].map(({ label, value, ...rest }) => (
          <div key={label} data-wide={'wide' in rest ? '' : undefined}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {d.imdb && (
          <div>
            <dt>Links</dt>
            <dd className={s.links}>
              <a href={`https://www.imdb.com/title/${d.imdb}/`} target="_blank" rel="noreferrer">
                IMDb
              </a>
              <a href={`https://www.themoviedb.org/${kind}/${d.id}`} target="_blank" rel="noreferrer">
                TMDB
              </a>
              <a href={`https://trakt.tv/search/tmdb/${d.id}?id_type=${d.type === 'movie' ? 'movie' : 'show'}`} target="_blank" rel="noreferrer">
                Trakt
              </a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
