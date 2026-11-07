import { settingsStore } from './store/settings'
import { trakt } from './trakt/session'
import { readWatchlist as readTraktRows, type Listed } from './trakt/client'
import { createMDBListClient, readWatchlist as readMDBListRows } from './tracking/mdblist'

/* Asking Trakt and MDBList for the lists behind a shelf, and for the viewer's own lists to choose from, as FlowKit's
   TraktClient.listItems and myLists and MDBListClient.myLists do. Titles come back as TMDB ids; the shelf reads
   each from TMDB for its artwork. Both services answer a browser (CORS), and a public Trakt list needs no sign-in,
   only the app's Client ID. This is loaded only when a list shelf or the Add a Shelf pickers need it. */

export interface ListSummary {
  /** What the shelf stores: Trakt's slug, or MDBList's number. */
  id: string
  name: string
  count?: number
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const mdblist = () => createMDBListClient(() => settingsStore.get().mdblistKey ?? '', (...args) => fetch(...args))

/** A Trakt list's films and series. "me" is the signed-in viewer's own list, which needs the token; any other user's
 *  public list is asked for without one, so it works signed out too. */
export async function traktListTitles(user: string, slug: string): Promise<Listed[]> {
  const { body } = await trakt().request('GET', `/users/${encodeURIComponent(user)}/lists/${encodeURIComponent(slug)}/items`, { anonymous: user !== 'me', query: { limit: 100 } })
  return readTraktRows(body)
}

/** The lists on the viewer's own Trakt account. */
export async function myTraktLists(): Promise<ListSummary[]> {
  const { body } = await trakt().request('GET', '/users/me/lists')
  return (Array.isArray(body) ? body : []).flatMap((row) => {
    if (!obj(row) || !obj(row.ids) || typeof row.ids.slug !== 'string' || typeof row.name !== 'string') return []
    return [{ id: row.ids.slug, name: row.name, ...(typeof row.item_count === 'number' ? { count: row.item_count } : {}) }]
  })
}

/** An MDBList list's films and series. */
export async function mdblistTitles(id: number): Promise<Listed[]> {
  return readMDBListRows(await mdblist().request('GET', `/lists/${id}/items`, { query: { limit: 100 } }))
}

/** The lists on the viewer's own MDBList account. */
export async function myMDBLists(): Promise<ListSummary[]> {
  const body = await mdblist().request('GET', '/lists/user')
  return (Array.isArray(body) ? body : []).flatMap((row) => {
    if (!obj(row) || typeof row.id !== 'number' || typeof row.name !== 'string') return []
    return [{ id: String(row.id), name: row.name, ...(typeof row.items === 'number' ? { count: row.items } : {}) }]
  })
}
