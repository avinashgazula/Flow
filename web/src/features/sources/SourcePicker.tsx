import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Artwork } from '../../components/Artwork'
import { Icon } from '../../components/Icon'
import type { PlaybackRequest, Source } from '../../lib/sources'
import { searchSources, type SearchUpdate } from '../../lib/sources/index'
import { lastSourceFor, rememberSource } from '../../lib/sources/lastSource'
import { useSettings } from '../../lib/store/settings'
import { imageURL } from '../../lib/tmdb/images'
import { metaLine, plainFormats, playDescription, premiumBadges, resolutionLabel, sizeLabel, spokenLabel } from './labels'
import s from './SourcePicker.module.css'

type Filter = { kind: 'all' } | { kind: 'resolution'; value: NonNullable<Source['resolution']> } | { kind: 'provider'; value: string }

const resolutionChips: { value: NonNullable<Source['resolution']>; label: string }[] = [
  { value: '2160p', label: '4K' },
  { value: '1440p', label: '1440p' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'SD', label: 'SD' },
]

const empty: SearchUpdate = { sources: [], providers: [], torrents: 0, finished: false }

/** Lists what every add-on and server offers for the request, best first, and calls `onPick`.
 *  A sheet over the title's artwork, as the native source picker: the best match is one tap (or
 *  Enter) away, arrows move through the rest, Esc closes. */
export function SourcePicker({ request, onPick, onClose }: { request: PlaybackRequest; onPick: (source: Source) => void; onClose: () => void }) {
  const [search, setSearch] = useState<SearchUpdate>(empty)
  const [reload, setReload] = useState(0)
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [activeId, setActiveId] = useState<string>()
  const remember = useSettings((x) => x.rememberLastSource)
  const listRef = useRef<HTMLDivElement>(null)
  // A parent may build the request afresh on every render; only a different title searches again.
  const requestRef = useRef(request)
  requestRef.current = request
  const requestKey = `${request.type}:${request.tmdbId}:${request.season ?? ''}:${request.episode ?? ''}`

  useEffect(() => {
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
    listRef.current?.dispatchEvent(new CustomEvent('flow:reveal', { detail: list.indexOf(next) }))
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
      <div className={s.ambient} aria-hidden>
        {request.item.backdrop && <img src={imageURL(request.item.backdrop, 300)} alt="" decoding="async" />}
      </div>
      <div className={s.scrim} onClick={onClose} aria-hidden />
      <div className={s.sheet}>
        <div className={s.controls}>
          <button className="btn btn-glass btn-circle btn-compact" onClick={() => setReload((n) => n + 1)} disabled={!search.finished} aria-label="Search Again">
            <Icon name="refresh" size={18} strokeWidth={2.2} />
          </button>
          <button className="btn btn-glass btn-circle btn-compact" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} strokeWidth={2.4} />
          </button>
        </div>

        <header className={s.header}>
          <Artwork path={request.item.poster} kind="poster" alt="" sizes="64px" className={s.poster} fallback={request.item.title.slice(0, 1)} />
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

        {best && all.length > 1 && (
          <div className={s.best}>
            <button className={`btn btn-primary ${s.play}`} onClick={() => pick(best)} aria-label={`Play, ${lastPlayed ? 'last played, ' : ''}${playDescription(best)}`}>
              <Icon name="play" size={18} /> Play
            </button>
            <p className={s.bestCaption} aria-hidden>
              {lastPlayed && (
                <>
                  <Icon name="history" size={13} strokeWidth={2.2} /> Last played ·{' '}
                </>
              )}
              {playDescription(best)}
            </p>
          </div>
        )}

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
              <Link to="/settings" className="btn btn-glass btn-compact">
                Open Settings
              </Link>
            </Empty>
          )}
          {search.finished && !noProviders && all.length === 0 && <Empty title="No Sources" text="None of your sources have this title yet." />}
          {list.length > 0 && <Rows list={list} active={active} lastPlayedId={lastPlayed?.id} onPick={pick} onHover={setActiveId} scroller={listRef} />}
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

/** The rows, virtualised: add-ons often answer with a hundred or more. */
function Rows({ list, active, lastPlayedId, onPick, onHover, scroller }: { list: Source[]; active?: Source; lastPlayedId?: string; onPick: (s: Source) => void; onHover: (id: string) => void; scroller: RefObject<HTMLDivElement | null> }) {
  'use no memo'
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 92,
    overscan: 8,
    getItemKey: (i) => list[i]!.id,
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
        const source = list[v.index]!
        return (
          <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className={s.slot} style={{ transform: `translateY(${v.start - margin}px)` }}>
            <SourceRow source={source} active={source.id === active?.id} lastPlayed={source.id === lastPlayedId} divider={v.index > 0} onPick={onPick} onHover={onHover} />
          </div>
        )
      })}
    </div>
  )
}

/** One source as a line of a table: the resolution in its own column, the size right-aligned in
 *  tabular digits, then formats, provider and languages, and the release's name. */
function SourceRow({ source, active, lastPlayed, divider, onPick, onHover }: { source: Source; active: boolean; lastPlayed: boolean; divider: boolean; onPick: (s: Source) => void; onHover: (id: string) => void }) {
  const badges = premiumBadges(source)
  const plain = plainFormats(source)
  const size = sizeLabel(source)
  const heading = source.quality ?? (size ? undefined : source.title)
  const showRelease = source.title && source.title !== heading
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
      <span className={s.resolution} data-tone={source.resolution === '2160p' || source.resolution === '1440p' || source.resolution === '1080p' ? 'high' : source.resolution ? 'low' : 'none'}>
        {resolutionLabel(source) ?? '–'}
      </span>
      <span className={s.body}>
        <span className={s.titleLine}>
          <span className={s.rowTitle}>{heading ?? 'Stream'}</span>
          {size && <span className={s.size}>{size}</span>}
        </span>
        {(badges.length > 0 || plain) && (
          <span className={s.formats}>
            {badges.map((b) => (
              <span key={b.text} className={s.badge} data-kind={b.kind}>
                {b.text}
              </span>
            ))}
            {plain && <span className={s.plain}>{plain}</span>}
          </span>
        )}
        <span className={s.meta}>
          {metaLine(source)}
          {lastPlayed && (
            <span className={s.flag}>
              <Icon name="history" size={12} strokeWidth={2.2} /> Last played
            </span>
          )}
          {source.cached === false && <span className={`${s.flag} ${s.warn}`}>Not cached</span>}
        </span>
        {showRelease && <span className={s.release}>{source.title}</span>}
        {source.unsupported && (
          <span className={s.unsupported}>
            <Icon name="warning" size={13} strokeWidth={2.2} /> {source.unsupported}
          </span>
        )}
      </span>
    </div>
  )
}

function Placeholder() {
  return (
    <div className={`${s.table} ${s.placeholder}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={s.row} data-divider={i > 0 ? '' : undefined}>
          <span className={s.bar} style={{ width: 40, height: 14 }} />
          <span className={s.body}>
            <span className={s.bar} style={{ width: '38%', height: 14 }} />
            <span className={s.bar} style={{ width: '62%', height: 10 }} />
            <span className={s.bar} style={{ width: '28%', height: 10 }} />
          </span>
        </div>
      ))}
    </div>
  )
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <Icon name="play" size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  )
}
