/* Face recognition's own thread: the ONNX Runtime, the two models and everything slow. X-Ray's panel talks to it through
   client.ts and nothing else loads any of this, so the first page carries none of it. The runtime's WebAssembly file and
   the models are Flow's own files, fetched from the site: no third-party host is asked for anything. A cast photo is
   read here too (TMDB's image host allows it), so a face's pixels never need to pass through the page. */

import * as ort from 'onnxruntime-web/wasm'
import wasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import detectorUrl from './models/yunet.onnx?url'
import recogniserUrl from './models/sface-int8.onnx?url'
import { createEngine, type Engine } from './engine'
import type { Frame } from './geometry'
import type { FoundFace } from './match'

export type Request =
  | { id: number; type: 'init' }
  | { id: number; type: 'photo'; url: string }
  | { id: number; type: 'frame'; frame: Frame; limit: number }

export type Reply =
  | { id: number; ok: true; type: 'init'; loadMs: number }
  /** The print of the largest face in the photo, or null when the photo has none. */
  | { id: number; ok: true; type: 'photo'; print: Float32Array | null }
  | { id: number; ok: true; type: 'frame'; faces: FoundFace[]; ms: number }
  | { id: number; ok: false; message: string }

const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage(m: Reply, transfer?: Transferable[]): void }

let engine: Promise<Engine> | undefined

async function bytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Couldn’t load ${url.split('/').pop()} (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

function start(): Promise<Engine> {
  engine ??= (async () => {
    ort.env.wasm.wasmPaths = { wasm }
    ort.env.wasm.numThreads = 1
    const [detector, recogniser] = await Promise.all([bytes(detectorUrl), bytes(recogniserUrl)])
    return createEngine(ort, { detector, recogniser })
  })()
  // A failed start is tried again by the next request rather than remembered.
  engine.catch(() => (engine = undefined))
  return engine
}

/** A photo's pixels, at the size it comes. TMDB's image host answers with `Access-Control-Allow-Origin: *`, which is what lets them be read. */
async function photo(url: string): Promise<Frame> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!response.ok) throw new Error(`Couldn’t load the photo (${response.status})`)
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0)
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { data, width, height }
  } finally {
    bitmap.close()
  }
}

scope.onmessage = async ({ data: req }) => {
  try {
    if (req.type === 'init') {
      const t = performance.now()
      await start()
      scope.postMessage({ id: req.id, ok: true, type: 'init', loadMs: Math.round(performance.now() - t) })
    } else if (req.type === 'photo') {
      const [e, frame] = await Promise.all([start(), photo(req.url)])
      // A profile photo is of one person, so the largest face in it is theirs; a smaller one is someone behind them.
      const [face] = await e.faces(frame, { limit: 1, scoreThreshold: 0.8 })
      scope.postMessage({ id: req.id, ok: true, type: 'photo', print: face?.print ?? null }, face ? [face.print.buffer] : [])
    } else {
      const e = await start()
      const t = performance.now()
      const faces = await e.faces(req.frame, { limit: req.limit })
      scope.postMessage({ id: req.id, ok: true, type: 'frame', faces, ms: Math.round(performance.now() - t) }, faces.map((f) => f.print.buffer))
    }
  } catch (error) {
    scope.postMessage({ id: req.id, ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}
