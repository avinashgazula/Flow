/* The sleep timer, as the apps have it (SleepTimer in NowPlaying.swift): pause after 15, 30, 45, 60 or 90
   minutes, or when this episode or film ends. The last half minute fades the sound out rather than cutting
   it off mid-line. One timer for the whole player, not one per episode: it keeps counting when the next
   episode starts, and the controller of each episode reads it. */

/** Minutes, or "end" for the end of this episode or film. */
export type SleepChoice = number | 'end'

export const sleepChoices: SleepChoice[] = [15, 30, 45, 60, 90, 'end']

/** How long the sound takes to fade out before the pause. */
export const fadeMs = 30_000

export function sleepTitle(choice: SleepChoice): string {
  if (choice === 'end') return 'End of Episode or Movie'
  if (choice % 60 === 0) return `${choice / 60} Hour${choice >= 120 ? 's' : ''}`
  return `${choice} Minutes`
}

/** What the player says when the timer is set. */
export const sleepSetNotice = (choice: SleepChoice): string => (choice === 'end' ? 'The player will close when this ends.' : `Flow will pause in ${choice} minutes.`)
export const sleepDoneNotice = 'Paused by the sleep timer.'

/** How much of the volume is left `msLeft` before the pause: all of it until the last half minute, then straight down to none. */
export const fadeLevel = (msLeft: number): number => Math.max(0, Math.min(1, msLeft / fadeMs))

export interface SleepCheck {
  /** The time is up: pause. */
  fire: boolean
  /** 1 until the fade begins, then down to 0. */
  level: number
}

export class SleepTimer {
  private current: SleepChoice | null = null
  private deadline = 0
  private listeners = new Set<() => void>()

  get choice(): SleepChoice | null {
    return this.current
  }

  /** Sets the timer, replacing one that is running; null turns it off. */
  set(choice: SleepChoice | null, now = Date.now()) {
    this.current = choice
    this.deadline = typeof choice === 'number' ? now + choice * 60_000 : 0
    this.listeners.forEach((l) => l())
  }

  clear() {
    if (this.current !== null) this.set(null)
  }

  /** Where the timer stands at `now`; null when it isn't counting minutes (off, or waiting for the end). */
  check(now = Date.now()): SleepCheck | null {
    if (typeof this.current !== 'number') return null
    const left = this.deadline - now
    return { fire: left <= 0, level: fadeLevel(left) }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
}

/** The player's one timer. */
export const sleepTimer = new SleepTimer()
