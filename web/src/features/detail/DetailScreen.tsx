import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import type { PrintPart } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import { PosterRow } from '../../components/PosterRow'
import { genreNames } from '../../lib/genres'
import { q } from '../../lib/queries'
import { buildICS, downloadICS, icsFileName } from '../../lib/ics'
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
import { eventFileName, icsEvent } from '../library/calendar'
import { RetryAction, StateView, errorMessage } from '../explore/Controls'
import { About } from './About'
import { CollectionRow } from './CollectionRow'
import { Ratings } from './Ratings'
import { RequestButton } from './RequestButton'
import { Episodes } from './Episodes'
import { FilmCan } from './FilmCan'
import { airedRefs, airsLine, cardOf, metaParts, nextEpisodeEntry, relatedRows, playLabel, playsFirst, titlePrint, todayOf } from './logic'
import { fetchEpisodes, useShowEpisodes } from './shows'
import { StarRating, useRating } from './StarRating'
import { TitleName } from './TitleName'
import { usePhone } from './usePhone'
import { useSourceSearch } from './useSourceSearch'
import { hasProviders, WhereToWatch } from './WhereToWatch'
import s from './DetailScreen.module.css'

const TrailerSheet = lazy(() => import('./TrailerSheet'))
const Reviews = lazy(() => import('./Reviews'))
const SourcePicker = lazy(() => import('../sources/SourcePicker').then((m) => ({ default: m.SourcePicker })))

/** The still's width at each layout, for `srcset`: two columns from 1000px, one below. */
const stillSizes = '(min-width: 1360px) 600px, (min-width: 1000px) 44vw, calc(100vw - 32px)'

/** A title's page: the giant title and its facts line, then the framed still with the "how this plays" block under
 *  it, and beside it the ratings, the one solid Play and what the viewer can do with the title. Below: cast,
 *  episodes, where to watch, reviews, more like it. */
