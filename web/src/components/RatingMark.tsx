import imdb from 'simple-icons/icons/imdb.svg?raw'
import letterboxd from 'simple-icons/icons/letterboxd.svg?raw'
import metacritic from 'simple-icons/icons/metacritic.svg?raw'
import rottentomatoes from 'simple-icons/icons/rottentomatoes.svg?raw'
import tmdb from 'simple-icons/icons/themoviedatabase.svg?raw'
import trakt from 'simple-icons/icons/trakt.svg?raw'
import type { RatingSource } from '../lib/ratings/sources'

/* The small mark beside a rating's name, from Simple Icons (CC0) so the page ships no brand artwork of its own. The
   marks only say where a score comes from. They are drawn in the text colour, one weight and one size, so the row stays
   quiet in both themes. Popcornmeter has no mark there (Rotten Tomatoes' own audience bucket is its art), so it gets a
   plain generic bucket drawn here instead. */

/** The path data of a Simple Icons file: one 24 by 24 path. */
const pathOf = (svg: string) => /<path d="([^"]+)"/.exec(svg)?.[1] ?? ''

/** Each mark with its viewBox cropped to the drawing, so the two wide ones (TMDB, Letterboxd) are not left tiny in a square. */
const marks: Record<Exclude<RatingSource, 'popcornmeter'>, { d: string; box: string }> = {
  imdb: { d: pathOf(imdb), box: '0 0 24 24' },
  tomatometer: { d: pathOf(rottentomatoes), box: '0 0 24 24' },
  metacritic: { d: pathOf(metacritic), box: '0 0 24 24' },
  tmdb: { d: pathOf(tmdb), box: '0 3.35 24 17.3' },
  letterboxd: { d: pathOf(letterboxd), box: '0 7.56 24 8.89' },
  trakt: { d: pathOf(trakt), box: '0 0 24 24' },
}

/** Decorative: the cell's text already names the service. */
export function RatingMark({ source, className }: { source: RatingSource; className?: string }) {
  if (source === 'popcornmeter') {
    return (
      <svg className={className} viewBox="0 0 24 24" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">
        {/* Kernels over a tapered bucket with two stripes cut out of it. */}
        <path fill="currentColor" d="M7 9.5a2.6 2.6 0 0 1 2.2-4.2 2.9 2.9 0 0 1 5.6 0A2.6 2.6 0 0 1 17 9.5Z" />
        <path fill="currentColor" fillRule="evenodd" d="M4.5 10.5h15L17.8 22H6.2Zm4.1 2.2L9.3 20h1.4l-.5-7.3Zm4.7 0 -.5 7.3h1.4l.7-7.3Z" />
      </svg>
    )
  }
  return (
    <svg className={className} viewBox={marks[source].box} preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={marks[source].d} />
    </svg>
  )
}
