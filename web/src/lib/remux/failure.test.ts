import { describe, expect, it } from 'vitest'
import { cleanDetail, detailWanted, httpFailureMessage, networkFailureMessage } from './failure'

describe('detailWanted', () => {
  it('reads plain text and JSON, and skips pages and files', () => {
    for (const type of ['text/plain', 'text/plain; charset=utf-8', 'application/json', 'application/problem+json']) expect(detailWanted(type)).toBe(true)
    for (const type of ['text/html', 'video/x-matroska', '', null, undefined]) expect(detailWanted(type)).toBe(false)
  })
})

describe('cleanDetail', () => {
  it('strips markup, links and extra space', () => {
    expect(cleanDetail('  <b>IP</b>\n address  not allowed ')).toBe('IP address not allowed')
    expect(cleanDetail('Expired: https://files.example.com/d/abc?token=secret.')).toBe('Expired: files.example.com')
  })

  it('shortens a long answer and drops an empty one', () => {
    expect(cleanDetail('word '.repeat(100))!.length).toBeLessThanOrEqual(201)
    expect(cleanDetail('<br>  ')).toBeUndefined()
  })
})

describe('httpFailureMessage through the proxy', () => {
  it('shows the proxy’s sentence as it is, with the hosts it asked', () => {
    const detail = 'The file’s host (files.example.com) answered 403. It said: “IP address not allowed”'
    expect(httpFailureMessage({ status: 403, detail, hops: 'media.example.com 302, files.example.com 403' }, true)).toBe(
      'The file’s host (files.example.com) answered 403. It said: “IP address not allowed”. Hosts asked: media.example.com 302, files.example.com 403.',
    )
  })

  it('ends a sentence the proxy left open', () => {
    expect(httpFailureMessage({ status: 401, detail: 'The token is missing or wrong' }, true)).toBe('The token is missing or wrong.')
    expect(httpFailureMessage({ status: 401, detail: 'The token is missing or wrong.' }, true)).toBe('The token is missing or wrong.')
  })

  it('says what a proxy that sent JSON or nothing answered', () => {
    expect(httpFailureMessage({ status: 403, detail: '{"detail":"Invalid password"}' }, true)).toBe('The stream proxy answered 403: {"detail":"Invalid password"}.')
    expect(httpFailureMessage({ status: 502 }, true)).toBe('The stream proxy answered 502.')
    expect(httpFailureMessage({ status: 502, hops: 'files.example.com unreachable' }, true)).toBe('The stream proxy answered 502. Hosts asked: files.example.com unreachable.')
  })
})

describe('httpFailureMessage from the server itself', () => {
  it('keeps the advice for each status, with what the server said after it', () => {
    expect(httpFailureMessage({ status: 401 }, false)).toBe('The server refused the request. Check the sign-in for this source.')
    expect(httpFailureMessage({ status: 403, detail: 'Invalid token' }, false)).toBe('The server refused the request. Check the sign-in for this source. It said: “Invalid token”')
    expect(httpFailureMessage({ status: 404 }, false)).toBe('The server doesn’t have this file any more. Try another source.')
    expect(httpFailureMessage({ status: 503 }, false)).toBe('The server answered 503. Try again, or try another source.')
  })

  it('ignores a proxy’s hosts header', () => {
    expect(httpFailureMessage({ status: 500, hops: 'x.example.com 500' }, false)).not.toContain('x.example.com')
  })
})

describe('networkFailureMessage', () => {
  it('blames the proxy when it was the address that failed', () => {
    expect(networkFailureMessage(true, false)).toBe('The stream proxy didn’t answer. Check its address in Settings → Playback.')
  })

  it('points at ALLOWED_ORIGINS when the proxy is up but the browser wouldn’t let the page read it', () => {
    expect(networkFailureMessage(true, true, 'https://flow.example.com')).toContain('Add https://flow.example.com to ALLOWED_ORIGINS')
    expect(networkFailureMessage(true, true)).toContain('Add this page’s address to ALLOWED_ORIGINS')
  })

  it('keeps the connection advice for a direct request', () => {
    expect(networkFailureMessage(false, false)).toBe('Couldn’t reach the server. Check the connection and try again.')
  })
})
