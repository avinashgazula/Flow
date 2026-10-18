import { describe, expect, it } from 'vitest'
import { fixedCapabilities } from './capabilities'
import { parseStream } from './parser'
import { buildSource, containerOf, dedupe, engineFor, rankSources, resolutionScore } from './rank'
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

  it('demotes Dolby audio where there’s no Dolby decoder', () => {
    const list = [source('ddp', '1080p WEB-DL x264 DDP5.1'), source('aac', '1080p WEB-DL x264 AAC')]
    expect(ids(rankSources(list, { preferredQuality: '1080p' }, chrome))).toEqual(['aac', 'ddp'])
    expect(ids(rankSources(list, { preferredQuality: '1080p' }, safari))).toEqual(['ddp', 'aac'])
  })

  it('lists the same URL once', () => {
    const a = source('a', '1080p', 'https://cdn.example/same.mp4')
    const b = { ...source('b', '1080p', 'https://cdn.example/same.mp4'), provider: 'torrentio' }
    expect(ids(dedupe([a, b, source('c', '720p')]))).toEqual(['a', 'c'])
  })
})
