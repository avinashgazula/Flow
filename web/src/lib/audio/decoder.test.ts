import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { type AudioCodec, type AudioDecoders, loadAudioDecoders } from './decoder'

/* These decode real streams made by FFmpeg's encoders (fixtures/README.txt): a 440 Hz tone on front
   left, 660 Hz on front right and a quieter 1000 Hz tone on the centre. The checks are about what a
   listener would notice: the right length, sound, each tone on its own side, no clipping. */

const OUT_RATE = 48000

const read = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const wasm = readFileSync(new URL('./pkg/flow-audio.wasm', import.meta.url))

interface Fixture {
  name: string
  codec: AudioCodec
  file: string
  /** What the encoder was asked for, in seconds. */
  seconds: number
  /** Stereo frames at 48 kHz once everything is decoded: whole codec frames, so a little over `seconds`
   *  (FFmpeg's own decoder gives the same count for these files). */
  frames: number
  channels: number
  /** Whether the stream's own stereo downmix includes the centre tone. FFmpeg's TrueHD encoder writes a
   *  plain left/right pair for its stereo presentation, so that one doesn't. */
  centre: boolean
}

const FIXTURES: Fixture[] = [
  { name: 'Dolby Digital 5.1', codec: 'ac3', file: 'ac3-51.ac3', seconds: 1, frames: 32 * 1536, channels: 6, centre: true },
  { name: 'Dolby Digital Plus 5.1', codec: 'eac3', file: 'eac3-51.eac3', seconds: 1, frames: 32 * 1536, channels: 6, centre: true },
  { name: 'DTS 5.1 (core)', codec: 'dts', file: 'dts-51.dts', seconds: 0.4, frames: 38 * 512, channels: 6, centre: true },
  { name: 'Dolby TrueHD 5.1', codec: 'truehd', file: 'truehd-51.thd', seconds: 0.25, frames: 300 * 40, channels: 6, centre: false },
]

function chunks(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let at = 0; at < bytes.length; at += size) out.push(bytes.subarray(at, at + size))
  return out
}

function join(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Feeds a stream in slices that don't line up with frames, the way blocks from a file do, then ends it. */
function decodeAll(decoders: AudioDecoders, codec: AudioCodec, bytes: Uint8Array, chunk = 777, rate = OUT_RATE) {
  const stream = decoders.open(codec, rate)
  const parts = chunks(bytes, chunk).map((c) => stream.decode(c))
  parts.push(stream.finish())
  return { stream, pcm: join(parts) }
}

const channel = (pcm: Float32Array, index: 0 | 1) => Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm[i * 2 + index]!)

/** The middle half of the sound, away from the encoder's start-up and the silent tail. */
function middle(samples: Float32Array, seconds: number, rate = OUT_RATE): Float32Array {
  return samples.subarray(Math.floor(seconds * rate * 0.25), Math.floor(seconds * rate * 0.75))
}

/** Frequency from zero crossings: two per cycle. Good to a few hertz for a clean tone over a tenth of a second. */
function zeroCrossingHz(samples: Float32Array, rate = OUT_RATE): number {
  let crossings = 0
  for (let i = 1; i < samples.length; i++) if (samples[i - 1]! < 0 !== samples[i]! < 0) crossings++
  return (crossings / 2) * (rate / samples.length)
}

/** Amplitude of one frequency in a signal: a single-bin Fourier transform under a Hann window, so a loud tone
 *  nearby doesn't leak into the reading of a quiet one. */
function amplitudeAt(samples: Float32Array, hz: number, rate = OUT_RATE): number {
  let re = 0
  let im = 0
  let weight = 0
  const w = (2 * Math.PI * hz) / rate
  for (let i = 0; i < samples.length; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (samples.length - 1))
    re += samples[i]! * hann * Math.cos(w * i)
    im += samples[i]! * hann * Math.sin(w * i)
    weight += hann
  }
  return (2 * Math.hypot(re, im)) / weight
}

const peak = (samples: Float32Array) => samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length)

/** The largest difference between two signals, infinite if their lengths differ. (Not toEqual: a failing
 *  comparison of 100,000 floats takes minutes to print.) */
function maxDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity
  return a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0)
}

let decoders: AudioDecoders
beforeAll(async () => {
  decoders = await loadAudioDecoders(wasm)
})

