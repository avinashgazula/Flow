import { Outlet, createRootRouteWithContext, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { Nav } from '../components/Nav'
import { Notices } from '../components/Notices'
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
  const main = useRef<HTMLElement>(null)
  const arrived = useRef(false)
  // A new page starts at its top: keyboard focus goes there too, so Tab enters the page instead of walking the bar again
  // (and a screen reader reads the new page, not the link that was pressed). The player has its own keys.
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true
      return
    }
    if (!path.startsWith('/watch')) main.current?.focus({ preventScroll: true })
  }, [path])
  // Settings stays reachable before onboarding, so a key can be pasted there too.
  if ((!ready || !onboarded) && !path.startsWith('/settings')) {
    return (
      <>
        <Welcome />
        <Notices />
      </>
    )
  }
  return (
    <>
      {!path.startsWith('/watch') && (
        <a
          className="skip-link"
          href="#main"
          onClick={(e) => {
            e.preventDefault()
            main.current?.focus()
          }}
        >
          Skip to Content
        </a>
      )}
      <Nav />
      <Notices />
      <main id="main" ref={main} tabIndex={-1} data-tabbar={path.startsWith('/watch') ? undefined : ''}>
        <Outlet />
      </main>
    </>
  )
}
