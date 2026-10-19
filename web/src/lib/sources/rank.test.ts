import { beforeEach, describe, expect, it } from 'vitest'
import { fixedCapabilities, type Capabilities } from './capabilities'
import { mapMediaSource } from './jellyfin'
import { parseStream } from './parser'
import { settingsStore } from '../store/settings'
import { forgetBlocked, rememberBlocked } from './proxy'
import { audioCarriers, buildSource, containerOf, dedupe, engineFor, hasPlayableAudio, rankSources, resolutionScore, undecodableAudio, unsupportedReason } from './rank'
import type { Source } from './types'

const chrome = fixedCapabilities({})
const safari = fixedCapabilities({ nativeHLS: true, video: ['H264', 'HEVC'], audio: ['AAC', 'DD', 'DD+', 'FLAC', 'MP3'], hdr: true })

function source(id: string, text: string, url = `https://cdn.example/${id}.mp4`, extra: Partial<Parameters<typeof buildSource>[0]> = {}, caps = chrome): Source {
  return buildSource({ id, origin: 'addon', provider: 'aio', providerId: 'aio', title: id, url, traits: parseStream(text), ...extra }, caps)
}

const ids = (list: Source[]) => list.map((s) => s.id)

describe('engine and container', () => {
  it('reads the container from the path, else the add-on’s file name', () => {
    expect(containerOf('https://x.test/a/b/movie.mkv?token=1')).toBe('mkv')
    expect(containerOf('https://x.test/resolve/abc123', 'Dune.2160p.mkv')).toBe('mkv')
    expect(containerOf('https://x.test/master.m3u8')).toBe('m3u8')
    expect(containerOf('https://x.test/play?id=1&f=m3u8')).toBe('m3u8')
    expect(containerOf('https://x.test/stream', undefined, 'mov,mp4,m4a')).toBe('mov')
  })

  it('picks hls.js where the browser has no HLS, the remuxer for Matroska', () => {
    expect(engineFor('m3u8', chrome)).toBe('hls')
    expect(engineFor('m3u8', safari)).toBe('native')
    // Safari's own HLS can't send headers; hls.js can.
    expect(engineFor('m3u8', safari, true)).toBe('hls')
    expect(engineFor('mkv', chrome)).toBe('remux')
    expect(engineFor('mp4', chrome)).toBe('native')
    expect(engineFor('webm', chrome)).toBe('native')
    expect(source('f', '1080p', 'https://x.test/resolve/1', { filename: 'A.1080p.mkv' }).engine).toBe('remux')
  })

  it('explains what can’t play here', () => {
    expect(source('dts', '1080p BluRay DTS-HD MA 7.1 x264', 'https://x.test/a.mkv').unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    expect(source('truehd', '2160p REMUX TrueHD Atmos HEVC', 'https://x.test/a.mkv', {}, safari).unsupported).toBe('TrueHD Atmos audio can’t play in a browser')
    // DTS alongside AAC: the remuxer picks the AAC track.
    expect(source('mixed', '720p DTS AAC x264', 'https://x.test/a.mkv').unsupported).toBeUndefined()
    expect(source('hevc', '2160p HEVC AAC', 'https://x.test/a.mkv').unsupported).toBe('HEVC video can’t play in this browser')
    expect(source('hevc-safari', '2160p HEVC AAC', 'https://x.test/a.mp4', {}, safari).unsupported).toBeUndefined()
    expect(source('avi', 'XviD', 'https://x.test/a.avi').unsupported).toBe('AVI files can’t play in a browser')
    expect(source('mkv-old', '1080p x264', 'https://x.test/a.mkv', {}, fixedCapabilities({ mse: false })).unsupported).toMatch(/Matroska needs a newer browser/)
    expect(source('headers', '1080p x264', 'https://x.test/a.mp4', { headers: { Referer: 'https://x.test' } }).unsupported).toBe('Needs request headers a browser can’t send')
    // A server transcode makes anything playable.
    expect(source('transcode', '2160p HEVC TrueHD', 'https://jf.test/master.m3u8', { transcoded: true }).unsupported).toBeUndefined()
  })
})

describe('rankSources', () => {
  it('leads with the preferred quality, and keeps higher ones just under it', () => {
    const list = [source('720', '720p WEB-DL x264 AAC'), source('4k', '2160p WEB-DL x264 AAC'), source('1080', '1080p WEB-DL x264 AAC'), source('sd', '480p x264 AAC')]
    expect(ids(rankSources(list, { preferredQuality: '1080p' }, chrome))).toEqual(['1080', '4k', '720', 'sd'])
    expect(ids(rankSources(list, { preferredQuality: 'any' }, chrome))).toEqual(['4k', '1080', '720', 'sd'])
    expect(ids(rankSources(list, { preferredQuality: '720p' }, chrome))).toEqual(['720', '1080', '4k', 'sd'])
    expect(resolutionScore('1440p', '1080p')).toBeGreaterThan(resolutionScore('2160p', '1080p'))
  })

  it('puts what this browser can’t play last, whatever its quality', () => {
    const list = [source('dts', '2160p BluRay DTS-HD MA x264', 'https://x.test/a.mkv'), source('ok', '720p WEBRip AAC x264')]
    const ranked = rankSources(list, { preferredQuality: 'any' }, chrome)
    expect(ids(ranked)).toEqual(['ok', 'dts'])
    expect(ranked[1]!.score!).toBeLessThan(0)
  })

  it('prefers HDR only on an HDR screen', () => {
    const list = [source('sdr', '2160p WEB-DL x264 AAC'), source('dv', '2160p WEB-DL DV x264 AAC')]
    expect(ids(rankSources(list, { preferredQuality: 'any' }, chrome))).toEqual(['sdr', 'dv'])
    expect(ids(rankSources(list, { preferredQuality: 'any' }, fixedCapabilities({ hdr: true })))).toEqual(['dv', 'sdr'])
  })

  it('sinks cinema captures, uncached and suspiciously small files', () => {
    const list = [
      source('cam', '1080p CAM x264 AAC 2 GB'),
      source('uncached', '1080p WEB-DL x264 AAC 4 GB [RD download]'),
      source('tiny', '1080p WEB-DL x264 AAC 120 MB'),
      source('good', '1080p WEB-DL x264 AAC 4 GB [RD+]'),
    ]
    expect(ids(rankSources(list, { preferredQuality: '1080p' }, chrome))).toEqual(['good', 'tiny', 'uncached', 'cam'])
  })

  it('breaks ties with seeders, then the providers’ order', () => {
    const list = [source('a', '1080p WEB-DL x264 AAC 👤 3'), source('b', '1080p WEB-DL x264 AAC 👤 900'), source('c', '1080p WEB-DL x264 AAC 👤 3')]
    expect(ids(rankSources(list, { preferredQuality: '1080p' }, chrome))).toEqual(['b', 'a', 'c'])
  })

  it('puts Dolby audio last where there’s no Dolby decoder', () => {
    // Sources are built, and so judged, for the browser that will play them.
    const list = (caps: Capabilities) => [source('ddp', '1080p WEB-DL x264 DDP5.1', undefined, {}, caps), source('aac', '1080p WEB-DL x264 AAC', undefined, {}, caps)]
    expect(ids(rankSources(list(chrome), { preferredQuality: '1080p' }, chrome))).toEqual(['aac', 'ddp'])
    expect(list(chrome)[0]!.unsupported).toBe('Dolby Digital Plus audio can’t play in this browser')
    expect(ids(rankSources(list(safari), { preferredQuality: '1080p' }, safari))).toEqual(['ddp', 'aac'])
  })

  it('lists the same URL once', () => {
    const a = source('a', '1080p', 'https://cdn.example/same.mp4')
    const b = { ...source('b', '1080p', 'https://cdn.example/same.mp4'), provider: 'torrentio' }
    expect(ids(dedupe([a, b, source('c', '720p')]))).toEqual(['a', 'c'])
  })
})

// Real names from Trellis, whose MediaStreams are empty: the name is all Flow has to go on.
const trellis = {
  atmosTrueHD: '✨ 4K 🎫  BLURAY REMUX 🔆 DV • HDR10 • IMAX  🔊 Atmos • TrueHD •',
  dtsHdDDP: '✨ 4K 🎫  BLURAY REMUX 🔆 DV • HDR10 • IMAX  🔊 DTS-HD MA • DD+',
  dtsHdDTS: '✨ 4K 🎫  BLURAY REMUX 🔆 DV • HDR10 • IMAX  🔊 DTS-HD MA • DTS',
  dtsHdDTSSize: '✨ 4K 🎫  BLURAY 🔆 HDR10  🔊 DTS-HD MA • DTS 📦 98.8 GB',
  dtsHd: '✨ 4K 🎫  BLURAY 🔆 HDR10  🔊 DTS-HD MA 📦 53.4 GB  🌎 English📝 En',
}
const unnamed = 'Oppenheimer (2023) IMAX 2160p 4K Hybrid UHD HDR10 DV Blu-ray REMUX Dual Audio [Hindi + English] ESub ~ RemuxDoc.mkv'
// A Chrome that, like Chrome 155 on Windows, decodes no Dolby audio, and a Safari that decodes it.
const chromeLike = fixedCapabilities({ video: ['H264', 'HEVC', 'VP9', 'AV1'], audio: ['AAC', 'Opus', 'FLAC', 'MP3'], hdr: true })
const safariLike = fixedCapabilities({ nativeHLS: true, video: ['H264', 'HEVC'], audio: ['AAC', 'DD', 'DD+', 'FLAC', 'MP3'], hdr: true })

describe('sources whose audio this browser can’t play', () => {
  const mkv = (name: string, caps: Capabilities, extra: Partial<Parameters<typeof buildSource>[0]> = {}) =>
    source('t', name, 'https://trellis.test/Videos/1/stream', { filename: 'Oppenheimer.2023.2160p.REMUX.mkv', container: 'mkv', ...extra }, caps)

  it('flags every Trellis name in Chrome, saying which audio it is', () => {
    expect(mkv(trellis.atmosTrueHD, chromeLike).unsupported).toBe('TrueHD Atmos audio can’t play in a browser')
    expect(mkv(trellis.dtsHdDTS, chromeLike).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    expect(mkv(trellis.dtsHdDTSSize, chromeLike).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    expect(mkv(trellis.dtsHd, chromeLike).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    // DD+ is the second format and Chrome can't decode it either.
    expect(mkv(trellis.dtsHdDDP, chromeLike).unsupported).toBe('DTS-HD MA and Dolby Digital Plus audio can’t play in this browser')
  })

  it('lets DD+ and DD follow the browser', () => {
    // Safari decodes E-AC-3, so the DD+ track carries the file.
    expect(mkv(trellis.dtsHdDDP, safariLike).unsupported).toBeUndefined()
    expect(mkv('1080p WEB-DL DD+ 5.1 x264', chromeLike).unsupported).toBe('Dolby Digital Plus audio can’t play in this browser')
    expect(mkv('1080p WEB-DL DD+ 5.1 x264', safariLike).unsupported).toBeUndefined()
    expect(mkv('1080p BluRay DD5.1 x264', chromeLike).unsupported).toBe('Dolby Digital audio can’t play in this browser')
    expect(mkv('1080p BluRay DD5.1 x264', safariLike).unsupported).toBeUndefined()
    // TrueHD and DTS play nowhere, Safari included.
    expect(mkv(trellis.atmosTrueHD, safariLike).unsupported).toBe('TrueHD Atmos audio can’t play in a browser')
    expect(mkv(trellis.dtsHd, safariLike).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
  })

  it('treats a source with no detectable audio as playable', () => {
    expect(mkv(unnamed, chromeLike).unsupported).toBeUndefined()
    expect(mkv('2160p REMUX HEVC', safariLike).unsupported).toBeUndefined()
    expect(hasPlayableAudio([], chromeLike)).toBe(false)
    expect(undecodableAudio([], chromeLike)).toEqual([])
  })

  it('never counts Atmos as a format of its own', () => {
    // Even a browser that claims to play "Atmos" doesn't make TrueHD playable.
    const claimsAtmos: Capabilities = { ...safariLike, audio: (c) => c === 'Atmos' || safariLike.audio(c) }
    expect(unsupportedReason({ engine: 'native', audio: ['TrueHD Atmos'] }, claimsAtmos)).toBeDefined()
    expect(unsupportedReason({ engine: 'native', audio: ['Atmos', 'TrueHD'] }, claimsAtmos)).toBeDefined()
    expect(audioCarriers(['Atmos', 'TrueHD'])).toEqual(['TrueHD'])
    expect(audioCarriers(['TrueHD Atmos', 'TrueHD'])).toEqual(['TrueHD'])
    // Alone it's the streaming flavour, E-AC-3, which the browser decides.
    expect(audioCarriers(['Atmos'])).toEqual(['DD+'])
    expect(unsupportedReason({ engine: 'native', audio: ['Atmos'] }, chromeLike)).toBe('Dolby Digital Plus audio can’t play in this browser')
    expect(unsupportedReason({ engine: 'native', audio: ['Atmos'] }, safariLike)).toBeUndefined()
    expect(chromeLike.audio('Atmos')).toBe(false)
    expect(fixedCapabilities({ audio: ['Atmos', 'AAC'] }).audio('Atmos')).toBe(false)
    // A playable track beside it still carries the file.
    expect(unsupportedReason({ engine: 'native', audio: ['TrueHD Atmos', 'AAC'] }, chromeLike)).toBeUndefined()
  })

  it('leaves server transcodes alone', () => {
    expect(mkv(trellis.atmosTrueHD, chromeLike, { transcoded: true, url: 'https://jf.test/master.m3u8' }).unsupported).toBeUndefined()
  })

  it('treats a Jellyfin source with no media streams the same, going by its name', () => {
    const config = { id: 'jellyfin:trellis:u', kind: 'jellyfin', name: 'Trellis', url: 'https://trellis.test', token: 't', userId: 'u', enabled: true } as const
    const map = (Name: string, caps: Capabilities, extra = {}) => mapMediaSource(config, 'item', { Id: 'ms', Name, Container: 'mkv', MediaStreams: [], ...extra }, 0, 0, caps)
    expect(map(trellis.atmosTrueHD, chromeLike).unsupported).toBe('TrueHD Atmos audio can’t play in a browser')
    expect(map(trellis.dtsHd, chromeLike).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    expect(map(trellis.dtsHdDDP, chromeLike).unsupported).toBe('DTS-HD MA and Dolby Digital Plus audio can’t play in this browser')
    expect(map(trellis.dtsHdDDP, safariLike).unsupported).toBeUndefined()
    expect(map(unnamed, chromeLike).unsupported).toBeUndefined()
    // A link the server only passes on (debrid through an add-on) is judged the same way.
    expect(map(trellis.dtsHd, chromeLike, { IsRemote: true, Path: 'https://addon.test/play/abc.mkv' }).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    expect(map(trellis.dtsHd, chromeLike, { IsRemote: true, Path: 'https://addon.test/play/abc.mkv' }).audio).toEqual(['DTS-HD MA'])
  })

  it('ranks them last in Chrome, whatever their quality', () => {
    const list = [
      mkv(trellis.atmosTrueHD, chromeLike, { id: 'truehd' }),
      source('ddp', '1080p WEB-DL DD+ x264', 'https://x.test/b.mkv', {}, chromeLike),
      source('aac', '720p WEBRip AAC x264', 'https://x.test/c.mkv', {}, chromeLike),
      source('quiet', unnamed, 'https://x.test/d.mkv', {}, chromeLike),
    ]
    const ranked = rankSources(list, { preferredQuality: '2160p' }, chromeLike)
    expect(ids(ranked).slice(0, 2).sort()).toEqual(['aac', 'quiet'])
    expect(ids(ranked).slice(2).sort()).toEqual(['ddp', 'truehd'])
    expect(ranked.slice(2).every((s) => s.score! < 0)).toBe(true)
  })
})

describe('sources whose audio this browser can convert', () => {
  // The same browsers, once they can turn undecodable audio into Opus.
  const converting = fixedCapabilities({ video: ['H264', 'HEVC', 'VP9', 'AV1'], audio: ['AAC', 'Opus', 'FLAC', 'MP3'], hdr: true, convertAudio: true })
  const convertingSafari = fixedCapabilities({ nativeHLS: true, video: ['H264', 'HEVC'], audio: ['AAC', 'DD', 'DD+', 'FLAC', 'MP3'], hdr: true, convertAudio: true })
  const proxy = 'https://proxy.example.com/?url={url}'
  const mkv = (name: string, caps: Capabilities, url = 'https://trellis.test/Videos/1/stream', extra: Partial<Parameters<typeof buildSource>[0]> = {}) =>
    source('t', name, url, { filename: 'Oppenheimer.2023.2160p.REMUX.mkv', container: 'mkv', ...extra }, caps)

  beforeEach(() => {
    settingsStore.set({ streamProxy: '' })
    forgetBlocked()
  })

  it('stays playable, and says its audio is converted', () => {
    const atmos = mkv(trellis.atmosTrueHD, converting)
    expect(atmos.unsupported).toBeUndefined()
    expect(atmos.engine).toBe('remux')
    expect(atmos.convertsAudio).toBe(true)
    expect(atmos.note).toBe('TrueHD Atmos audio converted for this browser')
    expect(mkv(trellis.dtsHd, converting).note).toBe('DTS-HD MA audio converted for this browser')
    expect(mkv(trellis.dtsHdDDP, converting).note).toBe('DTS-HD MA and Dolby Digital Plus audio converted for this browser')
    // Safari decodes Dolby Digital itself, but TrueHD and DTS go through the same conversion.
    expect(mkv(trellis.atmosTrueHD, convertingSafari).note).toBe('TrueHD Atmos audio converted for this browser')
    expect(mkv(trellis.dtsHdDDP, convertingSafari).note).toBeUndefined()
  })

  it('says nothing for audio that plays as it is, or isn’t named', () => {
    for (const s of [mkv('1080p WEB-DL AAC x264', converting), mkv(unnamed, converting), mkv('720p DTS AAC x264', converting)]) {
      expect(s.unsupported).toBeUndefined()
      expect(s.note).toBeUndefined()
      expect(s.convertsAudio).toBeUndefined()
    }
  })

  it('needs a browser that can convert', () => {
    expect(mkv(trellis.atmosTrueHD, chromeLike).unsupported).toBe('TrueHD Atmos audio can’t play in a browser')
    expect(mkv(trellis.atmosTrueHD, chromeLike).note).toBeUndefined()
  })

  it('needs a file Flow can read: not one on a host that blocks web pages, unless a proxy is set', () => {
    const debrid = 'https://42-4.download.real-debrid.com/d/ABC/Oppenheimer.mkv'
    expect(mkv(trellis.dtsHd, converting, debrid).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    settingsStore.set({ streamProxy: proxy })
    expect(mkv(trellis.dtsHd, converting, debrid).unsupported).toBeUndefined()
    expect(mkv(trellis.dtsHd, converting, debrid).note).toBe('DTS-HD MA audio converted for this browser')

    settingsStore.set({ streamProxy: '' })
    const addon = 'https://aio.example.com/playback/abc/Oppenheimer.mkv'
    expect(mkv(trellis.dtsHd, converting, addon).unsupported).toBeUndefined()
    // Once the add-on's origin has been seen blocked, its files aren't readable either.
    rememberBlocked(addon)
    expect(mkv(trellis.dtsHd, converting, addon).unsupported).toBe('DTS-HD MA audio can’t play in a browser')
    settingsStore.set({ streamProxy: proxy })
    expect(mkv(trellis.dtsHd, converting, addon).unsupported).toBeUndefined()
  })

  it('only converts Matroska, or a link that doesn’t say what it is', () => {
    const mp4 = source('mp4', '2160p TrueHD Atmos', 'https://cdn.example.com/a.mp4', {}, converting)
    expect(mp4.unsupported).toBe('TrueHD Atmos audio can’t play in a browser')
    const opaque = source('opaque', '2160p REMUX TrueHD Atmos', 'https://aio.example.com/resolve/abc123', {}, converting)
    expect(opaque.unsupported).toBeUndefined()
    // Only the remuxer converts, so a link of unknown type goes there.
    expect(opaque.engine).toBe('remux')
    expect(opaque.note).toBe('TrueHD Atmos audio converted for this browser')
    // An unknown link with audio that plays is left to the browser.
    expect(source('opaque-aac', '1080p AAC', 'https://aio.example.com/resolve/abc124', {}, converting).engine).toBe('native')
  })

  it('leaves transcodes and unplayable pictures alone', () => {
    const transcode = mkv(trellis.atmosTrueHD, converting, 'https://jf.test/master.m3u8', { transcoded: true })
    expect(transcode.unsupported).toBeUndefined()
    expect(transcode.note).toBeUndefined()
    expect(transcode.engine).not.toBe('remux')
    const noHEVC = fixedCapabilities({ video: ['H264'], audio: ['AAC'], convertAudio: true })
    expect(source('hevc', '2160p HEVC TrueHD', 'https://x.test/a.mkv', {}, noHEVC).unsupported).toBe('HEVC video can’t play in this browser')
  })

  it('ranks below the same file with audio that plays as it is, but above what can’t play at all', () => {
    const list = [
      mkv(trellis.atmosTrueHD, converting, 'https://x.test/truehd.mkv', { id: 'truehd' }),
      source('aac', '2160p BluRay REMUX AAC HEVC', 'https://x.test/aac.mkv', {}, converting),
      source('avi', '2160p XviD', 'https://x.test/c.avi', {}, converting),
    ]
    const ranked = rankSources(list, { preferredQuality: '2160p' }, converting)
    expect(ids(ranked)).toEqual(['aac', 'truehd', 'avi'])
    expect(ranked[1]!.score!).toBeGreaterThan(0)
    expect(ranked[2]!.score!).toBeLessThan(0)
  })

  it('beats equal sources by cache state and seeders only when audio is the sole difference', () => {
    const native = source('native', '2160p WEB-DL AAC x264 [RD+] 👤 900', 'https://x.test/a.mkv', {}, converting)
    const converted = source('converted', '2160p WEB-DL TrueHD x264 [RD+] 👤 900', 'https://x.test/b.mkv', {}, converting)
    const [first, second] = rankSources([converted, native], { preferredQuality: '2160p' }, converting)
    expect(first!.id).toBe('native')
    expect(first!.score! - second!.score!).toBe(200)
    // A better resolution is still worth the conversion.
    const lower = source('lower', '720p WEB-DL AAC x264 [RD+] 👤 900', 'https://x.test/c.mkv', {}, converting)
    expect(ids(rankSources([lower, converted], { preferredQuality: '2160p' }, converting))).toEqual(['converted', 'lower'])
  })
})
