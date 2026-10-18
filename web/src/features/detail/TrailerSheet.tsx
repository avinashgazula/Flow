import { useEffect } from 'react'
import { Icon } from '../../components/Icon'
import type { Video } from '../../lib/tmdb/types'
import s from './TrailerSheet.module.css'

/** The trailer, in YouTube's privacy-enhanced player. Loaded only when asked for. */
export default function TrailerSheet({ video, title, onClose }: { video: Video; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return (
    <div className={s.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label={`${title} trailer`}>
      <div className={s.frame} onClick={(e) => e.stopPropagation()}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video.key}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={video.name}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <button className={`btn btn-glass btn-circle ${s.close}`} onClick={onClose} aria-label="Close trailer">
        <Icon name="close" size={20} strokeWidth={2.4} />
      </button>
    </div>
  )
}
