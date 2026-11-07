import { describe, expect, it } from 'vitest'
import { drifted, nextItem, placeMenu, pointAnchor } from './menuPlace'

const view = { width: 400, height: 800 }
const size = { width: 200, height: 150 }

describe('placeMenu', () => {
  it('opens under the anchor, starting at its left edge', () => {
    expect(placeMenu({ left: 20, top: 100, right: 56, bottom: 136 }, size, view)).toEqual({ left: 20, top: 140 })
  })

  it('lines up with the anchor’s right edge when it would run off the screen', () => {
    expect(placeMenu({ left: 340, top: 100, right: 376, bottom: 136 }, size, view)).toEqual({ left: 176, top: 140 })
  })

  it('opens above when there is no room below', () => {
    expect(placeMenu({ left: 20, top: 700, right: 56, bottom: 736 }, size, view)).toEqual({ left: 20, top: 546 })
  })

  it('stays inside the screen when there is no room above or below', () => {
    const tiny = { width: 400, height: 160 }
    expect(placeMenu({ left: 20, top: 60, right: 56, bottom: 96 }, size, tiny)).toEqual({ left: 20, top: 8 })
  })

  it('opens at the point of a right-click, and keeps off the right edge', () => {
    expect(placeMenu(pointAnchor(100, 100), size, view)).toEqual({ left: 100, top: 104 })
    expect(placeMenu(pointAnchor(390, 100), size, view)).toEqual({ left: 190, top: 104 })
  })
})

describe('nextItem', () => {
  it('moves down and up, wrapping at both ends', () => {
    expect(nextItem(0, 'ArrowDown', 3)).toBe(1)
    expect(nextItem(2, 'ArrowDown', 3)).toBe(0)
    expect(nextItem(0, 'ArrowUp', 3)).toBe(2)
  })

  it('goes to either end with Home and End, and ignores other keys', () => {
    expect(nextItem(1, 'Home', 3)).toBe(0)
    expect(nextItem(1, 'End', 3)).toBe(2)
    expect(nextItem(1, 'a', 3)).toBeUndefined()
    expect(nextItem(0, 'ArrowDown', 0)).toBeUndefined()
  })
})

describe('drifted', () => {
  it('lets a finger wobble a little and calls a real move a scroll', () => {
    expect(drifted({ x: 10, y: 10 }, { x: 14, y: 13 })).toBe(false)
    expect(drifted({ x: 10, y: 10 }, { x: 10, y: 30 })).toBe(true)
  })
})
