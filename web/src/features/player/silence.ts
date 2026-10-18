/* Telling when a file the browser plays on its own is playing without sound. Browsers play a
   Matroska file with TrueHD, DTS or Dolby audio happily and say nothing: the picture moves and the
   audio simply isn't decoded. Each engine reports it differently, so this asks every way it can. */

import { audioCarriers, audioLabel, undecodableAudio } from '../../lib/sources/rank'
import type { Capabilities } from '../../lib/sources/capabilities'

/** Seconds of playing before "no audio decoded yet" means "none": the decoder starts a moment after
 *  the picture, and a seek or a slow start shouldn't raise a false alarm. */
export const silenceAfter = 3

type AudioProbe = Pick<HTMLVideoElement, 'readyState'> & {
  /** Chrome, Edge and Safari: bytes of audio the decoder has produced so far. */
  webkitAudioDecodedByteCount?: number
  /** Firefox: false when no audio track was opened. */
  mozHasAudio?: boolean
  /** Safari, and Chrome behind a flag. Absent elsewhere. */
  audioTracks?: { length: number }
}

/** 'silent' when the element shows no sign of decoded audio, 'sound' when it shows some, and
 *  undefined while it's too early to say. `played` is the seconds actually played, not the position. */
export function audioVerdict(video: AudioProbe, played: number): 'silent' | 'sound' | undefined {
  // Nothing is decoded before the first frame is ready, whatever the file holds.
  if (video.readyState < 2) return undefined
  const decoded = video.webkitAudioDecodedByteCount
  if (typeof decoded === 'number' && decoded > 0) return 'sound'
  if (video.mozHasAudio === false) return 'silent'
  if (video.audioTracks && video.audioTracks.length === 0) return 'silent'
  if (typeof decoded === 'number' && played >= silenceAfter) return 'silent'
  return undefined
}

/** The audio formats to name when telling the viewer there's no sound: the ones this browser can't
 *  decode, else everything the source names (the name said a format that works, yet nothing
 *  played). Empty when the source doesn't say. */
export function silentAudioNames(audio: string[] | undefined, caps: Capabilities): string[] {
  const list = audio ?? []
  const mute = undecodableAudio(list, caps)
  return (mute.length ? mute : audioCarriers(list)).slice(0, 2).map(audioLabel)
}
