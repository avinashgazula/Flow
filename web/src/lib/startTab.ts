import { tabs, type TabPath } from './tabs'

/* Opening Tab, as the apps' `general.startTab`: where the site opens when it is opened on its front address. It is
   asked once per visit, so Home stays reachable by its tab afterwards. */

/** The page a saved tab id opens. An id this build doesn't know (a newer build's, or a tab since removed) is Home. */
export function startPath(saved: string | undefined): TabPath {
  return tabs.find((t) => t.id === saved)?.to ?? '/'
}

/** Where to send someone arriving at `/`, or nothing to leave them on Home. Only the plain address counts: a link
 *  with a query or a hash (a sign-in coming back, a Flow Sync link, `?demo`) is for Home to read, so it stays. */
export function openingRedirect(saved: string | undefined, arrival: { first: boolean; search: string; hash: string }): TabPath | undefined {
  if (!arrival.first || arrival.search || arrival.hash) return undefined
  const to = startPath(saved)
  return to === '/' ? undefined : to
}
