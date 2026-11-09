import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { Icon } from '../../components/Icon'
import { AppearanceSection } from './AppearanceSection'
import { CatalogueSection } from './CatalogueSection'
import { buildIndex, search, step, type Entry, type RawRow } from './searchIndex'
import s from './SettingsScreen.module.css'

/** The first two sections are in the page's own code; the rest are chunks fetched one at a time while the
 *  browser is idle, so opening Settings paints the top of the page at once instead of waiting on (and then
 *  rendering) the 140 KB behind every section. A section a link or the contents list jumps to is fetched at once. */
interface Section {
  id: string
  title: string
  body?: ComponentType
  load?: () => Promise<ComponentType>
}

const sections: Section[] = [
  { id: 'appearance', title: 'Appearance', body: AppearanceSection },
  { id: 'catalogue', title: 'Catalogue', body: CatalogueSection },
  { id: 'metadata', title: 'Metadata', load: () => import('./MetadataSection').then((m) => m.MetadataSection) },
  { id: 'shelves', title: 'Shelves', load: () => import('./ShelvesSection').then((m) => m.ShelvesSection) },
  { id: 'addons', title: 'Stream Add-ons', load: () => import('./AddonsSection').then((m) => m.AddonsSection) },
  { id: 'servers', title: 'Media Servers', load: () => import('./ServersSection').then((m) => m.ServersSection) },
  { id: 'requests', title: 'Requests', load: () => import('./RequestsSection').then((m) => m.RequestsSection) },
  { id: 'sources', title: 'Sources', load: () => import('./SourcesSection').then((m) => m.SourcesSection) },
  { id: 'livetv', title: 'Live TV', load: () => import('./LiveTVSection').then((m) => m.LiveTVSection) },
  { id: 'playback', title: 'Playback', load: () => import('./PlaybackSection').then((m) => m.PlaybackSection) },
  { id: 'account', title: 'Account', load: () => import('./AccountSection').then((m) => m.AccountSection) },
  { id: 'data', title: 'Data', load: () => import('./DataSection').then((m) => m.DataSection) },
  { id: 'about', title: 'About', load: () => import('./AboutSection').then((m) => m.AboutSection) },
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

/** Settings, sectioned like the native screen: a list of anchors beside the sections on wide
 *  screens, and the sections one after another on a phone. */
export function SettingsScreen() {
  const [current, setCurrent] = useState(sections[0]!.id)
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

  // Fetch the sections in order, one per idle moment, so no single task parses more than one of them.
  useEffect(() => {
    let live = true
    void (async () => {
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

  /** Everything fetched and drawn: the sections above a target have their real height, so it can be scrolled to. */
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

  /** Back to the sections, scrolled to the row and quietly outlined for a moment. */
  const choose = (key: string) => {
    const el = elements.current.get(key)
    flushSync(() => setQuery(''))
    if (!el) return
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
      choose(flat[Math.max(at, 0)]!.entry.key)
    }
  }

  // A link from elsewhere (the player's no-sound notice) names a section in the address.
  useEffect(() => {
    const id = location.hash.slice(1)
    if (!sections.some((x) => x.id === id)) return
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
    setCurrent(id)
    // The sections above it fill in after this and push it down: scroll once more when they have, unless the reader has moved.
    let moved = false
    const stop = () => void (moved = true)
    window.addEventListener('wheel', stop, { once: true, passive: true })
    window.addEventListener('touchstart', stop, { once: true, passive: true })
    window.addEventListener('keydown', stop, { once: true })
    void everything().then(() => !moved && document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    return () => {
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [])

  // The anchor for the section in view follows the scroll; observers don't run per frame. A page that has run out of
  // scroll names its last section, since the short ones at the end can never reach the line the others are read at.
  useEffect(() => {
    const visible = new Set<string>()
    const last = sections[sections.length - 1]!.id
    const atEnd = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
    const settle = () => {
      const first = atEnd() ? sections.find((x) => x.id === last) : sections.find((x) => visible.has(x.id))
      if (first) setCurrent(first.id)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)
        settle()
      },
      { rootMargin: '-20% 0px -65% 0px' },
    )
    sections.forEach((x) => {
      const el = document.getElementById(x.id)
      if (el) observer.observe(el)
    })
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(settle)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <div className={s.layout}>
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
        <nav className={s.toc} aria-label="Settings sections">
          {sections.map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              aria-current={current === x.id ? 'true' : undefined}
              onPointerEnter={() => void fetchSection(x)}
              onFocus={() => void fetchSection(x)}
              onClick={(e) => {
                e.preventDefault()
                setQuery('')
                setCurrent(x.id)
                void everything().then(() => document.getElementById(x.id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
              }}
            >
              {x.title}
            </a>
          ))}
        </nav>
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
                          onClick={() => choose(hit.entry.key)}
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
        <div className={s.content} hidden={searching}>
          {sections.map((x) => {
            const Body = x.body ?? bodies.get(x.id)
            return (
              <section key={x.id} id={x.id} className={s.section} aria-labelledby={`${x.id}-title`} aria-busy={Body ? undefined : !failed.has(x.id)}>
                <h2 id={`${x.id}-title`} className={s.sectionTitle}>
                  {x.title}
                </h2>
                {Body ? <Body /> : failed.has(x.id) ? <p className={s.hint}>This section didn’t load. Reload the page to try again.</p> : <div className={s.pending} />}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
