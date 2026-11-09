import { describe, expect, it } from 'vitest'
import { continueLink } from './skipDetails'

describe('where a Continue Watching card goes', () => {
  const show = { type: 'show' as const, id: 1396 }
  it('plays the episode in progress when details are skipped', () => {
    expect(continueLink({ item: show, progress: { episode: { season: 3, episode: 7 } } }, true)).toEqual({ to: '/watch/$type/$id', params: show, search: { season: 3, episode: 7 } })
  })
  it('plays the next episode of a show with nothing in progress', () => {
    expect(continueLink({ item: show, episode: { season: 2, episode: 1 } }, true).search).toEqual({ season: 2, episode: 1 })
  })
  it('plays a film from where it was left', () => {
    expect(continueLink({ item: { type: 'movie', id: 693134 } }, true)).toMatchObject({ to: '/watch/$type/$id', search: undefined })
  })
  it('opens the title, on the season, when details are kept', () => {
    expect(continueLink({ item: show, progress: { episode: { season: 3, episode: 7 } } }, false)).toEqual({ to: '/title/$type/$id', params: show, search: { season: 3 } })
    expect(continueLink({ item: { type: 'movie', id: 1 } }, false).search).toBeUndefined()
  })
})
