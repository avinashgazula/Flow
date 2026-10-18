import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { BackdropCard, PosterCard } from '../../components/Cards'
import { Hero } from '../../components/Hero'
import { Shelf } from '../../components/Shelf'
import { q } from '../../lib/queries'
import { useLibrary, type Progress } from '../../lib/store/library'
import type { MediaItem, MediaType, Page } from '../../lib/tmdb/types'
import s from './HomeScreen.module.css'

export function HomeScreen() {
  const hero = useQuery(q.trending('all', 'day'))
  return (
    <div className={s.home}>
      <Hero items={hero.data?.results ?? []} />
      <div className={s.shelves}>
        <ContinueWatching />
        <QueryShelf title="Trending Movies" query={q.trending('movie')} seeAll={{ type: 'movie', sort: 'trending' }} />
        <QueryShelf title="Trending Shows" query={q.trending('show')} seeAll={{ type: 'show', sort: 'trending' }} />
        <Watchlist />
        <QueryShelf title="Popular Movies" query={q.list('movie', 'popular')} seeAll={{ type: 'movie', sort: 'popular' }} />
        <QueryShelf title="Top Rated Shows" query={q.list('show', 'top_rated')} seeAll={{ type: 'show', sort: 'top' }} />
        <QueryShelf title="Science Fiction" query={q.discover('movie', { with_genres: 878, sort_by: 'popularity.desc' })} seeAll={{ type: 'movie', genre: 878 }} />
        <QueryShelf title="Top Rated Movies" query={q.list('movie', 'top_rated')} seeAll={{ type: 'movie', sort: 'top' }} />
        <QueryShelf title="Comedy Series" query={q.discover('show', { with_genres: 35, sort_by: 'popularity.desc' })} seeAll={{ type: 'show', genre: 35 }} />
      </div>
    </div>
  )
}

function QueryShelf({ title, query, seeAll }: { title: string; query: UseQueryOptions<Page<MediaItem>, Error, Page<MediaItem>, any>; seeAll?: { type: MediaType; sort?: string; genre?: number } }) {
  const { data, isPending, isError } = useQuery(query)
  if (isError || (data && data.results.length === 0)) return null
  return (
    <Shelf title={title} loading={isPending} seeAll={seeAll ? { to: '/explore', search: seeAll } : undefined}>
      {data?.results.map((item) => <PosterCard key={`${item.type}${item.id}`} item={item} />)}
    </Shelf>
  )
}

function ContinueWatching() {
  const progress = useLibrary((l) => l.progress)
  const entries = Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt)
  if (!entries.length) return null
  return (
    <Shelf title="Continue Watching" kind="backdrop" seeAll={{ to: '/library' }}>
      {entries.map((p) => (
        <BackdropCard key={p.key} item={p.item} label={p.item.title} sublabel={remaining(p)} progress={p.position / p.duration} to={p.episode} />
      ))}
    </Shelf>
  )
}

function Watchlist() {
  const watchlist = useLibrary((l) => l.watchlist)
  if (!watchlist.length) return null
  return (
    <Shelf title="Watchlist" seeAll={{ to: '/library' }}>
      {watchlist.map((e) => (
        <PosterCard key={e.key} item={e.item as MediaItem} />
      ))}
    </Shelf>
  )
}

function remaining(p: Progress) {
  const minutes = Math.max(1, Math.round((p.duration - p.position) / 60))
  const left = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left`
  return p.episode ? `S${p.episode.season} E${p.episode.episode} · ${left}` : left
}
