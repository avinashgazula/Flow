import { useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useId, useRef, type ReactNode } from 'react'
import { FrameCard } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import { rank } from '../../components/stripLayout'
import { PosterItem, useSeenDetail } from '../../components/TitleCards'
import { prefetchDetail, q } from '../../lib/queries'
import { providerLogo, useWatchProviders } from '../../lib/providers'
import type { BuiltInShelf, ShelfConfig } from '../../lib/shelfDefaults'
import { rememberLibraryOrigin } from '../../lib/sources/lastSource'
import type { ServerLibrary, ServerTitle } from '../../lib/sources/types'
import { useLibrary, mediaKey } from '../../lib/store/library'
import { hasCatalog, useSettings, type ServerConfig } from '../../lib/store/settings'
import { userLocale, useMinuteTick } from '../../lib/time'
import type { MediaItem, Page } from '../../lib/tmdb/types'
import { useNearScreen } from '../../lib/useNearScreen'
import { followedShows, showStatus } from './continue'
import { genreTiles, serviceTiles } from './folders'
import { episodeShort, pickMeta, pickPrint, spokenPick } from './logic'
import { asMediaItem, enabledServers, useServerLookup, watchedShowsOf } from './marks'
import { builtInExplore, discoverParams, exploreLinkFor, type ExploreLink } from './shelfQuery'
import { airLabel, airSpoken, buildUpcoming, filmCandidates, type UpcomingEntry, type UpcomingFilm, type UpcomingShow } from './upcoming'
import s from './HomeScreen.module.css'

/* Everything on Home under the lead and Up Next: the shelves, in the order Settings → Shelves gives them. Each
   asks for its titles only once it is near the screen, so a long list of shelves costs nothing until scrolled to.
   This file is its own chunk, loaded beside the page's first data rather than ahead of the first paint. */

/** Continue Watching and Up Next live beside the lead, not in the rows. */
const besideLead: ReadonlySet<BuiltInShelf> = new Set(['continueWatching', 'nextUp'])

/** Catalogue rows that the shelf-length setting caps; your own lists and watch state always show in full. */
const contentShelves: ReadonlySet<BuiltInShelf> = new Set([
  'trendingMovies', 'trendingShows', 'popularMovies', 'popularShows', 'topRatedMovies', 'topRatedShows', 'nowPlaying', 'upcomingMovies', 'airingToday',
  'anticipatedMovies', 'anticipatedShows', 'recommendedForYou', 'becauseYouWatched',
])

export default function Shelves() {
  const shelves = useSettings((x) => x.shelves)
  const showContinue = useSettings((x) => x.showContinueWatching)
  const showUpcoming = useSettings((x) => x.showUpcoming)
  const rows = shelves.filter((sh) => {
    if (!sh.enabled) return false
    if (sh.source.kind === 'builtIn') {
      if (besideLead.has(sh.source.id)) return false
      if (sh.source.id === 'upcomingEpisodes') return showUpcoming
    }
    return true
  })
  const upNext = showContinue && shelves.some((sh) => sh.enabled && sh.source.kind === 'builtIn' && besideLead.has(sh.source.id))
  if (rows.length === 0 && !upNext) {
    return (
      <p className={s.teach}>
        Every shelf is off. Turn some on in <Link to="/settings" hash="shelves">Settings → Shelves</Link>.
      </p>
    )
  }
  return (
    <div className={s.picks}>
      {rows.map((sh) => (
        <ShelfSection key={sh.id} shelf={sh} />
      ))}
      <ServerHomeRows />
    </div>
  )
}

