import { describe, expect, it } from 'vitest'
import { baseLanguage, languageCode, languageName, sameLanguage } from './language'

describe('languages', () => {
  it('compares codes however they’re written', () => {
    expect(sameLanguage('eng', 'en')).toBe(true)
    expect(sameLanguage('en-US', 'EN_gb')).toBe(true)
    expect(sameLanguage('cmn', 'zh-TW')).toBe(true)
    expect(sameLanguage('en', 'fr')).toBe(false)
    expect(sameLanguage('und', 'und')).toBe(false)
    expect(sameLanguage(undefined, 'en')).toBe(false)
  })
  it('reduces a code to its language', () => {
    expect(baseLanguage('tam')).toBe('ta')
    expect(baseLanguage('pt-BR')).toBe('pt')
    expect(baseLanguage('mul')).toBeUndefined()
  })
  it('names a language, and finds a code from a name', () => {
    expect(languageName('eng')).toBe('English')
    expect(languageName('hi')).toBe('Hindi')
    expect(languageName('und')).toBeUndefined()
    expect(languageCode('Hindi')).toBe('hi')
    expect(languageCode('english')).toBe('en')
    expect(languageCode('Multi')).toBeUndefined()
  })
})
