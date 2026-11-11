/* Whether converted sound should keep 5.1 here. Kept apart from support.ts, which the first page load
   imports: only the player asks, and only when it opens an MKV. */

import { checkConvertAudio } from './support'

/* Surround. Converted sound can stay 5.1 (see remux/convert.ts) when this browser can encode the pieces
   of a six-channel Opus stream, MSE will play six-channel Opus in MP4, and the output device has the
   speakers to use it. Without all three, stereo: a mix the decoder made itself (with the stream's own
   downmix coefficients) beats whatever a browser would fold six channels into on a two-channel device.
   There's no setting for this because the apps have none: they follow the device the same way. */

/** What WebCodecs is asked for. Opus in WebCodecs is mono or stereo only, so a six-channel stream is made of these. */
const pieceConfigs = [1, 2].map((numberOfChannels) => ({ codec: 'opus', sampleRate: 48000, numberOfChannels, bitrate: 96000 }))

/** Safari's MSE takes Opus in MP4 but its six-channel behaviour isn't one Marquee has been able to confirm, so it stays stereo. */
function isWebKit(): boolean {
  try {
    const ua = (globalThis as any).navigator?.userAgent ?? ''
    return /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(ua)
  } catch {
    return false
  }
}

/** How many channels the default output can play, as the Web Audio API reports it: 2 for headphones and
 *  laptop speakers, 6 or 8 for an HDMI receiver set up for surround. 2 where it can't be asked. */
export function outputChannelCount(): number {
  try {
    const Context = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext
    if (!Context) return 2
    const context = new Context()
    const channels = context.destination.maxChannelCount
    void context.close?.()
    return Number.isFinite(channels) && channels > 0 ? channels : 2
  } catch {
    return 2
  }
}

const opusType = 'audio/mp4; codecs="opus"'

let surroundCache: Promise<boolean> | undefined

/** True when converted sound should keep 5.1 here. Asks the encoder, the media stack and the output once, and never throws. */
export function checkSurroundAudio(): Promise<boolean> {
  surroundCache ??= (async () => {
    try {
      if (!(await checkConvertAudio()) || isWebKit()) return false
      const g = globalThis as any
      // Each piece of a six-channel stream is a mono or stereo encoder.
      for (const config of pieceConfigs) if (!(await g.AudioEncoder.isConfigSupported(config))?.supported) return false
      // MSE's own answer for six channels. Browsers without MediaCapabilities are taken at isTypeSupported's word.
      const info = await g.navigator?.mediaCapabilities?.decodingInfo?.({ type: 'media-source', audio: { contentType: opusType, channels: '5.1', samplerate: 48000 } })
      if (info && !info.supported) return false
      return outputChannelCount() >= 6
    } catch {
      return false
    }
  })()
  return surroundCache
}
