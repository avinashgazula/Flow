/* Language codes as streams, add-ons and TMDB each write them ("eng", "en-US", "en"), compared and
   named in one place so the player, Settings and source ranking agree. */

const threeLetter: Record<string, string> = {
  eng: 'en', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh',
  rus: 'ru', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', nob: 'no', nno: 'no', dan: 'da', fin: 'fi', pol: 'pl', tur: 'tr', ara: 'ar', heb: 'he', hin: 'hi',
  gre: 'el', ell: 'el', cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro', tha: 'th', vie: 'vi', ind: 'id', ukr: 'uk', cmn: 'zh', yue: 'zh',
  tam: 'ta', tel: 'te', ben: 'bn', mal: 'ml', kan: 'kn', mar: 'mr', pan: 'pa', urd: 'ur', fas: 'fa', per: 'fa', cat: 'ca', hrv: 'hr', srp: 'sr',
  bul: 'bg', slk: 'sk', slo: 'sk', msa: 'ms', may: 'ms', fil: 'tl', tgl: 'tl',
}

const undetermined = new Set(['und', 'unk', 'mis', 'zxx', 'mul'])

/** "en" for "en", "eng", "en-US" or "EN_gb": the language without its region, in two letters when
 *  it has them. Undefined for nothing and for "und" (undetermined), which names no language. */
export function baseLanguage(code?: string): string | undefined {
  if (!code) return undefined
  const base = code.trim().toLowerCase().split(/[-_]/)[0]!
  if (!base || undetermined.has(base)) return undefined
  return threeLetter[base] ?? base
}

export const sameLanguage = (a?: string, b?: string): boolean => {
  const x = baseLanguage(a)
  return !!x && x === baseLanguage(b)
}

let names: Intl.DisplayNames | undefined

/** "English" for "en", "eng" or "en-US"; undefined for "und" and codes nobody knows. */
export function languageName(code?: string): string | undefined {
  if (!code || !baseLanguage(code)) return undefined
  const base = code.split(/[-_]/)[0]!.toLowerCase()
  const tag = threeLetter[base] ? code.replace(/^[a-z]{3}/i, threeLetter[base]!) : code
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'language' })
    const name = names.of(tag)
    return name && name.toLowerCase() !== tag.toLowerCase() ? name : undefined
  } catch {
    return undefined
  }
}

/** The two-letter code for an English language name ("Hindi" gives "hi"), the way releases name
 *  languages. Undefined for names that aren't one language ("Multi"). */
export function languageCode(name: string): string | undefined {
  const wanted = name.trim().toLowerCase()
  for (const code of new Set(Object.values(threeLetter))) if (languageName(code)?.toLowerCase() === wanted) return code
  return undefined
}

/** The audio languages in order with 'original' replaced by the title's own language. Titles whose
 *  original language isn't known just lose that entry. */
export function resolveAudioLanguages(list: string[], original?: string): string[] {
  const out: string[] = []
  for (const entry of list) {
    const code = entry === 'original' ? baseLanguage(original) : baseLanguage(entry)
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}
