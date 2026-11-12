import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { Icon } from '../../components/Icon'
import { AppearanceSection } from './AppearanceSection'
import { CatalogueSection } from './CatalogueSection'
// The router's own history, not its hooks: the hooks split the router out of the first load into chunks of its own.
import { router } from '../../main'
import { buildIndex, search, step, type Entry, type RawRow } from './searchIndex'
import s from './SettingsScreen.module.css'

/** The first two sections are in the page's own code; the rest are chunks fetched one at a time while the
 *  browser is idle, so opening Settings paints the top of the page at once instead of waiting on (and then
 *  rendering) the 140 KB behind every section. A section a link or the contents list jumps to is fetched at once. */
interface Section {
  id: string
  title: string
  /** What the page holds, under its name in the list a phone opens on. */
  note: string
  body?: ComponentType
  load?: () => Promise<ComponentType>
}

const sections: Section[] = [
  { id: 'appearance', title: 'Appearance', note: 'Theme, typefaces and the opening tab', body: AppearanceSection },
  { id: 'catalogue', title: 'Catalogue', note: 'TMDB key, language and region', body: CatalogueSection },
  { id: 'metadata', title: 'Metadata', note: 'TVDB, ratings and posters', load: () => import('./MetadataSection').then((m) => m.MetadataSection) },
  { id: 'shelves', title: 'Shelves', note: 'What Home shows, and in what order', load: () => import('./ShelvesSection').then((m) => m.ShelvesSection) },
  { id: 'addons', title: 'Stream Add-ons', note: 'Stremio-style stream add-ons', load: () => import('./AddonsSection').then((m) => m.AddonsSection) },
  { id: 'servers', title: 'Media Servers', note: 'Jellyfin, Emby, Plex and WebDAV', load: () => import('./ServersSection').then((m) => m.ServersSection) },
  { id: 'requests', title: 'Requests', note: 'Ask Seerr for what you don’t have', load: () => import('./RequestsSection').then((m) => m.RequestsSection) },
  { id: 'sources', title: 'Sources', note: 'How streams are sorted and filtered', load: () => import('./SourcesSection').then((m) => m.SourcesSection) },
  { id: 'livetv', title: 'Live TV', note: 'IPTV providers and the guide', load: () => import('./LiveTVSection').then((m) => m.LiveTVSection) },
  { id: 'playback', title: 'Playback', note: 'Stream proxy, subtitles, skipping and X-Ray', load: () => import('./PlaybackSection').then((m) => m.PlaybackSection) },
  { id: 'account', title: 'Account', note: 'Marquee Account, Trakt and Simkl', load: () => import('./AccountSection').then((m) => m.AccountSection) },
  { id: 'data', title: 'Data', note: 'Backups, setup links and this device', load: () => import('./DataSection').then((m) => m.DataSection) },
  { id: 'about', title: 'About', note: 'Version and licences', load: () => import('./AboutSection').then((m) => m.AboutSection) },
]

// Kept at module level so coming back to Settings shows every section at once.
const loaded = new Map<string, ComponentType>()
const loading = new Map<string, Promise<void>>()
const failed = new Set<string>()

function fetchSection(x: Section): Promise<void> {
  if (!x.load || loaded.has(x.id)) return Promise.resolve()
  let p = loading.get(x.id)
  if (!p) {
    p = x.load().then(
      (body) => void (failed.delete(x.id), loaded.set(x.id, body)),
      () => void failed.add(x.id),
    )
    loading.set(x.id, p)
    // A failed fetch can be tried again the next time Settings opens.
    void p.then(() => failed.has(x.id) && loading.delete(x.id))
  }
  return p
}

const idle = () => new Promise<void>((resolve) => (window.requestIdleCallback ? window.requestIdleCallback(() => resolve(), { timeout: 400 }) : setTimeout(resolve, 60)))

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** Every row on the page, with the group and section it sits in, read off what is drawn: a row is searchable the day
 *  it is added, and what a row says (its count, its state) is what is searched. */
function scanRows(): { rows: RawRow[]; elements: Map<string, HTMLElement> } {
  const rows: RawRow[] = []
  const elements = new Map<string, HTMLElement>()
  for (const x of sections) {
    const root = document.getElementById(x.id)
    root?.querySelectorAll<HTMLElement>('[data-settings-row]').forEach((el, i) => {
      const group = el.closest('[data-settings-group]')
      const key = `${x.id}:${i}`
      elements.set(key, el)
      rows.push({
        key,
        section: x.id,
        sectionTitle: x.title,
        group: text(group?.querySelector('h3')),
        title: text(el.querySelector('[data-row-label]')),
        detail: text(el.querySelector('[data-row-detail]')),
        footer: text(group?.querySelector('[data-settings-footer]')),
      })
    })
  }
  return { rows, elements }
}

