import type { CSSProperties } from 'react'
import { normaliseSubtitleStyle, type SubtitleColor, type SubtitleEdge, type SubtitleFont, type SubtitleStyle, type SubtitleWeight } from '../../lib/store/subtitleStyle'

/* Settings to CSS, in one place. The player's subtitles and Settings' preview both take the object
   `subtitleCSS` returns and set it on the element that holds the lines, so the two can't drift. Pure:
   nothing here reads the page, which keeps it testable. */

/** System is the site's own typeface (what subtitles have always used); the rest are the device's own
 *  faces by their generic names, so nothing downloads. */
const families: Record<SubtitleFont, string> = {
  system: 'var(--font)',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", system-ui, sans-serif',
  serif: 'ui-serif, "New York", Georgia, "Times New Roman", serif',
  monospaced: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
}

const weights: Record<SubtitleWeight, number> = { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 }

/** The apps' colours: the system's white, yellow, cyan and green. */
export const subtitleColorValues: Record<SubtitleColor, string> = { white: '#fff', yellow: '#ffd60a', cyan: '#64d2ff', green: '#30d158' }

/** The first look subtitles had here, and still the default. */
const softShadow = '0 1px 2px rgb(0 0 0 / 0.95), 0 0 6px rgb(0 0 0 / 0.55), 0 2px 14px rgb(0 0 0 / 0.35)'

/** Eight dark copies of the text around it, as the apps draw an outline. In ems, so it grows with the size. */
const outline = (() => {
  const reach = 0.06
  const steps: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  return steps.map(([x, y]) => `${x * reach}em ${y * reach}em 0 rgb(0 0 0)`).join(', ')
})()

/** How the edge of the letters is drawn, after the system's caption settings. Raised and depressed
 *  are a light and a dark edge on opposite sides, with a soft shadow so they still read on a bright scene. */
const edges: Record<SubtitleEdge, string> = {
  none: 'none',
  dropShadow: softShadow,
  raised: '0 -1px 0 rgb(255 255 255 / 0.6), 0 1px 0 rgb(0 0 0 / 0.9), 0 2px 3px rgb(0 0 0 / 0.75)',
  depressed: '0 1px 0 rgb(255 255 255 / 0.6), 0 -1px 0 rgb(0 0 0 / 0.9), 0 -2px 3px rgb(0 0 0 / 0.6)',
  outline,
}

export type SubtitleCSS = CSSProperties & Record<`--sub-${string}`, string | number>

/** The style for the element that holds a subtitle's lines. It sets the text's own properties, and
 *  custom properties for what the stylesheet has to combine with its own sizes:
 *  `--sub-scale`   multiplies the host's base size (`--sub-base`);
 *  `--sub-lift`    the fraction of the picture's height to raise the line, against the host's `--sub-room`;
 *  `--sub-bold`    the weight of <b> runs, always a step above the text;
 *  `--sub-box`, `--sub-pad`   each line's background box, when there is one. */
export function subtitleCSS(style: SubtitleStyle): SubtitleCSS {
  const s = normaliseSubtitleStyle(style)
  const boxed = s.background !== 'none'
  const weight = weights[s.weight]
  return {
    fontFamily: families[s.font],
    fontWeight: weight,
    fontStretch: s.font === 'condensed' ? '75%' : undefined,
    color: subtitleColorValues[s.color],
    textShadow: edges[s.edgeStyle],
    '--sub-scale': s.fontScale,
    '--sub-lift': s.verticalPosition,
    '--sub-bold': Math.max(800, weight + 100),
    // Solid is a solid box; the opacity setting is for the translucent one.
    '--sub-box': !boxed ? 'transparent' : s.background === 'solid' ? 'rgb(0 0 0 / 1)' : `rgb(0 0 0 / ${Number(s.backgroundOpacity.toFixed(2))})`,
    '--sub-pad': boxed ? '0.04em 0.45em' : '0',
  }
}

/** What both the preview and the player's style page show when no real line is on screen. */
export const sampleSubtitle = ['This is a subtitle preview.', 'It updates as you change the options.']
