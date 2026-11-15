import { episodeRef, formatBytes, isUnsafeFileName, normalizeTitle, parseStream, titleAndYear } from '../lib/sources/parser'
import { contract } from './support'

contract('source-parser', ({ op, input, expected }) => {
  switch (op) {
    case 'parse': {
      const traits = parseStream(...(input as (string | null)[])) as unknown as Record<string, unknown>
      // A case names the fields it checks; a field the website leaves out is null here.
      return Object.fromEntries(Object.keys(expected).map((key) => [key, traits[key] ?? null]))
    }
    case 'episodeRef':
      return episodeRef(input) ?? null
    case 'titleAndYear': {
      const parsed = titleAndYear(input)
      return { title: parsed.title, year: parsed.year ?? null }
    }
    case 'normalizeTitle':
      return normalizeTitle(input)
    case 'formatBytes':
      return formatBytes(input)
    case 'unsafeFile':
      return isUnsafeFileName(input)
    default:
      throw new Error(`unknown op ${op}`)
  }
})
