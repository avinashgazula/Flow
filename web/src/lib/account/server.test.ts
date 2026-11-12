import { describe, expect, it } from 'vitest'
import { resolveServer } from './server'

describe('which account server to use', () => {
  it('prefers the one the site was built with, then one typed, then the stream proxy’s Worker', () => {
    expect(resolveServer('https://accounts.example.com/', 'https://proxy.example.com/?url={url}', 'https://typed.example.com')).toEqual({ server: 'https://accounts.example.com', source: 'build' })
    expect(resolveServer(undefined, 'https://proxy.example.com/?url={url}', 'typed.example.com')).toEqual({ server: 'https://typed.example.com', source: 'typed' })
    expect(resolveServer('', 'https://proxy.example.com/?url={url}&token=x', '')).toEqual({ server: 'https://proxy.example.com', source: 'proxy' })
  })

  it('has none when nothing names a Worker', () => {
    expect(resolveServer(undefined, '', '')).toBeNull()
    expect(resolveServer('', '  ', '  ')).toBeNull()
  })

  it('never takes the proxy’s token along', () => {
    expect(JSON.stringify(resolveServer(undefined, 'https://proxy.example.com/?url={url}&token=secret', ''))).not.toContain('secret')
  })
})
