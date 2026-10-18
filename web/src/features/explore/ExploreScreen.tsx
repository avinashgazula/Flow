import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'
import { movieGenres, tvGenres } from '../../lib/genres'
import { q } from '../../lib/queries'
import type { Genre, MediaType } from '../../lib/tmdb/types'
import { Segmented, Select, StateView, errorMessage } from './Controls'
import { PosterGrid } from './PosterGrid'
import { exploreSorts, exploreSource, orderGenres, uniqueItems, type ExploreSort } from './source'
import s from './ExploreScreen.module.css'

const types = [
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'TV Shows' },
] as const

const staticGenres = (type: MediaType): Genre[] => Object.entries(type === 'movie' ? movieGenres : tvGenres).map(([id, name]) => ({ id: Number(id), name }))

/** Movies or TV shows, browsed without end: trending by default, a genre and a sort narrow it down.
 *  The filters live in the address, so Back, reloads and Home's "See All" links land on the same grid. */
export function ExploreScreen({ type, sort, genre }: { type: MediaType; sort: ExploreSort; genre?: number }) {
  const navigate = useNavigate({ from: '/explore' })
  const gridTop = useRef<HTMLDivElement>(null)

  const source = exploreSource(type, sort, genre)
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

  const update = (next: { type?: MediaType; sort?: ExploreSort; genre?: number | null }) => {
    const nextType = next.type ?? type
    const nextSort = next.sort ?? sort
    // A genre belongs to one type's list: switching between movies and shows starts from All.
    const nextGenre = next.type && next.type !== type ? undefined : next.genre === null ? undefined : (next.genre ?? genre)
    void navigate({ search: { type: nextType, sort: nextSort === 'trending' ? undefined : nextSort, genre: nextGenre }, replace: true, resetScroll: false })
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
        <Segmented className={s.types} options={types} value={type} onChange={(v) => update({ type: v })} label="Type" />
        <Segmented className={s.sorts} options={exploreSorts} value={sort} onChange={(v) => update({ sort: v })} label="Sort by" />
      </div>

      <div
        className={s.chips}
        role="group"
        aria-label="Genre"
        ref={(row) => {
          // Land with the selected genre in view: a "See All" from Home can pick one far along the row.
          const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
          if (row && chip && chip.offsetLeft + chip.offsetWidth > row.clientWidth) row.scrollLeft = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2
        }}
      >
        <button type="button" className="chip" aria-pressed={!genre} onClick={() => update({ genre: null })}>
          All
        </button>
        {genres.map((g) => (
          <button key={g.id} type="button" className="chip" aria-pressed={g.id === genre} onClick={() => update({ genre: g.id })}>
            {g.name}
          </button>
        ))}
      </div>

      <div ref={gridTop} className={s.results}>
        {query.isError && items.length === 0 ? (
          <StateView
            icon="info"
            title="Couldn’t Load Titles"
            message={errorMessage(query.error)}
            action={
              <button className="btn btn-glass" onClick={() => void query.refetch()}>
                Try Again
              </button>
            }
          />
        ) : !query.isPending && items.length === 0 ? (
          <StateView icon="explore" title="Nothing Here Yet" message="No titles match this genre and sort. Try another genre, or All." />
        ) : (
          <PosterGrid items={items} pending={query.isPending} hasMore={!!query.hasNextPage && !query.isFetchNextPageError} onNearEnd={loadMore} label={`${type === 'movie' ? 'Movies' : 'TV shows'}`} />
        )}
        {query.isFetchNextPageError && (
          <div className={s.more}>
            <p className="muted">Couldn’t load more titles.</p>
            <button className="btn btn-glass btn-compact" onClick={() => void query.fetchNextPage()}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
