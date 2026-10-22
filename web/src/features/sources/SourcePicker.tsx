import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Artwork } from '../../components/Artwork'
import { Icon } from '../../components/Icon'
import type { PlaybackRequest, Source } from '../../lib/sources'
import { searchSources, type SearchUpdate } from '../../lib/sources/index'
import { lastSourceFor, rememberSource } from '../../lib/sources/lastSource'
import { useSettings } from '../../lib/store/settings'
import { playFacts } from '../detail/logic'
import { detailLine, formatLine, resolutionText, spokenLabel } from './labels'
import s from './SourcePicker.module.css'

type Filter = { kind: 'all' } | { kind: 'resolution'; value: NonNullable<Source['resolution']> } | { kind: 'provider'; value: string }

const resolutionChips: { value: NonNullable<Source['resolution']>; label: string }[] = [
  { value: '2160p', label: '2160p' },
  { value: '1440p', label: '1440p' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'SD', label: 'SD' },
]

const empty: SearchUpdate = { sources: [], providers: [], torrents: 0, finished: false }

/** Lists what every add-on and server offers for the request, best first, and calls `onPick`.
 *  A flat base-2 sheet, as the native source picker: each source is a film-can label row, the best
 *  match carries the yellow Play and is one tap (or Enter) away, arrows move through the rest, Esc
 *  closes. `seed` is a finished search the title page already ran, so opening doesn't ask every
 *  add-on again. */
