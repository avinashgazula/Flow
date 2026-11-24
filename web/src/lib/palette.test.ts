import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from './store/settings'
import { watchPalette } from './palette'

/** A page with just what the palette touches: <html>'s attributes, the address-bar meta and the paper CSS resolves. */
function page(paper: string) {
  const meta = { content: '', setAttribute(_: string, v: string) { this.content = v } }
  const dataset: Record<string, string> = {}
  vi.stubGlobal('document', { documentElement: { dataset }, querySelector: () => meta })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => ` ${paper} ` }))
  return { meta, dataset }
}

afterEach(() => {
  // Back to the default while the page still exists: earlier tests' watchers are still subscribed.
  settingsStore.set({ palette: 'admitOne' })
  vi.unstubAllGlobals()
})

describe('watchPalette', () => {
  it('puts the saved theme on <html> at start and leaves the address bar to index.html', () => {
    const { meta, dataset } = page('#ffffff')
    settingsStore.set({ palette: 'index' })
    watchPalette()
    expect(dataset.palette).toBe('index')
    expect(meta.content).toBe('#ffffff')
  })

  it('follows a change at once, and the address bar takes the new paper', () => {
    const { meta, dataset } = page('#fbf7ee')
    watchPalette()
    expect(dataset.palette).toBe('admitOne')
    meta.content = ''
    settingsStore.set({ palette: 'openingNight' })
    expect(dataset.palette).toBe('openingNight')
    expect(meta.content).toBe('#fbf7ee')
  })

  it('reads a theme it does not know as Admit One', () => {
    const { dataset } = page('#f4f1ea')
    settingsStore.set({ palette: 'matinee' as never })
    watchPalette()
    expect(dataset.palette).toBe('admitOne')
  })
})
