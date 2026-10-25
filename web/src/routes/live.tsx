import { createFileRoute } from '@tanstack/react-router'
import { LiveScreen, type LiveSearch } from '../features/livetv/LiveScreen'

export const Route = createFileRoute('/live')({
  validateSearch: (search: Record<string, unknown>): LiveSearch => ({
    view: search.view === 'guide' || search.view === 'channels' ? search.view : undefined,
    group: typeof search.group === 'string' && search.group ? search.group : undefined,
    play: typeof search.play === 'string' && search.play ? search.play : undefined,
  }),
  component: Live,
})

function Live() {
  return <LiveScreen search={Route.useSearch()} />
}
