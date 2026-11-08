import { useEffect, useId, useRef } from 'react'
import { usePlayer, type PlayerController } from './controller'
import { endTime, formatClock, userLocale } from '../../lib/time'
import { chapterAt, chapterTitle } from './chapters'
import { clock, endLabel } from './format'
import { gapFractions, gapMask, otherMode, type TimeMode } from './scrubberLayout'
import { SeekPreview, type SeekPreviewHandle } from './SeekPreview'
import s from './Controls.module.css'

const modeKey = 'flow.player.timeMode'
const savedMode = (): TimeMode => {
  try {
    return localStorage.getItem(modeKey) === 'total' ? 'total' : 'remaining'
  } catch {
    return 'remaining'
  }
}

/** The progress bar: one track with the time played to its left and the time left to its right (a tap on that one
 *  swaps it for the whole length). Chapters and skippable segments are small gaps in the track. It paints itself from the
 *  video on each animation frame while the controls show, writing straight to the DOM, so playback
 *  never re-renders React. Over the bar (and while dragging) a small tooltip shows where you would land
 *  (SeekPreview). Dragging moves the time at once; the real seek happens on release. Where there is no
 *  preview picture (a phone playing a plain file, say) the video itself follows a drag a few times a second. */
export function Scrubber({ controller }: { controller: PlayerController }) {
  const swapHint = useId()
  const visible = usePlayer(controller, (st) => st.controls)
  const segments = usePlayer(controller, (st) => st.segments)
  const chapters = usePlayer(controller, (st) => st.chapters)
  // The paint loop below is set up once per showing of the controls, so it reads these from here.
  const chaptersNow = useRef(chapters)
  chaptersNow.current = chapters
  const segmentsNow = useRef(segments)
  segmentsNow.current = segments
  const track = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const buffer = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const ends = useRef<HTMLSpanElement>(null)
  const elapsed = useRef<HTMLSpanElement>(null)
  const remaining = useRef<HTMLButtonElement>(null)
  const preview = useRef<SeekPreviewHandle>(null)
  const peeking = useRef(0)
  const drag = useRef<number | null>(null)
  const mode = useRef<TimeMode>(savedMode())
  const last = useRef({ t: -1, d: -1, b: -1, second: -1, minute: -1 })

  /** Cuts the track where chapters and segments begin and end, once the length is known. */
  const placeGaps = (d: number) => {
    const mask = gapMask(gapFractions(chaptersNow.current, segmentsNow.current, d)) ?? ''
    if (!rail.current) return
    rail.current.style.maskImage = mask
    rail.current.style.webkitMaskImage = mask
  }
  useEffect(() => {
    placeGaps(controller.duration())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, chapters])

  const paint = () => {
    const video = controller.video
    const t = drag.current ?? controller.currentTime()
    const d = controller.duration()
    let b = 0
    if (video) {
      const ranges = video.buffered
      for (let i = 0; i < ranges.length; i++) if (ranges.start(i) <= t + 0.5 && ranges.end(i) >= t) b = ranges.end(i)
    }
    const prev = last.current
    // The end time moves on with the clock even when the picture doesn't (paused), so the minute counts too.
    const minute = Math.floor(Date.now() / 60_000)
    if (t === prev.t && d === prev.d && b === prev.b && minute === prev.minute) return
    const known = !Number.isNaN(d)
    if (d !== prev.d) placeGaps(d)
    const played = known ? Math.min(1, t / d) : 0
    fill.current!.style.transform = `scaleX(${played})`
    thumb.current!.style.left = `${played * 100}%`
    buffer.current!.style.transform = `scaleX(${known ? Math.min(1, b / d) : 0})`
    const second = Math.floor(t)
    if (second !== prev.second || d !== prev.d || minute !== prev.minute) {
      elapsed.current!.textContent = clock(t)
      remaining.current!.textContent = endLabel(mode.current, t, d)
      ends.current!.textContent = known ? `Ends ${formatClock(endTime(Date.now(), d - t), userLocale)}` : ''
      const list = chaptersNow.current
      const at = chapterAt(list, t)
      const where = at >= 0 && list.length > 1 ? `, ${chapterTitle(list[at]!, at)}` : ''
      track.current!.setAttribute('aria-valuetext', `${known ? `${clock(t)} of ${clock(d)}` : clock(t)}${where}`)
      track.current!.setAttribute('aria-valuenow', String(second))
      if (known) track.current!.setAttribute('aria-valuemax', String(Math.floor(d)))
    }
    last.current = { t, d, b, second, minute }
  }

  useEffect(() => {
    if (!visible) return
    let frame = 0
    const tick = () => {
      paint()
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const timeAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect()
    const d = controller.duration()
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)))
    return { time: Number.isNaN(d) ? 0 : fraction * d, x: fraction * box.width, width: box.width }
  }

  const showTip = (clientX: number) => {
    const { time, x, width } = timeAt(clientX)
    preview.current?.show(time, x, width)
    return time
  }

  const hideTip = () => {
    clearTimeout(peeking.current)
    preview.current?.hide()
  }

  // The arrow keys seek from outside the scrubber: the tooltip shows where they landed, for a moment.
  useEffect(
    () =>
      controller.onPeek((time) => {
        const d = controller.duration()
        if (Number.isNaN(d) || drag.current !== null) return
        const box = track.current!.getBoundingClientRect()
        preview.current?.show(time, (Math.min(1, Math.max(0, time / d))) * box.width, box.width)
        clearTimeout(peeking.current)
        peeking.current = window.setTimeout(() => preview.current?.hide(), 1400)
      }),
    [controller],
  )
  useEffect(() => () => clearTimeout(peeking.current), [])

  const swapMode = () => {
    mode.current = otherMode(mode.current)
    try {
      localStorage.setItem(modeKey, mode.current)
    } catch {
      // Private windows and blocked storage just forget the choice.
    }
    last.current = { ...last.current, second: -1 }
    paint()
  }

  return (
    <div className={s.scrubber}>
      <span ref={elapsed} className={s.time} aria-hidden="true">
        0:00
      </span>
      <div
        ref={track}
        className={s.track}
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        onPointerDown={(e) => {
          if (e.button !== 0 || Number.isNaN(controller.duration())) return
          e.currentTarget.setPointerCapture(e.pointerId)
          controller.scrubbing = true
          controller.showControls(false)
          track.current!.dataset.dragging = ''
          clearTimeout(peeking.current)
          drag.current = showTip(e.clientX)
          paint()
          if (!preview.current?.live) controller.previewSeek(drag.current)
        }}
        onPointerMove={(e) => {
          clearTimeout(peeking.current)
          const time = showTip(e.clientX)
          if (drag.current === null) return
          drag.current = time
          paint()
          if (!preview.current?.live) controller.previewSeek(time)
        }}
        onPointerUp={(e) => {
          if (drag.current === null) return
          const target = drag.current
          drag.current = null
          controller.scrubbing = false
          delete track.current!.dataset.dragging
          if (e.pointerType !== 'mouse') hideTip()
          controller.seekTo(target)
          controller.scheduleHide()
        }}
        onPointerCancel={() => {
          drag.current = null
          controller.scrubbing = false
          delete track.current!.dataset.dragging
          hideTip()
        }}
        onPointerLeave={() => {
          if (drag.current === null) hideTip()
        }}
      >
        <div ref={rail} className={s.rail}>
          <div ref={buffer} className={s.buffered} />
          <div ref={fill} className={s.played} />
        </div>
        <div ref={thumb} className={s.thumb} />
        <SeekPreview controller={controller} ref={preview} />
      </div>
      {/* The button's name is the time it shows (what a voice-control user says); what it does is its description. */}
      <button ref={remaining} type="button" className={`${s.time} ${s.timeEnd}`} onClick={swapMode} title="Switch between time left and length" aria-describedby={swapHint}>
        --:--
      </button>
      <span id={swapHint} className="sr-only">
        Switch between time left and length
      </span>
      <span ref={ends} className={s.ends} aria-hidden="true" />
    </div>
  )
}
