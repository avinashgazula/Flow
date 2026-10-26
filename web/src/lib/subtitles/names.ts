import { baseLanguage, languageName } from '../language'

const knownCodes = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'tr', 'ru', 'el', 'he', 'ar', 'hi', 'th', 'id', 'vi', 'ja', 'ko', 'zh', 'ta', 'te', 'uk', 'hu', 'ro', 'bg', 'hr', 'sr', 'sk', 'fa', 'ms', 'bn']

/** "English" for "en", "Brazilian Portuguese" for "pt-BR"; the code in capitals when nobody knows it
 *  (FlowKit's SubtitleLanguages.name). */
export function subtitleLanguageName(code: string): string {
  return languageName(code) ?? code.toUpperCase()
}

/** The service's language field as a code: SubDL says "EN" in one field and "english" in the other,
 *  OpenSubtitles "pt-BR", Wyzie "en". A name is turned into its code where Flow knows it. */
export function languageCodeOf(...fields: (string | undefined | null)[]): string {
  for (const f of fields) {
    const v = f?.trim()
    if (v && /^[a-z]{2,3}([-_][a-z]{2,4})?$/i.test(v)) return v.replace('_', '-')
  }
  for (const f of fields) {
    const v = f?.trim().toLowerCase()
    if (!v) continue
    for (const code of knownCodes) if (languageName(code)?.toLowerCase() === v) return code
  }
  return fields.find((f) => f?.trim())?.trim().toLowerCase() ?? 'en'
}

/** The form two language codes are compared in: "pt-BR" and "por" and "pt" are one. */
export const languageKey = (code: string): string => baseLanguage(code) ?? code.toLowerCase().slice(0, 2)