describe.each(FIXTURES)('$name', (fixture) => {
  const bytes = read(fixture.file)

  it('decodes to the length that was encoded, as stereo at 48 kHz', () => {
    const { stream, pcm } = decodeAll(decoders, fixture.codec, bytes)
    expect(pcm.length % 2).toBe(0)
    expect(pcm.length / 2).toBe(fixture.frames)
    expect(pcm.length / 2 / OUT_RATE).toBeGreaterThanOrEqual(fixture.seconds)
    expect(stream.sourceSampleRate).toBe(48000)
    expect(stream.sourceChannels).toBe(fixture.channels)
    expect(stream.errors).toBe(0)
    stream.close()
  })

  it('plays each tone on its own side, loud enough and without clipping', () => {
    const { stream, pcm } = decodeAll(decoders, fixture.codec, bytes)
    const left = middle(channel(pcm, 0), fixture.seconds)
    const right = middle(channel(pcm, 1), fixture.seconds)
    expect(rms(left)).toBeGreaterThan(0.05)
    expect(rms(right)).toBeGreaterThan(0.05)
    expect(peak(pcm)).toBeLessThan(0.99)
    expect(Math.abs(zeroCrossingHz(left) - 440)).toBeLessThan(15)
    expect(Math.abs(zeroCrossingHz(right) - 660)).toBeLessThan(20)
    // A swapped or leaking channel would show the other side's tone.
    expect(amplitudeAt(left, 440)).toBeGreaterThan(amplitudeAt(left, 660) * 10)
    expect(amplitudeAt(right, 660)).toBeGreaterThan(amplitudeAt(right, 440) * 10)
    // The centre tone (a quarter as loud, mixed in at -3 dB) reaches both sides, well below the front tones.
    for (const [side, front] of [[left, 440], [right, 660]] as const) {
      const ratio = amplitudeAt(side, 1000) / amplitudeAt(side, front)
      if (fixture.centre) {
        expect(ratio).toBeGreaterThan(0.1)
        expect(ratio).toBeLessThan(0.3)
      } else {
        expect(ratio).toBeLessThan(0.05)
      }
    }
    stream.close()
  })

  it('gives the same sound however the stream is sliced', () => {
    const reference = decodeAll(decoders, fixture.codec, bytes, 777).pcm
    expect(maxDifference(decodeAll(decoders, fixture.codec, bytes, 61).pcm, reference)).toBe(0)
    expect(maxDifference(decodeAll(decoders, fixture.codec, bytes, 4096).pcm, reference)).toBe(0)
    expect(maxDifference(decodeAll(decoders, fixture.codec, bytes, bytes.length).pcm, reference)).toBe(0)
  })

  it('decodes again after a flush, including from the middle of the stream', () => {
    const stream = decoders.open(fixture.codec)
    const whole = join(chunks(bytes, 777).map((c) => stream.decode(c)))
    // After a seek the new position's first block arrives with nothing before it.
    stream.flush()
    const again = join(chunks(bytes, 777).map((c) => stream.decode(c)))
    expect(maxDifference(again, whole)).toBe(0)

    // A seek lands anywhere, not on a frame boundary: the decoder has to find the next frame by itself.
    stream.flush()
    const rest = join(chunks(bytes.subarray(Math.floor(bytes.length / 2) + 13), 777).map((c) => stream.decode(c)))
    expect(rest.length / 2 / OUT_RATE).toBeGreaterThan(fixture.seconds * 0.2)
    expect(rms(rest)).toBeGreaterThan(0.05)
    expect(peak(rest)).toBeLessThan(0.99)
    expect(Math.abs(zeroCrossingHz(channel(rest, 0).subarray(0, Math.floor(0.05 * OUT_RATE))) - 440)).toBeLessThan(40)
    stream.close()
  })

  it('is ready for a new position after finish', () => {
    const stream = decoders.open(fixture.codec)
    const first = join([...chunks(bytes, 777).map((c) => stream.decode(c)), stream.finish()])
    const second = join([...chunks(bytes, 777).map((c) => stream.decode(c)), stream.finish()])
    expect(maxDifference(second, first)).toBe(0)
    stream.close()
  })
})

