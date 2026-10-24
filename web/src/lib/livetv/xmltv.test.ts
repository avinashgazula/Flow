import { describe, expect, it } from 'vitest'
import { mergeEPG, nowAndNext, progress, remainingText, schedule } from './epg'
import { parseXMLTV, parseXMLTVDate, readXMLTV, XMLTVReader, xmlText } from './xmltv'
import type { Programme } from './types'

const iso = (s: string) => Date.parse(s)

/* Ported from FlowKit's LiveTVParserTests and LiveTVEdgeCaseTests. */
describe('XMLTV dates', () => {
  it('reads every form a guide writes', () => {
    const utc = iso('2026-01-01T19:30:00Z')
    expect(parseXMLTVDate('20260101193000 +0000')).toBe(utc)
    expect(parseXMLTVDate('20260101203000 +0100')).toBe(utc)
    expect(parseXMLTVDate('20260101203000+0100'), 'The offset can follow without a space').toBe(utc)
    expect(parseXMLTVDate('20260101143000 -0500')).toBe(utc)
    expect(parseXMLTVDate('202601011930 +0000'), 'Seconds are optional').toBe(utc)
    expect(parseXMLTVDate('20260101193000'), 'No offset means UTC').toBe(utc)
    expect(parseXMLTVDate('2026')).toBeUndefined()
    expect(parseXMLTVDate('')).toBeUndefined()
  })
})

const guide = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="bbc1.uk"><display-name>BBC One</display-name><display-name>BBC 1</display-name></channel>
  <programme start="20260101120000 +0000" stop="20260101130000 +0000" channel="bbc1.uk">
    <title lang="en">News at Noon</title><desc>Headlines.</desc><category>News</category>
  </programme>
  <programme start="20260101140000 +0100" stop="20260101150000 +0100" channel="bbc1.uk">
    <title>Afternoon Film</title>
  </programme>
