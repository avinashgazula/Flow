import { describe, expect, it } from 'vitest'
import { openingRedirect, startPath } from './startTab'

describe('Opening Tab', () => {
  it('opens the page of the saved tab, and Home for anything else', () => {
    expect(startPath('library')).toBe('/library')
    expect(startPath('live')).toBe('/live')
    expect(startPath('home')).toBe('/')
    expect(startPath(undefined)).toBe('/')
    expect(startPath('podcasts')).toBe('/')
  })

  it('sends the first arrival at the plain address there, and never again in the visit', () => {
    const first = { first: true, search: '', hash: '' }
    expect(openingRedirect('explore', first)).toBe('/explore')
    expect(openingRedirect('explore', { ...first, first: false })).toBeUndefined()
  })

  it('leaves Home alone, and leaves links with something in them to Home', () => {
    const first = { first: true, search: '', hash: '' }
    expect(openingRedirect('home', first)).toBeUndefined()
    expect(openingRedirect(undefined, first)).toBeUndefined()
    expect(openingRedirect('library', { ...first, search: '?code=abc&state=x' })).toBeUndefined()
    expect(openingRedirect('library', { ...first, hash: '#sync=abc' })).toBeUndefined()
  })
})
