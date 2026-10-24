import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../../components/Icon'
import { useWatchProviders, providerLogo, type WatchProvider } from '../../lib/providers'
import type { MediaType } from '../../lib/tmdb/types'
import { Select } from './Controls'
import { filterLanguages } from './filterQuery'
import { isFiltered, lastFilterYear, noFilters, ratingSteps, releaseWindows, type ExploreFilters, type ReleaseWindow } from './filters'
import s from './FiltersSheet.module.css'

/** How many services show before "Show More"; TMDB lists a hundred or so per region. */
const firstServices = 24

const years = (): { id: string; label: string }[] => {
  const list = [{ id: '', label: 'Any' }]
  for (let y = lastFilterYear(); y >= 1920; y--) list.push({ id: String(y), label: String(y) })
  return list
}

/** The filter sheet: a side panel on a desktop, a bottom sheet on a phone. Every change applies at once, so
 *  the grid behind it follows along (on a desktop you can watch it), and Show Results simply closes it.
 *  Escape closes, Tab stays inside, and focus goes back to the Filters button. */
export default function FiltersSheet({ type, filters, onChange, onClose }: { type: MediaType; filters: ExploreFilters; onChange: (next: ExploreFilters) => void; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()
  const yearOptions = useMemo(years, [])

  // The sheet owns the keyboard and the page behind it stays put; focus goes back where it was.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.({ preventScroll: true })
    }
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panel.current) return
    // Keep Tab inside the sheet: the first control follows the last, and back.
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), select, [href], [tabindex="0"]')].filter((el) => el.tabIndex >= 0)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const set = (patch: Partial<ExploreFilters>) => onChange({ ...filters, ...patch })
  const noRelease = !filters.window && filters.yearFrom === undefined && filters.yearTo === undefined

  // A language from a shared link that the sheet doesn't list still shows, so it can be seen and cleared.
  const languages = [{ id: '', label: 'Any' }, ...filterLanguages]
  if (filters.language && !filterLanguages.some((l) => l.id === filters.language)) languages.push({ id: filters.language, label: filters.language.toUpperCase() })

  return (
    <div className={s.overlay} onKeyDown={onKeyDown}>
      <div className={s.scrim} onClick={onClose} aria-hidden />
      <section className={s.panel} ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className={s.header}>
          <h2 id={titleId} className={s.title}>
            Filters
          </h2>
          <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} strokeWidth={2.4} />
          </button>
        </header>

        <div className={s.body}>
          <fieldset className={s.section}>
            <legend className={s.legend}>Release</legend>
            <div className={s.chips} role="group" aria-label="Release window">
              <button type="button" className="chip" aria-pressed={noRelease} onClick={() => set({ window: undefined, yearFrom: undefined, yearTo: undefined })}>
                Any Time
              </button>
              {releaseWindows.map((w) => (
                <button key={w.id} type="button" className="chip" aria-pressed={filters.window === w.id} onClick={() => set({ window: w.id as ReleaseWindow, yearFrom: undefined, yearTo: undefined })}>
                  {w.label}
                </button>
              ))}
            </div>
            <div className={s.pair}>
              <div className={s.field}>
                <span className={s.fieldLabel} aria-hidden>
                  From year
                </span>
                <Select className={s.select} label="From year" options={yearOptions} value={filters.yearFrom ? String(filters.yearFrom) : ''} onChange={(v) => set({ yearFrom: v ? Number(v) : undefined, window: undefined })} />
              </div>
              <div className={s.field}>
                <span className={s.fieldLabel} aria-hidden>
                  To year
                </span>
                <Select className={s.select} label="To year" options={yearOptions} value={filters.yearTo ? String(filters.yearTo) : ''} onChange={(v) => set({ yearTo: v ? Number(v) : undefined, window: undefined })} />
              </div>
            </div>
          </fieldset>

          <fieldset className={s.section}>
            <legend className={s.legend}>Rating</legend>
            <div className={s.chips} role="group" aria-label="Minimum rating">
              <button type="button" className="chip" aria-pressed={filters.minRating === undefined} onClick={() => set({ minRating: undefined })}>
                Any
              </button>
              {ratingSteps.map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={filters.minRating === r} onClick={() => set({ minRating: r })}>
                  <span className="num">{r}+</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={s.section}>
            <legend className={s.legend}>Language</legend>
            <div className={s.field}>
              <span className={s.fieldLabel} aria-hidden>
                Original language
              </span>
              <Select className={s.select} label="Original language" options={languages} value={filters.language ?? ''} onChange={(v) => set({ language: v || undefined })} />
            </div>
          </fieldset>

          <Services type={type} selected={filters.providers} onChange={(providers) => set({ providers })} />
        </div>

        <footer className={s.footer}>
          <button type="button" className="btn btn-secondary" onClick={() => onChange(noFilters)} disabled={!isFiltered(filters)}>
            Reset
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Show Results
          </button>
        </footer>
      </section>
    </div>
  )
}

