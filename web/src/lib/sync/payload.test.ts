import { describe, expect, it } from 'vitest'
import { defaultSettings, type Settings } from '../store/settings'
import { detectChanges, localValue, merge, overlay, parsePayload, settingsPatch, type Metas, type Payload } from './payload'

const t = (minutes: number) => new Date(Date.UTC(2026, 9, 24, 18, minutes, 0))
const iso = (minutes: number) => t(minutes).toISOString().replace('.000Z', 'Z')
const settings = (extra: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...extra })
const section = (minutes: number, data: unknown, device = 'iPhone') => ({ updatedAt: iso(minutes), device, data })
const record = (sections: Payload['sections'], extra: Record<string, unknown> = {}): Payload => ({ v: 1, sections, ...extra })
const server = { id: 's1', kind: 'jellyfin' as const, name: 'Home', url: 'https://jf.example.com', token: 'tok', enabled: true }

/** What a device does with a pull: merge, then apply the patch to its settings. */
function pull(remote: Payload | null, local: Settings, metas: Metas, minutes: number, adopt = false) {
  const out = merge(remote, local, metas, t(minutes), 'Web', adopt)
  return { ...out, settings: { ...local, ...out.patch } }
}

describe('what the web puts in each section', () => {
  it('maps the TMDB key to tmdbAPIKey, and nothing to null', () => {
    expect(localValue('keys', settings({ tmdbKey: 'abc' }))).toEqual({ tmdbAPIKey: 'abc' })
    expect(localValue('keys', settings({ tmdbKey: '' }))).toEqual({ tmdbAPIKey: null })
  })

  it('writes add-ons, servers, the proxy and playback in the document’s shapes', () => {
    const s = settings({
      addons: [{ url: 'https://a.example.com/manifest.json', name: 'A', enabled: false }],
      servers: [{ ...server, userId: 'u1' }],
      streamProxy: ' https://p.example.com/?url={url} ',
      audioLanguages: ['original', 'en'],
      subtitleLanguages: ['en'],
    })
    expect(localValue('addons', s)).toEqual([{ url: 'https://a.example.com/manifest.json', name: 'A', enabled: false }])
    // The device-only `enabled` stays home.
    expect(localValue('servers', s)).toEqual([{ id: 's1', kind: 'jellyfin', name: 'Home', url: 'https://jf.example.com', token: 'tok', userId: 'u1' }])
    expect(localValue('streamProxy', s)).toEqual({ template: 'https://p.example.com/?url={url}' })
    expect(localValue('playback', s)).toEqual({ audioLanguages: ['original', 'en'], subtitleLanguages: ['en'], subtitleStyle: s.subtitleStyle })
  })

  it('never carries the local-only settings', () => {
    const plain = JSON.stringify(webValues(settings()))
    expect(JSON.stringify(webValues(settings({ demo: true, font: 'geist', autoplayNext: false, preferredQuality: '720p', subtitleMode: 'always', onboarded: true, language: 'fr-FR', region: 'FR', includeAdult: true })))).toBe(plain)
  })
})

const webValues = (s: Settings) => (['keys', 'addons', 'servers', 'streamProxy', 'playback'] as const).map((n) => localValue(n, s))

describe('noticing a local change', () => {
  it('writes nothing for a browser nobody has set up', () => {
    expect(detectChanges(settings(), {}, t(0), 'Web')).toEqual({ metas: {}, changed: false })
  })

  it('stamps a section the first time it has a value, with the time of the change', () => {
    const { metas, changed } = detectChanges(settings({ tmdbKey: 'abc' }), {}, t(1), 'Web')
    expect(changed).toBe(true)
    expect(Object.keys(metas)).toEqual(['keys'])
    expect(metas.keys).toMatchObject({ updatedAt: iso(1), device: 'Web' })
  })

  it('stamps only the section that changed, and only when its value does', () => {
    const first = detectChanges(settings({ tmdbKey: 'abc', streamProxy: 'https://p.example.com/?url={url}' }), {}, t(1), 'Web').metas
    const again = detectChanges(settings({ tmdbKey: 'abc', streamProxy: 'https://p.example.com/?url={url}' }), first, t(5), 'Web')
    expect(again.changed).toBe(false)
    expect(again.metas).toEqual(first)
    const edited = detectChanges(settings({ tmdbKey: 'abcd', streamProxy: 'https://p.example.com/?url={url}' }), first, t(9), 'Web')
    expect(edited.metas.keys!.updatedAt).toBe(iso(9))
    expect(edited.metas.streamProxy).toEqual(first.streamProxy)
  })

  it('counts a cleared value as a change', () => {
    const first = detectChanges(settings({ tmdbKey: 'abc', addons: [{ url: 'u', name: 'A', enabled: true }] }), {}, t(1), 'Web').metas
    const cleared = detectChanges(settings({ tmdbKey: '', addons: [] }), first, t(2), 'Web')
    expect(cleared.changed).toBe(true)
    expect(cleared.metas.keys!.updatedAt).toBe(iso(2))
    expect(cleared.metas.addons!.updatedAt).toBe(iso(2))
  })

  it('ignores settings that never sync', () => {
    const first = detectChanges(settings({ tmdbKey: 'abc' }), {}, t(1), 'Web').metas
    expect(detectChanges(settings({ tmdbKey: 'abc', demo: true, font: 'inter', autoplayNext: false, language: 'fr-FR' }), first, t(2), 'Web').changed).toBe(false)
  })
})

