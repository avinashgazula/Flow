import { useImperativeHandle, useRef, type Ref } from 'react'
import type { PlayerController } from './controller'
import type { Engine } from './engine'
import { clock } from './format'
import { DEFAULT_ASPECT, type PreviewSource, type PreviewState } from './preview'
import s from './SeekPreview.module.css'

export interface SeekPreviewHandle {
  /** Shows the frame (or just the time) for `time`, centred at `x` px along a track `width` px wide, kept inside it. */
  show(time: number, x: number, width: number): void
  hide(): void
  /** A picture is on offer for this stream, so the real video needn't chase a dragged pointer. */
  readonly live: boolean
}

/** How long a picture may take before the old one is dimmed: pictures from the cache come in a frame, and dimming for those would flicker. */
const DIM_AFTER_MS = 120

/** The small frame above the scrubber: a picture of where you would land, with the time under it on a
 *  strip, like a frame of film with its edge print. Where there is no picture (the browser can't make
 *  one, or the stream's engine can't) it is the time alone. It never takes a click, and it is moved and
 *  filled by writing to the DOM, like the scrubber, so hovering never re-renders React. */
export function SeekPreview({ controller, ref }: { controller: PlayerController; ref: Ref<SeekPreviewHandle> }) {
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const reel = useRef<HTMLSpanElement>(null)
  const mine = useRef<{ engine: Engine | null; source: PreviewSource | null; state: PreviewState; dim: number }>({ engine: null, source: null, state: 'loading', dim: 0 })

  useImperativeHandle(
    ref,
    () => {
      const m = mine.current
      // Until the right picture is in, the last one stays, dimmed: after a moment, so pictures that come in a frame (the cache) don't flicker.
      const dim = (el: HTMLElement) => {
        clearTimeout(m.dim)
        m.dim = window.setTimeout(() => m.state !== 'none' && (el.dataset.state = 'loading'), DIM_AFTER_MS)
      }
      const report = (state: PreviewState, aspect?: number) => {
        const el = root.current
        if (!el) return
        if (aspect && Number.isFinite(aspect)) el.style.setProperty('--preview-aspect', String(Math.min(2.4, Math.max(1, aspect))))
        m.state = state
        if (state === 'loading') {
          if (el.dataset.state === 'ready') dim(el)
          else el.dataset.state = 'loading'
          return
        }
        clearTimeout(m.dim)
        el.dataset.state = state
        el.dataset.mode = state === 'none' ? 'time' : 'frame'
      }
      /** The engine's source, made the first time it is wanted and again if the engine changes (another source was picked). */
      const source = () => {
        const engine = controller.engine
        if (engine !== m.engine) {
          m.engine = engine
          m.source = engine?.preview?.() ?? null
          m.state = 'loading'
          frame.current?.replaceChildren()
          if (root.current) root.current.dataset.state = 'loading'
          if (m.source) m.source.attach(frame.current!, report)
        }
        return m.source
      }
      return {
        show(time, x, width) {
          const el = root.current
          if (!el || !label.current) return
          const src = source()
          label.current.textContent = clock(time)
          // The strip's perforations show how far into the film that is, as they do on every frame.
          const d = controller.duration()
          reel.current?.style.setProperty('--p', String(Number.isNaN(d) || d <= 0 ? 0 : Math.min(1, Math.max(0, time / d))))
          if (src && m.state !== 'none') {
            el.dataset.mode = 'frame'
            if (el.dataset.state === 'ready') dim(el)
            src.show(time)
          } else el.dataset.mode = 'time'
          // Kept inside the track, which runs to the player's margins, so the frame never leaves the screen.
          const half = el.offsetWidth / 2
          el.style.transform = `translateX(${Math.min(width - half, Math.max(half, x)) - half}px)`
          el.dataset.on = ''
        },
        hide() {
          clearTimeout(m.dim)
          m.source?.idle()
          if (root.current) delete root.current.dataset.on
        },
        get live() {
          return !!source() && m.state !== 'none'
        },
      }
    },
    [controller],
  )

  return (
    <div ref={root} className={s.preview} style={{ '--preview-aspect': DEFAULT_ASPECT } as React.CSSProperties} aria-hidden="true" data-mode="time">
      <div className={s.card}>
        <div ref={frame} className={s.frame} />
        <div className={s.strip}>
          <span className={s.perfs} aria-hidden="true">
            <span ref={reel} className={s.watched} />
          </span>
          <span ref={label} className={s.time}>
            0:00
          </span>
        </div>
      </div>
    </div>
  )
}