function ShelfSection({ shelf }: { shelf: ShelfConfig }) {
  const { source } = shelf
  if (source.kind === 'builtIn') {
    switch (source.id) {
      case 'streamingServices':
        return <ServicesFolder title={shelf.title} />
      case 'genres':
        return <GenresFolder title={shelf.title} />
      case 'upcomingEpisodes':
        return <UpcomingShelf title={shelf.title} />
      case 'mediaServerRecent':
        return <RecentServerShelf title={shelf.title} />
      default:
        return <TitleShelf shelf={shelf} />
    }
  }
  if (source.kind === 'discover') return <TitleShelf shelf={shelf} />
  if (source.kind === 'mediaServerLibrary') return <LibraryShelf title={shelf.title} serverId={source.serverID} libraryId={source.libraryID} />
  // Trakt lists and MDBList lists are kept in the list and shown once those sources exist.
  return null
}

// MARK: Rows of titles

type Feed = UseQueryOptions<Page<MediaItem>, Error, Page<MediaItem>, any>

/** The catalogue request behind a shelf, where it is one. Rows made of the viewer's own lists, or of a title's
 *  recommendations, are read some other way. */
function catalogueFeed(shelf: ShelfConfig, region: string, today: number): Feed | undefined {
  const { source } = shelf
  if (source.kind === 'discover') return q.discover(source.query.type, discoverParams(source.query, region, today))
  if (source.kind !== 'builtIn') return undefined
  switch (source.id) {
    case 'trendingMovies': return q.trending('movie')
    case 'trendingShows': return q.trending('show')
    case 'popularMovies': return q.list('movie', 'popular')
    case 'popularShows': return q.list('show', 'popular')
    case 'topRatedMovies': return q.list('movie', 'top_rated')
    case 'topRatedShows': return q.list('show', 'top_rated')
    case 'nowPlaying': return q.list('movie', 'now_playing')
    case 'upcomingMovies': return q.list('movie', 'upcoming')
    case 'airingToday': return q.list('show', 'airing_today')
    // Without a tracker's list, what's anticipated is what comes out in the next year, most popular first.
    case 'anticipatedMovies': return q.discover('movie', discoverParams({ type: 'movie', genres: [], excludedGenres: [], sort: 'popularity.desc', watchProviders: [], releasedFromDays: 1, releasedToDays: 365 }, region, today))
    case 'anticipatedShows': return q.discover('show', discoverParams({ type: 'show', genres: [], excludedGenres: [], sort: 'popularity.desc', watchProviders: [], releasedFromDays: 1, releasedToDays: 365 }, region, today))
    // Recommended For You falls back to what's trending when nothing has been watched yet.
    case 'recommendedForYou': return q.trending('movie')
    default: return undefined
  }
}

const startOfDay = () => new Date().setHours(0, 0, 0, 0)
const uniqueByKey = (items: MediaItem[]) => {
  const seen = new Set<string>()
  return items.filter((m) => !seen.has(mediaKey(m.type, m.id)) && !!seen.add(mediaKey(m.type, m.id)))
}

