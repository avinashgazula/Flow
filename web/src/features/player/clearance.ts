/* What a panel takes from the subtitles. A panel stands either beside the picture (the subtitle line keeps to the room
   next to it) or over its lower part (the line rides just above it). Player.module.css does that for the text
   subtitles; this is the same decision as numbers, for the picture subtitles (pictureLayout.ts), which are bitmaps on a
   canvas and so can't be styled. The breakpoints are the stylesheet's. Pure, so it is tested without a browser. */

/** Which panel it is: Options and Audio and Subtitles, X-Ray, the season's episodes, or Playback Info. */
export type ClearKind = 'panel' | 'xray' | 'shelf' | 'info'

export interface Clearance {
  kind: ClearKind
  /** The panel's width, and the height from the window's bottom edge to its top, in pixels. */
  width: number
  room: number
}

/** The room to leave free: along the window's right edge, and along its bottom edge. One of them is 0. */
export interface Take {
  right: number
  bottom: number
}

const none: Take = { right: 0, bottom: 0 }

/** The side margin the controls keep from the window's edge, as `--margin` is in Player.module.css. */
export const sideMargin = (window: { width: number; height: number }) => (window.width <= 720 || window.height <= 500 ? 16 : 28)

/** What all the panels that are up take together: the most along each edge. */
export function takeAll(clearances: Iterable<Clearance>, window: { width: number; height: number }, styling = false): Take {
  let right = 0
  let bottom = 0
  for (const c of clearances) {
    const take = takeOf(c, window, styling)
    right = Math.max(right, take.right)
    bottom = Math.max(bottom, take.bottom)
  }
  return { right, bottom }
}

export function takeOf(clearance: Clearance | null, window: { width: number; height: number }, styling = false): Take {
  if (!clearance) return none
  const beside = { right: clearance.width + sideMargin(window) + 24, bottom: 0 }
  const above = { right: 0, bottom: clearance.room + 12 }
  const short = window.height <= 500
  switch (clearance.kind) {
    case 'xray':
      return window.width >= 721 || short ? beside : above
    case 'panel':
      if (window.width >= 900 || short) return beside
      // Subtitle Style and Delay hang from the top of a narrow window, so the line they change has the room below.
      return styling ? none : above
    case 'shelf':
      return above
    case 'info':
      // Playback Info hangs from the top, so it only reaches the line in a short window, where it stands on the right.
      return short ? beside : none
  }
}
