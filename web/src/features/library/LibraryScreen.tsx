import { Link, useNavigate } from '@tanstack/react-router'
import '../home/installCardMenu'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { PosterItem, ResumeItem } from '../../components/TitleCards'
import { useFollowedTeams } from '../../lib/sports/settings'
import { useSettings } from '../../lib/store/settings'
import { activeTracker } from '../../lib/tracking/service'
import { enabledServers, refreshServerIndex } from '../home/marks'
import { library, useLibrary, type Progress } from '../../lib/store/library'
import type { MediaType } from '../../lib/tmdb/types'
import { Segmented, Select, StateView } from '../explore/Controls'
import { PageHead, Section, Toolbar } from '../explore/PageHead'
import { PosterGrid } from '../explore/PosterGrid'
import { BackLink } from './BackLink'
import { HistoryItem, HistoryList } from './HistoryList'
import { groupHistory, historyRows, isLibraryPage, listSorts, listTitles, sortEntries, titles, watchlistSorts, type LibraryList, type LibraryPage, type ListSort } from './logic'
import { ReorderGrid } from './ReorderGrid'
import s from './LibraryScreen.module.css'

/* Upcoming, Sports and Stats are each their own chunk: Library's overview carries none of their code. */
const UpcomingPage = lazy(() => import('./UpcomingPage'))
const SportsPage = lazy(() => import('./SportsPage'))
const StatsPage = lazy(() => import('./StatsPage'))
/* The list shelves are Home's, and so is their code: a chunk of its own, asked for as the overview opens. */
const ListShelves = lazy(() => import('../home/Shelves').then((m) => ({ default: m.LibraryListShelves })))
const ShelfPage = lazy(() => import('./ShelfPage'))

type Filter = 'all' | MediaType
const filters = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'Shows' },
] as const

const stillSizes = '(min-width: 1100px) 22vw, (min-width: 721px) 30vw, 240px'

/** Library: what you're watching, saving and have watched. The overview shows a little of each list;
 *  "See all" opens the whole list (`?list=`), with filters for the long ones. */
export function LibraryScreen({ list, type, sort, shelf }: { list?: LibraryList; type?: MediaType; sort: ListSort; shelf?: string }) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [list, shelf])
  return <div className={`page ${s.screen}`}>{shelf && !list ? <OneShelf shelf={shelf} type={type} /> : isLibraryPage(list) ? <ReadingPage page={list} /> : list ? <FullList list={list} type={type} sort={sort} /> : <Overview />}</div>
}

// MARK: Overview

function Overview() {
  const progress = useLibrary((l) => l.progress)
  const watchlist = useLibrary((l) => l.watchlist)
  const favourites = useLibrary((l) => l.favourites)
  const history = useLibrary((l) => l.history)
  const inProgress = Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt)
  const empty = !inProgress.length && !watchlist.length && !favourites.length && !history.length

  return (
    <>
      <PageHead title="Library" note={`${history.length.toLocaleString()} watched`}>
        <RefreshLibrary />
      </PageHead>
      <Pages watched={history.length} />
      {empty ? (
        <StateView
          icon="library"
          title="Your Library Is Empty"
          message="Add titles to your Watchlist with the + on any title. What you start and finish watching shows up here too."
          action={
            <Link to="/explore" className="btn btn-primary">
              Browse Titles
            </Link>
          }
        />
      ) : (
        <>
          {inProgress.length > 0 && (
            <LibrarySection list="continue" count={inProgress.length}>
              <ul className={s.stills}>
                {inProgress.map((p) => (
                  <ContinueItem key={p.key} progress={p} />
                ))}
              </ul>
            </LibrarySection>
          )}
          {watchlist.length > 0 && (
            <LibrarySection list="watchlist" count={watchlist.length}>
              <ul className={s.posters}>
                {watchlist.slice(0, 14).map((e) => (
                  <PosterItem key={e.key} item={e.item} sizes="(max-width: 720px) 112px, 180px" />
                ))}
              </ul>
            </LibrarySection>
          )}
          {favourites.length > 0 && (
            <LibrarySection list="favourites" count={favourites.length}>
              <ul className={s.posters}>
                {favourites.slice(0, 14).map((e) => (
                  <PosterItem key={e.key} item={e.item} sizes="(max-width: 720px) 112px, 180px" />
                ))}
              </ul>
            </LibrarySection>
          )}
          {history.length > 0 && <RecentHistory />}
        </>
      )}
      <div className={s.listShelves}>
        <Suspense fallback={null}>
          <ListShelves />
        </Suspense>
      </div>
    </>
  )
}

/** A list shelf as a whole grid, under Library's back link (See all on the shelf). */
function OneShelf({ shelf, type }: { shelf: string; type?: MediaType }) {
  const navigate = useNavigate({ from: '/library' })
  return (
    <Suspense fallback={<p className="muted" role="status">Loading…</p>}>
      <ShelfPage shelfId={shelf} type={type} onType={(t) => void navigate({ search: (prev) => ({ ...prev, type: t }), replace: true, resetScroll: false })} />
    </Suspense>
  )
}

