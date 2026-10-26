import { describe, expect, it } from 'vitest'
import { fixedCapabilities } from './capabilities'
import { arrangeSources, audioLanguageFirst, categoryOf, compareByRules, effectiveProviderOrder, moveWithin, passes, sdrFirst, sortValue, type ArrangeContext } from './order'
import { parseStream } from './parser'
import { buildSource, orderedSources } from './rank'
import { defaultSourceFilters, defaultSourceOrdering, defaultSortRules, normaliseSourceOrdering, type SourceFilters, type SourceOrdering } from './sourceSettings'
import type { Source, SourceOrigin } from './types'

// Ported from FlowKit's SourceRankerTests, with the browser's differences: a screen that can't show HDR
// is `hdrScreen: false`, and the score (not the add-on's order) breaks ties.

const caps = fixedCapabilities({ video: ['H264', 'HEVC', 'AV1', 'VP9'], audio: ['AAC', 'DD', 'DD+', 'FLAC', 'MP3'] })

function source(id: string, text: string, extra: { provider?: string; origin?: SourceOrigin; providerName?: string; detail?: string } = {}): Source {
  const provider = extra.provider ?? 'aio'
  return buildSource(
    { id, origin: extra.origin ?? 'addon', provider: extra.providerName ?? provider, providerId: provider, title: id, url: `https://cdn.example/${id}.mp4`, traits: parseStream(text), detail: extra.detail ?? text },
    caps,
  )
}

const ids = (list: Source[]) => list.map((s) => s.id)
const custom = (patch: Partial<SourceOrdering> = {}): SourceOrdering => ({ ...defaultSourceOrdering, useCustomOrdering: true, ...patch })
const filters = (patch: Partial<SourceFilters>): SourceFilters => ({ ...defaultSourceFilters, ...patch })
const context = (extra: Partial<ArrangeContext> = {}): ArrangeContext => ({ providers: [], hdrScreen: true, resolutionFit: () => 0, ...extra })

