import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import { PosterCard } from '../../components/Cards'
import { Icon } from '../../components/Icon'
import { Shelf } from '../../components/Shelf'
import { genreNames } from '../../lib/genres'
import { q } from '../../lib/queries'
import { episodeKey, library, mediaKey, useLibrary } from '../../lib/store/library'
import { imageURL, srcSet } from '../../lib/tmdb/images'
import type { Episode, MediaDetail, MediaType } from '../../lib/tmdb/types'
import s from './DetailScreen.module.css'

const TrailerSheet = lazy(() => import('./TrailerSheet'))

export function DetailScreen({ type, id, initialSeason, autoPlay }: { type: MediaType; id: number; initialSeason?: number; autoPlay?: boolean }) {
  const { data: d, isPlaceholderData, isError, error } = useQuery(q.detail(type, id))
  const navigate = useNavigate()
  const [trailer, setTrailer] = useState(false)
  const key = mediaKey(type, id)
  const progress = useLibrary((l) => l.progress[key])
  const inWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === key))
  const isFavourite = useLibrary((l) => l.favourites.some((e) => e.key === key))
  const watched = useLibrary((l) => l.history.some((e) => e.key === key && !e.episode))

  useEffect(() => window.scrollTo(0, 0), [])

  const play = (episode?: { season: number; episode: number }) => {
    const target = episode ?? (type === 'show' ? (progress?.episode ?? { season: d?.seasons[0]?.number ?? 1, episode: 1 }) : undefined)
    void navigate({ to: '/watch/$type/$id', params: { type, id }, search: target ? { season: target.season, episode: target.episode } : {} })
  }

  useEffect(() => {
    if (autoPlay && d && !isPlaceholderData) play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, isPlaceholderData])

  if (isError && !d) {
    return (
      <div className="page">
        <h1 className="page-title">Couldn’t Load This Title</h1>
        <p className="muted">{(error as Error).message}</p>
      </div>
    )
  }
  if (!d) return <div className={s.skeleton} />

  const meta = [
    d.year,
    d.runtime ? (type === 'movie' ? runtime(d.runtime) : `${d.runtime}m episodes`) : undefined,
    ...(d.genreNames.length ? d.genreNames : genreNames(d.genres, type)).slice(0, 3),
  ].filter(Boolean)
  const remaining = progress ? Math.max(1, Math.round((progress.duration - progress.position) / 60)) : 0
  const playLabel = progress
    ? progress.episode
      ? `Resume S${progress.episode.season} E${progress.episode.episode}`
      : `Resume · ${remaining >= 60 ? `${Math.floor(remaining / 60)}h ${remaining % 60}m` : `${remaining}m`} left`
    : type === 'show'
      ? 'Play S1 E1'
      : 'Play'

  return (
    <article className={s.detail}>
      <header className={s.hero}>
        <div className={s.backdrop}>
          <picture style={{ viewTransitionName: 'title-art' }}>
            <source media="(max-width: 720px)" srcSet={srcSet(d.poster, 'poster')} sizes="100vw" />
            <img
              src={imageURL(d.backdrop, 1280)}
              srcSet={srcSet(d.backdrop, 'backdrop')}
              sizes="100vw"
              alt=""
              fetchPriority="high"
              decoding="sync"
              onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
              ref={(img) => {
                if (img?.complete && img.naturalWidth) img.setAttribute('data-loaded', '')
              }}
            />
          </picture>
        </div>
        <div className={s.heroContent}>
          {d.logo ? (
            <img className={s.logo} src={imageURL(d.logo, 500)} alt={d.title} />
          ) : (
            <h1 className={s.title}>{d.title}</h1>
          )}
          <p className={s.meta}>
            {meta.join(' · ')}
            {d.certification && <span className={s.badge}>{d.certification}</span>}
          </p>
          {d.rating ? (
            <p className={s.ratings}>
              <span className={s.tmdb}>TMDB</span> {d.rating.toFixed(1)}
              {d.voteCount ? <span className="faint"> · {compact(d.voteCount)} votes</span> : null}
            </p>
          ) : null}
          <div className={s.actions}>
            <button className={`btn btn-primary ${s.play}`} onClick={() => play()}>
              <Icon name="play" size={18} /> {playLabel}
            </button>
            {d.trailer && (
              <button className="btn btn-glass" onClick={() => setTrailer(true)}>
                <Icon name="trailer" size={18} /> Trailer
              </button>
            )}
          </div>
          <div className={s.toggles}>
            <Toggle icon={watched ? 'check' : 'check'} label="Watched" on={watched} onClick={() => library.markWatched(d)} disabled={type === 'show'} />
            <Toggle icon={inWatchlist ? 'check' : 'plus'} label="Watchlist" on={inWatchlist} onClick={() => library.toggleWatchlist(d)} />
            <Toggle icon="heart" label="Favourite" on={isFavourite} onClick={() => library.toggleFavourite(d)} />
            <Toggle icon="share" label="Share" onClick={() => share(d)} />
          </div>
        </div>
      </header>

      <div className={s.body}>
        <section className={s.about}>
          {d.tagline && <p className={s.tagline}>{d.tagline}</p>}
          <p className={s.overview}>{d.overview}</p>
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
        </section>

        {type === 'show' && d.seasons.length > 0 && !isPlaceholderData && <Seasons detail={d} initial={initialSeason} onPlay={play} />}

        {d.cast.length > 0 && (
          <Shelf title="Cast & Crew">
            {d.cast.slice(0, 30).map((c) => (
              <Link key={`${c.id}${c.role}`} to="/person/$id" params={{ id: c.id }} className={s.person}>
                <Artwork path={c.profile} kind="profile" alt="" sizes="120px" className={s.face} fallback={initials(c.name)} />
                <span className={s.personName}>{c.name}</span>
                <span className={s.personRole}>{c.role}</span>
              </Link>
            ))}
          </Shelf>
        )}

        {(d.providers.stream.length > 0 || d.providers.rent.length > 0) && (
          <section className={s.section}>
            <h2 className={s.sectionTitle}>Where to Watch</h2>
            <div className={s.providers}>
              {[...d.providers.stream.map((p) => ({ ...p, kind: 'Stream' })), ...d.providers.rent.slice(0, 3).map((p) => ({ ...p, kind: 'Rent' }))].map((p) => (
                <a key={`${p.kind}${p.id}`} href={d.providers.link} target="_blank" rel="noreferrer" className={s.provider}>
                  <img src={imageURL(p.logo, 92)} alt="" loading="lazy" width={44} height={44} />
                  <span>
                    <strong>{p.name}</strong>
                    <span className="faint">{p.kind}</span>
                  </span>
                </a>
              ))}
            </div>
            <p className={s.attribution}>Data from JustWatch</p>
          </section>
        )}

        {d.recommendations.length > 0 && (
          <Shelf title="You Might Also Like">
            {d.recommendations.map((m) => (
              <PosterCard key={`${m.type}${m.id}`} item={m} />
            ))}
          </Shelf>
        )}
        {d.similar.length > 0 && (
          <Shelf title="Similar">
            {d.similar.map((m) => (
              <PosterCard key={`${m.type}${m.id}`} item={m} />
            ))}
          </Shelf>
        )}

        {!isPlaceholderData && <Info detail={d} />}
      </div>
      {trailer && d.trailer && (
        <Suspense fallback={null}>
          <TrailerSheet video={d.trailer} title={d.title} onClose={() => setTrailer(false)} />
        </Suspense>
      )}
    </article>
  )
}

