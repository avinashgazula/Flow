/* Whether a film has a scene during or after its end credits, from TMDB's keywords "duringcreditsstinger" and
   "aftercreditsstinger" (CreditsScenes in FlowKit, which reads the same two). */

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
