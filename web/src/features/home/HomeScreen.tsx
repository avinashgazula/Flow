import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FrameCard } from '../../components/Frame'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { mediaKey, useLibrary, type Progress } from '../../lib/store/library'
import { formatLeft, formatWeekdayDate, greetingTitle, userLocale, useMinuteTick } from '../../lib/time'
import { srcSet } from '../../lib/tmdb/images'
import type { MediaItem, MediaType, Page } from '../../lib/tmdb/types'
import { useNearScreen } from '../../lib/useNearScreen'
import { Lead, LeadGhost, leadSizes, type LeadItem } from './Lead'
import { episodeLine, firstWithStill, inProgress, pickMeta, pickPrint, resumePrint, spokenPick, spokenResume, watchedFraction, secondsLeft } from './logic'
import s from './HomeScreen.module.css'

/** Home, by the hour: the greeting title and date, the lead item with its yellow Resume, Up Next beside it
 *  (framed stills, perforations for progress, edge print for the facts), and rows of posters to pick from,
 *  each with a print-only strip. Everything is a Frame (components/Frame). */
export function HomeScreen() {
  const now = useMinuteTick()
  const progress = useLibrary((l) => l.progress)
  const watchlist = useLibrary((l) => l.watchlist)
  const trending = useQuery(q.trending('all', 'day'))

  const resumes = inProgress(progress)
  const pick = firstWithStill(trending.data?.results)
  // The most recent resume item leads; with nothing in progress, the top pick does.
  const lead: LeadItem | undefined = resumes[0] ? { item: resumes[0].item, progress: resumes[0] } : pick ? { item: pick } : undefined

  // The next visit's HTML paints this still before any script runs, and preloads it (index.html).
  const still = lead?.item.backdrop
  useEffect(() => {
    if (!still) return
    try {
      localStorage.setItem('flow.lcp', JSON.stringify({ path: location.pathname, d: srcSet(still, 'backdrop'), s: leadSizes }))
    } catch {
      // Only a head start for the next visit.
    }
  }, [still])

  // Up Next: the rest of what's in progress, then what's on the watchlist.
  const leadKey = lead && mediaKey(lead.item.type, lead.item.id)
  const started = new Set(resumes.map((p) => p.key))
  const upNext: { key: string; resume?: Progress; item: MediaItem }[] = [
    ...resumes.slice(lead?.progress ? 1 : 0).map((p) => ({ key: p.key, resume: p, item: p.item })),
    ...watchlist.filter((e) => e.key !== leadKey && !started.has(e.key)).map((e) => ({ key: e.key, item: e.item as MediaItem })),
  ].slice(0, 6)

  const none = !lead && !trending.isPending

  return (
    <div className={s.home}>
      <div className={s.wrap}>
        <header className={s.head}>
          <h1 className={s.title}>{greetingTitle(now)}</h1>
          <p className={`${s.date} num`}>{formatWeekdayDate(now, userLocale)}</p>
        </header>
        {none ? (
          <Setup error={trending.isError} />
        ) : (
          <>
            <div className={s.top}>
              {lead ? <Lead lead={lead} /> : <LeadGhost />}
              <section className={s.side} aria-labelledby="up-next">
                <h2 id="up-next" className={s.sectionTitle}>
                  Up Next
                </h2>
                {upNext.length ? (
                  <ul className={s.stills}>
                    {upNext.map((u) => (u.resume ? <ResumeCard key={u.key} p={u.resume} /> : <WatchCard key={u.key} item={u.item} />))}
                  </ul>
                ) : (
                  <p className={s.teach}>Start a film or an episode and it waits here, with how long is left and when it would finish if you carried on now.</p>
                )}
              </section>
            </div>
            <section className={s.picks} aria-labelledby="pick-new">
              <h2 id="pick-new" className={s.sectionTitle}>
                Pick Something New
              </h2>
              <PosterRow title="Trending Films" query={q.trending('movie')} seeAll={{ type: 'movie', sort: 'trending' }} />
              <PosterRow title="Trending Series" query={q.trending('show')} seeAll={{ type: 'show', sort: 'trending' }} />
              <PosterRow title="Science Fiction" query={q.discover('movie', { with_genres: 878, sort_by: 'popularity.desc' })} seeAll={{ type: 'movie', genre: 878 }} />
              <PosterRow title="Comedy Series" query={q.discover('show', { with_genres: 35, sort_by: 'popularity.desc' })} seeAll={{ type: 'show', genre: 35 }} />
              <PosterRow title="Top Rated Films" query={q.list('movie', 'top_rated')} seeAll={{ type: 'movie', sort: 'top' }} />
            </section>
          </>
        )}
      </div>
    </div>
  )
}

const stillSizes = '(min-width: 1100px) 22vw, (min-width: 721px) 30vw, 240px'

