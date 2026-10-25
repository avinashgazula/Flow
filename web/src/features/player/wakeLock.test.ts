import { describe, expect, it, vi } from 'vitest'
import { ScreenAwake, wantsWakeLock, type WakeLockApi } from './wakeLock'

function fakeApi() {
  const made: { released: boolean; release: ReturnType<typeof vi.fn>; fire(): void }[] = []
  const api: WakeLockApi = {
    request: vi.fn(async () => {
      let onRelease = () => {}
      const sentinel = {
        released: false,
        release: vi.fn(async () => {
          sentinel.released = true
        }),
        addEventListener: (_: 'release', l: () => void) => void (onRelease = l),
        fire() {
          sentinel.released = true
          onRelease()
        },
      }
      made.push(sentinel)
      return sentinel
    }),
  }
  return { api, made }
}

describe('when the screen is kept awake', () => {
  it('is while playing in a visible page, and not paused, ended or hidden', () => {
    expect(wantsWakeLock({ paused: false, ended: false, hidden: false })).toBe(true)
    expect(wantsWakeLock({ paused: true, ended: false, hidden: false })).toBe(false)
    expect(wantsWakeLock({ paused: false, ended: true, hidden: false })).toBe(false)
    expect(wantsWakeLock({ paused: false, ended: false, hidden: true })).toBe(false)
  })
})

describe('ScreenAwake', () => {
  it('takes the lock once however often it is told, and releases it on pause', async () => {
    const { api, made } = fakeApi()
    const awake = new ScreenAwake(api)
    await awake.update(true)
    await awake.update(true)
    expect(api.request).toHaveBeenCalledTimes(1)
    await awake.update(false)
    expect(made[0]!.release).toHaveBeenCalledTimes(1)
  })

  it('takes it again when the browser dropped it (the page was hidden) and the page is back', async () => {
    const { api, made } = fakeApi()
    const awake = new ScreenAwake(api)
    await awake.update(true)
    made[0]!.fire()
    await awake.update(true)
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it('lets go of a lock that arrived after it stopped being wanted', async () => {
    const { api, made } = fakeApi()
    const awake = new ScreenAwake(api)
    const first = awake.update(true)
    await awake.update(false)
    await first
    expect(made[0]!.release).toHaveBeenCalledTimes(1)
  })

  it('carries on when the browser refuses or has no such thing', async () => {
    const refusing = new ScreenAwake({ request: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) })
    await expect(refusing.update(true)).resolves.toBeUndefined()
    const none = new ScreenAwake(undefined)
    await expect(none.update(true)).resolves.toBeUndefined()
    await expect(none.release()).resolves.toBeUndefined()
  })
})