describe("the wrapper's own downmix", () => {
  /* Every decoder can downmix by itself, and the wrapper asks it to, so these files never reach the
     wrapper's mix in normal use. Bit 8 of the codec number turns the decoder's downmix off, which sends
     the full 5.1 (planar float, planar or packed 32-bit integers, depending on the codec) through it. */
  const IDS = { ac3: 1, eac3: 2, dts: 3, truehd: 4 }
  function decodeMixedHere(codec: AudioCodec, bytes: Uint8Array): Float32Array {
    const x = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports as unknown as {
      memory: WebAssembly.Memory
      fa_open(codec: number, rate: number): number
      fa_input(handle: number, size: number): number
      fa_decode(handle: number, size: number): number
      fa_output(handle: number): number
      fa_finish(handle: number): number
      fa_info(handle: number, key: number): number
    }
    const handle = x.fa_open(IDS[codec] | 0x100, OUT_RATE)
    const parts: Float32Array[] = []
    const take = (frames: number) => {
      if (frames > 0) parts.push(new Float32Array(x.memory.buffer, x.fa_output(handle), frames * 2).slice())
    }
    for (const c of chunks(bytes, 777)) {
      new Uint8Array(x.memory.buffer, x.fa_input(handle, c.length), c.length).set(c)
      take(x.fa_decode(handle, c.length))
    }
    take(x.fa_finish(handle))
    expect(x.fa_info(handle, 4)).toBe(0)
    return join(parts)
  }

  it.each(FIXTURES)('mixes $name to stereo, centre at -3 dB, LFE dropped, nothing clipped', (fixture) => {
    const pcm = decodeMixedHere(fixture.codec, read(fixture.file))
    expect(pcm.length / 2).toBe(fixture.frames)
    const left = middle(channel(pcm, 0), fixture.seconds)
    const right = middle(channel(pcm, 1), fixture.seconds)
    // Front 0.375, centre 0.1 at -3 dB (0.0707), all divided by 1 + 0.707 + 0.707 (the loudest sum of
    // gains in the matrix: the centre and a surround, both silent here, but counted so full scale can't clip).
    const norm = 1 / (1 + Math.SQRT1_2 * 2)
    const within3Percent = (actual: number, expected: number) => expect(Math.abs(actual / expected - 1)).toBeLessThan(0.03)
    within3Percent(amplitudeAt(left, 440), 0.375 * norm)
    within3Percent(amplitudeAt(right, 660), 0.375 * norm)
    within3Percent(amplitudeAt(left, 1000), 0.1 * Math.SQRT1_2 * norm)
    within3Percent(amplitudeAt(right, 1000), 0.1 * Math.SQRT1_2 * norm)
    expect(amplitudeAt(left, 660)).toBeLessThan(0.002)
    expect(amplitudeAt(right, 440)).toBeLessThan(0.002)
    expect(peak(pcm)).toBeLessThan(0.99)
  })
})

describe('sample rates', () => {
  it('converts a 44.1 kHz source to 48 kHz without changing its pitch or length', () => {
    const { stream, pcm } = decodeAll(decoders, 'ac3', read('ac3-51-44k.ac3'))
    expect(stream.sourceSampleRate).toBe(44100)
    // 29 frames of 1536 samples at 44.1 kHz, now at 48 kHz.
    expect(pcm.length / 2).toBeGreaterThanOrEqual(Math.floor((29 * 1536 * OUT_RATE) / 44100) - 1)
    expect(pcm.length / 2).toBeLessThanOrEqual(Math.ceil((29 * 1536 * OUT_RATE) / 44100) + 1)
    const left = middle(channel(pcm, 0), 1)
    expect(Math.abs(zeroCrossingHz(left) - 440)).toBeLessThan(15)
    expect(Math.abs(zeroCrossingHz(middle(channel(pcm, 1), 1)) - 660)).toBeLessThan(20)
    // The conversion adds no tones of its own: nothing near the mirror image of 440 Hz around 22.05 kHz.
    expect(amplitudeAt(left, 21610)).toBeLessThan(0.001)
    expect(peak(pcm)).toBeLessThan(0.99)
    stream.close()
  })

  it('gives the same pitch and a continuous signal however the input is sliced', () => {
    const bytes = read('ac3-51-44k.ac3')
    const reference = decodeAll(decoders, 'ac3', bytes, 777).pcm
    // Tiny slices make the resampler run on a frame at a time and carry its state across every call.
    expect(maxDifference(decodeAll(decoders, 'ac3', bytes, 100).pcm, reference)).toBe(0)
    // No jumps: neighbouring samples of a 440 Hz tone at -6 dB never differ by much.
    const left = channel(reference, 0)
    let step = 0
    for (let i = 1; i < left.length; i++) step = Math.max(step, Math.abs(left[i]! - left[i - 1]!))
    expect(step).toBeLessThan(0.05)
  })

  it('opens at another output rate when asked', () => {
    const { stream, pcm } = decodeAll(decoders, 'ac3', read('ac3-51.ac3'), 777, 44100)
    expect(Math.abs(pcm.length / 2 - (32 * 1536 * 44100) / 48000)).toBeLessThanOrEqual(1)
    expect(Math.abs(zeroCrossingHz(middle(channel(pcm, 0), 1, 44100), 44100) - 440)).toBeLessThan(15)
    stream.close()
  })
})

