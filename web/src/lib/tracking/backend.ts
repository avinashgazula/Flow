import type { Listed, Resume, Scrobble, ShowWatched, Target, TraktClient, Watch } from '../trakt/client'
import { TraktError, type TraktErrorKind } from '../trakt/client'
import type { OtherTracker } from './service'

/* What the tracking engine needs from a service, so Simkl and MDBList share one engine. The shapes are the ones
   lib/trakt already uses (a listed title, a play, a resume point), which is what lib/trakt/merge.ts and ops.ts
   work on; each service's file turns its own JSON into them. */

/** A failure with a sentence fit to show as it is. It is a TraktError so the queue (lib/trakt/ops.ts) tells a
 *  change to retry from one to drop in one place. */
export class TrackerError extends TraktError {}
export type TrackerErrorKind = TraktErrorKind

/** The sentences every service uses for the same trouble, with its name in them. */
export const words = (name: string) => ({
  key: `${name} didn’t accept this key. Check it in Settings → Account.`,
  signedOut: `${name} ended this sign-in. Sign in again.`,
  rate: `${name} is busy. Marquee will try again in a moment.`,
  network: `Couldn’t reach ${name}. Check your connection.`,
  server: (status: number) => `${name} had a problem (${status}). Marquee will try again in a moment.`,
  rejected: (status: number) => `${name} didn’t accept that update (${status}).`,
})

/** The calls that send the queue of changes, as lib/trakt/ops.ts takes them. */
export type FlushApi = Pick<TraktClient, 'addToWatchlist' | 'removeFromWatchlist' | 'addHistory' | 'removeHistory' | 'rate' | 'unrate' | 'playback' | 'deletePlayback'>

/** Everything a service has that this browser may lack. `shows` is the per-show watched episodes, which are costly and so
 *  asked for less often; undefined when it wasn't asked. */
export interface Pulled {
  watchlist: Listed[]
  history: Watch[]
  shows?: ShowWatched[]
  resumes: Resume[]
}

export interface PullOptions {
  /** A full pull: also the watched episodes of every show. */
  full: boolean
  limit: number
  /** Which jobs the service has (destinations.ts): when it only holds the watchlist, history and resume points aren't
   *  asked for, and when it only tracks, the watchlist isn't. Both default to asked. */
  track?: boolean
  watchlist?: boolean
  /** Only plays after this (ISO 8601), for services that can say so. */
  startAt?: string
}

export interface Backend extends FlushApi {
  kind: OtherTracker
  name: string
  /** Signed in, or the key is there. */
  ready(): boolean
  pull(options: PullOptions): Promise<Pulled>
  /** Who is signed in, when the service says. */
  username(): Promise<string | undefined>
  scrobble(action: Scrobble, target: Target, progress: number, keepalive?: boolean): Promise<void>
}