describe('merging with the record', () => {
  it('writes this device’s sections into a new record, with the time of the change', () => {
    const local = settings({ tmdbKey: 'abc', addons: [{ url: 'https://a.example.com/manifest.json', name: 'A', enabled: true }] })
    const { payload, patch } = pull(null, local, {}, 3)
    expect(patch).toEqual({})
    expect(payload).toEqual({
      v: 1,
      sections: {
        keys: { updatedAt: iso(3), device: 'Web', data: { tmdbAPIKey: 'abc' } },
        addons: { updatedAt: iso(3), device: 'Web', data: [{ url: 'https://a.example.com/manifest.json', name: 'A', enabled: true }] },
      },
    })
  })

  it('applies a newer remote section without bumping its time, and then has nothing to write', () => {
    const remote = record({ keys: section(10, { tmdbAPIKey: 'from-phone' }) })
    const first = pull(remote, settings(), {}, 11)
    expect(first.patch).toMatchObject({ tmdbKey: 'from-phone' })
    expect(first.metas.keys).toMatchObject({ updatedAt: iso(10), device: 'iPhone' })
    expect(first.payload).toEqual(remote)
    // The next look at the same record (and the settings change that applying caused) finds nothing new.
    const second = pull(remote, first.settings, first.metas, 12)
    expect(second.patch).toEqual({})
    expect(second.payload).toEqual(remote)
    expect(detectChanges(first.settings, first.metas, t(13), 'Web').changed).toBe(false)
  })

  it('keeps a local section that is newer than the record’s', () => {
    const remote = record({ keys: section(5, { tmdbAPIKey: 'old' }) })
    const metas: Metas = { keys: { updatedAt: iso(8), device: 'Web', snapshot: JSON.stringify({ tmdbAPIKey: 'new' }) } }
    const out = pull(remote, settings({ tmdbKey: 'new' }), metas, 9)
    expect(out.patch).toEqual({})
    expect(out.payload.sections.keys).toEqual({ updatedAt: iso(8), device: 'Web', data: { tmdbAPIKey: 'new' } })
  })

  it('leaves both alone when the times are equal', () => {
    const remote = record({ keys: section(5, { tmdbAPIKey: 'theirs' }) })
    const metas: Metas = { keys: { updatedAt: iso(5), device: 'Web', snapshot: JSON.stringify({ tmdbAPIKey: 'mine' }) } }
    const out = pull(remote, settings({ tmdbKey: 'mine' }), metas, 9)
    expect(out.patch).toEqual({})
    expect(out.payload).toEqual(remote)
  })

  it('merges each section on its own', () => {
    const remote = record({ keys: section(10, { tmdbAPIKey: 'phone-key' }), addons: section(2, [{ url: 'https://old.example.com/manifest.json', name: 'Old', enabled: true }]) })
    const local = settings({ tmdbKey: 'web-key', addons: [{ url: 'https://new.example.com/manifest.json', name: 'New', enabled: true }] })
    const metas: Metas = {
      keys: { updatedAt: iso(4), device: 'Web', snapshot: JSON.stringify({ tmdbAPIKey: 'web-key' }) },
      addons: { updatedAt: iso(6), device: 'Web', snapshot: JSON.stringify(localValue('addons', local)) },
    }
    const out = pull(remote, local, metas, 12)
    expect(out.settings.tmdbKey).toBe('phone-key')
    expect(out.payload.sections.keys!.data).toEqual({ tmdbAPIKey: 'phone-key' })
    expect(out.payload.sections.addons).toMatchObject({ updatedAt: iso(6), data: [{ url: 'https://new.example.com/manifest.json', name: 'New', enabled: true }] })
  })

  it('a cleared value wins when it is newer, in both directions', () => {
    const local = settings({ addons: [{ url: 'u', name: 'A', enabled: true }] })
    const metas: Metas = { addons: { updatedAt: iso(3), device: 'Web', snapshot: JSON.stringify(localValue('addons', local)) } }
    const clearedRemotely = pull(record({ addons: section(7, []) }), local, metas, 8)
    expect(clearedRemotely.settings.addons).toEqual([])
    const clearedHere = pull(record({ addons: section(3, [{ url: 'u', name: 'A', enabled: true }]) }), settings(), metas, 8)
    expect(clearedHere.payload.sections.addons).toMatchObject({ updatedAt: iso(8), data: [] })
    const key = pull(record({ keys: section(2, { tmdbAPIKey: 'abc' }) }), settings(), { keys: { updatedAt: iso(2), device: 'x', snapshot: JSON.stringify({ tmdbAPIKey: 'abc' }) } }, 9)
    expect(key.patch).toEqual({})
  })

  it('keeps sections and fields it does not understand, and the sign-ins and other keys', () => {
    const accounts = section(1, { trakt: { accessToken: 'a', refreshToken: 'r', expiresAt: null, redirectURI: 'flow://trakt' }, simkl: null })
    const remote = record(
      {
        keys: { ...section(2, { tmdbAPIKey: 'old', tvdbAPIKey: 'tvdb', rpdbAPIKey: null, futureKey: 1 }), extraOnSection: true },
        accounts,
        collections: section(3, ['x']),
        servers: section(2, [{ ...server, extra: 'kept', machineId: 'm' }, { id: 'w1', kind: 'webdav', name: 'NAS', url: 'https://nas.example.com' }]),
        playback: section(2, { audioLanguages: ['en'], subtitleLanguages: ['en'], subtitleStyle: { fontScale: 1, hdrBoost: 3 }, subtitleMode: 'foreign' }),
      },
      { futureTopLevel: { a: 1 } },
    )
    const local = settings({
      tmdbKey: 'new',
      servers: [{ ...server, machineId: 'm' }, { ...server, id: 's2', name: 'Second', url: 'https://jf2.example.com' }],
      audioLanguages: ['de'],
    })
    const metas: Metas = {
      keys: { updatedAt: iso(0), device: 'Web', snapshot: '{}' },
      servers: { updatedAt: iso(0), device: 'Web', snapshot: '[]' },
      playback: { updatedAt: iso(0), device: 'Web', snapshot: '{}' },
    }
    const { payload } = merge(remote, local, metas, t(20), 'Web')
    expect(payload.futureTopLevel).toEqual({ a: 1 })
    expect(payload.sections.accounts).toEqual(accounts)
    expect(payload.sections.collections).toEqual(remote.sections.collections)
    expect(payload.sections.keys).toEqual({ updatedAt: iso(20), device: 'Web', extraOnSection: true, data: { tmdbAPIKey: 'new', tvdbAPIKey: 'tvdb', rpdbAPIKey: null, futureKey: 1 } })
    const servers = payload.sections.servers!.data as Record<string, unknown>[]
    expect(servers.map((v) => v.id)).toEqual(['s1', 's2', 'w1'])
    expect(servers[0]).toMatchObject({ extra: 'kept', machineId: 'm' })
    expect(servers[2]).toEqual({ id: 'w1', kind: 'webdav', name: 'NAS', url: 'https://nas.example.com' })
    const playback = payload.sections.playback!.data as Record<string, unknown>
    expect(playback.subtitleMode).toBe('foreign')
    expect(playback.audioLanguages).toEqual(['de'])
    expect((playback.subtitleStyle as Record<string, unknown>).hdrBoost).toBe(3)
  })

  it('leaves a record it only read exactly as it was', () => {
    const remote = record({ accounts: section(1, { trakt: null, simkl: null }), keys: section(2, { tmdbAPIKey: 'k', tvdbAPIKey: 't' }) }, { future: true })
    const out = pull(remote, settings(), {}, 5)
    expect(JSON.stringify(out.payload)).toBe(JSON.stringify(remote))
  })

  it('takes what the record has when joining, but still sends what it lacks', () => {
    const remote = record({ keys: section(2, { tmdbAPIKey: 'shared' }) })
    const local = settings({ tmdbKey: 'mine-before-joining', streamProxy: 'https://p.example.com/?url={url}' })
    const joined = pull(remote, local, {}, 9, true)
    expect(joined.settings.tmdbKey).toBe('shared')
    expect(joined.payload.sections.keys).toEqual(remote.sections.keys)
    expect(joined.payload.sections.streamProxy).toMatchObject({ updatedAt: iso(9), data: { template: 'https://p.example.com/?url={url}' } })
    // Without joining, the same browser would have counted its key as a change and won.
    expect(pull(remote, local, {}, 9).payload.sections.keys).toMatchObject({ updatedAt: iso(9), data: { tmdbAPIKey: 'mine-before-joining' } })
  })

  it('ignores a section whose time or data it cannot read', () => {
    const remote = record({ keys: { updatedAt: 'yesterday', data: { tmdbAPIKey: 'x' } }, addons: { updatedAt: iso(5) }, servers: section(5, 'nonsense') })
    const out = pull(remote, settings(), {}, 9)
    expect(out.patch).toEqual({})
  })
})

