import type { Page } from '../fixtures'

/* What this browser can do, asked of the browser itself with its own APIs (never of the site's code), so the matrix can
   write down what the README promises for it: a file whose sound the browser decodes plays as it is, one it doesn't is
   converted, and so on. The answers come from inside the page because Firefox, WebKit and Chromium differ, and so do
   builds of each. */

export interface Facts {
  /** Safari plays HLS itself, so an HLS stream is the browser's own player there and hls.js everywhere else. */
  nativeHls: boolean
  /** The browser's own player decodes these (canPlayType, which is what a plain <video src> uses). */
  playsHevc: boolean
  playsAv1: boolean
  playsVp9: boolean
  /** MediaSource, which the remuxer and the FFmpeg engine feed, takes these in MP4. */
  mseHevc: boolean
  mseAc3: boolean
  mseEac3: boolean
  mseOpus: boolean
  mseFlac: boolean
  /** A plain <video src> plays Dolby Digital (Plus). */
  playsAc3: boolean
  playsEac3: boolean
  /** WebCodecs: what conversion needs. */
  opusEncoder: boolean
  h264Encoder: boolean
}

export const readFacts = (page: Page): Promise<Facts> =>
  page.evaluate(async () => {
    const v = document.createElement('video')
    const mse = (type: string) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)
    const plays = (type: string) => v.canPlayType(type) !== ''
    const w = window as unknown as { AudioEncoder?: typeof AudioEncoder; VideoEncoder?: typeof VideoEncoder }
    let opusEncoder = false
    let h264Encoder = false
    try {
      opusEncoder = !!w.AudioEncoder && !!(await w.AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 96000 })).supported
    } catch {
      // No encoder.
    }
    try {
      for (const codec of ['avc1.640015', 'avc1.4d0015', 'avc1.42001e'])
        if (w.VideoEncoder && (await w.VideoEncoder.isConfigSupported({ codec, width: 320, height: 180, bitrate: 2_500_000, framerate: 15, avc: { format: 'avc' }, latencyMode: 'realtime' })).supported) h264Encoder = true
    } catch {
      // No encoder.
    }
    return {
      nativeHls: v.canPlayType('application/vnd.apple.mpegurl') !== '' && /Apple/.test(navigator.vendor),
      playsHevc: plays('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      playsAv1: plays('video/mp4; codecs="av01.0.04M.08"'),
      playsVp9: plays('video/webm; codecs="vp9"'),
      mseHevc: mse('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      mseAc3: mse('audio/mp4; codecs="ac-3"'),
      mseEac3: mse('audio/mp4; codecs="ec-3"'),
      mseOpus: mse('audio/mp4; codecs="opus"'),
      mseFlac: mse('audio/mp4; codecs="flac"'),
      playsAc3: plays('video/mp4; codecs="ac-3"'),
      playsEac3: plays('video/mp4; codecs="ec-3"'),
      opusEncoder,
      h264Encoder,
    }
  })
