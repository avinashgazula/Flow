/* The player's rules and memory: when to offer Resume, which source to reuse, what plays next.
   Pure functions where possible, so they're tested; the two small stores sit at the bottom. */

import type { Source } from '../../lib/sources'
import type { EpisodeRef, Progress } from '../../lib/store/library'
import type { Episode } from '../../lib/tmdb/types'
import { mergeChoice, type TitleChoice, type TitleChoices } from './languages'

/** Worth offering to resume: started, and not so near the end that resuming would finish it at
 *  once (a resume point from another cut can lie past this stream's end). As in the apps. */
export function shouldResume(position: number, duration: number): boolean {
  if (!(position > 0)) return false
  if (!Number.isFinite(duration) || duration <= 0) return true
  return position < duration - 30
}

/** Where this title or episode was left: the library's position, or the server's when it has a
 *  later one (Jellyfin and Plex remember positions from other devices). */
export function resumePosition(progress: Progress | undefined, episode: EpisodeRef | undefined, serverPosition?: number): number | undefined {
  const sameEpisode = !episode || (progress?.episode?.season === episode.season && progress.episode.episode === episode.episode)
  const local = progress && sameEpisode && shouldResume(progress.position, progress.duration) ? progress.position : undefined
  const server = serverPosition && serverPosition > 30 ? serverPosition : undefined
  const best = Math.max(local ?? 0, server ?? 0)
  return best > 0 ? best : undefined
}

/** The source in `list` that is `previous` again: the same file, else (another episode) the same
 *  provider at the same resolution. Undefined when nothing is close enough, so the viewer picks. */
export function matchSource(previous: Source, list: Source[]): Source | undefined {
  const playable = list.filter((s) => !s.unsupported)
  return (
    playable.find((s) => s.id === previous.id) ??
    playable.find((s) => s.origin === previous.origin && s.provider === previous.provider && s.resolution === previous.resolution && s.engine === previous.engine)
  )
}

/** The episode after `current`: the next one this season if it has aired, else the next season's
 *  first. Undefined at the end of what's out. */
export function nextEpisode(current: EpisodeRef, season: Episode[] | undefined, nextSeason: Episode[] | undefined, today = new Date().toISOString().slice(0, 10)): Episode | undefined {
  const aired = (e: Episode) => !e.airDate || e.airDate <= today
  const next = season?.find((e) => e.number === current.episode + 1)
  if (next) return aired(next) ? next : undefined
  const first = nextSeason?.find((e) => e.number === 1) ?? nextSeason?.[0]
  return first && aired(first) ? first : undefined
}

export interface NextSourceOptions {
  /** Never return a source marked unsupported: for a viewer who is leaving one that has no sound,
   *  or a fail-over that should find something that works rather than something that can't. */
  playableOnly?: boolean
  /** Start from the top of the list (the best remaining source) instead of just after `current`. */
  best?: boolean
  /** Sources this answers true for come first, so a known-good audio track beats an unknown one. */
  prefer?: (source: Source) => boolean
  /** Only sources of a lower resolution than this height, for stepping down from a picture the
   *  connection or the device can't carry. A source that doesn't say its resolution can't promise
   *  to be lower, so it isn't offered. */
  below?: number
}

const heights: Record<NonNullable<Source['resolution']>, number> = { '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, SD: 480 }

/** A source's picture height in pixels, when it says. */
export const resolutionHeight = (resolution: Source['resolution']): number | undefined => (resolution ? heights[resolution] : undefined)

/** The next untried source after `current` in the list, for Try Another Source and fail-over.
 *  Sources marked unsupported come last, and only when `playableOnly` isn't set. */
export function nextSource(list: Source[], current: Source | undefined, tried: ReadonlySet<string>, options: NextSourceOptions = {}): Source | undefined {
  const start = options.best || !current ? -1 : list.findIndex((s) => s.id === current.id)
  const below = options.below
  const ordered = [...list.slice(start + 1), ...list.slice(0, Math.max(0, start))].filter((s) => !tried.has(s.id) && (below === undefined || (resolutionHeight(s.resolution) ?? Infinity) < below))
  const playable = ordered.filter((s) => !s.unsupported)
  const preferred = options.prefer ? playable.filter(options.prefer) : []
  return preferred[0] ?? playable[0] ?? (options.playableOnly ? undefined : ordered[0])
}

// MARK: Memory

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private windows and full storage still play; they just forget.
  }
}

export interface LastSource {
  source: Source
  episode?: EpisodeRef
  at: number
}

const lastKey = 'flow.player.lastSources.v1'

/** The source each title last played from, so Play goes straight to it next time. Per device. */
export const lastSources = {
  get(key: string): LastSource | undefined {
    return read<Record<string, LastSource>>(lastKey, {})[key]
  },
  remember(key: string, source: Source, episode?: EpisodeRef) {
    const all = read<Record<string, LastSource>>(lastKey, {})
    all[key] = { source, episode, at: Date.now() }
    // A couple of hundred titles is plenty; the oldest go first.
    const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 200)
    write(lastKey, Object.fromEntries(kept))
  },
  forget(key: string) {
    const all = read<Record<string, LastSource>>(lastKey, {})
    delete all[key]
    write(lastKey, all)
  },
}

export interface PlayerPrefs {
  volume: number
  muted: boolean
  /** hls.js's last bandwidth estimate in bits per second, so the next stream starts at the right quality. */
  bandwidth?: number
}

const prefsKey = 'flow.player.prefs.v1'
const defaultPrefs: PlayerPrefs = { volume: 1, muted: false }

export const prefs = {
  get: (): PlayerPrefs => read(prefsKey, defaultPrefs),
  set(patch: Partial<PlayerPrefs>) {
    write(prefsKey, { ...prefs.get(), ...patch })
  },
}

const struggleKey = 'flow.player.struggleDismissed.v1'

/** Titles whose "Playback Is Struggling" notice was dismissed with Keep Watching, so it doesn't come
 *  back for them (a show counts as one title). Per device. */
export const struggleDismissals = {
  has: (key: string): boolean => key in read<Record<string, number>>(struggleKey, {}),
  add(key: string) {
    const all = read<Record<string, number>>(struggleKey, {})
    all[key] = Date.now()
    const kept = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 200)
    write(struggleKey, Object.fromEntries(kept))
  },
}

const choicesKey = 'flow.player.titleChoices.v1'

/** The audio and subtitle languages picked by hand in the player, per title (a show counts as one
 *  title). Settings → Playback is the default for everything else, so a pick for one film never
 *  carries over to the next; but within a show the choice sticks from episode to episode. */
export const titleChoices = {
  get: (key: string): TitleChoice | undefined => read<TitleChoices>(choicesKey, {})[key],
  set(key: string, patch: TitleChoice) {
    write(choicesKey, mergeChoice(read<TitleChoices>(choicesKey, {}), key, patch))
  },
}
