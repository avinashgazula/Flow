import type * as Ort from 'onnxruntime-web'
import { alignedCrop, cropSize, decodeDetections, detectorInput, type Detection, type DetectorOutputs, type Frame } from './geometry'
import { normalise, type FoundFace } from './match'

/* The two models, run: YuNet finds the faces in a frame, SFace turns each into a print. It takes the ONNX Runtime as an
   argument, so the worker hands it the browser's WebAssembly build and a test hands it Node's, and neither is imported here. */

export type Runtime = typeof Ort
type Model = Uint8Array | string

export interface Models {
  detector: Model
  recogniser: Model
}

export interface Engine {
  /** The faces in a frame, strongest first. */
  detect(frame: Frame): Promise<Detection[]>
  /** The print of one detected face, scaled to length 1. */
  print(frame: Frame, face: Detection): Promise<Float32Array>
  /** The faces in a frame with their prints, the biggest first: at most `limit` of them, none under `minSize` pixels across, since
   *  a print of a face that small says little. */
  faces(frame: Frame, options?: { scoreThreshold?: number; limit?: number; minSize?: number }): Promise<FoundFace[]>
}

const names = {
  cls: ['cls_8', 'cls_16', 'cls_32'],
  obj: ['obj_8', 'obj_16', 'obj_32'],
  bbox: ['bbox_8', 'bbox_16', 'bbox_32'],
  kps: ['kps_8', 'kps_16', 'kps_32'],
} as const

export async function createEngine(ort: Runtime, models: Models): Promise<Engine> {
  // One thread: a page without cross-origin isolation can't share memory between threads, and these models are small.
  const options: Ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }
  const [detector, recogniser] = await Promise.all([ort.InferenceSession.create(models.detector as Uint8Array, options), ort.InferenceSession.create(models.recogniser as Uint8Array, options)])

  const detect = async (frame: Frame, scoreThreshold?: number) => {
    const { tensor, width, height, scale } = detectorInput(frame)
    const out = await detector.run({ input: new ort.Tensor('float32', tensor, [1, 3, height, width]) })
    const grab = (list: readonly string[]) => list.map((n) => out[n]!.data as Float32Array) as [Float32Array, Float32Array, Float32Array]
    const outputs: DetectorOutputs = { cls: grab(names.cls), obj: grab(names.obj), bbox: grab(names.bbox), kps: grab(names.kps) }
    return decodeDetections(outputs, width, height, scale, scoreThreshold)
  }

  const print = async (frame: Frame, face: Detection) => {
    const out = await recogniser.run({ data: new ort.Tensor('float32', alignedCrop(frame, face.landmarks), [1, 3, cropSize, cropSize]) })
    // The output buffer belongs to the session and is reused, so the print is copied out before it is scaled.
    return normalise(Float32Array.from(out.fc1!.data as Float32Array))
  }

  return {
    detect: (frame) => detect(frame),
    print,
    async faces(frame, { scoreThreshold, limit = 12, minSize = 28 } = {}) {
      const found = (await detect(frame, scoreThreshold))
        .filter((d) => Math.min(d.box.width, d.box.height) >= minSize)
        .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
        .slice(0, limit)
      const faces: FoundFace[] = []
      for (const d of found) faces.push({ box: d.box, score: d.score, print: await print(frame, d) })
      return faces
    },
  }
}
