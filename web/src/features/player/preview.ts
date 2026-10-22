/* Where the seek preview's pictures come from. Each kind of source fills an element the preview frame
   gives it and says whether what it shows is for the time asked: decoded keyframes from the Matroska
   reader, a second hidden <video> for files the browser plays itself, or the tiles a Jellyfin server
   already made. They are created the first time the scrubber is hovered, never before, and go with
   the engine. The scrubber and its frame (SeekPreview.tsx) don't know which is which. */

import type { RemuxSession } from '../../lib/remux'
import { trickplayCell } from '../../lib/sources/trickplay'
import type { Trickplay } from '../../lib/sources'

/** `ready`: the picture is for the time asked. `loading`: it is for an earlier time (or there is none yet). `none`: this source can't give one. */
export type PreviewState = 'ready' | 'loading' | 'none'

export interface PreviewSource {
  /** The source fills `host` (a canvas, a video, a div) and calls `report` as its picture changes; `aspect` is width over height once known. */
  attach(host: HTMLElement, report: (state: PreviewState, aspect?: number) => void): void
  /** The pointer is at `time` seconds. Cheap to call on every move: sources do their own throttling. */
  show(time: number): void
  /** The pointer has left; pending work can stop. */
  idle(): void
  destroy(): void
}

/** At most this often a request is sent for a moving pointer. */
const SEND_EVERY_MS = 50

/** Runs `fn` now, then at most once per `ms` with the latest value (the last call always runs). */
function throttled<T>(ms: number, fn: (value: T) => void) {
  let last = -Infinity
  let timer = 0
  let latest: T
  return {
    call(value: T) {
      latest = value
      const wait = ms - (performance.now() - last)
      if (wait <= 0) {
        clearTimeout(timer)
        timer = 0
        last = performance.now()
        fn(value)
      } else if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0
          last = performance.now()
          fn(latest)
        }, wait)
      }
    },
    cancel() {
      clearTimeout(timer)
      timer = 0
    },
  }
}

// MARK: Matroska

/** Keyframes the remux worker decodes (see lib/remux/thumbs.ts), drawn on a canvas. A picture that
 *  arrives for an earlier position than the pointer's stays up, marked `loading`, until the right one comes. */
export class BitmapPreview implements PreviewSource {
  private canvas: HTMLCanvasElement | null = null
  private context: CanvasRenderingContext2D | null = null
  private report: (state: PreviewState, aspect?: number) => void = () => {}
  /** Counts the pointer's moves, so a picture is only `ready` if no newer position has been asked for since its request. */
  private wanted = 0
  private destroyed = false
  private pending = throttled(SEND_EVERY_MS, (time: number) => this.request(time))

  constructor(
    private session: RemuxSession,
    /** The picture's shape, from the file's header, so the frame is the right size before any picture arrives. */
    private aspect?: number,
  ) {}

  attach(host: HTMLElement, report: (state: PreviewState, aspect?: number) => void) {
    this.report = report
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = Math.round(320 / (this.aspect ?? 16 / 9))
    host.replaceChildren(canvas)
    this.canvas = canvas
    this.context = canvas.getContext('2d', { alpha: false })
    report('loading', this.aspect)
  }

  show(time: number) {
    if (this.session.thumbnailsSupported === false) return this.report('none')
    this.wanted++
    this.pending.call(time)
  }

  private request(time: number) {
    const id = this.wanted
    void this.session.thumbnail(time).then((thumb) => {
      if (this.destroyed) return thumb?.bitmap.close()
      if (!thumb) {
        if (this.session.thumbnailsSupported === false) this.report('none')
        return
      }
      const { canvas, context } = this
      if (canvas && context) {
        if (canvas.width !== thumb.bitmap.width || canvas.height !== thumb.bitmap.height) {
          canvas.width = thumb.bitmap.width
          canvas.height = thumb.bitmap.height
        }
        context.drawImage(thumb.bitmap, 0, 0)
      }
      thumb.bitmap.close()
      this.report(id === this.wanted ? 'ready' : 'loading', thumb.bitmap.width / thumb.bitmap.height)
    })
  }

  idle() {
    this.pending.cancel()
  }

  destroy() {
    this.destroyed = true
    this.pending.cancel()
  }
}

// MARK: The browser's own player

