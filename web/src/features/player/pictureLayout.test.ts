import { describe, expect, it } from 'vitest'
import type { PictureCue } from '../../lib/remux/pictures'
import { pictureBox, placeObjects, shownShape, sitsHigh } from './pictureLayout'

const cue = (canvas: [number, number], objects: { x: number; y: number; width: number; height: number }[]): PictureCue => ({
  start: 0,
  end: 1,
  canvasWidth: canvas[0],
  canvasHeight: canvas[1],
  forced: false,
  palette: new Uint8Array(),
  objects: objects.map((o) => ({ ...o, indices: new Uint8Array(0) })),
})

describe('the picture a subtitle canvas sits on', () => {
  it('is the video as coded, or as it asks to be shown', () => {
    expect(shownShape({ width: 1920, height: 1080 }, { width: 1, height: 1 })).toEqual({ width: 1920, height: 1080, pixelAspect: 1 })
    // DVD video: 720 by 480 pixels, shown 16:9.
    const dvd = shownShape({ width: 720, height: 480, displayWidth: 16, displayHeight: 9 }, { width: 720, height: 480 })
    expect(dvd.height).toBe(480)
    expect(dvd.width).toBeCloseTo(853.33, 1)
    expect(dvd.pixelAspect).toBeCloseTo(1.185, 2)
    // No video information: the canvas stands for it.
    expect(shownShape(undefined, { width: 1280, height: 720 })).toEqual({ width: 1280, height: 720, pixelAspect: 1 })
  })

  it('is fitted inside the window, or fills it', () => {
    const window = { width: 1000, height: 1000 }
    const fitted = pictureBox(window, { width: 1920, height: 1080 }, 'contain')
    expect(fitted.x).toBeCloseTo(0, 6)
    expect(fitted.y).toBeCloseTo(218.75, 6)
    expect(fitted.width).toBeCloseTo(1000, 6)
    expect(fitted.height).toBeCloseTo(562.5, 6)
    const filled = pictureBox(window, { width: 1920, height: 1080 }, 'cover')
    expect(filled.height).toBe(1000)
    expect(filled.x).toBeLessThan(0)
  })
})

describe('placing objects', () => {
  it('scales a canvas of the video’s size to the picture', () => {
    const [box] = placeObjects(cue([1920, 1080], [{ x: 480, y: 900, width: 960, height: 100 }]), { width: 960, height: 540 }, { width: 1920, height: 1080 }, 'contain')
    expect(box).toEqual({ x: 240, y: 450, width: 480, height: 50 })
  })

  it('keeps a 16:9 canvas centred on a wider, letterboxed picture', () => {
    // A 2.40:1 picture (1920 by 800) with a 1920 by 1080 disc canvas: the canvas is as wide as the picture and centred on it.
    const [box] = placeObjects(cue([1920, 1080], [{ x: 0, y: 0, width: 1920, height: 1080 }]), { width: 1920, height: 1200 }, { width: 1920, height: 800 }, 'contain')
    expect(box).toEqual({ x: 0, y: 60, width: 1920, height: 1080 })
  })

  it('stretches an anamorphic DVD canvas sideways with the picture, not down it', () => {
    const [box] = placeObjects(cue([720, 480], [{ x: 0, y: 400, width: 720, height: 40 }]), { width: 853.3333, height: 480 }, { width: 720, height: 480, displayWidth: 16, displayHeight: 9 }, 'contain')
    expect(box!.width).toBeCloseTo(853.33, 1)
    expect(box!.y).toBeCloseTo(400, 3)
    expect(box!.height).toBeCloseTo(40, 3)
  })

  it('follows the picture when it is zoomed to fill', () => {
    const [box] = placeObjects(cue([1920, 1080], [{ x: 0, y: 0, width: 1920, height: 1080 }]), { width: 1000, height: 1000 }, { width: 1920, height: 1080 }, 'cover')
    expect(box!.height).toBeCloseTo(1000, 3)
    expect(box!.width).toBeCloseTo(1777.78, 1)
  })
})

describe('where a cue sits', () => {
  it('knows the lower half from the upper', () => {
    expect(sitsHigh(cue([1920, 1080], [{ x: 0, y: 900, width: 100, height: 100 }]))).toBe(false)
    expect(sitsHigh(cue([1920, 1080], [{ x: 0, y: 60, width: 100, height: 100 }]))).toBe(true)
    expect(sitsHigh(cue([1920, 1080], []))).toBe(false)
  })
})
