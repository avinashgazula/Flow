import { describe, expect, it } from 'vitest'
import { creditsAlert, creditsScenesFrom } from './creditsScenes'

/* FlowKit's CreditsScenes, case for case: the same two keywords, the same three sentences. */
describe('credits scenes', () => {
  it('are read from TMDB’s stinger keywords, in any case', () => {
    expect(creditsScenesFrom(['superhero', 'DuringCreditsStinger'])).toEqual({ during: true, after: false })
    expect(creditsScenesFrom(['aftercreditsstinger'])).toEqual({ during: false, after: true })
    expect(creditsScenesFrom(['duringcreditsstinger', 'aftercreditsstinger'])).toEqual({ during: true, after: true })
  })

  it('are none for an ordinary film', () => {
    expect(creditsScenesFrom([])).toBeUndefined()
    expect(creditsScenesFrom(['sequel', 'credits'])).toBeUndefined()
  })

  it('are told in the apps’ words', () => {
    expect(creditsAlert({ during: true, after: true })).toBe('Stay for the credits: there’s a scene during them, and another at the very end.')
    expect(creditsAlert({ during: true, after: false })).toBe('Stay for the credits: there’s a scene partway through them.')
    expect(creditsAlert({ during: false, after: true })).toBe('Stay until the end: there’s a scene after the credits.')
  })
})
