import { useEffect, useRef } from 'react'
import { usePlayer, type PlayerController } from './controller'
import { clock } from './format'
import { SeekPreview, type SeekPreviewHandle } from './SeekPreview'
import s from './Controls.module.css'

/** Apple TV–style scrubber: a hairline that thickens under the pointer. It paints itself from the
 *  video on each animation frame while the controls show, writing straight to the DOM, so playback
 *  never re-renders React. Over the bar (and while dragging) a small frame shows where you would land
 *  (SeekPreview). Dragging moves the time at once; the real seek happens on release. Where there is no
 *  preview picture (a phone playing a plain file, say) the video itself follows a drag a few times a second. */
export function Scrubber({ controller }: { controller: PlayerController }) {
  const visible = usePlayer(controller, (st) => st.controls)
  const track = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const buffer = useRef<HTMLDivElement>(null)
  const elapsed = useRef<HTMLSpanElement>(null)
  const remaining = useRef<HTMLSpanElement>(null)
  const preview = useRef<SeekPreviewHandle>(null)
  const peeking = useRef(0)
  const drag = useRef<number | null>(null)
  const last = useRef({ t: -1, d: -1, b: -1, second: -1 })

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
    if (t === prev.t && d === prev.d && b === prev.b) return
    const known = !Number.isNaN(d)
    fill.current!.style.transform = `scaleX(${known ? Math.min(1, t / d) : 0})`
    buffer.current!.style.transform = `scaleX(${known ? Math.min(1, b / d) : 0})`
    const second = Math.floor(t)
    if (second !== prev.second || d !== prev.d) {
      elapsed.current!.textContent = clock(t)
      remaining.current!.textContent = known ? `-${clock(Math.max(0, d - t))}` : '--:--'
      track.current!.setAttribute('aria-valuetext', known ? `${clock(t)} of ${clock(d)}` : clock(t))
      track.current!.setAttribute('aria-valuenow', String(second))
      if (known) track.current!.setAttribute('aria-valuemax', String(Math.floor(d)))
    }
    last.current = { t, d, b, second }
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

  // The arrow keys seek from outside the scrubber: the frame shows where they landed, for a moment.
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

  return (
    <div className={s.scrubber}>
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
        <div className={s.rail}>
          <div ref={buffer} className={s.buffered} />
          <div ref={fill} className={s.played} />
        </div>
        <SeekPreview controller={controller} ref={preview} />
      </div>
      <div className={s.times}>
        <span ref={elapsed}>0:00</span>
        <span ref={remaining}>--:--</span>
      </div>
    </div>
  )
}