describe('applying a section here', () => {
  it('sets the TMDB key, clears it on null, and marks a fresh browser as set up', () => {
    expect(settingsPatch('keys', { tmdbAPIKey: ' abc ' }, settings())).toEqual({ tmdbKey: 'abc', onboarded: true })
    expect(settingsPatch('keys', { tmdbAPIKey: 'abc' }, settings({ onboarded: true }))).toEqual({ tmdbKey: 'abc' })
    expect(settingsPatch('keys', { tmdbAPIKey: null }, settings())).toEqual({ tmdbKey: '' })
    expect(settingsPatch('keys', { tvdbAPIKey: 'only' }, settings())).toEqual({ tmdbKey: '' })
    expect(settingsPatch('keys', null, settings())).toBeNull()
  })

  it('keeps an add-on’s saved manifest and a server’s on/off switch', () => {
    const manifest = { id: 'a', name: 'A', version: '1', resources: ['stream'] }
    const local = settings({ addons: [{ url: 'u1', name: 'A', enabled: true, manifest }], servers: [{ ...server, enabled: false }] })
    const addons = settingsPatch('addons', [{ url: 'u1', name: 'A2', enabled: false }, { url: 'u2', name: 'B', enabled: true }, { nope: 1 }], local)!.addons
    expect(addons).toEqual([{ url: 'u1', name: 'A2', enabled: false, manifest }, { url: 'u2', name: 'B', enabled: true }])
    const servers = settingsPatch('servers', [{ ...server, name: 'Renamed' }, { id: 's9', kind: 'emby', name: 'E', url: 'https://e.example.com', token: 't' }, { id: 'x', kind: 'webdav', url: 'u' }], local)!.servers!
    expect(servers.map((v) => [v.id, v.name, v.enabled])).toEqual([['s1', 'Renamed', false], ['s9', 'E', true]])
  })

  it('takes playback fields one by one, and keeps the style it can use', () => {
    const local = settings({ audioLanguages: ['en'], subtitleLanguages: ['en'] })
    expect(settingsPatch('playback', { audioLanguages: ['fr', 'original'] }, local)).toEqual({ audioLanguages: ['fr', 'original'] })
    const styled = settingsPatch('playback', { subtitleStyle: { fontScale: 1.5, color: 'yellow', edgeStyle: 'outline' } }, local)!
    expect(styled.subtitleStyle).toMatchObject({ fontScale: 1.5, color: 'yellow', edgeStyle: 'outline', font: local.subtitleStyle.font })
    expect(settingsPatch('playback', { subtitleStyle: { fontScale: 99 } }, local)).toBeNull()
    expect(settingsPatch('playback', 'x', local)).toBeNull()
  })

  it('accepts a stream proxy it can call, and leaves an unusable one alone', () => {
    expect(settingsPatch('streamProxy', { template: 'https://p.example.com/?url={url}' }, settings())).toEqual({ streamProxy: 'https://p.example.com/?url={url}' })
    expect(settingsPatch('streamProxy', { template: '' }, settings())).toEqual({ streamProxy: '' })
    expect(settingsPatch('streamProxy', { template: 'http://p.example.com/?url={url}' }, settings())).toBeNull()
    expect(settingsPatch('streamProxy', { template: 7 }, settings())).toBeNull()
  })
})

describe('overlay', () => {
  it('lays web values over the record’s data without dropping its other fields', () => {
    expect(overlay('streamProxy', { template: 'old', apps: 'keep' }, { template: 'new' })).toEqual({ template: 'new', apps: 'keep' })
    expect(overlay('keys', undefined, { tmdbAPIKey: 'k' })).toEqual({ tmdbAPIKey: 'k' })
    expect(overlay('addons', [{ url: 'a', name: 'A', enabled: true, pinned: true }], [{ url: 'a', name: 'A', enabled: false }])).toEqual([{ url: 'a', name: 'A', enabled: false, pinned: true }])
  })
})

describe('reading a record', () => {
  it('accepts version 1, refuses a newer one, and refuses what is not a record', () => {
    expect(parsePayload('{"v":1,"sections":{}}')).toEqual({ ok: true, payload: { v: 1, sections: {} } })
    expect(parsePayload('{"v":2,"sections":{}}')).toEqual({ ok: false, newer: true })
    expect(parsePayload('{"v":1}')).toEqual({ ok: false, newer: false })
    expect(parsePayload('nope')).toEqual({ ok: false, newer: false })
    expect(parsePayload('[]')).toEqual({ ok: false, newer: false })
  })
})
