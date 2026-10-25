import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { Video } from '../../lib/tmdb/types'
import s from './TrailerSheet.module.css'

/** The trailer, in YouTube's privacy-enhanced player, with a row of the title's other videos under it when there
 *  are more than one (best first: official trailers, teasers, then the rest). Loaded only when asked for. Focus
 *  moves in when it opens and goes back to the Trailer button when it closes. */
export default function TrailerSheet({ videos, title, onClose }: { videos: Video[]; title: string; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const video = videos[index] ?? videos[0]!
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <div className={s.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label={`${title} trailer`}>
      <div className={s.stage} onClick={(e) => e.stopPropagation()}>
        <div className={s.frame}>
          <iframe
            key={video.key}
            src={`https://www.youtube-nocookie.com/embed/${video.key}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={video.name}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
        {videos.length > 1 && (
          <div
            className={s.picker}
            role="radiogroup"
            aria-label="Videos"
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
              if (!step) return
              e.preventDefault()
              const group = e.currentTarget
              setIndex((index + step + videos.length) % videos.length)
              requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
            }}
          >
            {videos.map((v, i) => (
              <button key={v.key} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1} className={s.choice} onClick={() => setIndex(i)}>
                {v.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button ref={close} className={`btn btn-secondary btn-circle ${s.close}`} onClick={onClose} aria-label="Close trailer">
        <Icon name="close" size={20} strokeWidth={2.4} />
      </button>
    </div>
  )
}
