import { beforeEach, describe, expect, it } from 'vitest'
import { settingsStore } from '../store/settings'
import { activeProviders, clearFavourites, isFavourite, liveTVSettings, recordRecent, toggleFavourite, updateLiveTV } from './favourites'
import { demoProvider } from './demo'
import { defaultLiveTV } from './types'

beforeEach(() => settingsStore.set({ demo: false, liveTV: defaultLiveTV }))

describe('favourite and recent channels', () => {
  it('toggles a favourite on and off, and clears them all', () => {
    expect(toggleFavourite('p:a:0')).toBe(true)
    expect(toggleFavourite('p:b:1')).toBe(true)
    expect(isFavourite('p:a:0')).toBe(true)
    expect(toggleFavourite('p:a:0')).toBe(false)
    expect(settingsStore.get().liveTV.favouriteChannelIDs).toEqual(['p:b:1'])
    clearFavourites()
    expect(settingsStore.get().liveTV.favouriteChannelIDs).toEqual([])
  })

  it('keeps the latest twenty recents, newest first, without repeats', () => {
    for (let i = 0; i < 25; i++) recordRecent(`c${i}`)
    recordRecent('c20')
    const recents = settingsStore.get().liveTV.recentChannelIDs
    expect(recents).toHaveLength(20)
    expect(recents.slice(0, 3)).toEqual(['c20', 'c24', 'c23'])
    expect(new Set(recents).size).toBe(20)
  })

  it('changes one field and leaves the others', () => {
    updateLiveTV({ epgRefreshHours: 6 })
    toggleFavourite('x')
    expect(settingsStore.get().liveTV).toMatchObject({ epgRefreshHours: 6, favouriteChannelIDs: ['x'], hideEmptyGroups: true })
  })

  it('fills fields an older saved setting lacks', () => {
    settingsStore.set({ liveTV: { providers: [] } as never })
    expect(liveTVSettings(settingsStore.get())).toEqual(defaultLiveTV)
  })
})

describe('which providers Live TV reads', () => {
  it('uses the sample provider alone while sample data is on', () => {
    const mine = { id: 'm', name: 'Mine', kind: 'm3u' as const, url: 'https://iptv.example/a.m3u', enabled: true, useForVOD: true }
    updateLiveTV({ providers: [mine] })
    expect(activeProviders(settingsStore.get())).toEqual([mine])
    settingsStore.set({ demo: true })
    expect(activeProviders(settingsStore.get())).toEqual([demoProvider])
  })
})
