import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Listing, ListingSection } from '../../components/Listing'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { mediaKey, useLibrary, type Progress } from '../../lib/store/library'
import { endTime, formatClock, formatLeft, formatWeekdayDate, greetingTitle, userLocale, useMinuteTick } from '../../lib/time'
import { srcSet } from '../../lib/tmdb/images'
import { useMediaQuery } from '../../lib/useMediaQuery'
import type { MediaItem, MediaType, Page } from '../../lib/tmdb/types'
import { Featured, FeaturedGhost, leadSizes, type Preview } from './Featured'
import { episodeLine, firstWithStill, inProgress, pickMeta, pickWhen, secondsLeft, spokenPick, spokenResume, versionLine } from './logic'
import s from './HomeScreen.module.css'

/** Home, "Tonight": the greeting title and date, the lead listing, what to carry on with, and picks.
 *  Every row is a programme listing (components/Listing). From 1100px wide the programme sits left and
 *  the lead's frame sticks right, following whichever listing the pointer or keyboard is on. */
export function HomeScreen() {
  const now = useMinuteTick()
  const wide = useMediaQuery('(min-width: 1100px)')
  const progress = useLibrary((l) => l.progress)
  const trending = useQuery(q.trending('all', 'day'))
  const [hovered, setHovered] = useState<{ preview: Preview; where: string } | null>(null)

  const resumes = inProgress(progress)
  const pick = firstWithStill(trending.data?.results)
  // The most recent resume item leads; with nothing in progress, the top pick does.
  const lead: Preview | undefined = resumes[0] ? { item: resumes[0].item, progress: resumes[0] } : pick ? { item: pick } : undefined
  const preview = wide ? (hovered?.preview ?? lead) : lead

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

  const none = !lead && !trending.isPending
  const featured = preview ? <Featured preview={preview} frame={wide} priority={preview === lead} /> : trending.isPending ? <FeaturedGhost frame={wide} /> : null

  // On a phone the lead is its own block above the lists; on desktop it's also a row in Carry On, on the band.
  const carry = wide ? resumes : resumes.slice(1)
  const intent: Intent = (p, where) => (wide ? () => setHovered({ preview: p, where }) : undefined)
  // On desktop the previewed listing sits on the panel band, in the list it came from (the lead's row, by
  // default, is in Carry On). Not on a phone, where the lead is its own block.
  const selection = wide && preview ? { key: mediaKey(preview.item.type, preview.item.id), where: hovered?.where ?? (preview.progress ? 'carry' : '') } : undefined

  return (
    <div
      className={s.home}
      // The preview stays on the last listing until the pointer leaves the whole screen, so it can
      // travel to the frame's buttons.
      onPointerLeave={() => setHovered(null)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHovered(null)
      }}
    >
      <div className={s.wrap}>
      <header className={s.head}>
        <h1 className={s.title}>{greetingTitle(now)}</h1>
        <p className={`${s.date} num`}>{formatWeekdayDate(now, userLocale)}</p>
      </header>
      {none ? (
        <Setup error={trending.isError} />
      ) : (
        <div className={s.grid}>
          <div className={s.programme}>
            {!wide && featured}
            <CarryOn items={carry} none={resumes.length === 0} intent={intent} selection={selection} />
            <Watchlist intent={intent} selection={selection} />
            <section className={s.group} aria-labelledby="pick-new">
              <h2 id="pick-new" className={s.groupTitle}>
                Pick Something New
              </h2>
              <PickSection title="Trending Films" query={q.trending('movie')} seeAll={{ type: 'movie', sort: 'trending' }} intent={intent} selection={selection} />
              <PickSection title="Trending Series" query={q.trending('show')} seeAll={{ type: 'show', sort: 'trending' }} intent={intent} selection={selection} />
              <PickSection title="Science Fiction" query={q.discover('movie', { with_genres: 878, sort_by: 'popularity.desc' })} seeAll={{ type: 'movie', genre: 878 }} intent={intent} selection={selection} />
              <PickSection title="Comedy Series" query={q.discover('show', { with_genres: 35, sort_by: 'popularity.desc' })} seeAll={{ type: 'show', genre: 35 }} intent={intent} selection={selection} />
              <PickSection title="Top Rated Films" query={q.list('movie', 'top_rated')} seeAll={{ type: 'movie', sort: 'top' }} intent={intent} selection={selection} />
            </section>
          </div>
          {wide && <aside className={s.frame}>{featured}</aside>}
        </div>
      )}
      </div>
    </div>
  )
}

type Intent = (p: Preview, where: string) => (() => void) | undefined
type Selection = { key: string; where: string } | undefined
const isSelected = (selection: Selection, key: string, where: string) => selection?.key === key && selection.where === where

/** In-progress titles as listings: when each would end if you carried on now, a 2 px progress line under
 *  the still. Nothing in progress teaches what this section is for. */
