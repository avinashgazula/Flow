import { createFileRoute, redirect } from '@tanstack/react-router'
import { HomeScreen } from '../features/home/HomeScreen'
import { q } from '../lib/queries'
import { settingsStore } from '../lib/store/settings'
import { openingRedirect } from '../lib/startTab'

/** Opening Tab is asked once, when the site is opened on its front address; Home's tab leads here again after that. */
let arrived = false

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const first = !arrived
    arrived = true
    const to = openingRedirect(settingsStore.get().startTab, { first, search: window.location.search, hash: window.location.hash })
    if (to) throw redirect({ to, replace: true })
  },
  // Started, not awaited: the page paints its skeleton at once and fills as each answer lands. The shelves under
  // the fold load their code now too, so it is there by the time anyone scrolls.
  loader: ({ context }) => {
    if (settingsStore.get().heroSource === 'trending') void context.queryClient.prefetchQuery(q.trending('all', 'day'))
    void import('../features/home/Shelves')
  },
  component: HomeScreen,
})
