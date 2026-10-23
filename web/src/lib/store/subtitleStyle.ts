/* How subtitles look: the choices, their defaults and the rules that keep a saved value sane. The names
   and ranges are the apps' (FlowKit's SubtitleSettings), so a setup carries across. This file is in the
   first-load code because the settings store needs the defaults, so it holds data and nothing else:
   the CSS lives in features/player/subtitleStyle.ts. */

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

export const subtitleScale = { min: 0.6, max: 2, step: 0.05 } as const
export const subtitleLift = { min: 0, max: 0.4, step: 0.02 } as const
export const subtitleOpacity = { min: 0, max: 1, step: 0.1 } as const

type Choices<T extends string> = readonly { value: T; label: string }[]

/** The titles are the apps' (SubtitleStyleTitles.swift), so the same choice reads the same everywhere. */
export const subtitleFonts: Choices<SubtitleFont> = [
  { value: 'system', label: 'System' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospaced', label: 'Monospaced' },
  { value: 'condensed', label: 'Condensed' },
]
export const subtitleWeights: Choices<SubtitleWeight> = [
  { value: 'regular', label: 'Regular' },
  { value: 'medium', label: 'Medium' },
  { value: 'semibold', label: 'Semibold' },
  { value: 'bold', label: 'Bold' },
  { value: 'heavy', label: 'Heavy' },
]
export const subtitleColors: Choices<SubtitleColor> = [
  { value: 'white', label: 'White' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'green', label: 'Green' },
]
export const subtitleEdges: Choices<SubtitleEdge> = [
  { value: 'none', label: 'None' },
  { value: 'dropShadow', label: 'Drop Shadow' },
  { value: 'raised', label: 'Raised' },
  { value: 'depressed', label: 'Depressed' },
  { value: 'outline', label: 'Outline' },
]
export const subtitleBackgrounds: Choices<SubtitleBackground> = [
  { value: 'none', label: 'Off' },
  { value: 'translucent', label: 'Translucent Box' },
  { value: 'solid', label: 'Solid Box' },
]

const isChoice = <T extends string>(list: Choices<T>, v: unknown): v is T => list.some((c) => c.value === v)
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
/** A number held to its range and a step, so a slider's 0.1 + 0.2 never lands on 0.30000000000000004. */
const snap = (v: number, { min, max, step }: { min: number; max: number; step: number }) => Number(clamp(Math.round(v / step) * step, min, max).toFixed(4))

/** The apps' older "shadow" background is no box at all (the edge style draws the shadow now). */
const legacyBackground = (v: unknown) => (v === 'shadow' ? 'none' : v)

/** Whether a saved or imported value is a style Flow can use. Missing fields are fine (they take
 *  their defaults); a field that's present has to be one of its choices or inside its range. */
export function isSubtitleStyle(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  const fine = (key: string, ok: (x: unknown) => boolean) => !(key in o) || ok(o[key])
  return (
    fine('fontScale', (x) => inRange(x, subtitleScale.min, subtitleScale.max)) &&
    fine('font', (x) => isChoice(subtitleFonts, x)) &&
    fine('weight', (x) => isChoice(subtitleWeights, x)) &&
    fine('color', (x) => isChoice(subtitleColors, x)) &&
    fine('edgeStyle', (x) => isChoice(subtitleEdges, x)) &&
    fine('background', (x) => isChoice(subtitleBackgrounds, legacyBackground(x))) &&
    fine('backgroundOpacity', (x) => inRange(x, subtitleOpacity.min, subtitleOpacity.max)) &&
    fine('verticalPosition', (x) => inRange(x, subtitleLift.min, subtitleLift.max))
  )
}

/** A complete style from whatever is stored: unknown choices and out-of-range numbers fall back to
 *  the default (or the nearest end of the range), so the player can trust what it's handed. */
export function normaliseSubtitleStyle(v: unknown): SubtitleStyle {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const d = defaultSubtitleStyle
  const number = (x: unknown, fallback: number, range: { min: number; max: number; step: number }) => (typeof x === 'number' && Number.isFinite(x) ? snap(x, range) : fallback)
  const background = legacyBackground(o.background)
  return {
    fontScale: number(o.fontScale, d.fontScale, subtitleScale),
    font: isChoice(subtitleFonts, o.font) ? o.font : d.font,
    weight: isChoice(subtitleWeights, o.weight) ? o.weight : d.weight,
    color: isChoice(subtitleColors, o.color) ? o.color : d.color,
    edgeStyle: isChoice(subtitleEdges, o.edgeStyle) ? o.edgeStyle : d.edgeStyle,
    background: isChoice(subtitleBackgrounds, background) ? background : d.background,
    backgroundOpacity: number(o.backgroundOpacity, d.backgroundOpacity, subtitleOpacity),
    verticalPosition: number(o.verticalPosition, d.verticalPosition, subtitleLift),
  }
}

export const isDefaultSubtitleStyle = (s: SubtitleStyle) => (Object.keys(defaultSubtitleStyle) as (keyof SubtitleStyle)[]).every((k) => s[k] === defaultSubtitleStyle[k])
