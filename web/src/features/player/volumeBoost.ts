/* Volume Boost: extra loudness, in whole decibels, for a quiet soundtrack (the apps' `volumeBoostDB`). The
   apps give back headroom a Dolby Digital mix holds in reserve; a browser has no such thing to give, so the
   page raises the level with a Web Audio gain, through a gentle limiter so a loud scene doesn't crackle.

   Routing a <video> through Web Audio has a catch: if the media isn't same-origin or CORS-clean, the browser
   plays silence instead. So the option is offered only where that can't happen (the remuxer's and hls.js's
   own MediaSource streams, and files from this site's own address), and the graph is built only once the
   audio context is known to be running, so turning the boost on can never take the sound away. */

export const boostRange = { min: 0, max: 12, step: 1 } as const

export const clampBoost = (db: number): number => (Number.isFinite(db) ? Math.min(boostRange.max, Math.max(boostRange.min, Math.round(db))) : 0)
export const boostLabel = (db: number): string => (db > 0 ? `+${db} dB` : 'Off')
/** Decibels of voltage gain to the multiplier Web Audio wants. */
export const dbToGain = (db: number): number => 10 ** (db / 20)

/** Whether this stream can go through Web Audio without being silenced: engines that play through
 *  MediaSource hold bytes the page fetched itself (so they are CORS-clean by construction); a plain file or
 *  native HLS is played from its own address, which counts only when that is this page's origin. */
export function canBoost({ engine, blocked, url, origin }: { engine: 'native' | 'hls' | 'remux'; blocked: boolean; url: string; origin: string }): boolean {
  if (blocked) return false
  if (engine === 'remux' || engine === 'hls') return true
  try {
    return new URL(url, origin).origin === origin
  } catch {
    return false
  }
}

type AudioContextCtor = typeof AudioContext

export class VolumeBoost {
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  /** The element is wired into a graph and can't be taken out again; the level at 0 dB is a plain pass-through. */
  private wired = false
  private failed = false
  private wiring: Promise<boolean> | null = null
  private db = 0

  constructor(
    private video: HTMLVideoElement,
    private Context: AudioContextCtor | undefined = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext),
  ) {}

  /** Web Audio exists here and nothing has gone wrong with it. */
  get supported() {
    return !!this.Context && !this.failed
  }

  /** The element is routed through the graph: a boost is in effect (or 0 dB passes it through). */
  get active() {
    return this.wired
  }

  /** Sets the boost. Turning it on the first time builds the graph (it should come from a tap or a click, so
   *  the browser lets the audio context run); 0 dB before that costs nothing and builds nothing. */
  async set(db: number): Promise<void> {
    this.db = clampBoost(db)
    if (!this.wired) {
      if (this.db === 0) return
      if (!(await this.wire())) return
    }
    this.apply()
  }

  /** Resumes the context after the browser suspended it (a phone call, a tab in the background); called when playback starts. */
  resume() {
    if (this.context?.state === 'suspended' || (this.context?.state as string) === 'interrupted') void this.context?.resume().catch(() => {})
  }

  private apply() {
    const { context, gain, limiter } = this
    if (!context || !gain) return
    gain.gain.value = dbToGain(this.db)
    // At 0 dB the sound goes straight out, untouched by the limiter.
    gain.disconnect()
    gain.connect(this.db === 0 || !limiter ? context.destination : limiter)
  }

  private wire(): Promise<boolean> {
    this.wiring ??= (async () => {
      if (!this.Context) return false
      let context: AudioContext | undefined
      try {
        context = new this.Context()
        await context.resume().catch(() => {})
        // A context that won't run would mute the element for good once it is wired in: don't. Browsers
        // start one only from a tap or key press, so this is tried again at the next.
        if (context.state !== 'running') {
          void context.close().catch(() => {})
          this.wiring = null
          return false
        }
        const source = context.createMediaElementSource(this.video)
        const gain = context.createGain()
        // From here the element's sound only reaches the speakers through this graph, so it is complete
        // (a plain pass-through) before anything else is done to it.
        source.connect(gain)
        gain.connect(context.destination)
        this.context = context
        this.gain = gain
        this.wired = true
        try {
          const limiter = context.createDynamicsCompressor()
          // A limiter more than a compressor: it only catches what would clip.
          limiter.threshold.value = -3
          limiter.knee.value = 4
          limiter.ratio.value = 20
          limiter.attack.value = 0.003
          limiter.release.value = 0.25
          limiter.connect(context.destination)
          this.limiter = limiter
        } catch {
          // Without the limiter the boost is still the same gain.
        }
        return true
      } catch {
        this.failed = true
        void context?.close().catch(() => {})
        return false
      }
    })()
    return this.wiring
  }
}