function Toggle({ icon, label, on, onClick, disabled }: { icon: Parameters<typeof Icon>[0]['name']; label: string; on?: boolean; onClick: () => void; disabled?: boolean }) {
  if (disabled) return null
  return (
    <button className={s.toggle} onClick={onClick} aria-pressed={on}>
      <span className={s.toggleIcon}>
        <Icon name={icon} size={20} strokeWidth={2.2} filled={icon === 'heart' ? !!on : false} />
      </span>
      <span>{label}</span>
    </button>
  )
}

function Seasons({ detail, initial, onPlay }: { detail: MediaDetail; initial?: number; onPlay: (e: { season: number; episode: number }) => void }) {
  const fallback = detail.lastEpisode?.season ?? detail.seasons[0]?.number ?? 1
  const [season, setSeason] = useState(initial && detail.seasons.some((x) => x.number === initial) ? initial : detail.seasons.length > 1 ? (detail.seasons.find((x) => x.number === 1)?.number ?? fallback) : fallback)
  const { data: episodes, isPending } = useQuery(q.season(detail.id, season))
  const watched = useLibrary((l) => l.watchedEpisodes)
  const progress = useLibrary((l) => l.progress[mediaKey('show', detail.id)])
  const today = new Date().toISOString().slice(0, 10)
  return (
    <section className={s.section}>
      <div className={s.seasonBar}>
        <h2 className={s.sectionTitle}>Episodes</h2>
        <div className={s.seasonChips} role="tablist" aria-label="Seasons">
          {detail.seasons.map((x) => (
            <button key={x.number} role="tab" className="chip" aria-pressed={x.number === season} onClick={() => setSeason(x.number)}>
              {x.name}
            </button>
          ))}
        </div>
      </div>
      <ol className={s.episodes}>
        {isPending
          ? Array.from({ length: 4 }, (_, i) => <li key={i} className={s.episodeGhost} />)
          : episodes?.map((e) => (
              <EpisodeRow
                key={e.id}
                episode={e}
                aired={!e.airDate || e.airDate <= today}
                watched={!!watched[episodeKey(detail.id, { season: e.season, episode: e.number })]}
                progress={progress?.episode?.season === e.season && progress.episode.episode === e.number ? progress.position / progress.duration : undefined}
                onPlay={() => onPlay({ season: e.season, episode: e.number })}
              />
            ))}
      </ol>
    </section>
  )
}

