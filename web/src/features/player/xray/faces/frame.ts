import { fits, type Frame } from './geometry'

/** The longest side of the picture handed to the recogniser, which is a 1080p picture as it is. The detector looks at a copy
 *  scaled to 640, and each face's print is made from these pixels, so a face in a crowd, 40 pixels across in the picture,
 *  keeps the detail it has. Reading a frame this size costs a few milliseconds. */
export const frameSide = 1920

export type Grab = { frame: Frame } | { problem: 'not-ready' | 'unreadable' }

/** The picture on screen right now, as pixels. A video from another address that doesn't say it may be read taints the canvas
 *  it is drawn on, and the browser then refuses the pixels: that is `unreadable`, and nothing here can change it. */
export function grabFrame(video: HTMLVideoElement, maxSide = frameSide): Grab {
  // HAVE_CURRENT_DATA: there is a picture to draw.
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return { problem: 'not-ready' }
  const { width, height } = fits(video.videoWidth, video.videoHeight, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { problem: 'unreadable' }
  try {
    context.drawImage(video, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    return { frame: { data, width, height } }
  } catch {
    // A SecurityError for a tainted canvas; any other failure means the same to the viewer.
    return { problem: 'unreadable' }
  }
}
