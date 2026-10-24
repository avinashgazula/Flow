import { describe, expect, it } from 'vitest'
import { streamCandidates, isRawTransportStream } from './streamUrl'
import type { IPTVProviderConfig } from './types'
import { shortEPGFrom, xtreamAPIURL, XtreamClient, xtreamStreamID, xtreamStreamURL } from './xtream'

const config: IPTVProviderConfig = { id: 'x1', name: 'X', kind: 'xtream', url: 'https://panel.example.com:8080/', username: 'me', password: 'p w#1/2', enabled: true, useForVOD: true }
const direct = (url: string) => ({ attempts: [{ url, viaProxy: false }] })

/** A fetch that answers each call from a table keyed by the action in its query. */
function panel(answers: Record<string, unknown>, seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    seen.push(url.toString())
    const key = url.searchParams.get('action') ?? 'account'
    if (!(key in answers)) return new Response('nope', { status: 404 })
    return new Response(JSON.stringify(answers[key]), { status: 200 })
  }) as typeof fetch
}

describe('Xtream addresses', () => {
  it('escapes the login in stream addresses', () => {
    // From FlowKit's testXtreamCredentialsAreEscapedInStreamAddresses.
    expect(xtreamStreamURL(config.url, 'live', 'me', 'p w#1/2', '42', 'm3u8')).toBe('https://panel.example.com:8080/live/me/p%20w%231%2F2/42.m3u8')
  })

  it('accepts a base with a trailing slash or the api file itself', () => {
    const live = (url: string) => xtreamStreamURL(url, 'live', 'u', 'p', '1', 'm3u8')
    expect(live('http://h.test:80/')).toBe('http://h.test:80/live/u/p/1.m3u8')
    expect(live('http://h.test/player_api.php')).toBe('http://h.test/live/u/p/1.m3u8')
  })

  it('builds player_api calls with the login and action', () => {
    const url = new URL(xtreamAPIURL(config, 'get_live_streams'))
    expect(url.origin + url.pathname).toBe('https://panel.example.com:8080/player_api.php')
    expect(Object.fromEntries(url.searchParams)).toEqual({ username: 'me', password: 'p w#1/2', action: 'get_live_streams' })
    expect(new URL(xtreamAPIURL(config)).searchParams.has('action')).toBe(false)
  })

  it('finds the guide at the panel unless one is set, and the stream id from a channel id', () => {
    const client = new XtreamClient(config, direct)
    expect(client.epgURL().startsWith('https://panel.example.com:8080/xmltv.php?username=me&password=')).toBe(true)
    expect(new XtreamClient({ ...config, epgURL: 'https://guide.example/x.xml' }, direct).epgURL()).toBe('https://guide.example/x.xml')
    expect(xtreamStreamID({ id: 'x1:42', providerID: 'x1' })).toBe('42')
    expect(xtreamStreamID({ id: 'other:42', providerID: 'x1' })).toBeUndefined()
  })
})

