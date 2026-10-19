/* Whether this browser can turn audio it can't decode (TrueHD, DTS, Dolby Digital) into Opus, which
   it can. Conversion needs WebCodecs' AudioEncoder, and an Opus track that Media Source Extensions
   will take. The quick answer comes from those two being present; the slow one asks the encoder
   whether it takes the settings Flow uses. Ranking reads the quick answer for every row, so it is
   worked out once. */

const opusType = 'audio/mp4; codecs="opus"'

/** The settings Flow asks the encoder for: plain stereo Opus, which every browser with an Opus
 *  encoder takes. */
const encoderConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }

let cached: boolean | undefined
let refining: Promise<boolean> | undefined

function guess(): boolean {
  try {
    const g = globalThis as any
    if (!('AudioEncoder' in g)) return false
    const MS = g.ManagedMediaSource ?? g.MediaSource
    return !!MS?.isTypeSupported?.(opusType)
  } catch {
    return false
  }
}

/** True when conversion looks possible here. Synchronous, so ranking can ask for every source; once
 *  `checkConvertAudio` has answered, that answer is what this returns. */
export function canConvertAudio(): boolean {
  cached ??= guess()
  return cached
}

/** The same question, answered by the encoder itself. Call it once at startup: it never throws, and
 *  nothing waits on it. */
export function checkConvertAudio(): Promise<boolean> {
  refining ??= (async () => {
    if (!canConvertAudio()) return false
    try {
      const result = await (globalThis as any).AudioEncoder.isConfigSupported(encoderConfig)
      cached = !!result?.supported
    } catch {
      cached = false
    }
    return cached
  })()
  return refining
}
