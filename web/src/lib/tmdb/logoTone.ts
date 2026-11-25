/* Whether a logo is light or dark, so Home's lead can keep it readable on the page's colour. TMDB's wordmarks are made for
   dark screens (most are white), and some for light ones (black); over a paper-coloured fade one of them would vanish. The
   lead flips the lightness of a plain white or plain black one that would (CSS: invert with a hue turn), and leaves the rest
   as they are. A coloured logo (Breaking Bad's green tiles) keeps its colours, with a soft shadow behind it for legibility
   over bright artwork, because flipping it turns the tiles mint and the letters black. */

export type Tone = 'light' | 'dark' | 'mid' | 'color'

/** Chroma (max minus min channel, 0 to 1) above which a pixel counts as coloured, and the share of the opaque part that
 *  must be coloured before the logo is. A little of it is anti-aliasing and compression noise, so the share is not zero. */
const COLOURED = 0.25
const COLOURED_SHARE = 0.12

/** The tone of the opaque part of an image, as RGBA bytes: each pixel weighted by how opaque it is, so the transparent
 *  surround doesn't count. 'color' when enough of it is saturated (white lettering on a coloured tile still is). Otherwise
 *  a mean luminance above 0.5 is a light logo, below 0.3 a dark one, between them neither. */
export function toneOf(rgba: ArrayLike<number>): Tone {
  let weight = 0
  let sum = 0
  let coloured = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255
    if (a < 0.1) continue
    const r = rgba[i]!
    const g = rgba[i + 1]!
    const b = rgba[i + 2]!
    weight += a
    sum += a * (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 > COLOURED) coloured += a
  }
  if (weight === 0) return 'mid'
  if (coloured / weight > COLOURED_SHARE) return 'color'
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
