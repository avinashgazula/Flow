import { describe, expect, it } from 'vitest'
import { accountLink, parseAccountLink } from './link'

/* The shared vectors (testdata/contracts/account-link.json) run in contracts/account.test.ts; these are the round trip. */

describe('account link', () => {
  it('reads back what it builds', () => {
    const link = accountLink('1234 5678 9012 3456', 'https://example.workers.dev')!
    expect(link).toBe('flow://account?n=1234567890123456&s=https%3A%2F%2Fexample.workers.dev')
    expect(parseAccountLink(link)).toEqual({ number: '1234567890123456', server: 'https://example.workers.dev' })
  })

  it('never builds a link that could not log anyone in', () => {
    expect(accountLink('', 'https://example.workers.dev')).toBeNull()
    expect(accountLink('1234567890123456', 'not a server')).toBeNull()
  })

  it('keeps the number out of anything but the link itself', () => {
    expect(accountLink('1234567890123456', 'https://example.workers.dev')).not.toContain(' ')
  })
})
