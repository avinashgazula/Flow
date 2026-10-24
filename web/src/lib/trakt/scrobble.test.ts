import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '../tmdb/types'
import { TraktError } from './client'
import { claimKey, forgetClaims, isClaimed } from './claims'
import { createScrobbler, type Reading } from './scrobble'

const sent = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }))
vi.mock('./session', () => ({
  trakt: () => ({
    scrobble: async (...args: unknown[]) => {
      sent.calls.push(args)
      if (sent.fail) throw new Error('offline')
    },
  }),
}))

const film: MediaItem = { type: 'movie', id: 7, title: 'Dune', overview: '', genres: [] }
const show: MediaItem = { type: 'show', id: 9, title: 'Severance', overview: '', genres: [] }
const reading = (percent: number, over: Partial<Reading> = {}): Reading => ({ item: film, position: percent, duration: 100, ...over })

function make(failStop = false) {
  const log: [string, unknown, number, boolean][] = []
  const watched: [MediaItem, unknown][] = []
  const scrobbler = createScrobbler({
    send: async (action, target, percent, keepalive) => {
      log.push([action, target, percent, keepalive])
      if (failStop && action === 'stop') throw new TraktError('Couldn’t reach Trakt. Check your connection.', 'network')
    },
    markWatched: (item, episode) => void watched.push([item, episode]),
  })
  return { scrobbler, log, watched }
}

beforeEach(() => {
  forgetClaims()
  sent.calls = []
  sent.fail = false
})

describe('the calls for one play', () => {
  it('starts, pauses and stops with how far in, and does not repeat a start while playing', async () => {
    const { scrobbler, log } = make()
    await scrobbler.play(reading(0))
    await scrobbler.play(reading(1))
    await scrobbler.pause(reading(30.5))
    await scrobbler.pause(reading(31))
    await scrobbler.play(reading(31))
    await scrobbler.stop(reading(55))
    expect(log).toEqual([
      ['start', { type: 'movie', id: 7 }, 0, false],
      ['pause', { type: 'movie', id: 7 }, 30.5, false],
      ['start', { type: 'movie', id: 7 }, 31, false],
      ['stop', { type: 'movie', id: 7 }, 55, false],
    ])
  })

  it('names an episode by its show, season and episode', async () => {
    const { scrobbler, log } = make()
    await scrobbler.play(reading(10, { item: show, episode: { season: 2, episode: 3 } }))
    expect(log[0]![1]).toEqual({ type: 'show', id: 9, season: 2, episode: 3 })
  })

  it('sends a pause from a page that is going away with keepalive so the browser lets it finish', async () => {
    const { scrobbler, log } = make()
    await scrobbler.play(reading(20))
    await scrobbler.pause(reading(25), true)
    expect(log[1]).toEqual(['pause', { type: 'movie', id: 7 }, 25, true])
  })

  it('does nothing for a stop with no start, and nothing twice for a stop after a stop', async () => {
    const { scrobbler, log } = make()
    await scrobbler.stop(reading(90))
    await scrobbler.pause(reading(90))
    await scrobbler.play(reading(10))
    await scrobbler.stop(reading(20), false)
    await scrobbler.stop(reading(20), false)
    expect(log.map((l) => l[0])).toEqual(['start', 'stop'])
  })

  it('treats the end of the file as 100 whatever the position says', async () => {
    const { scrobbler, log } = make()
    await scrobbler.play(reading(50))
    await scrobbler.stop(reading(97), true)
    expect(log[1]![2]).toBe(100)
  })

  it('holds progress between 0 and 100 when the duration is not known yet', async () => {
    const { scrobbler, log } = make()
    await scrobbler.play(reading(5, { duration: Number.NaN }))
    await scrobbler.pause(reading(500, { duration: 100 }))
    expect(log.map((l) => l[2])).toEqual([0, 100])
  })

  it('stops the first episode and starts the next when the player moves on without closing', async () => {
    const { scrobbler, log } = make()
    const ep = (n: number, percent: number) => reading(percent, { item: show, episode: { season: 1, episode: n } })
    await scrobbler.play(ep(1, 10))
    await scrobbler.pause(ep(1, 95))
    await scrobbler.play(ep(1, 95))
    await scrobbler.play(ep(2, 0))
    expect(log.map((l) => [l[0], (l[1] as { episode: number }).episode, l[2]])).toEqual([
      ['start', 1, 10],
      ['pause', 1, 95],
      ['start', 1, 95],
      ['stop', 1, 95],
      ['start', 2, 0],
    ])
  })
})

