import { useEffect, useRef, useState } from 'react'
import { Plate } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import type { Episode } from '../../lib/tmdb/types'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import { creditsStart } from './segments'
import s from './Controls.module.css'

const countdownFrom = 10
/** How close to the end the card comes up, without a credits segment to go on. */
const tail = 30

/** When the card comes up for an episode `duration` long: as the credits begin when a segment says where, else
 *  in the last 30 seconds. Undefined while the length isn't known (or is too short for either). */
export function upNextDueAt(duration: number, creditsAt: number | undefined): number | undefined {
  if (Number.isNaN(duration)) return undefined
  if (creditsAt !== undefined) return duration > tail ? creditsAt : undefined
  return duration > 60 ? duration - tail : undefined
}

/** The next episode's still and name, with a "Next Episode" button and a strip whose perforations empty as the
 *  countdown runs. It comes up as the credits begin (or in the last 30 seconds), and goes on by itself when the
 *  countdown ends, which `onPlay(true)` says. It watches the clock itself and re-renders only when it comes or
 *  goes, and once a second while counting down. */
export function UpNext({ controller, next, autoplay, fallbackStill, onPlay }: { controller: PlayerController; next: Episode; autoplay: boolean; fallbackStill?: string; onPlay: (automatic: boolean) => void }) {
  const segments = usePlayer(controller, (st) => st.segments)
  const segmentsRef = useRef(segments)
  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])
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
      const at = upNextDueAt(d, creditsStart(segmentsRef.current, d))
      const now = at !== undefined && video.currentTime >= at
      if (now !== dueRef.current) {
        dueRef.current = now
        setDue(now)
        if (!now) setLeft(countdownFrom)
      }
    }
    const ended = () => {
      if (autoplay && !dismissed) onPlay(true)
    }
    check()
    video.addEventListener('timeupdate', check)
    video.addEventListener('seeked', check)
    video.addEventListener('ended', ended)
    return () => {
      video.removeEventListener('timeupdate', check)
      video.removeEventListener('seeked', check)
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
    if (counting && left <= 0) onPlay(true)
  }, [counting, left, onPlay])

  const shown = due && !dismissed && !panel
  // The Skip button leaves this corner to the card, and Enter and S play the next episode.
  useEffect(() => {
    controller.setUpNextShown(shown)
    return () => controller.setUpNextShown(false)
  }, [controller, shown])
  useEffect(() => {
    if (!shown) return
    controller.registerSkip('upNext', () => onPlay(false))
    return () => controller.registerSkip('upNext', null)
  }, [controller, shown, onPlay])

  if (!shown) return null
  return (
    <aside className={s.upNext} data-lifted={lifted ? '' : undefined} aria-label="Up Next">
      <button className={s.upNextStill} onClick={() => onPlay(false)} onMouseDown={keepFocus} tabIndex={-1} aria-hidden="true">
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
        <div className={s.upNextActions}>
          <button className="btn btn-primary btn-compact" onClick={() => onPlay(false)} onMouseDown={keepFocus}>
            Next Episode
          </button>
          <button className={s.upNextCancel} onClick={() => setDismissed(true)} onMouseDown={keepFocus}>
            {counting ? 'Cancel' : 'Not Now'}
          </button>
        </div>
      </div>
    </aside>
  )
}
