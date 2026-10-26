import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoGuide } from '../livetv/demo'
import { parseXMLTV } from '../livetv/xmltv'
import type { Channel, EPG, Programme } from '../livetv/types'
import { settingsStore } from '../store/settings'
import { event, kickoff, sports, team } from './client'
import { demoSports, demoTeams } from './demo'
import { demoKickoff } from './demoFixture'
import { matchChannels, normalised } from './match'
import { defaultSports, isFinished, isSportsSettings } from './types'

describe('TheSportsDB responses', () => {
  it('reads a team, with the badge under either name it has had', () => {
    expect(team({ idTeam: '133604', strTeam: 'Arsenal', strLeague: 'English Premier League', strSport: 'Soccer', strCountry: 'England', strBadge: 'https://r2.thesportsdb.com/b.png' })).toEqual({
      id: '133604',
      name: 'Arsenal',
      league: 'English Premier League',
      sport: 'Soccer',
      badgeURL: 'https://r2.thesportsdb.com/b.png',
      country: 'England',
    })
    expect(team({ idTeam: '1', strTeam: 'A', strTeamBadge: 'https://x.test/old.png' })?.badgeURL).toBe('https://x.test/old.png')
    expect(team({ idTeam: '1' })).toBeUndefined()
    expect(team({ idTeam: '1', strTeam: 'A', strBadge: 'javascript:alert(1)' })?.badgeURL).toBeUndefined()
  })

  it('reads kick-off as UTC when the zone is missing, and as given when it is not', () => {
    const utc = Date.UTC(2026, 9, 25, 14, 0)
    expect(kickoff({ strTimestamp: '2026-10-25T14:00:00' })).toBe(utc)
    expect(kickoff({ strTimestamp: '2026-10-25T14:00:00Z' })).toBe(utc)
    expect(kickoff({ strTimestamp: '2026-10-25T15:00:00+01:00' })).toBe(utc)
    expect(kickoff({ dateEvent: '2026-10-25', strTime: '14:00:00' })).toBe(utc)
    expect(kickoff({ dateEvent: '2026-10-25' })).toBe(Date.UTC(2026, 9, 25))
    expect(kickoff({})).toBeUndefined()
    expect(kickoff({ strTimestamp: 'soon' })).toBeUndefined()
  })

  it('reads a game, with scores that arrive as strings or not at all', () => {
    const g = event({ idEvent: '1', strEvent: 'A vs B', strHomeTeam: 'A', strAwayTeam: 'B', strLeague: 'L', strVenue: 'V', strTimestamp: '2026-10-25T14:00:00', intHomeScore: '2', intAwayScore: '0', strThumb: 'https://x.test/t.jpg' })!
    expect(g).toMatchObject({ id: '1', title: 'A vs B', homeTeam: 'A', awayTeam: 'B', league: 'L', venue: 'V', homeScore: 2, awayScore: 0, thumbnailURL: 'https://x.test/t.jpg' })
    expect(isFinished(g)).toBe(true)
    const next = event({ idEvent: '2', strEvent: 'C vs D', intHomeScore: null, intAwayScore: null })!
    expect(next.homeScore).toBeUndefined()
    expect(isFinished(next)).toBe(false)
    expect(isFinished(event({ idEvent: '3', intHomeScore: '', intAwayScore: 'x' })!)).toBe(false)
    expect(event({ strEvent: 'no id' })).toBeUndefined()
  })
})

