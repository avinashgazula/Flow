import type { SportsEvent } from '../../lib/sports/types'
import { isFinished } from '../../lib/sports/types'

/* What Sports does with a game, apart from the page so it is tested. */

export type GameAction = 'list' | 'play' | 'reveal' | 'none'

/** What tapping a game does, and what the other control beside it does. As the apps: tapping opens the channel list
 *  when "Choose Channel on Tap" is on and plays the best match when it is off, and the other control (a press and hold
 *  in the apps) does the reverse. A finished game has nothing to watch, so tapping it uncovers a hidden score and does
 *  nothing else. */
export function gameActions(event: SportsEvent, opts: { chooseChannelOnTap: boolean; scoreHidden: boolean }): { tap: GameAction; other: GameAction } {
  if (isFinished(event)) return { tap: opts.scoreHidden ? 'reveal' : 'none', other: 'none' }
  return opts.chooseChannelOnTap ? { tap: 'list', other: 'play' } : { tap: 'play', other: 'list' }
}

/** Whether a score is covered: the setting is off and this game's has not been uncovered. */
export const scoreHidden = (event: SportsEvent, showScoreSpoilers: boolean, revealed: ReadonlySet<string>) => !showScoreSpoilers && isFinished(event) && !revealed.has(event.id)

/** "Sat, Oct 31, 8:00 PM", in the viewer's own clock and zone; nothing for a game with no date. */
export function whenText(date: number | undefined, locale?: string): string {
  if (date === undefined) return ''
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

/** "3 – 1": the score as the apps print it. */
export const scoreText = (event: Pick<SportsEvent, 'homeScore' | 'awayScore'>) => (event.homeScore !== undefined && event.awayScore !== undefined ? `${event.homeScore} – ${event.awayScore}` : '')

/** The line under a game's title: when, and in which league. */
export const metaText = (event: SportsEvent, locale?: string) => [whenText(event.date, locale), event.league].filter(Boolean).join(' · ')

/** The words for what a game's controls do, for a screen reader and a tooltip. */
export function actionLabel(action: GameAction, event: SportsEvent): string {
  const game = event.title || 'this game'
  switch (action) {
    case 'list':
      return `Choose a channel for ${game}`
    case 'play':
      return `Watch ${game} on the best channel`
    case 'reveal':
      return `Show the score of ${game}`
    default:
      return game
  }
}

/** Whether the games list (the upcoming five, the last three) has anything for a team. */
export const hasGames = (next: readonly SportsEvent[], last: readonly SportsEvent[]) => next.length + last.length > 0
