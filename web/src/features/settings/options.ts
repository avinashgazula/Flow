import type { FontChoice } from '../../lib/store/settings'

/* The choices the pickers offer. TMDB takes any ISO language-region pair; these are the common ones,
   and a saved value that isn't listed is added so it never silently changes. */

export const languages: { value: string; label: string }[] = [
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Spanish (Spain)'], ['es-MX', 'Spanish (Mexico)'], ['fr-FR', 'French'],
  ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'], ['nl-NL', 'Dutch'],
  ['sv-SE', 'Swedish'], ['da-DK', 'Danish'], ['nb-NO', 'Norwegian'], ['fi-FI', 'Finnish'], ['pl-PL', 'Polish'], ['cs-CZ', 'Czech'],
  ['tr-TR', 'Turkish'], ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['el-GR', 'Greek'], ['he-IL', 'Hebrew'], ['ar-SA', 'Arabic'],
  ['hi-IN', 'Hindi'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['th-TH', 'Thai'], ['id-ID', 'Indonesian'], ['vi-VN', 'Vietnamese'],
  ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
].map(([value, label]) => ({ value: value!, label: label! }))

export const regions: { value: string; label: string }[] = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['IE', 'Ireland'],
  ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['CH', 'Switzerland'],
  ['AT', 'Austria'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'], ['PT', 'Portugal'],
  ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['IN', 'India'], ['JP', 'Japan'], ['KR', 'South Korea'], ['SG', 'Singapore'],
  ['ZA', 'South Africa'], ['AE', 'United Arab Emirates'], ['TR', 'Türkiye'],
].map(([value, label]) => ({ value: value!, label: label! }))

/** Subtitle languages as two-letter codes, which is what the subtitle tracks and add-ons carry. */
export const subtitleChoices: { value: string; label: string }[] = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'],
  ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['pl', 'Polish'], ['cs', 'Czech'], ['tr', 'Turkish'],
  ['ru', 'Russian'], ['el', 'Greek'], ['he', 'Hebrew'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['th', 'Thai'], ['id', 'Indonesian'],
  ['vi', 'Vietnamese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
].map(([value, label]) => ({ value: value!, label: label! }))

/** The list with the current value present, so an unusual saved choice still shows. */
export function withCurrent(list: { value: string; label: string }[], current: string) {
  return list.some((o) => o.value === current) ? list : [{ value: current, label: current }, ...list]
}

/** The typefaces Appearance offers, in the order shown. The sample text is set in each one. */
export const typefaces: { value: FontChoice; label: string; detail: string }[] = [
  { value: 'system', label: 'System', detail: 'SF Pro on Apple devices, Segoe on Windows. Nothing to download.' },
  { value: 'inter', label: 'Inter', detail: 'Clean and neutral, made for screens.' },
  { value: 'geist', label: 'Geist', detail: 'Precise and modern.' },
  { value: 'manrope', label: 'Manrope', detail: 'Rounded and friendly.' },
  { value: 'ioskeley', label: 'Ioskeley Mono', detail: 'Monospaced, with character.' },
]