export function SourcePicker({ request, seed, onPick, onClose }: { request: PlaybackRequest; seed?: SearchUpdate; onPick: (source: Source) => void; onClose: () => void }) {
  const [search, setSearch] = useState<SearchUpdate>(seed?.finished ? seed : empty)
  const [reload, setReload] = useState(0)
  // The virtualised rows need the scroller to exist when they first render.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [activeId, setActiveId] = useState<string>()
  const remember = useSettings((x) => x.rememberLastSource)
  const listRef = useRef<HTMLDivElement>(null)
  // A parent may build the request afresh on every render; only a different title searches again.
  const requestRef = useRef(request)
  requestRef.current = request
  const seedRef = useRef(seed)
  const requestKey = `${request.type}:${request.tmdbId}:${request.season ?? ''}:${request.episode ?? ''}`

  useEffect(() => {
    // The title page's answer stands until the viewer searches again.
    if (reload === 0 && seedRef.current?.finished) return
    const controller = new AbortController()
    setSearch(empty)
    searchSources(requestRef.current, { signal: controller.signal, onUpdate: setSearch }).catch(() => {
      // Closed or searched again: the newer search reports instead.
    })
    return () => controller.abort()
  }, [requestKey, reload])

  // The sheet owns the keyboard and the page behind it stays put; focus goes back where it was.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // With a keyboard and mouse the list takes focus, so arrows and Enter work at once; on touch
    // screens that would only draw a focus ring nobody asked for.
    if (matchMedia('(pointer: fine)').matches) listRef.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.({ preventScroll: true })
    }
  }, [])

  const all = search.sources
  const lastPlayed = remember ? lastSourceFor(request, all) : undefined
  const best = lastPlayed ?? all.find((x) => !x.unsupported)
  const providerNames = useMemo(() => [...new Set(all.map((x) => x.provider))], [all])
  const resolutions = resolutionChips.filter((r) => all.some((x) => (x.resolution === '480p' ? 'SD' : x.resolution) === r.value))
  const list = all.filter((x) =>
    filter.kind === 'all' ? true : filter.kind === 'provider' ? x.provider === filter.value : (x.resolution === '480p' ? 'SD' : x.resolution) === filter.value,
  )
  const active = list.find((x) => x.id === activeId) ?? (best && list.includes(best) ? best : list.find((x) => !x.unsupported))
  const loading = search.providers.filter((p) => p.state === 'loading')
  const failures = search.providers.filter((p) => p.state === 'failed')
  const noProviders = search.finished && search.providers.length === 0
  const entries = useMemo(() => grouped(list, best, lastPlayed?.id), [list, best, lastPlayed?.id])

  function pick(source: Source | undefined) {
    if (!source || source.unsupported) return
    rememberSource(request, source)
    onPick(source)
  }

  function move(delta: number) {
    const playable = list.filter((x) => !x.unsupported)
    if (playable.length === 0) return
    const index = active ? playable.indexOf(active) : -1
    const next = playable[Math.max(0, Math.min(playable.length - 1, index < 0 ? 0 : index + delta))]!
    setActiveId(next.id)
    listRef.current?.dispatchEvent(new CustomEvent('flow:reveal', { detail: entries.findIndex((e) => e.kind === 'row' && e.source.id === next.id) }))
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    const inControl = target !== listRef.current && target.closest('button, a, input, select')
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        if (target !== listRef.current) listRef.current?.focus({ preventScroll: true })
        move(event.key === 'ArrowDown' ? 1 : -1)
        break
      case 'Home':
      case 'End':
        if (inControl) break
        event.preventDefault()
        move(event.key === 'Home' ? -Infinity : Infinity)
        break
      case 'Enter':
        if (inControl) break
        event.preventDefault()
        pick(active)
        break
    }
  }

  const status =
    loading.length > 0 ? (
      <span className={s.searching}>
        <span className={s.spinner} aria-hidden /> Searching {listFormat(loading.map((p) => p.name))}…
      </span>
    ) : noProviders ? null : search.finished ? (
      `${all.length} source${all.length === 1 ? '' : 's'}`
    ) : (
      'Finding sources…'
    )

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={`Sources for ${request.item.title}`} onKeyDown={onKeyDown}>
      <div className={s.scrim} onClick={onClose} aria-hidden />
      <div className={s.sheet}>
        <div className={s.controls}>
          <button className="btn btn-secondary btn-circle btn-compact" onClick={() => setReload((n) => n + 1)} disabled={!search.finished} aria-label="Search Again">
            <Icon name="refresh" size={18} strokeWidth={2.2} />
          </button>
          <button className="btn btn-secondary btn-circle btn-compact" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} strokeWidth={2.4} />
          </button>
        </div>

        <header className={s.header}>
          <Artwork path={request.item.poster} kind="poster" alt="" sizes="48px" className={s.poster} fallback={request.item.title.slice(0, 1)} />
          <div className={s.heading}>
            <h2 className={s.title}>{request.item.title}</h2>
            {request.type === 'show' && request.season !== undefined && (
              <p className={s.episode}>
                Season {request.season}, Episode {request.episode ?? 1}
              </p>
            )}
            <p className={s.status} aria-live="polite">
              {status}
            </p>
          </div>
        </header>

        {all.length > 0 && (resolutions.length > 1 || providerNames.length > 1) && (
          <div className={s.chips} role="toolbar" aria-label="Filter sources">
            <button className="chip" aria-pressed={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
              All
            </button>
            {resolutions.length > 1 &&
              resolutions.map((r) => (
                <button key={r.value} className="chip" aria-pressed={filter.kind === 'resolution' && filter.value === r.value} onClick={() => setFilter({ kind: 'resolution', value: r.value })}>
                  {r.label}
                </button>
              ))}
            {providerNames.length > 1 &&
              providerNames.map((name) => (
                <button key={name} className="chip" aria-pressed={filter.kind === 'provider' && filter.value === name} onClick={() => setFilter({ kind: 'provider', value: name })}>
                  {name}
                </button>
              ))}
          </div>
        )}

        <div className={s.scroller} ref={listRef} tabIndex={0} role="listbox" aria-label="Sources" aria-activedescendant={active ? optionId(active) : undefined}>
          {all.length === 0 && !search.finished && <Placeholder />}
          {noProviders && (
            <Empty title="No Sources Yet" text="Add a stream add-on or media server in Settings.">
              <Link to="/settings" className="btn btn-secondary btn-compact">
                Open Settings
              </Link>
            </Empty>
          )}
          {search.finished && !noProviders && all.length === 0 && <Empty title="No Sources" text="None of your sources have this title yet." />}
          {mounted && list.length > 0 && <Rows entries={entries} best={best} active={active} lastPlayedId={lastPlayed?.id} onPick={pick} onHover={setActiveId} scroller={listRef} />}
          {(search.torrents > 0 || failures.length > 0) && (
            <div className={s.notes}>
              {search.torrents > 0 && (
                <p>
                  <Icon name="info" size={14} strokeWidth={2} /> {search.torrents} torrent result{search.torrents === 1 ? '' : 's'} need a debrid service. Add one in your add-on’s configure page to play them here.
                </p>
              )}
              {failures.map((f) => (
                <p key={f.id}>
                  <Icon name="warning" size={14} strokeWidth={2} className={s.warn} /> {f.name}: {f.state === 'failed' ? f.error : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const optionId = (source: Source) => `source-${source.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`

function listFormat(names: string[]): string {
  try {
    return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names)
  } catch {
    return names.join(', ')
  }
}

type Entry = { kind: 'heading'; id: string; text: string } | { kind: 'row'; source: Source }

/** The list in plain groups: the match Play would start, the other sources that play, then those that
 *  can't play in this browser. A group with nothing in it has no heading. */
function grouped(list: Source[], best: Source | undefined, lastPlayedId: string | undefined): Entry[] {
  const top = best && list.includes(best) ? best : undefined
  const rest = list.filter((x) => x !== top && !x.unsupported)
  const blocked = list.filter((x) => x.unsupported)
  const rows = (sources: Source[]): Entry[] => sources.map((source) => ({ kind: 'row', source }))
  const out: Entry[] = []
  if (top) out.push({ kind: 'heading', id: 'best', text: top.id === lastPlayedId ? 'Last Played' : 'Best Match' }, ...rows([top]))
  if (rest.length) out.push({ kind: 'heading', id: 'rest', text: top ? 'Other Sources' : 'Sources' }, ...rows(rest))
  if (blocked.length) out.push({ kind: 'heading', id: 'blocked', text: 'Can’t Play in This Browser' }, ...rows(blocked))
  return out
}

/** The rows, virtualised: add-ons often answer with a hundred or more. */
function Rows({ entries, best, active, lastPlayedId, onPick, onHover, scroller }: { entries: Entry[]; best?: Source; active?: Source; lastPlayedId?: string; onPick: (s: Source) => void; onHover: (id: string) => void; scroller: RefObject<HTMLDivElement | null> }) {
  'use no memo'
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (entries[i]!.kind === 'heading' ? 44 : 92),
    overscan: 8,
    getItemKey: (i) => {
      const e = entries[i]!
      return e.kind === 'heading' ? `heading-${e.id}` : e.source.id
    },
    // The table sits this far into the scroller, below its top padding.
    scrollMargin: 4,
  })

  // Keyboard moves bring the active row into view.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const reveal = (e: Event) => virtualizer.scrollToIndex((e as CustomEvent<number>).detail, { align: 'auto' })
    el.addEventListener('flow:reveal', reveal)
    return () => el.removeEventListener('flow:reveal', reveal)
  }, [scroller, virtualizer])

  const items = virtualizer.getVirtualItems()
  const margin = virtualizer.options.scrollMargin
  return (
    <div className={s.table} style={{ height: virtualizer.getTotalSize() }}>
      {items.map((v) => {
        const entry = entries[v.index]!
        return (
          <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className={s.slot} style={{ transform: `translateY(${v.start - margin}px)` }}>
            {entry.kind === 'heading' ? (
              <h3 className={s.group} role="presentation">{entry.text}</h3>
            ) : (
              <SourceRow
                source={entry.source}
                active={entry.source.id === active?.id}
                best={entry.source === best}
                lastPlayed={entry.source.id === lastPlayedId}
                divider={entries[v.index - 1]?.kind === 'row'}
                onPick={onPick}
                onHover={onHover}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** One source as a film-can label row: the resolution large on the left; then the format line in edge
 *  print, the release's name, and size, provider and languages in ink-3. The best match has the yellow
 *  Play (a cue: the whole row plays); one that can't play is dimmed and says why in words. */
function SourceRow({ source, active, best, lastPlayed, divider, onPick, onHover }: { source: Source; active: boolean; best: boolean; lastPlayed: boolean; divider: boolean; onPick: (s: Source) => void; onHover: (id: string) => void }) {
  const formats = formatLine(source)
  const facts = source.unsupported ? undefined : playFacts(source)
  return (
    <div
      id={optionId(source)}
      role="option"
      aria-selected={active}
      aria-disabled={source.unsupported ? true : undefined}
      aria-label={spokenLabel(source, lastPlayed)}
      className={s.row}
      data-active={active ? '' : undefined}
      data-divider={divider ? '' : undefined}
      onClick={() => onPick(source)}
      onPointerEnter={() => !source.unsupported && onHover(source.id)}
    >
      <span className={s.resolution}>{resolutionText(source) ?? '–'}</span>
      <span className={s.body}>
        <span className={s.content}>
          {formats && <span className={s.formats}>{formats}</span>}
          <span className={s.release}>{source.title || source.quality || 'Stream'}</span>
          <span className={s.meta}>
            {detailLine(source)}
            {source.cached === false && ' · Not cached'}
          </span>
          {facts && facts.notes.length > 0 && (
            <span className={s.notesLine}>
              {facts.notes.map((n, i) => (
                <span key={n.text} className={n.tone === 'warn' ? s.warn : undefined}>
                  {i > 0 && ' · '}
                  {n.text}
                </span>
              ))}
            </span>
          )}
        </span>
        {source.unsupported && <span className={s.unsupported}>{source.unsupported}</span>}
      </span>
      {best && (
        <span className={`btn btn-primary btn-compact ${s.play}`} aria-hidden>
          <Icon name="play" size={14} /> Play
        </span>
      )}
    </div>
  )
}

function Placeholder() {
  return (
    <div className={`${s.table} ${s.placeholder}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={s.row} data-divider={i > 0 ? '' : undefined}>
          <span className={s.bar} style={{ width: 48, height: 18 }} />
          <span className={s.body}>
            <span className={s.content}>
              <span className={s.bar} style={{ width: '46%', height: 12 }} />
              <span className={s.bar} style={{ width: '70%', height: 14 }} />
              <span className={s.bar} style={{ width: '34%', height: 12 }} />
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  )
}
