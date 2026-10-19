/* In-browser decoding for the audio browsers can't play: Dolby Digital (AC-3), Dolby Digital Plus
   (E-AC-3), DTS and Dolby TrueHD. FFmpeg's own decoders, built to a small WebAssembly module
   (pkg/flow-audio.wasm, rebuilt with `npm run audio-wasm`), turn compressed bytes into stereo PCM
   that Web Audio can play.

   const decoders = await loadAudioDecoders()
   const track = decoders.open('truehd')            // 48 kHz stereo out, whatever the source
   const pcm = track.decode(blockBytes)             // Float32Array, interleaved L R L R, possibly empty
   track.flush()                                    // after a seek
   track.close()

   Runs in a Web Worker or the page, and in Node (pass the module's bytes). The file is fetched by the
   first loadAudioDecoders call, so import this only on the path that plays such a track; nothing on
   first load should. */

export type AudioCodec = 'ac3' | 'eac3' | 'dts' | 'truehd'

export interface AudioStreamDecoder {
  /** Compressed bytes in, stereo float32 PCM out (a copy). Any slice of the elementary stream works: a
   *  Matroska block can hold several frames or half of one, and a partial frame waits for the next call. */
  decode(bytes: Uint8Array): Float32Array
  /** Forgets everything buffered. Call after a seek, before the first block of the new position. */
  flush(): void
  /** At the end of the stream: the last frame or two, which the decoder only knows are complete when more
   *  bytes arrive (or are told there are none). The stream is then ready for a new position, as after flush(). */
  finish(): Float32Array
  close(): void
  /** What the stream's first frame declares (a 7.1 TrueHD track says 8); 0 until a frame has been seen. */
  readonly sourceChannels: number
  /** The stream's own sample rate, before it was converted to the output rate; 0 until a frame has been decoded. */
  readonly sourceSampleRate: number
  /** Frames that failed to decode and were skipped, since the stream was opened. */
  readonly errors: number
}

export interface AudioDecoders {
  /** The output is always interleaved stereo at `sampleRate`, 48000 by default. */
  open(codec: AudioCodec, sampleRate?: number): AudioStreamDecoder
}

const CODEC_IDS: Record<AudioCodec, number> = { ac3: 1, eac3: 2, dts: 3, truehd: 4 }
// The keys fa_info understands.
const INFO_CHANNELS = 1
const INFO_RATE = 2
const INFO_ERRORS = 4

interface Exports {
  memory: WebAssembly.Memory
  fa_open(codec: number, outRate: number): number
  fa_input(handle: number, size: number): number
  fa_decode(handle: number, size: number): number
  fa_output(handle: number): number
  fa_flush(handle: number): void
  fa_finish(handle: number): number
  fa_info(handle: number, key: number): number
  fa_close(handle: number): void
}

/* WASI errno values the stubs hand back. */
const ENOSYS = 52

/* The module is built against WASI's libc, which asks the host for a few services. The current build
   asks for none, but a rebuild with another sysroot could, so every function the module declares gets
   a stub, read from the module itself so the set can change without touching this file. Most return
   ENOSYS ("not available"), which libc turns into an ordinary failed call; the ones that are cheap to
   answer honestly are answered. `memory` is only known once the module is instantiated. */
function wasiImports(module: WebAssembly.Module, memory: () => WebAssembly.Memory | undefined): WebAssembly.Imports {
  const stubs: Record<string, (...args: never[]) => unknown> = {
    proc_exit: (code: number) => {
      throw new Error(`The audio decoder stopped itself (exit ${code}).`)
    },
    sched_yield: () => 0,
    // No arguments and no environment: write the two counts as zero.
    args_sizes_get: (countPtr: number, sizePtr: number) => zeroPair(memory(), countPtr, sizePtr),
    environ_sizes_get: (countPtr: number, sizePtr: number) => zeroPair(memory(), countPtr, sizePtr),
    args_get: () => 0,
    environ_get: () => 0,
    clock_time_get: (_id: number, _precision: bigint, outPtr: number) => {
      const mem = memory()
      if (!mem) return ENOSYS
      new DataView(mem.buffer).setBigUint64(outPtr, BigInt(Math.round(performance.now() * 1e6)), true)
      return 0
    },
  }
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {}
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== 'function') throw new Error(`The audio decoder wants a ${entry.kind} called ${entry.module}.${entry.name}, which this loader can't provide.`)
    const namespace = (imports[entry.module] ??= {})
    namespace[entry.name] = stubs[entry.name] ?? (() => ENOSYS)
  }
  return imports
}

