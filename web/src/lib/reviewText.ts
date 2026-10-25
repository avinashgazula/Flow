/* Review text as people wrote it, ported from FlowKit's ReviewText. TMDB and Trakt pass on HTML entities, tags
   and Markdown ("&amp;", "<em>", "**great**", "[link](https://…)"), which read as noise in plain text. Cleaning
   keeps the words and leaves ordinary text alone ("snake_case_names", "2 * 3 * 4", "a < b").
   Spoiler tags are not cleaned away: `[spoiler]…[/spoiler]` stays in the text, and `spoilerParts` splits it so
   the page can hide those words until they are asked for. */

const named: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
}

/** "&amp;", "&#39;", "&#x2014;" and the named ones above. An entity it doesn't know is kept as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
    }
    return named[name.toLowerCase()] ?? whole
  })
}

const isWord = (c: string) => /\w/.test(c)

/** Replaces each match of `re` with its first group, unless the character before the match is one `bad` refuses:
 *  the lookbehind the apps use, spelled out so older browsers read it too. */
function unwrapUnless(text: string, re: RegExp, bad: (before: string) => boolean): string {
  return text.replace(re, (whole: string, inner: string, offset: number) => {
    const before = offset > 0 ? text[offset - 1]! : ''
    return before && bad(before) ? whole : inner
  })
}

export function cleanReview(raw: string): string {
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    // [words](https://…) keeps the words.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    // **bold** and __bold__ keep their words.
    .replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2')
  // *italic* and _italic_, but not the stars in "2 * 3 * 4" or the underscores in "snake_case_names".
  text = unwrapUnless(text, /\*(\S(?:[^*]*?\S)?)\*(?![\w*])/g, (c) => isWord(c) || c === '*')
  text = unwrapUnless(text, /_(\S(?:[^_]*?\S)?)_(?!\w)/g, isWord)
  text = decodeEntities(text)
  // Paragraph breaks at most one blank line apart.
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export interface SpoilerPart {
  text: string
  /** Inside a `[spoiler]` tag: hidden until asked for. */
  spoiler: boolean
}

/** The text in order, with what sits between `[spoiler]` and `[/spoiler]` marked. The tags themselves are dropped.
 *  A tag that is never closed hides the rest of the text, since the writer meant it that way. */
export function spoilerParts(text: string): SpoilerPart[] {
  const parts: SpoilerPart[] = []
  const re = /\[spoilers?\]([\s\S]*?)(?:\[\/spoilers?\]|$)/gi
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ text: text.slice(last, at), spoiler: false })
    if (m[1]) parts.push({ text: m[1], spoiler: true })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), spoiler: false })
  return parts.length ? parts : [{ text, spoiler: false }]
}

/** Dollar amounts the way a film's page prints them: "$80M", "$120.4M". As FlowKit's CompactMoney. */
export function compactMoney(dollars: number): string {
  const scaled = (value: number, suffix: string) => `$${Math.round(value * 10) / 10}${suffix}`
  if (dollars >= 1e9) return scaled(dollars / 1e9, 'B')
  if (dollars >= 1e6) return scaled(dollars / 1e6, 'M')
  if (dollars >= 1e3) return scaled(dollars / 1e3, 'K')
  return `$${dollars}`
}
