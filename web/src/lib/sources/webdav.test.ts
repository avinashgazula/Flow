import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebDAVConfig } from '../store/settings'
import apacheMovies from './__fixtures__/webdav-apache-movies.xml?raw'
import nextcloudFolder from './__fixtures__/webdav-nextcloud-folder.xml?raw'
import { fixedCapabilities } from './capabilities'
import { normaliseShareURL, SourceError } from './http'
import type { PlaybackRequest } from './types'
import { authHeaders, corsMessage, findFiles, forgetListings, isVideo, matchesMovie, matchShowFolder, parseMultistatus, testShare, urlForHref, urlForPath, videos, webdavSources } from './webdav'

const share: WebDAVConfig = { id: 'dav1', name: 'My NAS', url: 'https://nas.example.com/dav', moviesPath: '/Movies', showsPath: '/TV Shows', enabled: true }
const caps = fixedCapabilities({})
const dune: PlaybackRequest = { type: 'movie', tmdbId: 693134, item: { type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, overview: '', genres: [] } }

/** Stands in for the share: each URL path answers a PROPFIND with an XML body (or a status). */
function dav(routes: Record<string, string | number>) {
  const calls: { url: URL; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      const answer = routes[decodeURIComponent(url.pathname).replace(/\/$/, '')] ?? routes[decodeURIComponent(url.pathname)]
      if (answer === undefined) return new Response('', { status: 404 })
      return typeof answer === 'number' ? new Response('', { status: answer }) : new Response(answer, { status: 207, headers: { 'Content-Type': 'application/xml' } })
    }),
  )
  return calls
}

beforeEach(() => forgetListings())
afterEach(() => vi.unstubAllGlobals())

describe('reading a PROPFIND answer', () => {
  it('reads Apache’s D: prefix: folders, sizes, decoded names, entities', () => {
    const entries = parseMultistatus(apacheMovies)
    expect(entries.map((e) => [e.name, e.isDirectory, e.size])).toEqual([
      ['Movies', true, undefined],
      ['Dune Part Two (2024)', true, undefined],
      ['Amélie.2001.1080p.BluRay.x264.mp4', false, 2147483648],
      ['notes & links.txt', false, 412],
    ])
    expect(entries[2]).toMatchObject({ href: '/dav/Movies/Am%C3%A9lie.2001.1080p.BluRay.x264.mp4', contentType: 'video/mp4' })
  })

  it('reads Nextcloud’s d: prefix, takes the real values past the 404 properties, and uses display names', () => {
    const entries = parseMultistatus(nextcloudFolder)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ name: 'Dune Part Two (2024)', isDirectory: true })
    expect(entries[0]!.size).toBeUndefined()
    expect(entries[1]).toMatchObject({ name: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.HEVC.mkv', size: 34567890123, contentType: 'video/x-matroska' })
  })

  it('reads an answer with no namespace prefix, entities and numeric references', () => {
    const xml = '<multistatus xmlns="DAV:"><response><href>/a/b%20c/</href><propstat><prop><displayname>Tom &amp; Jerry &#233;</displayname><resourcetype><collection/></resourcetype></prop></propstat></response></multistatus>'
    expect(parseMultistatus(xml)).toEqual([{ href: '/a/b%20c/', name: 'Tom & Jerry é', isDirectory: true }])
  })

  it('says nothing for an answer that is not a multistatus', () => {
    expect(parseMultistatus('<html><body>Login</body></html>')).toEqual([])
    expect(parseMultistatus('')).toEqual([])
  })

  it('counts only video files that are safe to offer', () => {
    const file = (name: string) => ({ href: `/${name}`, name, isDirectory: false })
    expect(['a.mkv', 'b.MP4', 'c.webm', 'd.m2ts'].every((n) => isVideo(file(n)))).toBe(true)
    expect(['a.txt', 'a.mkv.exe', 'poster.jpg', 'noextension'].some((n) => isVideo(file(n)))).toBe(false)
    expect(isVideo({ href: '/x.mkv/', name: 'x.mkv', isDirectory: true })).toBe(false)
  })
})

