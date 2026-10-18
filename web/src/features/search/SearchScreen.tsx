import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Artwork } from '../../components/Artwork'
import { markZoomSource, PosterCard, posterSizes } from '../../components/Cards'
import { Icon } from '../../components/Icon'
import { Shelf } from '../../components/Shelf'
import { genreNames } from '../../lib/genres'
import { prefetchDetail, q } from '../../lib/queries'
import { library, mediaKey, useLibrary } from '../../lib/store/library'
import type { SearchResult } from '../../lib/tmdb/types'
import { StateView, errorMessage } from '../explore/Controls'
import { groupResults, minimumQuery, topResult, type MediaResult, type PersonResult } from './logic'
import { recentSearches, useRecentSearches } from './recent'
import s from './SearchScreen.module.css'

/** How long typing has to pause before a search goes out. */
const debounce = 200

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
      const first = resultsRef.current?.querySelector<HTMLElement>('[data-nav-row] a')
      if (first) {
        e.preventDefault()
        first.focus()
      }
    } else if (e.key === 'Escape' && text) {
      e.preventDefault()
      setText('')
    }
  }

  // Left and right move along a row; up and down jump between rows, keeping the position.
  const onResultsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    const rows = [...(resultsRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]') ?? [])].map((row) => [...row.querySelectorAll<HTMLElement>('a')])
    const r = rows.findIndex((row) => row.includes(document.activeElement as HTMLElement))
    if (r < 0) return
    const c = rows[r]!.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (e.key === 'ArrowLeft') next = rows[r]![c - 1]
    else if (e.key === 'ArrowRight') next = rows[r]![c + 1]
    else {
      const row = rows[r + (e.key === 'ArrowDown' ? 1 : -1)]
      if (!row && e.key === 'ArrowUp') {
        e.preventDefault()
        input.current?.focus()
        return
      }
      next = row?.[Math.min(c, row.length - 1)]
    }
    if (next) {
      e.preventDefault()
      next.focus()
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
            className={s.clear}
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
              <button className="btn btn-glass" onClick={() => void search.refetch()}>
                Try Again
              </button>
            }
          />
        ) : search.isPending ? (
          <div className={s.bleed}>
            <Shelf title="Movies" loading />
          </div>
        ) : results.length === 0 ? (
          <StateView icon="search" title={`No Results for “${term.trim()}”`} message="Check the spelling, or try a title, a show or a person’s name." />
        ) : (
          <>
            {top && <TopResult item={top} />}
            <div className={s.bleed}>
              {groups.movies.length > 0 && (
                <div data-nav-row="">
                  <Shelf title="Movies">
                    {groups.movies.map((m) => (
                      <PosterCard key={m.id} item={m} />
                    ))}
                  </Shelf>
                </div>
              )}
              {groups.shows.length > 0 && (
                <div data-nav-row="">
                  <Shelf title="TV Shows">
                    {groups.shows.map((m) => (
                      <PosterCard key={m.id} item={m} />
                    ))}
                  </Shelf>
                </div>
              )}
              {groups.people.length > 0 && (
                <div data-nav-row="">
                  <Shelf title="People">
                    {groups.people.map((p) => (
                      <PersonCard key={p.id} person={p} />
                    ))}
                  </Shelf>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The best match, given room: poster beside the essentials and a way to play, like the TV app's top hit. */
function TopResult({ item }: { item: MediaResult }) {
  const inWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === mediaKey(item.type, item.id)))
  const meta = [item.year, genreNames(item.genres, item.type)[0], item.type === 'movie' ? 'Movie' : 'Series'].filter(Boolean)
  const link = { to: '/title/$type/$id', params: { type: item.type, id: item.id } } as const
  return (
    <article className={s.top} data-nav-row="">
      <Link {...link} className={s.topPoster} onPointerEnter={() => prefetchDetail(item)} onFocus={() => prefetchDetail(item)} onClick={markZoomSource} viewTransition aria-label={item.title}>
        <Artwork zoom path={item.poster} kind="poster" alt="" sizes={posterSizes} className={s.topArt} fallback={item.title} />
      </Link>
      <div className={s.topText}>
        <span className={s.eyebrow}>Top Result</span>
        <Link {...link} className={s.topTitle} onPointerEnter={() => prefetchDetail(item)} tabIndex={-1}>
          {item.title}
        </Link>
        <p className={s.topMeta}>
          {item.rating ? (
            <span className={s.rating}>
              <Icon name="star" size={12} /> {item.rating.toFixed(1)}
            </span>
          ) : null}
          {meta.join(' · ')}
        </p>
        {item.overview && <p className={s.topOverview}>{item.overview}</p>}
        <div className={s.topActions}>
          <Link {...link} search={{ play: true }} className="btn btn-primary btn-compact" onPointerEnter={() => prefetchDetail(item)}>
            <Icon name="play" size={16} /> Play
          </Link>
          <button className="btn btn-glass btn-circle btn-compact" onClick={() => library.toggleWatchlist(item)} aria-pressed={inWatchlist} aria-label={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}>
            <Icon name={inWatchlist ? 'check' : 'plus'} size={18} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </article>
  )
}

function PersonCard({ person }: { person: PersonResult }) {
  return (
    <Link to="/person/$id" params={{ id: person.id }} className={s.person}>
      <Artwork path={person.profile} kind="profile" alt="" sizes="128px" className={s.face} fallback={initials(person.name)} />
      <span className={s.personName}>{person.name}</span>
      <span className={s.personRole}>{person.knownFor[0] ?? person.department ?? ''}</span>
    </Link>
  )
}

/** Before anything is typed: recent searches, genres to browse, and what's trending. */
function Idle({ onPick }: { onPick: (term: string) => void }) {
  const recents = useRecentSearches()
  const trending = useQuery(q.trending('all'))
  return (
    <div className={s.idle}>
      {recents.length > 0 && (
        <section className={s.section}>
          <header className={s.sectionHeader}>
            <h2 className={s.sectionTitle}>Recent</h2>
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
                  <Icon name="close" size={11} strokeWidth={3} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Browse</h2>
        <div className={s.browse}>
          {categories.map((c) => (
            <Link key={`${c.type}${c.genre}`} to="/explore" search={{ type: c.type, genre: c.genre }} className={s.tile} style={{ ['--hue' as string]: c.hue }}>
              {c.title}
            </Link>
          ))}
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Trending</h2>
        {trending.isError ? (
          <p className="muted">Couldn’t load what’s trending. Check your connection, then search above.</p>
        ) : (
          <div className={s.grid}>
            {trending.isPending
              ? Array.from({ length: 12 }, (_, i) => <div key={i} className={s.ghost} />)
              : trending.data.results.slice(0, 18).map((m) => <PosterCard key={`${m.type}${m.id}`} item={m} />)}
          </div>
        )}
      </section>
    </div>
  )
}

/** Genre tiles that open Explore, as BrowseGrid on the other platforms. Hues are degrees on the colour wheel. */
const categories = [
  { title: 'Action', type: 'movie', genre: 28, hue: 7 },
  { title: 'Comedy', type: 'movie', genre: 35, hue: 47 },
  { title: 'Science Fiction', type: 'movie', genre: 878, hue: 209 },
  { title: 'Drama', type: 'movie', genre: 18, hue: 270 },
  { title: 'Horror', type: 'movie', genre: 27, hue: 353 },
  { title: 'Animation', type: 'movie', genre: 16, hue: 119 },
  { title: 'Documentary', type: 'movie', genre: 99, hue: 162 },
  { title: 'Crime Series', type: 'show', genre: 80, hue: 238 },
] as const

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
