import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { routeTree } from './routeTree.gen'
import { ErrorScreen } from './components/ErrorScreen'
import { cacheBuster, persister, queryClient } from './lib/queryClient'
import { checkConvertAudio } from './lib/audio/support'
import { listenForInstall } from './lib/pwa/install'
import { registerServiceWorker } from './lib/pwa/update'
import { hasCatalog, settingsStore } from './lib/store/settings'
import { watchTheme } from './lib/theme'
import { trailMoved } from './lib/playerTrail'
import { libraryStore } from './lib/store/library'
import { arriveFromHashLink } from './lib/hashLink'
import { arriveFromTrakt } from './lib/trakt/arrive'
import { bootTrackers } from './lib/tracking/boot'
import './styles/global.css'

// Trakt sends the browser back to an address that isn't a screen: point it at Settings before the router reads it.
arriveFromTrakt()
// A setup or a sync pairing in the address (#setup=, #sync=) is read and taken out of it before the router sees it.
arriveFromHashLink(hasCatalog(settingsStore.get()) && settingsStore.get().onboarded)

export const router = createRouter({
  routeTree,
  context: { queryClient },
  basepath: import.meta.env.BASE_URL,
  // A route's code and data start loading when a pointer rests on its link, or a finger lands on it.
  defaultPreload: 'intent',
  defaultPreloadDelay: 40,
  // TanStack Query owns freshness; the router just asks it on every preload.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultErrorComponent: ErrorScreen,
  defaultStructuralSharing: true,
  // A page change cross-fades through the View Transitions API where there is one (global.css has the timing); a title's
  // poster still zooms into its page. Browsers without it just swap.
  defaultViewTransition: true,
})

// What the player's Close needs to know: the page before this one (lib/playerTrail.ts).
router.subscribe('onResolved', (e) => {
  if (e.pathChanged) trailMoved(e.fromLocation?.pathname, e.toLocation.pathname)
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// The page follows the system's light or dark until the viewer picks one in the top bar.
watchTheme()

// A page opened before a deploy asks for code chunks that no longer exist: load the new build once
// rather than showing an error.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('flow.reloadedForDeploy')) return
  sessionStorage.setItem('flow.reloadedForDeploy', '1')
  event.preventDefault()
  location.reload()
})
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('flow.reloadedForDeploy'), 10_000))

// Marquee works offline once it has loaded (src/sw/sw.ts), and can be installed as an app. The browser's
// install event comes once and early, so it is caught here and kept for Settings.
registerServiceWorker()
listenForInstall()

// Ask the browser's audio encoder what it takes, so source ranking knows whether audio it can't
// decode can be converted. Nothing waits on the answer.
void checkConvertAudio()

// Ask the browser which kinds of video it decodes smoothly (4K HEVC without a hardware decoder, say),
// so ranking can put those lower. Once the page is idle, and from a chunk of its own: nothing waits on the answer.
const whenIdle = window.requestIdleCallback ? (run: () => void) => window.requestIdleCallback(run, { timeout: 2000 }) : (run: () => void) => setTimeout(run, 300)
whenIdle(() => void import('./lib/sources/smooth').then((m) => m.checkSmoothVideo()))

// A browser with Marquee Sync on pulls at load. The sync code is its own chunk, fetched only when the
// setup is there (lib/sync/config.ts names the same key), so a browser without sync never downloads it.
try {
  if (localStorage.getItem('flow.sync.v1')) void import('./lib/sync/engine').then(({ startSync }) => startSync())
} catch {
  // Blocked storage means no sync setup to find.
}

// The same for a Marquee Account (lib/account/config.ts names the key): its engine is a chunk of its own, fetched only for a
// browser that is logged in.
try {
  if (localStorage.getItem('flow.account.v1')) void import('./lib/account/engine').then(({ startAccount }) => startAccount())
} catch {
  // Blocked storage means no account to find.
}

// A browser signed in to a tracker (here, or through Sync) keeps its library in step with the one chosen in Settings →
// Account. The code is a separate chunk, fetched only once there is something to track with.
bootTrackers()

// Sample data comes with a lived-in library, as on the other platforms.
if (settingsStore.get().demo && Object.keys(libraryStore.get().progress).length === 0 && libraryStore.get().watchlist.length === 0) {
  void import('./lib/tmdb/demo').then(({ seedDemo }) => seedDemo())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, buster: cacheBuster, maxAge: 7 * 24 * 3600_000 }}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
)
