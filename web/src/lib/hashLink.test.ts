import { describe, expect, it } from 'vitest'
import { parseHashLink } from './hashLink'

describe('parseHashLink', () => {
  it('reads #setup= with the bare payload the apps put after d=', () => {
    expect(parseHashLink('#setup=eyJhIjoxfQ')).toEqual({ kind: 'setup', link: 'flow://setup?d=eyJhIjoxfQ' })
  })

  it('reads the apps’ flow://setup link after the # or after setup=', () => {
    expect(parseHashLink('#flow://setup?d=abc_-')).toEqual({ kind: 'setup', link: 'flow://setup?d=abc_-' })
    expect(parseHashLink('#setup=flow%3A%2F%2Fsetup%3Fd%3Dabc_-')).toEqual({ kind: 'setup', link: 'flow://setup?d=abc_-' })
    expect(parseHashLink('#setup=d=abc')).toEqual({ kind: 'setup', link: 'flow://setup?d=abc' })
  })

  it('has nothing to open for an empty setup', () => {
    expect(parseHashLink('#setup=')).toBeUndefined()
    expect(parseHashLink('#setup=flow://setup')).toBeUndefined()
  })

  it('reads #sync= parameters as the Join a Sync flow takes them', () => {
    expect(parseHashLink('#sync=k=AAAA&s=https%3A%2F%2Fw.example&t=x')).toEqual({ kind: 'sync', link: 'sync=k=AAAA&s=https%3A%2F%2Fw.example&t=x' })
  })

  it('reads the apps’ flow://sync link', () => {
    expect(parseHashLink('#flow://sync?k=AAAA&s=https%3A%2F%2Fw.example')).toEqual({ kind: 'sync', link: 'flow://sync?k=AAAA&s=https%3A%2F%2Fw.example' })
    expect(parseHashLink('#sync=flow%3A%2F%2Fsync%3Fk%3DAAAA')).toEqual({ kind: 'sync', link: 'flow://sync?k=AAAA' })
  })

  it('leaves every other fragment alone (a Settings section, nothing)', () => {
    expect(parseHashLink('')).toBeUndefined()
    expect(parseHashLink('#data')).toBeUndefined()
    expect(parseHashLink('#main')).toBeUndefined()
  })
})
