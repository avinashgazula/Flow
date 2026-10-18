import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { BackdropCard, PosterCard } from '../../components/Cards'
import { Icon, type IconName } from '../../components/Icon'
import { Shelf } from '../../components/Shelf'
import { library, useLibrary, type Progress } from '../../lib/store/library'
import type { MediaType } from '../../lib/tmdb/types'
import { Segmented, Select, StateView } from '../explore/Controls'
import { PosterGrid } from '../explore/PosterGrid'
import { HistoryItem, HistoryList } from './HistoryList'
import { groupHistory, historyRows, listSorts, listTitles, sortEntries, titles, type LibraryList, type ListSort } from './logic'
import s from './LibraryScreen.module.css'

type Filter = 'all' | MediaType
const filters = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'Shows' },
] as const

/** Library: what you're watching, saving and have watched. The overview shows a little of each list;
 *  a tile or "See All" opens the whole list (`?list=`), with filters for the long ones. */
export function LibraryScreen({ list, type, sort }: { list?: LibraryList; type?: MediaType; sort: ListSort }) {
  useEffect(() => window.scrollTo(0, 0), [list])
  return <div className={`page ${s.screen}`}>{list ? <FullList list={list} type={type} sort={sort} /> : <Overview />}</div>
}

// MARK: Overview

const tiles: { list: LibraryList; icon: IconName; tint: string }[] = [
  { list: 'continue', icon: 'play', tint: s.blue! },
  { list: 'watchlist', icon: 'bookmark', tint: s.teal! },
  { list: 'favourites', icon: 'heart', tint: s.pink! },
  { list: 'history', icon: 'history', tint: s.orange! },
]

function Overview() {
  const progress = useLibrary((l) => l.progress)
  const watchlist = useLibrary((l) => l.watchlist)
  const favourites = useLibrary((l) => l.favourites)
  const history = useLibrary((l) => l.history)
  const inProgress = Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt)
  const counts: Record<LibraryList, string> = {
    continue: inProgress.length ? `${inProgress.length} in progress` : 'Pick up where you left off',
    watchlist: watchlist.length ? titles(watchlist.length) : 'Save titles for later',
    favourites: favourites.length ? titles(favourites.length) : 'Titles you love',
    history: history.length ? `${history.length.toLocaleString()} watched` : 'What you’ve watched',
  }
  const empty = !inProgress.length && !watchlist.length && !favourites.length && !history.length

  return (
    <>
      <h1 className="page-title">Library</h1>
      <nav className={s.tiles} aria-label="Lists">
        {tiles.map((t) => (
          <Link key={t.list} to="/library" search={{ list: t.list }} className={`${s.tile} ${t.tint}`}>
            <span className={s.tileIcon}>
              <Icon name={t.icon} size={19} strokeWidth={2.3} filled={t.icon === 'heart' || t.icon === 'play' ? true : undefined} />
            </span>
            <span className={s.tileText}>
              <span className={s.tileTitle}>
                {/* Two tiles across a phone leave no room for the long name. */}
                {t.list === 'continue' ? (
                  <>
                    <span className={s.wide}>{listTitles.continue}</span>
                    <span className={s.narrow}>Continue</span>
                  </>
                ) : (
                  listTitles[t.list]
                )}
              </span>
              <span className={s.tileCount}>{counts[t.list]}</span>
            </span>
            <Icon name="chevronRight" size={14} strokeWidth={2.8} className={s.tileChevron} />
          </Link>
        ))}
      </nav>

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
        <div className={s.bleed}>
          {inProgress.length > 0 && (
            <Shelf title="Continue Watching" kind="backdrop" seeAll={{ to: '/library', search: { list: 'continue' } }}>
              {inProgress.map((p) => (
                <ContinueCard key={p.key} progress={p} />
              ))}
            </Shelf>
          )}
          {watchlist.length > 0 && (
            <Shelf title="Watchlist" seeAll={{ to: '/library', search: { list: 'watchlist' } }}>
              {watchlist.slice(0, 30).map((e) => (
                <PosterCard key={e.key} item={e.item} />
              ))}
            </Shelf>
          )}
          {favourites.length > 0 && (
            <Shelf title="Favourites" seeAll={{ to: '/library', search: { list: 'favourites' } }}>
              {favourites.slice(0, 30).map((e) => (
                <PosterCard key={e.key} item={e.item} />
              ))}
            </Shelf>
          )}
          {history.length > 0 && <RecentHistory />}
        </div>
      )}
    </>
  )
}

/** The latest few watches, under the same day headings as the full list. */
function RecentHistory() {
  const history = useLibrary((l) => l.history)
  const groups = groupHistory(history.slice(0, 6), Date.now())
  return (
    <section className={s.recent}>
      <SectionHeader title="History" to="history" />
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

function SectionHeader({ title, to }: { title: string; to: LibraryList }) {
  return (
    <header className={s.sectionHeader}>
      <Link to="/library" search={{ list: to }} className={s.sectionTitle}>
        {title}
        <Icon name="chevronRight" size={16} strokeWidth={2.6} />
      </Link>
    </header>
  )
}

/** A Continue Watching card with a way to drop it from the list. */
function ContinueCard({ progress: p }: { progress: Progress }) {
  return (
    <div className={s.continue}>
      <BackdropCard item={p.item} sublabel={remaining(p)} progress={p.position / p.duration} to={p.episode} />
      <button className={`btn btn-glass btn-circle btn-compact ${s.remove}`} onClick={() => library.removeProgress(p.key)} aria-label={`Remove ${p.item.title} from Continue Watching`}>
        <Icon name="close" size={14} strokeWidth={2.8} />
      </button>
    </div>
  )
}

function remaining(p: Progress) {
  const minutes = Math.max(1, Math.round((p.duration - p.position) / 60))
  const left = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left`
  return p.episode ? `S${p.episode.season} E${p.episode.episode} · ${left}` : left
}

// MARK: One whole list

function FullList({ list, type, sort }: { list: LibraryList; type?: MediaType; sort: ListSort }) {
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
    <div className={s.continueGrid}>
      {entries.map((p) => (
        <ContinueCard key={p.key} progress={p} />
      ))}
    </div>
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
          <span className="faint">{titles(shown.length)}</span>
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
            className="btn btn-glass btn-compact"
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
    <Link to="/explore" className="btn btn-glass">
      Browse Titles
    </Link>
  )
}