</tv>`

describe('XMLTV parsing and now and next', () => {
  it('finds the programme on now and the one after it', () => {
    const epg = parseXMLTV(guide)
    expect(epg.displayNames['bbc1.uk']).toBe('BBC One')
    expect(epg.programmes['bbc1.uk']).toHaveLength(2)
    const at = iso('2026-01-01T12:30:00Z')
    const { now, next } = nowAndNext(epg, 'bbc1.uk', at)
    expect(now?.title).toBe('News at Noon')
    expect(now?.description).toBe('Headlines.')
    expect(now?.category).toBe('News')
    expect(next?.title).toBe('Afternoon Film')
    expect(next?.start).toBe(iso('2026-01-01T13:00:00Z'))
    expect(progress(now!, at)).toBeCloseTo(0.5, 3)
  })

  it('has a next programme but no current one in a gap, and nothing past the last', () => {
    const epg = parseXMLTV(guide)
    // The film is on from 13:00 to 14:00 (UTC); a gap opens before a programme that has not started.
    expect(nowAndNext(epg, 'bbc1.uk', iso('2026-01-01T11:30:00Z'))).toMatchObject({ now: undefined, next: { title: 'News at Noon' } })
    expect(nowAndNext(epg, 'bbc1.uk', iso('2026-01-01T14:00:00Z'))).toEqual({})
    expect(nowAndNext(epg, 'nope', iso('2026-01-01T12:30:00Z'))).toEqual({})
  })

  it('reads the same document however it is cut into pieces', () => {
    const whole = parseXMLTV(guide)
    for (const size of [1, 2, 5, 13, 40, 97]) {
      const reader = new XMLTVReader()
      for (let i = 0; i < guide.length; i += size) reader.push(guide.slice(i, i + size))
      expect(reader.finish(), `pieces of ${size}`).toEqual(whole)
    }
  })

  it('decodes entities, character references and CDATA', () => {
    expect(xmlText('Tom &amp; Jerry &#8217;s &#x41; &bogus;')).toBe('Tom & Jerry ’s A &bogus;')
    expect(xmlText('<![CDATA[Fish & <Chips>]]> &amp; more')).toBe('Fish & <Chips> & more')
    const epg = parseXMLTV(
      `<tv><programme start="20260101120000 +0000" stop="20260101130000 +0000" channel="a&amp;b"><title>Q&amp;A</title><sub-title>Part 1</sub-title><icon src="https://img.example/a.png?x=1&amp;y=2"/></programme></tv>`,
    )
    const p = epg.programmes['a&b']![0]!
    expect(p.title).toBe('Q&A')
    expect(p.subtitle).toBe('Part 1')
    expect(p.iconURL).toBe('https://img.example/a.png?x=1&y=2')
  })

  it('keeps only programmes inside the window and sorts what it keeps', () => {
    const programme = (hour: number) => `<programme start="2026010${1}${String(hour).padStart(2, '0')}0000 +0000" stop="2026010${1}${String(hour + 1).padStart(2, '0')}0000 +0000" channel="a"><title>H${hour}</title></programme>`
    const xml = `<tv>${[9, 3, 6, 20, 12].map(programme).join('')}</tv>`
    const window = { from: iso('2026-01-01T05:30:00Z'), to: iso('2026-01-01T12:00:00Z') }
    // The 05:00 to 06:00 programme is still airing at the start of the window; 12:00 starts at its end.
    expect(parseXMLTV(xml, window).programmes['a']!.map((p) => p.title)).toEqual(['H6', 'H9', 'H12'])
  })

  it('keeps only the channels it is asked for, however the guide spells their ids', () => {
    const programme = (id: string) => `<programme start="20260101120000" stop="20260101130000" channel="${id}"><title>${id}</title></programme>`
    const epg = parseXMLTV(`<tv>${['BBC1.uk', 'itv.uk', 'other.tv'].map(programme).join('')}</tv>`, { channels: new Set(['bbc1.uk', 'itv.uk']) })
    expect(Object.keys(epg.programmes).sort()).toEqual(['BBC1.uk', 'itv.uk'])
    // The playlist says "bbc1.uk", the guide "BBC1.uk": still the same channel.
    expect(nowAndNext(epg, 'bbc1.uk', iso('2026-01-01T12:30:00Z')).now?.title).toBe('BBC1.uk')
    expect(nowAndNext(epg, 'ITV.UK', iso('2026-01-01T12:30:00Z')).now?.title).toBe('itv.uk')
  })

  it('skips programmes without a channel or a readable time, and names an untitled one', () => {
    const epg = parseXMLTV(
      `<tv><programme start="bad" stop="20260101130000" channel="a"><title>X</title></programme><programme start="20260101120000" stop="20260101130000"><title>Y</title></programme><programme start="20260101120000" stop="20260101130000" channel="a"></programme></tv>`,
    )
    expect(epg.programmes['a']!.map((p) => p.title)).toEqual(['Untitled'])
  })

  it('reads a gzip guide as a stream, in small pieces', async () => {
    const xml = new TextEncoder().encode(guide)
    const packed = new Blob([xml]).stream().pipeThrough(new CompressionStream('gzip'))
    const bytes = new Uint8Array(await new Response(packed).arrayBuffer())
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b])
    // Handed over 7 bytes at a time, as a slow connection would.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        controller.close()
      },
    })
    expect(await readXMLTV(body)).toEqual(parseXMLTV(guide))
  })

  it('reads a plain guide as a stream and honours a declared encoding', async () => {
    const latin1 = Uint8Array.from('<?xml version="1.0" encoding="ISO-8859-1"?><tv><programme start="20260101120000" stop="20260101130000" channel="a"><title>Café</title></programme></tv>', (c) => c.charCodeAt(0))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(latin1)
        controller.close()
      },
    })
    expect((await readXMLTV(body)).programmes['a']![0]!.title).toBe('Café')
  })
})

describe('guide lookups', () => {
  const t0 = iso('2026-01-01T12:00:00Z')
  const hour = 3_600_000
  const programme = (title: string, at: number): Programme => ({ channelID: 'a', title, start: t0 + at * hour, end: t0 + (at + 1) * hour })

  it('merges two guides, dropping a programme that starts at the same time', () => {
    const merged = mergeEPG({ programmes: { a: [programme('One', 0), programme('Two', 1)] }, displayNames: { a: 'First' } }, { programmes: { a: [programme('One', 0), programme('Three', 2)] }, displayNames: { a: 'Second', b: 'B' } })
    expect(merged.programmes['a']!.map((p) => p.title)).toEqual(['One', 'Two', 'Three'])
    expect(merged.displayNames).toEqual({ a: 'First', b: 'B' })
  })

  it('cuts a schedule at the window, and finds a lowercased guide id', () => {
    const epg = { programmes: { 'bbc1.uk': [programme('One', 0), programme('Two', 1), programme('Three', 2)] }, displayNames: {} }
    expect(schedule(epg, 'bbc1.uk', t0 + hour / 2, 1.5).map((p) => p.title)).toEqual(['One', 'Two'])
    expect(schedule(epg, 'zzz', t0, 1)).toHaveLength(0)
    expect(schedule(epg, 'BBC1.uk', t0, 1)).toHaveLength(1)
    expect(nowAndNext(epg, 'BBC1.uk', t0 + 60_000).now?.title).toBe('One')
  })

  it('says how long is left', () => {
    expect(remainingText(5 * 60_000)).toBe('5 min left')
    expect(remainingText(61 * 60_000)).toBe('1 h 1 min left')
    expect(remainingText(2 * hour)).toBe('2 h left')
    expect(remainingText(0)).toBe('1 min left')
  })
})