function zeroPair(memory: WebAssembly.Memory | undefined, a: number, b: number): number {
  if (!memory) return ENOSYS
  const view = new DataView(memory.buffer)
  view.setUint32(a, 0, true)
  view.setUint32(b, 0, true)
  return 0
}

/* One compiled module per source, shared by every instance. A failed load isn't kept, so the next try
   fetches again (a dropped connection on the first attempt shouldn't stick). */
const modules = new WeakMap<object, Promise<WebAssembly.Module>>()
let defaultModule: Promise<WebAssembly.Module> | undefined

async function compileFromURL(url: URL): Promise<WebAssembly.Module> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The audio decoder didn't download (${response.status}).`)
  try {
    // Compiles while it downloads, but only when the server says application/wasm.
    return await WebAssembly.compileStreaming(response.clone())
  } catch {
    return WebAssembly.compile(await response.arrayBuffer())
  }
}

function loadModule(source?: BufferSource | URL): Promise<WebAssembly.Module> {
  if (source === undefined) {
    // The literal form below is what lets the bundler find the file and give it a hashed name.
    return (defaultModule ??= compileFromURL(new URL('./pkg/flow-audio.wasm', import.meta.url)).catch((error) => {
      defaultModule = undefined
      throw error
    }))
  }
  let loading = modules.get(source)
  if (!loading) {
    loading = source instanceof URL ? compileFromURL(source) : WebAssembly.compile(source)
    loading.catch(() => modules.delete(source))
    modules.set(source, loading)
  }
  return loading
}

export async function loadAudioDecoders(source?: BufferSource | URL): Promise<AudioDecoders> {
  const module = await loadModule(source)
  let memory: WebAssembly.Memory | undefined
  const instance = await WebAssembly.instantiate(module, wasiImports(module, () => memory))
  const exports = instance.exports as unknown as Exports
  memory = exports.memory
  return {
    open(codec, sampleRate = 48000) {
      const handle = exports.fa_open(CODEC_IDS[codec], sampleRate)
      if (!handle) throw new Error(`The ${codec} decoder couldn't start (sample rate ${sampleRate}).`)
      return new Stream(exports, handle >>> 0)
    },
  }
}

class Stream implements AudioStreamDecoder {
  private handle: number

  constructor(
    private readonly wasm: Exports,
    handle: number,
  ) {
    this.handle = handle
  }

  decode(bytes: Uint8Array): Float32Array {
    const handle = this.live()
    if (bytes.length === 0) return new Float32Array(0)
    const input = this.wasm.fa_input(handle, bytes.length) >>> 0
    if (!input) throw new Error('The audio decoder ran out of memory.')
    // Memory may have grown inside that call, which detaches every earlier view, so look it up fresh each time.
    new Uint8Array(this.wasm.memory.buffer, input, bytes.length).set(bytes)
    return this.take(handle, this.wasm.fa_decode(handle, bytes.length))
  }

  /* Copies the frames a call produced out of WebAssembly memory, which the next call overwrites. */
  private take(handle: number, frames: number): Float32Array {
    if (frames < 0) throw new Error(frames === -2 ? 'The audio decoder ran out of memory.' : 'The audio decoder was handed a bad buffer.')
    if (frames === 0) return new Float32Array(0)
    return new Float32Array(this.wasm.memory.buffer, this.wasm.fa_output(handle) >>> 0, frames * 2).slice()
  }

  flush(): void {
    this.wasm.fa_flush(this.live())
  }

  finish(): Float32Array {
    const handle = this.live()
    return this.take(handle, this.wasm.fa_finish(handle))
  }

  close(): void {
    if (!this.handle) return
    this.wasm.fa_close(this.handle)
    this.handle = 0
  }

  get sourceChannels(): number {
    return this.handle ? this.wasm.fa_info(this.handle, INFO_CHANNELS) : 0
  }

  get sourceSampleRate(): number {
    return this.handle ? this.wasm.fa_info(this.handle, INFO_RATE) : 0
  }

  get errors(): number {
    return this.handle ? this.wasm.fa_info(this.handle, INFO_ERRORS) : 0
  }

  private live(): number {
    if (!this.handle) throw new Error('This audio decoder was closed.')
    return this.handle
  }
}
