/* The playback settings the player reads, with the apps' defaults and the choices their pickers offer. Pure, so
   the thresholds, seek amounts and the cellular rule are tested; the settings fields are optional, so a value
   that is absent or isn't one of the choices means the default. */

import { watchedChoices, watchedFraction } from '../../lib/store/library'
import type { CellularCap, Settings } from '../../lib/store/settings'
import { resolutionHeight } from './session'

export { watchedChoices }
export const seekChoices = [5, 10, 15, 30] as const
export const countdownChoices = [5, 10, 15, 20, 30] as const
export const cellularChoices: { value: CellularCap; label: string }[] = [
  { value: '2160p', label: 'Up to 4K' },
  { value: '1440p', label: 'Up to 1440p' },
  { value: '1080p', label: 'Up to 1080p' },
  { value: '720p', label: 'Up to 720p' },
  { value: '480p', label: 'Up to 480p' },
]

/** The value if it is one of the choices, else the default. */
const choose = <T extends number>(value: number | undefined, choices: readonly T[], fallback: T): T => (choices.includes(value as T) ? (value as T) : fallback)

export interface PlaybackPreferences {
  askToResume: boolean
  /** A fraction of the length, 0.9 for 90%. */
  watchedAt: number
  seekBack: number
  seekForward: number
  countdown: number
}

type Prefs = Pick<Settings, 'askToResume' | 'watchedThresholdPercent' | 'seekBackwardSeconds' | 'seekForwardSeconds' | 'nextEpisodeCountdownSeconds'>

export function playbackPreferences(settings: Partial<Prefs>): PlaybackPreferences {
  return {
    askToResume: settings.askToResume !== false,
    watchedAt: watchedFraction(settings.watchedThresholdPercent),
    seekBack: choose(settings.seekBackwardSeconds, seekChoices, 10),
    seekForward: choose(settings.seekForwardSeconds, seekChoices, 10),
    countdown: choose(settings.nextEpisodeCountdownSeconds, countdownChoices, 10),
  }
}

/** A show remembers the languages picked in the player when Remember Tracks for Each Show is on. A film keeps its own
 *  pick for that film whatever the setting says: it is the same title, and the apps' resume does the same. */
export const remembersChoices = (key: string | undefined, rememberTracksPerShow: boolean | undefined): boolean => !key?.startsWith('show:') || rememberTracksPerShow !== false

// MARK: Resolution on Cellular

/** The slice of the browser's Network Information API that is used. Chromium has it; Safari and Firefox don't. */
export interface Connection {
  saveData?: boolean
  effectiveType?: string
  type?: string
}

export const currentConnection = (): Connection | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: Connection }).connection)

/** The apps cap on cellular data, a personal hotspot or Low Data Mode. A browser can say Data Saver is on, that the
 *  link is slow, or (on Android) that it is cellular, which is as close as it gets. */
export function isMetered(connection: Connection | undefined): boolean {
  if (!connection) return false
  return connection.saveData === true || connection.type === 'cellular' || ['slow-2g', '2g', '3g'].includes(connection.effectiveType ?? '')
}

/** The tallest picture to pick for the viewer right now, or undefined for no limit. */
export function resolutionLimit(cap: CellularCap | undefined, connection: Connection | undefined): number | undefined {
  if (!cap || !isMetered(connection)) return undefined
  const height = resolutionHeight(cap)
  return height === 2160 ? undefined : height
}

/** True when a source is taller than the limit. A source that doesn't say its resolution is let through. */
export const overLimit = (resolution: Parameters<typeof resolutionHeight>[0], limit: number | undefined): boolean => limit !== undefined && (resolutionHeight(resolution) ?? 0) > limit
