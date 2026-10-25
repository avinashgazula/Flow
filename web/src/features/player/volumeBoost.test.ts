import { describe, expect, it, vi } from 'vitest'
import { boostLabel, canBoost, clampBoost, dbToGain, VolumeBoost } from './volumeBoost'

describe('the boost', () => {
  it('is whole decibels from none to 12', () => {
    expect(clampBoost(6.4)).toBe(6)
    expect(clampBoost(-3)).toBe(0)
    expect(clampBoost(40)).toBe(12)
    expect(clampBoost(Number.NaN)).toBe(0)
  })

  it('reads as the apps do and turns into a gain', () => {
    expect(boostLabel(0)).toBe('Off')
    expect(boostLabel(6)).toBe('+6 dB')
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(6)).toBeCloseTo(1.995, 3)
    expect(dbToGain(12)).toBeCloseTo(3.981, 3)
  })
})

describe('where a boost is offered', () => {
  const origin = 'https://flow.example'
  it('is on the engines that play bytes the page fetched itself', () => {
    expect(canBoost({ engine: 'remux', blocked: false, url: 'https://cdn.other/a.mkv', origin })).toBe(true)
    expect(canBoost({ engine: 'hls', blocked: false, url: 'https://cdn.other/a.m3u8', origin })).toBe(true)
  })

  it('is on a plain file only from this site’s own address', () => {
    expect(canBoost({ engine: 'native', blocked: false, url: 'https://flow.example/media/a.mp4', origin })).toBe(true)
    expect(canBoost({ engine: 'native', blocked: false, url: '/media/a.mp4', origin })).toBe(true)
    expect(canBoost({ engine: 'native', blocked: false, url: 'https://cdn.other/a.mp4', origin })).toBe(false)
  })

  it('is never on a file the browser plays itself because its host blocks web pages', () => {
    expect(canBoost({ engine: 'remux', blocked: true, url: 'https://cdn.other/a.mkv', origin })).toBe(false)
  })
})

/** Just enough of Web Audio to see what was built and connected. */
function fakeContext(state: 'running' | 'suspended') {
  const nodes: { kind: string; connected: unknown[]; gain?: { value: number } }[] = []
  const node = (kind: string, extra: object = {}) => {
    const n = { kind, connected: [] as unknown[], connect: vi.fn((to: unknown) => void n.connected.push(to)), disconnect: vi.fn(() => void (n.connected.length = 0)), ...extra }
    nodes.push(n)
    return n
  }
  class Context {
    state = state
    destination = { kind: 'destination' }
    resume = vi.fn(async () => {})
    close = vi.fn(async () => {})
    createMediaElementSource = vi.fn(() => node('source'))
    createGain = vi.fn(() => node('gain', { gain: { value: 1 } }))
    createDynamicsCompressor = vi.fn(() => node('limiter', { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }))
  }
  return { Context: Context as unknown as typeof AudioContext, nodes }
}

describe('VolumeBoost', () => {
  const video = {} as HTMLVideoElement

  it('builds nothing for no boost', async () => {
    const { Context, nodes } = fakeContext('running')
    const boost = new VolumeBoost(video, Context)
    await boost.set(0)
    expect(nodes).toHaveLength(0)
  })

  it('wires the element through a gain and a limiter, and straight out again at 0 dB', async () => {
    const { Context, nodes } = fakeContext('running')
    const boost = new VolumeBoost(video, Context)
    await boost.set(6)
    const gain = nodes.find((n) => n.kind === 'gain')!
    const limiter = nodes.find((n) => n.kind === 'limiter')!
    expect(gain.gain!.value).toBeCloseTo(1.995, 3)
    expect(gain.connected).toEqual([limiter])
    await boost.set(0)
    expect(gain.gain!.value).toBe(1)
    expect(gain.connected).toEqual([{ kind: 'destination' }])
    // The graph is built once, however the level moves.
    await boost.set(3)
    expect(nodes.filter((n) => n.kind === 'source')).toHaveLength(1)
  })

  it('leaves the element alone when the context won’t run, so the sound can’t be lost', async () => {
    const { Context, nodes } = fakeContext('suspended')
    const boost = new VolumeBoost(video, Context)
    await boost.set(6)
    expect(nodes.some((n) => n.kind === 'source')).toBe(false)
    expect(boost.active).toBe(false)
    // Browsers allow a context to run only after a tap or key press: a later try works.
    expect(boost.supported).toBe(true)
  })

  it('wires the element once a later try finds the context able to run', async () => {
    const first = fakeContext('suspended')
    const boost = new VolumeBoost(video, first.Context)
    await boost.set(6)
    expect(boost.active).toBe(false)
    const ready = fakeContext('running')
    ;(boost as unknown as { Context: typeof AudioContext }).Context = ready.Context
    await boost.set(6)
    expect(boost.active).toBe(true)
  })

  it('says it is unsupported where there is no Web Audio', () => {
    expect(new VolumeBoost(video, undefined).supported).toBe(false)
  })
})
