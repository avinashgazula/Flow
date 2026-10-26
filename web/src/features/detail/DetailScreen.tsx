import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import { Plate } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import { PosterRow } from '../../components/PosterRow'
import { genreNames } from '../../lib/genres'
import { q } from '../../lib/queries'
import { lastSourceFor, type PlaybackRequest, type Source } from '../../lib/sources'
import { lastSources, matchSource } from '../player/session'
import { library, libraryStore, mediaKey, useLibrary } from '../../lib/store/library'
import { titleLibrary } from '../../lib/store/titleLibrary'
import { useSettings } from '../../lib/store/settings'
import { userLocale, useMinuteTick } from '../../lib/time'
import type { MediaDetail, MediaType } from '../../lib/tmdb/types'
import { useNearScreen } from '../../lib/useNearScreen'
import { allWatched, nextUp, pickShuffle, watchedEpisodes } from '../../lib/watching'
import { watchedFraction } from '../home/logic'
import { About } from './About'
import { Ratings } from './Ratings'
import { RequestButton } from './RequestButton'
import { Episodes } from './Episodes'
import { FilmCan } from './FilmCan'
import { airedRefs, cardOf, metaLine, playLabel, playsFirst, titlePrint, todayOf } from './logic'
import { fetchEpisodes, useShowEpisodes } from './shows'
import { StarRating, useRating } from './StarRating'
import { TitleName } from './TitleName'
import { useSourceSearch } from './useSourceSearch'
import { hasProviders, WhereToWatch } from './WhereToWatch'
import s from './DetailScreen.module.css'

