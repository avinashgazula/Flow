import { describe, expect, it } from 'vitest'
import type { PictureCue } from '../../lib/remux/pictures'
import { clearBoxes, liftFor, pictureBox, placeObjects, shownShape, sitsHigh } from './pictureLayout'

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

describe('raising a subtitle clear of the controls', () => {
  const base = { container: 1000, controls: 96, user: 0, high: false }
  it('leaves it be when the controls are away, or it is already clear', () => {
    expect(liftFor({ ...base, bottom: 950, controls: 0 })).toBe(0)
    expect(liftFor({ ...base, bottom: 800 })).toBe(0)
  })

  it('raises it just clear of the band when it sits in it', () => {
    expect(liftFor({ ...base, bottom: 950 })).toBe(46)
    expect(liftFor({ ...base, bottom: 1000 })).toBe(96)
  })

  it('takes the viewer’s position when that is higher', () => {
    expect(liftFor({ ...base, bottom: 950, user: 0.2 })).toBe(200)
    expect(liftFor({ ...base, bottom: 950, user: 0.02, controls: 0 })).toBe(20)
    expect(liftFor({ ...base, bottom: 950, user: 0.02 })).toBe(46)
  })

  it('leaves a title or a sign in the upper half alone', () => {
    expect(liftFor({ ...base, bottom: 990, user: 0.3, high: true })).toBe(0)
  })
})

describe('raising a subtitle clear of a panel over the lower part', () => {
  const base = { container: 800, controls: 96, user: 0, high: false }
  it('raises every line to just above the panel', () => {
    expect(liftFor({ ...base, bottom: 790, sheet: 412 })).toBe(402)
    expect(liftFor({ ...base, bottom: 700, sheet: 412 })).toBe(312)
  })

  it('leaves a line that is already above the panel where it is', () => {
    expect(liftFor({ ...base, bottom: 300, sheet: 412, controls: 0 })).toBe(0)
  })

  it('raises a title in the upper half only when the panel reaches it', () => {
    expect(liftFor({ ...base, bottom: 200, sheet: 412, high: true })).toBe(0)
    expect(liftFor({ ...base, bottom: 500, sheet: 412, high: true })).toBe(112)
  })

  it('does nothing without a panel', () => {
    expect(liftFor({ ...base, bottom: 790, controls: 0 })).toBe(0)
  })
})

describe('keeping a cue clear of a panel beside the picture', () => {
  const window = { width: 1000, height: 600 }
  const line = { x: 300, y: 500, width: 400, height: 60 }

  it('leaves a cue that is already clear alone', () => {
    const boxes = [line]
    expect(clearBoxes(boxes, window, { right: 300, bottom: 0 })).toBe(boxes)
    expect(clearBoxes(boxes, window, { right: 0, bottom: 0 })).toBe(boxes)
  })

  it('moves a cue that overlaps the panel left, without resizing it', () => {
    const [box] = clearBoxes([line], window, { right: 500, bottom: 0 })
    // 500 pixels are free, so the line (300 to 700) ends at 500.
    expect(box).toEqual({ x: 100, y: 500, width: 400, height: 60 })
  })

  it('scales a cue wider than the room left, about its lower edge, and keeps it inside', () => {
    const [box] = clearBoxes([{ x: 100, y: 500, width: 800, height: 80 }], window, { right: 400, bottom: 0 })
    expect(box!.width).toBeCloseTo(600, 6)
    expect(box!.height).toBeCloseTo(60, 6)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(600 + 1e-6)
    expect(box!.y + box!.height).toBeCloseTo(580, 6)
  })

  it('moves every object of a cue together, keeping their arrangement', () => {
    const [a, b] = clearBoxes([{ x: 300, y: 400, width: 400, height: 40 }, { x: 350, y: 500, width: 300, height: 50 }], window, { right: 500, bottom: 0 })
    expect(a!.x).toBe(100)
    expect(b!.x).toBe(150)
    expect(b!.y - a!.y).toBe(100)
  })

  it('shrinks a cue too tall for the room above a panel over the lower part', () => {
    const [box] = clearBoxes([{ x: 300, y: 100, width: 400, height: 500 }], window, { right: 0, bottom: 300 })
    expect(box!.height).toBeCloseTo(300, 6)
    expect(box!.width).toBeCloseTo(240, 6)
  })
})
