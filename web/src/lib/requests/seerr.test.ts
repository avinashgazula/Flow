import { describe, expect, it } from 'vitest'
import { canRequest, connect, demoHost, latestSeason, mediaStatus, normaliseURL, request, requestBody, SeerrError, statusFrom, statusWords } from './seerr'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const config = { url: 'https://seerr.example.com', key: ' secret ' }

interface Call {
  url: string
  method?: string
  headers: Record<string, string>
  body?: unknown
}
/** A fetch that records what it was asked and answers from `answer`. */
function recorder(answer: (call: Call) => Response) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    return answer(call)
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('the address', () => {
  it('becomes the API root, whatever was pasted', () => {
    for (const input of ['https://seerr.example.com', 'seerr.example.com', ' https://seerr.example.com/ ', 'https://seerr.example.com/api/v1', 'https://seerr.example.com/api/v1/', 'https://seerr.example.com/?x=1#top']) {
      expect(normaliseURL(input)).toEqual({ ok: true, url: 'https://seerr.example.com' })
    }
    expect(normaliseURL('http://192.168.1.5:5055/')).toEqual({ ok: true, url: 'http://192.168.1.5:5055' })
  })

  it('keeps a sub-path, for an instance behind a reverse proxy folder', () => {
    expect(normaliseURL('https://home.example.com/seerr/')).toEqual({ ok: true, url: 'https://home.example.com/seerr' })
  })

  it('says what is wrong with one it can’t use', () => {
    expect(normaliseURL('  ')).toMatchObject({ ok: false, error: expect.stringContaining('Paste') })
    expect(normaliseURL('ftp://x.example.com')).toMatchObject({ ok: false, error: expect.stringContaining('https://') })
    expect(normaliseURL('http://')).toMatchObject({ ok: false })
  })
})

describe('where a title stands', () => {
  it('collapses Seerr’s media status', () => {
    expect([undefined, 1, 2, 3, 4, 5].map((c) => statusFrom(c, []))).toEqual(['notRequested', 'notRequested', 'pending', 'processing', 'partiallyAvailable', 'available'])
  })

  it('reads a request that exists before the media row catches up, and ignores declined ones', () => {
    expect(statusFrom(undefined, [1])).toBe('pending')
    expect(statusFrom(1, [2])).toBe('processing')
    expect(statusFrom(undefined, [3])).toBe('notRequested')
    expect(statusFrom(5, [1])).toBe('available')
  })

  it('can be requested only while a request would change something', () => {
    expect((['notRequested', 'pending', 'processing', 'partiallyAvailable', 'available'] as const).filter(canRequest)).toEqual(['notRequested', 'partiallyAvailable'])
  })

  it('is said in the apps’ words', () => {
    expect(statusWords).toEqual({ notRequested: 'Request', partiallyAvailable: 'Request', pending: 'Requested', processing: 'Processing', available: 'Available' })
  })
})

describe('the request', () => {
  it('names the media and, for a series, the seasons', () => {
    expect(requestBody('movie', 693134)).toEqual({ mediaType: 'movie', mediaId: 693134 })
    // A film ignores seasons.
    expect(requestBody('movie', 1, [2])).toEqual({ mediaType: 'movie', mediaId: 1 })
    expect(requestBody('show', 1396)).toEqual({ mediaType: 'tv', mediaId: 1396, seasons: 'all' })
    expect(requestBody('show', 1396, [5])).toEqual({ mediaType: 'tv', mediaId: 1396, seasons: [5] })
  })

  it('offers the latest season only when there is more than one, specials aside', () => {
    expect(latestSeason([{ number: 0 }, { number: 1 }])).toBeUndefined()
    expect(latestSeason([{ number: 0 }, { number: 1 }, { number: 2 }, { number: 3 }])).toBe(3)
    expect(latestSeason([])).toBeUndefined()
  })

  it('is posted with the key, as JSON', async () => {
    const { calls, fetchImpl } = recorder(() => json({ id: 1 }, 201))
    await request(config, 'show', 1396, [5], { fetchImpl })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: 'https://seerr.example.com/api/v1/request', method: 'POST', body: { mediaType: 'tv', mediaId: 1396, seasons: [5] } })
    expect(calls[0]!.headers).toMatchObject({ 'X-Api-Key': 'secret', 'Content-Type': 'application/json' })
  })

  it('reports what Seerr said when it refuses', async () => {
    const { fetchImpl } = recorder(() => json({ message: 'Request for this media already exists.' }, 409))
    await expect(request(config, 'movie', 1, 'all', { fetchImpl })).rejects.toThrow('Seerr said: Request for this media already exists.')
  })
})

