import { describe, expect, it } from 'vitest'
import { fixedCapabilities, type Capabilities } from './capabilities'
import { parseStream } from './parser'
import { buildSource, inefficientPenalty, rankSources, stutterNote, stutterPenalty } from './rank'
import type { Source } from './types'

function source(id: string, text: string, url = `https://cdn.example/${id}.mp4`, extra: Partial<Parameters<typeof buildSource>[0]> = {}, caps: Capabilities = fixedCapabilities({})): Source {
  return buildSource({ id, origin: 'addon', provider: 'aio', providerId: 'aio', title: id, url, traits: parseStream(text), ...extra }, caps)
}
const ids = (list: Source[]) => list.map((s) => s.id)

describe('video this device decodes slowly', () => {
  const chrome = { video: ['H264', 'HEVC', 'VP9', 'AV1'] }
  const stutters = fixedCapabilities({ ...chrome, smooth: { 'HEVC@2160': { smooth: false, powerEfficient: false } } })
  const software = fixedCapabilities({ ...chrome, smooth: { 'HEVC@2160': { smooth: true, powerEfficient: false } } })
  const fine = fixedCapabilities({ ...chrome, smooth: { 'HEVC@2160': { smooth: true, powerEfficient: true } } })
  const list = () => [
    source('4k', '2160p BluRay REMUX HEVC HDR10 AAC 60 GB', undefined, { filename: 'a.mkv' }, stutters),
    source('1080', '1080p WEB-DL x264 AAC 4 GB', undefined, { filename: 'b.mkv' }, stutters),
  ]

  it('puts a smooth 1080p copy ahead of a 4K one that stutters, even when 4K is preferred', () => {
    for (const preferredQuality of ['2160p', 'any', '1080p'] as const) {
      expect(ids(rankSources(list(), { preferredQuality }, stutters))).toEqual(['1080', '4k'])
    }
    // On a device that copes, 4K leads.
    expect(ids(rankSources(list(), { preferredQuality: '2160p' }, fine))).toEqual(['4k', '1080'])
  })

  it('keeps it above what can’t play at all', () => {
    const dts = source('dts', '2160p BluRay DTS-HD MA x264', 'https://x.test/a.mkv')
    const ranked = rankSources([dts, ...list()], { preferredQuality: '2160p' }, stutters)
    expect(ids(ranked)).toEqual(['1080', '4k', 'dts'])
    expect(ranked[1]!.score!).toBeGreaterThan(-100_000)
    expect(stutterPenalty).toBeGreaterThan(inefficientPenalty)
  })

  it('says so in the picker, after any note the source already has', () => {
    const [first] = rankSources([list()[0]!], { preferredQuality: '2160p' }, stutters)
    expect(first!.note).toBe(stutterNote)
    expect(first!.mayStutter).toBe(true)
    const converting = fixedCapabilities({ ...chrome, convertAudio: true, audio: ['AAC'], smooth: { 'HEVC@2160': { smooth: false } } })
    const converted = source('conv', '2160p BluRay REMUX HEVC HDR10 TrueHD 7.1', 'https://x.test/a.mkv', {}, converting)
    expect(converted.note).toMatch(/converted for this browser/)
    const once = rankSources([converted], { preferredQuality: '2160p' }, converting)
    const [again] = rankSources(once, { preferredQuality: '2160p' }, converting)
    // Ranked twice, still said once.
    expect(again!.note?.split(stutterNote)).toHaveLength(2)
    expect(again!.note).toMatch(/converted for this browser · May stutter on this device$/)
    expect(rankSources([list()[1]!], { preferredQuality: '2160p' }, stutters)[0]!.note).toBeUndefined()
  })

  it('takes a little off software decoding that keeps up, with no note', () => {
    const [warm] = rankSources([list()[0]!], { preferredQuality: '2160p' }, software)
    const [cool] = rankSources([list()[0]!], { preferredQuality: '2160p' }, fine)
    expect(cool!.score! - warm!.score!).toBe(inefficientPenalty)
    expect(warm!.note).toBeUndefined()
    // Not enough to turn a better picture down.
    expect(ids(rankSources(list(), { preferredQuality: '2160p' }, software))).toEqual(['4k', '1080'])
  })

  it('changes nothing while the answer is unknown', () => {
    const unknown = fixedCapabilities(chrome)
    const plain = rankSources(list(), { preferredQuality: '2160p' }, unknown)
    expect(ids(plain)).toEqual(['4k', '1080'])
    expect(plain.map((x) => x.score)).toEqual(rankSources(list(), { preferredQuality: '2160p' }, fine).map((x) => x.score))
    expect(plain[0]!.note).toBeUndefined()
  })

  it('tells HDR from SDR, and Dolby Vision counts as its HEVC base layer', () => {
    const hdrOnly = fixedCapabilities({ ...chrome, smooth: { 'HEVC@2160+hdr': { smooth: false } } })
    const sdr = source('sdr', '2160p WEB-DL x265 AAC 15 GB', undefined, { filename: 'a.mkv' }, hdrOnly)
    const dv = source('dv', '2160p WEB-DL DV x265 AAC 15 GB', undefined, { filename: 'b.mkv' }, hdrOnly)
    const ranked = rankSources([dv, sdr], { preferredQuality: '2160p' }, hdrOnly)
    expect(ids(ranked)).toEqual(['sdr', 'dv'])
    expect(ranked[1]!.mayStutter).toBe(true)
  })

  it('leaves a server’s transcode alone: it’s decoded as the server made it', () => {
    const jf = source('jf', '2160p HEVC AAC', 'https://jf.test/master.m3u8', { origin: 'jellyfin', transcoded: true }, stutters)
    expect(rankSources([jf], { preferredQuality: '2160p' }, stutters)[0]!.mayStutter).toBeUndefined()
  })
})