describe('addresses and logins', () => {
  it('accepts what people paste', () => {
    expect(normaliseShareURL('nas.example.com/dav/')).toBe('https://nas.example.com/dav')
    expect(normaliseShareURL(' https://user:secret@nas.example.com/webdav#x ')).toBe('https://nas.example.com/webdav')
    expect(normaliseShareURL('192.168.1.20:5005/dav')).toBe('http://192.168.1.20:5005/dav')
    expect(normaliseShareURL('nas.local')).toBe('http://nas.local')
    expect(() => normaliseShareURL('http://')).toThrow()
  })

  it('escapes a folder part by part, and resolves the host’s own hrefs', () => {
    expect(urlForPath(share, '/TV Shows')).toBe('https://nas.example.com/dav/TV%20Shows')
    expect(urlForPath(share, '/')).toBe('https://nas.example.com/dav')
    expect(urlForHref(share, '/dav/Movies/Am%C3%A9lie.mp4')).toBe('https://nas.example.com/dav/Movies/Am%C3%A9lie.mp4')
    expect(urlForHref(share, 'https://cdn.example.net/x.mkv')).toBe('https://cdn.example.net/x.mkv')
  })

  it('sends a login as Basic, in UTF-8, and nothing for a share with none', () => {
    expect(authHeaders({})).toEqual({})
    expect(authHeaders({ username: 'sam', password: 'pw' })).toEqual({ Authorization: `Basic ${btoa('sam:pw')}` })
    expect(authHeaders({ username: 'zoë', password: 'pässword' }).Authorization).toBe(`Basic ${Buffer.from('zoë:pässword', 'utf8').toString('base64')}`)
  })
})

describe('finding the title', () => {
  const file = (href: string) => ({ href, name: decodeURIComponent(href.split('/').pop()!) })

  it('matches a film by its file name or its folder, within a year', () => {
    expect(matchesMovie(file('/dav/Movies/Dune.Part.Two.2024.2160p.mkv'), 'Dune: Part Two', 2024)).toBe(true)
    expect(matchesMovie(file('/dav/Movies/Dune%20Part%20Two%20(2024)/movie.mkv'), 'Dune: Part Two', 2024)).toBe(true)
    expect(matchesMovie(file('/dav/Movies/Dune.Part.Two.2023.mkv'), 'Dune: Part Two', 2024)).toBe(true)
    expect(matchesMovie(file('/dav/Movies/Dune.Part.Two.2019.mkv'), 'Dune: Part Two', 2024)).toBe(false)
    expect(matchesMovie(file('/dav/Movies/Dune.Part.Two.mkv'), 'Dune: Part Two', 2024)).toBe(true)
    expect(matchesMovie(file('/dav/Movies/Dune.2021.mkv'), 'Dune: Part Two', 2024)).toBe(false)
    expect(matchesMovie(file('/dav/Movies/Am%C3%A9lie.2001.mp4'), 'Amélie', 2001)).toBe(true)
  })

  it('finds a show’s folder by name, or by its start', () => {
    const folders = [{ href: '/a/Severance%20(2022)/', name: 'Severance (2022)' }, { href: '/a/Dune%20Prophecy/', name: 'Dune Prophecy' }]
    expect(matchShowFolder(folders, 'Severance')?.name).toBe('Severance (2022)')
    expect(matchShowFolder(folders, 'Dune')?.name).toBe('Dune Prophecy')
    expect(matchShowFolder(folders, 'Fargo')).toBeUndefined()
  })

  it('lists the movies folder, goes into subfolders and offers only the matching video', async () => {
    const calls = dav({
      '/dav/Movies': apacheMovies,
      '/dav/Movies/Dune Part Two (2024)': nextcloudFolder.replaceAll('/remote.php/dav/files/sam/Movies', '/dav/Movies'),
    })
    const found = await findFiles(share, dune)
    expect(found.map((f) => f.name)).toEqual(['Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.HEVC.mkv'])
    expect(calls.every((c) => c.init.method === 'PROPFIND')).toBe(true)
    expect(new Headers(calls[0]!.init.headers).get('Depth')).toBe('1')
    expect(calls.map((c) => decodeURIComponent(c.url.pathname))).toEqual(['/dav/Movies', '/dav/Movies/Dune Part Two (2024)/'])
  })

  it('finds an episode by its code inside the show’s folder', async () => {
    const shows = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/TV%20Shows/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/TV%20Shows/Severance/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`
    const show = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/TV%20Shows/Severance/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/TV%20Shows/Severance/Severance.S01E01.1080p.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>10</d:getcontentlength></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/TV%20Shows/Severance/Severance.S01E02.1080p.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>20</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`
    dav({ '/dav/TV Shows': shows, '/dav/TV Shows/Severance': show })
    const request: PlaybackRequest = { type: 'show', tmdbId: 95396, season: 1, episode: 2, item: { type: 'show', id: 95396, title: 'Severance', overview: '', genres: [] } }
    expect((await findFiles(share, request)).map((f) => f.name)).toEqual(['Severance.S01E02.1080p.mkv'])
    expect(await findFiles(share, { ...request, episode: 9 })).toEqual([])
  })

  it('keeps going past a subfolder it can’t read, and remembers a listing for a few minutes', async () => {
    const calls = dav({ '/dav/Movies': apacheMovies, '/dav/Movies/Dune Part Two (2024)': 403 })
    const found = await videos(share, urlForPath(share, '/Movies'))
    expect(found.map((f) => f.name)).toEqual(['Amélie.2001.1080p.BluRay.x264.mp4'])
    const root = () => calls.filter((c) => c.url.pathname === '/dav/Movies').length
    await videos(share, urlForPath(share, '/Movies'))
    expect(root()).toBe(1)
  })
})

