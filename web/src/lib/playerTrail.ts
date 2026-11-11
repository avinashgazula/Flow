/* Where Close in the player goes. The player is a full-screen page in the same history as the rest of the site, so Close
   steps back to where the viewer came from, unless that entry is itself a player address (a redirect like /continue, or
   another watch page), which would put them straight back in the player: then it goes to the title's page instead. */

const playerPath = /^\/(watch|continue)(\/|$)/

export const isPlayerPath = (pathname: string | undefined): boolean => !!pathname && playerPath.test(pathname)

/** 'back' steps back one entry; 'title' replaces the player with the title's page. `canGoBack` is whether the site has an
 *  earlier entry at all (a deep link or a reload on the player has none), `previous` the path of the page before this one. */
export function closeAction({ canGoBack, previous }: { canGoBack: boolean; previous: string | undefined }): 'back' | 'title' {
  return canGoBack && !isPlayerPath(previous) ? 'back' : 'title'
}

let previous: string | undefined

/** The page before the one on screen, for `closeAction`. Moving between player addresses (the next episode replaces the
 *  entry) leaves it as it was, since the entry behind is still the page the viewer came from. */
export function trailMoved(from: string | undefined, to: string): void {
  if (isPlayerPath(from) && isPlayerPath(to)) return
  previous = from
}

export const previousPath = (): string | undefined => previous