describe('the loader', () => {
  it('compiles once per source and gives each caller its own instance', async () => {
    const copy = new Uint8Array(wasm)
    const a = await loadAudioDecoders(copy)
    const b = await loadAudioDecoders(copy)
    const bytes = read('ac3-51.ac3')
    const one = a.open('ac3')
    const two = b.open('ac3')
    // Streams from separate instances don't disturb each other, even when interleaved.
    const alone = join(chunks(bytes, 777).map((c) => one.decode(c)))
    two.decode(bytes.subarray(0, 100))
    expect(alone.length).toBeGreaterThan(0)
    expect(two.errors).toBe(0)
    one.close()
    two.close()
  })

  it('refuses to use a stream after it is closed, and closing twice is fine', () => {
    const stream = decoders.open('dts')
    stream.close()
    stream.close()
    expect(() => stream.decode(new Uint8Array(10))).toThrow(/closed/)
    expect(stream.errors).toBe(0)
    expect(stream.sourceChannels).toBe(0)
  })

  it('returns nothing for an empty slice or for bytes that are not the codec, without throwing', () => {
    const stream = decoders.open('truehd')
    expect(stream.decode(new Uint8Array(0)).length).toBe(0)
    expect(stream.decode(new Uint8Array(5000).fill(0x55)).length).toBe(0)
    expect(stream.finish().length).toBe(0)
    stream.close()
  })

  it('opens many streams in one instance, and rejects a rate it cannot use', () => {
    const streams = Array.from({ length: 6 }, () => decoders.open('eac3'))
    streams.forEach((s) => s.close())
    expect(() => decoders.open('ac3', 100)).toThrow()
  })

  it('declares only imports it can stub', () => {
    const module = new WebAssembly.Module(wasm)
    for (const entry of WebAssembly.Module.imports(module)) expect(entry.kind).toBe('function')
  })

  it('rejects when the bytes are not WebAssembly', async () => {
    await expect(loadAudioDecoders(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })
})

describe('the WASI stubs', () => {
  /* A hand-assembled module that asks its host for what a rebuilt flow-audio.wasm might: it imports
     args_sizes_get, proc_exit and an unknown fd_write. fa_open returns 42 plus whatever sits at address 16,
     which starts as -1, so it returns 42 only if the stub wrote the zero count there; fa_close calls proc_exit. */
  const str = (text: string) => [text.length, ...Array.from(text, (c) => c.charCodeAt(0))]
  const section = (id: number, ...body: number[]) => [id, body.length, ...body]
  const wasi = str('wasi_snapshot_preview1')
  const fakeModule = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, 2, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 1, 0x7f, 0), // (i32, i32) -> i32 and (i32) -> ()
    ...section(2, 3, ...wasi, ...str('args_sizes_get'), 0, 0, ...wasi, ...str('proc_exit'), 0, 1, ...wasi, ...str('fd_write'), 0, 0),
    ...section(3, 2, 0, 1),
    ...section(5, 1, 0, 1),
    ...section(7, 3, ...str('memory'), 2, 0, ...str('fa_open'), 0, 3, ...str('fa_close'), 0, 4),
    ...section(10, 2, 17, 0, 0x41, 16, 0x41, 20, 0x10, 0, 0x1a, 0x41, 16, 0x28, 2, 0, 0x41, 42, 0x6a, 0x0b, 6, 0, 0x20, 0, 0x10, 1, 0x0b),
    ...section(11, 1, 0, 0x41, 16, 0x0b, 4, 0xff, 0xff, 0xff, 0xff),
  ])

  it('gives every declared import a stub, answers the cheap ones and refuses the rest', async () => {
    const fake = await loadAudioDecoders(fakeModule)
    const stream = fake.open('ac3') // would throw if fa_open returned 0 or the imports didn't link
    // proc_exit is the one stub that must not return: the module has said it cannot continue.
    expect(() => stream.close()).toThrow(/exit 42/)
  })
})

describe('loading by URL', () => {
  // A fresh copy of the module each time, because it keeps the compiled module of the default file.
  const fresh = async () => {
    vi.resetModules()
    return (await import('./decoder')).loadAudioDecoders
  }
  const respond = (type: string | null, status = 200) => () =>
    Promise.resolve(new Response(new Uint8Array(wasm), { status, headers: type ? { 'content-type': type } : {} }))
  afterEach(() => vi.unstubAllGlobals())

  it('fetches the default file once, streaming it, and shares it between callers', async () => {
    const serve = respond('application/wasm')
    const fetchSpy = vi.fn((_input: RequestInfo | URL) => serve())
    vi.stubGlobal('fetch', fetchSpy)
    const load = await fresh()
    const [a, b] = await Promise.all([load(), load()])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/pkg\/flow-audio\.wasm$/)
    a.open('ac3').close()
    b.open('truehd').close()
  })

  it('still works when the server sends the wrong content type', async () => {
    vi.stubGlobal('fetch', respond('application/octet-stream'))
    const load = await fresh()
    ;(await load(new URL('https://example.test/flow-audio.wasm'))).open('eac3').close()
  })

  it('reports a failed download, and tries again next time', async () => {
    let ok = false
    vi.stubGlobal('fetch', () => respond(ok ? 'application/wasm' : null, ok ? 200 : 404)())
    const load = await fresh()
    await expect(load()).rejects.toThrow(/404/)
    ok = true
    ;(await load()).open('dts').close()
  })
})
