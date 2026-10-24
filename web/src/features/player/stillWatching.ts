/* "Are You Still Watching?", as FlowKit's StillWatching: counts episodes that played one after another with
   nobody touching anything. Any sign of someone there starts the count again. The count outlives each
   episode's screen (Player.tsx holds it), and the rules are here so they can be tested. */

/** A pause this close to the end is the episode ending on its own. */
const endSlack = 3

export class StillWatching {
  unattendedEpisodes = 0

  /** A click, tap, key press, skip, seek or menu choice. */
  noteInteraction() {
    this.unattendedEpisodes = 0
  }

  /** The player paused. A pause in the last seconds is the episode ending on its own, which says nothing about
   *  whether anyone is watching, so it doesn't count. A pause before the length is known does. */
  notePause(time: number, duration: number) {
    if (duration > 0 && time >= duration - endSlack) return
    this.unattendedEpisodes = 0
  }

  /** Whether the next episode should wait for an answer. A limit of 0 means never ask. */
  shouldAsk(limit: number): boolean {
    return limit > 0 && this.unattendedEpisodes >= limit
  }

  /** The next episode started by itself. */
  noteAutomaticAdvance() {
    this.unattendedEpisodes += 1
  }
}