/** A shelf of titles: a heading with See all, then posters at one size (stills for a landscape shelf). */
function TitleShelf({ shelf }: { shelf: ShelfConfig }) {
  const [near, ref] = useNearScreen<HTMLElement>()
  const region = useSettings((x) => x.region)
  const length = useSettings((x) => x.contentShelfLength)
  const watchlist = useLibrary((l) => l.watchlist)
  const favourites = useLibrary((l) => l.favourites)
  const history = useLibrary((l) => l.history)
  const id = useId()
  const builtIn = shelf.source.kind === 'builtIn' ? shelf.source.id : undefined

  const server = useServerLookup()
  const feed = catalogueFeed(shelf, region, startOfDay())
  const usesSeed = builtIn === 'becauseYouWatched' || builtIn === 'recommendedForYou'
  const seed = usesSeed ? history[0]?.item : undefined
  const catalogue = useQuery({ ...(feed ?? q.trending('movie')), enabled: near && !!feed && !(builtIn === 'recommendedForYou' && seed) })
  const seedDetail = useQuery({ ...q.detail(seed?.type ?? 'movie', seed?.id ?? 0), enabled: near && !!seed })

  let items: MediaItem[] = []
  let pending = !near
  if (builtIn === 'watchlist') items = watchlist.map((e) => e.item)
  else if (builtIn === 'favourites') items = favourites.map((e) => e.item)
  else if (builtIn === 'recentlyWatched') items = uniqueByKey(history.map((h) => h.item))
  else if (usesSeed && seed) {
    const d = seedDetail.data
    const recommended = d && (d.recommendations.length ? d.recommendations : d.similar)
    const watched = new Set(history.map((h) => h.key))
    items = (recommended ?? []).filter((m) => !watched.has(mediaKey(m.type, m.id)))
    // The title's own list is a placeholder (just what a card knew) until the detail arrives.
    pending ||= seedDetail.isPending || seedDetail.isPlaceholderData
  } else if (builtIn === 'becauseYouWatched') {
    items = []
  } else {
    items = catalogue.data?.results ?? []
    pending ||= catalogue.isPending
  }
  // Only Show My Server's Content: titles the servers don't list are left out. When no server can be read the
  // filter can't judge, so the row shows as it is.
  if (server.only && server.has) items = items.filter(server.has)
  pending ||= server.only && server.pending
  const failed = catalogue.isError && !items.length
  const capped = builtIn && contentShelves.has(builtIn) ? length : shelf.source.kind === 'discover' ? length : 40
  const shown = items.slice(0, capped)
  const title = builtIn === 'becauseYouWatched' && seed ? `Because You Watched ${seed.title}` : shelf.title
  const see = builtIn ? builtInExplore(builtIn) : shelf.source.kind === 'discover' ? exploreLinkFor(shelf.source.query) : undefined

  // Once loaded, a shelf with nothing in it (nothing watched yet, an empty list) leaves no gap.
  if (!pending && (failed || shown.length === 0)) return null
  const stills = shelf.style === 'landscape'
  return (
    <section ref={ref} className={s.rowSection} aria-labelledby={id}>
      {stills ? (
        <ScrollRow id={id} title={title} see={see} busy={pending}>
          {pending ? <StillGhosts /> : shown.map((m) => <StillItem key={mediaKey(m.type, m.id)} item={m} />)}
        </ScrollRow>
      ) : (
        <>
        <RowHead id={id} title={title} see={see} />
        <ul className={s.row} aria-busy={pending || undefined}>
          {pending ? Array.from({ length: 7 }, (_, i) => <PosterGhost key={i} />) : shown.map((m) => <PosterItem key={mediaKey(m.type, m.id)} item={m} sizes="(max-width: 720px) 112px, 180px" />)}
        </ul>
        </>
      )}
    </section>
  )
}

const PosterGhost = () => (
  <li className={s.ghost} aria-hidden="true">
    <span />
  </li>
)

function RowHead({ id, title, see, children }: { id: string; title: string; see?: ExploreLink; children?: ReactNode }) {
  return (
    <div className={s.rowHead}>
      <h2 id={id} className={s.rowTitle}>
        {title}
      </h2>
      {see && (
        <Link to="/explore" search={see} className={s.seeAll}>
          See all
        </Link>
      )}
      {children}
    </div>
  )
}

// MARK: Stills

const stillRowSizes = '(max-width: 720px) 240px, 280px'

/** A title not started, as a still with print only. */
function StillItem({ item }: { item: MediaItem }) {
  const now = useMinuteTick()
  const [ref, detail] = useSeenDetail(item)
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: item.type, id: item.id } }}
      itemRef={ref}
      shape="still"
      artPath={item.backdrop}
      sizes={stillRowSizes}
      print={pickPrint(item, detail, now, { ends: true, locale: userLocale })}
      title={item.title}
      meta={pickMeta(item)}
      label={spokenPick(item, detail)}
      fallback={item.title}
      onIntent={() => prefetchDetail(item)}
    />
  )
}

const StillGhosts = () => (
  <>
    {Array.from({ length: 4 }, (_, i) => (
      <li key={i} className={s.stillGhost} aria-hidden="true" />
    ))}
  </>
)