const TrailerSheet = lazy(() => import('./TrailerSheet'))
const Reviews = lazy(() => import('./Reviews'))
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
  const [note, setNote] = useState('')
  const key = mediaKey(type, id)
  const progress = useLibrary((l) => l.progress[key])
  const inWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === key))
  const isFavourite = useLibrary((l) => l.favourites.some((e) => e.key === key))
  const watched = useLibrary((l) => l.history.some((e) => e.key === key && !e.episode))
  const watchedMap = useLibrary((l) => l.watchedEpisodes)
  const rewatch = useLibrary((l) => l.rewatches?.[key])
  const score = useRating({ type, id })
  const remember = useSettings((x) => x.rememberLastSource)
  const textSize = useSettings((x) => x.detailTextSize)
  const showWhere = useSettings((x) => x.showWhereToWatch)
  const showWatchedMark = useSettings((x) => x.showWatchedBadges)
  const showReviews = useSettings((x) => x.showReviews)
  const [nearReviews, reviewsRef] = useNearScreen<HTMLDivElement>()
  const today = todayOf(now)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // A series' aired episodes, from every season, for what is next, Shuffle and marking the show watched.
  const loaded = !!d && !isPlaceholderData
  const episodes = useShowEpisodes(d, type === 'show' && loaded, today)
  const seen = useMemo(() => watchedEpisodes({ watchedEpisodes: watchedMap, rewatches: rewatch ? { [key]: rewatch } : {} }, id), [watchedMap, rewatch, key, id])
  const showDone = type === 'show' && episodes.ready && allWatched(episodes.aired, seen)

  // What Play starts: the episode being watched, else the next one not watched (a rewatch counts its own), else
  // the first one of a series.
  const firstEpisode = type === 'show' ? { season: d?.seasons.find((x) => x.number > 0)?.number ?? 1, episode: 1 } : undefined
  const upNext = type === 'show' ? (nextUp(episodes.aired, seen) ?? firstEpisode) : undefined
  const target = progress?.episode ?? upNext

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
  // A series that has watched episodes and no resume point waits for its episodes: the one to search for is the next.
  const knowsTarget = type !== 'show' || !!progress?.episode || seen.length === 0 || episodes.ready
  const search = useSourceSearch(request, loaded && knowsTarget)
  // What Play opens: the player's own memory of this title (it plays that source again, whatever the ranking
  // says), then the picker's, then the best that plays. The label under the still says which, so it matches.
  const playerLast = useMemo(() => {
    const last = remember && d ? lastSources.get(key) : undefined
    const here = !target || (last?.episode?.season === target.season && last.episode.episode === target.episode)
    return last && here ? last.source : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remember, d?.id, key, target?.season, target?.episode])
  const { source: best, lastPlayed } = playsFirst(
    search.sources,
    playerLast && { source: playerLast, matched: matchSource(playerLast, search.sources) },
    remember && request ? lastSourceFor(request, search.sources) : undefined,
  )

  if (isError && !d) {
    return (
      <div className="page">
        <h1 className="page-title">Couldn’t Load This Title</h1>
        <p className="muted">{(error as Error).message}</p>
      </div>
    )
  }
  if (!d) return <Ghost />

  const label = playLabel(d, progress, upNext, now, userLocale)
  const card = cardOf(d)
  const trailers = d.trailers ?? []
  const isWatched = type === 'movie' ? watched : showDone
  const ready = loaded && (type === 'movie' || episodes.ready)
  // A title watched through says so on its strip, with every hole filled, as its poster does on Home.
  const marked = isWatched && showWatchedMark && !progress

  /** Shuffle: a random episode, one not yet picked this round, preferring one not yet watched. */
  async function shuffle() {
    const all = await fetchEpisodes(d!)
    const lib = libraryStore.get()
    const pick = pickShuffle(airedRefs(all, today), lib.shuffled?.[key] ?? [], watchedEpisodes(lib, id))
    if (!pick) {
      setNote('Nothing to shuffle yet.')
      return
    }
    titleLibrary.rememberShuffled(card, pick.played)
    play(pick.pick)
  }
  const toggleWatched = () => {
    if (type === 'movie') return watched ? titleLibrary.markUnwatched(card) : library.markWatched(card, undefined, d.runtime)
    return showDone ? titleLibrary.markUnwatched(card, episodes.aired) : titleLibrary.markEpisodesWatched(card, episodes.aired)
  }

  return (
    <article className="page">
     <div className={s.wrap} data-text={textSize === 'standard' ? undefined : textSize}>
      <div className={s.top}>
        <div className={s.still}>
          <div style={{ viewTransitionName: 'title-art' }}>
            <Plate
              shape="still"
              artPath={d.backdrop}
              sizes={stillSizes}
              priority
              progress={progress ? watchedFraction(progress) : marked ? 1 : undefined}
              print={titlePrint(d, progress, now, userLocale, marked)}
              stripSize="title"
              fallback={d.title}
            />
          </div>
          <FilmCan search={search} best={best} lastPlayed={lastPlayed} onOpen={() => setPicker(true)} />
        </div>

        <div className={s.info}>
          <TitleName title={d.title} logo={d.logo} />
          <p className={s.meta}>{metaLine(d, genreNames(d.genres, type))}</p>

          <Ratings detail={d} ready={loaded} />

          <div className={s.actions}>
            <button className="btn btn-primary btn-large" onClick={() => play()} aria-label={label.spoken}>
              <Icon name="play" size={18} /> {label.text}
            </button>
            {trailers.length > 0 && (
              <button className="btn btn-secondary btn-large" onClick={() => setTrailer(true)} aria-haspopup="dialog">
                <Icon name="trailer" size={18} /> Trailer
              </button>
            )}
            <RequestButton detail={d} onServer={!search.finished || search.sources.some((x) => x.origin === 'jellyfin' || x.origin === 'emby' || x.origin === 'plex')} onNote={setNote} />
          </div>

          <div className={s.textActions} role="group" aria-label="Your list">
            <TextAction label="Watchlist" on={inWatchlist} onClick={() => library.toggleWatchlist(card)} />
            <TextAction label="Watched" on={isWatched} onClick={toggleWatched} disabled={!ready} />
            <TextAction label="Favourite" on={isFavourite} onClick={() => library.toggleFavourite(card)} />
            {type === 'show' && <TextAction label="Shuffle" onClick={() => void shuffle()} disabled={!ready} />}
            {type === 'show' && <TextAction plain label={rewatch ? 'End Rewatch' : 'Rewatch'} on={!!rewatch} onClick={() => (rewatch ? titleLibrary.endRewatch(card) : titleLibrary.startRewatch(card))} />}
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

          {(isWatched || score !== undefined) && (
            <div className={s.rating}>
              <span className={s.ratingLabel}>Your Rating</span>
              <StarRating item={card} />
            </div>
          )}
          {rewatch && <p className={s.status}>Rewatching: Next Up restarts from S1 E1.</p>}
          <p className={s.status} role="status">
            {note}
          </p>

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

      {showWhere && hasProviders(d.providers) && <WhereToWatch providers={d.providers} />}

      {showReviews && loaded && (
        <div ref={reviewsRef}>
          {nearReviews && (
            <Suspense fallback={null}>
              <Reviews type={type} id={id} imdb={d.imdb} />
            </Suspense>
          )}
        </div>
      )}

      <PosterRow title="You Might Also Like" items={d.recommendations} now={now} />
      <PosterRow title="Similar" items={d.similar} now={now} />

      {!isPlaceholderData && <About detail={d} />}

      {trailer && trailers.length > 0 && (
        <Suspense fallback={null}>
          <TrailerSheet videos={trailers} title={d.title} onClose={() => setTrailer(false)} />
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

/** A quiet text action: plain ink-2, paper when on, with a check so "on" isn't told by colour alone. */
function TextAction({ label, on, onClick, disabled, plain }: { label: string; on?: boolean; onClick: () => void; disabled?: boolean; plain?: boolean }) {
  return (
    <button
      type="button"
      className={s.textAction}
      onClick={disabled ? undefined : onClick}
      // A label that changes with the state (End Rewatch) says it already; a constant one is a toggle.
      aria-pressed={plain ? undefined : on}
      data-on={on ? '' : undefined}
      aria-live={on === undefined ? 'polite' : undefined}
      aria-disabled={disabled || undefined}
    >
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

/** Opens the system's share sheet, or copies the link; true when it copied, so the button can say so. */
async function share(d: MediaDetail): Promise<boolean> {
  const url = location.href.split('?')[0]!
  if (navigator.share) {
    await navigator.share({ title: d.title, text: d.overview.slice(0, 140), url }).catch(() => {})
    return false
  }
  return navigator.clipboard?.writeText(url).then(() => true, () => false) ?? false
}