/** Something started, as a still: perforations for how far, print for the episode, the minutes left in
 *  yellow, when it would end, and the format it last played in. */
function ResumeCard({ p }: { p: Progress }) {
  const now = useMinuteTick()
  const last = useStore(lastSourceStore, (st) => st.byTitle[p.key])
  const still = p.episode?.still
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: p.item.type, id: p.item.id }, search: p.episode ? { season: p.episode.season } : undefined }}
      shape="still"
      artPath={still ?? p.item.backdrop}
      artKind={still ? 'still' : 'backdrop'}
      sizes={stillSizes}
      progress={watchedFraction(p)}
      print={resumePrint(p, now, last, userLocale)}
      title={p.item.title}
      meta={episodeLine(p.episode) ?? formatLeft(secondsLeft(p))}
      label={spokenResume(p, now, userLocale, last)}
      fallback={p.item.title}
      onIntent={() => prefetchDetail(p.item)}
    />
  )
}

/** A watchlist title, as a still with print only: nothing watched yet, so no perforations. */
function WatchCard({ item }: { item: MediaItem }) {
  const now = useMinuteTick()
  const [near, itemRef] = useNearScreen<HTMLLIElement>()
  const { data } = useQuery({ ...q.detail(item.type, item.id), enabled: near })
  const detail = data && (data.runtime || data.seasons.length) ? data : undefined
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: item.type, id: item.id } }}
      itemRef={itemRef}
      shape="still"
      artPath={item.backdrop}
      sizes={stillSizes}
      print={pickPrint(item, detail, now, { ends: true, locale: userLocale })}
      title={item.title}
      meta={pickMeta(item)}
      label={`${spokenPick(item, detail)}, on your watchlist`}
      fallback={item.title}
      onIntent={() => prefetchDetail(item)}
    />
  )
}

/** A row of posters from one of the catalogue's lists, all one size. */
function PosterRow({
  title,
  query,
  seeAll,
}: {
  title: string
  query: UseQueryOptions<Page<MediaItem>, Error, Page<MediaItem>, any>
  seeAll: { type: MediaType; sort?: string; genre?: number }
}) {
  const { data, isPending, isError } = useQuery(query)
  if (isError || (data && data.results.length === 0)) return null
  return (
    <section className={s.rowSection} aria-labelledby={`row-${title}`}>
      <div className={s.rowHead}>
        <h3 id={`row-${title}`} className={s.rowTitle}>
          {title}
        </h3>
        <Link to="/explore" search={seeAll} className={s.seeAll}>
          See all
        </Link>
      </div>
      <ul className={s.row} aria-busy={isPending || undefined}>
        {isPending
          ? Array.from({ length: 7 }, (_, i) => (
              <li key={i} className={s.ghost} aria-hidden="true">
                <span />
              </li>
            ))
          : data?.results.slice(0, 12).map((item) => <PosterCard key={`${item.type}${item.id}`} item={item} />)}
      </ul>
    </section>
  )
}

/** A title you haven't started: poster, and print only (runtime and rating, or seasons and rating, or NEW EP
 *  when an episode just aired). The detail behind it is fetched once the poster is about to be seen. */
function PosterCard({ item }: { item: MediaItem }) {
  const now = useMinuteTick()
  const [near, itemRef] = useNearScreen<HTMLLIElement>()
  const { data } = useQuery({ ...q.detail(item.type, item.id), enabled: near })
  // The placeholder (what the list knew) has no runtime or seasons, so only a real answer counts.
  const detail = data && (data.runtime || data.seasons.length) ? data : undefined
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: item.type, id: item.id } }}
      itemRef={itemRef}
      shape="poster"
      artPath={item.poster}
      sizes="(max-width: 720px) 112px, 180px"
      print={pickPrint(item, detail, now)}
      title={item.title}
      label={spokenPick(item, detail)}
      fallback={item.title}
      onIntent={() => prefetchDetail(item)}
    />
  )
}

/** No resume item and no picks: a fresh install, or the catalogue can't be reached. Say what to do. */
function Setup({ error }: { error: boolean }) {
  return (
    <section className={s.setup} aria-labelledby="setup">
      <h2 id="setup" className={s.setupTitle}>
        Set Up Your Sources
      </h2>
      <p className={s.setupText}>Flow plays from your own servers, stream add-ons and live TV. Add one in Settings, and Home fills in: what you’re watching, how long is left and what’s new.</p>
      {error && <p className={s.setupText}>Flow couldn’t reach TMDB just now. Check your connection, or the key in Settings.</p>}
      <div className={s.setupActions}>
        <Link to="/settings" className="btn btn-primary btn-large">
          Add a Source
        </Link>
        <Link to="/explore" className="btn btn-secondary btn-large">
          Explore
        </Link>
      </div>
    </section>
  )
}