/** A row of stills that scrolls sideways, with round buttons for a mouse (a phone or a trackpad just swipes). */
function ScrollRow({ id, title, see, busy, children }: { id: string; title: string; see?: ExploreLink; busy?: boolean; children: ReactNode }) {
  const row = useRef<HTMLUListElement>(null)
  const scroll = (direction: 1 | -1) => row.current?.scrollBy({ left: direction * row.current.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  return (
    <>
      <RowHead id={id} title={title} see={see}>
        <div className={s.arrows}>
          <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={() => scroll(-1)} aria-label={`Scroll ${title} back`}>
            <Icon name="chevronLeft" size={16} strokeWidth={2.6} />
          </button>
          <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={() => scroll(1)} aria-label={`Scroll ${title} forward`}>
            <Icon name="chevronRight" size={16} strokeWidth={2.6} />
          </button>
        </div>
      </RowHead>
      <ul className={s.stillRow} ref={row} aria-busy={busy || undefined}>
        {children}
      </ul>
    </>
  )
}

// MARK: Upcoming

/** The next episodes of the shows being followed (everything in the history, and the watchlist's series when
 *  premieres are wanted), each with the day it airs on its strip. */
function UpcomingShelf({ title }: { title: string }) {
  const [near, ref] = useNearScreen<HTMLElement>()
  const id = useId()
  const history = useLibrary((l) => l.history)
  const watchlist = useLibrary((l) => l.watchlist)
  const marks = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const withinDays = useSettings((x) => x.upcomingWithinDays)
  const premieres = useSettings((x) => x.includeWatchlistPremieres)
  const filmDates = useSettings((x) => x.filmDates ?? 'digital')
  const region = useSettings((x) => x.region)
  const now = useMinuteTick()

  const followed = followedShows(history, new Set(), 12)
  const known = new Set(followed.map((f) => f.key))
  const listed = watchlist.filter((e) => e.item.type === 'show' && !known.has(e.key)).slice(0, premieres ? 12 : 0)
  const candidates = [...followed.map((f) => f.item), ...listed.map((e) => e.item)]
  const details = useQueries({ queries: candidates.map((item) => ({ ...q.detail('show', item.id), enabled: near })) })
  // Films are dated by their release dates, which come with the film's details; they matter only when premieres do.
  const filmItems = premieres ? filmCandidates(watchlist, now, 12) : []
  const filmDetails = useQueries({ queries: filmItems.map((item) => ({ ...q.detail('movie', item.id), enabled: near })) })
  const onWatchlist = new Set(watchlist.map((e) => e.key))
  const watched = watchedShowsOf(marks, rewatches)

  const shows: UpcomingShow[] = candidates.flatMap((item, i) => {
    const detail = details[i]?.data
    if (!detail?.nextEpisode) return []
    const seen = watched.get(item.id) ?? []
    // Caught up: something watched, and nothing aired is waiting.
    const caughtUp = seen.length > 0 && showStatus(seen, detail, now).next === undefined
    return [{ item, nextEpisode: detail.nextEpisode, caughtUp, onWatchlist: onWatchlist.has(`show:${item.id}`) }]
  })
  const films: UpcomingFilm[] = filmItems.map((item, i) => ({ item, releases: filmDetails[i]?.data?.releases ?? [] }))
  const entries = buildUpcoming(shows, now, { withinDays, includeWatchlistPremieres: premieres, filmDates, region }, films)
  const loading = !near || [...details, ...filmDetails].some((d) => d.isPending && d.fetchStatus !== 'idle')
  if (!loading && entries.length === 0) return null
  return (
    <section ref={ref} className={s.rowSection} aria-labelledby={id}>
      <ScrollRow id={id} title={title} busy={loading}>
        {loading && entries.length === 0 ? <StillGhosts /> : entries.map((e) => <UpcomingCard key={e.id} entry={e} />)}
      </ScrollRow>
    </section>
  )
}

function UpcomingCard({ entry }: { entry: UpcomingEntry }) {
  const now = useMinuteTick()
  const { item, episode } = entry
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: item.type, id: item.id }, search: episode ? { season: episode.season } : undefined }}
      shape="still"
      artPath={item.backdrop}
      sizes={stillRowSizes}
      print={[
        { text: episode ? (episodeShort({ season: episode.season, episode: episode.number }) ?? '') : 'Film', rank: rank.episode },
        { text: airLabel(entry.date, now, userLocale), rank: rank.left },
      ]}
      title={item.title}
      meta={episode ? [entry.kind === 'premiere' ? 'Season premiere' : '', episode.name].filter(Boolean).join(' · ') : entry.release === 'theatrical' ? 'In cinemas' : 'Digital release'}
      label={episode ? `${item.title}, season ${episode.season} episode ${episode.number}, ${airSpoken(entry.date, now, userLocale)}` : `${item.title}, ${entry.release === 'theatrical' ? 'in cinemas' : 'out on digital'} ${airSpoken(entry.date, now, userLocale)}`}
      fallback={item.title}
      onIntent={() => prefetchDetail(item)}
    />
  )
}

