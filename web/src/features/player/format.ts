/* Words and numbers the player shows, kept free of the DOM so they can be tested. */

/** "4:05", or "1:02:13" past the hour, as TimeFormat.clock does in the apps. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "S1 E2 · Pilot" under the title, or just "S1 E2" before the episode's name is known. */
export function episodeLine(season?: number, episode?: number, name?: string): string | undefined {
  if (season === undefined || episode === undefined) return undefined
  return name ? `S${season} E${episode} · ${name}` : `S${season} E${episode}`
}

const threeLetter: Record<string, string> = {
  eng: 'en', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh',
  rus: 'ru', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', pol: 'pl', tur: 'tr', ara: 'ar', heb: 'he', hin: 'hi',
  gre: 'el', ell: 'el', cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro', tha: 'th', vie: 'vi', ind: 'id', ukr: 'uk', cmn: 'zh',
}

let names: Intl.DisplayNames | undefined

/** "English" for "en", "eng" or "en-US"; undefined for "und" and codes nobody knows. */
export function languageName(code?: string): string | undefined {
  if (!code) return undefined
  const lower = code.toLowerCase()
  if (lower === 'und' || lower === 'unk' || lower === 'mis') return undefined
  const base = lower.split(/[-_]/)[0]!
  const tag = threeLetter[base] ? code.replace(/^[a-z]{3}/i, threeLetter[base]!) : code
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'language' })
    const name = names.of(tag)
    return name && name.toLowerCase() !== tag.toLowerCase() ? name : undefined
  } catch {
    return undefined
  }
}

export function channelsLabel(channels?: number | string): string | undefined {
  const n = typeof channels === 'string' ? Number.parseInt(channels, 10) : channels
  if (!n || !Number.isFinite(n)) return undefined
  if (n === 1) return 'Mono'
  if (n === 2) return 'Stereo'
  if (n === 6) return '5.1'
  if (n === 8) return '7.1'
  return `${n} channels`
}

/** A track's name as a person would say it. Streams often label tracks "stream_5" or "Track 2",
 *  which says nothing, so the language stands in for names like that. */
export function trackLabel({ name, language, channels, forced }: { name?: string; language?: string; channels?: number | string; forced?: boolean }): string {
  const generic = !name || /^(stream|track|audio|subtitle|text)?[\s_-]*\d+$/i.test(name.trim()) || name.trim().toLowerCase() === language?.toLowerCase()
  let label = (generic ? languageName(language) : name!.trim()) ?? name?.trim() ?? 'Unknown'
  if (forced && !/forced/i.test(label)) label += ' (Forced)'
  const ch = channelsLabel(channels)
  return ch && ch !== 'Stereo' ? `${label} · ${ch}` : label
}

export const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
export const speedLabel = (rate: number) => (rate === 1 ? 'Normal' : `${rate}×`)

export function fileSize(bytes?: number): string | undefined {
  if (!bytes || bytes <= 0) return undefined
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}
