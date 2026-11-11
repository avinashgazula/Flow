import { describe, expect, it } from 'vitest'
import { TMDBError } from '../../lib/tmdb/client'
import { errorMessage, isKeyError } from './Controls'

describe('errorMessage', () => {
  it('replaces the browser’s "Failed to fetch" with what happened', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('Marquee couldn’t reach TMDB. Check your connection, then try again.')
  })

  it('sends a refused key to Settings instead of "try again"', () => {
    const refused = new TMDBError('Invalid API key: You must be granted a valid key.', 401)
    expect(isKeyError(refused)).toBe(true)
    expect(errorMessage(refused)).toBe('TMDB didn’t accept this key. Check it in Settings.')
  })

  it('keeps the missing-key sentence, which already says what to do', () => {
    expect(errorMessage(new TMDBError('Add a TMDB key in Settings to load the catalogue.', 401))).toBe('Add a TMDB key in Settings to load the catalogue.')
  })

  it('asks for another try on other failures', () => {
    const down = new TMDBError('Internal error', 500)
    expect(isKeyError(down)).toBe(false)
    expect(errorMessage(down)).toBe('Internal error. Try again in a moment.')
  })
})