export function DetailScreen({ type, id, initialSeason, autoPlay }: { type: MediaType; id: number; initialSeason?: number; autoPlay?: boolean }) {
  const { data: d, isPlaceholderData, isError, error, refetch, isRefetching } = useQuery(q.detail(type, id))
  const navigate = useNavigate()
  const router = useRouter()
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
  const phone = usePhone()
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

  // Play is a button, not a link, so the router never sees the intent a link gets: warm the player's page and its
  // video engine when a pointer or finger reaches Play, so the click doesn't wait on code.
  const warmed = useRef(false)
  const warmPlayer = () => {
    if (warmed.current) return
    warmed.current = true
    void router.preloadRoute({ to: '/watch/$type/$id', params: { type, id } })
    void import('../player/engine').then((m) => m.warmEngines())
  }

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
        <StateView heading="h1" icon="info" title="Couldn’t Load This Title" message={errorMessage(error)} action={<RetryAction error={error} onRetry={() => void refetch()} busy={isRefetching} />} />
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
  const fraction = progress ? watchedFraction(progress) : marked ? 1 : undefined
  const related = relatedRows(d)
  const airs = airsLine(d.nextEpisode, now, userLocale)

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
  // One .ics event, the same one Upcoming makes for this episode, so adding it twice updates it.
  function addToCalendar() {
    const entry = nextEpisodeEntry(d!)
    if (!entry) return
    const file = icsFileName(eventFileName(entry))
    downloadICS(buildICS([icsEvent(entry)], Date.now()), file)
    setNote(`Saved ${file}. Open it to add the episode to your calendar.`)
  }
  const toggleWatched = () => {
    if (type === 'movie') return watched ? titleLibrary.markUnwatched(card) : library.markWatched(card, undefined, d.runtime)
    return showDone ? titleLibrary.markUnwatched(card, episodes.aired) : titleLibrary.markEpisodesWatched(card, episodes.aired)
  }

  return (
    <article className="page">
     <header className={s.head}>
      <TitleName title={d.title} />
      <Meta detail={d} genres={genreNames(d.genres, type)} />
     </header>
     <div className={s.wrap} data-text={textSize === 'standard' ? undefined : textSize}>
      <div className={s.top}>
        <div className={s.still}>
          <div className={s.frame} style={{ viewTransitionName: 'title-art' }}>
            <Artwork path={d.backdrop} kind="backdrop" alt="" sizes={stillSizes} priority fallback={d.title} className={s.art} />
          </div>
          {fraction !== undefined && (
            <div className={s.progress} role="img" aria-label={`${Math.round(fraction * 100)} percent watched`}>
              <i style={{ width: `${fraction * 100}%` }} />
            </div>
          )}
          <p className={s.print}>{printText(titlePrint(d, progress, now, userLocale, marked))}</p>
          <FilmCan search={search} best={best} lastPlayed={lastPlayed} onOpen={() => setPicker(true)} />
        </div>

        <div className={s.info}>
          {!phone && <Ratings detail={d} ready={loaded} />}

          <div className={s.actions}>
            <button className="btn btn-primary btn-large" onClick={() => (search.choose ? setPicker(true) : play())} onPointerEnter={warmPlayer} onFocus={warmPlayer} aria-label={label.spoken}>
              <Icon name="play" size={18} /> {label.text}
            </button>
            {trailers.length > 0 && (
              <button className="btn btn-secondary btn-large" onClick={() => setTrailer(true)} aria-haspopup="dialog">
                <Icon name="trailer" size={18} /> Trailer
              </button>
            )}
            <RequestButton detail={d} onServer={!search.finished || search.sources.some((x) => x.origin === 'jellyfin' || x.origin === 'emby' || x.origin === 'plex')} onNote={setNote} />
          </div>

          <div className={s.listActions} role="group" aria-label="Your list">
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

          {airs && (
            <p className={s.airs}>
              <span className={s.airsText}>
                <Icon name="calendar" size={15} />
                <span aria-label={airs.spoken}>{airs.text}</span>
              </span>
              <button type="button" className="quiet-link" onClick={addToCalendar}>
                Add to Calendar
              </button>
            </p>
          )}

          {phone && <Ratings detail={d} ready={loaded} />}

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
          {d.overview && <p className={`reading ${s.overview}`}>{d.overview}</p>}
          {d.crew.length > 0 && (
            <dl className={s.crew}>
              {d.crew.slice(0, 4).map((c) => (
                <div key={`${c.id}${c.role}`}>
                  <dt>{c.role}</dt>
                  <dd>
                    <Link to="/person/$id" params={{ id: c.id }} className="quiet-link">
                      {c.name}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {d.cast.length > 0 && <Cast cast={d.cast} />}

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

      {type === 'movie' && <CollectionRow detail={d} now={now} />}
      <PosterRow title="More Like This" items={d.recommendations} now={now} />
      {related.similar && <PosterRow title="Similar" items={d.similar} now={now} />}

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

/** One of the list actions: a bordered cell that inverts when on (and shows a check, so "on" isn't told by colour
 *  alone). The cells of the row share their borders. */
function TextAction({ label, on, onClick, disabled, plain }: { label: string; on?: boolean; onClick: () => void; disabled?: boolean; plain?: boolean }) {
  return (
    <button
      type="button"
      className={`btn ${s.listAction}`}
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

/** The cast as a ruled grid of cells: a portrait when TMDB has one, else the name and role alone. */
const castShown = 6
function Cast({ cast }: { cast: MediaDetail['cast'] }) {
  const [all, setAll] = useState(false)
  const list = cast.slice(0, all ? 30 : castShown)
  return (
    <section className={s.section} aria-labelledby="cast-title">
      <h2 id="cast-title" className="section-label">
        Cast
      </h2>
      <ul className={s.castGrid}>
        {list.map((c) => (
          <li key={`${c.id}${c.role}`}>
            <Link to="/person/$id" params={{ id: c.id }} className={`row ${s.person}`}>
              {c.profile && <Artwork path={c.profile} kind="profile" alt="" sizes="64px" className={s.face} />}
              <span className={s.personText}>
                <span className={s.personName}>{c.name}</span>
                {c.role && <span className={`muted ${s.personRole}`}>{c.role}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {cast.length > castShown && (
        <button type="button" className={`quiet-link ${s.more}`} onClick={() => setAll(!all)} aria-expanded={all}>
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
      <div className={s.head}>
        <div className={s.ghostName} />
      </div>
      <div className={`${s.wrap} ${s.top}`}>
        <div className={s.still}>
          <div className={s.ghostFrame} />
        </div>
      </div>
    </div>
  )
}

/** What a still's print said on the old strip, as one plain mono line: "2024 · 2H 47 · ENDS 22:56". */
function printText(parts: PrintPart[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : 'key' in p ? p.key : p.text))
    .filter(Boolean)
    .join(' · ')
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

/** Year, runtime, rating and genres as one mono line under the title, wrapping only between the parts (the dot leads
 *  the part it separates), so a genre is never split across two lines. */
function Meta({ detail: d, genres }: { detail: MediaDetail; genres: string[] }) {
  const parts = metaParts(d, genres)
  const all = [...parts.facts.map((text) => ({ text, lead: true })), ...parts.genres.map((text, i) => ({ text: i < parts.genres.length - 1 ? `${text},` : text, lead: i === 0 }))]
  return (
    <p className={s.meta}>
      {all.map((part, i) => (
        <Fragment key={part.text}>
          {i > 0 && ' '}
          <span className={s.metaPart}>
            {i > 0 && part.lead ? '·\u00a0' : ''}
            {part.text}
          </span>
        </Fragment>
      ))}
    </p>
  )
}
