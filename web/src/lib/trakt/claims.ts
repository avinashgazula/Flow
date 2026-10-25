/* Plays the player's scrobbles are already telling Trakt about. A scrobble that stops past 80 % makes Trakt
   record a watch by itself, and the library's own "watched" entry for the same play must not be sent a second
   time. The scrobbler claims a title while it plays and for a couple of minutes after a stop that Trakt counted;
   the library diff leaves claimed plays alone. */

const claims = new Map<string, number>()
/** Long enough for the library entry the end of a play creates to be seen and skipped. */
const grace = 120_000

export const claimKey = (type: string, id: number, season?: number, episode?: number) => `${type}:${id}:${season ?? ''}:${episode ?? ''}`

export function claim(key: string) {
  claims.set(key, Infinity)
}

/** The play ended. `counted` is whether Trakt recorded it as watched, which is when the library's entry needs skipping. */
export function release(key: string, counted: boolean, now = Date.now()) {
  if (counted) claims.set(key, now + grace)
  else claims.delete(key)
}

export function isClaimed(key: string, now = Date.now()): boolean {
  const until = claims.get(key)
  if (until === undefined) return false
  if (until < now) {
    claims.delete(key)
    return false
  }
  return true
}

export const forgetClaims = () => claims.clear()
