/* Whether a film has a scene during or after its end credits, from TMDB's keywords "duringcreditsstinger" and
   "aftercreditsstinger" (CreditsScenes in FlowKit, which reads the same two). */

import { tmdb } from './client'

export interface CreditsScenes {
  during: boolean
  after: boolean
}

/** The scenes the keywords name, or undefined when there are none (the usual film). */
export function creditsScenesFrom(keywords: string[]): CreditsScenes | undefined {
  const names = new Set(keywords.map((k) => k.toLowerCase()))
  const scenes = { during: names.has('duringcreditsstinger'), after: names.has('aftercreditsstinger') }
  return scenes.during || scenes.after ? scenes : undefined
}

/** What the player says as the credits begin, in the apps' words. */
export function creditsAlert({ during, after }: CreditsScenes): string {
  if (during && after) return 'Stay for the credits: there’s a scene during them, and another at the very end.'
  if (during) return 'Stay for the credits: there’s a scene partway through them.'
  return 'Stay until the end: there’s a scene after the credits.'
}

/** A film's scenes during and after its credits, from TMDB's keywords for the film. Asked for only once a film is
 *  playing, so the title page's one request stays as it was. Null for the usual film, which has none. */
export async function filmCreditsScenes(id: number): Promise<CreditsScenes | null> {
  const raw = await tmdb(`/movie/${id}/keywords`)
  return creditsScenesFrom((raw.keywords ?? []).map((k: { name: string }) => k.name)) ?? null
}
