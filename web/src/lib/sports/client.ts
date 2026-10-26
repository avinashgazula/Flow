import { settingsStore } from '../store/settings'
import { sportsSettings } from './settings'
import type { SportsEvent, SportsTeam } from './types'

/* TheSportsDB, as FlowKit's SportsClient: team search and fixtures for Library → Sports. Its API sends
   `Access-Control-Allow-Origin: *`, so a page can call it directly; nothing here goes through the stream proxy.
   Sample data answers from the page instead (demo.ts), so a capture never depends on a live fixture list. */

export class SportsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

const origin = 'https://www.thesportsdb.com/api/v1/json'

async function get(path: string, query: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const settings = settingsStore.get()
  if (settings.demo) return (await import('./demo')).demoSports(path, query)
  const key = sportsSettings(settings).apiKey.trim() || '123'
  const url = `${origin}/${encodeURIComponent(key)}/${path}?${new URLSearchParams(query)}`
  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SportsError('Flow couldn’t reach TheSportsDB. Check your connection, then try again.')
  }
  if (response.status === 401 || response.status === 403) throw new SportsError('TheSportsDB didn’t accept that key. Check it in Settings → Live TV.', response.status)
  if (!response.ok) throw new SportsError(`TheSportsDB answered ${response.status}. Try again in a moment.`, response.status)
  // An unknown team or an empty season comes back as `{"teams":null}` rather than an error.
  return response.json().catch(() => ({}))
}

export const sports = {
  searchTeams: async (name: string, signal?: AbortSignal): Promise<SportsTeam[]> => ((await get('searchteams.php', { t: name }, signal)).teams ?? []).map(team).filter((t: SportsTeam | undefined): t is SportsTeam => !!t),
  nextEvents: async (teamID: string, signal?: AbortSignal): Promise<SportsEvent[]> => ((await get('eventsnext.php', { id: teamID }, signal)).events ?? []).map(event).filter((e: SportsEvent | undefined): e is SportsEvent => !!e),
  lastEvents: async (teamID: string, signal?: AbortSignal): Promise<SportsEvent[]> => ((await get('eventslast.php', { id: teamID }, signal)).results ?? []).map(event).filter((e: SportsEvent | undefined): e is SportsEvent => !!e),
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
/** TheSportsDB writes scores as strings, and null before a game is over. */
const score = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isInteger(n) ? n : undefined
}
const web = (v: unknown) => {
  const t = text(v)
  return t && /^https?:\/\//.test(t) ? t : undefined
}

export function team(raw: any): SportsTeam | undefined {
  const id = text(raw?.idTeam)
  const name = text(raw?.strTeam)
  if (!id || !name) return undefined
  return { id, name, league: text(raw.strLeague), sport: text(raw.strSport), badgeURL: web(raw.strBadge ?? raw.strTeamBadge), country: text(raw.strCountry) }
}

/** A game's kick-off. TheSportsDB gives UTC without a zone ("2026-10-25T14:00:00"), or a date and a time apart. */
export function kickoff(raw: any): number | undefined {
  const stamp = text(raw?.strTimestamp)
  const iso = stamp ? (/(Z|[+-]\d{2}:?\d{2})$/.test(stamp) ? stamp : `${stamp}Z`) : text(raw?.dateEvent) ? `${text(raw.dateEvent)}T${text(raw.strTime) ?? '00:00:00'}Z` : undefined
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : undefined
}

export function event(raw: any): SportsEvent | undefined {
  const id = text(raw?.idEvent)
  if (!id) return undefined
  return {
    id,
    title: text(raw.strEvent) ?? '',
    homeTeam: text(raw.strHomeTeam),
    awayTeam: text(raw.strAwayTeam),
    league: text(raw.strLeague),
    venue: text(raw.strVenue),
    date: kickoff(raw),
    homeScore: score(raw.intHomeScore),
    awayScore: score(raw.intAwayScore),
    thumbnailURL: web(raw.strThumb),
  }
}
