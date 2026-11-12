/* Whether this browser can run the universal media engine (lib/media): it needs Media Source Extensions and a
   sound format it can play in MP4 for converted audio (FLAC where it has it, else AAC). Asked once and kept, since
   ranking asks for every source. Tiny and import-free, because the first load reads it; the engine itself is not. */

let cached: boolean | undefined

/** What converted sound is encoded as here: FLAC in MP4 where the browser plays it, else AAC; null when neither plays. */
export function convertedSoundFormat(isSupported?: (mime: string) => boolean): { out: 'flac' | 'aac'; mime: string } | null {
  const ask =
    isSupported ??
    ((mime: string) => {
      try {
        const g = globalThis as { ManagedMediaSource?: { isTypeSupported(m: string): boolean }; MediaSource?: { isTypeSupported(m: string): boolean } }
        return !!(g.ManagedMediaSource ?? g.MediaSource)?.isTypeSupported(mime)
      } catch {
        return false
      }
    })
  if (ask('audio/mp4; codecs="flac"')) return { out: 'flac', mime: 'audio/mp4; codecs="flac"' }
  if (ask('audio/mp4; codecs="mp4a.40.2"')) return { out: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"' }
  return null
}

/** True when the engine can run here. */
export function canUseMediaEngine(): boolean {
  cached ??= typeof WebAssembly === 'object' && convertedSoundFormat() !== null
  return cached
}
