import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { q } from '../../lib/queries'
import { spoilerParts } from '../../lib/reviewText'
import type { MediaType, Review } from '../../lib/tmdb/types'
import { userLocale } from '../../lib/time'
import s from './Reviews.module.css'

/** Reviews shown before "Show all". Two columns on a wide screen, so an even number reads best. */
const shown = 4

/** What viewers on TMDB and Trakt wrote, newest first. Kept in its own chunk, and only asked for when the page is
 *  scrolled near it (DetailScreen), so a title page that is never scrolled that far costs nothing. A title nobody
 *  has reviewed has no section at all. */
export default function Reviews({ type, id, imdb }: { type: MediaType; id: number; imdb?: string }) {
  const { data } = useQuery(q.reviews(type, id, imdb))
  const [all, setAll] = useState(false)
  if (!data?.length) return null
  const sources = [...new Set(data.map((r) => (r.source === 'tmdb' ? 'TMDB' : 'Trakt')))].sort().join(' & ')
  const list = all ? data : data.slice(0, shown)
  return (
    <section className={s.reviews} aria-labelledby="reviews-title">
      <div className={s.head}>
        <h2 id="reviews-title" className={s.title}>
          Reviews
        </h2>
        <p className={s.from}>From {sources}</p>
      </div>
      <ul className={s.list}>
        {list.map((r) => (
          <li key={r.id}>
            <ReviewItem review={r} />
          </li>
        ))}
      </ul>
      {data.length > shown && (
        <button type="button" className={s.more} onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${data.length}`}
        </button>
      )}
    </section>
  )
}

/** Past this many characters a review is folded to a few lines, with Read More. */
const foldAt = 280

function ReviewItem({ review: r }: { review: Review }) {
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const long = r.text.length > foldAt
  const date = r.date ? new Date(r.date).toLocaleDateString(userLocale, { day: 'numeric', month: 'short', year: 'numeric' }) : undefined
  const hidden = r.spoiler && !revealed
  return (
    <article className={s.item} aria-label={`Review by ${r.author}`}>
      <header className={s.by}>
        <span className={s.initial} aria-hidden="true">
          {r.author.charAt(0).toUpperCase()}
        </span>
        <span className={s.who}>
          <span className={s.author}>{r.author}</span>
          <span className={s.meta}>
            {r.source === 'tmdb' ? 'TMDB' : 'Trakt'}
            {date && <> · <time dateTime={new Date(r.date!).toISOString().slice(0, 10)}>{date}</time></>}
          </span>
        </span>
        <span className={s.marks}>
          {r.rating !== undefined && (
            <span className={s.score} aria-label={`Rated ${r.rating} out of 10`}>
              <Icon name="star" size={12} />
              {r.rating}/10
            </span>
          )}
          {r.spoiler && <span className={s.flag}>Spoilers</span>}
        </span>
      </header>
      <div className={s.body}>
        <p className={s.text} data-folded={long && !open ? '' : undefined} data-hidden={hidden ? '' : undefined} aria-hidden={hidden || undefined}>
          {spoilerParts(r.text).map((part, i) => (part.spoiler ? <Hidden key={i} text={part.text} /> : <span key={i}>{part.text}</span>))}
        </p>
        {hidden && (
          <button type="button" className={s.reveal} onClick={() => setRevealed(true)}>
            Show Spoilers
          </button>
        )}
      </div>
      {long && !hidden && (
        <button type="button" className={s.fold} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Read Less' : 'Read More'}
        </button>
      )}
    </article>
  )
}

/** Words between spoiler tags: blurred until tapped, and kept from a screen reader until then too. */
function Hidden({ text }: { text: string }) {
  const [shown, setShown] = useState(false)
  if (shown) return <span className={s.revealed}>{text}</span>
  return (
    <button type="button" className={s.hidden} onClick={() => setShown(true)} aria-label="Spoiler. Show it.">
      <span aria-hidden="true">{text}</span>
    </button>
  )
}
