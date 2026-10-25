/* Flow's service worker. It keeps the app's own code so Flow opens with no network, and it stays out of the
   way of everything else (see rules.ts for exactly what). It is built by scripts/pwa.ts after the site is,
   with the list of files to keep filled in, and it is only registered in production builds. */
import { cacheName, handlingFor, isStorable, staleCaches } from './rules'

declare const __FLOW_SW__: { version: string; precache: string[] }

const sw = self as unknown as ServiceWorkerGlobalScope
const { version, precache } = __FLOW_SW__
const scope = sw.registration.scope
const precached = new Set(precache)
const offlinePage = new URL('offline.html', scope).href
/** How long a page load waits for the network before the saved shell opens instead. A slow connection gets
 *  Flow at once, and the app fills in from what it saved. */
const patience = 4000

sw.addEventListener('install', (event) => {
  // The new worker waits for the person to say "Reload" (the page sends `skip-waiting`), so a page is never
  // swapped to new code half way through a film. The first install has nothing to wait for.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName(version))
      await Promise.all(
        precache.map(async (path) => {
          const url = new URL(path, scope).href
          // Past the browser's own cache, so a stale copy of the shell can't be kept under a new version.
          const res = await fetch(url, { cache: 'reload' })
          if (!res.ok) throw new Error(`${url} answered ${res.status}`)
          await cache.put(url, res)
        }),
      )
    })(),
  )
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(staleCaches(await caches.keys(), version).map((name) => caches.delete(name)))
      await sw.clients.claim()
    })(),
  )
})

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') void sw.skipWaiting()
})

sw.addEventListener('fetch', (event) => {
  const request = event.request
  const how = handlingFor({ url: request.url, method: request.method, mode: request.mode, destination: request.destination, ranged: request.headers.has('range') }, scope, precached)
  // Not Flow's own: no respondWith, so the browser handles it exactly as if there were no worker.
  if (how === 'network') return
  event.respondWith(how === 'navigate' ? openPage(request) : fromCache(event))
})

/** A page load goes to the network first, so a new deploy shows up at once. When that fails or takes too
 *  long, the saved shell opens (the app routes the address itself), and the offline page if even that is gone. */
async function openPage(request: Request): Promise<Response> {
  try {
    return await Promise.race([fetch(request), new Promise<never>((_, reject) => setTimeout(reject, patience))])
  } catch {
    const cache = await caches.open(cacheName(version))
    return (await cache.match(scope)) ?? (await cache.match(offlinePage)) ?? Response.error()
  }
}

/** Flow's own files: hashed code and fonts never change under their name, so the saved copy answers and the
 *  network is asked only for what isn't saved yet (a route chunk or typeface not opened before). */
async function fromCache(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(cacheName(version))
  const saved = await cache.match(event.request.url)
  if (saved) return saved
  const res = await fetch(event.request)
  if (isStorable(res)) event.waitUntil(cache.put(event.request.url, res.clone()))
  return res
}
