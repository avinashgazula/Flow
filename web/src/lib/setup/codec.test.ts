import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultSettings, type Settings } from '../store/settings'
import { exportSetup, extrasFrom, leftovers, overlaid, parseSetup, setupToJSON, setupToLink, settingsFromSetup, summariseSetup, type SetupBundle } from './codec'

/* The fixture is a setup as the apps write it (SetupShare.export, with secrets): Swift's key order and spellings,
   nil fields left out, every non-optional field of every list item present. Swift isn't available on the machine this
   was written on, so it follows the types in FlowKit's Settings.swift by hand; regenerate it from
   DataIntegrityTests' setup on a Mac if the model changes. */
const fixture = readFileSync(new URL('./fixtures/app-setup.json', import.meta.url), 'utf8')
const bundle = (): SetupBundle => {
  const parsed = parseSetup(fixture)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.bundle
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, any>

describe('reading the apps’ setup', () => {
  const read = settingsFromSetup(bundle(), defaultSettings) as Settings

  it('reads general and account settings', () => {
    expect(read).toMatchObject({
      startTab: 'live',
      tabOrder: ['live', 'home', 'explore', 'library', 'search'],
      showPosterTitles: false,
      heroSource: 'watchlist',
      heroSecondarySource: 'popular',
      heroStyle: 'fullscreen',
      heroAutoAdvance: false,
      contentShelfLength: 30,
      continueWatchingLimit: 10,
      filmDates: 'theatrical',
      upcomingWithinDays: 14,
      detailTextSize: 'large',
      showEpisodeSpoilers: false,
      showSpecialsSeason: false,
      showReleaseYear: true,
      showContinueWatchingReleaseDate: false,
      showWatchedBadges: false,
      tracker: 'trakt',
      // The apps' public addresses are the website's "empty".
      introDBBaseURL: '',
      publicMetaDBBaseURL: '',
    })
  })

  it('reads metadata, playback and subtitles', () => {
    expect(read).toMatchObject({
      language: 'fr-FR',
      region: 'FR',
      includeAdult: true,
      episodeSource: 'tmdb',
      showUnreleasedTitles: false,
      airDatesInLocalTimeZone: false,
      prefetchOnDetail: false,
      posterEnhancement: 'rpdb',
      // MyAnimeList has no score on the website.
      ratingsShown: ['imdb', 'tomatometer', 'trakt'],
      autoplayNext: false,
      askToResume: false,
      nextEpisodeCountdownSeconds: 20,
      seekBackwardSeconds: 15,
      seekForwardSeconds: 30,
      watchedThresholdPercent: 95,
      skipIntro: 'off',
      skipCredits: 'automatic',
      externalPlayer: 'infuse',
      matroskaPlayback: 'external',
      volumeBoostDB: 6,
      preferredQuality: '1080p',
      cellularResolutionCap: '720p',
      audioLanguages: ['en', 'fr'],
      subtitleLanguages: ['fr', 'en'],
      subtitleMode: 'forced',
      defaultSubtitleOffset: -1.5,
      subtitleStyle: { fontScale: 1.4, color: 'yellow', font: 'serif', weight: 'bold', edgeStyle: 'outline', background: 'solid', backgroundOpacity: 0.8, verticalPosition: 0.1 },
      subtitleOptions: { type: 'sdh', animeAudio: 'sub', keepASSStyling: true, providers: ['opensubtitles', 'wyzie'] },
      rememberLastSource: false,
    })
  })

  it('reads servers, shares, providers, add-ons and the Seerr connection', () => {
    expect(read.servers).toEqual([
      { id: 'server-1', kind: 'jellyfin', name: 'Living Room', url: 'https://jellyfin.example.com', token: 'jf-token', userId: 'user-1', username: 'viewer', enabled: true },
      { id: 'server-2', kind: 'plex', name: 'Plex', url: 'https://plex.example.com:32400', token: 'plex-token', machineId: 'abc123', enabled: false },
    ])
    expect(read).toMatchObject({ onlyShowServerContent: true, showBadgeOnPosters: false, useServerArtwork: true, trackOnlyWithTracker: true, serverHomeRowIDs: ['server-1'], seerr: { url: 'https://seerr.example.com', key: 'seerr-key' } })
    expect(read.webDAV).toEqual([{ id: 'dav-1', name: 'NAS', url: 'https://dav.example.com/files', username: 'me', password: 'secret', moviesPath: '/Films', showsPath: '/Series', enabled: true }])
    expect(read.liveTV.providers).toHaveLength(2)
    expect(read.liveTV.providers[0]).toMatchObject({ kind: 'xtream', username: 'viewer', password: 'hunter2', epgURL: 'https://iptv.example.com/guide.xml', useForVOD: true, userAgent: 'Flow/1.0' })
    expect(read.liveTV).toMatchObject({ epgRefreshHours: 6, hideEmptyGroups: false, favouriteChannelIDs: ['bbc-one', 'arte'] })
    expect(read.addons.map((a) => [a.url, a.enabled])).toEqual([
      ['https://addon.example.com/abc/manifest.json', true],
      ['https://other.example.com/manifest.json', false],
    ])
  })

  it('reads source rules, shelves and sports', () => {
    expect(read.sources).toMatchObject({
      useCustomOrdering: true,
      categoryOrder: ['addons', 'mediaServers', 'webDAV', 'iptv'],
      sortRules: [{ key: 'size', descending: false }, { key: 'resolution', descending: true }],
      resultCap: 20,
      timeoutSeconds: 30,
      autoPlayFirstSource: true,
      playFromLibraryOnly: true,
      preferPlayableAudio: false,
      // Monochrome reads as All Formats; the apps' 1440p minimum becomes the nearest the website offers.
      appearance: { badges: 'all', compact: true, titleDisplay: 'filename', showSize: false, showRawText: true },
      filters: { excludeCinemaCaptures: false, excludeUncached: true, minResolution: 1080, maxSizeGB: 20, excludedKeywords: ['hindi'], excludedCodecs: ['xvid'] },
    })
    expect(read.shelves.map((s) => s.title)).toEqual(['Continue Watching', 'Genres', 'Great Sci-Fi', 'Best Of', 'MDBList Picks'])
    expect(read.shelves[2]!.source).toMatchObject({ kind: 'discover', query: { genres: [878], minRating: 7, yearFrom: 2000 } })
    expect(read.shelves[3]!.source).toEqual({ kind: 'traktList', user: 'someone', slug: 'best-of' })
    expect(read.sports).toMatchObject({ apiKey: 'sports-key', showScoreSpoilers: false, chooseChannelOnTap: true, followedTeams: [{ id: '133604', name: 'Arsenal', league: 'English Premier League' }] })
  })

  it('reads the keys', () => {
    expect(read).toMatchObject({
      tmdbKey: 'tmdb-key-from-app',
      tvdbKey: 'tvdb-key',
      mdblistKey: 'mdb-key',
      introDBKey: 'intro-key',
      openSubtitlesKey: 'os-key',
      openSubtitlesUsername: 'os-user',
      openSubtitlesPassword: 'os-pass',
      subdlKey: 'subdl-key',
      wyzieKey: 'wyzie-key',
      traktClientID: 'trakt-id',
      simklClientID: 'simkl-id',
    })
  })

  it('keeps what the file lacks', () => {
    const current = { ...defaultSettings, tmdbKey: 'mine', servers: [{ id: 'server-1', kind: 'jellyfin' as const, name: 'x', url: 'https://jellyfin.example.com', token: 'old', userId: 'u', enabled: true }] }
    const noKeys: SetupBundle = { ...bundle(), credentials: undefined }
    const patch = settingsFromSetup(json({ ...noKeys, settings: { ...noKeys.settings, mediaServers: { servers: [{ id: 'server-1', kind: 'jellyfin', name: 'Living Room', baseURL: 'https://jellyfin.example.com', enabled: true, isRemote: true }] } } }) as SetupBundle, current)
    expect(patch.tmdbKey).toBeUndefined()
    expect(patch.servers![0]).toMatchObject({ token: 'old', userId: 'u', name: 'Living Room' })
  })
})

describe('writing a setup', () => {
  const mine: Settings = {
    ...defaultSettings,
    tmdbKey: 'my-tmdb',
    traktClientID: 'my-trakt',
    traktAccount: { accessToken: 'tok', refreshToken: 'ref', expiresAt: null, redirectURI: null },
    streamProxy: 'https://proxy.example.com/?u={url}',
    audioLanguages: ['original', 'en'],
    startTab: 'live',
    font: 'inter',
    servers: [{ id: 's1', kind: 'emby', name: 'Emby', url: 'https://emby.example.com', token: 'emby-token', userId: 'u1', enabled: true }],
    webDAV: [{ id: 'd1', name: 'NAS', url: 'https://dav.example.com', username: 'me', password: 'pw', moviesPath: '/Movies', showsPath: '/TV Shows', enabled: true }],
    seerr: { url: 'https://seerr.example.com', key: 'seerr-key' },
    addons: [{ url: 'https://addon.example.com/manifest.json', name: 'Add-on', enabled: true }],
    liveTV: { ...defaultSettings.liveTV, providers: [{ id: 'p1', name: 'IPTV', kind: 'm3u', url: 'https://iptv.example.com/list.m3u', password: 'pp', enabled: true, useForVOD: false }] },
  }
  const now = new Date('2026-11-01T10:00:00Z')

  it('writes the apps’ format, with Swift’s names and enums', () => {
    const b = exportSetup(mine, { includeSecrets: true, now })
    expect(b).toMatchObject({ format: 'flow-setup', version: 1, exportedAt: '2026-11-01T10:00:00.000Z' })
    const s = b.settings as Record<string, any>
    expect(s.general.startTab).toBe('liveTV')
    expect(s.general.tabOrder).toContain('liveTV')
    expect(s.general.tabOrder).not.toContain('live')
    expect(s.metadata.language).toBe(mine.language)
    expect(s.mediaServers.servers).toEqual([{ id: 's1', kind: 'emby', name: 'Emby', baseURL: 'https://emby.example.com', enabled: true, userID: 'u1', accessToken: 'emby-token', isRemote: true }])
    expect(s.mediaServers.seerr).toEqual({ baseURL: 'https://seerr.example.com', apiKey: 'seerr-key' })
    expect(s.webDAV[0]).toMatchObject({ baseURL: 'https://dav.example.com', password: 'pw' })
    expect(s.sources.addons).toEqual([{ manifestURL: 'https://addon.example.com/manifest.json', name: 'Add-on', enabled: true }])
    expect(s.sources.appearance.badgePack).toBe('colored')
    expect(s.subtitles.autoSelect).toBe('automatic')
    expect(s.playback.preferredAudioLanguage).toBe('en')
    expect(s.shelves[0]).toMatchObject({ id: 'continueWatching', source: { builtIn: { _0: 'continueWatching' } } })
    expect(s.account.tracker).toBe('trakt')
    expect(b.credentials).toEqual({ tmdbAPIKey: 'my-tmdb', traktClientID: 'my-trakt' })
  })

  it('leaves keys, tokens and passwords out when asked, and never exports sign-ins', () => {
    const b = exportSetup(mine, { includeSecrets: false, now })
    const text = setupToJSON(b)
    for (const secret of ['emby-token', '"userID"', '"password"', 'seerr-key', 'my-tmdb', 'my-trakt', 'proxy.example.com', '"tok"', 'credentials']) expect(text, secret).not.toContain(secret)
    const s = b.settings as Record<string, any>
    expect(s.mediaServers.seerr).toEqual({ baseURL: 'https://seerr.example.com', apiKey: '' })
    expect(s.webDAV[0].username).toBe('me')
    expect(setupToJSON(exportSetup(mine, { includeSecrets: true, now }))).not.toContain('"traktToken"')
  })

  it('round-trips through its own reader', () => {
    const back = settingsFromSetup(parseOk(setupToJSON(exportSetup(mine, { includeSecrets: true, now }))), defaultSettings) as Settings
    expect(back).toMatchObject({
      tmdbKey: 'my-tmdb',
      traktClientID: 'my-trakt',
      startTab: 'live',
      font: 'inter',
      audioLanguages: ['original', 'en'],
      streamProxy: 'https://proxy.example.com/?u={url}',
      servers: mine.servers,
      webDAV: mine.webDAV,
      seerr: mine.seerr,
      addons: mine.addons,
      shelves: mine.shelves,
      subtitleStyle: mine.subtitleStyle,
    })
    expect(back.liveTV.providers).toEqual(mine.liveTV.providers)
    expect(back.sources).toBeDefined()
  })

  it('writes a link the apps and this reader both open', () => {
    const b = exportSetup(mine, { includeSecrets: true, now })
    const link = setupToLink(b)
    expect(link.startsWith('flow://setup?d=')).toBe(true)
    expect(link.slice('flow://setup?d='.length)).not.toMatch(/[+/=]/)
    const parsed = parseSetup(link)
    expect(parsed.ok && parsed.bundle.settings).toEqual(json(b.settings))
    // Bare base64, which the apps accept too.
    expect(parseSetup(link.replace('flow://setup?d=', '')).ok).toBe(true)
  })

  it('gives every list item the fields the apps decode without a default', () => {
    const s = exportSetup(mine, { includeSecrets: false, now }).settings as Record<string, any>
    for (const server of s.mediaServers.servers) expect(server).toMatchObject({ id: expect.any(String), kind: expect.any(String), name: expect.any(String), baseURL: expect.any(String), enabled: expect.any(Boolean), isRemote: expect.any(Boolean) })
    for (const rule of s.sources.sortRules) expect(rule).toMatchObject({ key: expect.any(String), descending: expect.any(Boolean) })
    for (const p of s.liveTV.providers) expect(p).toMatchObject({ id: expect.any(String), name: expect.any(String), kind: expect.any(String), url: expect.any(String), enabled: expect.any(Boolean), useForVOD: expect.any(Boolean) })
  })
})

const parseOk = (text: string): SetupBundle => {
  const parsed = parseSetup(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.bundle
}

describe('keeping what the website has no setting for', () => {
  it('writes an imported setup back out whole', () => {
    const imported = bundle()
    const applied = { ...defaultSettings, ...settingsFromSetup(imported, defaultSettings) } as Settings
    const extras = extrasFrom(imported, applied)
    const out = exportSetup(applied, { includeSecrets: true, extras }).settings as Record<string, any>
    const was = imported.settings as Record<string, any>
    // The apps' own settings the website can't show.
    expect(out.general).toMatchObject({ accent: 'teal', appIcon: 'light', haptics: false, episodeNotifications: true, matchStartNotifications: true })
    expect(out.downloads).toEqual(was.downloads)
    expect(out.account).toMatchObject({ syncInterval: 900, scrobble: false, watchlistDestination: 'trakt' })
    expect(out.playback).toMatchObject({ pictureInPicture: false, autoRotate: false, convertDolbyVisionProfile7: false, showTracks: was.playback.showTracks, rememberLastSourcePerShow: false })
    expect(out.metadata).toMatchObject({ primarySource: 'trakt', ratingIconPackURL: 'https://icons.example.com/pack.json' })
    expect(out.mediaServers.preferDirectPlay).toBe(false)
    expect(out.mediaServers.servers[0].isRemote).toBe(false)
    expect(out.subtitles.autoSync).toBe(true)
    expect(out.sync).toEqual({ iCloudEnabled: false })
  })

  it('keeps a client secret the website has no field for, and only with keys', () => {
    const imported = bundle()
    const applied = { ...defaultSettings, ...settingsFromSetup(imported, defaultSettings) } as Settings
    const extras = extrasFrom(imported, applied)
    expect(extras.credentials).toEqual({ traktClientSecret: 'trakt-secret' })
    expect(exportSetup(applied, { includeSecrets: true, extras }).credentials).toMatchObject({ traktClientSecret: 'trakt-secret' })
    expect(exportSetup(applied, { includeSecrets: false, extras }).credentials).toBeUndefined()
  })

  it('does not bring back what was removed on the website', () => {
    const imported = bundle()
    const applied = { ...defaultSettings, ...settingsFromSetup(imported, defaultSettings) } as Settings
    const extras = extrasFrom(imported, applied)
    const trimmed: Settings = { ...applied, servers: applied.servers.filter((s) => s.id !== 'server-1'), continueWatchingLimit: null }
    const out = exportSetup(trimmed, { includeSecrets: true, extras }).settings as Record<string, any>
    expect(out.mediaServers.servers.map((s: { id: string }) => s.id)).toEqual(['server-2'])
    expect(out.general.continueWatchingLimit).toBeNull()
  })

  it('does not carry secrets from the extras into a file made without them', () => {
    const imported = bundle()
    const applied = { ...defaultSettings, ...settingsFromSetup(imported, defaultSettings) } as Settings
    const stuffed = { settings: { mediaServers: { servers: [{ id: 'server-1', accessToken: 'leak' }] }, web: { streamProxy: 'https://leak.example.com' } }, credentials: { traktClientSecret: 'leak' } }
    const text = setupToJSON(exportSetup(applied, { includeSecrets: false, extras: stuffed }))
    expect(text).not.toContain('leak')
  })

  it('subtracts and overlays lists item by item', () => {
    const from = { a: 1, b: { c: 2, d: 3 }, list: [{ id: 'x', keep: 1, mapped: 2 }, { id: 'y', mapped: 3 }], plain: [1, 2] }
    const taken = { a: 9, b: { c: 0 }, list: [{ id: 'x', mapped: 0 }], plain: [] }
    expect(leftovers(from, taken)).toEqual({ b: { d: 3 }, list: [{ id: 'x', keep: 1 }, { id: 'y', mapped: 3 }] })
    expect(overlaid({ b: { d: 3 }, list: [{ id: 'x', keep: 1 }, { id: 'gone', keep: 2 }] }, { b: { c: 5 }, list: [{ id: 'x', mapped: 1 }, { id: 'new' }] })).toEqual({ b: { d: 3, c: 5 }, list: [{ id: 'x', keep: 1, mapped: 1 }, { id: 'new' }] })
  })
})

describe('reading the file', () => {
  it('summarises what a setup holds', () => {
    expect(summariseSetup(bundle())).toMatchObject({ shelves: 5, servers: 2, webDAV: 1, providers: 2, addons: 2, hasKeys: true })
    expect(summariseSetup({ ...bundle(), credentials: undefined }).hasKeys).toBe(false)
  })

  it('refuses what is not a setup, and a newer version', () => {
    for (const text of ['', 'nope', '{}', '{"format":"flow-web-backup","settings":{}}', '{"format":"flow-setup"}', 'flow://setup?d=%%%']) expect(parseSetup(text).ok, text).toBe(false)
    const newer = parseSetup('{"format":"flow-setup","version":2,"settings":{}}')
    expect(newer.ok === false && newer.error).toMatch(/newer/)
  })

  it('reads an old setup that still has the legacy switches', () => {
    const old = parseOk(JSON.stringify({ format: 'flow-setup', version: 1, settings: { subtitles: { autoEnable: true, hearingImpaired: true, preferredLanguages: ['de'] } } }))
    expect(settingsFromSetup(old, defaultSettings)).toMatchObject({ subtitleMode: 'always', subtitleOptions: { type: 'sdh' }, subtitleLanguages: ['de'] })
  })

  it('treats a setup with no Seerr as clearing it, and keeps a key for the same address', () => {
    const none = parseOk(JSON.stringify({ format: 'flow-setup', settings: { mediaServers: { servers: [] } } }))
    const patch = settingsFromSetup(none, { ...defaultSettings, seerr: { url: 'https://s.example.com', key: 'k' } })
    expect('seerr' in patch && patch.seerr === undefined).toBe(true)
    const keyless = parseOk(JSON.stringify({ format: 'flow-setup', settings: { mediaServers: { seerr: { baseURL: 'https://s.example.com', apiKey: '' } } } }))
    expect(settingsFromSetup(keyless, { ...defaultSettings, seerr: { url: 'https://s.example.com', key: 'k' } }).seerr).toEqual({ url: 'https://s.example.com', key: 'k' })
  })

  it('keeps a password for the same share, and drops it for another address', () => {
    const file = (url: string) => parseOk(JSON.stringify({ format: 'flow-setup', settings: { webDAV: [{ id: 'd1', name: 'NAS', baseURL: url, moviesPath: '/M', showsPath: '/S', enabled: true }] } }))
    const current = { ...defaultSettings, webDAV: [{ id: 'd1', name: 'NAS', url: 'https://dav.example.com', password: 'pw', moviesPath: '/M', showsPath: '/S', enabled: true }] }
    expect(settingsFromSetup(file('https://dav.example.com'), current).webDAV![0]!.password).toBe('pw')
    expect(settingsFromSetup(file('https://elsewhere.example.com'), current).webDAV![0]!.password).toBeUndefined()
  })
})
