import { describe, expect, it } from 'vitest'
import { toneOf } from './logoTone'

/** Pixels from [r, g, b, a] tuples. */
const px = (...p: number[][]) => Uint8ClampedArray.from(p.flat())

describe('a logo’s tone', () => {
  it('is light for white lettering, whatever surrounds it', () => {
    expect(toneOf(px([255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe('light')
  })

  it('is dark for black lettering', () => {
    expect(toneOf(px([10, 10, 10, 255], [0, 0, 0, 255], [255, 255, 255, 0]))).toBe('dark')
  })

  it('is neither for a mid grey, so it is left alone', () => {
    expect(toneOf(px([110, 110, 110, 255], [100, 100, 100, 255]))).toBe('mid')
  })

  it('is colour for a coloured logo, so it is not flipped', () => {
    expect(toneOf(px([90, 160, 60, 255], [90, 160, 60, 255]))).toBe('color')
  })

  it('is colour for white lettering on a coloured tile, even though it is mostly white by weight', () => {
    expect(toneOf(px([255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [30, 120, 50, 255], [30, 120, 50, 255]))).toBe('color')
  })

  it('stays plain white when a stray tinted pixel or two sit among it', () => {
    const white = Array.from({ length: 30 }, () => [250, 250, 255, 255])
    expect(toneOf(px(...white, [200, 60, 60, 255]))).toBe('light')
  })

  it('weighs a pixel by how opaque it is: a faint white halo round black lettering does not make it light', () => {
    expect(toneOf(px([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 40]))).toBe('dark')
  })

  it('has nothing to say about an empty image', () => {
    expect(toneOf(px([255, 255, 255, 0]))).toBe('mid')
    expect(toneOf(new Uint8ClampedArray())).toBe('mid')
  })
})
