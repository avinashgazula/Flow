/* A title's logo art, as TMDB's `images.logos`: the wordmark a title is known by, a transparent PNG (or SVG) set over
   artwork in place of its name. Lists don't carry it, so Home's lead asks for it by itself (api.logo) and a title page
   reads it from the answer it already has (detail.ts). */

interface RawLogo {
  file_path: string
  iso_639_1?: string | null
  vote_average?: number
}

/** `include_image_language` for the images endpoint: the viewer's language, English, then the logos with no language
 *  at all, which is how TMDB files a wordmark that is the same everywhere. */
export function logoLanguages(language: string): string {
  const own = language.slice(0, 2).toLowerCase() || 'en'
  return own === 'en' ? 'en,null' : `${own},en,null`
}

/** The logo to use: the viewer's language first, then English, then one with no language; the best voted of each. */
export function bestLogo(logos: RawLogo[] | undefined, language: string): string | undefined {
  if (!logos?.length) return undefined
  const own = language.slice(0, 2).toLowerCase()
  const score = (l: RawLogo) => (l.iso_639_1 === own ? 3 : l.iso_639_1 === 'en' ? 2 : l.iso_639_1 == null ? 1 : 0) + (l.vote_average ?? 0) / 100
  return [...logos].sort((a, b) => score(b) - score(a))[0]?.file_path
}
