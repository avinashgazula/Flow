import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import { FrameCard, Plate } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import { genreNames } from '../../lib/genres'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceFor, type PlaybackRequest, type Source } from '../../lib/sources'
import { library, mediaKey, useLibrary } from '../../lib/store/library'
import { useSettings } from '../../lib/store/settings'
import { userLocale, useMinuteTick } from '../../lib/time'
import type { MediaDetail, MediaItem, MediaType } from '../../lib/tmdb/types'
import { pickPrint, spokenPick, watchedFraction } from '../home/logic'
import { Episodes } from './Episodes'
import { FilmCan } from './FilmCan'
import { bestSource, formatDay, metaLine, playLabel, titlePrint } from './logic'
import { useSourceSearch } from './useSourceSearch'
import s from './DetailScreen.module.css'

const TrailerSheet = lazy(() => import('./TrailerSheet'))
const SourcePicker = lazy(() => import('../sources/SourcePicker').then((m) => ({ default: m.SourcePicker })))

/** The still's width at each layout, for `srcset`: two columns from 1000px, one below. */
const stillSizes = '(min-width: 1360px) 600px, (min-width: 1000px) 44vw, calc(100vw - 32px)'

/** A title's page: the framed still with its edge strip and the film-can label under it, and beside it
 *  the facts, ratings, the one yellow Play and what the viewer can do with the title. Below: episodes,
 *  where to watch, more like it. */