function EpisodeRow({ episode: e, aired, watched, progress, onPlay }: { episode: Episode; aired: boolean; watched: boolean; progress?: number; onPlay: () => void }) {
  return (
    <li className={s.episode}>
      <button className={s.episodeButton} onClick={onPlay} disabled={!aired}>
        <div className={s.stillWrap}>
          <Artwork path={e.still} kind="still" alt="" sizes="(max-width: 720px) 40vw, 260px" className={s.still} fallback={`Episode ${e.number}`} />
          {aired && (
            <span className={s.stillPlay}>
              <Icon name="play" size={16} />
            </span>
          )}
          {progress !== undefined && (
            <span className={s.stillProgress}>
              <span style={{ transform: `scaleX(${progress})` }} />
            </span>
          )}
        </div>
        <div className={s.episodeText}>
          <span className={s.episodeNumber}>
            Episode {e.number}
            {watched && (
              <span className={s.watched}>
                <Icon name="check" size={12} strokeWidth={3} /> Watched
              </span>
            )}
          </span>
          <span className={s.episodeName}>{e.name}</span>
          <span className={s.episodeOverview}>{aired ? e.overview : `Airs ${formatDate(e.airDate)}`}</span>
          <span className={s.episodeMeta}>{[formatDate(e.airDate), e.runtime ? `${e.runtime}m` : undefined].filter(Boolean).join(' · ')}</span>
        </div>
      </button>
    </li>
  )
}

function Info({ detail: d }: { detail: MediaDetail }) {
  const rows: [string, string | undefined][] = [
    ['Status', d.status],
    ['Released', formatDate(d.date)],
    ['Original Language', d.originalLanguage ? new Intl.DisplayNames(['en'], { type: 'language' }).of(d.originalLanguage) : undefined],
    ['Network', d.networks.join(', ') || undefined],
    ['Seasons', d.seasons.length ? String(d.seasons.length) : undefined],
    ['Next Episode', d.nextEpisode ? `S${d.nextEpisode.season} E${d.nextEpisode.number} · ${formatDate(d.nextEpisode.airDate)}` : undefined],
    ['Collection', d.collection?.name],
  ]
  return (
    <section className={s.section}>
      <h2 className={s.sectionTitle}>Information</h2>
      <dl className={s.info}>
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

const runtime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(n)
const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')

function formatDate(date?: string) {
  if (!date) return undefined
  const d = new Date(`${date}T12:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

async function share(d: MediaDetail) {
  const url = location.href.split('?')[0]!
  if (navigator.share) {
    await navigator.share({ title: d.title, text: d.overview.slice(0, 140), url }).catch(() => {})
  } else {
    await navigator.clipboard?.writeText(url)
  }
}
