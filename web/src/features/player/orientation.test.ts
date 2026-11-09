import { afterEach, describe, expect, it, vi } from 'vitest'
import { canAutoRotate, rotateForFullscreen } from './orientation'

const screenWith = () => ({ orientation: { lock: vi.fn((_: 'landscape') => Promise.resolve()), unlock: vi.fn() } })
const touchScreen = () => vi.stubGlobal('matchMedia', () => ({ matches: true }))
afterEach(() => vi.unstubAllGlobals())

describe('Auto Rotate to Landscape', () => {
  it('is offered only where the browser can lock the screen, on a touch device', () => {
    expect(canAutoRotate(screenWith(), true)).toBe(true)
    expect(canAutoRotate(screenWith(), false)).toBe(false)
    expect(canAutoRotate({ orientation: {} }, true)).toBe(false)
    expect(canAutoRotate({}, true)).toBe(false)
    expect(canAutoRotate(undefined, true)).toBe(false)
  })

  it('locks to landscape on entering full screen and unlocks on leaving', () => {
    const scr = screenWith()
    touchScreen()
    rotateForFullscreen(true, true, scr)
    expect(scr.orientation.lock).toHaveBeenCalledWith('landscape')
    rotateForFullscreen(false, true, scr)
    expect(scr.orientation.unlock).toHaveBeenCalledOnce()
  })

  it('does nothing while the setting is off, and a refused lock is quiet', async () => {
    const scr = screenWith()
    touchScreen()
    rotateForFullscreen(true, false, scr)
    expect(scr.orientation.lock).not.toHaveBeenCalled()
    scr.orientation.lock.mockImplementationOnce(() => Promise.reject(new Error('NotSupportedError')))
    expect(() => rotateForFullscreen(true, true, scr)).not.toThrow()
    await Promise.resolve()
  })
})
