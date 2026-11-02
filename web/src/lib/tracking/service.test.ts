import { describe, expect, it } from 'vitest'
import { defaultSettings, type Settings, type TraktToken } from '../store/settings'
import { trackerBlurb, trackerName, trackerOrder, unavailable } from './labels'
import { activeTracker } from './service'

const token: TraktToken = { accessToken: 'a', refreshToken: null, expiresAt: null, redirectURI: null }
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...extra })

describe('which service tracks', () => {
  it('lists the services in the apps’ order, each with the apps’ name', () => {
    expect(trackerOrder.map((k) => trackerName[k])).toEqual(['Trakt', 'Simkl', 'PublicMetaDB', 'MDBList', 'This Device'])
    for (const kind of trackerOrder) expect(trackerBlurb[kind]).toMatch(/\.$/)
  })

  it('is this device until there is a sign-in, then the first sign-in when nothing was ever chosen', () => {
    expect(activeTracker(settings())).toBe('local')
    expect(activeTracker(settings({ simklAccount: token }))).toBe('simkl')
    expect(activeTracker(settings({ simklAccount: token, traktAccount: token }))).toBe('trakt')
    // A key alone doesn't choose: MDBList and PublicMetaDB track only when picked.
    expect(activeTracker(settings({ mdblistKey: 'k' }))).toBe('local')
  })

  it('follows a choice, and falls back to this device when its sign-in or key is gone', () => {
    expect(activeTracker(settings({ tracker: 'simkl', simklAccount: token, traktAccount: token }))).toBe('simkl')
    expect(activeTracker(settings({ tracker: 'local', traktAccount: token }))).toBe('local')
    expect(activeTracker(settings({ tracker: 'mdblist', mdblistKey: ' k ' }))).toBe('mdblist')
    expect(activeTracker(settings({ tracker: 'mdblist', mdblistKey: '  ' }))).toBe('local')
    expect(activeTracker(settings({ tracker: 'trakt' }))).toBe('local')
    // Back when the sign-in is.
    expect(activeTracker(settings({ tracker: 'trakt', traktAccount: token }))).toBe('trakt')
  })

  it('never lets PublicMetaDB track from a web page, and says why and what to do for the others', () => {
    expect(activeTracker(settings({ tracker: 'publicMetaDB', publicMetaDBKey: 'k' }))).toBe('local')
    expect(unavailable('publicMetaDB', settings())).toMatch(/only the apps/)
    expect(unavailable('trakt', settings())).toBe('Sign in to Trakt below first.')
    expect(unavailable('simkl', settings())).toBe('Sign in to Simkl below first.')
    expect(unavailable('mdblist', settings())).toBe('Add an MDBList API key in Settings → Metadata first.')
    expect(unavailable('local', settings())).toBeUndefined()
  })
})
