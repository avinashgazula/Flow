import { Outlet, createRootRouteWithContext, useRouter, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { Nav } from '../components/Nav'
import { Notices } from '../components/Notices'
import { Welcome } from '../features/onboarding/Welcome'
import { hasCatalog, useSettings } from '../lib/store/settings'

// The shortcuts sheet is a page of its own, fetched the first time ? is pressed.
const Shortcuts = lazy(() => import('../features/shortcuts/Shortcuts'))

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
  const [help, setHelp] = useState(false)
  const closeHelp = useCallback(() => setHelp(false), [])
  // Settings stays reachable before onboarding, so its shortcuts do too.
  const settled = (ready && onboarded) || path.startsWith('/settings')
  const { navigate } = useRouter()
  const now = useRef({ navigate, path })
  now.current = { navigate, path }
  // The keys load after the first paint, so the first page carries none of them.
  useEffect(() => {
    if (!settled) return
    let stop: (() => void) | undefined
    let gone = false
    void import('../features/shortcuts/globalKeys').then((m) => {
      if (gone) return
      stop = m.installShortcuts(() => ({
        go: (to) => void now.current.navigate(to as Parameters<typeof navigate>[0]),
        path: now.current.path,
        help: () => setHelp(true),
      }))
    })
    return () => {
      gone = true
      stop?.()
    }
  }, [settled])
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
      {help && (
        <Suspense fallback={null}>
          <Shortcuts onClose={closeHelp} />
        </Suspense>
      )}
      <main id="main" ref={main} tabIndex={-1} data-tabbar={path.startsWith('/watch') ? undefined : ''}>
        <Outlet />
      </main>
    </>
  )
}
