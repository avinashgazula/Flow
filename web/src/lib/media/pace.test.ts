import { describe, expect, it } from 'vitest'
import { ConversionMeter, ConversionPolicy, tooSlowToStart } from './pace'
import { avcLevel, bitrateFor, encoderCandidates, type EncoderApi, pickEncoder } from './transcode'

describe('the conversion meter', () => {
  it('counts only the time spent working, so a full buffer isn’t slowness', () => {
    const m = new ConversionMeter()
    m.busy(true, 0)
    m.produced(4)
    m.busy(false, 2000) // 4 s of film in 2 s of work
    // Ten more seconds of waiting for the buffer to drain change nothing.
    expect(m.speed(12_000)).toBeCloseTo(2, 5)
  })

  it('says nothing before it has two seconds of work to judge', () => {
    const m = new ConversionMeter()
    m.busy(true, 0)
    m.produced(1)
    expect(m.speed(1500)).toBeNull()
  })

  it('follows the last few seconds, not the whole run', () => {
    const m = new ConversionMeter()
    m.busy(true, 0)
    for (let t = 1000; t <= 10_000; t += 1000) {
      m.produced(t <= 5000 ? 3 : 0.5)
      m.speed(t)
    }
    expect(m.speed(10_000)).toBeLessThan(1.5)
  })
})

describe('the start-up check', () => {
  it('waits for a second of film, then fails what decodes under three quarters of real time', () => {
    expect(tooSlowToStart(0.5, 5000)).toBe(false)
    expect(tooSlowToStart(1.2, 2400)).toBe(true) // half speed
    expect(tooSlowToStart(1.2, 1500)).toBe(false)
    expect(tooSlowToStart(2, 4000)).toBe(true)
  })
})

describe('keeping up', () => {
  it('skips frames, then the loop filter, then says so once', () => {
    const p = new ConversionPolicy()
    expect(p.look(0.8, 1)).toBeNull()
    expect(p.look(0.8, 1)).toBe(1)
    expect(p.look(0.8, 1)).toBeNull()
    expect(p.look(0.8, 1)).toBe(2)
    expect(p.slow).toBe(false)
    p.look(0.8, 1)
    p.look(0.8, 1)
    expect(p.slow).toBe(true)
  })

  it('does nothing while the buffer is healthy or the speed is fine', () => {
    const p = new ConversionPolicy()
    for (let i = 0; i < 10; i++) expect(p.look(0.5, 20)).toBeNull()
    for (let i = 0; i < 10; i++) expect(p.look(2, 0.5)).toBeNull()
    expect(p.level).toBe(0)
  })
})

describe('choosing the encoder', () => {
  it('encodes about 8 Mb/s at 1080p30, more for small pictures than their size says, and never absurdly', () => {
    expect(bitrateFor(1920, 1080, 30)).toBeGreaterThan(7_500_000)
    expect(bitrateFor(1920, 1080, 30)).toBeLessThan(9_500_000)
    expect(bitrateFor(720, 480, 30)).toBe(2_500_000)
    expect(bitrateFor(2560, 1080, 120)).toBeLessThanOrEqual(25_000_000)
  })

  it('names the H.264 level that holds the picture', () => {
    expect(avcLevel(720, 480, 30)).toBe(0x1e)
    expect(avcLevel(1280, 720, 30)).toBe(0x1f)
    expect(avcLevel(1920, 1080, 30)).toBe(0x28)
    expect(avcLevel(1920, 1080, 60)).toBe(0x2a)
  })

  it('tries High with hardware first, then without, then the simpler profiles', () => {
    const list = encoderCandidates(1920, 1080, 24)
    expect(list[0]).toMatchObject({ codec: 'avc1.640028', hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime', avc: { format: 'avc' } })
    expect(list[1]!.hardwareAcceleration).toBe('no-preference')
    expect(list.map((c) => c.codec.slice(5, 9))).toEqual(['6400', '6400', '4D40', '4D40', '42E0', '42E0'])
  })

  it('takes the first the browser accepts, and none when there is no encoder', async () => {
    const accepting = (ok: (c: string, hw?: string) => boolean): EncoderApi => ({ isConfigSupported: async (c) => ({ supported: ok(c.codec, c.hardwareAcceleration) }), create: () => null as never, frame: () => null as never })
    const software = await pickEncoder(1280, 720, 24, accepting((_, hw) => hw === 'no-preference'))
    expect(software).toMatchObject({ codec: 'avc1.64001F', hardwareAcceleration: 'no-preference' })
    const main = await pickEncoder(1280, 720, 24, accepting((c) => c.startsWith('avc1.4D')))
    expect(main!.codec).toBe('avc1.4D401F')
    expect(await pickEncoder(1280, 720, 24, accepting(() => false))).toBeNull()
    expect(await pickEncoder(1280, 720, 24, null)).toBeNull()
  })
})
