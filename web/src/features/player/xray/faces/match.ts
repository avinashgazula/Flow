/* Who a face is: its print compared with each actor's. A print is the 128 numbers SFace makes of a face, scaled to
   length 1, so two prints' dot product is their cosine similarity: near 1 for the same person, near 0 for strangers. */

import type { Box } from './geometry'

/** A face in the picture, with its print. */
export interface FoundFace {
  box: Box
  /** How sure the detector was that this is a face, 0 to 1. */
  score: number
  print: Float32Array
}

/** What is known of one actor: their TMDB id and the print of their profile photo. */
export interface CastPrint {
  id: number
  print: Float32Array
}

export interface FaceMatch {
  id: number
  face: FoundFace
  /** Cosine similarity with the actor's photo. */
  similarity: number
}

/** The least similarity that counts as a match. OpenCV publishes 0.363 for SFace on same-quality portraits. On the fixtures (26
 *  people, 488 pairs of strangers, 8 pairs of the same person) strangers reach 0.42, and that is two sisters; the weakest
 *  true pair, a small face in a crowd, is 0.56. A bar between them names no wrong actor, and a wrong name is worse than none. */
export const minSimilarity = 0.45
/** How far ahead of the next-nearest actor a match must be, so two actors who look alike aren't told apart by luck. */
export const minLead = 0.05

/** Scales a vector to length 1, in place and returned. A vector of zeros stays zeros, which matches nobody. */
export function normalise(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!
  const norm = Math.sqrt(sum)
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm
  return v
}

/** The cosine similarity of two unit-length prints. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!
  return dot
}

export interface MatchOptions {
  threshold?: number
  lead?: number
}

/** Names the faces: each face to the actor it resembles most, if that is at least `threshold` and clear of the runner-up by
 *  `lead`. An actor is only in the picture once, so when two faces pick the same actor the closer one keeps the name. The
 *  result runs from the left of the picture to the right. Faces that resemble nobody enough are simply left out. */
export function matchFaces(faces: FoundFace[], cast: CastPrint[], { threshold = minSimilarity, lead = minLead }: MatchOptions = {}): FaceMatch[] {
  const candidates: FaceMatch[] = []
  for (const face of faces) {
    let best: CastPrint | undefined
    let bestSimilarity = -Infinity
    let second = -Infinity
    for (const actor of cast) {
      const similarity = cosine(face.print, actor.print)
      if (similarity > bestSimilarity) {
        second = bestSimilarity
        best = actor
        bestSimilarity = similarity
      } else if (similarity > second) second = similarity
    }
    if (best && bestSimilarity >= threshold && bestSimilarity - second >= lead) candidates.push({ id: best.id, face, similarity: bestSimilarity })
  }
  const closest = new Map<number, FaceMatch>()
  for (const m of candidates) {
    const held = closest.get(m.id)
    if (!held || m.similarity > held.similarity) closest.set(m.id, m)
  }
  return [...closest.values()].sort((a, b) => a.face.box.x + a.face.box.width / 2 - (b.face.box.x + b.face.box.width / 2))
}
