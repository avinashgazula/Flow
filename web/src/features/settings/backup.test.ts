import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../lib/store/settings'
import { defaultSubtitleStyle } from '../../lib/store/subtitleStyle'
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

  it('keeps a stream proxy address, and an empty one', () => {
    const parse = (streamProxy: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { autoplayNext: true, streamProxy } }))
    for (const good of ['https://proxy.example.com/?url={url}', 'https://proxy.example.com/', '']) {
      const r = parse(good)
      expect(r.ok && r.settings.streamProxy).toBe(good)
    }
    expect(defaultSettings.streamProxy).toBe('')
  })

  it('round-trips Live TV providers and favourites, and the default is empty', () => {
    const liveTV = {
      providers: [
        { id: 'a', name: 'Playlist', kind: 'm3u', url: 'https://iptv.example/list.m3u', epgURL: 'https://iptv.example/guide.xml.gz', enabled: true, useForVOD: true },
        { id: 'b', name: 'Panel', kind: 'xtream', url: 'http://panel.example:8080', username: 'me', password: 'secret', enabled: false, useForVOD: false, userAgent: 'Flow/1.0' },
      ],
      epgRefreshHours: 6,
      favouriteChannelIDs: ['a:bbc1:0'],
      recentChannelIDs: [],
      hideEmptyGroups: true,
    }
    const parsed = parseBackup(JSON.stringify(createBackup({ ...defaultSettings, liveTV: liveTV as never }, library)))
    expect(parsed.ok && parsed.settings.liveTV).toEqual(liveTV)
    expect(parsed.ok && parsed.skipped).toEqual([])
    expect(defaultSettings.liveTV.providers).toEqual([])
  })

  it('skips Live TV settings with a provider Flow can’t use', () => {
    const base = { epgRefreshHours: 12, favouriteChannelIDs: [], recentChannelIDs: [], hideEmptyGroups: true }
    const provider = { id: 'a', name: 'P', kind: 'm3u', url: 'https://iptv.example/list.m3u', enabled: true, useForVOD: true }
    for (const bad of [
      { ...base, providers: [{ ...provider, kind: 'stalker' }] },
      { ...base, providers: [{ ...provider, url: 'javascript:alert(1)' }] },
      { ...base, providers: [{ ...provider, url: 'iptv.example/list.m3u' }] },
      { ...base, providers: [{ ...provider, epgURL: 'nonsense' }] },
      { ...base, providers: [{ ...provider, enabled: 'yes' }] },
      { ...base, providers: [provider], epgRefreshHours: 0 },
      { ...base, providers: [provider], favouriteChannelIDs: [1] },
      'nope',
    ]) {
      const r = parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { autoplayNext: true, liveTV: bad } }))
      expect(r.ok && r.skipped).toEqual(['liveTV'])
    }
  })

  it('skips a stream proxy that isn’t an address Flow can call', () => {
    for (const bad of [7, null, 'proxy.example.com', 'javascript:alert(1)', 'http://proxy.example.com/?url={url}']) {
      const r = parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { autoplayNext: true, streamProxy: bad } }))
      expect(r.ok && r.skipped).toEqual(['streamProxy'])
      expect(r.ok && 'streamProxy' in r.settings).toBe(false)
    }
  })

  it('keeps audio and subtitle choices, and skips ones that make no sense', () => {
    const parse = (settings: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings }))
    const good = parse({ audioLanguages: ['original', 'fr'], subtitleLanguages: ['en'], subtitleMode: 'always' })
    expect(good.ok && good.settings).toEqual({ audioLanguages: ['original', 'fr'], subtitleLanguages: ['en'], subtitleMode: 'always' })
    const bad = parse({ autoplayNext: true, audioLanguages: ['en', 3], subtitleMode: 'sometimes' })
    expect(bad.ok && bad.skipped.sort()).toEqual(['audioLanguages', 'subtitleMode'])
  })

  it('defaults to the title’s original language, then the browser’s, and foreign audio only', () => {
    expect(defaultSettings.audioLanguages[0]).toBe('original')
    expect(defaultSettings.audioLanguages[1]).toBe(defaultSettings.subtitleLanguages[0])
    expect(defaultSettings.subtitleMode).toBe('foreign')
  })

  describe('subtitle style', () => {
    const parse = (subtitleStyle: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { autoplayNext: true, subtitleStyle } }))
    const custom = { fontScale: 1.4, font: 'serif', weight: 'heavy', color: 'cyan', edgeStyle: 'outline', background: 'solid', backgroundOpacity: 0.8, verticalPosition: 0.2 }

    it('matches the apps’ defaults', () => {
      expect(defaultSettings.subtitleStyle).toEqual({ fontScale: 1, font: 'system', weight: 'semibold', color: 'white', edgeStyle: 'dropShadow', background: 'none', backgroundOpacity: 0.6, verticalPosition: 0 })
    })

    it('round-trips through a backup with the apps’ key names', () => {
      const text = JSON.stringify(createBackup({ ...defaultSettings, subtitleStyle: custom as typeof defaultSubtitleStyle }, library))
      expect(Object.keys(JSON.parse(text).settings.subtitleStyle).sort()).toEqual(['background', 'backgroundOpacity', 'color', 'edgeStyle', 'font', 'fontScale', 'verticalPosition', 'weight'])
      const r = parseBackup(text)
      expect(r.ok && r.settings.subtitleStyle).toEqual(custom)
      expect(r.ok && r.skipped).toEqual([])
    })

    it('fills fields a backup leaves out with the defaults', () => {
      const r = parse({ font: 'rounded', fontScale: 1.2 })
      expect(r.ok && r.settings.subtitleStyle).toEqual({ ...defaultSubtitleStyle, font: 'rounded', fontScale: 1.2 })
    })

    it('reads the apps’ older shadow background as none', () => {
      const r = parse({ background: 'shadow' })
      expect(r.ok && r.settings.subtitleStyle?.background).toBe('none')
    })

    it('skips a style with a choice or a number outside the allowed ones', () => {
      for (const bad of [{ font: 'comic' }, { weight: 'black' }, { color: 'red' }, { edgeStyle: 'glow' }, { background: 'blur' }, { fontScale: 3 }, { fontScale: 0.5 }, { backgroundOpacity: 1.5 }, { verticalPosition: 0.5 }, { verticalPosition: '0.1' }, [], 'big', null]) {
        const r = parse(bad)
        expect(r.ok && r.skipped).toEqual(['subtitleStyle'])
        expect(r.ok && 'subtitleStyle' in r.settings).toBe(false)
      }
    })
  })

  describe('skip settings', () => {
    const parse = (settings: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings }))

    it('defaults to the apps’: buttons for intros, recaps and credits, asking after three episodes, and no keys', () => {
      expect(defaultSettings).toMatchObject({ skipIntro: 'button', skipRecap: 'button', skipCredits: 'button', stillWatchingAfterEpisodes: 3, introDBKey: '', publicMetaDBKey: '' })
    })

    it('keeps them', () => {
      const r = parse({ skipIntro: 'automatic', skipRecap: 'off', skipCredits: 'button', stillWatchingAfterEpisodes: 0, introDBKey: 'idb_x', publicMetaDBKey: 'pm-y' })
      expect(r.ok && r.settings).toEqual({ skipIntro: 'automatic', skipRecap: 'off', skipCredits: 'button', stillWatchingAfterEpisodes: 0, introDBKey: 'idb_x', publicMetaDBKey: 'pm-y' })
    })

    it('skips ones that make no sense', () => {
      const r = parse({ autoplayNext: true, skipIntro: 'sometimes', skipCredits: 2, stillWatchingAfterEpisodes: -1, introDBKey: 5 })
      expect(r.ok && r.skipped.sort()).toEqual(['introDBKey', 'skipCredits', 'skipIntro', 'stillWatchingAfterEpisodes'])
    })
  })
})
