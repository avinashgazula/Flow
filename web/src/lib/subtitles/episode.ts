/* Season and episode from a release or file name (S01E02, 1x02, "Season 1 Episode 2"). The same three patterns as
   lib/sources/parser.ts's episodeRef, kept here so the subtitle code (loaded with the player) doesn't join the
   first page's chunk graph by importing the parser; episode.test.ts holds the two together. */
export function episodeIn(name: string): { season: number; episode: number } | undefined {
  const lower = name.toLowerCase()
  for (const pattern of [/s(\d{1,2})[ ._-]?e(\d{1,3})/, /\b(\d{1,2})x(\d{2,3})\b/, /season[ ._-]?(\d{1,2})[ ._-]*episode[ ._-]?(\d{1,3})/]) {
    const m = pattern.exec(lower)
    if (m) return { season: Number(m[1]), episode: Number(m[2]) }
  }
  return undefined
}
