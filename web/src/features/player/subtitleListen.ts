/* Subtitle auto-sync's ears: listens to the soundtrack as it plays, through the same Web Audio graph Volume Boost
   uses, and asks lib/subtitles for the delay that puts the subtitles over the dialogue. Loaded only when the
   viewer asks for it.

   The audio is read on the audio thread (an AudioWorklet) and handed over in blocks of a few thousand samples, so
   nothing here runs per frame of video or touches React. */

import { ListenSession, listenSeconds } from '../../lib/subtitles/listen'
import type { CueSpan } from '../../lib/subtitles/sync'

export type Listened =
  | { kind: 'matched'; offset: number }
  | { kind: 'none' }
  /** The browser wouldn't let the page hear the video. */
  | { kind: 'deaf' }
  | { kind: 'cancelled' }

export interface Tap {
  context: AudioContext
  source: MediaElementAudioSourceNode
}

/** The worklet: the channels of each 128-sample quantum averaged to one, gathered into blocks. */
const worklet = `
class Mono extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(4096); this.at = 0 }
  process(inputs) {
    const input = inputs[0]
    if (input.length === 0) return true
    for (let i = 0; i < input[0].length; i++) {
      let sum = 0
      for (let c = 0; c < input.length; c++) sum += input[c][i]
      this.block[this.at++] = sum / input.length
      if (this.at === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer])
        this.block = new Float32Array(4096)
        this.at = 0
      }
    }
    return true
  }
}
registerProcessor('flow-mono', Mono)
`

/** How long to wait for a paused or stalled video to play before giving up. */
const patience = 3 * 60_000

/** Listens to `video` for up to a minute of playing. A pause, a seek, a stall or a speed change throws away what was
 *  heard (frames either side of a gap aren't in time with each other) and listening starts again when playback does.
 *  `progress` is called about once a second with the seconds still to listen. */
export async function listen({ tap, video, cues, signal, progress }: { tap: Tap; video: HTMLVideoElement; cues: readonly CueSpan[]; signal: AbortSignal; progress: (left: number) => void }): Promise<Listened> {
  const { context, source } = tap
  let node: AudioWorkletNode | undefined
  let mute: GainNode | undefined
  const cleanup: (() => void)[] = []
  try {
    const url = URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' }))
    try {
      await context.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    if (signal.aborted) return { kind: 'cancelled' }
    node = new AudioWorkletNode(context, 'flow-mono', { numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' })
    // Connected to the speakers through a gain of zero, so the browser keeps the node running without it being heard.
    mute = context.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute)
    mute.connect(context.destination)

    const session = new ListenSession(context.sampleRate, cues)
    const listening = () => !video.paused && !video.seeking && video.readyState >= 3 && video.playbackRate === 1
    let active = false
    let shown = -1

    return await new Promise<Listened>((resolve) => {
      const finish = (result: Listened) => resolve(result)
      const restart = () => {
        active = listening()
        if (active) session.begin(video.currentTime)
        shown = -1
      }
      for (const name of ['pause', 'seeking', 'waiting', 'stalled', 'ratechange', 'playing', 'seeked'] as const) {
        video.addEventListener(name, restart)
        cleanup.push(() => video.removeEventListener(name, restart))
      }
      const giveUp = window.setTimeout(() => finish({ kind: 'none' }), patience)
      cleanup.push(() => clearTimeout(giveUp))
      signal.addEventListener('abort', () => finish({ kind: 'cancelled' }), { once: true })
      // Where the worklet's first block starts is one block behind the clock the element reports; at 4096 samples that is under 0.1 s.
      node!.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!active) return
        const heard = session.push(e.data)
        const left = Math.max(0, Math.ceil(listenSeconds - session.heard))
        if (left !== shown) {
          shown = left
          progress(left)
        }
        if (heard.done) finish(heard.silent ? { kind: 'deaf' } : heard.match ? { kind: 'matched', offset: heard.match.offset } : { kind: 'none' })
      }
      restart()
    })
  } catch {
    return { kind: 'deaf' }
  } finally {
    cleanup.forEach((fn) => fn())
    if (node) node.port.onmessage = null
    // Taken out of the graph again; the element's own path to the speakers is untouched.
    try {
      if (node) source.disconnect(node)
      node?.disconnect()
      mute?.disconnect()
    } catch {
      // Already disconnected.
    }
  }
}
