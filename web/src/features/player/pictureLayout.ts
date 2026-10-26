/* Where a picture subtitle's bitmaps land on screen. A disc draws its subtitles on a canvas the size of its
   video (1920 by 1080; 720 by 480 on a DVD), and the player lays that canvas over the picture the way the apps
   do (BitmapSubtitleView): the canvas spans the picture's width, and sits centred on it vertically, so a 2.40:1
   picture inside a 16:9 canvas keeps its subtitles where the disc put them. Pure, so it is tested without a
   browser. */

import type { PictureCue, PictureObject } from '../../lib/remux/pictures'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface VideoShape {
  width: number
  height: number
  displayWidth?: number
  displayHeight?: number
}

/** The picture's shown size, and how much wider than its coded width that is (above 1 for anamorphic DVD video,
 *  whose subtitle canvas is stretched sideways along with the picture). */
export function shownShape(video: VideoShape | undefined, canvas: { width: number; height: number }): { width: number; height: number; pixelAspect: number } {
  if (!video || video.width <= 0 || video.height <= 0) return { width: canvas.width, height: canvas.height, pixelAspect: 1 }
  if (video.displayWidth && video.displayHeight && video.displayWidth > 0 && video.displayHeight > 0) {
    const width = (video.height * video.displayWidth) / video.displayHeight
    return { width, height: video.height, pixelAspect: width / video.width }
  }
  return { width: video.width, height: video.height, pixelAspect: 1 }
}

/** The part of a container the picture covers: all of it fitted inside (`contain`) or filling it (`cover`). */
export function pictureBox(container: { width: number; height: number }, shape: { width: number; height: number }, fit: 'contain' | 'cover'): Box {
  if (shape.width <= 0 || shape.height <= 0) return { x: 0, y: 0, width: container.width, height: container.height }
  const ratio = (fit === 'cover' ? Math.max : Math.min)(container.width / shape.width, container.height / shape.height)
  const width = shape.width * ratio
  const height = shape.height * ratio
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height }
}

/** Each of the cue's objects as a box in the container, in the cue's order. */
export function placeObjects(cue: PictureCue, container: { width: number; height: number }, video: VideoShape | undefined, fit: 'contain' | 'cover'): Box[] {
  const canvas = { width: cue.canvasWidth || 1, height: cue.canvasHeight || 1 }
  const shape = shownShape(video, canvas)
  const box = pictureBox(container, shape, fit)
  const scaleX = box.width / canvas.width
  const scaleY = scaleX / Math.max(shape.pixelAspect, 0.1)
  const originY = box.y + box.height / 2 - (canvas.height * scaleY) / 2
  return cue.objects.map((o) => ({ x: box.x + o.x * scaleX, y: originY + o.y * scaleY, width: o.width * scaleX, height: o.height * scaleY }))
}

/** True when the cue sits in the upper half of the canvas (signs and titles), which the controls and the viewer's
 *  subtitle position (both about the lower edge) leave where it is. */
export function sitsHigh(cue: PictureCue): boolean {
  if (cue.objects.length === 0) return false
  const top = Math.min(...cue.objects.map((o) => o.y))
  const bottom = Math.max(...cue.objects.map((o) => o.y + o.height))
  return (top + bottom) / 2 < cue.canvasHeight / 2
}

/** How far to raise the canvas, in pixels. The viewer's subtitle position raises a line by a fraction of the window's height
 *  (`user`); with the controls up (`controls` is the band they cover, 0 when they are away) a line that would sit in that
 *  band is raised just clear of it, and one already above it stays. The text subtitles are always at the bottom of the
 *  window, so they take the whole band; a bitmap sits where the disc drew it, which in a tall window (a phone held
 *  upright) can be well above the band. A subtitle in the upper half of the picture isn't raised at all. */
export function liftFor({ container, bottom, controls, user, high }: { container: number; bottom: number; controls: number; user: number; high: boolean }): number {
  if (high) return 0
  return Math.max(0, user * container, controls - (container - bottom))
}

/** The pixels of one object as straight RGBA, for `ImageData`. Indices past the palette are transparent. */
export function rgbaOf(object: PictureObject, palette: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(object.width * object.height * 4)
  const { indices } = object
  for (let i = 0; i < indices.length; i++) {
    const from = indices[i]! * 4
    if (from + 3 >= palette.length) continue
    out[i * 4] = palette[from]!
    out[i * 4 + 1] = palette[from + 1]!
    out[i * 4 + 2] = palette[from + 2]!
    out[i * 4 + 3] = palette[from + 3]!
  }
  return out
}