describe('the client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    settingsStore.set({ demo: false })
  })

  it('calls TheSportsDB directly with the key from Settings, the free one by default', async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ teams: [{ idTeam: '1', strTeam: 'A' }] })))
    vi.stubGlobal('fetch', fetch)
    settingsStore.set({ demo: false, sports: undefined })
    expect(await sports.searchTeams('Arse nal')).toEqual([{ id: '1', name: 'A' }].map((t) => expect.objectContaining(t)))
    expect(fetch.mock.calls[0]![0]).toBe('https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=Arse+nal')
    settingsStore.set({ sports: { ...defaultSports, apiKey: ' my key ' } })
    await sports.nextEvents('42')
    expect(fetch.mock.calls[1]![0]).toBe('https://www.thesportsdb.com/api/v1/json/my%20key/eventsnext.php?id=42')
  })

  it('treats an empty answer as no games, and says what went wrong otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events: null }))))
    expect(await sports.nextEvents('1')).toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    await expect(sports.lastEvents('1')).rejects.toThrow(/didn’t accept that key/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    await expect(sports.lastEvents('1')).rejects.toThrow(/answered 500/)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(sports.lastEvents('1')).rejects.toThrow(/couldn’t reach TheSportsDB/)
  })

  it('answers from the sample clubs while sample data is on, without a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    settingsStore.set({ demo: true })
    const next = await sports.nextEvents(demoTeams[0]!.id)
    const last = await sports.lastEvents(demoTeams[0]!.id)
    expect(fetch).not.toHaveBeenCalled()
    expect(next.length).toBeGreaterThan(1)
    expect(next.every((g) => !isFinished(g))).toBe(true)
    expect(last.length).toBeGreaterThan(1)
    expect(last.every(isFinished)).toBe(true)
    expect((await sports.searchTeams('summit')).map((t) => t.name)).toEqual(['Summit Peaks'])
  })
})

describe('the sample sports data', () => {
  const now = Date.parse('2026-10-25T22:55:00Z')

  it('always has a game about to start, to come and gone, counted from now', () => {
    const next = (demoSports('eventsnext.php', { id: demoTeams[0]!.id }, now) as { events: Record<string, unknown>[] }).events.map(event)
    expect(next[0]!.date).toBe(demoKickoff(now))
    expect(next[0]!.date! - now).toBeGreaterThanOrEqual(3_600_000)
    expect(next[0]!.date! - now).toBeLessThanOrEqual(5_400_000)
    expect(next.map((g) => g!.date!).every((d, i, all) => i === 0 || d > all[i - 1]!)).toBe(true)
    const last = (demoSports('eventslast.php', { id: demoTeams[0]!.id }, now) as { results: Record<string, unknown>[] }).results.map(event)
    expect(last.every((g) => g!.date! < now)).toBe(true)
  })

  it('has the sample game on two channels of the sample guide, the one naming both clubs first', () => {
    const [game] = (demoSports('eventsnext.php', { id: demoTeams[0]!.id }, now) as { events: Record<string, unknown>[] }).events.map(event)
    const epg = parseXMLTV(demoGuide(now))
    const channels: Channel[] = ['sport.hd', 'arena', 'flow.news'].map((id, i) => ({ id: `p:${id}`, providerID: 'p', name: id, number: i + 1, group: 'Sports', streamURL: 'x', epgID: id, hasCatchup: false }))
    const matches = matchChannels(game!, channels, epg, now)
    expect(matches.map((m) => m.channel.epgID)).toEqual(['sport.hd', 'arena'])
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score)
    expect(matches[0]!.programme!.title).toContain('Harbour City v Eastvale Athletic')
  })
})

