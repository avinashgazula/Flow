import { useSyncExternalStore } from 'react'

/* Installing Flow as an app. Chromium browsers say when they can install it (`beforeinstallprompt`), and
   Flow keeps that event to use when the person asks. Safari on iPhone and iPad has no such event, only
   Share > Add to Home Screen, so there Flow says how, once, in Settings. Nothing asks unprompted. */

export type InstallMode =
  /** Already running as an app, or nothing to offer. */
  | 'none'
  /** The browser will show its own install dialog when asked. */
  | 'prompt'
  /** iPhone or iPad: the person adds it from the Share sheet. */
  | 'ios'

export interface InstallEnvironment {
  /** Running in an app window rather than a browser tab. */
  standalone: boolean
  /** A `beforeinstallprompt` event is waiting to be used. */
  canPrompt: boolean
  userAgent: string
  maxTouchPoints: number
}

/** What Settings offers. iPadOS asks for desktop sites, so its user agent says Mac; a Mac with a touch
 *  screen doesn't exist, which tells them apart. */
export function installMode(env: InstallEnvironment): InstallMode {
  if (env.standalone) return 'none'
  if (env.canPrompt) return 'prompt'
  const ios = /iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  return ios ? 'ios' : 'none'
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let pending: InstallPromptEvent | undefined
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Starts listening at launch: the browser sends its event once, early, and doesn't repeat it. */
export function listenForInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this the browser may show its own bar at a moment of its choosing.
    event.preventDefault()
    pending = event as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    pending = undefined
    installed = true
    emit()
  })
}

const mode = (): InstallMode => {
  if (installed) return 'none'
  return installMode({
    standalone: matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches || (navigator as { standalone?: boolean }).standalone === true,
    canPrompt: pending !== undefined,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  })
}

export const useInstallMode = () => useSyncExternalStore(subscribe, mode, () => 'none' as InstallMode)

/** Shows the browser's install dialog. The event is single-use, so it is dropped whatever the answer; a
 *  browser that still wants Flow installed sends a new one. */
export async function promptInstall() {
  const event = pending
  if (!event) return
  pending = undefined
  emit()
  await event.prompt()
  await event.userChoice
}
