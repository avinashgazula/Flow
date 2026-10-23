/* The shape of a subtitle style and its defaults: all the first-load code needs, since the settings store
   starts from them. The choices and the rules that keep a saved value sane are in subtitleStyle.ts. */

export type SubtitleFont = 'system' | 'rounded' | 'serif' | 'monospaced' | 'condensed'
export type SubtitleWeight = 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy'
export type SubtitleColor = 'white' | 'yellow' | 'cyan' | 'green'
export type SubtitleEdge = 'none' | 'dropShadow' | 'raised' | 'depressed' | 'outline'
export type SubtitleBackground = 'none' | 'translucent' | 'solid'

export interface SubtitleStyle {
  /** 1 is the usual size; 0.6 to 2. */
  fontScale: number
  font: SubtitleFont
  weight: SubtitleWeight
  color: SubtitleColor
  edgeStyle: SubtitleEdge
  background: SubtitleBackground
  /** 0 to 1, for the two boxes. */
  backgroundOpacity: number
  /** How far the line is raised from its usual spot, as a fraction of the picture's height: 0 to 0.4. */
  verticalPosition: number
}

export const defaultSubtitleStyle: SubtitleStyle = {
  fontScale: 1,
  font: 'system',
  weight: 'semibold',
  color: 'white',
  edgeStyle: 'dropShadow',
  background: 'none',
  backgroundOpacity: 0.6,
  verticalPosition: 0,
}
