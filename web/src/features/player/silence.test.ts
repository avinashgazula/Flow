import { describe, expect, it } from 'vitest'
import { fixedCapabilities } from '../../lib/sources/capabilities'
import { audioVerdict, silentAudioNames } from './silence'

const chrome = fixedCapabilities({})
const ready = { readyState: 4 }

describe('audioVerdict', () => {
  it('Chrome and Edge: no decoded audio after a few seconds of playing is silence', () => {
    expect(audioVerdict({ ...ready, webkitAudioDecodedByteCount: 0 }, 1)).toBeUndefined()
    expect(audioVerdict({ ...ready, webkitAudioDecodedByteCount: 0 }, 3.2)).toBe('silent')
    expect(audioVerdict({ ...ready, webkitAudioDecodedByteCount: 48_000 }, 30)).toBe('sound')
    // Before the first frame, nothing says anything.
    expect(audioVerdict({ readyState: 1, webkitAudioDecodedByteCount: 0 }, 10)).toBeUndefined()
  })

  it('Firefox: no audio track opened', () => {
    expect(audioVerdict({ ...ready, mozHasAudio: false }, 0.5)).toBe('silent')
    expect(audioVerdict({ ...ready, mozHasAudio: true }, 30)).toBeUndefined()
  })

  it('where audio tracks are listed, none means no sound', () => {
    expect(audioVerdict({ ...ready, audioTracks: { length: 0 } }, 0.5)).toBe('silent')
    expect(audioVerdict({ ...ready, audioTracks: { length: 1 } }, 5)).toBeUndefined()
    // Decoded bytes win over an empty list.
    expect(audioVerdict({ ...ready, audioTracks: { length: 0 }, webkitAudioDecodedByteCount: 10 }, 5)).toBe('sound')
  })

  it('says nothing in a browser that offers no signal', () => {
    expect(audioVerdict(ready, 60)).toBeUndefined()
  })
})

describe('silentAudioNames', () => {
  it('names what this browser can’t decode', () => {
    expect(silentAudioNames(['TrueHD Atmos'], chrome)).toEqual(['TrueHD'])
    expect(silentAudioNames(['DTS-HD MA', 'DD+'], chrome)).toEqual(['DTS-HD MA', 'Dolby Digital Plus'])
  })
  it('names the listed format when it should have played, and nothing when the source doesn’t say', () => {
    expect(silentAudioNames(['AAC'], chrome)).toEqual(['AAC'])
    expect(silentAudioNames(undefined, chrome)).toEqual([])
  })
})
