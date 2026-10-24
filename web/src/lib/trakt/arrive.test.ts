import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ finishSignInFromAddress: vi.fn(async () => {}) }))
vi.mock('./session', () => session)

let replaced: string[]

function at(pathname: string, search = '') {
  replaced = []
  vi.stubGlobal('location', { pathname, search })
  vi.stubGlobal('history', { state: null, replaceState: (_s: unknown, _t: string, url: string) => void replaced.push(url) })
}

beforeEach(() => {
  session.finishSignInFromAddress.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('arriving from Trakt', () => {
  it('points the address at Settings → Account before anything reads it, then finishes the sign-in with the code', async () => {
    at('/settings/trakt-callback', '?code=abc&state=xyz')
    const { arriveFromTrakt } = await import('./arrive')
    arriveFromTrakt()
    expect(replaced).toEqual(['/settings#account'])
    await vi.waitFor(() => expect(session.finishSignInFromAddress).toHaveBeenCalledWith('?code=abc&state=xyz'))
  })

  it('also takes the address with a trailing slash', async () => {
    at('/settings/trakt-callback/', '?code=abc')
    const { arriveFromTrakt } = await import('./arrive')
    arriveFromTrakt()
    expect(replaced).toEqual(['/settings#account'])
  })

  it('leaves every other address alone, and loads nothing', async () => {
    for (const path of ['/', '/settings', '/title/movie/1', '/settings/trakt-callback-not']) {
      at(path)
      const { arriveFromTrakt } = await import('./arrive')
      arriveFromTrakt()
      expect(replaced).toEqual([])
    }
    expect(session.finishSignInFromAddress).not.toHaveBeenCalled()
  })
})
