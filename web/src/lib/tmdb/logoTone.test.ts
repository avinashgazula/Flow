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

  it('is neither for a colour in the middle, so it is left alone', () => {
    expect(toneOf(px([90, 110, 60, 255], [90, 110, 60, 255]))).toBe('mid')
  })

  it('is light for white lettering on a coloured tile, which is mostly white by weight', () => {
    expect(toneOf(px([255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [30, 120, 50, 255], [30, 120, 50, 255]))).toBe('light')
  })

  it('weighs a pixel by how opaque it is: a faint white halo round black lettering does not make it light', () => {
    expect(toneOf(px([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 40]))).toBe('dark')
  })

  it('has nothing to say about an empty image', () => {
    expect(toneOf(px([255, 255, 255, 0]))).toBe('mid')
    expect(toneOf(new Uint8ClampedArray())).toBe('mid')
  })
})