/** Refresh Library, as the apps' button in this place: bring in what the tracker has now, and ask the media servers what
 *  they hold again. It shows only when there is something to ask: a service tracking, or a server. */
function RefreshLibrary() {
  const tracker = useSettings(activeTracker)
  const servers = enabledServers(useSettings((x) => x.servers))
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle')
  if (tracker === 'local' && servers.length === 0) return null

  async function refresh() {
    setState('working')
    try {
      await Promise.all([
        tracker === 'trakt' ? import('../../lib/trakt/engine').then((m) => m.syncTrakt()) : tracker === 'simkl' || tracker === 'mdblist' ? import('../../lib/tracking/engine').then((m) => m.syncTracker()) : undefined,
        servers.length > 0 ? refreshServerIndex() : undefined,
      ])
    } catch {
      // Each service reports its own trouble in Settings; this button only asks again.
    }
    setState('done')
  }

  return (
    <>
      <button type="button" className={`btn btn-secondary btn-circle ${s.refresh}`} aria-label="Refresh Library" onClick={() => void refresh()} disabled={state === 'working'} data-working={state === 'working' ? '' : undefined}>
        <Icon name="refresh" size={18} strokeWidth={2.2} />
      </button>
      <span className="sr-only" role="status">
        {state === 'working' ? 'Refreshing your library…' : state === 'done' ? 'Library refreshed.' : ''}
      </span>
    </>
  )
}

/** The places that read your library rather than list it, as an index (the apps' tiles): where the apps put Upcoming,
 *  Sports, History and Stats. */
