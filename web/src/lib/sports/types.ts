/* Sports, as FlowKit's SportsClient and SportsSettings model it: teams the viewer follows, their fixtures and results
   from TheSportsDB, and the settings around them. */

export interface SportsTeam {
  id: string
  name: string
  league?: string
  sport?: string
  badgeURL?: string
  country?: string
}

export interface SportsEvent {
  id: string
  title: string
  homeTeam?: string
  awayTeam?: string
  league?: string
  venue?: string
  /** Kick-off, in milliseconds since the epoch. */
  date?: number
  homeScore?: number
  awayScore?: number
  thumbnailURL?: string
}

/** A game with both scores in is over. */
export const isFinished = (e: Pick<SportsEvent, 'homeScore' | 'awayScore'>) => e.homeScore !== undefined && e.awayScore !== undefined

/** The Sports part of Settings (FlowKit's SportsSettings). */
export interface SportsSettings {
  followedTeams: SportsTeam[]
  /** TheSportsDB's key. "123" is its free test key, which the apps use too. */
  apiKey: string
  /** Off blurs live and final scores until tapped. */
  showScoreSpoilers: boolean
  /** Tapping a game opens its channel list (press and hold plays the best match); off is the reverse. */
  chooseChannelOnTap: boolean
}

export const defaultSports: SportsSettings = { followedTeams: [], apiKey: '123', showScoreSpoilers: true, chooseChannelOnTap: false }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optionalString = (v: unknown) => v === undefined || typeof v === 'string'

export function isTeam(v: unknown): v is SportsTeam {
  return isObject(v) && typeof v.id === 'string' && v.id.length > 0 && typeof v.name === 'string' && v.name.length > 0 && optionalString(v.league) && optionalString(v.sport) && optionalString(v.badgeURL) && optionalString(v.country)
}

/** What a backup may hold: every field optional (a missing one takes its default), and each teamed up properly. */
export function isSportsSettings(v: unknown): v is Partial<SportsSettings> {
  return (
    isObject(v) &&
    (v.followedTeams === undefined || (Array.isArray(v.followedTeams) && v.followedTeams.length <= 200 && v.followedTeams.every(isTeam))) &&
    (v.apiKey === undefined || (typeof v.apiKey === 'string' && v.apiKey.length <= 100)) &&
    (v.showScoreSpoilers === undefined || typeof v.showScoreSpoilers === 'boolean') &&
    (v.chooseChannelOnTap === undefined || typeof v.chooseChannelOnTap === 'boolean')
  )
}
