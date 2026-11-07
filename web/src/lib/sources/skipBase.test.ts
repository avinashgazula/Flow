import { describe, expect, it } from 'vitest'
import { baseURLProblem, introDBDefaultBase, skipBase } from './skipBase'

describe('skipBase', () => {
  it('uses the public address when nothing usable is set', () => {
    expect(skipBase(undefined, introDBDefaultBase)).toBe(introDBDefaultBase)
    expect(skipBase('  ', introDBDefaultBase)).toBe(introDBDefaultBase)
    expect(skipBase('not a url', introDBDefaultBase)).toBe(introDBDefaultBase)
    expect(skipBase('ftp://example.com', introDBDefaultBase)).toBe(introDBDefaultBase)
  })
  it('keeps a typed address without trailing slashes', () => {
    expect(skipBase(' https://skips.example.com/v2// ', introDBDefaultBase)).toBe('https://skips.example.com/v2')
  })
})

describe('baseURLProblem', () => {
  it('accepts empty and web addresses, and says what is wrong otherwise', () => {
    expect(baseURLProblem('')).toBeUndefined()
    expect(baseURLProblem('https://skips.example.com')).toBeUndefined()
    expect(baseURLProblem('skips.example.com')).toMatch(/web address/)
    expect(baseURLProblem('https://me:secret@skips.example.com')).toMatch(/login/)
    expect(baseURLProblem('javascript:alert(1)')).toMatch(/https/)
  })
})
