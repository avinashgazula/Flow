import { demoAway, demoHome, demoKickoff, demoLeague } from './demoFixture'
import type { SportsTeam } from './types'

/* Sample sports data for `?demo`, in TheSportsDB's own response shape so the same parsers read it (as FlowKit's
   DemoTransport does for the apps). The clubs and fixtures are made up, and every date is counted from now, so the
   page always has a game about to start, a few to come and some results. */

export const demoTeams: SportsTeam[] = [
  { id: '910001', name: demoHome, league: demoLeague, sport: 'Soccer', country: 'England' },
  { id: '910002', name: 'Summit Peaks', league: 'Pro Basketball League', sport: 'Basketball', country: 'United States' },
  { id: '910003', name: 'Northgate United', league: demoLeague, sport: 'Soccer', country: 'England' },
  { id: '910004', name: 'Bay Pilots', league: 'Pro Basketball League', sport: 'Basketball', country: 'United States' },
]


/** "2026-10-25T14:00:00": TheSportsDB gives kick-off in UTC with no zone. */
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19)

interface Game {
  id: string
  home: string
  away: string
  league: string
  venue: string
  at: number
  score?: [number, number]
}

function fixtures(teamID: string, now: number): { next: Game[]; last: Game[] } {
  const today = new Date(now).setHours(0, 0, 0, 0)
  // Local evenings and afternoons, whatever the zone.
  const local = (days: number, hours: number) => new Date(new Date(today).getFullYear(), new Date(today).getMonth(), new Date(today).getDate() + days, Math.floor(hours), (hours % 1) * 60).getTime()
  if (teamID === '910001') {
    return {
      next: [
        { id: '510001', home: demoHome, away: demoAway, league: demoLeague, venue: 'Harbour Road', at: demoKickoff(now) },
        { id: '510002', home: 'Riverside Rovers', away: demoHome, league: demoLeague, venue: 'Mill Lane', at: local(6, 15) },
        { id: '510003', home: demoHome, away: 'Northgate United', league: demoLeague, venue: 'Harbour Road', at: local(13, 17.5) },
      ],
      last: [
        { id: '510011', home: 'Riverside Rovers', away: demoHome, league: demoLeague, venue: 'Mill Lane', at: local(-3, 15), score: [1, 3] },
        { id: '510012', home: demoHome, away: 'Westbrook Town', league: demoLeague, venue: 'Harbour Road', at: local(-10, 15), score: [2, 2] },
        { id: '510013', home: 'Eastvale Athletic', away: demoHome, league: demoLeague, venue: 'The Orchard', at: local(-17, 12.5), score: [0, 1] },
      ],
    }
  }
  if (teamID === '910002') {
    return {
      next: [
        { id: '520001', home: 'Summit Peaks', away: 'Bay Pilots', league: 'Pro Basketball League', venue: 'Altitude Arena', at: local(2, 19.5) },
        { id: '520002', home: 'Lakeshore Heat', away: 'Summit Peaks', league: 'Pro Basketball League', venue: 'Lakeshore Center', at: local(4, 20) },
      ],
      last: [
        { id: '520011', home: 'Summit Peaks', away: 'Lakeshore Heat', league: 'Pro Basketball League', venue: 'Altitude Arena', at: local(-2, 19.5), score: [104, 98] },
        { id: '520012', home: 'Bay Pilots', away: 'Summit Peaks', league: 'Pro Basketball League', venue: 'Harbor Dome', at: local(-5, 20), score: [112, 109] },
      ],
    }
  }
  return { next: [], last: [] }
}

const json = (g: Game) => ({
  idEvent: g.id,
  strEvent: `${g.home} vs ${g.away}`,
  strHomeTeam: g.home,
  strAwayTeam: g.away,
  strLeague: g.league,
  strVenue: g.venue,
  strTimestamp: stamp(g.at),
  intHomeScore: g.score ? String(g.score[0]) : null,
  intAwayScore: g.score ? String(g.score[1]) : null,
})

/** Answers TheSportsDB's three calls from the sample clubs. */
export function demoSports(path: string, query: Record<string, string>, now = Date.now()): unknown {
  if (path === 'searchteams.php') {
    const needle = (query.t ?? '').toLowerCase()
    return { teams: demoTeams.filter((t) => t.name.toLowerCase().includes(needle)).map((t) => ({ idTeam: t.id, strTeam: t.name, strLeague: t.league, strSport: t.sport, strCountry: t.country })) }
  }
  const { next, last } = fixtures(query.id ?? '', now)
  if (path === 'eventsnext.php') return { events: next.length ? next.map(json) : null }
  if (path === 'eventslast.php') return { results: last.length ? last.map(json) : null }
  throw new Error('Not in the sample data')
}

/** The sample viewer follows two of the clubs. */
export const demoFollowed = demoTeams.slice(0, 2)
