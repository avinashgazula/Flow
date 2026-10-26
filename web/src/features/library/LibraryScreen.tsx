import { Link, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { PosterItem, ResumeItem } from '../../components/TitleCards'
import { useFollowedTeams } from '../../lib/sports/settings'
import { library, useLibrary, type Progress } from '../../lib/store/library'
import type { MediaType } from '../../lib/tmdb/types'
import { Segmented, Select, StateView } from '../explore/Controls'
import { PosterGrid } from '../explore/PosterGrid'
import { HistoryItem, HistoryList } from './HistoryList'
import { groupHistory, historyRows, isLibraryPage, listSorts, listTitles, sortEntries, titles, type LibraryList, type LibraryPage, type ListSort } from './logic'
import s from './LibraryScreen.module.css'

/* Upcoming, Sports and Stats are each their own chunk: Library's overview carries none of their code. */
const UpcomingPage = lazy(() => import('./UpcomingPage'))
const SportsPage = lazy(() => import('./SportsPage'))
const StatsPage = lazy(() => import('./StatsPage'))

type Filter = 'all' | MediaType
const filters = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'Shows' },
] as const

const stillSizes = '(min-width: 1100px) 22vw, (min-width: 721px) 30vw, 240px'

/** Library: what you're watching, saving and have watched. The overview shows a little of each list;
 *  "See all" opens the whole list (`?list=`), with filters for the long ones. */
export function LibraryScreen({ list, type, sort }: { list?: LibraryList; type?: MediaType; sort: ListSort }) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [list])
  return <div className={`page ${s.screen}`}>{isLibraryPage(list) ? <ReadingPage page={list} /> : list ? <FullList list={list} type={type} sort={sort} /> : <Overview />}</div>
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
      <h1 className="page-title">Library</h1>
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
            <Section list="continue" count={inProgress.length}>
              <ul className={s.stills}>
                {inProgress.map((p) => (
                  <ContinueItem key={p.key} progress={p} />
                ))}
              </ul>
            </Section>
          )}
          {watchlist.length > 0 && (
            <Section list="watchlist" count={watchlist.length}>
              <ul className={s.posters}>
                {watchlist.slice(0, 14).map((e) => (
                  <PosterItem key={e.key} item={e.item} sizes="(max-width: 720px) 112px, 180px" />
                ))}
              </ul>
            </Section>
          )}
          {favourites.length > 0 && (
            <Section list="favourites" count={favourites.length}>
              <ul className={s.posters}>
                {favourites.slice(0, 14).map((e) => (
                  <PosterItem key={e.key} item={e.item} sizes="(max-width: 720px) 112px, 180px" />
                ))}
              </ul>
            </Section>
          )}
          {history.length > 0 && <RecentHistory />}
        </>
      )}
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
      <ul className={s.pages}>
        {rows.map((r) => (
          <li key={r.list}>
            <Link to="/library" search={{ list: r.list }} className={s.pageLink}>
              <span className={s.pageText}>
                <span className={s.pageName}>{listTitles[r.list]}</span>
                <span className={s.pageSub}>{r.subtitle}</span>
              </span>
              <Icon name="chevronRight" size={16} strokeWidth={2.4} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Upcoming, Sports or Stats, under Library's back link. Each loads on its own. */
function ReadingPage({ page }: { page: LibraryPage }) {
  return (
    <>
      <Link to="/library" className={s.back}>
        <Icon name="chevronLeft" size={16} strokeWidth={2.6} /> Library
      </Link>
      <h1 className="page-title">{listTitles[page]}</h1>
      <Suspense fallback={<p className="muted" role="status">Loading…</p>}>
        {page === 'upcoming' ? <UpcomingPage /> : page === 'sports' ? <SportsPage /> : <StatsPage />}
      </Suspense>
    </>
  )
}

/** A plain heading with its count and a link to the whole list, then the list's first items. */
function Section({ list, count, children }: { list: 'continue' | 'watchlist' | 'favourites'; count: number; children: ReactNode }) {
  return (
    <section className={s.section} aria-labelledby={`lib-${list}`}>
      <header className={s.sectionHead}>
        <h2 id={`lib-${list}`} className={s.sectionTitle}>
          {listTitles[list]}
        </h2>
        <span className={`${s.count} num`}>{count.toLocaleString()}</span>
        <Link to="/library" search={{ list }} className={s.seeAll}>
          See all
        </Link>
      </header>
      {children}
    </section>
  )
}

/** The latest few watches, under the same day headings as the full list. */
function RecentHistory() {
  const history = useLibrary((l) => l.history)
  const groups = groupHistory(history.slice(0, 6), Date.now())
  return (
    <section className={`${s.section} ${s.history}`} aria-labelledby="lib-history">
      <header className={s.sectionHead}>
        <h2 id="lib-history" className={s.sectionTitle}>
          {listTitles.history}
        </h2>
        <span className={`${s.count} num`}>{history.length.toLocaleString()}</span>
        <Link to="/library" search={{ list: 'history' }} className={s.seeAll}>
          See all
        </Link>
      </header>
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className={s.dayHeading}>{g.label}</h3>
          {g.entries.map((e) => (
            <div key={`${e.key}${e.watchedAt}`} className={s.recentRow}>
              <HistoryItem entry={e} />
            </div>
          ))}
        </div>
      ))}
    </section>
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
  const filter = <Segmented options={filters} value={type ?? 'all'} onChange={setFilter} label="Show" />

  return (
    <>
      <Link to="/library" className={s.back}>
        <Icon name="chevronLeft" size={16} strokeWidth={2.6} /> Library
      </Link>
      <h1 className="page-title">{listTitles[list]}</h1>
      {list === 'continue' ? (
        <ContinueList />
      ) : list === 'history' ? (
        <History type={type} filter={filter} />
      ) : (
        <Saved list={list} type={type} sort={sort} filter={filter} sortMenu={<Select options={listSorts} value={sort} onChange={setSort} label="Sort by" />} />
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
  const shown = sortEntries(entries, sort, type)
  if (!entries.length)
    return list === 'watchlist' ? (
      <StateView icon="bookmark" title="Nothing in Your Watchlist" message="Tap + on any title to save it here for later." action={<BrowseButton />} />
    ) : (
      <StateView icon="heart" title="No Favourites Yet" message="Tap the heart on a title you love, and it’s kept here." action={<BrowseButton />} />
    )
  return (
    <>
      <div className={s.toolbar}>
        {filter}
        <span className={s.toolbarEnd}>
          <span className="faint num">{titles(shown.length)}</span>
          {sortMenu}
        </span>
      </div>
      {shown.length ? <PosterGrid items={shown.map((e) => e.item)} label={listTitles[list]} /> : <FilteredEmpty type={type} />}
    </>
  )
}

function History({ type, filter }: { type?: MediaType; filter: ReactNode }) {
  const history = useLibrary((l) => l.history)
  if (!history.length) return <StateView icon="history" title="Nothing Watched Yet" message="Titles and episodes you finish appear here, newest first." action={<BrowseButton />} />
  const shown = type ? history.filter((e) => e.item.type === type) : history
  const rows = historyRows(groupHistory(shown, Date.now()))
  return (
    <div className={s.historyColumn}>
      <div className={s.toolbar}>
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
      </div>
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
