import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { routeTree } from './routeTree.gen'
import { ErrorScreen } from './components/ErrorScreen'
import { cacheBuster, persister, queryClient } from './lib/queryClient'
import { settingsStore } from './lib/store/settings'
import { libraryStore } from './lib/store/library'
import './styles/global.css'

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

// A page opened before a deploy asks for code chunks that no longer exist: load the new build once
// rather than showing an error.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('flow.reloadedForDeploy')) return
  sessionStorage.setItem('flow.reloadedForDeploy', '1')
  event.preventDefault()
  location.reload()
})
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('flow.reloadedForDeploy'), 10_000))

// Sample data comes with a lived-in library, as on the other platforms.
if (settingsStore.get().demo && Object.keys(libraryStore.get().progress).length === 0 && libraryStore.get().watchlist.length === 0) {
  void import('./lib/tmdb/demo').then(({ seededLibrary }) => libraryStore.set(seededLibrary()))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, buster: cacheBuster, maxAge: 7 * 24 * 3600_000 }}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
)