/** Wide enough for the list of pages beside the open one; narrower, the list is a page of its own, as on iPhone. */
const wideQuery = '(min-width: 861px)'
const subscribeWide = (cb: () => void) => {
  const m = matchMedia(wideQuery)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const useWide = () => useSyncExternalStore(subscribeWide, () => matchMedia(wideQuery).matches, () => true)

/** Settings works like the apps' settings: a list of pages, one page open at a time, instead of one long scroll. On a
 *  wide screen the list sits beside the open page (the first one opens by default); on a phone the list is the page,
 *  and a page opens over it with a way back. The page is in the address (`/settings#playback`), so links from elsewhere
 *  open it and Back returns to the list. Every page stays drawn, hidden, so search can read every row. */
export function SettingsScreen() {
  const hash = useSyncExternalStore(router.history.subscribe, () => router.history.location.hash.replace(/^#/, ''))
  const navigate: typeof router.navigate = (options) => router.navigate(options)
  const wide = useWide()
  const opened = sections.find((x) => x.id === hash)
  const current = opened ?? (wide ? sections[0] : undefined)
  // A copy, so a section arriving is a state change the compiler's memoising can see (the module's map is mutated in place).
  const [bodies, setBodies] = useState(() => new Map(loaded))
  const refresh = () => setBodies(new Map(loaded))
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [index, setIndex] = useState<Entry[]>([])
  const elements = useRef(new Map<string, HTMLElement>())
  const mark = useRef<{ el: HTMLElement; timer: number } | undefined>(undefined)
  const searching = query.trim() !== ''
  const everyBody = sections.every((x) => x.body || bodies.has(x.id) || failed.has(x.id))

  // The open page first, then the rest in order, one per idle moment, so no single task parses more than one of them.
  useEffect(() => {
    let live = true
    void (async () => {
      if (current) {
        await fetchSection(current)
        if (live) refresh()
      }
      for (const x of sections) {
        if (!live) return
        if (!x.load || loaded.has(x.id)) continue
        await idle()
        await fetchSection(x)
        if (live) refresh()
      }
    })()
    return () => void (live = false)
  }, [])

  // Opening a page fetches it at once, and starts it at its top.
  useEffect(() => {
    if (!current) return
    void fetchSection(current).then(refresh)
  }, [current?.id])

  /** Everything fetched and drawn, so search can read every row. */
  const everything = async () => {
    await Promise.all(sections.map(fetchSection))
    refresh()
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }

  // Searching reads every section, so they all load the moment someone starts to type (or aims at the field).
  useEffect(() => {
    if (searching) void everything()
  }, [searching])
  useEffect(() => {
    if (!searching) return
    const { rows, elements: found } = scanRows()
    elements.current = found
    setIndex(buildIndex(rows))
  }, [searching, bodies])
  useEffect(() => () => window.clearTimeout(mark.current?.timer), [])

  const results = useMemo(
    () =>
      search(
        index,
        query,
        sections.map((x) => x.id),
      ),
    [index, query],
  )
  const flat = results.flatMap((r) => r.hits)
  const at = Math.min(active, flat.length - 1)
  useEffect(() => {
    if (searching && at >= 0) document.getElementById(`settings-hit-${at}`)?.scrollIntoView({ block: 'nearest' })
  }, [at, searching])

  /** Opens the page a row is on, scrolled to the row and quietly outlined for a moment. */
  const choose = async (key: string) => {
    const el = elements.current.get(key)
    const section = key.slice(0, key.indexOf(':'))
    flushSync(() => setQuery(''))
    if (section !== current?.id) await navigate({ to: '/settings', hash: section, hashScrollIntoView: false })
    if (!el) return
    await new Promise((resolve) => requestAnimationFrame(resolve))
    el.scrollIntoView({ block: 'center' })
    window.clearTimeout(mark.current?.timer)
    mark.current?.el.removeAttribute('data-found')
    el.setAttribute('data-found', '')
    mark.current = { el, timer: window.setTimeout(() => el.removeAttribute('data-found'), 2400) }
    el.querySelector<HTMLElement>('button, select, input, a[href]')?.focus({ preventScroll: true })
  }

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault()
      setQuery('')
    } else if (!searching || flat.length === 0) {
      return
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(step(at, e.key === 'ArrowDown' ? 1 : -1, flat.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void choose(flat[Math.max(at, 0)]!.entry.key)
    }
  }

  // On a phone an open page is the whole screen: its name is the title, with the way back above it.
  const phonePage = !wide && opened
  return (
    <div className="page">
      {phonePage ? (
        <>
          <Link to="/settings" className={s.back} activeProps={{}} resetScroll>
            <Icon name="chevronLeft" size={16} strokeWidth={2.4} />
            Settings
          </Link>
          <h1 className="page-title">{opened.title}</h1>
        </>
      ) : (
        <h1 className="page-title">Settings</h1>
      )}
      <div className={s.layout} data-phone-page={phonePage ? '' : undefined}>
        {!phonePage && (
          <div className={s.search}>
            <Icon name="search" size={18} strokeWidth={2.2} className={s.searchIcon} />
            <input
              type="search"
              role="combobox"
              aria-expanded={searching}
              aria-controls="settings-results"
              aria-activedescendant={searching && at >= 0 ? `settings-hit-${at}` : undefined}
              aria-autocomplete="list"
              className={`field ${s.searchInput}`}
              placeholder="Search Settings"
              aria-label="Search Settings"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onFocus={() => void everything()}
              onKeyDown={onSearchKey}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
            />
            {query && (
              <button type="button" className={`btn btn-quiet btn-circle btn-compact ${s.searchClear}`} aria-label="Clear Search" onClick={() => setQuery('')}>
                <Icon name="close" size={14} strokeWidth={2.8} />
              </button>
            )}
          </div>
        )}
        {!phonePage && !(searching && !wide) && (
          <nav className={s.toc} aria-label="Settings pages">
            {sections.map((x) => (
              // Plain links: the router's Link calls every one of these current, since they share a path.
              <a
                key={x.id}
                href={`${import.meta.env.BASE_URL}settings#${x.id}`}
                aria-current={current?.id === x.id ? 'page' : undefined}
                onPointerEnter={() => void fetchSection(x)}
                onFocus={() => void fetchSection(x)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  setQuery('')
                  void navigate({ to: '/settings', hash: x.id, hashScrollIntoView: false, resetScroll: true })
                }}
              >
                <span className={s.tocText}>
                  <span className={s.tocTitle}>{x.title}</span>
                  <span className={s.tocNote}>{x.note}</span>
                </span>
                <Icon name="chevronRight" size={16} strokeWidth={2.4} className={s.tocChevron} />
              </a>
            ))}
          </nav>
        )}
        {searching && (
          <div className={s.results} id="settings-results" role="listbox" aria-label="Matching settings">
            {results.map((r) => {
              const first = flat.findIndex((h) => h.entry.section === r.section)
              return (
                <div key={r.section} className={s.groupWrap} role="group" aria-label={r.sectionTitle}>
                  <h3 className={s.groupTitle} aria-hidden>
                    {r.sectionTitle}
                  </h3>
                  <div className={s.group}>
                    {r.hits.map((hit, i) => {
                      const n = first + i
                      const more = [hit.entry.group, hit.entry.detail].filter(Boolean).join(' · ')
                      return (
                        <button
                          key={hit.entry.key}
                          type="button"
                          role="option"
                          id={`settings-hit-${n}`}
                          aria-selected={n === at}
                          tabIndex={-1}
                          className={s.hit}
                          onMouseMove={() => n !== at && setActive(n)}
                          onClick={() => void choose(hit.entry.key)}
                        >
                          <span className={s.rowLabel}>{hit.entry.title}</span>
                          {more && <span className={s.rowDetail}>{more}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {results.length === 0 && (
              <p className={s.hint}>
                {everyBody ? `Nothing in Settings matches “${query.trim()}”. Try a shorter word, or something like “subtitles”, “server”, “skip” or “quality”.` : 'Looking through every section…'}
              </p>
            )}
            <p className="sr-only" role="status">
              {everyBody || results.length > 0 ? `${flat.length} ${flat.length === 1 ? 'setting' : 'settings'} found` : ''}
            </p>
          </div>
        )}
        <div className={s.content} hidden={searching || !current}>
          {sections.map((x) => {
            const Body = x.body ?? bodies.get(x.id)
            const shown = x.id === current?.id
            return (
              <section
                key={x.id}
                id={x.id}
                className={s.section}
                hidden={!shown}
                aria-labelledby={`${x.id}-title`}
                aria-busy={Body ? undefined : !failed.has(x.id)}
              >
                <h2 id={`${x.id}-title`} className={phonePage ? 'sr-only' : s.sectionTitle}>
                  {x.title}
                </h2>
                {Body ? <Body /> : failed.has(x.id) ? <p className={s.hint}>This page didn’t load. Reload to try again.</p> : <div className={s.pending} />}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
