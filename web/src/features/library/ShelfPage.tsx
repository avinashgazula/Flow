import { useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { q } from '../../lib/queries'
import type { ShelfConfig } from '../../lib/shelfDefaults'
import { rememberLibraryOrigin } from '../../lib/sources/lastSource'
import type { ServerTitle } from '../../lib/sources/types'
import { hasCatalog, useSettings } from '../../lib/store/settings'
import type { MediaItem, MediaType } from '../../lib/tmdb/types'
import { Segmented, StateView } from '../explore/Controls'
import { PageHead, Toolbar } from '../explore/PageHead'
import { BackLink } from './BackLink'
import { PosterGrid } from '../explore/PosterGrid'
import { asMediaItem } from '../home/marks'
import { titles } from './logic'
import s from './LibraryScreen.module.css'

type ListSource = Extract<ShelfConfig['source'], { kind: 'traktList' | 'mdblist' | 'mediaServerLibrary' }>

/** How many titles are read from TMDB at a time: each one is a request, so the grid asks for the next batch as it nears the end. */
const batch = 30
const sixMinutes = 6 * 60_000

const filters = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'Shows' },
] as const

/** One list shelf as a whole grid (the apps' Shelf page): everything a Trakt list, an MDBList list or a server's library
 *  holds, in its own order. Reached by See all on the shelf. */
export default function ShelfPage({ shelfId, type, onType }: { shelfId: string; type?: MediaType; onType: (t: MediaType | undefined) => void }) {
  const shelf = useSettings((x) => x.shelves.find((sh) => sh.id === shelfId))
  const source = shelf?.source
  if (!shelf || !source || (source.kind !== 'traktList' && source.kind !== 'mdblist' && source.kind !== 'mediaServerLibrary')) {
    return (
      <>
        <PageHead title="Library" back={<BackLink />} />
        <StateView icon="library" title="This Shelf Isn’t Here Any More" message="It was removed in Settings → Shelves. Open Library to see what is left." />
      </>
    )
  }
  return (
    <>
      <PageHead title={shelf.title} back={<BackLink />} long />
      <Titles source={source} type={type} onType={onType} />
    </>
  )
}

/** The shelf's titles as TMDB items, a batch at a time, in the shelf's order. */
function useShelfItems(source: ListSource) {
  const catalogue = useSettings(hasCatalog)
  const artwork = useSettings((x) => x.useServerArtwork === true)
  const ready = useSettings((x) => (source.kind === 'traktList' ? x.traktClientID.trim().length > 0 : source.kind === 'mdblist' ? !!x.mdblistKey?.trim() : true))
  const server = useSettings((x) => (source.kind === 'mediaServerLibrary' ? x.servers.find((v) => v.id === source.serverID && v.enabled) : undefined))
  const [count, setCount] = useState(batch)

  const listed = useQuery({
    queryKey: source.kind === 'mediaServerLibrary' ? ['shelf', 'server', source.serverID, source.libraryID] : ['lists', ...(source.kind === 'traktList' ? ['trakt', source.user, source.slug] : ['mdblist', source.id])],
    queryFn: async ({ signal }): Promise<{ type: MediaType; tmdb?: number; server?: ServerTitle }[]> => {
      if (source.kind === 'mediaServerLibrary') return (await import('../../lib/sources/serverCatalogue')).libraryTitles(server!, source.libraryID, signal).then((l) => l.map((t) => ({ type: t.type, tmdb: t.tmdb, server: t })))
      const lists = await import('../../lib/listTitles')
      return source.kind === 'traktList' ? lists.traktListTitles(source.user, source.slug) : lists.mdblistTitles(source.id)
    },
    enabled: ready && (source.kind !== 'mediaServerLibrary' || !!server),
    staleTime: sixMinutes,
    retry: false,
  })
  const all = (listed.data ?? []).filter((t) => t.tmdb)
  const shown = all.slice(0, count)
  const details = useQueries({ queries: shown.map((t) => ({ ...q.detail(t.type, t.tmdb!), enabled: catalogue, retry: false })) })
  const items: MediaItem[] = shown.flatMap((t, i) => {
    const item = t.server ? asMediaItem(t.server, details[i]?.data, artwork) : details[i]?.data
    return item ? [item] : []
  })
  const waiting = details.some((d) => d.isPending && d.fetchStatus !== 'idle')
  return {
    items,
    ready: ready && catalogue && (source.kind !== 'mediaServerLibrary' || !!server),
    pending: listed.isPending && listed.fetchStatus !== 'idle',
    failed: listed.isError,
    hasMore: count < all.length,
    more: () => !waiting && setCount((c) => c + batch),
    server: source.kind === 'mediaServerLibrary' ? source.serverID : undefined,
  }
}

function Titles({ source, type, onType }: { source: ListSource; type?: MediaType; onType: (t: MediaType | undefined) => void }) {
  const { items, ready, pending, failed, hasMore, more, server } = useShelfItems(source)
  if (!ready) return <StateView icon="library" title="This Shelf Can’t Load" message={source.kind === 'traktList' ? 'Add your Trakt Client ID in Settings → Account, then open this again.' : source.kind === 'mdblist' ? 'Add your MDBList key in Settings → Account, then open this again.' : 'Turn the server back on in Settings → Media Servers, then open this again.'} />
  if (failed) return <StateView icon="library" title="Couldn’t Load This List" message="Flow couldn’t reach the service behind it. Check your connection, then try again." />
  if (!pending && !hasMore && items.length === 0) return <StateView icon="library" title="Nothing in This List" message="It has no films or series yet." />
  const shown = type ? items.filter((m) => m.type === type) : items
  return (
    <>
      <Toolbar>
        <Segmented className={s.filter} options={filters} value={type ?? 'all'} onChange={(f) => onType(f === 'all' ? undefined : f)} label="Show" />
        <span className={s.toolbarEnd}>
          <span className="muted num">{titles(shown.length)}</span>
        </span>
      </Toolbar>
      {/* A title opened from a server's library remembers which, for Play From This Library Only. */}
      <div
        onClickCapture={
          server
            ? (e) => {
                const m = /\/title\/(movie|show)\/(\d+)/.exec((e.target as Element).closest('a')?.getAttribute('href') ?? '')
                if (m) rememberLibraryOrigin(m[1] as MediaType, Number(m[2]), server)
              }
            : undefined
        }
      >
        <PosterGrid items={shown} pending={pending} hasMore={hasMore} onNearEnd={more} label="Titles" />
      </div>
    </>
  )
}
