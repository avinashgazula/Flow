import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { routeTree } from './routeTree.gen'
import { ErrorScreen } from './components/ErrorScreen'
import { cacheBuster, persister, queryClient } from './lib/queryClient'
import { checkConvertAudio } from './lib/audio/support'
import { checkSmoothVideo } from './lib/sources/smooth'
import { listenForInstall } from './lib/pwa/install'
import { registerServiceWorker } from './lib/pwa/update'
import { settingsStore } from './lib/store/settings'
import { libraryStore } from './lib/store/library'
import { arriveFromTrakt } from './lib/trakt/arrive'
import { bootTrakt } from './lib/trakt/boot'
import './styles/global.css'

// Trakt sends the browser back to an address that isn't a screen: point it at Settings before the router reads it.
arriveFromTrakt()

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
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// The typeface is an attribute on <html>: index.html sets it before first paint, and a change in
// Settings (here or in another tab) follows at once.
const applyFont = () => {
  document.documentElement.dataset.font = settingsStore.get().font
}
applyFont()
settingsStore.subscribe(applyFont)

// A page opened before a deploy asks for code chunks that no longer exist: load the new build once
// rather than showing an error.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('flow.reloadedForDeploy')) return
  sessionStorage.setItem('flow.reloadedForDeploy', '1')
  event.preventDefault()
  location.reload()
})
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('flow.reloadedForDeploy'), 10_000))

// Flow works offline once it has loaded (src/sw/sw.ts), and can be installed as an app. The browser's
// install event comes once and early, so it is caught here and kept for Settings.
registerServiceWorker()
listenForInstall()

// Ask the browser's audio encoder what it takes, so source ranking knows whether audio it can't
// decode can be converted. Nothing waits on the answer.
void checkConvertAudio()

// Ask the browser which kinds of video it decodes smoothly (4K HEVC without a hardware decoder, say),
// so ranking can put those lower. Once the page is idle: nothing waits on the answer.
const whenIdle = window.requestIdleCallback ? (run: () => void) => window.requestIdleCallback(run, { timeout: 2000 }) : (run: () => void) => setTimeout(run, 300)
whenIdle(() => void checkSmoothVideo())

// A browser with Flow Sync on pulls at load. The sync code is its own chunk, fetched only when the
// setup is there (lib/sync/config.ts names the same key), so a browser without sync never downloads it.
try {
  if (localStorage.getItem('flow.sync.v1')) void import('./lib/sync/engine').then(({ startSync }) => startSync())
} catch {
  // Blocked storage means no sync setup to find.
}

// A browser signed in to Trakt (here, or through Sync) keeps its library in step with it. The code is a separate
// chunk, fetched only once there is a sign-in.
bootTrakt()

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
