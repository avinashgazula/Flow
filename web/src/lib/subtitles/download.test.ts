import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import opensubtitlesDownload from './__fixtures__/opensubtitles-download.json'
import { decodeSubtitleBytes, subtitleFormat } from './decode'
import { downloadSubtitle, type Plan } from './download'
import { unpackSubtitle, zipEntries } from './zip'
import type { SubtitleResult } from './types'
import { planAttempts } from './reach'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))
const encode = (s: string) => new TextEncoder().encode(s)
const decode = (b: Uint8Array) => new TextDecoder().decode(b)

describe('zip', () => {
  it('lists a season pack’s files, with the folder left out', () => {
    expect(zipEntries(fixture('season-pack.zip')).map((e) => [e.name, e.method])).toEqual([
      ['README.txt', 0],
      ['Show.Name.S01E01.1080p.srt', 8],
      ['Show.Name.S01E02.1080p.srt', 8],
    ])
  })

  it('takes the first subtitle file, not the readme', async () => {
    const { bytes, name } = await unpackSubtitle(fixture('season-pack.zip'))
    expect(name).toBe('Show.Name.S01E01.1080p.srt')
    expect(decode(bytes)).toContain('Episode 1 first line')
  })

  it('takes the episode asked for out of a season pack', async () => {
    const { bytes, name } = await unpackSubtitle(fixture('season-pack.zip'), (file) => /s01e02/i.test(file))
    expect(name).toBe('Show.Name.S01E02.1080p.srt')
    expect(decode(bytes)).toContain('Episode 2 second line')
  })

  it('reads a stored entry', async () => {
    const { bytes } = await unpackSubtitle(fixture('single-stored.zip'))
    // Windows-1252, not UTF-8: the é is one byte.
    expect(decodeSubtitleBytes(bytes)).toContain('Café crème')
  })

  it('unpacks a gzip file, and leaves plain text alone', async () => {
    expect(decode((await unpackSubtitle(fixture('movie.srt.gz'))).bytes)).toContain('Episode 1 first line')
    const plain = encode('1\n00:00:01,000 --> 00:00:02,000\nHi\n')
    expect((await unpackSubtitle(plain)).bytes).toBe(plain)
  })

  it('says so when a zip can’t be read', async () => {
    const broken = fixture('season-pack.zip').slice(0, 300)
    await expect(unpackSubtitle(broken)).rejects.toThrow(/zip file/)
  })

  it('refuses a file that unpacks to something far bigger than a subtitle', async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(9 * 1024 * 1024, 65)))
    await expect(unpackSubtitle(bomb)).rejects.toThrow(/bigger than a subtitle/)
  })
})

describe('reading the text', () => {
  it('knows UTF-8 with and without a mark, UTF-16 and Windows-1252', () => {
    expect(decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...encode('Zoë')]))).toBe('Zoë')
    expect(decodeSubtitleBytes(encode('Zoë'))).toBe('Zoë')
    expect(decodeSubtitleBytes(new Uint8Array([0xff, 0xfe, 0x5a, 0x00, 0xeb, 0x00]))).toBe('Zë')
    expect(decodeSubtitleBytes(new Uint8Array([0x5a, 0xeb]))).toBe('Zë')
  })

  it('tells ASS from SRT and WebVTT', () => {
    expect(subtitleFormat('[Script Info]\nTitle: x\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi')).toBe('ass')
    expect(subtitleFormat('[V4 Styles]\nFormat: Name')).toBe('ass')
    expect(subtitleFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toBe('vtt')
    expect(subtitleFormat('1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt')
  })
})

