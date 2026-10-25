import { createFileRoute } from '@tanstack/react-router'
import { HomeScreen } from '../features/home/HomeScreen'
import { q } from '../lib/queries'
import { settingsStore } from '../lib/store/settings'

export const Route = createFileRoute('/')({
  // Started, not awaited: the page paints its skeleton at once and fills as each answer lands. The shelves under
  // the fold load their code now too, so it is there by the time anyone scrolls.
  loader: ({ context }) => {
    if (settingsStore.get().heroSource === 'trending') void context.queryClient.prefetchQuery(q.trending('all', 'day'))
    void import('../features/home/Shelves')
  },
  component: HomeScreen,
})