describe('category and provider order', () => {
  const list = [
    source('a1', '1080p', { provider: 'aio' }),
    source('s1', '720p', { provider: 'viren', origin: 'jellyfin' }),
    source('s2', '1080p', { provider: 'jelly', origin: 'plex' }),
  ]
  const providers = [
    { id: 'jelly', category: 'mediaServers' as const },
    { id: 'viren', category: 'mediaServers' as const },
    { id: 'aio', category: 'addons' as const },
  ]

  it('apply without custom ordering: servers before add-ons, providers as Settings lists them', () => {
    const settings: SourceOrdering = { ...defaultSourceOrdering, providerOrder: { mediaServers: ['viren', 'jelly'] } }
    expect(ids(arrangeSources(list, settings, context({ providers })).sources)).toEqual(['s1', 's2', 'a1'])
    expect(ids(arrangeSources(list, defaultSourceOrdering, context({ providers })).sources)).toEqual(['s2', 's1', 'a1'])
  })

  it('follow the category order the viewer sets', () => {
    const settings: SourceOrdering = { ...defaultSourceOrdering, categoryOrder: ['addons', 'mediaServers', 'webDAV', 'iptv'] }
    expect(ids(arrangeSources(list, settings, context({ providers })).sources)).toEqual(['a1', 's2', 's1'])
  })

  it('keep a provider’s sources together, and put one Settings doesn’t know after the rest', () => {
    const mixed = [source('x1', '1080p', { provider: 'ghost' }), source('a1', '720p', { provider: 'aio' }), source('x2', '1080p', { provider: 'ghost' }), source('a2', '1080p', { provider: 'aio' })]
    expect(ids(arrangeSources(mixed, defaultSourceOrdering, context({ providers: [{ id: 'aio', category: 'addons' }] })).sources)).toEqual(['a1', 'a2', 'x1', 'x2'])
  })

  it('keep two providers that share a name from interleaving', () => {
    const same = [source('a1', '1080p', { provider: 'one', providerName: 'Same' }), source('b1', '1080p', { provider: 'two', providerName: 'Same' }), source('a2', '720p', { provider: 'one', providerName: 'Same' })]
    expect(ids(arrangeSources(same, defaultSourceOrdering, context()).sources)).toEqual(['a1', 'a2', 'b1'])
  })

  it('name every kind of origin a category', () => {
    expect((['jellyfin', 'emby', 'plex', 'webdav', 'addon', 'demo'] as const).map(categoryOf)).toEqual(['mediaServers', 'mediaServers', 'mediaServers', 'webDAV', 'addons', 'addons'])
  })

  it('put a WebDAV share between the servers and the add-ons, until the viewer says otherwise', () => {
    const withShare = [...list, source('w1', '1080p', { provider: 'nas', origin: 'webdav' })]
    const all = [...providers, { id: 'nas', category: 'webDAV' as const }]
    expect(ids(arrangeSources(withShare, defaultSourceOrdering, context({ providers: all })).sources)).toEqual(['s2', 's1', 'w1', 'a1'])
    const settings: SourceOrdering = { ...defaultSourceOrdering, categoryOrder: ['webDAV', 'mediaServers', 'iptv', 'addons'] }
    expect(ids(arrangeSources(withShare, settings, context({ providers: all })).sources)).toEqual(['w1', 's2', 's1', 'a1'])
  })

  it('order providers: the named ones first, the rest as they come, strangers ignored', () => {
    expect(effectiveProviderOrder(['a', 'b', 'c'], undefined)).toEqual(['a', 'b', 'c'])
    expect(effectiveProviderOrder(['a', 'b', 'c'], ['c', 'gone', 'c'])).toEqual(['c', 'a', 'b'])
  })

  it('move an item one place, and stop at either end', () => {
    expect(moveWithin(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveWithin(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveWithin(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveWithin(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
    expect(moveWithin(['a'], -1, 1)).toEqual(['a'])
  })
})

describe('sort rules', () => {
  it('sort, filter and cap together, as the apps do', () => {
    const list = [
      source('cam', '1080p CAM 2 GB'),
      source('small', '1080p WEB-DL 1 GB [RD+]'),
      source('big4k', '2160p BluRay 30 GB [RD+]'),
      source('uncached', '2160p WEB-DL 15 GB [RD download]'),
      source('hd', '1080p BluRay 8 GB [RD+]'),
    ]
    const fit = (s: Source) => ({ '2160p': 3, '1080p': 2 })[s.resolution as string] ?? 0
    const { sources, hidden } = arrangeSources(list, custom({ resultCap: 3 }), context({ resolutionFit: fit }))
    // The cinema capture is filtered; cached first, then resolution, quality, size; then the cap.
    expect(ids(sources)).toEqual(['big4k', 'hd', 'small'])
    expect(hidden).toBe(2)
  })

  it('run top to bottom, each one either way', () => {
    const list = [source('big', '1080p WEB-DL 8 GB'), source('small', '1080p WEB-DL 2 GB'), source('uhd', '2160p WEB-DL 5 GB')]
    const fit = (s: Source) => (s.resolution === '2160p' ? 2 : 1)
    const run = (rules: { key: 'size' | 'resolution'; descending: boolean }[]) => ids(arrangeSources(list, custom({ sortRules: rules }), context({ resolutionFit: fit })).sources)
    expect(run([{ key: 'size', descending: true }])).toEqual(['big', 'uhd', 'small'])
    expect(run([{ key: 'size', descending: false }])).toEqual(['small', 'uhd', 'big'])
    expect(run([{ key: 'resolution', descending: true }, { key: 'size', descending: false }])).toEqual(['uhd', 'small', 'big'])
    expect(run([{ key: 'resolution', descending: false }, { key: 'size', descending: true }])).toEqual(['big', 'small', 'uhd'])
  })

  it('leave the score’s order alone when no rule is set, or every rule ties', () => {
    const list = [source('b', '1080p'), source('a', '1080p'), source('c', '720p')]
    expect(ids(arrangeSources(list, custom({ sortRules: [] }), context()).sources)).toEqual(['b', 'a', 'c'])
    expect(ids(arrangeSources(list, custom({ sortRules: [{ key: 'size', descending: true }] }), context()).sources)).toEqual(['b', 'a', 'c'])
  })

  it('apply only with custom ordering on, but the category order always does', () => {
    const list = [source('small', '720p 1 GB'), source('big', '2160p 30 GB')]
    expect(ids(arrangeSources(list, { ...defaultSourceOrdering, sortRules: [{ key: 'size', descending: true }] }, context()).sources)).toEqual(['small', 'big'])
    expect(ids(arrangeSources(list, custom({ sortRules: [{ key: 'size', descending: true }] }), context()).sources)).toEqual(['big', 'small'])
  })

  it('sort by each key as the apps value it', () => {
    const f = defaultSourceFilters
    const c = context({ resolutionFit: () => 7 })
    expect(sortValue(source('r', '1080p'), 'resolution', f, c)).toBe(7)
    expect(sortValue(source('q', 'REMUX'), 'quality', f, c)).toBeGreaterThan(sortValue(source('q', 'WEBRip'), 'quality', f, c))
    expect(sortValue(source('z', '2 GB'), 'size', f, c)).toBe(2 * 1_073_741_824)
    expect(sortValue(source('n', '1080p'), 'size', f, c)).toBe(0)
    expect([true, undefined, false].map((cached) => sortValue({ ...source('c', '1080p'), cached }, 'cached', f, c))).toEqual([2, 1, 0])
    expect(sortValue(source('s', '👤 40'), 'seeders', f, c)).toBe(40)
    expect(['2160p DV HDR10', '2160p HDR10+', '2160p HDR10', '2160p'].map((t) => sortValue(source('h', t), 'hdr', f, c))).toEqual([3, 2, 1, 0])
  })

  it('rank preferred languages by their place in the list, by name or by code', () => {
    const f = filters({ preferredLanguages: ['hi', 'English'] })
    const c = context()
    const hindi = source('hi', '1080p Hindi'), english = source('en', '1080p English'), french = source('fr', '1080p French')
    expect([hindi, english, french].map((s) => sortValue(s, 'language', f, c))).toEqual([2, 1, 0])
    expect(sortValue(hindi, 'language', filters({}), c)).toBe(0)
    const rules = [{ key: 'language' as const, descending: true }]
    expect(compareByRules(english, hindi, rules, f, c)).toBeGreaterThan(0)
    expect(ids(arrangeSources([french, english, hindi], custom({ sortRules: rules, filters: f }), c).sources)).toEqual(['hi', 'en', 'fr'])
  })

  it('sort within a provider, never across providers', () => {
    const list = [source('a-low', '720p', { provider: 'one' }), source('b-high', '2160p', { provider: 'two' }), source('a-high', '1080p', { provider: 'one' })]
    const providers = [{ id: 'one', category: 'addons' as const }, { id: 'two', category: 'addons' as const }]
    const fit = (s: Source) => ({ '2160p': 3, '1080p': 2, '720p': 1 })[s.resolution as string] ?? 0
    expect(ids(arrangeSources(list, custom({ sortRules: [{ key: 'resolution', descending: true }] }), context({ providers, resolutionFit: fit })).sources)).toEqual(['a-high', 'a-low', 'b-high'])
  })
})

describe('filters', () => {
  const a = source('a', '1080p Hindi 2 GB')
  const b = source('b', '1080p 20 GB')
  const c = source('c', '1080p English 4 GB')

  it('exclude keywords and sizes', () => {
    const f = filters({ excludedKeywords: ['hindi'], maxSizeGB: 10 })
    expect([a, b, c].map((s) => passes(s, f))).toEqual([false, false, true])
    expect([a, b, c].map((s) => passes(s, filters({ minSizeGB: 3 })))).toEqual([false, true, true])
  })

  it('judge a size only when the source states one', () => {
    expect(passes(source('u', '1080p'), filters({ minSizeGB: 5, maxSizeGB: 1 }))).toBe(true)
  })

  it('require any of the keywords, ignoring case and blanks', () => {
    expect([a, b, c].map((s) => passes(s, filters({ requiredKeywords: ['ENGLISH', 'hindi'] })))).toEqual([true, false, true])
    expect(passes(b, filters({ requiredKeywords: ['', '  '] }))).toBe(true)
  })

  it('match keywords in the add-on’s own text and the file name too', () => {
    const withText = source('t', '1080p', { detail: 'AIOStreams\n🌎 Latino' })
    expect(passes(withText, filters({ excludedKeywords: ['latino'] }))).toBe(false)
    expect(passes({ ...b, filename: 'Dune.2024.NoSubs.mkv' }, filters({ excludedKeywords: ['nosubs'] }))).toBe(false)
  })

  it('hide cinema captures by default, and only when asked to', () => {
    const cam = source('cam', '1080p CAM'), ts = source('ts', '1080p HDTS'), web = source('web', '1080p WEB-DL')
    expect([cam, ts, web].map((s) => passes(s, defaultSourceFilters))).toEqual([false, false, true])
    expect([cam, ts, web].map((s) => passes(s, filters({ excludeCinemaCaptures: false })))).toEqual([true, true, true])
  })

  it('hide uncached torrents only when they say they are not cached', () => {
    const cached = source('c', '1080p [RD+]'), not = source('n', '1080p [RD download]'), unknown = source('u', '1080p')
    expect([cached, not, unknown].map((s) => passes(s, filters({ excludeUncached: true })))).toEqual([true, false, true])
  })

  it('hide resolutions below the minimum, and keep ones that don’t say', () => {
    const list = [source('sd', '480p'), source('hd', '720p'), source('fhd', '1080p'), source('uhd', '2160p'), source('none', 'WEB-DL')]
    expect(list.map((s) => passes(s, filters({ minResolution: 1080 })))).toEqual([false, false, true, true, true])
    expect(list.map((s) => passes(s, filters({ minResolution: 480 })))).toEqual([true, true, true, true, true])
    expect(list.map((s) => passes(s, filters({ minResolution: 2160 })))).toEqual([false, false, false, true, true])
  })

  it('hide codecs however they are written', () => {
    const hevc = source('hevc', '1080p x265'), av1 = source('av1', '1080p AV1'), avc = source('avc', '1080p x264')
    expect([hevc, av1, avc].map((s) => passes(s, filters({ excludedCodecs: ['av1'] })))).toEqual([true, false, true])
    expect([hevc, av1, avc].map((s) => passes(s, filters({ excludedCodecs: ['H.265', 'h264'] })))).toEqual([false, true, false])
  })

  it('apply only with custom ordering on, and say how many they hid', () => {
    const f = filters({ excludedKeywords: ['hindi'] })
    expect(arrangeSources([a, c], { ...defaultSourceOrdering, filters: f }, context())).toMatchObject({ hidden: 0 })
    const on = arrangeSources([a, c], custom({ filters: f }), context())
    expect(ids(on.sources)).toEqual(['c'])
    expect(on.hidden).toBe(1)
  })
})

describe('result cap', () => {
  const list = [source('a', '1080p'), source('b', '1080p'), source('c', '1080p')]
  it('stops the list there, with custom ordering on', () => {
    expect(arrangeSources(list, custom({ resultCap: 2 }), context())).toMatchObject({ hidden: 1 })
    expect(ids(arrangeSources(list, custom({ resultCap: 2 }), context()).sources)).toEqual(['a', 'b'])
  })
  it('is ignored when off, null, or larger than the list', () => {
    expect(arrangeSources(list, { ...defaultSourceOrdering, resultCap: 1 }, context()).sources).toHaveLength(3)
    expect(arrangeSources(list, custom({ resultCap: null }), context()).sources).toHaveLength(3)
    expect(arrangeSources(list, custom({ resultCap: 50 }), context())).toMatchObject({ hidden: 0 })
  })
  it('counts after the demotions, so what can’t play is the first thing cut', () => {
    const dts = source('dts', '1080p DTS-HD MA')
    expect(dts.unsupported).toBeDefined()
    expect(ids(arrangeSources([dts, ...list], custom({ resultCap: 3 }), context()).sources)).toEqual(['a', 'b', 'c'])
  })
})

describe('what this browser can’t play', () => {
  it('goes last, and what is known to stutter goes just before it, whatever the settings', () => {
    const dts = source('dts', '1080p DTS-HD MA')
    const rough = { ...source('rough', '2160p'), mayStutter: true }
    const fine = source('fine', '720p')
    const big = source('big', '2160p 40 GB')
    const rules = custom({ sortRules: [{ key: 'size', descending: true }] })
    expect(ids(arrangeSources([dts, rough, fine, big], rules, context()).sources)).toEqual(['big', 'fine', 'rough', 'dts'])
    expect(ids(arrangeSources([dts, rough, fine, big], defaultSourceOrdering, context()).sources)).toEqual(['fine', 'big', 'rough', 'dts'])
  })
})

describe('preferences that reorder within a provider', () => {
  const sources = () => [
    source('dv4k', '2160p DV HDR10 WEB-DL'),
    source('sdr4k', '2160p WEB-DL'),
    source('hdr1080', '1080p HDR WEB-DL'),
    source('sdr1080', '1080p WEB-DL'),
    source('other', '2160p WEB-DL', { provider: 'zzz' }),
  ]
  const providers = [{ id: 'aio', category: 'addons' as const }, { id: 'zzz', category: 'addons' as const }]
  const noRules = custom({ sortRules: [] })

  it('put SDR first within a provider and resolution on a screen without HDR, and keep the overall order', () => {
    expect(ids(sdrFirst(sources()))).toEqual(['sdr4k', 'dv4k', 'sdr1080', 'hdr1080', 'other'])
    expect(ids(arrangeSources(sources(), noRules, context({ providers, hdrScreen: false })).sources)).toEqual(['sdr4k', 'dv4k', 'sdr1080', 'hdr1080', 'other'])
    expect(ids(arrangeSources(sources(), noRules, context({ providers, hdrScreen: true })).sources)).toEqual(['dv4k', 'sdr4k', 'hdr1080', 'sdr1080', 'other'])
  })

  it('put the preferred audio language first within a provider, and nothing else moves', () => {
    const list = [
      source('fr', '1080p French WEB-DL'),
      source('en1', '1080p English WEB-DL'),
      source('none', '1080p WEB-DL'),
      source('en2', '720p English WEB-DL'),
      source('other-fr', '1080p French WEB-DL', { provider: 'zzz' }),
      source('other-en', '1080p English WEB-DL', { provider: 'zzz' }),
    ]
    expect(ids(arrangeSources(list, noRules, context({ providers })).sources)).toEqual(['fr', 'en1', 'none', 'en2', 'other-fr', 'other-en'])
    expect(ids(arrangeSources(list, noRules, context({ providers, audioLanguage: 'en' })).sources)).toEqual(['en1', 'en2', 'fr', 'none', 'other-en', 'other-fr'])
    expect(ids(arrangeSources(list, noRules, context({ providers, audioLanguage: 'fr-FR' })).sources)).toEqual(['fr', 'en1', 'none', 'en2', 'other-fr', 'other-en'])
    expect(ids(audioLanguageFirst(list, 'xx'))).toEqual(ids(list))
  })

  it('count a Multi release as carrying the language, and never cross providers', () => {
    const multi = { ...source('multi', '1080p'), languages: ['Multi'] }
    expect(ids(audioLanguageFirst([source('plain', '1080p'), multi], 'en'))).toEqual(['multi', 'plain'])
    const apart = [source('a', '1080p French', { provider: 'jelly', origin: 'jellyfin' }), source('b', '1080p English')]
    const both = [{ id: 'jelly', category: 'mediaServers' as const }, { id: 'aio', category: 'addons' as const }]
    expect(ids(arrangeSources(apart, noRules, context({ providers: both, audioLanguage: 'en' })).sources)).toEqual(['a', 'b'])
  })

  it('never pull a source this browser stutters on back ahead of ones it plays', () => {
    const list = [source('hdr', '1080p HEVC English HDR WEB-DL'), { ...source('av1-en', '1080p AV1 English WEB-DL'), mayStutter: true }, source('plain', '1080p HEVC French WEB-DL')]
    expect(arrangeSources(list, noRules, context({ hdrScreen: false, audioLanguage: 'en' })).sources.at(-1)!.id).toBe('av1-en')
    expect(ids(arrangeSources(list, noRules, context({ audioLanguage: 'en' })).sources)).toEqual(['hdr', 'plain', 'av1-en'])
  })
})

describe('orderedSources', () => {
  const prefs = { preferredQuality: '1080p' as const }
  const arrangement = (ordering: SourceOrdering) => ({ ordering, providers: [{ id: 'aio', kind: 'addon' as const }] })
  const list = () => [source('720', '720p WEB-DL AAC'), source('4k', '2160p WEB-DL AAC'), source('1080', '1080p WEB-DL AAC')]

  it('keeps the score’s order for one provider with the settings untouched', () => {
    expect(ids(orderedSources(list(), prefs, caps, arrangement(defaultSourceOrdering)).sources)).toEqual(['1080', '4k', '720'])
  })

  it('follows Preferred Quality for the Resolution rule, then lets the viewer flip it', () => {
    const rules = (descending: boolean) => custom({ sortRules: [{ key: 'resolution', descending }] })
    expect(ids(orderedSources(list(), prefs, caps, arrangement(rules(true))).sources)).toEqual(['1080', '4k', '720'])
    expect(ids(orderedSources(list(), prefs, caps, arrangement(rules(false))).sources)).toEqual(['720', '4k', '1080'])
    expect(ids(orderedSources(list(), { preferredQuality: 'any' }, caps, arrangement(rules(true))).sources)).toEqual(['4k', '1080', '720'])
  })

  it('reports what the default rules hid, cinema captures first', () => {
    const out = orderedSources([source('cam', '1080p CAM'), source('web', '1080p WEB-DL AAC')], prefs, caps, arrangement(custom({ sortRules: defaultSortRules() })))
    expect(ids(out.sources)).toEqual(['web'])
    expect(out.hidden).toBe(1)
  })
})

describe('saved source settings', () => {
  it('fill in what a saved value lacks, so older settings still load', () => {
    expect(normaliseSourceOrdering(undefined)).toEqual(defaultSourceOrdering)
    expect(normaliseSourceOrdering({})).toEqual(defaultSourceOrdering)
    const out = normaliseSourceOrdering({ useCustomOrdering: true, filters: { maxSizeGB: 10 }, appearance: { compact: true } })
    expect(out.useCustomOrdering).toBe(true)
    expect(out.filters).toEqual({ ...defaultSourceFilters, maxSizeGB: 10 })
    expect(out.appearance).toMatchObject({ compact: true, showSize: true, titleDisplay: 'provider' })
    expect(out.sortRules).toEqual(defaultSortRules())
  })

  it('keep the viewer’s empty rule list, drop repeats and unknown keys, and complete the category order', () => {
    expect(normaliseSourceOrdering({ sortRules: [] }).sortRules).toEqual([])
    expect(normaliseSourceOrdering({ sortRules: [{ key: 'size' }, { key: 'size', descending: false }, { key: 'nope' }] }).sortRules).toEqual([{ key: 'size', descending: true }])
    expect(normaliseSourceOrdering({ categoryOrder: ['addons', 'addons', 'bogus'] }).categoryOrder).toEqual(['addons', 'mediaServers', 'webDAV', 'iptv'])
  })

  it('read the apps’ badge packs as All Formats, Minimal or None', () => {
    const pack = (badgePack: string) => normaliseSourceOrdering({ appearance: { badgePack } }).appearance.badges
    expect(['colored', 'monochrome', 'minimal', 'none', 'wat'].map(pack)).toEqual(['all', 'all', 'minimal', 'none', 'all'])
  })

  it('treat a limit of zero or less as no limit', () => {
    const out = normaliseSourceOrdering({ resultCap: 0, filters: { minSizeGB: -1, maxSizeGB: 0 } })
    expect([out.resultCap, out.filters.minSizeGB, out.filters.maxSizeGB]).toEqual([null, null, null])
  })
})
