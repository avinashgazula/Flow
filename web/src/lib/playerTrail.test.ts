import { describe, expect, it } from 'vitest'
import { closeAction, isPlayerPath, previousPath, trailMoved } from './playerTrail'

describe('closeAction', () => {
  it('goes back to the page the viewer came from', () => {
    expect(closeAction({ canGoBack: true, previous: '/title/movie/693134' })).toBe('back')
    expect(closeAction({ canGoBack: true, previous: '/' })).toBe('back')
    expect(closeAction({ canGoBack: true, previous: undefined })).toBe('back')
  })
  it('opens the title page when the site has nothing earlier (a deep link or a reload)', () => {
    expect(closeAction({ canGoBack: false, previous: undefined })).toBe('title')
  })
  it('never steps back into a player address', () => {
    expect(closeAction({ canGoBack: true, previous: '/watch/movie/1' })).toBe('title')
    expect(closeAction({ canGoBack: true, previous: '/continue' })).toBe('title')
  })
})

describe('isPlayerPath', () => {
  it('knows the player addresses and not look-alikes', () => {
    expect(isPlayerPath('/watch/show/1396')).toBe(true)
    expect(isPlayerPath('/continue')).toBe(true)
    expect(isPlayerPath('/watchlist')).toBe(false)
    expect(isPlayerPath('/title/movie/1')).toBe(false)
  })
})

describe('trailMoved', () => {
  it('remembers the page before, and keeps it across episode changes', () => {
    trailMoved('/title/show/1396', '/watch/show/1396')
    expect(previousPath()).toBe('/title/show/1396')
    trailMoved('/watch/show/1396', '/watch/show/1396')
    expect(previousPath()).toBe('/title/show/1396')
    trailMoved('/watch/show/1396', '/')
    expect(previousPath()).toBe('/watch/show/1396')
  })
})
