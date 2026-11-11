import { useEffect, useRef, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import { PlayerIcon } from './playerIcons'
import type { Episode } from '../../lib/tmdb/types'
import { useSettings } from '../../lib/store/settings'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import { playbackPreferences } from './preferences'
import { creditsStart } from './segments'
import s from './Controls.module.css'

/** The countdown's length when Settings don't say (the apps' `nextEpisodeCountdownSeconds`). */
const defaultCountdown = 10
/** How close to the end the card comes up, without a credits segment to go on. */
const tail = 30

/** When the card comes up for an episode `duration` long: as the credits begin when a segment says where, else
 *  in the last 30 seconds. With `waitsForEnd` ("Wait for the Episode to End") it comes up just early enough for
 *  its countdown (`countdown` seconds) to finish as the episode does, whatever the credits say. Without credits, a
 *  countdown longer than the last 30 seconds starts early enough to run out as the episode does. Undefined while the
 *  length isn't known (or is too short for any of these). */
export function upNextDueAt(duration: number, creditsAt: number | undefined, waitsForEnd = false, countdown = defaultCountdown): number | undefined {
  if (Number.isNaN(duration)) return undefined
  if (waitsForEnd) return duration > tail ? duration - countdown - 1 : undefined
  if (creditsAt !== undefined) return duration > tail ? creditsAt : undefined
  return duration > 60 ? duration - Math.max(tail, countdown) : undefined
}

/** The seconds on the countdown when it runs to the end of the episode: what is left of it, never more than the
 *  countdown's length. It is read from the picture's clock, so it ends with the episode however playback goes
 *  (paused, slowed down, skipped about). */
export const secondsToEnd = (duration: number, time: number, countdown = defaultCountdown): number => Math.max(0, Math.min(countdown, Math.ceil(duration - time)))

/** The next episode's still and name, with a "Next Episode" button and a thin line that empties as the
 *  countdown runs, with "Starts in 9s" in words. It comes up as the credits begin (or in the last 30 seconds), and goes on by itself when the
 *  countdown ends, which `onPlay(true)` says. With Wait for the Episode to End the countdown is the last seconds
 *  of the episode itself. It watches the clock itself and re-renders only when it comes or goes, and once a
 *  second while counting down. The sleep timer's "end of episode" lets the episode finish instead of going on. */
export function UpNext({ controller, next, autoplay, fallbackStill, onPlay }: { controller: PlayerController; next: Episode; autoplay: boolean; fallbackStill?: string; onPlay: (automatic: boolean) => void }) {
  const segments = usePlayer(controller, (st) => st.segments)
  const waits = useSettings((st) => st.upNextWaitsForEnd)
  const countdownFrom = useSettings((st) => playbackPreferences(st).countdown)
  const countdownRef = useRef(countdownFrom)
  useEffect(() => {
    countdownRef.current = countdownFrom
  }, [countdownFrom])
  const sleeping = usePlayer(controller, (st) => st.sleep === 'end')
  const waitsRef = useRef(waits)
  useEffect(() => {
    waitsRef.current = waits
  }, [waits])
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
      const at = upNextDueAt(d, creditsStart(segmentsRef.current, d), waitsRef.current, countdownRef.current)
      const now = at !== undefined && video.currentTime >= at
      if (now !== dueRef.current) {
        dueRef.current = now
        setDue(now)
        if (!now) setLeft(countdownRef.current)
      }
      // Running to the end of the episode, the count is what is left of it.
      if (now && waitsRef.current) setLeft(secondsToEnd(d, video.currentTime, countdownRef.current))
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

  const counting = due && autoplay && !dismissed && !sleeping
  // The count ticks by itself only when it isn't the episode's own last seconds.
  const ticking = counting && !waits
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => {
      // Paused means the viewer is doing something; the countdown waits for them.
      if (controller.video?.paused) return
      setLeft((n) => n - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [ticking, controller])

  useEffect(() => {
    if (ticking && left <= 0) onPlay(true)
  }, [ticking, left, onPlay])

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
    <aside className={s.upNext} data-lifted={lifted ? '' : undefined} aria-label={counting ? `Up Next, starting in ${left} seconds` : 'Up Next'}>
      <button className={s.upNextStill} onClick={() => onPlay(false)} onMouseDown={keepFocus} tabIndex={-1} aria-hidden="true">
        <span className={s.upNextFrame}>
          <Artwork className={`${s.still} ${s.upNextPlate}`} path={next.still ?? fallbackStill} kind={next.still ? 'still' : 'backdrop'} alt="" sizes="148px" />
          <span className={s.upNextPlay}>
            <PlayerIcon name="play" size={14} />
          </span>
          {counting && (
            <span className={s.upNextLine} aria-hidden="true">
              <span style={{ '--left': Math.max(0, left - 1) / countdownFrom } as React.CSSProperties} />
            </span>
          )}
        </span>
      </button>
      <div className={s.upNextText}>
        <span className={s.upNextName}>{next.name}</span>
        <span className={s.upNextMeta}>
          {counting ? `Starts in ${left}s` : `Season ${next.season}, Episode ${next.number}`}
        </span>
        <div className={s.upNextActions}>
          <button className={`btn btn-primary btn-compact ${s.skipButton}`} onClick={() => onPlay(false)} onMouseDown={keepFocus}>
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
