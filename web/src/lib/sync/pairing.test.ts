import { describe, expect, it } from 'vitest'
import { incompleteKey } from './crypto'
import { appLink, normaliseServer, parsePairing, serverFromProxy, webLink } from './pairing'

const key = Uint8Array.from({ length: 16 }, (_, i) => i)
const text = '000G40R40M30E209185GR38E1W'
const server = 'https://flow-stream-proxy.example.workers.dev'

describe('the server from the stream proxy setting', () => {
  it('is the origin of the template and its token', () => {
    expect(serverFromProxy(`${server}/?url={url}&token=a b+c`)).toEqual({ server, token: 'a b c' })
    expect(serverFromProxy(`${server}/?url={url}&token=s3cret`)).toEqual({ server, token: 's3cret' })
    expect(serverFromProxy(`${server}/proxy?token=s3cret&url={url}`)).toEqual({ server, token: 's3cret' })
  })
  it('has no token when the template has none, and is null when there is no proxy', () => {
    expect(serverFromProxy(`${server}/?url={url}`)).toEqual({ server, token: '' })
    expect(serverFromProxy(`${server}/`)).toEqual({ server, token: '' })
    expect(serverFromProxy('  ')).toBeNull()
    expect(serverFromProxy('not an address')).toBeNull()
  })
})

describe('a typed server address', () => {
  it('becomes its origin, with https added', () => {
    expect(normaliseServer('flow-stream-proxy.example.workers.dev')).toBe(server)
    expect(normaliseServer(` ${server}/some/path?x=1 `)).toBe(server)
    expect(normaliseServer('http://localhost:8787/')).toBe('http://localhost:8787')
    expect(normaliseServer('')).toBeNull()
    expect(normaliseServer('ftp://x.example.com')).toBeNull()
  })
})

describe('the pairing link', () => {
  it('has the document’s web form, with the server and token URL-encoded', () => {
    expect(webLink(key, server, 'to&k=en', 'https://flow.example.com/')).toBe(`https://flow.example.com/settings#sync=k=${text}&s=${encodeURIComponent(server)}&t=to%26k%3Den`)
    expect(webLink(key, server, 't', 'https://flow.example.com/Flow')).toBe(`https://flow.example.com/Flow/settings#sync=k=${text}&s=${encodeURIComponent(server)}&t=t`)
  })

  it('has the apps’ form', () => {
    expect(appLink(key, server, 'tok')).toBe(`flow://sync?k=${text}&s=${encodeURIComponent(server)}&t=tok`)
  })

  it('reads every form back', () => {
    const want = { key, server, token: 'to&k=en' }
    for (const input of [
      webLink(key, server, 'to&k=en', 'https://flow.example.com/'),
      `#sync=k=${text}&s=${encodeURIComponent(server)}&t=${encodeURIComponent('to&k=en')}`,
      `sync=k=${text}&s=${encodeURIComponent(server)}&t=${encodeURIComponent('to&k=en')}`,
      appLink(key, server, 'to&k=en'),
      `  ${appLink(key, server, 'to&k=en')}\n`,
    ]) {
      expect(parsePairing(input), input).toEqual({ ok: true, pairing: want })
    }
  })

  it('reads a bare key, grouped or not', () => {
    expect(parsePairing('000G-40R4-0M30-E209-185G-R38E-1W')).toEqual({ ok: true, pairing: { key } })
    expect(parsePairing(text.toLowerCase())).toEqual({ ok: true, pairing: { key } })
  })

  it('reads a link without a token or server', () => {
    expect(parsePairing(`flow://sync?k=${text}`)).toEqual({ ok: true, pairing: { key } })
  })

  it('says what is wrong with a link it cannot use', () => {
    expect(parsePairing(`flow://sync?k=${text.slice(2)}&s=${server}`)).toEqual({ ok: false, error: incompleteKey })
    expect(parsePairing('#sync=s=x')).toEqual({ ok: false, error: incompleteKey })
    expect(parsePairing('hello')).toEqual({ ok: false, error: incompleteKey })
    expect(parsePairing(`#sync=k=${text}&s=ftp%3A%2F%2Fx`)).toMatchObject({ ok: false })
  })
})
