/* The picture side of face recognition, as plain functions on pixels: what goes into the face detector, how its answer
   is read, and how a found face is straightened into the 112 × 112 crop the recogniser expects. No browser API is used,
   so the unit tests run these on made-up pixels and the worker runs them on a video frame alike. The two models are
   OpenCV Zoo's YuNet (detector) and SFace (recogniser); the preprocessing follows OpenCV's own FaceDetectorYN and
   FaceRecognizerSF, which is what the models were published to be used with. */

/** RGBA pixels, row by row, as `ImageData` and canvases hand them over. */
export interface Frame {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export type Point = readonly [number, number]

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A face the detector found: its box, the five landmarks (the eye on the picture's left, the eye on its right, the nose
 *  tip, the mouth corner on the left, the mouth corner on the right) and how sure it is, 0 to 1. In the frame's pixels. */
export interface Detection {
  box: Box
  landmarks: [Point, Point, Point, Point, Point]
  score: number
}

/** The longest side the detector looks at. YuNet finds faces from about 10 to 300 pixels at this size, so a face that is
 *  a tenth of a 1080p picture's height is found, and a crowd in the far distance is not asked for. */
export const detectorSide = 640
const strides = [8, 16, 32] as const

/** The frame as the detector wants it: scaled to fit `maxSide`, padded on the right and bottom to a multiple of 32, as
 *  BGR floats 0 to 255 in NCHW order. `scale` takes a detector coordinate back to the frame. */
export function detectorInput(frame: Frame, maxSide = detectorSide): { tensor: Float32Array; width: number; height: number; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(frame.width, frame.height))
  const w = Math.max(1, Math.round(frame.width * scale))
  const h = Math.max(1, Math.round(frame.height * scale))
  const width = Math.ceil(w / 32) * 32
  const height = Math.ceil(h / 32) * 32
  const plane = width * height
  const tensor = new Float32Array(3 * plane)
  const px = new Float32Array(3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sample(frame, ((x + 0.5) / w) * frame.width - 0.5, ((y + 0.5) / h) * frame.height - 0.5, px, 'edge')
      const i = y * width + x
      tensor[i] = px[2]!
      tensor[plane + i] = px[1]!
      tensor[2 * plane + i] = px[0]!
    }
  }
  return { tensor, width, height, scale }
}

/** What YuNet answers for one input: for each stride a score for "a face" and for "an object", then the box offsets and the
 *  five landmark offsets of every grid cell. */
export interface DetectorOutputs {
  cls: [Float32Array, Float32Array, Float32Array]
  obj: [Float32Array, Float32Array, Float32Array]
  bbox: [Float32Array, Float32Array, Float32Array]
  kps: [Float32Array, Float32Array, Float32Array]
}

/** Reads YuNet's grid into faces, strongest first, with overlapping answers for the same face merged. The arithmetic is
 *  OpenCV's: a cell's score is the geometric mean of its two scores, its box and landmarks are offsets from the cell in
 *  strides. `width` and `height` are the detector input's, `scale` its ratio to the frame. */
export function decodeDetections(out: DetectorOutputs, width: number, height: number, scale: number, scoreThreshold = 0.7, nmsThreshold = 0.3): Detection[] {
  const found: Detection[] = []
  strides.forEach((stride, s) => {
    const cols = Math.floor(width / stride)
    const rows = Math.floor(height / stride)
    const cls = out.cls[s]!
    const obj = out.obj[s]!
    const bbox = out.bbox[s]!
    const kps = out.kps[s]!
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const score = Math.sqrt(clamp01(cls[i]!) * clamp01(obj[i]!))
        if (score < scoreThreshold) continue
        const cx = (c + bbox[i * 4]!) * stride
        const cy = (r + bbox[i * 4 + 1]!) * stride
        const w = Math.exp(bbox[i * 4 + 2]!) * stride
        const h = Math.exp(bbox[i * 4 + 3]!) * stride
        const point = (n: number): Point => [((kps[i * 10 + 2 * n]! + c) * stride) / scale, ((kps[i * 10 + 2 * n + 1]! + r) * stride) / scale]
        found.push({
          box: { x: (cx - w / 2) / scale, y: (cy - h / 2) / scale, width: w / scale, height: h / scale },
          landmarks: [point(0), point(1), point(2), point(3), point(4)],
          score,
        })
      }
    }
  })
  return suppress(found, nmsThreshold)
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Non-maximum suppression: the strongest face stays and any that overlap it by more than `threshold` go. */
export function suppress(faces: Detection[], threshold: number): Detection[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score)
  const kept: Detection[] = []
  for (const f of sorted) if (kept.every((k) => overlap(k.box, f.box) <= threshold)) kept.push(f)
  return kept
}