function Pages({ watched }: { watched: number }) {
  const teams = useFollowedTeams().length
  const rows: { list: LibraryList; subtitle: string }[] = [
    { list: 'upcoming', subtitle: 'New episodes' },
    { list: 'sports', subtitle: teams === 0 ? 'Follow your teams' : teams === 1 ? '1 team followed' : `${teams} teams followed` },
    { list: 'history', subtitle: watched === 0 ? 'Watched titles' : watched === 1 ? '1 title' : `${watched.toLocaleString()} titles` },
    { list: 'stats', subtitle: 'Your watching' },
  ]
  return (
    <nav aria-label="Library pages">
      <ol className={s.pages}>
        {rows.map((r, i) => (
          <li key={r.list}>
            <Link to="/library" search={{ list: r.list }} className={`row ${s.pageLink}`}>
              <span className={`num ${s.pageNumber}`}>{String(i + 1).padStart(2, '0')}</span>
              <span className={s.pageName}>{listTitles[r.list]}</span>
              <span className={`muted ${s.pageSub}`}>{r.subtitle}</span>
              <Icon name="chevronRight" size={16} strokeWidth={2.4} />
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Upcoming, Sports or Stats, under Library's back link. Each loads on its own. */
function ReadingPage({ page }: { page: LibraryPage }) {
  return (
    <>
      <PageHead title={listTitles[page]} back={<BackLink />} />
      <Suspense fallback={<p className="muted" role="status">Loading…</p>}>
        {page === 'upcoming' ? <UpcomingPage /> : page === 'sports' ? <SportsPage /> : <StatsPage />}
      </Suspense>
    </>
  )
}

/** A ruled section with its count and a link to the whole list, then the list's first items. */
function LibrarySection({ list, count, children }: { list: 'continue' | 'watchlist' | 'favourites'; count: number; children: ReactNode }) {
  return (
    <Section id={`lib-${list}`} title={listTitles[list]} count={count.toLocaleString()} end={<Link to="/library" search={{ list }}>See all</Link>}>
      {children}
    </Section>
  )
}

/** The latest few watches, under the same day headings as the full list. */
function RecentHistory() {
  const history = useLibrary((l) => l.history)
  const groups = groupHistory(history.slice(0, 6), Date.now())
  return (
    <Section id="lib-history" title={listTitles.history} count={history.length.toLocaleString()} end={<Link to="/library" search={{ list: 'history' }}>See all</Link>} className={s.history}>
      <div className={s.bleed}>
        {groups.map((g, i) => (
          <div key={g.label}>
            <h3 className={s.dayHeading} data-first={i === 0 || undefined}>
              {g.label}
            </h3>
            {g.entries.map((e) => (
              <div key={`${e.key}${e.watchedAt}`} className={s.recentRow}>
                <HistoryItem entry={e} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  )
}

/** A Continue Watching item with a way to drop it from the list. */
function ContinueItem({ progress: p }: { progress: Progress }) {
  return (
    <ResumeItem p={p} sizes={stillSizes}>
      <button type="button" className={`btn btn-secondary btn-circle btn-compact ${s.remove}`} onClick={() => library.removeProgress(p.key)} aria-label={`Remove ${p.item.title} from Continue Watching`}>
        <Icon name="close" size={14} strokeWidth={2.8} />
      </button>
    </ResumeItem>
  )
}

// MARK: One whole list

function FullList({ list, type, sort }: { list: Exclude<LibraryList, LibraryPage>; type?: MediaType; sort: ListSort }) {
  const navigate = useNavigate({ from: '/library' })
  const setFilter = (f: Filter) => void navigate({ search: (prev) => ({ ...prev, type: f === 'all' ? undefined : f }), replace: true, resetScroll: false })
  const setSort = (v: ListSort) => void navigate({ search: (prev) => ({ ...prev, sort: v === 'added' ? undefined : v }), replace: true, resetScroll: false })
  const filter = <Segmented className={s.filter} options={filters} value={type ?? 'all'} onChange={setFilter} label="Show" />

  return (
    <>
      <PageHead title={listTitles[list]} back={<BackLink />} />
      {list === 'continue' ? (
        <ContinueList />
      ) : list === 'history' ? (
        <History type={type} filter={filter} />
      ) : (
        <Saved list={list} type={type} sort={sort} filter={filter} sortMenu={<Select options={list === 'watchlist' ? watchlistSorts : listSorts} value={list === 'watchlist' || sort !== 'custom' ? sort : 'added'} onChange={setSort} label="Sort by" />} />
      )}
    </>
  )
}

function ContinueList() {
  const progress = useLibrary((l) => l.progress)
  const entries = Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt)
  if (!entries.length) return <StateView icon="play" title="Nothing in Progress" message="Start a movie or an episode, and it waits here for you to pick up where you left off." />
  return (
    <ul className={s.continueGrid}>
      {entries.map((p) => (
        <ContinueItem key={p.key} progress={p} />
      ))}
    </ul>
  )
}

function Saved({ list, type, sort, filter, sortMenu }: { list: 'watchlist' | 'favourites'; type?: MediaType; sort: ListSort; filter: ReactNode; sortMenu: ReactNode }) {
  const entries = useLibrary((l) => (list === 'watchlist' ? l.watchlist : l.favourites))
  const order = useLibrary((l) => l.watchlistOrder)
  // Custom is the Watchlist's alone; an address that asks for it on Favourites gets them as they were added.
  const custom = list === 'watchlist' && sort === 'custom'
  const [arranging, setArranging] = useState(false)
  const shown = sortEntries(entries, custom || sort !== 'custom' ? sort : 'added', type, order)
  if (!entries.length)
    return list === 'watchlist' ? (
      <StateView icon="bookmark" title="Nothing in Your Watchlist" message="Tap + on any title to save it here for later." action={<BrowseButton />} />
    ) : (
      <StateView icon="heart" title="No Favourites Yet" message="Tap the heart on a title you love, and it’s kept here." action={<BrowseButton />} />
    )
  return (
    <>
      <Toolbar>
        {filter}
        <span className={s.toolbarEnd}>
          <span className="muted num">{titles(shown.length)}</span>
          {custom && !type && shown.length > 1 && (
            <button type="button" className="btn btn-secondary btn-compact" aria-pressed={arranging} onClick={() => setArranging(!arranging)}>
              {arranging ? 'Done' : 'Arrange'}
            </button>
          )}
          {sortMenu}
        </span>
      </Toolbar>
      {custom && type && <p className={`${s.hint} muted`}>Choose All to rearrange your watchlist.</p>}
      {!shown.length ? <FilteredEmpty type={type} /> : custom && !type ? <ReorderGrid entries={shown} arranging={arranging} /> : <PosterGrid items={shown.map((e) => e.item)} label={listTitles[list]} />}
    </>
  )
}

function History({ type, filter }: { type?: MediaType; filter: ReactNode }) {
  const history = useLibrary((l) => l.history)
  if (!history.length) return <StateView icon="history" title="Nothing Watched Yet" message="Titles and episodes you finish appear here, newest first." action={<BrowseButton />} />
  const shown = type ? history.filter((e) => e.item.type === type) : history
  const rows = historyRows(groupHistory(shown, Date.now()))
  return (
    <div>
      <Toolbar>
        {filter}
        <span className={s.toolbarEnd}>
          <button
            className="btn btn-secondary btn-compact"
            onClick={() => {
              if (window.confirm('Clear your watch history on this device? This can’t be undone.')) library.clearHistory()
            }}
          >
            <Icon name="trash" size={15} /> Clear History
          </button>
        </span>
      </Toolbar>
      {rows.length ? <HistoryList rows={rows} /> : <FilteredEmpty type={type} />}
    </div>
  )
}

function FilteredEmpty({ type }: { type?: MediaType }) {
  return <StateView title={type === 'movie' ? 'No Movies Here' : 'No Shows Here'} message="Choose All to see everything in this list." />
}

function BrowseButton() {
  return (
    <Link to="/explore" className="btn btn-secondary">
      Browse Titles
    </Link>
  )
}