describe('finding the channels for a game', () => {
  const kick = Date.parse('2026-10-25T15:00:00Z')
  const game = { id: '1', title: 'Barcelona vs Real Madrid', homeTeam: 'FC Barcelona', awayTeam: 'Real Madrid CF', league: 'Spanish La Liga', date: kick }
  const channel = (id: string, name: string, extra: Partial<Channel> = {}): Channel => ({ id, providerID: 'p', name, group: 'Sports', streamURL: 'x', epgID: id, hasCatchup: false, ...extra })
  const prog = (channelID: string, title: string, start: number, end: number, extra: Partial<Programme> = {}): Programme => ({ channelID, title, start, end, ...extra })
  const guide = (list: Programme[]): EPG => ({ programmes: Object.fromEntries([...new Set(list.map((p) => p.channelID))].map((id) => [id, list.filter((p) => p.channelID === id).sort((a, b) => a.start - b.start)])), displayNames: {} })
  const h = 3_600_000

  it('folds accents, punctuation and club prefixes, so FC Barcelona and Barcelona agree', () => {
    expect(normalised('FC Barcelona')).toBe('barcelona')
    expect(normalised('Atlético de Madrid')).toBe('atletico de madrid')
    expect(normalised('AFC Ajax — The Hague')).toBe('ajax hague')
  })

  it('prefers a programme naming both teams, then one naming a team, and ranks the airing one higher', () => {
    const channels = [channel('a', 'A', { number: 3 }), channel('b', 'B', { number: 2 }), channel('c', 'C', { number: 1 }), channel('d', 'D')]
    const epg = guide([
      prog('a', 'La Liga: Barcelona v Real Madrid', kick, kick + 2 * h),
      prog('b', 'Barcelona Matchday', kick, kick + 2 * h),
      prog('c', 'Highlights: Barcelona v Real Madrid', kick + 2.5 * h, kick + 3 * h), // starts after kick-off by more than 15 minutes
      prog('d', 'Cooking Hour', kick, kick + h),
    ])
    const matches = matchChannels(game, channels, epg, kick)
    expect(matches.map((m) => [m.channel.id, m.score])).toEqual([['a', 110], ['c', 100], ['b', 60]])
    expect(matches[0]!.programme!.title).toContain('Barcelona v Real Madrid')
  })

  it('looks only from half an hour before kick-off to three hours after', () => {
    const channels = [channel('early', 'E'), channel('late', 'L'), channel('over', 'O'), channel('past', 'P')]
    const epg = guide([
      prog('early', 'Barcelona v Real Madrid', kick - 2 * h, kick - 0.4 * h), // ends 24 minutes before kick-off... still inside the half hour
      prog('late', 'Barcelona v Real Madrid', kick + 3.2 * h, kick + 4 * h),
      prog('over', 'Barcelona v Real Madrid', kick + 2.9 * h, kick + 4 * h),
      prog('past', 'Barcelona v Real Madrid', kick - 3 * h, kick - 0.6 * h),
    ])
    expect(matchChannels(game, channels, epg, kick).map((m) => m.channel.id).sort()).toEqual(['early', 'over'])
  })

  it('adds to a channel named after the league, and lists such a channel alone when the guide says nothing', () => {
    const channels = [channel('x', 'Spanish La Liga HD', { group: 'Football' }), channel('y', 'Other'), channel('z', 'Z', { group: 'Spanish La Liga' })]
    const epg = guide([prog('y', 'Barcelona v Real Madrid', kick, kick + 2 * h)])
    const matches = matchChannels(game, channels, epg, kick)
    expect(matches.map((m) => [m.channel.id, m.score])).toEqual([['y', 110], ['x', 20], ['z', 20]])
    expect(matches[1]!.programme).toBeUndefined()
  })

  it('finds a team in the subtitle or the description, and matches nothing without teams', () => {
    const channels = [channel('s', 'S'), channel('t', 'T')]
    const epg = guide([prog('s', 'Football Live', kick, kick + 2 * h, { subtitle: 'Real Madrid at Barcelona' }), prog('t', 'Football', kick, kick + 2 * h, { description: 'Tonight: Barcelona host the champions.' })])
    expect(matchChannels(game, channels, epg, kick).map((m) => [m.channel.id, m.score])).toEqual([['s', 110], ['t', 60]])
    expect(matchChannels({ id: '2', title: '' }, channels, epg, kick)).toEqual([])
  })

  it('breaks a tie by channel number, then name', () => {
    const channels = [channel('n2', 'Zed', { number: 2 }), channel('n1', 'Beta', { number: 1 }), channel('u2', 'Beta'), channel('u1', 'Alpha')]
    const epg = guide(channels.map((c) => prog(c.id, 'Barcelona v Real Madrid', kick, kick + 2 * h)))
    expect(matchChannels(game, channels, epg, kick).map((m) => m.channel.id)).toEqual(['n1', 'n2', 'u1', 'u2'])
  })
})

describe('Sports settings in a backup', () => {
  it('accepts any part of them, and refuses what is malformed', () => {
    expect(isSportsSettings({})).toBe(true)
    expect(isSportsSettings({ ...defaultSports, followedTeams: [{ id: '1', name: 'A', league: 'L' }] })).toBe(true)
    expect(isSportsSettings({ apiKey: 5 })).toBe(false)
    expect(isSportsSettings({ followedTeams: [{ id: '', name: 'A' }] })).toBe(false)
    expect(isSportsSettings({ followedTeams: 'all' })).toBe(false)
    expect(isSportsSettings({ showScoreSpoilers: 'yes' })).toBe(false)
    expect(isSportsSettings(null)).toBe(false)
  })
})