function CarryOn({ items, none, intent, selection }: { items: Progress[]; none: boolean; intent: Intent; selection?: Selection }) {
  if (none) {
    return (
      <section className={s.section} aria-labelledby="carry-on">
        <h2 id="carry-on" className={s.groupTitle}>
          Carry On
        </h2>
        <p className={s.teach}>Start a film or an episode and it waits here, with the time it would finish if you carried on now.</p>
      </section>
    )
  }
  if (!items.length) return null
  return (
    <ListingSection title="Carry On" art="still">
      {items.map((p) => (
        <ResumeRow key={p.key} p={p} intent={intent({ item: p.item, progress: p }, 'carry')} selected={isSelected(selection, p.key, 'carry')} />
      ))}
    </ListingSection>
  )
}

function ResumeRow({ p, intent, selected }: { p: Progress; intent?: () => void; selected: boolean }) {
  const now = useMinuteTick()
  const last = useStore(lastSourceStore, (st) => st.byTitle[p.key])
  const left = secondsLeft(p)
  const still = p.episode?.still
  return (
    <Listing
      link={{ to: '/title/$type/$id', params: { type: p.item.type, id: p.item.id }, search: p.episode ? { season: p.episode.season } : undefined }}
      when={{ ends: left }}
      title={p.item.title}
      meta={[episodeLine(p.episode), formatLeft(left)].filter(Boolean).join(' · ')}
      version={versionLine(last)}
      artPath={still ?? p.item.backdrop}
      artKind={still ? 'still' : 'backdrop'}
      progress={p.position / p.duration}
      label={spokenResume(p, now, userLocale)}
      selected={selected}
      onIntent={() => {
        prefetchDetail(p.item)
        intent?.()
      }}
    />
  )
}

function Watchlist({ intent, selection }: { intent: Intent; selection?: Selection }) {
  const watchlist = useLibrary((l) => l.watchlist)
  if (!watchlist.length) return null
  const shown = watchlist.slice(0, 8)
  return (
    <ListingSection
      title="Watchlist"
      aside={
        <>
          {watchlist.length} {watchlist.length === 1 ? 'title' : 'titles'}
          {watchlist.length > shown.length && (
            <>
              {' · '}
              <Link to="/library">See all</Link>
            </>
          )}
        </>
      }
    >
      {shown.map((e) => (
        <PickRow key={e.key} item={e.item as MediaItem} intent={intent} where="watchlist" selected={isSelected(selection, e.key, 'watchlist')} />
      ))}
    </ListingSection>
  )
}

/** A short programme from one of the catalogue's lists. */
function PickSection({
  title,
  query,
  seeAll,
  intent,
  selection,
}: {
  title: string
  query: UseQueryOptions<Page<MediaItem>, Error, Page<MediaItem>, any>
  seeAll: { type: MediaType; sort?: string; genre?: number }
  intent: Intent
  selection?: Selection
}) {
  const { data, isPending, isError } = useQuery(query)
  if (isError || (data && data.results.length === 0)) return null
  return (
    <ListingSection
      level={3}
      title={title}
      loading={isPending}
      aside={
        <Link to="/explore" search={seeAll}>
          See all
        </Link>
      }
    >
      {data?.results.slice(0, 6).map((item) => (
        <PickRow key={`${item.type}${item.id}`} item={item} intent={intent} where={title} selected={isSelected(selection, mediaKey(item.type, item.id), title)} />
      ))}
    </ListingSection>
  )
}

/** A title you haven't started. Its time column needs the runtime (a film) or the next episode (a series),
 *  which a list doesn't carry, so the detail is fetched once the row is within a screen of view, and
 *  kept (the query cache is saved to disk). Until then the column holds a dash. */
function PickRow({ item, intent, where, selected }: { item: MediaItem; intent: Intent; where: string; selected: boolean }) {
  const now = useMinuteTick()
  const [near, itemRef] = useNearScreen()
  const { data } = useQuery({ ...q.detail(item.type, item.id), enabled: near })
  // The placeholder (what the list knew) has no runtime or episodes, so only a real answer counts.
  const detail = data && (data.runtime || data.seasons.length || data.nextEpisode || data.lastEpisode) ? data : undefined
  const when = pickWhen(item, detail, now, userLocale)
  const preview = { item }
  return (
    <Listing
      link={{ to: '/title/$type/$id', params: { type: item.type, id: item.id } }}
      itemRef={itemRef}
      when={when}
      title={item.title}
      meta={pickMeta(item)}
      artPath={item.poster}
      label={'ends' in when ? `${spokenPick(item)}, ends ${formatClock(endTime(now, when.ends), userLocale)}` : spokenPick(item)}
      selected={selected}
      onIntent={() => {
        prefetchDetail(item)
        intent(preview, where)?.()
      }}
    />
  )
}

/** True once the element has come within a screen of the viewport, and stays true. */
function useNearScreen() {
  const [near, setNear] = useState(false)
  const ref = (el: HTMLLIElement | null) => {
    if (!el || near) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          watch.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    watch.observe(el)
    return () => watch.disconnect()
  }
  return [near, ref] as const
}

/** No resume item and no picks: a fresh install, or the catalogue can't be reached. Say what to do. */
function Setup({ error }: { error: boolean }) {
  return (
    <section className={s.setup} aria-labelledby="setup">
      <h2 id="setup" className={s.setupTitle}>
        Set Up Your Sources
      </h2>
      <p className={s.setupText}>
        Flow plays from your own servers, stream add-ons and live TV. Add one in Settings, and tonight’s programme fills in: what you’re watching, when it would finish and what’s new.
      </p>
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
