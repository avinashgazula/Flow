import { Icon } from '../../components/Icon'
import { mediaKey, useLibrary } from '../../lib/store/library'
import { titleLibrary } from '../../lib/store/titleLibrary'
import type { MediaItem } from '../../lib/tmdb/types'
import { starsOf } from './logic'
import s from './StarRating.module.css'

/** The viewer's own score for a title, 1 to 10, kept here and sent to Trakt when signed in. */
export function useRating(item: Pick<MediaItem, 'type' | 'id'>): number | undefined {
  return useLibrary((l) => l.ratings?.[mediaKey(item.type, item.id)])
}

/** Five stars for a 1 to 10 score, two points each. Choosing the star already chosen clears the score. The title
 *  page shows it for a title that is watched or already scored; the player can put the same component on the
 *  end of a film ("How was it?"), which is the one thing it needs: `<StarRating item={item} />`. */
export function StarRating({ item, label = 'Your rating' }: { item: MediaItem; label?: string }) {
  const score = useRating(item)
  const stars = starsOf(score)
  return (
    <div className={s.stars} role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={s.star}
          data-on={star <= stars ? '' : undefined}
          aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
          aria-pressed={star === stars}
          onClick={() => titleLibrary.rate(item, star === stars ? null : star * 2)}
        >
          <Icon name="star" size={22} filled={star <= stars} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  )
}