/** Phones and data savers don't get a second copy of the file loading. */
export function canPreviewWithVideo(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return false
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
  return !phone
}

/** A second, muted <video> with the same address that is only ever seeked, shown in the frame. Showing the
 *  element itself needs no CORS from the host, which drawing it to a canvas would. */
export class VideoPreview implements PreviewSource {
  private video: HTMLVideoElement | null = null
  private report: (state: PreviewState, aspect?: number) => void = () => {}
  private wanted = 0
  private pending = throttled(120, (time: number) => this.seek(time))

  constructor(private src: string) {}

  attach(host: HTMLElement, report: (state: PreviewState, aspect?: number) => void) {
    this.report = report
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.disablePictureInPicture = true
    video.disableRemotePlayback = true
    video.tabIndex = -1
    video.setAttribute('aria-hidden', 'true')
    const aspect = () => (video.videoWidth > 0 ? video.videoWidth / video.videoHeight : undefined)
    video.addEventListener('loadedmetadata', () => this.report('loading', aspect()))
    video.addEventListener('seeked', () => this.report(Math.abs(video.currentTime - this.wanted) < 0.5 || video.currentTime === this.wanted ? 'ready' : 'loading', aspect()))
    video.addEventListener('error', () => this.report('none'))
    video.src = this.src
    host.replaceChildren(video)
    this.video = video
    report('loading')
  }

  show(time: number) {
    this.wanted = time
    this.pending.call(time)
  }

  private seek(time: number) {
    const video = this.video
    if (!video || video.readyState < 1) {
      // Metadata isn't in yet: seek as soon as it is.
      video?.addEventListener('loadedmetadata', () => this.seek(this.wanted), { once: true })
      return
    }
    if (Math.abs(video.currentTime - time) < 0.05 && !video.seeking) return this.report('ready')
    this.report('loading')
    // Safari's fastSeek lands on a keyframe, which is quick and close enough for a thumbnail.
    const v = video as HTMLVideoElement & { fastSeek?: (t: number) => void }
    if (v.fastSeek) v.fastSeek(time)
    else video.currentTime = time
  }

  idle() {
    this.pending.cancel()
  }

  destroy() {
    this.pending.cancel()
    const video = this.video
    if (!video) return
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
    this.video = null
  }
}

// MARK: Server tiles

/** The grids of small pictures a Jellyfin server made: one element whose background is the tile, moved to the right cell. */
export class TilePreview implements PreviewSource {
  private box: HTMLElement | null = null
  private report: (state: PreviewState, aspect?: number) => void = () => {}
  private loaded = new Set<number>()
  private wanted = -1

  constructor(private tiles: Trickplay) {}

  attach(host: HTMLElement, report: (state: PreviewState, aspect?: number) => void) {
    this.report = report
    const box = document.createElement('div')
    box.style.backgroundRepeat = 'no-repeat'
    host.replaceChildren(box)
    this.box = box
    report('loading', this.tiles.width / this.tiles.height)
  }

  show(time: number) {
    const box = this.box
    if (!box) return
    const { tile, column, row } = trickplayCell(this.tiles, time)
    this.wanted = tile
    // The tile is scaled so one picture fills the box exactly; its cell is then a whole number of box widths in.
    const place = () => {
      const t = this.tiles
      const scale = (box.clientWidth || t.width) / t.width
      box.style.backgroundImage = `url("${this.address(tile)}")`
      box.style.backgroundSize = `${t.width * t.columns * scale}px ${t.height * t.rows * scale}px`
      box.style.backgroundPosition = `${-column * t.width * scale}px ${-row * t.height * scale}px`
      this.report('ready')
    }
    if (this.loaded.has(tile)) return place()
    // The old picture stays (dimmed) until the new tile is in; moving it now would show the wrong cell.
    this.report('loading')
    const image = new Image()
    image.onload = () => {
      this.loaded.add(tile)
      if (this.wanted === tile && this.box) place()
    }
    image.onerror = () => {
      if (this.wanted === tile) this.report('none')
    }
    image.src = this.address(tile)
  }

  private address(tile: number) {
    return this.tiles.url.replace('{n}', String(tile))
  }

  idle() {}

  destroy() {
    this.box?.remove()
    this.box = null
  }
}

/** The aspect a frame takes before its picture says: 16:9. */
export const DEFAULT_ASPECT = 16 / 9
