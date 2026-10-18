import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../lib/store/settings'
import { backupFormat, createBackup, parseBackup } from './backup'

const library = { progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {} }

describe('settings backup', () => {
  it('round-trips settings and library', () => {
    const text = JSON.stringify(createBackup({ ...defaultSettings, language: 'fr-FR' }, library))
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.settings.language).toBe('fr-FR')
      expect(parsed.library.history).toEqual([])
      expect(parsed.skipped).toEqual([])
    }
  })

  it('rejects files that are not backups', () => {
    expect(parseBackup('nope').ok).toBe(false)
    expect(parseBackup('{"hello":1}').ok).toBe(false)
    expect(parseBackup(JSON.stringify({ format: backupFormat, version: 1 })).ok).toBe(false)
  })

  it('refuses a newer version', () => {
    const r = parseBackup(JSON.stringify({ format: backupFormat, version: 2, settings: { demo: true } }))
    expect(r.ok).toBe(false)
  })

  it('keeps known keys of the right type and reports the rest', () => {
    const r = parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { demo: 'yes', autoplayNext: false, preferredQuality: '4k', unknown: 1, addons: [{ url: 'https://a', name: 'A', enabled: true }] } }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings).toEqual({ autoplayNext: false, addons: [{ url: 'https://a', name: 'A', enabled: true }] })
      expect(r.skipped.sort()).toEqual(['demo', 'preferredQuality'])
    }
  })

  it('skips malformed servers', () => {
    const r = parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { autoplayNext: true, servers: [{ id: 'x', kind: 'kodi', url: 'u', token: 't' }] } }))
    expect(r.ok && r.skipped).toEqual(['servers'])
  })
})
