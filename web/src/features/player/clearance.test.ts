import { describe, expect, it } from 'vitest'
import { sideMargin, takeAll, takeOf } from './clearance'

const phone = { width: 390, height: 844 }
const landscape = { width: 844, height: 390 }
const desktop = { width: 1440, height: 900 }

describe('what a panel takes from the subtitles', () => {
  it('takes nothing when there is no panel', () => {
    expect(takeOf(null, phone)).toEqual({ right: 0, bottom: 0 })
  })

  it('keeps the options panel beside the picture on a wide or short window, as the stylesheet does', () => {
    const options = { kind: 'panel', width: 380, room: 600 } as const
    expect(takeOf(options, desktop)).toEqual({ right: 380 + 28 + 24, bottom: 0 })
    expect(takeOf(options, landscape)).toEqual({ right: 380 + 16 + 24, bottom: 0 })
  })

  it('raises the line above the options panel on a phone held upright', () => {
    expect(takeOf({ kind: 'panel', width: 358, room: 500 }, phone)).toEqual({ right: 0, bottom: 512 })
    expect(takeOf({ kind: 'panel', width: 380, room: 500 }, { width: 800, height: 700 })).toEqual({ right: 0, bottom: 512 })
  })

  it('leaves the room under Subtitle Style and Delay alone on a narrow window, where they hang from the top', () => {
    expect(takeOf({ kind: 'panel', width: 358, room: 780 }, phone, true)).toEqual({ right: 0, bottom: 0 })
    expect(takeOf({ kind: 'panel', width: 380, room: 300 }, desktop, true).right).toBeGreaterThan(0)
  })

  it('puts X-Ray beside from 721 pixels wide and over the lower part below', () => {
    const xray = { kind: 'xray', width: 380, room: 420 } as const
    expect(takeOf(xray, { width: 721, height: 700 }).right).toBeGreaterThan(0)
    expect(takeOf(xray, { width: 720, height: 700 })).toEqual({ right: 0, bottom: 432 })
  })

  it('always raises the line above the episodes shelf, which spans the window', () => {
    const shelf = { kind: 'shelf', width: 1384, room: 330 } as const
    expect(takeOf(shelf, desktop)).toEqual({ right: 0, bottom: 342 })
    expect(takeOf(shelf, landscape)).toEqual({ right: 0, bottom: 342 })
  })

  it('keeps the line beside Playback Info only in a short window, where the card is as low as the line', () => {
    const info = { kind: 'info', width: 300, room: 300 } as const
    expect(takeOf(info, landscape)).toEqual({ right: 300 + 16 + 24, bottom: 0 })
    expect(takeOf(info, phone)).toEqual({ right: 0, bottom: 0 })
    expect(takeOf(info, desktop)).toEqual({ right: 0, bottom: 0 })
  })

  it('combines the panels that are up, taking the most along each edge', () => {
    const both = [{ kind: 'info', width: 300, room: 300 }, { kind: 'panel', width: 380, room: 300 }] as const
    expect(takeAll(both, landscape)).toEqual({ right: 380 + 16 + 24, bottom: 0 })
    expect(takeAll([], landscape)).toEqual({ right: 0, bottom: 0 })
    expect(takeAll([{ kind: 'shelf', width: 800, room: 200 }, { kind: 'xray', width: 380, room: 420 }], { width: 700, height: 800 })).toEqual({ right: 0, bottom: 432 })
  })

  it('knows the side margin the controls keep', () => {
    expect(sideMargin(desktop)).toBe(28)
    expect(sideMargin(phone)).toBe(16)
    expect(sideMargin(landscape)).toBe(16)
  })
})
