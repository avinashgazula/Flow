import { describe, expect, it } from 'vitest'
import { dropRatio, judge, limits, megabits, sizeName, StruggleTracker, struggleText, type Sample } from './struggle'

const s = (seconds: number, dropped: number, total: number, ahead = 30): Sample => ({ at: seconds * 1000, dropped, total, ahead })

/** Samples every two seconds at 24 fps, dropping `share` of the frames, from `from` to `to` seconds. */
function run(tracker: StruggleTracker, from: number, to: number, share: number, ahead = 30) {
  let total = 0
  let dropped = 0
  const out = []
  for (let t = from; t <= to; t += 2) {
    total = Math.round(t * 24)
    dropped = Math.round(total * share)
    tracker.sample(s(t, dropped, total, ahead))
    out.push(tracker.judge(t * 1000, {}))
  }
  return out
}

describe('dropRatio', () => {
  it('needs enough frames to say anything', () => {
    // 3 seconds of film is 72 frames: too few, however many were dropped.
    expect(dropRatio([s(10, 0, 240), s(12, 30, 288), s(13, 40, 312)], 13_000, 0)).toBeUndefined()
    expect(dropRatio([s(10, 0, 240), s(14, 40, 339)], 14_000, 0)).toBeUndefined()
    expect(dropRatio([s(10, 0, 240), s(14, 40, 340)], 14_000, 0)).toBeCloseTo(0.4, 5)
  })

  it('looks at the last ten seconds, and never before the stream settled', () => {
    const samples = [s(0, 0, 0), s(4, 90, 96), s(8, 190, 192), s(10, 190, 240), s(14, 192, 336), s(18, 194, 432)]
    // Everything before 8 s is startup; the window opens at 8 s (or 8 s before now, whichever is later).
    expect(dropRatio(samples, 18_000, 0)).toBeCloseTo(4 / 240, 5)
  })
})

describe('judge', () => {
  const base = { settledFrom: 0, rates: {}, was: false }

  it('stays quiet in the first eight seconds, whatever happens', () => {
    const stalls = [{ at: 3000, ahead: 0 }, { at: 5000, ahead: 0 }, { at: 7000, ahead: 0 }]
    const samples = [s(0, 0, 0), s(4, 90, 96), s(7.9, 180, 190)]
    expect(judge({ ...base, now: 7900, samples, stalls }).struggling).toBe(false)
  })

  it('doesn’t count a start or a seek: stalls inside the settling time are ignored', () => {
    const tracker = new StruggleTracker(0)
    tracker.stall(2000, 0)
    tracker.stall(4000, 0)
    tracker.stall(6000, 0)
    expect(tracker.judge(20_000, {}).stalls).toBe(0)
    // A seek begins it again.
    tracker.stall(30_000, 0)
    tracker.restart(40_000)
    tracker.stall(42_000, 0)
    tracker.stall(44_000, 0)
    expect(tracker.judge(50_000, {})).toMatchObject({ struggling: false, stalls: 0 })
  })

  it('flags dropped frames above 8% over ten seconds, once there are 100 frames', () => {
    const tracker = new StruggleTracker(0)
    const verdicts = run(tracker, 2, 30, 0.2)
    // Quiet through the settling time, and flagged soon after.
    expect(verdicts.slice(0, 4).every((v) => !v.struggling)).toBe(true)
    const first = verdicts.findIndex((v) => v.struggling)
    expect(first).toBeGreaterThan(3)
    expect(2 + first * 2).toBeLessThanOrEqual(16)
    expect(verdicts[first]!.dropRatio).toBeGreaterThan(limits.dropRatio)
  })

  it('doesn’t flag a few dropped frames', () => {
    const tracker = new StruggleTracker(0)
    expect(run(tracker, 2, 120, 0.04).some((v) => v.struggling)).toBe(false)
  })

  it('flags two stalls in a minute, but not one, and forgets them after the minute', () => {
    const tracker = new StruggleTracker(0)
    run(tracker, 2, 20, 0)
    tracker.stall(20_000, 0.2)
    expect(tracker.judge(21_000, {}).struggling).toBe(false)
    tracker.stall(30_000, 0.1)
    expect(tracker.judge(31_000, {})).toMatchObject({ struggling: true, stalls: 2 })
    const lone = new StruggleTracker(0)
    lone.stall(20_000, 0)
    lone.stall(85_000, 0)
    expect(lone.judge(86_000, {}).struggling).toBe(false)
  })

  it('doesn’t end a struggle the moment a number dips, and ends it once things are calm', () => {
    const tracker = new StruggleTracker(0)
    const flagged = run(tracker, 2, 30, 0.2)
    expect(flagged[flagged.length - 1]!.struggling).toBe(true)
    // 5% over the window: under the 8% that began it, over the 3% that ends it.
    let total = 30 * 24
    let dropped = Math.round(total * 0.2)
    const calm: boolean[] = []
    for (let t = 32; t <= 60; t += 2) {
      const frames = 48
      total += frames
      dropped += t <= 44 ? 2 : 0
      tracker.sample(s(t, dropped, total))
      calm.push(tracker.judge(t * 1000, {}).struggling)
    }
    expect(calm[0]).toBe(true)
    expect(calm[calm.length - 1]).toBe(false)
  })

  it('a counter that starts over (a new stream) is not a flood of drops', () => {
    const tracker = new StruggleTracker(0)
    run(tracker, 2, 30, 0.2)
    tracker.restart(31_000)
    tracker.sample(s(40, 0, 100))
    tracker.sample(s(42, 0, 150))
    expect(tracker.judge(42_000, {}).struggling).toBe(false)
    tracker.sample(s(44, 0, 20))
    expect(tracker.judge(44_000, {}).dropRatio).toBeUndefined()
  })

  describe('cause', () => {
    const stalled = (rates: { bytesPerSecond?: number; bitrate?: number }, ahead: number) => {
      const tracker = new StruggleTracker(0)
      run(tracker, 2, 20, 0, ahead)
      tracker.stall(20_000, ahead)
      tracker.stall(26_000, ahead)
      return tracker.judge(27_000, rates)
    }

    it('is the connection when the buffer ran dry and the download is slower than the file', () => {
      expect(stalled({ bytesPerSecond: 1_000_000, bitrate: 3_000_000 }, 0.2)).toMatchObject({ struggling: true, cause: 'connection' })
      // Just under 1.15 times the file's rate is still too tight.
      expect(stalled({ bytesPerSecond: 3_300_000, bitrate: 3_000_000 }, 0.2).cause).toBe('connection')
    })

    it('is the connection when the buffer ran dry and nothing is known about the download', () => {
      expect(stalled({}, 0).cause).toBe('connection')
      expect(stalled({ bytesPerSecond: 900_000 }, 0).cause).toBe('connection')
    })

    it('is not the connection when the download outruns the file', () => {
      expect(stalled({ bytesPerSecond: 8_000_000, bitrate: 3_000_000 }, 0.2).cause).toBe('unknown')
    })

    it('is not the connection when the buffer was healthy', () => {
      expect(stalled({ bytesPerSecond: 100_000, bitrate: 3_000_000 }, 20).cause).toBe('unknown')
    })

    it('is the device when frames drop with a healthy buffer', () => {
      const tracker = new StruggleTracker(0)
      const out = run(tracker, 2, 30, 0.25, 40)
      expect(out[out.length - 1]).toMatchObject({ struggling: true, cause: 'device' })
      // Even with a slow-looking download: the buffer is full, so it isn't what's wrong.
      const slow = new StruggleTracker(0)
      run(slow, 2, 28, 0.25, 40)
      expect(slow.judge(30_000, { bytesPerSecond: 1, bitrate: 3_000_000 }).cause).toBe('device')
    })

    it('is unknown for drops with a thin buffer and no stalls', () => {
      const tracker = new StruggleTracker(0)
      const out = run(tracker, 2, 30, 0.25, 2)
      expect(out[out.length - 1]).toMatchObject({ struggling: true, cause: 'unknown' })
    })

    it('puts the connection first when both show', () => {
      const tracker = new StruggleTracker(0)
      run(tracker, 2, 28, 0.25, 0.3)
      tracker.stall(26_000, 0.1)
      tracker.stall(28_000, 0.1)
      expect(tracker.judge(30_000, { bytesPerSecond: 500_000, bitrate: 3_000_000 }).cause).toBe('connection')
    })
  })
})