describe('Trakt’s watched line', () => {
  it('marks the title watched here when the stop is at 80 % or more, and not below', async () => {
    const above = make()
    await above.scrobbler.play(reading(0))
    await above.scrobbler.stop(reading(80))
    expect(above.watched).toEqual([[film, undefined]])
    const below = make()
    await below.scrobbler.play(reading(0))
    await below.scrobbler.stop(reading(79.9))
    expect(below.watched).toEqual([])
  })

  it('marks an episode with its season and number', async () => {
    const { scrobbler, watched } = make()
    await scrobbler.play(reading(0, { item: show, episode: { season: 1, episode: 4 } }))
    await scrobbler.stop(reading(100, { item: show, episode: { season: 1, episode: 4 } }), true)
    expect(watched).toEqual([[show, { season: 1, episode: 4 }]])
  })

  it('claims the play while it runs and for a while after a counted stop, so the library’s mark is not sent twice', async () => {
    const key = claimKey('movie', 7)
    const { scrobbler } = make()
    await scrobbler.play(reading(0))
    expect(isClaimed(key)).toBe(true)
    await scrobbler.stop(reading(90))
    expect(isClaimed(key)).toBe(true)
    expect(isClaimed(key, Date.now() + 121_000)).toBe(false)
  })

  it('lets go of the claim at once after a stop that Trakt didn’t count', async () => {
    const { scrobbler } = make()
    await scrobbler.play(reading(0))
    await scrobbler.stop(reading(40))
    expect(isClaimed(claimKey('movie', 7))).toBe(false)
  })

  it('drops the claim before marking when the stop could not be sent, so the mark travels as an ordinary change', async () => {
    const claimedWhenMarked: boolean[] = []
    const scrobbler = createScrobbler({
      send: async (action) => {
        if (action === 'stop') throw new TraktError('offline', 'network')
      },
      markWatched: () => void claimedWhenMarked.push(isClaimed(claimKey('movie', 7))),
    })
    await scrobbler.play(reading(0))
    await scrobbler.stop(reading(95))
    expect(claimedWhenMarked).toEqual([false])
    expect(isClaimed(claimKey('movie', 7))).toBe(false)
  })

  it('keeps the claim while it marks when the stop was sent', async () => {
    const claimedWhenMarked: boolean[] = []
    const scrobbler = createScrobbler({ send: async () => {}, markWatched: () => void claimedWhenMarked.push(isClaimed(claimKey('movie', 7))) })
    await scrobbler.play(reading(0))
    await scrobbler.stop(reading(95))
    expect(claimedWhenMarked).toEqual([true])
  })

  it('never throws at the player when Trakt fails', async () => {
    const { scrobbler } = make(true)
    await scrobbler.play(reading(0))
    await expect(scrobbler.stop(reading(95))).resolves.toBeUndefined()
  })
})

describe('following a video element', () => {
  class FakeVideo extends EventTarget {
    paused = true
    ended = false
  }

  async function setup() {
    forgetClaims()
    const events = new EventTarget()
    vi.stubGlobal('document', Object.assign(events, { visibilityState: 'visible' }))
    vi.stubGlobal('window', new EventTarget())
    const { startScrobbling } = await import('./scrobble')
    const video = new FakeVideo()
    const where = { position: 0 }
    const stop = startScrobbling(video as unknown as HTMLVideoElement, () => ({ ...reading(where.position) }))
    const fire = async (type: string) => {
      video.dispatchEvent(new Event(type))
      await vi.waitFor(() => void 0)
      await new Promise((r) => setTimeout(r, 0))
    }
    return { video, where, stop, fire, hide: (state: 'hidden' | 'visible') => ((document as unknown as { visibilityState: string }).visibilityState = state, document.dispatchEvent(new Event('visibilitychange'))) }
  }
  const actions = () => sent.calls.map((c) => [c[0], c[2]])

  it('starts on play, pauses on pause, and stops when the player closes', async () => {
    const t = await setup()
    t.where.position = 10
    t.video.paused = false
    await t.fire('play')
    t.where.position = 42
    t.video.paused = true
    await t.fire('pause')
    t.where.position = 43
    expect(actions()).toEqual([['start', 10], ['pause', 42]])
    // Closing a player that is already paused stops it where it was.
    t.stop()
    await vi.waitFor(() => expect(actions().at(-1)).toEqual(['stop', 43]))
  })

  it('stops at 100 on the end of the file, and ignores the pause the browser sends first', async () => {
    const t = await setup()
    t.video.paused = false
    t.where.position = 99
    await t.fire('play')
    t.video.ended = true
    t.video.paused = true
    await t.fire('pause')
    await t.fire('ended')
    await vi.waitFor(() => expect(actions()).toEqual([['start', 99], ['stop', 100]]))
  })

  it('says it paused when the page is hidden, with keepalive, and nothing when it was already paused', async () => {
    const t = await setup()
    t.hide('hidden')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent.calls).toEqual([])
    t.video.paused = false
    t.where.position = 20
    await t.fire('play')
    t.where.position = 30
    t.hide('hidden')
    await vi.waitFor(() => expect(sent.calls.map((c) => [c[0], c[3]])).toEqual([['start', false], ['pause', true]]))
  })
})