export function DetailScreen({ type, id, initialSeason, autoPlay }: { type: MediaType; id: number; initialSeason?: number; autoPlay?: boolean }) {
  const { data: d, isPlaceholderData, isError, error } = useQuery(q.detail(type, id))
  const navigate = useNavigate()
  const now = useMinuteTick()
  const [trailer, setTrailer] = useState(false)
  const [picker, setPicker] = useState(false)
  const [copied, setCopied] = useState(false)
  const key = mediaKey(type, id)
  const progress = useLibrary((l) => l.progress[key])
  const inWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === key))
  const isFavourite = useLibrary((l) => l.favourites.some((e) => e.key === key))
  const watched = useLibrary((l) => l.history.some((e) => e.key === key && !e.episode))
  const remember = useSettings((x) => x.rememberLastSource)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // What Play starts: the episode being watched, else the first one of a series.
  const firstEpisode = type === 'show' ? { season: d?.seasons.find((x) => x.number > 0)?.number ?? 1, episode: 1 } : undefined
  const target = progress?.episode ?? firstEpisode

  const play = (episode?: { season: number; episode: number }, source?: Source) => {
    const at = episode ?? target
    void navigate({ to: '/watch/$type/$id', params: { type, id }, search: { ...(at ? { season: at.season, episode: at.episode } : {}), ...(source ? { source: source.id } : {}) } })
  }

  useEffect(() => {
    if (autoPlay && d && !isPlaceholderData) play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, isPlaceholderData])

  // The sources, asked for as soon as the details (and so the IMDb id) are in: the label under the still
  // says what Play would start, and the picker opens on the same answer.
  const request: PlaybackRequest | undefined = useMemo(
    () => (d ? { item: cardOf(d), type, tmdbId: d.id, imdbId: d.imdb, season: target?.season, episode: target?.episode } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d?.id, d?.imdb, d?.title, type, target?.season, target?.episode],
  )
  const search = useSourceSearch(request, !!d && !isPlaceholderData)
  const best = bestSource(search.sources, remember && request ? lastSourceFor(request, search.sources) : undefined)

  if (isError && !d) {
    return (
      <div className="page">
        <h1 className="page-title">Couldn’t Load This Title</h1>
        <p className="muted">{(error as Error).message}</p>
      </div>
    )
  }
  if (!d) return <Ghost />

  const label = playLabel(d, progress, firstEpisode, now, userLocale)
  const rated = d.rating ? d.rating.toFixed(1) : undefined
  const tmdbPage = `https://www.themoviedb.org/${type === 'movie' ? 'movie' : 'tv'}/${d.id}`
  const hasProviders = d.providers.stream.length > 0 || d.providers.rent.length > 0

  return (
    <article className="page">
     <div className={s.wrap}>
      <div className={s.top}>
        <div className={s.still}>
          <div style={{ viewTransitionName: 'title-art' }}>
            <Plate
              shape="still"
              artPath={d.backdrop}
              sizes={stillSizes}
              priority
              progress={progress ? watchedFraction(progress) : undefined}
              print={titlePrint(d, progress, now, userLocale)}
              stripSize="lead"
              fallback={d.title}
            />
          </div>
          <FilmCan search={search} best={best} onOpen={() => setPicker(true)} />
        </div>

        <div className={s.info}>
          <p className={s.meta}>{metaLine(d, genreNames(d.genres, type))}</p>
          <h1 className={s.name}>{d.title}</h1>

          {rated && (
            <ul className={s.ratings}>
              <li>
                <a href={tmdbPage} target="_blank" rel="noreferrer" aria-label={`TMDB rating ${rated}${d.voteCount ? ` from ${compact(d.voteCount)} votes` : ''}. Opens TMDB.`}>
                  <b className={s.score}>{rated}</b>
                  <span className={s.source}>TMDB{d.voteCount ? ` · ${compact(d.voteCount)} votes` : ''}</span>
                </a>
              </li>
            </ul>
          )}

          <div className={s.actions}>
            <button className="btn btn-primary btn-large" onClick={() => play()} aria-label={label.spoken}>
              <Icon name="play" size={18} /> {label.text}
            </button>
            {d.trailer && (
              <button className="btn btn-secondary btn-large" onClick={() => setTrailer(true)}>
                <Icon name="trailer" size={18} /> Trailer
              </button>
            )}
          </div>

          <div className={s.textActions} role="group" aria-label="Your list">
            <TextAction label="Watchlist" on={inWatchlist} onClick={() => library.toggleWatchlist(d)} />
            {type === 'movie' && <TextAction label="Watched" on={watched} onClick={() => library.markWatched(d)} />}
            <TextAction label="Favourite" on={isFavourite} onClick={() => library.toggleFavourite(d)} />
            <TextAction
              label={copied ? 'Link copied' : 'Share'}
              onClick={() =>
                void share(d).then((didCopy) => {
                  if (!didCopy) return
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }
            />
          </div>

          {d.tagline && <p className={s.tagline}>{d.tagline}</p>}
          {d.overview && <p className={s.overview}>{d.overview}</p>}
          {d.crew.length > 0 && (
            <dl className={s.crew}>
              {d.crew.slice(0, 4).map((c) => (
                <div key={`${c.id}${c.role}`}>
                  <dt>{c.role}</dt>
                  <dd>
                    <Link to="/person/$id" params={{ id: c.id }}>
                      {c.name}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {d.cast.length > 0 && <Cast cast={d.cast} />}
        </div>
      </div>

      {type === 'show' && d.seasons.length > 0 && !isPlaceholderData && <Episodes detail={d} initial={initialSeason ?? progress?.episode?.season} onPlay={(e) => play(e)} />}

      {hasProviders && (
        <section className={s.section} aria-labelledby="where-title">
          <h2 id="where-title" className={s.sectionTitle}>
            Where to Watch
          </h2>
          <dl className={s.providers}>
            {d.providers.stream.length > 0 && <Providers kind="Stream" names={d.providers.stream.map((p) => p.name)} href={d.providers.link} />}
            {d.providers.rent.length > 0 && <Providers kind="Rent" names={d.providers.rent.slice(0, 4).map((p) => p.name)} href={d.providers.link} />}
          </dl>
          <p className={s.attribution}>Data from JustWatch</p>
        </section>
      )}

      <Row title="You Might Also Like" items={d.recommendations} now={now} />
      <Row title="Similar" items={d.similar} now={now} />

      {!isPlaceholderData && <Info detail={d} />}

      {trailer && d.trailer && (
        <Suspense fallback={null}>
          <TrailerSheet video={d.trailer} title={d.title} onClose={() => setTrailer(false)} />
        </Suspense>
      )}
      {picker && request && (
        <Suspense fallback={null}>
          <SourcePicker
            request={request}
            seed={search}
            onPick={(source) => {
              setPicker(false)
              play(undefined, source)
            }}
            onClose={() => setPicker(false)}
          />
        </Suspense>
      )}
     </div>
    </article>
  )
}

/** Only what a library entry needs: a full detail would store its cast and recommendations. */
const cardOf = (d: MediaItem): MediaItem => ({
  type: d.type,
  id: d.id,
  title: d.title,
  year: d.year,
  date: d.date,
  overview: d.overview,
  poster: d.poster,
  backdrop: d.backdrop,
  rating: d.rating,
  genres: d.genres,
  originalLanguage: d.originalLanguage,
})

/** A quiet text action: plain ink-2, paper when on, with a check so "on" isn't told by colour alone. */
function TextAction({ label, on, onClick }: { label: string; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={s.textAction} onClick={onClick} aria-pressed={on} aria-live={on === undefined ? 'polite' : undefined}>
      {on && <Icon name="check" size={14} strokeWidth={2.8} />}
      {label}
    </button>
  )
}

/** The cast at one size: a portrait when TMDB has one, else name and role set on a hairline. */
const castShown = 6
function Cast({ cast }: { cast: MediaDetail['cast'] }) {
  const [all, setAll] = useState(false)
  const list = cast.slice(0, all ? 30 : castShown)
  return (
    <section className={s.cast} aria-labelledby="cast-title">
      <h2 id="cast-title" className={s.sectionTitle}>
        Cast
      </h2>
      <ul className={s.castGrid}>
        {list.map((c) => (
          <li key={`${c.id}${c.role}`}>
            <Link to="/person/$id" params={{ id: c.id }} className={s.person} data-photo={c.profile ? '' : undefined}>
              {c.profile && <Artwork path={c.profile} kind="profile" alt="" sizes="104px" className={s.face} />}
              <span className={s.personName}>{c.name}</span>
              {c.role && <span className={s.personRole}>{c.role}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {cast.length > castShown && (
        <button type="button" className={s.more} onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${Math.min(cast.length, 30)}`}
        </button>
      )}
    </section>
  )
}

function Providers({ kind, names, href }: { kind: string; names: string[]; href?: string }) {
  const text = names.join(' · ')
  return (
    <div>
      <dt>{kind}</dt>
      <dd>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {text}
          </a>
        ) : (
          text
        )}
      </dd>
    </div>
  )
}

/** A row of posters at one size, each with a print-only strip: what it is, and its rating. */
function Row({ title, items, now }: { title: string; items: MediaItem[]; now: number }) {
  if (items.length === 0) return null
  return (
    <section className={s.section} aria-label={title}>
      <h2 className={s.sectionTitle}>{title}</h2>
      <ul className={s.posters}>
        {items.slice(0, 14).map((m) => (
          <FrameCard
            key={`${m.type}${m.id}`}
            shape="poster"
            artPath={m.poster}
            sizes="(max-width: 720px) 30vw, 150px"
            print={pickPrint(m, undefined, now)}
            fallback={m.title}
            title={m.title}
            meta={m.year ? String(m.year) : undefined}
            label={spokenPick(m)}
            link={{ to: '/title/$type/$id', params: { type: m.type, id: m.id } }}
            onIntent={() => prefetchDetail(m)}
          />
        ))}
      </ul>
    </section>
  )
}

function Info({ detail: d }: { detail: MediaDetail }) {
  const rows: [string, string | undefined][] = [
    ['Status', d.status],
    ['Released', formatDay(d.date, userLocale)],
    ['Original language', d.originalLanguage ? new Intl.DisplayNames(['en'], { type: 'language' }).of(d.originalLanguage) : undefined],
    ['Network', d.networks.join(', ') || undefined],
    ['Seasons', d.seasons.length ? String(d.seasons.filter((x) => x.number > 0).length) : undefined],
    ['Next episode', d.nextEpisode ? `S${d.nextEpisode.season} E${d.nextEpisode.number} · ${formatDay(d.nextEpisode.airDate, userLocale) ?? 'soon'}` : undefined],
    ['Collection', d.collection?.name],
  ]
  return (
    <section className={s.section} aria-labelledby="info-title">
      <h2 id="info-title" className={s.sectionTitle}>
        Information
      </h2>
      <dl className={s.facts}>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        {d.imdb && (
          <div>
            <dt>Links</dt>
            <dd className={s.links}>
              <a href={`https://www.imdb.com/title/${d.imdb}/`} target="_blank" rel="noreferrer">
                IMDb
              </a>
              <a href={`https://www.themoviedb.org/${d.type === 'movie' ? 'movie' : 'tv'}/${d.id}`} target="_blank" rel="noreferrer">
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

/** The page's shape before anything is known, so nothing moves when it arrives. */
function Ghost() {
  return (
    <div className="page" aria-busy>
      <div className={`${s.wrap} ${s.top}`}>
        <div className={s.still}>
          <div className={s.ghostFrame} />
          <div className={s.ghostStrip} />
        </div>
      </div>
    </div>
  )
}

const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(n)

/** Opens the system's share sheet, or copies the link; true when it copied, so the button can say so. */
async function share(d: MediaDetail): Promise<boolean> {
  const url = location.href.split('?')[0]!
  if (navigator.share) {
    await navigator.share({ title: d.title, text: d.overview.slice(0, 140), url }).catch(() => {})
    return false
  }
  return navigator.clipboard?.writeText(url).then(() => true, () => false) ?? false
}
