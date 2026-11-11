import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetCors, hostAllowsCors, sameOrigin } from './cors'

beforeEach(forgetCors)

describe('hostAllowsCors', () => {
  it('says yes for a host that answers the ranged request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 206 })
    expect(await hostAllowsCors('https://cdn.test/a.mp4', { fetcher })).toBe(true)
    expect(fetcher).toHaveBeenCalledWith('https://cdn.test/a.mp4', expect.objectContaining({ mode: 'cors', headers: { Range: 'bytes=0-0' } }))
  })
  it('says no when the browser refuses the request (no CORS headers)', async () => {
    expect(await hostAllowsCors('https://nocors.test/a.mkv', { fetcher: () => Promise.reject(new TypeError('Failed to fetch')) })).toBe(false)
  })
  it('says no for an error status and for a host that never answers', async () => {
    expect(await hostAllowsCors('https://a.test/x', { fetcher: async () => ({ ok: false, status: 403 }) })).toBe(false)
    const slow = (_: string, init: RequestInit) => new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await hostAllowsCors('https://slow.test/x', { fetcher: slow, timeoutMs: 10 })).toBe(false)
  })
  it('asks once per host', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await hostAllowsCors('https://same.test/one', { fetcher })
    await hostAllowsCors('https://same.test/two?x=1', { fetcher })
    await hostAllowsCors('https://other.test/one', { fetcher })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not ask about addresses that are not http', async () => {
    const fetcher = vi.fn()
    expect(await hostAllowsCors('blob:https://x/1', { fetcher })).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('sameOrigin', () => {
  it('compares origins', () => {
    expect(sameOrigin('/samples/a.mkv', 'https://m.test')).toBe(true)
    expect(sameOrigin('https://m.test/x', 'https://m.test')).toBe(true)
    expect(sameOrigin('https://cdn.test/x', 'https://m.test')).toBe(false)
  })
})
