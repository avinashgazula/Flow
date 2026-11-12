/* How big a picture is worth converting, and what is refused whatever its size. Tiny and import-free: ranking and the
   track plan both read it, and neither should pull the engine in. */

/** The most pixels in a picture that is worth decoding in WebAssembly and encoding again as it plays: 1080p, with room for
 *  the wider cuts (2560x1080). A phone or a laptop can't do real time beyond that in software, and a slideshow helps nobody. */
export const MAX_CONVERT_PIXELS = 2_950_000

/** Why a picture can't be converted here, or null when it can. `hdr`: PQ or HLG, which an 8-bit SDR copy would wash out. */
export function convertRefusal(picture: { width?: number; height?: number; hdr?: boolean }): 'size' | 'hdr' | null {
  if ((picture.width ?? 0) * (picture.height ?? 0) > MAX_CONVERT_PIXELS) return 'size'
  if (picture.hdr) return 'hdr'
  return null
}
