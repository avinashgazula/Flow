import { Outlet, createRootRouteWithContext, useRouterState } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Nav } from '../components/Nav'
import { Welcome } from '../features/onboarding/Welcome'
import { hasCatalog, useSettings } from '../lib/store/settings'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  notFoundComponent: () => (
    <div className="page">
      <h1 className="page-title">Not Found</h1>
      <p className="muted">That page isn't part of Flow.</p>
    </div>
  ),
})

function Root() {
  const ready = useSettings(hasCatalog)
  const onboarded = useSettings((s) => s.onboarded)
  const path = useRouterState({ select: (r) => r.location.pathname })
  // Settings stays reachable before onboarding, so a key can be pasted there too.
  if ((!ready || !onboarded) && !path.startsWith('/settings')) return <Welcome />
  return (
    <>
      <Nav />
      <main>
        <Outlet />
      </main>
    </>
  )
}