describe('words', () => {
  it('names a picture as a viewer would: by the source’s word, else by the picture', () => {
    expect(sizeName('2160p')).toBe('4K')
    expect(sizeName('1080p', 640, 360)).toBe('1080p')
    expect(sizeName(undefined, 3840, 1600)).toBe('4K')
    expect(sizeName(undefined, 3840, 2160)).toBe('4K')
    expect(sizeName(undefined, 1920, 800)).toBe('1080p')
    expect(sizeName(undefined, 1280, 536)).toBe('720p')
    expect(sizeName(undefined, 640, 360)).toBe('360p')
    expect(sizeName(undefined)).toBeUndefined()
    expect(sizeName(undefined, 0, 0)).toBeUndefined()
  })

  it('writes bytes a second as megabits', () => {
    expect(megabits(1_250_000)).toBe('10 Mb/s')
    expect(megabits(437_500)).toBe('3.5 Mb/s')
    expect(megabits(8_000_000)).toBe('64 Mb/s')
  })

  it('says what is known and no more', () => {
    expect(struggleText('device', { size: '4K', codec: 'HEVC' })).toBe('This device can’t keep up with 4K HEVC here.')
    expect(struggleText('device', { size: '1440p' })).toBe('This device can’t keep up with 1440p video here.')
    expect(struggleText('device', { codec: 'AV1' })).toBe('This device can’t keep up with AV1 video here.')
    expect(struggleText('device', {})).toBe('This device can’t keep up with this video here.')
    expect(struggleText('connection', { bytesPerSecond: 437_500, bitrate: 5_000_000 })).toBe('The file isn’t arriving fast enough: about 3.5 Mb/s, and it needs 40 Mb/s.')
    expect(struggleText('connection', { bytesPerSecond: 437_500 })).toBe('The file isn’t arriving fast enough: about 3.5 Mb/s.')
    expect(struggleText('connection', {})).toBe('The file isn’t arriving fast enough.')
    expect(struggleText('unknown', {})).toBe('Playback keeps stalling or dropping frames.')
  })
})
