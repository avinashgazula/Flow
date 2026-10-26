import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { posterOf } from '../../lib/ratings/posters'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Artwork } from '../../components/Artwork'
import { Plate } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import { PosterItem } from '../../components/TitleCards'
import { markZoomSource } from '../../components/zoom'
import { genreNames } from '../../lib/genres'
import { prefetchDetail, q } from '../../lib/queries'
import { library, mediaKey, useLibrary } from '../../lib/store/library'
import { userLocale, useMinuteTick } from '../../lib/time'
import type { SearchResult } from '../../lib/tmdb/types'
import { StateView, errorMessage } from '../explore/Controls'
import { pickPrint } from '../home/logic'
import { groupResults, minimumQuery, neighbour, topResult, type Direction, type MediaResult, type PersonResult } from './logic'
import { recentSearches, useRecentSearches } from './recent'
import s from './SearchScreen.module.css'

/** How long typing has to pause before a search goes out. */
const debounce = 200

const arrows: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/** Search: one field, kept in the address, with results that update as you type without flashing.
 *  `/` or ⌘K focuses the field, Enter opens the best match, and the arrow keys walk the results. */
export function SearchScreen({ initial }: { initial: string }) {
  const navigate = useNavigate({ from: '/search' })
  const [text, setText] = useState(initial)
  const [term, setTerm] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (text === term) return
    const timer = setTimeout(() => {
      setTerm(text)
      void navigate({ search: { q: text.trim() || undefined }, replace: true, resetScroll: false })
    }, debounce)
    return () => clearTimeout(timer)
  }, [text, term, navigate])

  // The address changed from outside (the Search tab, Back): follow it.
  useEffect(() => {
    if (initial !== term.trim()) {
      setText(initial)
      setTerm(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  // `/` and ⌘K (Ctrl K elsewhere) reach the field from anywhere on this page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const shortcut = (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)
      if (!shortcut) return
      e.preventDefault()
      input.current?.focus()
      input.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = term.trim().length >= minimumQuery
  const search = useQuery({ ...q.search(active ? term : ''), placeholderData: keepPreviousData })
  const results = active ? (search.data?.results ?? []) : []
  const top = active ? topResult(results, term) : undefined
  const groups = groupResults(results, top)

  const open = (r: SearchResult | undefined) => {
    if (!r) return
    recentSearches.remember(term)
    if (r.kind === 'person') void navigate({ to: '/person/$id', params: { id: r.id } })
    else void navigate({ to: '/title/$type/$id', params: { type: r.type, id: r.id } })
  }

  // Enter pressed before the debounce ran: the best match opens once that search answers.
  const openWhenReady = useRef<string | null>(null)
  useEffect(() => {
    if (openWhenReady.current === null || openWhenReady.current !== term || !search.data || search.isPlaceholderData) return
    openWhenReady.current = null
    open(top ?? results.find((r) => r.kind === 'media') ?? results[0])
  })

  const links = () => [...(resultsRef.current?.querySelectorAll<HTMLElement>('a[data-result], li > a') ?? [])]

  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Typed faster than the debounce: search for what's there now, then open.
      if (text !== term) {
        openWhenReady.current = text
        setTerm(text)
        void navigate({ search: { q: text.trim() || undefined }, replace: true, resetScroll: false })
      } else open(top ?? results.find((r) => r.kind === 'media') ?? results[0])
    } else if (e.key === 'ArrowDown') {
      const first = links()[0]
      if (first) {
        e.preventDefault()
        first.focus()
      }
    } else if (e.key === 'Escape' && text) {
      e.preventDefault()
      setText('')
    }
  }

  // The arrow keys move to whatever is next in that direction on screen; up from the first row returns to the field.
  const onResultsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = arrows[e.key]
    if (!direction) return
    const all = links()
    const from = all.indexOf(document.activeElement as HTMLElement)
    if (from < 0) return
    const next = neighbour(
      all.map((el) => el.getBoundingClientRect()),
      from,
      direction,
    )
    if (next !== undefined) {
      e.preventDefault()
      all[next]!.focus()
    } else if (direction === 'up') {
      e.preventDefault()
      input.current?.focus()
    }
  }

  return (
    <div className={`page ${s.screen}`}>
      <h1 className="page-title">Search</h1>
      <div className={s.field}>
        <Icon name="search" size={20} strokeWidth={2.2} className={s.fieldIcon} />
        <input
          ref={input}
          type="search"
          className={`field ${s.input}`}
          placeholder="Movies, shows and people"
          aria-label="Search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onFieldKey}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {text ? (
          <button
            type="button"
            className={`btn btn-quiet btn-circle btn-compact ${s.clear}`}
            aria-label="Clear Search"
            onClick={() => {
              setText('')
              input.current?.focus()
            }}
          >
            <Icon name="close" size={14} strokeWidth={2.8} />
          </button>
        ) : (
          <kbd className={s.hint} aria-hidden>
            /
          </kbd>
        )}
      </div>

      <div
        ref={resultsRef}
        className={s.results}
        data-stale={active && search.isPlaceholderData ? '' : undefined}
        onKeyDown={onResultsKey}
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest('a')) recentSearches.remember(term)
        }}
      >
        {!active ? (
          <Idle onPick={(t) => setText(t)} />
        ) : search.isError && !search.data ? (
          <StateView
            icon="info"
            title="Search Failed"
            message={errorMessage(search.error)}
            action={
              <button className="btn btn-secondary" onClick={() => void search.refetch()}>
                Try Again
              </button>
            }
          />
        ) : search.isPending ? (
          <section aria-label="Searching" aria-busy="true">
            <ul className={s.grid}>
              {Array.from({ length: 7 }, (_, i) => (
                <li key={i} className={s.ghost} aria-hidden="true" />
              ))}
            </ul>
          </section>
        ) : results.length === 0 ? (
          <StateView
            title={`No Results for “${term.trim()}”`}
            message="Check the spelling, or try a shorter title, a show’s name or a person’s. You can also browse a genre instead."
            action={
              <Link to="/explore" className="btn btn-secondary">
                Browse Titles
              </Link>
            }
          />
        ) : (
          <>
            {top && <TopResult item={top} />}
            {groups.movies.length > 0 && (
              <Group title="Movies" count={groups.movies.length}>
                {groups.movies.map((m) => (
                  <PosterItem key={m.id} item={m} meta={m.year ? String(m.year) : undefined} sizes={gridSizes} />
                ))}
              </Group>
            )}
            {groups.shows.length > 0 && (
              <Group title="TV Shows" count={groups.shows.length}>
                {groups.shows.map((m) => (
                  <PosterItem key={m.id} item={m} meta={m.year ? String(m.year) : undefined} sizes={gridSizes} />
                ))}
              </Group>
            )}
            {groups.people.length > 0 && (
              <section className={s.group} aria-labelledby="people">
                <header className={s.groupHead}>
                  <h2 id="people" className={s.groupTitle}>
                    People
                  </h2>
                  <span className={`${s.count} num`}>{groups.people.length}</span>
                </header>
                <ul className={s.people}>
                  {groups.people.map((p) => (
                    <PersonRow key={p.id} person={p} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const gridSizes = '(max-width: 720px) 34vw, 180px'

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const id = `group-${title.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <section className={s.group} aria-labelledby={id}>
      <header className={s.groupHead}>
        <h2 id={id} className={s.groupTitle}>
          {title}
        </h2>
        <span className={`${s.count} num`}>{count}</span>
      </header>
      <ul className={s.grid}>{children}</ul>
    </section>
  )
}

/** The best match, given room: its frame with the runtime and rating, the essentials, and a way to play. */
function TopResult({ item }: { item: MediaResult }) {
  const now = useMinuteTick()
  const inWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === mediaKey(item.type, item.id)))
  const detail = useQuery(q.detail(item.type, item.id)).data
  const known = detail && (detail.runtime || detail.seasons.length) ? detail : undefined
  const meta = [item.year, genreNames(item.genres, item.type)[0], item.type === 'movie' ? 'Film' : 'Series'].filter(Boolean)
  const link = { to: '/title/$type/$id', params: { type: item.type, id: item.id } } as const
  return (
    <section className={s.group} aria-labelledby="top-result">
      <h2 id="top-result" className={s.groupTitle}>
        Top Result
      </h2>
      <article className={s.top}>
        <Link {...link} data-result="" className={s.topPlate} onPointerEnter={() => prefetchDetail(item)} onFocus={() => prefetchDetail(item)} onClick={markZoomSource} viewTransition aria-label={`${item.title}, top result`}>
          <Plate shape="poster" artPath={posterOf(item)} sizes="160px" print={pickPrint(item, known, now, { locale: userLocale })} fallback={item.title} hideStrip />
        </Link>
        <div className={s.topText}>
          <Link {...link} className={s.topTitle} onPointerEnter={() => prefetchDetail(item)} tabIndex={-1}>
            {item.title}
          </Link>
          <p className={s.topMeta}>{meta.join(' · ')}</p>
          {item.overview && <p className={s.topOverview}>{item.overview}</p>}
          <div className={s.topActions}>
            <Link {...link} search={{ play: true }} className="btn btn-primary" onPointerEnter={() => prefetchDetail(item)}>
              <Icon name="play" size={16} /> Play
            </Link>
            <button className="btn btn-secondary btn-circle" onClick={() => library.toggleWatchlist(item)} aria-pressed={inWatchlist} aria-label={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}>
              <Icon name={inWatchlist ? 'check' : 'plus'} size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </article>
    </section>
  )
}

/** A person: a portrait at one fixed size, the name, and what they're known for. */
function PersonRow({ person }: { person: PersonResult }) {
  return (
    <li role="listitem">
      <Link to="/person/$id" params={{ id: person.id }} className={s.person} data-result="">
        <Artwork path={person.profile} kind="profile" alt="" sizes="56px" className={s.face} fallback={initials(person.name)} />
        <span className={s.personText}>
          <span className={s.personName}>{person.name}</span>
          <span className={s.personRole}>{person.knownFor[0] ?? person.department ?? ''}</span>
        </span>
      </Link>
    </li>
  )
}

/** Before anything is typed: recent searches, genres to browse, and what's trending. */
function Idle({ onPick }: { onPick: (term: string) => void }) {
  const recents = useRecentSearches()
  const trending = useQuery(q.trending('all'))
  return (
    <div className={s.idle}>
      <p className={s.teach}>
        Search finds films, series and people by name.
        <span className={s.shortcut}>
          {' '}
          Press <kbd className={s.key}>/</kbd> anywhere on this page to jump to the field, and Enter to open the best match.
        </span>
      </p>

      {recents.length > 0 && (
        <section className={s.group} aria-labelledby="recent">
          <header className={s.groupHead}>
            <h2 id="recent" className={s.groupTitle}>
              Recent
            </h2>
            <button className={s.textButton} onClick={() => recentSearches.clear()}>
              Clear
            </button>
          </header>
          <ul className={s.recents}>
            {recents.map((t) => (
              <li key={t} className={s.recent}>
                <button className={s.recentTerm} onClick={() => onPick(t)}>
                  <Icon name="history" size={15} strokeWidth={2.2} /> {t}
                </button>
                <button className={s.recentRemove} onClick={() => recentSearches.forget(t)} aria-label={`Remove “${t}” from Recent`}>
                  <Icon name="close" size={12} strokeWidth={2.6} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={s.group} aria-labelledby="browse">
        <h2 id="browse" className={s.groupTitle}>
          Browse by Genre
        </h2>
        <ul className={s.index}>
          {categories.map((c) => (
            <li key={`${c.type}${c.genre}`}>
              <Link to="/explore" search={{ type: c.type, genre: c.genre }} className={s.indexRow}>
                {c.title}
                <Icon name="chevronRight" size={14} strokeWidth={2.6} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.group} aria-labelledby="trending">
        <h2 id="trending" className={s.groupTitle}>
          Trending
        </h2>
        {trending.isError ? (
          <p className="muted">Couldn’t load what’s trending. Check your connection, then search above.</p>
        ) : (
          <ul className={s.grid} aria-busy={trending.isPending || undefined}>
            {trending.isPending
              ? Array.from({ length: 12 }, (_, i) => <li key={i} className={s.ghost} aria-hidden="true" />)
              : trending.data.results.slice(0, 18).map((m) => <PosterItem key={`${m.type}${m.id}`} item={m} meta={m.year ? String(m.year) : undefined} sizes={gridSizes} />)}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Genres that open Explore, as plain index rows. */
const categories = [
  { title: 'Action', type: 'movie', genre: 28 },
  { title: 'Comedy', type: 'movie', genre: 35 },
  { title: 'Science Fiction', type: 'movie', genre: 878 },
  { title: 'Drama', type: 'movie', genre: 18 },
  { title: 'Horror', type: 'movie', genre: 27 },
  { title: 'Animation', type: 'movie', genre: 16 },
  { title: 'Documentary', type: 'movie', genre: 99 },
  { title: 'Crime Series', type: 'show', genre: 80 },
] as const

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
