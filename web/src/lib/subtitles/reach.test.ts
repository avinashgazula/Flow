import { describe, expect, it } from 'vitest'
import { planFetch } from '../livetv/plan'
import { planAttempts } from './reach'

const url = 'https://www.opensubtitles.com/download/abc/subfile/x.srt'
const proxy = 'https://proxy.example/?url={url}'
const via = `https://proxy.example/?url=${encodeURIComponent(url)}`

describe('reaching a subtitle file', () => {
  it('goes direct without a proxy', () => {
    expect(planAttempts(url, { proxy: '', blocked: true, mixed: false })).toEqual({ attempts: [{ url, viaProxy: false }] })
  })

  it('tries the host first and then the proxy, or goes straight to the proxy for a host known to be blocked', () => {
    expect(planAttempts(url, { proxy, blocked: false, mixed: false }).attempts).toEqual([{ url, viaProxy: false }, { url: via, viaProxy: true }])
    expect(planAttempts(url, { proxy, blocked: true, mixed: false }).attempts).toEqual([{ url: via, viaProxy: true }])
  })

  it('cannot call an http address from an https page, and says what to add', () => {
    expect(planAttempts(url.replace('https', 'http'), { proxy, blocked: false, mixed: true }).attempts).toEqual([{ url: proxy.replace('{url}', encodeURIComponent(url.replace('https', 'http'))), viaProxy: true }])
    expect(planAttempts('http://x.example/a.srt', { proxy: '', blocked: false, mixed: true })).toMatchObject({ attempts: [], problem: expect.stringContaining('stream proxy') })
  })

  it('makes the same plan as the Live TV code does', () => {
    for (const p of [proxy, '']) {
      for (const blocked of [false, true]) {
        expect(planAttempts(url, { proxy: p, blocked, mixed: false }).attempts).toEqual(planFetch(url, { proxy: p, blocked, pageProtocol: 'https:' }).attempts)
      }
    }
  })
})