describe('Xtream channels', () => {
  const streams = [
    { num: 1, name: 'BBC One', stream_id: 101, stream_icon: 'https://logo/bbc1.png', epg_channel_id: 'bbc1.uk', category_id: '5', tv_archive: 1 },
    { num: 2, name: 'Mystery', stream_id: '102', stream_icon: '', epg_channel_id: '', category_id: '99', tv_archive: 0 },
    { stream_id: 103, category_id: 5 },
    { name: 'No id' },
  ]

  it('builds channels with their groups, logos, guide ids and HLS addresses', async () => {
    const client = new XtreamClient(config, direct, { fetchImpl: panel({ get_live_categories: [{ category_id: '5', category_name: 'UK' }], get_live_streams: streams }) })
    const channels = await client.channels()
    expect(channels).toHaveLength(3)
    expect(channels[0]).toMatchObject({
      id: 'x1:101',
      providerID: 'x1',
      name: 'BBC One',
      number: 1,
      group: 'UK',
      logoURL: 'https://logo/bbc1.png',
      epgID: 'bbc1.uk',
      hasCatchup: true,
      streamURL: 'https://panel.example.com:8080/live/me/p%20w%231%2F2/101.m3u8',
    })
    // An unknown category, an empty logo and an empty guide id fall back; a missing name gets a number.
    expect(channels[1]).toMatchObject({ group: 'Uncategorised', logoURL: undefined, epgID: undefined, hasCatchup: false })
    expect(channels[2]).toMatchObject({ name: 'Channel 103', group: 'UK' })
  })

  it('still lists channels when the categories fail', async () => {
    const client = new XtreamClient(config, direct, { fetchImpl: panel({ get_live_streams: streams }) })
    expect((await client.channels()).every((c) => c.group === 'Uncategorised')).toBe(true)
  })

  it('says so when the panel refuses the login', async () => {
    const refused = new XtreamClient(config, direct, { fetchImpl: panel({ account: { user_info: { auth: 0 } } }) })
    await expect(refused.accountInfo()).rejects.toThrow(/username and password/)
    const wrong = new XtreamClient(config, direct, { fetchImpl: panel({ get_live_streams: { user_info: { auth: 0 } } }) })
    await expect(wrong.channels()).rejects.toThrow(/username and password/)
  })

  it('reads the account', async () => {
    const client = new XtreamClient(config, direct, { fetchImpl: panel({ account: { user_info: { auth: 1, status: 'Active', exp_date: '1893456000', max_connections: '2', active_cons: 1 } } }) })
    expect(await client.accountInfo()).toEqual({ status: 'Active', expiresAt: 1893456000000, maxConnections: 2, activeConnections: 1 })
  })

  it('never puts the login in an error', async () => {
    const client = new XtreamClient(config, direct, { fetchImpl: panel({}) })
    const error = await client.channels().catch((e: Error) => e)
    expect((error as Error).message).toContain('panel.example.com:8080')
    expect((error as Error).message).not.toMatch(/password|p%20w|p w/)
  })
})

describe('short guide', () => {
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

  it('decodes base64 titles and descriptions into one channel’s programmes, in order', () => {
    const epg = shortEPGFrom(
      {
        epg_listings: [
          { title: b64('Later: Café'), description: b64('Second.'), start_timestamp: '1767276000', stop_timestamp: '1767279600' },
          { title: b64('First'), description: '', start_timestamp: 1767272400, stop_timestamp: 1767276000 },
          { title: b64('No times') },
        ],
      },
      'bbc1.uk',
    )
    expect(epg.programmes['bbc1.uk']!.map((p) => p.title)).toEqual(['First', 'Later: Café'])
    expect(epg.programmes['bbc1.uk']![1]).toMatchObject({ description: 'Second.', start: 1767276000000, end: 1767279600000, channelID: 'bbc1.uk' })
    expect(shortEPGFrom({ epg_listings: [] }, 'x').programmes).toEqual({})
    expect(shortEPGFrom('junk', 'x').programmes).toEqual({})
  })

  it('asks the panel for the stream', async () => {
    const seen: string[] = []
    const client = new XtreamClient(config, direct, { fetchImpl: panel({ get_short_epg: { epg_listings: [] } }, seen) })
    await client.shortEPG('101', 'bbc1.uk', 4)
    const url = new URL(seen[0]!)
    expect(url.searchParams.get('action')).toBe('get_short_epg')
    expect(url.searchParams.get('stream_id')).toBe('101')
    expect(url.searchParams.get('limit')).toBe('4')
  })
})

describe('stream address candidates', () => {
  // From FlowKit's LiveStreamURLTests.
  it('tries HLS first for raw transport streams, and adds .m3u8 to a bare panel id', () => {
    const ts = 'http://panel.test:8080/live/user/pass/1234.ts?token=x'
    expect(streamCandidates(ts)).toEqual(['http://panel.test:8080/live/user/pass/1234.m3u8?token=x', ts])
    const bare = 'http://panel.test:8080/user/pass/1234'
    expect(streamCandidates(bare)).toEqual([bare, bare + '.m3u8'])
    const hls = 'https://cdn.test/channel/index.m3u8'
    expect(streamCandidates(hls)).toEqual([hls])
    const page = 'https://cdn.test/watch'
    expect(streamCandidates(page)).toEqual([page])
    expect(streamCandidates('not a url')).toEqual(['not a url'])
  })

  it('knows a raw transport stream from HLS', () => {
    expect(isRawTransportStream('http://p.test/live/u/p/1.ts')).toBe(true)
    expect(isRawTransportStream('http://p.test/live/u/p/1.m3u8')).toBe(false)
  })
})
