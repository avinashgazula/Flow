import { describe, expect, it } from 'vitest'
import { fetchPlanned, LiveTVError } from './net'
import { isMixed, planFetch } from './plan'

const proxy = 'https://proxy.example/fetch?u={url}'

describe('planning a request', () => {
  it('goes straight to the host with no proxy', () => {
    expect(planFetch('https://iptv.example/list.m3u', { proxy: '', blocked: false, pageProtocol: 'https:' })).toEqual({ attempts: [{ url: 'https://iptv.example/list.m3u', viaProxy: false }] })
  })

  it('tries the host first and the proxy second when a proxy is set', () => {
    const { attempts } = planFetch('https://iptv.example/list.m3u', { proxy, blocked: false, pageProtocol: 'https:' })
    expect(attempts).toEqual([
      { url: 'https://iptv.example/list.m3u', viaProxy: false },
      { url: 'https://proxy.example/fetch?u=https%3A%2F%2Fiptv.example%2Flist.m3u', viaProxy: true },
    ])
  })

  it('uses only the proxy for a host known to send no CORS headers', () => {
    expect(planFetch('https://iptv.example/list.m3u', { proxy, blocked: true, pageProtocol: 'https:' }).attempts.map((a) => a.viaProxy)).toEqual([true])
  })

  it('cannot call http from an https page, so it uses the proxy, or says why not', () => {
    expect(isMixed('http://panel.test:8080/x', 'https:')).toBe(true)
    expect(isMixed('http://localhost:8080/x', 'https:')).toBe(false)
    expect(isMixed('http://panel.test/x', 'http:')).toBe(false)
    expect(planFetch('http://panel.test:8080/x', { proxy, blocked: false, pageProtocol: 'https:' }).attempts.map((a) => a.viaProxy)).toEqual([true])
    const none = planFetch('http://panel.test:8080/x', { proxy: '', blocked: false, pageProtocol: 'https:' })
    expect(none.attempts).toEqual([])
    expect(none.problem).toMatch(/panel\.test:8080 is http:\/\/.*stream proxy in Settings/)
  })
})

describe('making a planned request', () => {
  const plan = planFetch('https://iptv.example/list.m3u?pass=secret', { proxy, blocked: false, pageProtocol: 'https:' })
  const answering = (...answers: (Response | Error)[]): typeof fetch => {
    let i = 0
    return (async () => {
      const a = answers[i++]!
      if (a instanceof Error) throw a
      return a
    }) as typeof fetch
  }

  it('returns the first answer that is OK, and says when the host itself was blocked', async () => {
    const fetched = await fetchPlanned('https://iptv.example/list.m3u?pass=secret', plan, { fetchImpl: answering(new TypeError('Failed to fetch'), new Response('#EXTM3U')) })
    expect(fetched.viaProxy).toBe(true)
    expect(fetched.directBlocked).toBe(true)
    expect(await fetched.response.text()).toBe('#EXTM3U')
    const direct = await fetchPlanned('https://iptv.example/list.m3u?pass=secret', plan, { fetchImpl: answering(new Response('ok')) })
    expect(direct).toMatchObject({ viaProxy: false, directBlocked: false })
  })

  it('explains the missing CORS headers and the proxy when there is none, without the address', async () => {
    const noProxy = planFetch('https://iptv.example/list.m3u?pass=secret', { proxy: '', blocked: false, pageProtocol: 'https:' })
    const error = (await fetchPlanned('https://iptv.example/list.m3u?pass=secret', noProxy, { fetchImpl: answering(new TypeError('Failed to fetch')) }).catch((e) => e)) as LiveTVError
    expect(error).toBeInstanceOf(LiveTVError)
    expect(error.message).toMatch(/iptv\.example/)
    expect(error.message).toMatch(/stream proxy in Settings → Playback/)
    expect(error.message).not.toMatch(/secret|list\.m3u/)
  })

  it('reports a proxy that could not reach the host, in the proxy’s words', async () => {
    const error = (await fetchPlanned('https://iptv.example/list.m3u?pass=secret', plan, { fetchImpl: answering(new TypeError('x'), new Response('iptv.example isn’t in ALLOWED_HOSTS.', { status: 403 })) }).catch((e) => e)) as LiveTVError
    expect(error.status).toBe(403)
    expect(error.message).toMatch(/Your stream proxy couldn’t open iptv\.example \(it answered 403\)/)
    expect(error.message).toMatch(/isn’t in ALLOWED_HOSTS/)
    expect(error.message).not.toMatch(/secret/)
  })

  it('says both ways failed when the proxy is unreachable too', async () => {
    const error = (await fetchPlanned('https://iptv.example/list.m3u', plan, { fetchImpl: answering(new TypeError('x'), new TypeError('y')) }).catch((e) => e)) as LiveTVError
    expect(error.message).toMatch(/directly or through your stream proxy/)
  })

  it('does not go on to the proxy when the host answered with a refusal', async () => {
    let calls = 0
    const fetchImpl = (async () => (calls++, new Response('no', { status: 403 }))) as typeof fetch
    const error = (await fetchPlanned('https://iptv.example/list.m3u', plan, { fetchImpl }).catch((e) => e)) as LiveTVError
    expect(calls).toBe(1)
    expect(error.message).toMatch(/refused the request \(403\)/)
  })
})