describe('downloading a result', () => {
  const found: SubtitleResult = { id: 'subdl-/subtitle/1-1.zip', provider: 'subdl', language: 'en', languageName: 'English', release: '', hearingImpaired: false, token: '/subtitle/1-1.zip' }
  const reply = (bytes: Uint8Array, status = 200) => new Response(bytes as BodyInit, { status })
  const plan = (proxy = '', blocked = false) => (url: string): Plan => planAttempts(url, { proxy, blocked, mixed: false })

  it('fetches the zip from dl.subdl.com, unpacks it and reads the text', async () => {
    const urls: string[] = []
    const fetch = async (url: string) => (urls.push(url), reply(fixture('season-pack.zip')))
    const got = await downloadSubtitle(found, { subdlKey: 'k' }, { fetch, plan: plan() })
    expect(urls).toEqual(['https://dl.subdl.com/subtitle/1-1.zip'])
    expect(got).toMatchObject({ format: 'srt', fileName: 'Show.Name.S01E01.1080p.srt' })
    expect(got.text).toContain('Episode 1 first line')
  })

  it('picks the right episode out of a season pack', async () => {
    const got = await downloadSubtitle(found, {}, { fetch: async () => reply(fixture('season-pack.zip')), plan: plan(), episode: { season: 1, episode: 2 } })
    expect(got.fileName).toBe('Show.Name.S01E02.1080p.srt')
  })

  it('goes straight to the proxy for a host known to be blocked, and says nothing about it when it works', async () => {
    const urls: string[] = []
    const fetch = async (url: string) => (urls.push(url), reply(encode('1\n00:00:01,000 --> 00:00:02,000\nHi\n')))
    await downloadSubtitle(found, {}, { fetch, plan: plan('https://proxy.example/?url={url}', true) })
    expect(urls).toEqual([`https://proxy.example/?url=${encodeURIComponent('https://dl.subdl.com/subtitle/1-1.zip')}`])
  })

  it('tries the host first, then the proxy, and reports what it learned', async () => {
    const urls: string[] = []
    const learned: unknown[] = []
    const fetch = async (url: string) => {
      urls.push(url)
      if (!url.startsWith('https://proxy.example')) throw new TypeError('Failed to fetch')
      return reply(encode('1\n00:00:01,000 --> 00:00:02,000\nHi\n'))
    }
    await downloadSubtitle(found, {}, { fetch, plan: plan('https://proxy.example/?url={url}'), learn: (url, r) => learned.push([url, r]) })
    expect(urls).toHaveLength(2)
    expect(learned).toEqual([['https://dl.subdl.com/subtitle/1-1.zip', { viaProxy: true, directBlocked: true }]])
  })

  it('asks OpenSubtitles for the link first, then reads it through the proxy because that host sends no CORS headers', async () => {
    const os: SubtitleResult = { ...found, id: 'os-8847112', provider: 'opensubtitles', token: '8847112' }
    const urls: string[] = []
    const fetch = async (url: string) => {
      urls.push(url)
      if (url === 'https://api.opensubtitles.com/api/v1/download') return new Response(JSON.stringify(opensubtitlesDownload))
      if (url.startsWith('https://www.opensubtitles.com/')) throw new TypeError('Failed to fetch')
      return reply(encode('1\n00:00:01,000 --> 00:00:02,000\nHi\n'))
    }
    const got = await downloadSubtitle(os, { openSubtitlesKey: 'k' }, { fetch, plan: plan('https://proxy.example/?url={url}') })
    expect(got.text).toContain('Hi')
    expect(urls[0]).toBe('https://api.opensubtitles.com/api/v1/download')
    expect(urls[1]).toMatch(/^https:\/\/www\.opensubtitles\.com\/download\//)
    expect(urls[2]).toMatch(/^https:\/\/proxy\.example\/\?url=https%3A%2F%2Fwww\.opensubtitles\.com/)
  })

  it('names the host and the fix when there is no proxy', async () => {
    const down = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(downloadSubtitle(found, {}, { fetch: down, plan: plan() })).rejects.toMatchObject({
      kind: 'blocked',
      message: expect.stringMatching(/dl\.subdl\.com doesn’t let web pages download its files\. Add a stream proxy in Settings → Playback with dl\.subdl\.com in its allowed hosts/),
    })
  })

  it('names the proxy’s own refusal', async () => {
    const refused = async (url: string) => (url.startsWith('https://proxy.example') ? new Response('Host dl.subdl.com is not allowed', { status: 403 }) : Promise.reject(new TypeError('Failed to fetch')))
    await expect(downloadSubtitle(found, {}, { fetch: refused, plan: plan('https://proxy.example/?url={url}') })).rejects.toThrow(/Your stream proxy couldn’t open the subtitle at dl\.subdl\.com \(it answered 403\)\. It said: “Host dl\.subdl\.com is not allowed” Add the host to your proxy’s ALLOWED_HOSTS/)
  })

  it('does not send a key through a proxy that would drop it', async () => {
    const sub: SubtitleResult = { ...found, id: 'subsource-1', provider: 'subsource', token: 'ss_1' }
    const urls: string[] = []
    const down = async (url: string) => (urls.push(url), Promise.reject(new TypeError('Failed to fetch')))
    await expect(downloadSubtitle(sub, { subSourceKey: 'k' }, { fetch: down, plan: plan('https://proxy.example/?url={url}') })).rejects.toThrow(/can’t pass on the key/)
    expect(urls).toEqual(['https://api.subsource.net/api/v1/subtitles/ss_1/download'])
  })

  it('says when the host answers with an error, or the file is empty', async () => {
    await expect(downloadSubtitle(found, {}, { fetch: async () => reply(encode(''), 404), plan: plan() })).rejects.toThrow(/dl\.subdl\.com answered 404/)
    await expect(downloadSubtitle(found, {}, { fetch: async () => reply(encode('  \n')), plan: plan() })).rejects.toThrow(/empty/)
  })
})
