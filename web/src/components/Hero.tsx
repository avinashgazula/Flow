import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { prefetchDetail } from '../lib/queries'
import { library, mediaKey, useLibrary } from '../lib/store/library'
import { imageURL, srcSet } from '../lib/tmdb/images'
import type { MediaItem } from '../lib/tmdb/types'
import { genreNames } from '../lib/genres'
import { markZoomSource } from './Cards'
import { Icon } from './Icon'
import s from './Hero.module.css'

const interval = 8000

/** Home's featured carousel. Only the visible slide and the next one hold images, so the first paint
 *  fetches exactly one picture, at high priority; the rest load as the carousel reaches them. */
export function Hero({ items }: { items: MediaItem[] }) {
  const slides = items.filter((i) => i.backdrop).slice(0, 8)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || slides.length < 2) return
    const timer = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % slides.length)
    }, interval)
    return () => clearInterval(timer)
  }, [paused, slides.length])

  if (!slides.length) return <div className={s.hero} aria-hidden />
  return (
    <section
      className={s.hero}
      aria-roledescription="carousel"
      aria-label="Featured"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {slides.map((item, i) => {
        const near = i === index || i === (index + 1) % slides.length || i === (index - 1 + slides.length) % slides.length
        return <Slide key={item.id} item={item} active={i === index} mounted={near} priority={i === 0} />
      })}
      {slides.length > 1 && (
        <div className={s.dots} role="tablist" aria-label="Featured titles">
          {slides.map((item, i) => (
            <button key={item.id} role="tab" aria-selected={i === index} aria-label={item.title} className={s.dot} onClick={() => setIndex(i)}>
              <span style={i === index && !paused ? { animationDuration: `${interval}ms` } : undefined} data-running={i === index && !paused ? '' : undefined} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function Slide({ item, active, mounted, priority }: { item: MediaItem; active: boolean; mounted: boolean; priority: boolean }) {
  const inWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === mediaKey(item.type, item.id)))
  const meta = [item.year, ...genreNames(item.genres, item.type).slice(0, 2)].filter(Boolean)
  return (
    <div className={s.slide} data-active={active ? '' : undefined} aria-hidden={!active} inert={!active}>
      <Link
        to="/title/$type/$id"
        params={{ type: item.type, id: item.id }}
        className={s.art}
        onPointerEnter={() => prefetchDetail(item)}
        onClick={markZoomSource}
        viewTransition
        tabIndex={-1}
        aria-label={item.title}
      >
        {mounted && (
          <picture data-zoom="">
            {/* Phones get the poster, cropped tall; wider screens the backdrop. Only one is fetched. */}
            <source media="(max-width: 720px)" srcSet={srcSet(item.poster, 'poster')} sizes="100vw" />
            <img
              src={imageURL(item.backdrop, 1280)}
              srcSet={srcSet(item.backdrop, 'backdrop')}
              sizes="100vw"
              alt=""
              fetchPriority={priority ? 'high' : 'low'}
              loading={priority ? 'eager' : 'lazy'}
              decoding={priority ? 'sync' : 'async'}
              onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
              ref={(img) => {
                if (img?.complete && img.naturalWidth) img.setAttribute('data-loaded', '')
              }}
            />
          </picture>
        )}
      </Link>
      <div className={s.content}>
        <h2 className={s.title}>{item.title}</h2>
        <p className={s.meta}>
          {item.rating ? (
            <span className={s.rating}>
              <Icon name="star" size={13} /> {item.rating.toFixed(1)}
            </span>
          ) : null}
          {meta.join(' · ')}
          <span className={s.badge}>{item.type === 'movie' ? 'Movie' : 'Series'}</span>
        </p>
        <p className={s.overview}>{item.overview}</p>
        <div className={s.actions}>
          <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={{ play: true }} className="btn btn-primary" onPointerEnter={() => prefetchDetail(item)}>
            <Icon name="play" size={18} /> Play
          </Link>
          <button className="btn btn-glass btn-circle" onClick={() => library.toggleWatchlist(item)} aria-pressed={inWatchlist} aria-label={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}>
            <Icon name={inWatchlist ? 'check' : 'plus'} size={20} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  )
}
