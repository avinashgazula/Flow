import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { noExtras, setupExtrasStore } from '../../lib/setup/extras'
import { defaultSettings, settingsStore } from '../../lib/store/settings'
import { libraryStore } from '../../lib/store/library'
import { createBackup, resetEverything } from './backup'
import { applySetup, createSetup, importAnything, readSetup } from './setup'

const fixture = readFileSync(new URL('../../lib/setup/fixtures/app-setup.json', import.meta.url), 'utf8')

beforeEach(() => {
  resetEverything()
  setupExtrasStore.set(noExtras)
})

describe('importing a setup from the apps', () => {
  it('passes every field through the website’s own rules', () => {
    const read = readSetup(fixture)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    // Nothing the apps wrote is refused by the validators.
    expect(read.skipped).toEqual([])
    expect(read.settings).toMatchObject({ startTab: 'live', tmdbKey: 'tmdb-key-from-app', subtitleMode: 'forced' })
  })

  it('replaces the settings, remembers the rest, and takes the key as a way in', () => {
    const read = readSetup(fixture)
    if (!read.ok) throw new Error(read.error)
    applySetup(read)
    const s = settingsStore.get()
    expect(s).toMatchObject({ tmdbKey: 'tmdb-key-from-app', onboarded: true, demo: false, language: 'fr-FR', startTab: 'live' })
    expect(s.servers.map((v) => v.name)).toEqual(['Living Room', 'Plex'])
    expect(setupExtrasStore.get().settings).toMatchObject({ general: { accent: 'teal' }, downloads: { movieLimitGB: 40 } })
  })

  it('exports what it imported, for the apps to read again', () => {
    const read = readSetup(fixture)
    if (!read.ok) throw new Error(read.error)
    applySetup(read)
    const again = JSON.parse(createSetup(true).json)
    expect(again.settings.general).toMatchObject({ accent: 'teal', startTab: 'liveTV', contentShelfLength: 30 })
    expect(again.settings.mediaServers.servers[0]).toMatchObject({ id: 'server-1', isRemote: false, accessToken: 'jf-token' })
    expect(again.credentials).toMatchObject({ tmdbAPIKey: 'tmdb-key-from-app', traktClientSecret: 'trakt-secret' })
    // And back in again, nothing is lost or refused.
    const reread = readSetup(JSON.stringify(again))
    expect(reread.ok && reread.skipped).toEqual([])
  })

  it('names the file in the date it was made', () => {
    expect(createSetup(false, defaultSettings, new Date('2026-11-01T10:00:00Z')).filename).toBe('flow-setup-2026-11-01.json')
  })

  it('says what to do with a file that is not a setup', () => {
    const r = readSetup('{"hello":1}')
    expect(r.ok === false && r.error).toMatch(/Share Setup/)
  })
})

describe('Welcome’s import', () => {
  it('takes a setup', () => {
    expect(importAnything(fixture)).toEqual({ ok: true, what: 'setup' })
    expect(settingsStore.get().tmdbKey).toBe('tmdb-key-from-app')
  })

  it('takes the website’s own backup, library included', () => {
    const backup = createBackup({ ...defaultSettings, tmdbKey: 'from-backup' }, { ...libraryStore.get(), watchlist: [{ id: 1, mediaType: 'movie' } as never] })
    expect(importAnything(JSON.stringify(backup))).toEqual({ ok: true, what: 'backup' })
    expect(settingsStore.get()).toMatchObject({ tmdbKey: 'from-backup', onboarded: true })
    expect(libraryStore.get().watchlist).toHaveLength(1)
  })

  it('refuses anything else', () => {
    expect(importAnything('nope').ok).toBe(false)
  })
})
