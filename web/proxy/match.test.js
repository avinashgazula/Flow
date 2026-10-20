import { describe, expect, it } from 'vitest'
import { cleanSnippet, corsHeaders, downstreamHeaders, hopsSummary, hostMatches, originAllowed, parseList, parseTarget, rangeFromStart, snippetWanted, targetAllowed, tokenMatches, upstreamHeaders } from './match.js'

describe('parseList', () => {
  it('splits, trims and lower-cases', () => {
    expect(parseList(' A.example.com, *.B.example.com ,, ')).toEqual(['a.example.com', '*.b.example.com'])
    expect(parseList(undefined)).toEqual([])
    expect(parseList('')).toEqual([])
  })
})

describe('hostMatches', () => {
  it('matches a host exactly', () => {
    expect(hostMatches('files.example.com', ['files.example.com'])).toBe(true)
    expect(hostMatches('FILES.example.com.', ['files.example.com'])).toBe(true)
    expect(hostMatches('other.example.com', ['files.example.com'])).toBe(false)
  })

  it('lets a wildcard cover subdomains at any depth, but not the bare domain or a lookalike', () => {
    const list = ['*.real-debrid.com']
    expect(hostMatches('cdn.real-debrid.com', list)).toBe(true)
    expect(hostMatches('a.b.download.real-debrid.com', list)).toBe(true)
    expect(hostMatches('real-debrid.com', list)).toBe(false)
    expect(hostMatches('evilreal-debrid.com', list)).toBe(false)
    expect(hostMatches('real-debrid.com.evil.example', list)).toBe(false)
  })

  it('never treats a lone star or an empty host as a match', () => {
    expect(hostMatches('anything.example', ['*'])).toBe(false)
    expect(hostMatches('anything.example', ['*.'])).toBe(false)
    expect(hostMatches('', ['*.example.com'])).toBe(false)
    expect(hostMatches('example.com', [])).toBe(false)
  })
})

describe('parseTarget', () => {
  it('takes plain https addresses', () => {
    expect(parseTarget('https://cdn.example.com/a/b.mkv?x=1')?.hostname).toBe('cdn.example.com')
    expect(parseTarget('https://cdn.example.com:443/a')?.hostname).toBe('cdn.example.com')
  })

  it('refuses anything else', () => {
    for (const bad of [undefined, '', 'not a url', 'http://cdn.example.com/a', 'ftp://cdn.example.com/a', 'file:///etc/passwd', 'https://user:pw@cdn.example.com/a', 'https://cdn.example.com:8443/a']) {
      expect(parseTarget(bad)).toBeNull()
    }
  })
})

describe('targetAllowed', () => {
  const hosts = { allowedHosts: ['play.example.com'], redirectHosts: ['*.cdn.example.net'] }
  it('needs the first host in ALLOWED_HOSTS', () => {
    expect(targetAllowed(new URL('https://play.example.com/x'), hosts)).toBe(true)
    expect(targetAllowed(new URL('https://a.cdn.example.net/x'), hosts)).toBe(false)
  })

  it('accepts a redirect to ALLOWED_HOSTS or ALLOWED_REDIRECT_HOSTS', () => {
    expect(targetAllowed(new URL('https://a.cdn.example.net/x'), hosts, true)).toBe(true)
    expect(targetAllowed(new URL('https://play.example.com/x'), hosts, true)).toBe(true)
    expect(targetAllowed(new URL('https://elsewhere.example.org/x'), hosts, true)).toBe(false)
  })
})

describe('CORS headers', () => {
  const allowed = parseList('https://flow.example.com, http://localhost:5173')

  it('are added only for a listed origin', () => {
    const h = corsHeaders('https://flow.example.com', allowed)
    expect(h['Access-Control-Allow-Origin']).toBe('https://flow.example.com')
    expect(h['Access-Control-Allow-Headers']).toBe('Range')
    expect(h['Access-Control-Expose-Headers']).toBe('Content-Range, Content-Length, Accept-Ranges, Content-Type, X-Flow-Proxy-Hops, X-Flow-Proxy-Direct')
    expect(h.Vary).toBe('Origin')
    expect(corsHeaders('http://localhost:5173/', allowed)['Access-Control-Allow-Origin']).toBe('http://localhost:5173')
  })

  it('leave an unlisted or missing origin with Vary alone', () => {
    expect(corsHeaders('https://evil.example.org', allowed)).toEqual({ Vary: 'Origin' })
    expect(corsHeaders(null, allowed)).toEqual({ Vary: 'Origin' })
    expect(corsHeaders('https://flow.example.com', [])).toEqual({ Vary: 'Origin' })
    expect(originAllowed('https://flow.example.com.evil.example', allowed)).toBe(false)
  })
})