describe('offering a file as a source', () => {
  const nextcloud = nextcloudFolder.replaceAll('/remote.php/dav/files/sam/Movies', '/dav/Movies')

  it('builds a source: no login in the address, size from the share, Matroska through the remuxer', async () => {
    dav({ '/dav/Movies': apacheMovies, '/dav/Movies/Dune Part Two (2024)': nextcloud })
    const [source] = await webdavSources({ ...share, username: 'sam', password: 'pw' }, dune, caps)
    expect(source).toMatchObject({
      origin: 'webdav',
      provider: 'My NAS',
      providerId: 'dav1',
      title: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.HEVC.mkv',
      engine: 'remux',
      resolution: '2160p',
      sizeBytes: 34567890123,
      headers: { Authorization: `Basic ${btoa('sam:pw')}` },
    })
    expect(source!.url).toBe('https://nas.example.com/dav/Movies/Dune%20Part%20Two%20(2024)/Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.HEVC.mkv')
    expect(source!.url).not.toContain('sam')
    expect(source!.id).toContain('dav1#')
  })

  it('offers an MP4 on a password-protected share as one this browser can’t play, and says why', async () => {
    dav({ '/dav/Movies': apacheMovies.replace('Am%C3%A9lie.2001', 'Dune.Part.Two.2024'), '/dav/Movies/Dune Part Two (2024)': 404 })
    const [source] = await webdavSources({ ...share, username: 'sam', password: 'pw' }, dune, caps)
    expect(source).toMatchObject({ engine: 'native', unsupported: 'Needs request headers a browser can’t send' })
    // The same file on an open share plays directly.
    forgetListings()
    const [open] = await webdavSources(share, dune, caps)
    expect(open!.unsupported).toBeUndefined()
    expect(open!.headers).toBeUndefined()
  })
})

describe('errors that say what to do', () => {
  it('names the status: sign-in, permission, folder, not WebDAV', async () => {
    for (const [status, words] of [[401, 'username and password'], [403, 'permissions'], [404, 'find a share at that address'], [405, 'WebDAV server']] as const) {
      dav({ '/dav': status })
      await expect(testShare(share)).rejects.toThrow(new RegExp(words))
    }
  })

  it('tells a page the server refused (CORS) what to allow, and that a proxy can’t list folders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const error = await testShare(share).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SourceError)
    expect((error as Error).message).toBe(corsMessage('nas.example.com'))
    expect((error as Error).message).toMatch(/PROPFIND/)
    expect((error as Error).message).toMatch(/Authorization, Depth and Content-Type/)
    expect((error as Error).message).toMatch(/stream proxy/)
  })

  it('names the folder when a share has no Movies folder', async () => {
    dav({ '/dav/Movies': 404 })
    await expect(findFiles(share, dune)).rejects.toThrow('has no folder called /Movies')
  })

  it('counts what is at the root for Test Connection', async () => {
    dav({ '/dav': apacheMovies })
    expect(await testShare(share)).toBe(4)
  })
})
