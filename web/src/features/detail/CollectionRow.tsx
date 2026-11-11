import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PosterRow } from '../../components/PosterRow'
import { collectionQuery } from '../../lib/tmdb/collection'
import type { MediaDetail } from '../../lib/tmdb/types'
import { useNearScreen } from '../../lib/useNearScreen'

/** The franchise a film belongs to, as the apps' Collection row: its films in release order, this one marked Current,
 *  and a link to the page that lists them all. The films are asked for once the row is near the screen. A collection
 *  of one film (only this) has nothing to add, so the row stays out. */
export function CollectionRow({ detail, now }: { detail: Pick<MediaDetail, 'type' | 'id'> & { collection?: MediaDetail['collection'] }; now: number }) {
  const collection = detail.collection
  const [near, ref] = useNearScreen<HTMLDivElement>()
  const { data } = useQuery({ ...collectionQuery(collection?.id ?? 0), enabled: near && !!collection })
  if (!collection) return null
  const parts = data?.parts ?? []
  return (
    <div ref={ref}>
      <PosterRow
        title="Collection"
        items={parts.length > 1 ? parts : []}
        now={now}
        current={detail}
        action={
          <Link to="/collection/$id" params={{ id: collection.id }} className="quiet-link" aria-label={`See every film in ${collection.name}`}>
            See all
          </Link>
        }
      />
    </div>
  )
}