describe('asking about a title', () => {
  it('reads the status from the media info and its requests', async () => {
    const { calls, fetchImpl } = recorder(() => json({ mediaInfo: { status: 1, requests: [{ status: 1 }, { status: 3 }] } }))
    expect(await mediaStatus(config, 'movie', 693134, { fetchImpl })).toBe('pending')
    expect(calls[0]!.url).toBe('https://seerr.example.com/api/v1/movie/693134')
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.headers['X-Api-Key']).toBe('secret')
    expect(await mediaStatus(config, 'show', 1396, { fetchImpl: recorder(() => json({ mediaInfo: { status: 5 } })).fetchImpl })).toBe('available')
    expect(await mediaStatus(config, 'show', 1396, { fetchImpl: recorder(() => json({})).fetchImpl })).toBe('notRequested')
  })

  it('asks for a series as tv', async () => {
    const { calls, fetchImpl } = recorder(() => json({}))
    await mediaStatus(config, 'show', 1396, { fetchImpl })
    expect(calls[0]!.url).toBe('https://seerr.example.com/api/v1/tv/1396')
  })

  it('reads a title Seerr doesn’t know as one to request', async () => {
    expect(await mediaStatus(config, 'movie', 1, { fetchImpl: recorder(() => json({ message: 'Movie not found' }, 404)).fetchImpl })).toBe('notRequested')
  })
})

describe('connecting', () => {
  it('proves the address is Seerr and the key is one it accepts, and returns the version', async () => {
    const { calls, fetchImpl } = recorder((c) => (c.url.endsWith('/status') ? json({ version: '2.5.2' }) : json({ id: 1 })))
    expect(await connect(config, { fetchImpl })).toBe('2.5.2')
    expect(calls.map((c) => c.url)).toEqual(['https://seerr.example.com/api/v1/status', 'https://seerr.example.com/api/v1/auth/me'])
  })

  it('catches a wrong key even though status answers without one', async () => {
    const { fetchImpl } = recorder((c) => (c.url.endsWith('/status') ? json({ version: '2' }) : json({}, 403)))
    await expect(connect(config, { fetchImpl })).rejects.toMatchObject({ kind: 'key', message: expect.stringContaining('rejected that API key') })
  })

  it('says it isn’t Seerr when the address answers 404', async () => {
    await expect(connect(config, { fetchImpl: recorder(() => new Response('<html>', { status: 404 })).fetchImpl })).rejects.toMatchObject({ kind: 'missing', message: expect.stringContaining('isn’t a Seerr instance') })
  })

  it('explains CORS when the page can’t read the instance, naming the host and never the key', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const error = await connect(config, { fetchImpl }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SeerrError)
    expect((error as SeerrError).kind).toBe('network')
    expect((error as SeerrError).message).toContain('seerr.example.com')
    expect((error as SeerrError).message).toContain('CORS')
    expect((error as SeerrError).message).not.toContain('secret')
  })

  it('refuses a bad address before sending anything', async () => {
    const { calls, fetchImpl } = recorder(() => json({}))
    await expect(connect({ url: 'nope://x', key: 'k' }, { fetchImpl })).rejects.toMatchObject({ kind: 'address' })
    expect(calls).toHaveLength(0)
  })
})

describe('the sample instance', () => {
  const demo = { url: `https://${demoHost}`, key: 'any' }
  const never = (() => {
    throw new Error('the sample instance must not go to the network')
  }) as unknown as typeof fetch

  it('connects and answers by title without a network', async () => {
    expect(await connect(demo, { fetchImpl: never })).toBe('demo')
    // Ids by remainder: 0 available, 1 nothing, 2 requested, 3 processing, 4 nothing.
    const statuses = await Promise.all([10, 11, 12, 13, 14].map((id) => mediaStatus(demo, 'movie', id, { fetchImpl: never })))
    expect(statuses).toEqual(['available', 'notRequested', 'pending', 'processing', 'notRequested'])
  })

  it('remembers a request for the session', async () => {
    expect(await mediaStatus(demo, 'show', 1396, { fetchImpl: never })).toBe('notRequested')
    await request(demo, 'show', 1396, 'all', { fetchImpl: never })
    expect(await mediaStatus(demo, 'show', 1396, { fetchImpl: never })).toBe('pending')
  })
})