/** Streaming On: the region's services as logos, each a toggle. Selected is the yellow ring. */
function Services({ type, selected, onChange }: { type: MediaType; selected: number[]; onChange: (ids: number[]) => void }) {
  const { providers, isPending, isError, refetch, region } = useWatchProviders(type)
  const [all, setAll] = useState(false)
  const grid = useRef<HTMLDivElement>(null)

  // The first services, plus any chosen further down the list so a selection is never hidden.
  const shown = all ? providers : providers.filter((p) => p.rank < firstServices || selected.includes(p.id))
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  // One tab stop for the whole grid, then arrows between logos: a hundred services mustn't be a hundred Tabs.
  const stop = shown.find((p) => selected.includes(p.id))?.id ?? shown[0]?.id
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key) || !grid.current) return
    const tiles = [...grid.current.querySelectorAll<HTMLButtonElement>('button[data-tile]')]
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const columns = getComputedStyle(grid.current).gridTemplateColumns.split(' ').length || 1
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : 0
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : Math.min(tiles.length - 1, Math.max(0, i + step))
    event.preventDefault()
    tiles[next]?.focus()
  }

  return (
    <fieldset className={s.section}>
      <legend className={s.legend}>
        Streaming On <span className={s.region}>{region}</span>
      </legend>
      {isPending ? (
        <div className={s.grid} aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={s.skeleton} />
          ))}
        </div>
      ) : isError ? (
        <p className={s.note}>
          Couldn’t load the streaming services.{' '}
          <button type="button" className={s.link} onClick={() => void refetch()}>
            Try Again
          </button>
        </p>
      ) : providers.length === 0 ? (
        <p className={s.note}>TMDB lists no streaming services for {region}. You can change your region in Settings.</p>
      ) : (
        <>
          <div className={s.grid} ref={grid} role="group" aria-label="Streaming services" onKeyDown={onKeyDown}>
            {shown.map((p) => (
              <Tile key={p.id} provider={p} on={selected.includes(p.id)} tabStop={p.id === stop} onToggle={() => toggle(p.id)} />
            ))}
          </div>
          {providers.length > shown.length && (
            <button type="button" className={`btn btn-quiet btn-compact ${s.more}`} onClick={() => setAll(true)}>
              Show More
            </button>
          )}
        </>
      )}
    </fieldset>
  )
}

function Tile({ provider, on, tabStop, onToggle }: { provider: WatchProvider; on: boolean; tabStop: boolean; onToggle: () => void }) {
  const logo = providerLogo(provider.logo)
  return (
    <button type="button" data-tile className={s.tile} aria-pressed={on} tabIndex={tabStop ? 0 : -1} onClick={onToggle}>
      <span className={s.logo}>
        {logo ? <img src={logo.src} srcSet={logo.srcSet} width={56} height={56} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className={s.initial}>{provider.name.slice(0, 1)}</span>}
      </span>
      {/* A check beside the name, so a chosen service never rests on the ring's colour alone. */}
      <span className={s.name}>
        {on && <Icon name="check" size={12} strokeWidth={3} className={s.check} />}
        {provider.name}
      </span>
    </button>
  )
}
