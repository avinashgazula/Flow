import { describe, expect, it } from 'vitest'
import { alignedCrop, cropSize, decodeDetections, detectorInput, fits, overlap, similarity, suppress, template, type Detection, type DetectorOutputs, type Frame, type Point } from './geometry'

/** A frame whose every pixel is `color`. */
const solid = (width: number, height: number, color: [number, number, number]): Frame => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([...color, 255], i * 4)
  return { data, width, height }
}

describe('what the detector is given', () => {
  it('shrinks a big frame to the longest side and pads to a multiple of 32', () => {
    const input = detectorInput(solid(1280, 720, [10, 20, 30]), 640)
    expect(input.scale).toBe(0.5)
    expect([input.width, input.height]).toEqual([640, 384])
    expect(input.tensor.length).toBe(3 * 640 * 384)
  })

  it('leaves a small frame its size', () => {
    const input = detectorInput(solid(100, 50, [0, 0, 0]), 640)
    expect(input.scale).toBe(1)
    expect([input.width, input.height]).toEqual([128, 64])
  })

  it('writes blue, green, red planes, and zeros in the padding', () => {
    const input = detectorInput(solid(64, 40, [10, 20, 30]))
    const plane = input.width * input.height
    expect([input.tensor[0], input.tensor[plane], input.tensor[2 * plane]]).toEqual([30, 20, 10])
    // The picture is 40 rows; the padded tensor has 64, so the last row is padding.
    expect(input.tensor[(input.height - 1) * input.width]).toBe(0)
  })
})

describe('reading the detector', () => {
  /** An output grid for a 64 × 64 input where one cell at stride 8 says "a face". */
  const outputs = (cell: number, cls: number, obj: number): DetectorOutputs => {
    const grid = (stride: number) => (64 / stride) ** 2
    const zeros = (n: number, k: number) => new Float32Array(n * k)
    const o: DetectorOutputs = {
      cls: [zeros(grid(8), 1), zeros(grid(16), 1), zeros(grid(32), 1)],
      obj: [zeros(grid(8), 1), zeros(grid(16), 1), zeros(grid(32), 1)],
      bbox: [zeros(grid(8), 4), zeros(grid(16), 4), zeros(grid(32), 4)],
      kps: [zeros(grid(8), 10), zeros(grid(16), 10), zeros(grid(32), 10)],
    }
    o.cls[0][cell] = cls
    o.obj[0][cell] = obj
    // A box centred on the cell, as wide and tall as 2 strides (exp(ln 2)).
    o.bbox[0].set([0, 0, Math.log(2), Math.log(2)], cell * 4)
    // Landmarks as offsets, in strides, from the cell.
    o.kps[0].set([-1, -1, 1, -1, 0, 0, -1, 1, 1, 1], cell * 10)
    return o
  }

  it('turns a confident cell into a box and five landmarks in the frame', () => {
    // Cell 18 of an 8 × 8 grid is column 2, row 2: its centre is at 16 px in the detector's input, 32 in a frame twice as big.
    const [face] = decodeDetections(outputs(18, 0.81, 1), 64, 64, 0.5)
    expect(face!.score).toBeCloseTo(0.9)
    expect(face!.box.x).toBeCloseTo(16)
    expect(face!.box.y).toBeCloseTo(16)
    expect(face!.box.width).toBeCloseTo(32)
    expect(face!.box.height).toBeCloseTo(32)
    expect(face!.landmarks[2]![0]).toBeCloseTo(32)
    expect(face!.landmarks[2]![1]).toBeCloseTo(32)
    expect(face!.landmarks[0]![0]).toBeCloseTo(16)
  })

  it('ignores cells under the score threshold', () => {
    expect(decodeDetections(outputs(18, 0.3, 0.3), 64, 64, 1)).toEqual([])
  })

  it('merges answers for the same face and keeps the strongest', () => {
    const o = outputs(18, 0.9, 1)
    o.cls[0][19] = 0.7
    o.obj[0][19] = 1
    o.bbox[0].set([-0.25, 0, Math.log(2), Math.log(2)], 19 * 4)
    const faces = decodeDetections(o, 64, 64, 1, 0.5)
    expect(faces).toHaveLength(1)
    expect(faces[0]!.score).toBeCloseTo(Math.sqrt(0.9))
  })
})

