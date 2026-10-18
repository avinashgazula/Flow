/* TMDB's image CDN serves fixed widths. Each kind lists the widths worth offering, so the browser
   picks the smallest file that's sharp at the element's size and pixel density. */

const cdn = 'https://image.tmdb.org/t/p/'

export type ImageKind = 'poster' | 'backdrop' | 'profile' | 'still' | 'logo'

const widths: Record<ImageKind, number[]> = {
  poster: [154, 185, 342, 500, 780],
  backdrop: [300, 780, 1280],
  // Profiles come in w185 and h632; w632 doesn't exist (400). w342 and w500 are served for every kind.
  profile: [185, 342, 500],
  still: [185, 300],
  logo: [185, 300, 500],
}

export function imageURL(path: string | undefined, width: number | 'original'): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  return `${cdn}${width === 'original' ? 'original' : `w${width}`}${path}`
}

export function srcSet(path: string | undefined, kind: ImageKind): string | undefined {
  if (!path || path.startsWith('http')) return undefined
  const list = widths[kind].map((w) => `${cdn}w${w}${path} ${w}w`)
  if (kind === 'backdrop') list.push(`${cdn}original${path} 1920w`)
  return list.join(', ')
}

/** A middle size for the plain `src`, used by browsers that ignore srcset. */
export function defaultSrc(path: string | undefined, kind: ImageKind): string | undefined {
  const fallback: Record<ImageKind, number> = { poster: 342, backdrop: 1280, profile: 185, still: 300, logo: 500 }
  return imageURL(path, fallback[kind])
}

/** Warms the browser cache for an image the next screen will show first. */
export function preloadImage(path: string | undefined, width: number) {
  const url = imageURL(path, width)
  if (!url) return
  const img = new Image()
  img.decoding = 'async'
  img.src = url
}

export { widths as imageWidths }
