import { beforeEach, describe, expect, it } from 'vitest'
import { checkSmoothVideo, codecString, decodingConfig, probe, resetSmoothVideo, smoothAnswers, smoothnessOf } from './smooth'

type Ask = Parameters<typeof probe>[0]

beforeEach(() => resetSmoothVideo())

describe('what is asked', () => {
  it('uses the representative codec strings', () => {
    expect(codecString('HEVC', 2160, true)).toBe('hvc1.2.4.L153.B0')
    expect(codecString('AV1', 2160, true)).toBe('av01.0.12M.10')
    expect(codecString('VP9', 2160, true)).toBe('vp09.02.51.10')
    expect(codecString('H264', 2160, false)).toBe('avc1.640033')
    expect(codecString('H264', 1080, false)).toBe('avc1.640028')
    // 4K SDR is usually 10-bit too; 1080p SDR usually isn't.
    expect(codecString('HEVC', 2160, false)).toBe('hvc1.2.4.L153.B0')
    expect(codecString('HEVC', 1080, false)).toBe('hvc1.1.6.L120.B0')
  })

  it('adds the HDR fields only for HDR', () => {
    const hdr = decodingConfig('HEVC', 2160, true).video
    expect(hdr).toMatchObject({ width: 3840, height: 2160, transferFunction: 'pq', colorGamut: 'rec2020', hdrMetadataType: 'smpteSt2086' })
    expect(decodingConfig('HEVC', 2160, false).video).not.toHaveProperty('transferFunction')
    expect(decodingConfig('HEVC', 2160, true, false).video).not.toHaveProperty('transferFunction')
  })
})

describe('probe', () => {
  it('reports the browser’s three answers', async () => {
    const ask: Ask = async () => ({ supported: true, smooth: false, powerEfficient: false })
    expect(await probe(ask, 'HEVC', 2160, false)).toEqual({ supported: true, smooth: false, powerEfficient: false })
  })

  it('asks again without the HDR fields when a browser rejects them', async () => {
    const seen: unknown[] = []
    const ask: Ask = async (config) => {
      seen.push(config)
      if ('transferFunction' in (config as { video: object }).video) throw new TypeError('bad enum')
      return { supported: true, smooth: true, powerEfficient: true }
    }
    expect(await probe(ask, 'AV1', 2160, true)).toEqual({ supported: true, smooth: true, powerEfficient: true })
    expect(seen).toHaveLength(2)
  })

  it('asks again without the HDR fields when the screen isn’t HDR and the browser says unsupported', async () => {
    const ask: Ask = async (config) => ('transferFunction' in (config as { video: object }).video ? { supported: false, smooth: false, powerEfficient: false } : { supported: true, smooth: false, powerEfficient: false })
    expect(await probe(ask, 'HEVC', 2160, true)).toEqual({ supported: true, smooth: false, powerEfficient: false })
    // SDR has no second question.
    const sdr: Ask = async () => ({ supported: false })
    expect(await probe(sdr, 'HEVC', 2160, false)).toEqual({ supported: false, smooth: false, powerEfficient: false })
  })

  it('says nothing when the browser throws every time', async () => {
    const ask: Ask = async () => {
      throw new TypeError('no')
    }
    expect(await probe(ask, 'AV1', 1080, false)).toBeUndefined()
    expect(await probe(ask, 'AV1', 1080, true)).toBeUndefined()
  })
})

describe('the remembered answers', () => {
  it('are read by codec, resolution and range, whichever way the codec is spelled', async () => {
    const ask: Ask = async (config) => {
      const { contentType, transferFunction } = (config as { video: { contentType: string; transferFunction?: string } }).video
      if (contentType.includes('av01')) return { supported: false }
      return { supported: true, smooth: !(contentType.includes('hvc1') && transferFunction), powerEfficient: contentType.includes('avc1') }
    }
    await checkSmoothVideo(ask)
    expect(smoothnessOf('HEVC', '2160p', true)).toEqual({ supported: true, smooth: false, powerEfficient: false })
    expect(smoothnessOf('HEVC', '2160p', false)?.smooth).toBe(true)
    expect(smoothnessOf('H.264', '1080p', false)).toEqual({ supported: true, smooth: true, powerEfficient: true })
    // Undecodable at all is canPlayType's business: no answer kept.
    expect(smoothnessOf('AV1', '2160p', false)).toBeUndefined()
    // Not a class that's checked.
    expect(smoothnessOf('HEVC', '720p', false)).toBeUndefined()
    expect(smoothnessOf(undefined, '2160p', false)).toBeUndefined()
    expect(smoothnessOf('HEVC', undefined, false)).toBeUndefined()
    expect(smoothnessOf('XviD', '1080p', false)).toBeUndefined()
    expect(Object.keys(smoothAnswers())).toContain('VP9@1440+hdr')
  })

  it('stay unknown with no API, and checking twice asks once', async () => {
    await checkSmoothVideo(undefined)
    expect(smoothnessOf('HEVC', '2160p', false)).toBeUndefined()
    resetSmoothVideo()
    let asked = 0
    const ask: Ask = async () => (asked++, { supported: true, smooth: true, powerEfficient: true })
    await Promise.all([checkSmoothVideo(ask), checkSmoothVideo(ask)])
    expect(asked).toBe(4 * 3 * 2)
  })
})
