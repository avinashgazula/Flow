import type { Page } from '../fixtures'
import { fileHost } from './harness'

/* What a browser does, against what it says. isTypeSupported and isConfigSupported are claims; this runs the thing: it encodes
   one picture and one audio buffer the way the engine's converter does, and appends one second of each kind of fragmented MP4
   the engine produces to a real SourceBuffer. The report goes into a failing test's log, so a browser that says "yes" and then
   stalls can be told from one that says "no". */

export interface Probe {
  [what: string]: string
}

const mseCases: [name: string, mime: string, file: string][] = [
  ['H.264 in MP4', 'video/mp4; codecs="avc1.64001E"', 'probe-h264.mp4'],
  ['AAC in MP4', 'audio/mp4; codecs="mp4a.40.2"', 'probe-aac.mp4'],
  ['FLAC in MP4', 'audio/mp4; codecs="flac"', 'probe-flac.mp4'],
  ['MP3 in MP4', 'audio/mp4; codecs="mp3"', 'probe-mp3.mp4'],
  ['Opus in MP4', 'audio/mp4; codecs="opus"', 'probe-opus.mp4'],
]

export async function probeBrowser(page: Page): Promise<Probe> {
  return page.evaluate(
    async ({ host, cases }) => {
      const out: Record<string, string> = {}
      const within = <T>(promise: Promise<T>, ms: number, what: string) =>
        Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms))])
      const w = window as unknown as { VideoEncoder?: typeof VideoEncoder; AudioEncoder?: typeof AudioEncoder }

      // The picture encoder, with the configuration the site asks for first.
      if (!w.VideoEncoder) out['VideoEncoder'] = 'absent'
      else {
        const config = { codec: 'avc1.64000D', width: 320, height: 180, bitrate: 2_500_000, framerate: 15, latencyMode: 'realtime' as const, hardwareAcceleration: 'no-preference' as const, avc: { format: 'avc' as const } }
        try {
          const claim = await w.VideoEncoder.isConfigSupported(config)
          out['VideoEncoder claims'] = String(claim.supported)
          let chunks = 0
          let failed = ''
          const encoder = new w.VideoEncoder({ output: () => void chunks++, error: (e) => (failed = `${e.name}: ${e.message}`) })
          encoder.configure(config)
          const frame = new VideoFrame(new Uint8Array(320 * 180 * 1.5), { format: 'I420', codedWidth: 320, codedHeight: 180, timestamp: 0, duration: 66_000 })
          encoder.encode(frame, { keyFrame: true })
          frame.close()
          const began = performance.now()
          await within(encoder.flush(), 6000, 'flush')
          out['VideoEncoder did'] = failed ? `error ${failed}` : `${chunks} chunk(s) in ${Math.round(performance.now() - began)} ms`
        } catch (error) {
          out['VideoEncoder did'] = `threw ${(error as Error).name}: ${(error as Error).message}`
        }
      }

      // The audio encoder the Matroska path converts sound with.
      if (!w.AudioEncoder) out['AudioEncoder'] = 'absent'
      else {
        const config = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 96000 }
        try {
          out['AudioEncoder claims'] = String((await w.AudioEncoder.isConfigSupported(config)).supported)
          let chunks = 0
          let failed = ''
          const encoder = new w.AudioEncoder({ output: () => void chunks++, error: (e) => (failed = `${e.name}: ${e.message}`) })
          encoder.configure(config)
          encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 960, numberOfChannels: 2, timestamp: 0, data: new Float32Array(1920) }))
          await within(encoder.flush(), 6000, 'flush')
          out['AudioEncoder did'] = failed ? `error ${failed}` : `${chunks} chunk(s)`
        } catch (error) {
          out['AudioEncoder did'] = `threw ${(error as Error).name}: ${(error as Error).message}`
        }
      }

      // Each fragment kind the engine writes, appended to a real SourceBuffer.
      for (const [name, mime, file] of cases) {
        const claim = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime)
        let did = ''
        try {
          const bytes = await (await fetch(`${host}/${file}`)).arrayBuffer()
          const source = new MediaSource()
          const video = document.createElement('video')
          video.src = URL.createObjectURL(source)
          await within(new Promise<void>((resolve) => source.addEventListener('sourceopen', () => resolve(), { once: true })), 4000, 'sourceopen')
          const buffer = source.addSourceBuffer(mime)
          const settled = new Promise<string>((resolve) => {
            buffer.addEventListener('updateend', () => resolve('appended'), { once: true })
            buffer.addEventListener('error', () => resolve('SourceBuffer error event'), { once: true })
            video.addEventListener('error', () => resolve(`video error ${video.error?.code} ${video.error?.message}`), { once: true })
          })
          buffer.appendBuffer(bytes)
          did = `${await within(settled, 5000, 'append')}, buffered ${Array.from({ length: buffer.buffered.length }, (_, i) => `${buffer.buffered.start(i).toFixed(2)}-${buffer.buffered.end(i).toFixed(2)}`).join(',') || 'nothing'}`
          URL.revokeObjectURL(video.src)
        } catch (error) {
          did = `threw ${(error as Error).name}: ${(error as Error).message}`
        }
        out[`MSE ${name}`] = `claims ${claim}, then ${did}`
      }
      return out
    },
    { host: fileHost, cases: mseCases },
  )
}

/** For a failure message: what the browser claims against what it does. */
export async function probeText(page: Page): Promise<string> {
  try {
    return Object.entries(await probeBrowser(page))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n  ')
  } catch (error) {
    return `(probe failed: ${(error as Error).message})`
  }
}
