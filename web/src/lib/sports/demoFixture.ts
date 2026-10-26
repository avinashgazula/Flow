/* The sample game that Live TV's sample guide knows about, so Sports can show a game with a channel on air for it
   (the guide covers only the next fifteen hours). It lives apart from the rest of the sample sports data so the
   guide can use it without loading the fixture list. The clubs are made up. */

export const demoHome = 'Harbour City'
export const demoAway = 'Eastvale Athletic'
export const demoLeague = 'Premier Division'

const slot = 30 * 60_000

/** Kick-off: on a half hour, between one and one and a half hours from now, so a game is always about to start and the
 *  guide, which runs well past it, has a channel on air for it. */
export const demoKickoff = (now: number) => Math.ceil(now / slot) * slot + 2 * slot
