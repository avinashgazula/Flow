/* The way back from Trakt, as far as the first page is concerned. Trakt sends the browser to
   <site>/settings/trakt-callback?code=…, which isn't a screen: the page puts the address back to Settings → Account
   before the router reads it, then finishes the sign-in in the background. The sign-in code is its own chunk,
   fetched only on this path, and a failure is left for the Account section to say. */

/** Where Trakt sends the browser back, relative to the site. The owner adds the full address to the Trakt app. */
export const callbackPath = 'settings/trakt-callback'

export function arriveFromTrakt() {
  const base = import.meta.env.BASE_URL
  if (location.pathname.replace(/\/$/, '') !== `${base}${callbackPath}`) return
  const search = location.search
  history.replaceState(history.state, '', `${base}settings#account`)
  void import('./session').then(({ finishSignInFromAddress }) => finishSignInFromAddress(search))
}