// MARK: Folders

/** Streaming services, as an index that opens Explore on what streams there. */
function ServicesFolder({ title }: { title: string }) {
  const [near, ref] = useNearScreen<HTMLElement>()
  const id = useId()
  return (
    <section ref={ref} className={s.rowSection} aria-labelledby={id}>
      <RowHead id={id} title={title} />
      {near ? <ServiceTiles /> : <div className={s.indexGhost} aria-hidden="true" />}
    </section>
  )
}

function ServiceTiles() {
  const { providers } = useWatchProviders('movie')
  return (
    <ul className={s.index}>
      {serviceTiles(providers).map((t) => {
        const logo = providerLogo(t.logo)
        return (
          <li key={t.id}>
            <Link to="/explore" search={{ type: 'movie', providers: String(t.id) }} className={s.tile}>
              {logo ? <img className={s.tileLogo} src={logo.src} srcSet={logo.srcSet} alt="" width={28} height={28} loading="lazy" decoding="async" /> : <span className={s.tileLogo} aria-hidden="true" />}
              <span className={s.tileName}>{t.name}</span>
              <Icon name="chevronRight" size={16} strokeWidth={2.4} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Genres, as the same kind of index. */
function GenresFolder({ title }: { title: string }) {
  const id = useId()
  return (
    <section className={s.rowSection} aria-labelledby={id}>
      <RowHead id={id} title={title} />
      <ul className={s.index}>
        {genreTiles.map((g) => (
          <li key={g.id}>
            <Link to="/explore" search={{ type: 'movie', genre: g.id }} className={s.tile}>
              <span className={s.tileName}>{g.name}</span>
              <Icon name="chevronRight" size={16} strokeWidth={2.4} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// MARK: Media servers

const sixMinutes = 6 * 60_000
const idsOf = (servers: readonly ServerConfig[]) => servers.map((v) => v.id).join(',')

/** A row of a server's titles as posters. The titles a server lists carry TMDB ids; each is read from TMDB for its
 *  artwork and facts (the request its poster would make anyway), and Use Server Artwork puts the server's own
 *  pictures over TMDB's. Printed "Server" like any title on one. Nothing is asked until the row is near the screen. */
function ServerRow({ id, title, titles, pending, libraryServerId, near, sectionRef }: { id: string; title: string; titles: ServerTitle[] | undefined; pending: boolean; libraryServerId?: string; near: boolean; sectionRef: React.Ref<HTMLElement> }) {
  const artwork = useSettings((x) => x.useServerArtwork === true)
  const catalogue = useSettings(hasCatalog)
  const shown = (titles ?? []).filter((t) => t.tmdb).slice(0, 40)
  const details = useQueries({ queries: shown.map((t) => ({ ...q.detail(t.type, t.tmdb!), enabled: near && catalogue, retry: false })) })
  // With TMDB's pictures wanted, the row waits for them rather than showing a server's and then swapping.
  const waiting = catalogue && !artwork && details.some((d) => d.isPending && d.fetchStatus !== 'idle')
  const loading = pending || waiting
  if (!pending && shown.length === 0) return null
  return (
    <section ref={sectionRef} className={s.rowSection} aria-labelledby={id}>
      <RowHead id={id} title={title} />
      <ul
        className={s.row}
        aria-busy={loading || undefined}
        // A title opened from a server's library remembers which, for Play From This Library Only. Its link says which title.
        onClickCapture={
          libraryServerId
            ? (e) => {
                const m = /\/title\/(movie|show)\/(\d+)/.exec((e.target as Element).closest('a')?.getAttribute('href') ?? '')
                if (m) rememberLibraryOrigin(m[1] as 'movie' | 'show', Number(m[2]), libraryServerId)
              }
            : undefined
        }
      >
        {loading
          ? Array.from({ length: 7 }, (_, i) => <PosterGhost key={i} />)
          : shown.map((t, i) => {
              const item = asMediaItem(t, details[i]?.data, artwork)
              return item && <PosterItem key={mediaKey(item.type, item.id)} item={item} sizes="(max-width: 720px) 112px, 180px" />
            })}
      </ul>
    </section>
  )
}

/** "Recently Added to Your Server": the newest titles on all enabled servers, newest first. */
function RecentServerShelf({ title }: { title: string }) {
  const [near, ref] = useNearScreen<HTMLElement>()
  const id = useId()
  const servers = enabledServers(useSettings((x) => x.servers))
  const recent = useQuery({
    queryKey: ['servers', 'recent', idsOf(servers)],
    queryFn: async ({ signal }) => (await import('../../lib/sources/serverCatalogue')).recentTitles(servers, signal),
    enabled: near && servers.length > 0,
    staleTime: sixMinutes,
  })
  if (servers.length === 0) return null
  return <ServerRow id={id} title={title} titles={recent.data} pending={!near || recent.isPending} near={near} sectionRef={ref} />
}

/** One library of one server, as a shelf in the list (the apps' `mediaServerLibrary` source). */
function LibraryShelf({ title, serverId, libraryId }: { title: string; serverId: string; libraryId: string }) {
  const [near, ref] = useNearScreen<HTMLElement>()
  const id = useId()
  const server = useSettings((x) => x.servers.find((v) => v.id === serverId && v.enabled))
  const titles = useQuery({
    queryKey: ['servers', 'library', serverId, libraryId],
    queryFn: async ({ signal }) => (await import('../../lib/sources/serverCatalogue')).libraryTitles(server!, libraryId, signal),
    enabled: near && !!server,
    staleTime: sixMinutes,
  })
  if (!server) return null
  return <ServerRow id={id} title={title} titles={titles.data} pending={!near || titles.isPending} libraryServerId={serverId} near={near} sectionRef={ref} />
}

/** Server Home Rows (Settings → Shelves): each switched-on server's libraries, one row each, in the order the server
 *  lists them and named by the library; with several servers the server's name leads ("Living Room · Movies"). */
function ServerHomeRows() {
  const ids = useSettings((x) => x.serverHomeRowIDs)
  const servers = enabledServers(useSettings((x) => x.servers)).filter((v) => ids?.includes(v.id))
  return servers.map((server) => <ServerLibraryRows key={server.id} server={server} named={servers.length > 1} />)
}

function ServerLibraryRows({ server, named }: { server: ServerConfig; named: boolean }) {
  const [near, ref] = useNearScreen<HTMLDivElement>()
  const libraries = useQuery({
    queryKey: ['servers', 'libraries', server.id],
    queryFn: async ({ signal }): Promise<ServerLibrary[]> => (await import('../../lib/sources/serverCatalogue')).serverLibraries(server, signal),
    enabled: near,
    staleTime: sixMinutes,
  })
  return (
    <div ref={ref}>
      {(libraries.data ?? []).map((library) => (
        <LibraryShelf key={library.id} title={named ? `${server.name} · ${library.name}` : library.name} serverId={server.id} libraryId={library.id} />
      ))}
    </div>
  )
}
