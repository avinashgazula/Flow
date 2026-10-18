import type { CSSProperties } from 'react'
import { defaultSrc, srcSet, type ImageKind } from '../lib/tmdb/images'
import s from './Artwork.module.css'

interface Props {
  path?: string
  kind: ImageKind
  alt: string
  /** CSS `sizes`: how wide the image renders, so the browser fetches only what it needs. */
  sizes: string
  /** The first screen's largest image: fetched before anything else, never lazily. */
  priority?: boolean
  className?: string
  style?: CSSProperties
  /** Shown when there's no artwork. */
  fallback?: string
  /** The element a View Transitions zoom grows from (see markZoomSource). */
  zoom?: boolean
}

/** A TMDB image that never shifts layout: its box is sized by CSS before a byte arrives, it fades in
 *  once decoded, and off-screen ones wait until they're near the viewport. */
export function Artwork({ path, kind, alt, sizes, priority, className, style, fallback, zoom }: Props) {
  if (!path) {
    return (
      <div className={`${s.box} ${s.empty} ${className ?? ''}`} style={style} role="img" aria-label={alt} data-zoom={zoom ? '' : undefined}>
        {fallback && <span className={s.fallback}>{fallback}</span>}
      </div>
    )
  }
  return (
    <div className={`${s.box} ${className ?? ''}`} style={style} data-zoom={zoom ? '' : undefined}>
      <img
        className={s.img}
        src={defaultSrc(path, kind)}
        srcSet={srcSet(path, kind)}
        sizes={sizes}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
        draggable={false}
        // Set straight on the element: a state update per image would re-render whole shelves.
        onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
        ref={(img) => {
          if (img?.complete && img.naturalWidth) img.setAttribute('data-loaded', '')
        }}
      />
    </div>
  )
}
