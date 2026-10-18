import { createFileRoute } from '@tanstack/react-router'
import { HomeScreen } from '../features/home/HomeScreen'
import { q } from '../lib/queries'

export const Route = createFileRoute('/')({
  // Started, not awaited: the page paints its skeleton at once and fills as each answer lands.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(q.trending('all', 'day'))
  },
  component: HomeScreen,
})