describe('overlap and suppression', () => {
  const box = (x: number, width = 10) => ({ x, y: 0, width, height: 10 })
  it('is intersection over union', () => {
    expect(overlap(box(0), box(0))).toBe(1)
    expect(overlap(box(0), box(20))).toBe(0)
    expect(overlap(box(0), box(5))).toBeCloseTo(50 / 150)
  })

  it('drops the weaker of two faces that overlap and keeps ones apart', () => {
    const face = (x: number, score: number): Detection => ({ box: box(x), landmarks: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], score })
    const kept = suppress([face(1, 0.8), face(0, 0.9), face(30, 0.7)], 0.3)
    expect(kept.map((f) => f.score)).toEqual([0.9, 0.7])
  })
})

describe('turning a face upright', () => {
  const apply = (s: { a: number; b: number; tx: number; ty: number }, [x, y]: Point): Point => [s.a * x - s.b * y + s.tx, s.b * x + s.a * y + s.ty]
  const rotate = (points: readonly Point[], degrees: number, scale: number, shift: Point): Point[] => {
    const r = (degrees * Math.PI) / 180
    return points.map(([x, y]) => [scale * (Math.cos(r) * x - Math.sin(r) * y) + shift[0], scale * (Math.sin(r) * x + Math.cos(r) * y) + shift[1]])
  }

  it('finds the rotation, scale and shift that were applied to the template', () => {
    const seen = rotate(template, 20, 2.5, [300, 120])
    const s = similarity(seen, template)
    seen.forEach((p, i) => {
      const [x, y] = apply(s, p)
      expect(x).toBeCloseTo(template[i]![0], 3)
      expect(y).toBeCloseTo(template[i]![1], 3)
    })
  })

  it('never mirrors', () => {
    const s = similarity(template.map(([x, y]) => [-x, y] as Point), template)
    // A mirror image can't be undone by a rotation, so the fit is a poor one, but its scale stays positive.
    expect(s.a * s.a + s.b * s.b).toBeGreaterThan(0)
  })

  it('crops a straight face at the template, and black beyond the frame', () => {
    // A frame with a bright left half; the face sits at the template's own scale, shifted by (10, 5).
    const width = 160
    const height = 140
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([x < 50 ? 200 : 40, 100, 20, 255], (y * width + x) * 4)
    const landmarks = template.map(([x, y]) => [x + 10, y + 5] as Point)
    const crop = alignedCrop({ data, width, height }, landmarks)
    const plane = cropSize * cropSize
    expect(crop).toHaveLength(3 * plane)
    // Crop column 20 is frame column 30 (bright); column 70 is frame column 80 (dark). Channels are red, green, blue.
    expect(crop[50 * cropSize + 20]).toBeCloseTo(200, 0)
    expect(crop[50 * cropSize + 70]).toBeCloseTo(40, 0)
    expect(crop[plane + 50 * cropSize + 70]).toBeCloseTo(100, 0)
    expect(crop[2 * plane + 50 * cropSize + 70]).toBeCloseTo(20, 0)
    // Moved the other way, the top rows of the crop are above the frame: black, as OpenCV's warp leaves them.
    const above = alignedCrop({ data, width, height }, template.map(([x, y]) => [x + 10, y - 5] as Point))
    expect(above[0 * cropSize + 60]).toBe(0)
    expect(above[10 * cropSize + 60]).toBeGreaterThan(0)
  })
})

describe('sizes', () => {
  it('fits within the longest side and never enlarges', () => {
    expect(fits(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 })
    expect(fits(640, 360, 1280)).toEqual({ width: 640, height: 360 })
  })
})
