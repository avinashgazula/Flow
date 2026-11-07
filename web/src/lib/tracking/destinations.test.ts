import { describe, expect, it } from 'vitest'
import { defaultSettings, type Settings, type TraktToken } from '../store/settings'
import type { Op } from '../trakt/store'
import { destinationChoices, hasRole, listDestination, opsFor, rolesOf } from './destinations'
import { scrobbleEnabled } from './service'

const token: TraktToken = { accessToken: 'a', refreshToken: null, expiresAt: null, redirectURI: null }
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...extra })
const signedIn = { traktAccount: token, simklAccount: token, mdblistKey: 'k' }

describe('where each list is saved', () => {
  it('lets the watchlist follow Tracking With until a destination is chosen, and keeps favourites on this device', () => {
    expect(listDestination(settings(), 'watchlist')).toBe('local')
    expect(listDestination(settings({ simklAccount: token }), 'watchlist')).toBe('simkl')
    expect(listDestination(settings({ ...signedIn, tracker: 'mdblist' }), 'watchlist')).toBe('mdblist')
    expect(listDestination(settings({ traktAccount: token }), 'favourites')).toBe('local')
  })

  it('follows a choice, whatever tracks', () => {
    const s = settings({ ...signedIn, tracker: 'simkl', watchlistDestination: 'mdblist', favouritesDestination: 'trakt' })
    expect(listDestination(s, 'watchlist')).toBe('mdblist')
    expect(listDestination(s, 'favourites')).toBe('trakt')
    expect(listDestination(settings({ ...signedIn, watchlistDestination: 'local' }), 'watchlist')).toBe('local')
  })

  it('falls back to this device when the sign-in or key is gone, and returns with it', () => {
    expect(listDestination(settings({ watchlistDestination: 'trakt' }), 'watchlist')).toBe('local')
    expect(listDestination(settings({ watchlistDestination: 'mdblist', mdblistKey: ' ' }), 'watchlist')).toBe('local')
    expect(listDestination(settings({ watchlistDestination: 'trakt', traktAccount: token }), 'watchlist')).toBe('trakt')
  })

  it('keeps favourites on Trakt only, as the apps do', () => {
    expect(listDestination(settings({ ...signedIn, favouritesDestination: 'simkl' }), 'favourites')).toBe('local')
    expect(listDestination(settings({ ...signedIn, favouritesDestination: 'mdblist' }), 'favourites')).toBe('local')
  })

  it('offers only what can be chosen: services that are signed in, then this device', () => {
    expect(destinationChoices('watchlist', settings())).toEqual(['local'])
    expect(destinationChoices('watchlist', settings({ simklAccount: token, mdblistKey: 'k' }))).toEqual(['simkl', 'mdblist', 'local'])
    expect(destinationChoices('watchlist', settings(signedIn))).toEqual(['trakt', 'simkl', 'mdblist', 'local'])
    expect(destinationChoices('favourites', settings(signedIn))).toEqual(['trakt', 'local'])
    expect(destinationChoices('favourites', settings({ simklAccount: token }))).toEqual(['local'])
  })
})

describe('what each service does', () => {
  it('gives tracking and a list to different services', () => {
    const s = settings({ ...signedIn, tracker: 'simkl', watchlistDestination: 'mdblist', favouritesDestination: 'trakt' })
    expect(rolesOf('simkl', s)).toEqual({ track: true, watchlist: false, favourites: false })
    expect(rolesOf('mdblist', s)).toEqual({ track: false, watchlist: true, favourites: false })
    expect(rolesOf('trakt', s)).toEqual({ track: false, watchlist: false, favourites: true })
  })

  it('leaves a signed-in service with nothing to do when this device holds everything', () => {
    const s = settings({ ...signedIn, tracker: 'local', watchlistDestination: 'local' })
    for (const kind of ['trakt', 'simkl', 'mdblist'] as const) expect(hasRole(rolesOf(kind, s))).toBe(false)
  })

  it('does everything with one service by default, as before destinations were a setting', () => {
    const s = settings({ traktAccount: token })
    expect(rolesOf('trakt', s)).toEqual({ track: true, watchlist: true, favourites: false })
  })
})

describe('routing a change', () => {
  const ops: Op[] = [
    { kind: 'watchlist', type: 'movie', id: 1, on: true },
    { kind: 'favourite', type: 'movie', id: 2, on: true },
    { kind: 'watched', type: 'movie', id: 3, at: '2026-10-24T10:00:00Z' },
    { kind: 'rate', type: 'movie', id: 4, rating: 8 },
    { kind: 'unplayback', type: 'movie', id: 5 },
  ]

  it('sends list changes to the service that holds the list and the rest to the one that tracks', () => {
    expect(opsFor(ops, { track: true, watchlist: false, favourites: false }).map((o) => o.kind)).toEqual(['watched', 'rate', 'unplayback'])
    expect(opsFor(ops, { track: false, watchlist: true, favourites: false }).map((o) => o.kind)).toEqual(['watchlist'])
    expect(opsFor(ops, { track: false, watchlist: false, favourites: true }).map((o) => o.kind)).toEqual(['favourite'])
    expect(opsFor(ops, { track: true, watchlist: true, favourites: true })).toEqual(ops)
    expect(opsFor(ops, { track: false, watchlist: false, favourites: false })).toEqual([])
  })
})

describe('scrobbling', () => {
  it('is on unless switched off', () => {
    expect(scrobbleEnabled({})).toBe(true)
    expect(scrobbleEnabled({ scrobble: true })).toBe(true)
    expect(scrobbleEnabled({ scrobble: false })).toBe(false)
  })
})
