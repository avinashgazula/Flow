import type { Frame } from './geometry'
import type { FoundFace } from './match'
import type { Reply, Request } from './worker'

/* The page's end of the face worker: one worker for the visit, started the first time X-Ray recognises a face, and a
   request that waits for its answer. When X-Ray has been closed for a while the worker is let go, which frees the
   models' memory. */

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never
type Ask = Distribute<Request>

let worker: Worker | undefined
let next = 1
let idle = 0
const waiting = new Map<number, { resolve: (r: Reply & { ok: true }) => void; reject: (e: Error) => void }>()

/** How long the worker is kept with nothing to do. */
const keepMs = 120_000

function open(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<Reply>) => {
    const call = waiting.get(data.id)
    if (!call) return
    waiting.delete(data.id)
    if (data.ok) call.resolve(data)
    else call.reject(new Error(data.message))
  }
  w.onerror = (e) => {
    // The worker couldn't start (an old browser, a blocked file): every request waiting on it fails, and the next one tries afresh.
    const error = new Error(e.message || 'The face recogniser couldn’t start.')
    for (const call of waiting.values()) call.reject(error)
    waiting.clear()
    w.terminate()
    if (worker === w) worker = undefined
  }
  worker = w
  return w
}

type Ok = Extract<Reply, { ok: true }>

function call<T extends Ok['type']>(ask: Ask, transfer: Transferable[] = []): Promise<Extract<Ok, { type: T }>> {
  clearTimeout(idle)
  const id = next++
  const w = open()
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (r: Reply & { ok: true }) => void, reject })
    w.postMessage({ ...ask, id }, transfer)
  }).finally(() => {
    if (waiting.size === 0) {
      idle = window.setTimeout(() => {
        worker?.terminate()
        worker = undefined
      }, keepMs)
    }
  }) as Promise<Extract<Ok, { type: T }>>
}

/** Downloads and starts the models. Resolves with how long that took, in milliseconds. */
export const load = () => call<'init'>({ type: 'init' }).then((r) => r.loadMs)

/** The print of the largest face in a photo at `url`, or null when it has none. */
export const printOfPhoto = (url: string) => call<'photo'>({ type: 'photo', url }).then((r) => r.print)

/** The faces in a frame, biggest first, with their prints. The frame's pixels are handed over, not copied. */
export const facesIn = (frame: Frame, limit = 12) =>
  call<'frame'>({ type: 'frame', frame, limit }, [frame.data.buffer]).then((r): { faces: FoundFace[]; ms: number } => ({ faces: r.faces, ms: r.ms }))