/** Intersection over union of two boxes. */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  return inter / (a.width * a.height + b.width * b.height - inter)
}

/** Where the five landmarks sit in the 112 × 112 crop SFace was trained on (the ArcFace template). */
export const template: readonly Point[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]
export const cropSize = 112

/** A scale, a rotation and a shift: x' = a·x − b·y + tx, y' = b·x + a·y + ty. Never a mirror image. */
export interface Similarity {
  a: number
  b: number
  tx: number
  ty: number
}

/** The similarity that puts `from` as near `to` as it can, in the least-squares sense (Umeyama's method, without the
 *  reflection), which is how a face is turned upright and scaled to the template. */
export function similarity(from: readonly Point[], to: readonly Point[]): Similarity {
  const n = from.length
  let mx = 0, my = 0, nx = 0, ny = 0
  for (let i = 0; i < n; i++) {
    mx += from[i]![0]
    my += from[i]![1]
    nx += to[i]![0]
    ny += to[i]![1]
  }
  mx /= n
  my /= n
  nx /= n
  ny /= n
  let dot = 0, cross = 0, spread = 0
  for (let i = 0; i < n; i++) {
    const px = from[i]![0] - mx
    const py = from[i]![1] - my
    const qx = to[i]![0] - nx
    const qy = to[i]![1] - ny
    dot += px * qx + py * qy
    cross += px * qy - py * qx
    spread += px * px + py * py
  }
  if (spread === 0) return { a: 1, b: 0, tx: nx - mx, ty: ny - my }
  const a = dot / spread
  const b = cross / spread
  return { a, b, tx: nx - (a * mx - b * my), ty: ny - (b * mx + a * my) }
}

/** The face straightened into SFace's input: the frame warped so the landmarks land on the template, as RGB floats 0 to 255 in
 *  NCHW order. Outside the frame is black, as OpenCV's warp leaves it. */
export function alignedCrop(frame: Frame, landmarks: readonly Point[]): Float32Array {
  const { a, b, tx, ty } = similarity(landmarks, template)
  const det = a * a + b * b
  const plane = cropSize * cropSize
  const out = new Float32Array(3 * plane)
  const px = new Float32Array(3)
  for (let y = 0; y < cropSize; y++) {
    for (let x = 0; x < cropSize; x++) {
      // The inverse of the similarity, from the crop back into the frame.
      const dx = x - tx
      const dy = y - ty
      sample(frame, (a * dx + b * dy) / det, (a * dy - b * dx) / det, px, 'black')
      const i = y * cropSize + x
      out[i] = px[0]!
      out[plane + i] = px[1]!
      out[2 * plane + i] = px[2]!
    }
  }
  return out
}

/** The colour at a fractional position, blended from the four pixels around it. `outside` says what lies past the frame's edge. */
function sample(frame: Frame, x: number, y: number, into: Float32Array, outside: 'edge' | 'black') {
  const { data, width, height } = frame
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  into[0] = into[1] = into[2] = 0
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      let px = x0 + i
      let py = y0 + j
      const weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
      if (weight === 0) continue
      if (px < 0 || py < 0 || px >= width || py >= height) {
        if (outside === 'black') continue
        px = Math.min(width - 1, Math.max(0, px))
        py = Math.min(height - 1, Math.max(0, py))
      }
      const at = (py * width + px) * 4
      into[0]! += data[at]! * weight
      into[1]! += data[at + 1]! * weight
      into[2]! += data[at + 2]! * weight
    }
  }
}

/** The frame cut down so its longest side is at most `maxSide`, for when a picture is bigger than anything below needs. */
export function fits(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
