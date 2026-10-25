/* ASS and SSA subtitles drawn the way their author styled them (Settings → Playback → Keep Original ASS
   Styling), by libass compiled to WebAssembly through JASSUB. Writing a renderer of our own would be writing
   part of libass (styles, overrides, borders and blur, clips, drawings, karaoke), and the apps' own ASS parser
   skips most of that; JASSUB is that work done and kept up.

   What it costs, from the production build: JASSUB 2.5.18 (pinned; released well over two weeks ago) is 11 KB of
   script, a 30 KB worker, a 2.2 MB WebAssembly module (SIMD build; 2.1 MB for browsers without SIMD) and a 146 KB
   default font: about 1.1 MB over the wire gzipped, for the first ASS track shown with the setting on. All of it
   sits in chunks that only this file imports, and this file is only imported then, so a first visit, a film
   without ASS and everyone who leaves the setting off download none of it. The service worker doesn't precache
   it (it is over 300 KB, and wasm); it is stored the first time it is used.

   Fonts: only the default one is shipped. Local fonts are not queried (Chrome asks the viewer for permission
   when a page does), so a script that names a font the browser can't supply is drawn in the default font, with
   its colours, size, borders and placement intact. */

export interface AssHandle {
  /** Shifts the subtitles later by this many seconds (negative is earlier), for the player's subtitle delay. */
  setDelay(seconds: number): void
  destroy(): void
}

/** Whether this browser can run libass at all: it needs workers, WebAssembly and a canvas a worker can draw on. */
export const assSupported = (): boolean => typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype

/** Starts drawing `script` over the video. Resolves once libass has the script and its fonts. */
export async function startAss(video: HTMLVideoElement, script: string, delay = 0): Promise<AssHandle> {
  if (!assSupported()) throw new Error('This browser can’t draw ASS styling.')
  const { default: JASSUB } = await import('jassub')
  const instance = new JASSUB({ video, subContent: script, queryFonts: false, timeOffset: -delay })
  try {
    await instance.ready
  } catch (error) {
    void instance.destroy().catch(() => {})
    throw error
  }
  return {
    setDelay: (seconds) => {
      instance.timeOffset = -seconds
    },
    destroy: () => void instance.destroy().catch(() => {}),
  }
}
