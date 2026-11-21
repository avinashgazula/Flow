import { describe, expect, it } from 'vitest'
import { claimTrusted, rangeEndAt } from './mse'

describe('which MediaSource answers are believed', () => {
  const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36'
  it('does not believe Firefox about MP3 in MP4, in any of its spellings', () => {
    for (const mime of ['audio/mp4; codecs="mp3"', 'audio/mp4; codecs="mp4a.6B"', 'audio/mp4; codecs="mp4a.69"']) expect(claimTrusted(mime, firefox)).toBe(false)
  })
  it('believes it about everything else, and believes other browsers about MP3', () => {
    expect(claimTrusted('audio/mp4; codecs="mp4a.40.2"', firefox)).toBe(true)
    expect(claimTrusted('audio/mp4; codecs="flac"', firefox)).toBe(true)
    expect(claimTrusted('audio/mp4; codecs="mp3"', chrome)).toBe(true)
  })
})

const ranges = (...list: [number, number][]) => ({ length: list.length, start: (i: number) => list[i]![0], end: (i: number) => list[i]![1] })

describe('which buffered range holds a time', () => {
  it('finds the range a time is inside, and its end', () => {
    expect(rangeEndAt(ranges([0, 10], [20, 30]), 5)).toBe(10)
    expect(rangeEndAt(ranges([0, 10], [20, 30]), 25)).toBe(30)
    expect(rangeEndAt(ranges([0, 10]), 15)).toBeNull()
  })

  it('lets the first frame sit a little after zero', () => {
    // A film's first picture is a few frames in: time zero is still "buffered".
    expect(rangeEndAt(ranges([0.2, 8]), 0)).toBe(8)
  })

  it('does not count a range that begins well after the time, away from the start of the film', () => {
    // After an audio switch the new sound begins at 1.10; 0.80 is before it, so the sound there is not buffered.
    expect(rangeEndAt(ranges([1.1, 8.2]), 0.8)).toBeNull()
    expect(rangeEndAt(ranges([30, 40]), 29.7)).toBeNull()
  })

  it('still forgives the small gaps between fragments', () => {
    expect(rangeEndAt(ranges([30.05, 40]), 30)).toBe(40)
  })
})
