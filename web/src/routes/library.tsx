import { createFileRoute } from '@tanstack/react-router'
import { LibraryScreen } from '../features/library/LibraryScreen'
import { libraryLists, parseListSort, type LibraryList } from '../features/library/logic'
import type { MediaType } from '../lib/tmdb/types'

export interface LibrarySearch {
  /** One whole list instead of the overview. */
  list?: LibraryList
  type?: MediaType
  sort?: string
}

export const Route = createFileRoute('/library')({
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    list: libraryLists.includes(search.list as LibraryList) ? (search.list as LibraryList) : undefined,
    type: search.type === 'show' ? 'show' : search.type === 'movie' ? 'movie' : undefined,
    sort: typeof search.sort === 'string' ? search.sort : undefined,
  }),
  component: Library,
})

function Library() {
  const search = Route.useSearch()
  return <LibraryScreen list={search.list} type={search.type} sort={parseListSort(search.sort)} />
}
