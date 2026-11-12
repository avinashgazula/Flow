/* Spots the short video an add-on serves in place of the film when it refuses a request. ElfHosted's public
   add-ons tie each play link to the internet connection that asked for it; a link opened from anywhere else
   gets a slate ("Opened on a different connection ... Expected IP / Current IP") rather than an error, so a
   player that only checks for failures plays it as if it were the title. Same rules as FlowKit's StreamSlate. */

/** Longest a slate runs, in seconds. */
const longestSlate = 180
/** A title shorter than this (minutes) might really be a short, so length never marks it. */
const shortestRealTitle = 20
/** A listing this big never describes a file as small as a slate. */
const smallestListed = 200 * 1024 * 1024
const largestSlate = 40 * 1024 * 1024

/** True when the address has "slate" as a word of its own ("slate.example.com", "/slates/wrong-ip.mp4"). */
export function isSlateURL(url: string): boolean {
  try {
    const { host, pathname } = new URL(url)
    return `${host}/${pathname}`.toLowerCase().split(/[^a-z0-9]+/).some((w) => w === 'slate' || w === 'slates')
  } catch {
    return false
  }
}

/** Far too short to be the title: seconds or a couple of minutes for a film or an episode of 20 minutes or more. */
export function isTooShort(duration: number, expectedRuntimeMinutes?: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0 || !expectedRuntimeMinutes || expectedRuntimeMinutes < shortestRealTitle) return false
  return duration < Math.min(longestSlate, expectedRuntimeMinutes * 60 * 0.1)
}

/** Tiny next to the size the listing promised. */
export function isTooSmall(bytes?: number, listedBytes?: number): boolean {
  return !!bytes && bytes > 0 && !!listedBytes && listedBytes >= smallestListed && bytes <= largestSlate
}

export interface SlateSigns {
  finalURL?: string
  duration?: number
  bytes?: number
  listedBytes?: number
  expectedRuntimeMinutes?: number
}

/** Whether any sign says this is a slate; every sign is optional (whatever the player has learned so far). */
export function looksLikeSlate({ finalURL, duration, bytes, listedBytes, expectedRuntimeMinutes }: SlateSigns): boolean {
  return (!!finalURL && isSlateURL(finalURL)) || (duration !== undefined && isTooShort(duration, expectedRuntimeMinutes)) || isTooSmall(bytes, listedBytes)
}

/** Hosts whose play links only work from the connection that asked for them. They have to be opened by the browser
 *  that plays them, never through the stream proxy (whose address is a different connection). */
export function bindsLinksToConnection(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'elfhosted.com' || host.endsWith('.elfhosted.com')
  } catch {
    return false
  }
}

/** Said when Marquee moves on by itself. */
export const slateTriedNext = 'This link only works on the connection that asked for it, so Marquee tried the next source. Check your add-on’s proxy setting.'
/** Said when fail-over is off or no source is left. */
export const slateStopped = 'This link only works on the connection that asked for it, so it can’t play here. Try another source, and check your add-on’s proxy setting.'