describe('upstreamHeaders', () => {
  it('sends the Range and a plain User-Agent, and nothing else of the page’s', () => {
    const sent = new Headers({ Range: 'bytes=100-199', Cookie: 'a=b', Authorization: 'Bearer x', Origin: 'https://flow.example.com', Referer: 'https://flow.example.com/', 'X-Api-Key': 'k' })
    const h = upstreamHeaders(sent)
    expect(h.Range).toBe('bytes=100-199')
    expect(Object.keys(h).sort()).toEqual(['Accept-Encoding', 'Range', 'User-Agent'])
    expect(h['User-Agent']).toMatch(/^Mozilla/)
  })

  it('drops a Range that isn’t bytes', () => {
    expect(upstreamHeaders(new Headers({ Range: 'items=1-2' })).Range).toBeUndefined()
    expect(upstreamHeaders(new Headers()).Range).toBeUndefined()
    expect(upstreamHeaders(new Headers({ Range: 'bytes=0-' })).Range).toBe('bytes=0-')
  })
})

describe('downstreamHeaders', () => {
  it('keeps the headers a player needs and leaves cookies and the rest', () => {
    const up = new Headers({ 'Content-Range': 'bytes 0-9/100', 'Content-Length': '10', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/x-matroska', 'Set-Cookie': 'a=b', 'Content-Disposition': 'attachment', Server: 'x' })
    const h = downstreamHeaders(up)
    expect(h).toMatchObject({ 'Content-Range': 'bytes 0-9/100', 'Content-Length': '10', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/x-matroska' })
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('set-cookie')
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('content-disposition')
  })
})

describe('tokenMatches', () => {
  it('passes everything when no secret is set', () => {
    expect(tokenMatches(null, undefined)).toBe(true)
    expect(tokenMatches('anything', '')).toBe(true)
  })

  it('needs the exact secret otherwise', () => {
    expect(tokenMatches('s3cret', 's3cret')).toBe(true)
    expect(tokenMatches('s3cre', 's3cret')).toBe(false)
    expect(tokenMatches('s3cret!', 's3cret')).toBe(false)
    expect(tokenMatches(null, 's3cret')).toBe(false)
    expect(tokenMatches('', 's3cret')).toBe(false)
  })
})

describe('hopsSummary', () => {
  it('lists each host with the status it gave, and nothing else', () => {
    expect(hopsSummary([{ host: 'media.example.com', status: 302 }, { host: 'files.example.com', status: 403 }])).toBe('media.example.com 302, files.example.com 403')
    expect(hopsSummary([{ host: 'files.example.com', status: 'unreachable' }])).toBe('files.example.com unreachable')
    expect(hopsSummary([])).toBe('')
  })
})

describe('snippetWanted', () => {
  it('takes plain text and JSON, and skips HTML and files', () => {
    for (const type of ['text/plain', 'text/plain; charset=utf-8', 'application/json', 'application/problem+json; charset=utf-8']) expect(snippetWanted(type)).toBe(true)
    for (const type of ['text/html', 'video/x-matroska', 'application/octet-stream', '', null, undefined]) expect(snippetWanted(type)).toBe(false)
  })
})

describe('cleanSnippet', () => {
  it('collapses whitespace and strips markup', () => {
    expect(cleanSnippet('  IP\n\taddress   not   allowed \r\n')).toBe('IP address not allowed')
    expect(cleanSnippet('<h1>Forbidden</h1><script>alert(1)</script><p>IP   banned</p>')).toBe('Forbidden IP banned')
    expect(cleanSnippet('a\u0000b\u0007c')).toBe('a b c')
  })

  it('keeps a link’s host and drops its path and query, which can hold a token', () => {
    expect(cleanSnippet('Link https://files.example.com/d/abc123?token=secret expired')).toBe('Link files.example.com expired')
  })

  it('cuts a long answer at 160 characters', () => {
    const out = cleanSnippet('word '.repeat(100))
    expect(out.length).toBeLessThanOrEqual(161)
    expect(out.endsWith('…')).toBe(true)
    expect(cleanSnippet('x'.repeat(160))).toBe('x'.repeat(160))
  })

  it('is empty when nothing is left', () => {
    expect(cleanSnippet('')).toBe('')
    expect(cleanSnippet('<br><br>')).toBe('')
    expect(cleanSnippet(undefined)).toBe('')
  })
})

describe('rangeFromStart', () => {
  it('measures a single range from the first byte, capped at the file', () => {
    expect(rangeFromStart('bytes=0-1023', 5000)).toEqual({ length: 1024 })
    expect(rangeFromStart('bytes=0-', 5000)).toEqual({ length: 5000 })
    expect(rangeFromStart('bytes=0-9999', 5000)).toEqual({ length: 5000 })
  })

  it('leaves anything else alone', () => {
    expect(rangeFromStart('bytes=10-20', 5000)).toBeNull()
    expect(rangeFromStart('bytes=0-1,5-9', 5000)).toBeNull()
    expect(rangeFromStart(undefined, 5000)).toBeNull()
    expect(rangeFromStart('bytes=0-10', 0)).toBeNull()
  })
})
