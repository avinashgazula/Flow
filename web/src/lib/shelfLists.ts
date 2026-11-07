import type { ShelfConfig, ShelfSource } from './shelfDefaults'

/* The three shelves that are somebody else's list: a Trakt list (the viewer's own, or any public one), an MDBList list,
   and one library of a media server, as the apps' Add List Shelf offers them. The parsing and the list editing are
   here so they can be tested; asking Trakt and MDBList is lib/listTitles.ts, which loads only when a row needs it. */

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `shelf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

const name = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export type TraktListAddress = { ok: true; user: string; slug: string } | { ok: false; error: string }

const unreadable = 'That isn’t a Trakt list. Paste its address (trakt.tv/users/name/lists/list-name), or type the username and the list name with a slash between.'

/** A public Trakt list from what a person pastes: its address, with or without the scheme, query or a trailing slash
 *  (`https://trakt.tv/users/sam/lists/best-of-2024`), or `sam/best-of-2024`. Trakt's own curated lists have no user and
 *  are not offered here, as the apps don't. */
export function parseTraktList(input: string): TraktListAddress {
  const text = input.trim()
  if (!text) return { ok: false, error: unreadable }
  const address = /^(?:https?:\/\/)?(?:www\.)?trakt\.tv\/users\/([^/?#\s]+)\/lists\/([^/?#\s]+)/i.exec(text)
  const pair = /^([^/\s]+)\/([^/\s]+)$/.exec(text)
  const found = address ?? pair
  if (!found) return { ok: false, error: unreadable }
  const user = decodeURIComponent(found[1]!)
  const slug = decodeURIComponent(found[2]!)
  if (!name.test(user) || !name.test(slug)) return { ok: false, error: unreadable }
  return { ok: true, user, slug }
}

/** The line a Trakt list's shelf takes as its title when the viewer typed none: the slug read as words. */
export function titleFromSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) || slug
}

/** The list with a shelf of the given source added at the end, on. A list already there for the same source is left as
 *  it is, so pressing Add twice doesn't make two rows. */
export function addSourceShelf(list: readonly ShelfConfig[], title: string, source: ShelfSource, id = uid()): ShelfConfig[] {
  if (list.some((s) => sameSource(s.source, source))) return [...list]
  return [...list, { id, title: title.trim() || 'List', source, enabled: true, style: 'poster' }]
}

/** Whether two shelves would show the same list (the one rule for "already added"). */
export function sameSource(a: ShelfSource, b: ShelfSource): boolean {
  if (a.kind === 'traktList' && b.kind === 'traktList') return a.user.toLowerCase() === b.user.toLowerCase() && a.slug.toLowerCase() === b.slug.toLowerCase()
  if (a.kind === 'mdblist' && b.kind === 'mdblist') return a.id === b.id
  if (a.kind === 'mediaServerLibrary' && b.kind === 'mediaServerLibrary') return a.serverID === b.serverID && a.libraryID === b.libraryID
  return false
}

/** A Trakt list's rows ("me" is the signed-in viewer, which `listTitles` sends with their token). */
export const traktShelf = (user: string, slug: string): ShelfSource => ({ kind: 'traktList', user, slug })
