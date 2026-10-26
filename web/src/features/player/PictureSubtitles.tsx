import { type CSSProperties, useEffect, useRef } from 'react'
import type { PictureCue } from '../../lib/remux/pictures'
import { useSettings } from '../../lib/store/settings'
import { usePlayer, type PlayerController } from './controller'
import { placeObjects, rgbaOf, sitsHigh } from './pictureLayout'
import { subtitleCSS } from './subtitleStyle'
import s from './PictureSubtitles.module.css'

/** Picture subtitles (Blu-ray PGS, DVD VobSub) drawn on a canvas over the picture, where the disc put them
 *  (see pictureLayout.ts). The clock is read as the film plays, so a line comes and goes on its frame; the
 *  viewer's subtitle delay and position apply, as they do to text. */
export function PictureSubtitles({ controller }: { controller: PlayerController }) {
  const picture = usePlayer(controller, (st) => st.picture)
  const lifted = usePlayer(controller, (st) => st.controls)
  const delay = usePlayer(controller, (st) => st.subtitleDelay)
  const fit = usePlayer(controller, (st) => st.fit)
  const style = useSettings((st) => st.subtitleStyle)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    const video = controller.video
    const g = el?.getContext('2d')
    if (!picture || !el || !video || !g) return
    // Each cue's objects as small canvases, made once when the cue first shows.
    const bitmaps = new WeakMap<PictureCue, HTMLCanvasElement[]>()
    const bitmapsOf = (cue: PictureCue) => {
      let made = bitmaps.get(cue)
      if (!made) {
        made = cue.objects.map((o) => {
          const piece = document.createElement('canvas')
          piece.width = o.width
          piece.height = o.height
          piece.getContext('2d')?.putImageData(new ImageData(rgbaOf(o, cue.palette), o.width, o.height), 0, 0)
          return piece
        })
        bitmaps.set(cue, made)
      }
      return made
    }

    let shown: PictureCue | null | undefined
    const draw = () => {
      g.clearRect(0, 0, el.width, el.height)
      if (!shown) return
      const ratio = el.width / Math.max(1, el.clientWidth)
      const boxes = placeObjects(shown, { width: el.clientWidth, height: el.clientHeight }, picture.video, fit)
      const pieces = bitmapsOf(shown)
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      boxes.forEach((b, i) => g.drawImage(pieces[i]!, b.x * ratio, b.y * ratio, b.width * ratio, b.height * ratio))
    }
    const update = () => {
      const cue = picture.at(video.currentTime - delay)
      if (cue === shown) return
      shown = cue
      el.toggleAttribute('data-high', !!cue && sitsHigh(cue))
      draw()
    }
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      el.width = Math.max(1, Math.round(el.clientWidth * ratio))
      el.height = Math.max(1, Math.round(el.clientHeight * ratio))
      draw()
    }
    resize()
    update()
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    // While playing, every frame; otherwise once on each seek or pause.
    let frame = 0
    const loop = () => {
      update()
      frame = requestAnimationFrame(loop)
    }
    const start = () => {
      if (!frame) loop()
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      update()
    }
    const events: [string, () => void][] = [['playing', start], ['pause', stop], ['seeked', update], ['seeking', update], ['timeupdate', update]]
    for (const [name, fn] of events) video.addEventListener(name, fn)
    if (!video.paused) start()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const [name, fn] of events) video.removeEventListener(name, fn)
      g.clearRect(0, 0, el.width, el.height)
    }
  }, [controller, picture, delay, fit])

  if (!picture) return null
  return <canvas ref={canvas} className={s.canvas} style={{ '--sub-lift': subtitleCSS(style)['--sub-lift'] } as CSSProperties} data-lifted={lifted ? '' : undefined} aria-hidden="true" />
}
