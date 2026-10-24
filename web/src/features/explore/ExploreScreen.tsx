import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { movieGenres, tvGenres } from '../../lib/genres'
import { useProviderNames } from '../../lib/providers'
import { q } from '../../lib/queries'
import { useSettings } from '../../lib/store/settings'
import type { Genre, MediaType } from '../../lib/tmdb/types'
import { ChipRow } from './ChipRow'
import { Segmented, Select, StateView, errorMessage } from './Controls'
import { summarizeFilters } from './filterQuery'
import { filtersToSearch, isFiltered, noFilters, type ExploreFilters } from './filters'
import { PosterGrid } from './PosterGrid'
import { exploreSource, orderGenres, uniqueItems } from './source'
import { exploreSorts, type ExploreSort } from './sorts'
import s from './ExploreScreen.module.css'

// The sheet carries the language list, the provider grid and its keyboard handling: it loads when first opened.
const loadSheet = () => import('./FiltersSheet')
const FiltersSheet = lazy(loadSheet)

const types = [
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'TV Shows' },
] as const

const staticGenres = (type: MediaType): Genre[] => Object.entries(type === 'movie' ? movieGenres : tvGenres).map(([id, name]) => ({ id: Number(id), name }))

/** Movies or TV shows, browsed without end: trending by default, a genre and a sort narrow it down.
 *  The filters live in the address, so Back, reloads and Home's "See All" links land on the same grid. */
export function ExploreScreen({ type, sort, genre, filters }: { type: MediaType; sort: ExploreSort; genre?: number; filters: ExploreFilters }) {
  const navigate = useNavigate({ from: '/explore' })
  const gridTop = useRef<HTMLDivElement>(null)
  const region = useSettings((x) => x.region)
  const [sheetOpen, setSheetOpen] = useState(false)
  const filtered = isFiltered(filters)

  const source = exploreSource(type, sort, genre, filters, { region })
  // Both factories page through the same Page<MediaItem>; only their keys' shapes differ.
  const options = source.kind === 'discover' ? q.discoverInfinite(type, source.params) : (q.listInfinite(type, source.list) as unknown as ReturnType<typeof q.discoverInfinite>)
  const query = useInfiniteQuery(options)
  const items = uniqueItems(query.data?.pages)

  const { data: genreList } = useQuery({ ...q.genres(type), placeholderData: () => staticGenres(type) })
  const genres = orderGenres(genreList?.length ? genreList : staticGenres(type), type)
  // A genre from a link that isn't in this type's list still gets a chip, so the filter is visible.
  if (genre && !genres.some((g) => g.id === genre)) {
    const name = movieGenres[genre] ?? tvGenres[genre]
    if (name) genres.unshift({ id: genre, name })
  }

  const update = (next: { type?: MediaType; sort?: ExploreSort; genre?: number | null; filters?: ExploreFilters }) => {
    const nextType = next.type ?? type
    const nextSort = next.sort ?? sort
    // A genre belongs to one type's list: switching between movies and shows starts from All.
    const nextGenre = next.type && next.type !== type ? undefined : next.genre === null ? undefined : (next.genre ?? genre)
    // Filters carry across Movies and TV Shows: none of them belongs to one.
    const nextFilters = next.filters ?? filters
    void navigate({ search: { type: nextType, sort: nextSort === 'trending' ? undefined : nextSort, genre: nextGenre, ...filtersToSearch(nextFilters) }, replace: true, resetScroll: false })
    // Back to the top of the grid, not the page, so the filters stay in view.
    const el = gridTop.current
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 140
      if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y) })
    }
  }

  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage()
  }

  return (
    <div className={`page ${s.screen}`}>
      <div className={s.titleRow}>
        <h1 className="page-title">Explore</h1>
        <Select className={s.sortMenu} options={exploreSorts} value={sort} onChange={(v) => update({ sort: v })} label="Sort by" />
      </div>

      <div className={s.controls}>
        <div className={s.modes}>
          <Segmented className={s.types} options={types} value={type} onChange={(v) => update({ type: v })} label="Type" />
          <button
            type="button"
            className={`btn btn-secondary ${s.filtersButton}`}
            data-active={filtered || undefined}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-label={filtered ? 'Filters, on' : 'Filters'}
            onClick={() => setSheetOpen(true)}
            onPointerEnter={() => void loadSheet()}
            onFocus={() => void loadSheet()}
          >
            <Icon name="filters" size={18} strokeWidth={2.2} />
            <span>Filters</span>
          </button>
        </div>
        <Segmented className={s.sorts} options={exploreSorts} value={sort} onChange={(v) => update({ sort: v })} label="Sort by" />
      </div>

      <ChipRow label="Genre">
        <button type="button" className="chip" aria-pressed={!genre} onClick={() => update({ genre: null })}>
          All
        </button>
        {genres.map((g) => (
          <button key={g.id} type="button" className="chip" aria-pressed={g.id === genre} onClick={() => update({ genre: g.id })}>
            {g.name}
          </button>
        ))}
      </ChipRow>

      {filtered && <FilterSummary type={type} filters={filters} onClear={() => update({ filters: noFilters })} />}

      <div ref={gridTop} className={s.results}>
        {query.isError && items.length === 0 ? (
          <StateView
            icon="info"
            title="Couldn’t Load Titles"
            message={errorMessage(query.error)}
            action={
              <button className="btn btn-secondary" onClick={() => void query.refetch()}>
                Try Again
              </button>
            }
          />
        ) : !query.isPending && items.length === 0 ? (
          filtered ? (
            <StateView
              icon="filters"
              title="Nothing matches these filters"
              message="Loosen one or two of them, or reset to see everything again."
              action={
                <button className="btn btn-secondary" onClick={() => update({ filters: noFilters })}>
                  Reset
                </button>
              }
            />
          ) : (
            <StateView icon="explore" title="Nothing Here Yet" message="No titles match this genre and sort. Try another genre, or All." />
          )
        ) : (
          <PosterGrid items={items} pending={query.isPending} hasMore={!!query.hasNextPage && !query.isFetchNextPageError} onNearEnd={loadMore} label={`${type === 'movie' ? 'Movies' : 'TV shows'}`} />
        )}
        {query.isFetchNextPageError && (
          <div className={s.more}>
            <p className="muted">Couldn’t load more titles.</p>
            <button className="btn btn-secondary btn-compact" onClick={() => void query.fetchNextPage()}>
              Try Again
            </button>
          </div>
        )}
      </div>

      {sheetOpen && (
        <Suspense fallback={null}>
          <FiltersSheet type={type} filters={filters} onChange={(next) => update({ filters: next })} onClose={() => setSheetOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

/** The filters in force as one quiet line under the controls, with a way to clear them. */
function FilterSummary({ type, filters, onClear }: { type: MediaType; filters: ExploreFilters; onClear: () => void }) {
  const names = useProviderNames(type)
  const text = summarizeFilters(filters, names)
  return (
    <div className={s.summary}>
      <p className={s.summaryText} title={text}>
        <span className="sr-only">Filters: </span>
        {text}
      </p>
      <button type="button" className="btn btn-quiet btn-compact" onClick={onClear} aria-label="Clear filters">
        Clear
      </button>
    </div>
  )
}
