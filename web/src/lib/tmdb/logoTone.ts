/* Whether a logo is light or dark, so Home's lead can keep it readable on the page's colour. TMDB's wordmarks are made for
   dark screens (most are white), and some for light ones (black); over a paper-coloured fade one of them would vanish. The
   lead flips the lightness of one that would (CSS: invert with a hue turn, so a coloured logo keeps its colours), and
   leaves alone one that already reads. */

export type Tone = 'light' | 'dark' | 'mid'

/** The brightness of the opaque part of an image, as RGBA bytes: each pixel's luminance weighted by how opaque it is, so
 *  the transparent surround doesn't count. Above 0.5 is a light logo (white lettering with a coloured tile still is), below 0.3 a dark one, between them neither. */
export function toneOf(rgba: ArrayLike<number>): Tone {
  let weight = 0
  let sum = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255
    if (a < 0.1) continue
    weight += a
    sum += a * (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255
  }
  if (weight === 0) return 'mid'
  const mean = sum / weight
  return mean > 0.5 ? 'light' : mean < 0.3 ? 'dark' : 'mid'
}

/** The tone of a loaded image (it must have been fetched with `crossOrigin`, or the canvas is tainted and this says
 *  'mid', which leaves it as it is). */
export function imageTone(img: HTMLImageElement): Tone {
  try {
    const width = 48
    const height = Math.max(1, Math.round((width * img.naturalHeight) / Math.max(1, img.naturalWidth)))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return 'mid'
    context.drawImage(img, 0, 0, width, height)
    return toneOf(context.getImageData(0, 0, width, height).data)
  } catch {
    return 'mid'
  }
}
