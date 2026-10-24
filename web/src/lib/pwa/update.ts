import { useSyncExternalStore } from 'react'

/* The page's side of the service worker (src/sw/sw.ts): register it, and notice when a new version has
   downloaded and is waiting. The new version never takes over by itself, so a page isn't swapped to new
   code half way through a film; the note under the page asks, and "Reload" says yes. */

let waiting: ServiceWorker | undefined
let dismissed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** True while a newer version is downloaded and waiting for a reload. */
export const useUpdateReady = () => useSyncExternalStore(subscribe, () => waiting !== undefined && !dismissed, () => false)

/** Registers the worker, in production builds only: a development server has no worker to register, and a
 *  stale one would hide the changes being made. A first visit has no "update" to announce, so a worker
 *  that installs while nothing controls the page stays quiet. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const base = import.meta.env.BASE_URL
  const register = () =>
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then(watch)
      // A browser that refuses a worker (a private window, blocked site data) just runs Flow without one.
      .catch(() => {})
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

function watch(registration: ServiceWorkerRegistration) {
  const found = (worker: ServiceWorker | null | undefined) => {
    if (!worker || !navigator.serviceWorker.controller) return
    waiting = worker
    emit()
  }
  found(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    worker?.addEventListener('statechange', () => worker.state === 'installed' && found(worker))
  })
  // An installed app can stay open for days, and a browser only looks for a new version when a page loads.
  // Look again when the app comes back to the front, at most every half hour.
  let checked = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - checked < 30 * 60_000) return
    checked = Date.now()
    registration.update().catch(() => {})
  })
}

/** Hands over to the waiting version and loads the page again once it has taken control. */
export function applyUpdate() {
  if (!waiting) return
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  waiting.postMessage({ type: 'skip-waiting' })
}

/** "Not now": the note goes away, and the new version opens the next time Flow starts. */
export function dismissUpdate() {
  dismissed = true
  emit()
}

const onlineSubscribe = (l: () => void) => {
  window.addEventListener('online', l)
  window.addEventListener('offline', l)
  return () => {
    window.removeEventListener('online', l)
    window.removeEventListener('offline', l)
  }
}

/** Whether the browser thinks it has a connection. It is wrong in one direction only: it can say yes to a
 *  network that goes nowhere, never no to one that works. */
export const useOnline = () => useSyncExternalStore(onlineSubscribe, () => navigator.onLine, () => true)
