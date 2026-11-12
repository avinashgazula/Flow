import { describe, expect, it } from 'vitest'
import { formatTyped, groupNumber, makeNumber, parseNumber } from './number'

describe('the account number', () => {
  it('is 16 digits, leading zeros allowed', () => {
    for (let i = 0; i < 50; i++) expect(makeNumber()).toMatch(/^\d{16}$/)
    // Bytes that map to 0 give leading zeros and are kept.
    expect(makeNumber((b) => b.fill(10))).toBe('0000000000000000')
  })

  it('throws away random bytes of 250 and up instead of folding them into 0 to 5', () => {
    let calls = 0
    // The first block is all rejected values; the second gives 7s. Nothing from the first may appear.
    const number = makeNumber((b) => (b.fill(++calls === 1 ? 255 : 7)))
    expect(calls).toBe(2)
    expect(number).toBe('7777777777777777')
    // 249 is the last byte kept: 249 % 10 = 9.
    expect(makeNumber((b) => b.fill(249))).toBe('9999999999999999')
  })

  it('has every digit equally likely over all the bytes that are kept', () => {
    const seen = new Array<number>(10).fill(0)
    for (let byte = 0; byte < 250; byte++) seen[byte % 10]!++
    expect(new Set(seen).size).toBe(1)
  })

  it('comes out evenly from the real generator', () => {
    const counts = new Array<number>(10).fill(0)
    for (let i = 0; i < 2000; i++) for (const d of makeNumber()) counts[Number(d)]!++
    // 32,000 digits: each near 3,200. A bias of the modulo kind would put 0 to 5 about 2.5 percent over.
    for (const c of counts) expect(Math.abs(c - 3200)).toBeLessThan(250)
  })

  it('is shown in groups of four', () => {
    expect(groupNumber('1234567890123456')).toBe('1234 5678 9012 3456')
    expect(groupNumber('123456')).toBe('1234 56')
    expect(groupNumber('')).toBe('')
  })

  it('formats as you type: digits only, grouped, never more than 16', () => {
    expect(formatTyped('1')).toBe('1')
    expect(formatTyped('12345')).toBe('1234 5')
    expect(formatTyped('1234-5678-9012-3456')).toBe('1234 5678 9012 3456')
    expect(formatTyped('abc 1234 5678 9012 3456 789')).toBe('1234 5678 9012 3456')
  })

  it('parses with spaces, dashes and other separators ignored', () => {
    expect(parseNumber('1234 5678 9012 3456')).toBe('1234567890123456')
    expect(parseNumber('1234-5678-9012-3456')).toBe('1234567890123456')
    expect(parseNumber('  1234567890123456\n')).toBe('1234567890123456')
    expect(parseNumber('0000 0000 0000 0001')).toBe('0000000000000001')
  })

  it('refuses anything that is not exactly 16 digits', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('1234 5678 9012 345')).toBeNull()
    expect(parseNumber('1234 5678 9012 34567')).toBeNull()
    expect(parseNumber('1234 5678 9012 345a')).toBeNull()
    expect(parseNumber('１２３４５６７８９０１２３４５６')).toBeNull()
  })
})
