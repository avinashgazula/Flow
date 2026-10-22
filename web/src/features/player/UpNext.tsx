import { useEffect, useRef, useState } from 'react'
import { Plate } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import type { Episode } from '../../lib/tmdb/types'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import s from './Controls.module.css'

const countdownFrom = 10
/** How close to the end the card comes up, without credits markers to go on. */
const tail = 30

/** The next episode's still with a strip whose perforations empty as the countdown runs; tap it to play now.
 *  It watches the clock itself and re-renders only when it comes or goes, and once a second while
 *  counting down. */
export function UpNext({ controller, next, autoplay, fallbackStill, onPlay }: { controller: PlayerController; next: Episode; autoplay: boolean; fallbackStill?: string; onPlay: () => void }) {
  const [due, setDue] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [left, setLeft] = useState(countdownFrom)
  const lifted = usePlayer(controller, (st) => st.controls)
  const panel = usePlayer(controller, (st) => st.panel)
  const dueRef = useRef(false)

  useEffect(() => {
    const video = controller.video
    if (!video) return
    const check = () => {
      const d = controller.duration()
      const now = !Number.isNaN(d) && d > 60 && video.currentTime >= d - tail
      if (now !== dueRef.current) {
        dueRef.current = now
        setDue(now)
        if (!now) setLeft(countdownFrom)
      }
    }
    const ended = () => {
      if (autoplay && !dismissed) onPlay()
    }
    video.addEventListener('timeupdate', check)
    video.addEventListener('ended', ended)
    return () => {
      video.removeEventListener('timeupdate', check)
      video.removeEventListener('ended', ended)
    }
  }, [controller, autoplay, dismissed, onPlay])

  const counting = due && autoplay && !dismissed
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => {
      // Paused means the viewer is doing something; the countdown waits for them.
      if (controller.video?.paused) return
      setLeft((n) => n - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [counting, controller])

  useEffect(() => {
    if (counting && left <= 0) onPlay()
  }, [counting, left, onPlay])

  if (!due || dismissed || panel) return null
  return (
    <aside className={s.upNext} data-lifted={lifted ? '' : undefined} aria-label="Up Next">
      <button className={s.upNextStill} onClick={onPlay} onMouseDown={keepFocus} aria-label="Play Next Episode Now">
        <span className={s.upNextFrame}>
          <Plate
            className={s.upNextPlate}
            shape="still"
            artPath={next.still ?? fallbackStill}
            artKind={next.still ? 'still' : 'backdrop'}
            sizes="148px"
            stripSize="still"
            hideStrip
            progress={counting ? left / countdownFrom : undefined}
            print={counting ? [{ key: `${left}s` }] : undefined}
          />
          <span className={s.upNextPlay}>
            <Icon name="play" size={14} />
          </span>
        </span>
      </button>
      <div className={s.upNextText}>
        <span className={s.upNextLabel} aria-live="polite">
          {counting ? `Up Next · ${left}s` : 'Up Next'}
        </span>
        <span className={s.upNextName}>{next.name}</span>
        <span className={s.upNextMeta}>
          Season {next.season}, Episode {next.number}
        </span>
        <button className={s.upNextCancel} onClick={() => setDismissed(true)} onMouseDown={keepFocus}>
          {counting ? 'Cancel' : 'Not Now'}
        </button>
      </div>
    </aside>
  )
}
