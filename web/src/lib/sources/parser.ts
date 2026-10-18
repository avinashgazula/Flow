/* Quality traits from free-form stream text: add-on titles, file names, server media info.
   A port of FlowKit's StreamParser, so a release reads the same in the browser as on Apple TV. */

/** VideoResolution in FlowKit, by its pixel height (0 when unknown). */
export type ResolutionClass = 0 | 480 | 720 | 1080 | 1440 | 2160

/** Ordered worst first, as FlowKit's ReleaseQuality. */
export const releaseQualities = ['CAM', 'TS', 'TC', 'SCR', 'Unknown', 'HDTV', 'WEBRip', 'WEB-DL', 'BluRay', 'REMUX'] as const
export type ParsedQuality = (typeof releaseQualities)[number]

export interface StreamTraits {
  resolution: ResolutionClass
  quality: ParsedQuality
  videoCodec?: string
  hdr: string[]
  /** The leading audio format, as FlowKit picks it. */
  audioCodec?: string
  /** Every audio format named, so a release with DTS *and* AAC isn't written off as DTS-only. */
  audioCodecs: string[]
  audioChannels?: string
  sizeBytes?: number
  languages: string[]
  releaseGroup?: string
  isCached?: boolean
  seeders?: number
  bitDepth?: number
}

const test = (pattern: string, text: string) => new RegExp(pattern, 'i').test(text)

function first(pattern: string, text: string): string | undefined {
  const match = new RegExp(pattern, 'i').exec(text)
  if (!match) return undefined
  return match.length > 1 ? match[1] : match[0]
}

/** Joins the pieces (name, description, file name) on separate lines and parses them together. */
export function parseStream(...texts: (string | undefined | null)[]): StreamTraits {
  const text = texts.filter((t): t is string => typeof t === 'string').join('\n')
  const lower = text.toLowerCase()
  const audioCodecs = allAudioCodecs(lower)
  const t: StreamTraits = {
    resolution: resolution(lower),
    quality: quality(lower),
    videoCodec: videoCodec(lower),
    hdr: hdr(lower),
    audioCodec: audioCodec(lower),
    audioCodecs,
    audioChannels: first(String.raw`(?<!\d)([257]\.[01])(?!\d)`, lower),
    sizeBytes: parseSize(text),
    languages: languages(lower),
    isCached: cached(text),
    seeders: numberOrUndefined(first(String.raw`(?:👤|seeders?:?|seeds?:?)\s*(\d+)`, lower)),
  }
  if (test(String.raw`\b10[ -]?bit\b`, lower)) t.bitDepth = 10
  const fileLine = lower.split('\n').find((l) => l.includes('.mkv') || l.includes('.mp4')) ?? ''
  t.releaseGroup = first(String.raw`-([a-z0-9]{2,12})(?:\.(?:mkv|mp4|avi|m4v|ts))?\s*$`, fileLine)
  return t
}

const numberOrUndefined = (s?: string) => (s === undefined ? undefined : Number(s))

function resolution(s: string): ResolutionClass {
  if (test(String.raw`\b(2160p|4k|uhd)\b`, s) || s.includes('✨ 4k')) return 2160
  if (test(String.raw`\b1440p\b`, s)) return 1440
  if (test(String.raw`\b(1080p|1080i|fhd)\b`, s)) return 1080
  if (test(String.raw`\b720p\b`, s)) return 720
  if (test(String.raw`\b(480p|576p|360p|sd|dvdrip)\b`, s)) return 480
  return 0
}

function quality(s: string): ParsedQuality {
  if (test(String.raw`\bremux\b`, s)) return 'REMUX'
  if (test(String.raw`\b(blu-?ray|bdrip|brrip|bdremux|bd25|bd50)\b`, s)) return 'BluRay'
  if (test(String.raw`\b(web-?dl|webdl|web dl|amzn|nf|dsnp|atvp|hmax)\b`, s)) return 'WEB-DL'
  if (test(String.raw`\b(web-?rip|webrip)\b`, s)) return 'WEBRip'
  if (test(String.raw`\bweb\b`, s)) return 'WEB-DL'
  if (test(String.raw`\b(hdtv|pdtv|dsr)\b`, s)) return 'HDTV'
  if (test(String.raw`\b(hd-?cam|cam-?rip|cam)\b`, s)) return 'CAM'
  if (test(String.raw`\b(hd-?ts|telesync|ts|pdvd)\b`, s)) return 'TS'
  if (test(String.raw`\b(hd-?tc|telecine|tc)\b`, s)) return 'TC'
  if (test(String.raw`\b(dvd-?scr|screener|scr)\b`, s)) return 'SCR'
  return 'Unknown'
}

export const isCinemaCapture = (q: ParsedQuality | undefined) => q === 'CAM' || q === 'TS' || q === 'TC' || q === 'SCR'

function videoCodec(s: string): string | undefined {
  if (test(String.raw`\b(x265|h\.?265|hevc)\b`, s)) return 'HEVC'
  if (test(String.raw`\b(x264|h\.?264|avc)\b`, s)) return 'H264'
  if (test(String.raw`\bav1\b`, s)) return 'AV1'
  if (test(String.raw`\bvp9\b`, s)) return 'VP9'
  if (test(String.raw`\b(xvid|divx)\b`, s)) return 'XviD'
  return undefined
}

function hdr(s: string): string[] {
  const out: string[] = []
  if (test(String.raw`\b(dolby ?vision|dovi|dv)\b`, s)) out.push('DV')
  if (test(String.raw`\bhdr10\+|hdr10plus`, s)) out.push('HDR10+')
  // FlowKit folds HDR10 into "HDR"; the web picker names HDR10 when the release does.
  else if (test(String.raw`\bhdr10\b`, s)) out.push('HDR10')
  else if (test(String.raw`\bhdr\b`, s)) out.push('HDR')
  if (test(String.raw`\bhlg\b`, s)) out.push('HLG')
  return out
}

function audioCodec(s: string): string | undefined {
  if (test(String.raw`\batmos\b`, s)) return test(String.raw`\btruehd\b`, s) ? 'TrueHD Atmos' : 'Atmos'
  return allAudioCodecs(s)[0]
}

/** Every audio format named, most capable first, as FlowKit's audioCodec checks them. */
function allAudioCodecs(s: string): string[] {
  const out: string[] = []
  if (test(String.raw`\btruehd\b`, s)) out.push('TrueHD')
  if (test(String.raw`\bdts-?hd(\.| )?ma\b`, s)) out.push('DTS-HD MA')
  else if (test(String.raw`\bdts-?x\b`, s)) out.push('DTS:X')
  else if (test(String.raw`\bdts\b`, s)) out.push('DTS')
  if (test(String.raw`(\bddp|\bdd\+|\be-?ac-?3\b|\beac3\b)`, s)) out.push('DD+')
  if (test(String.raw`\b(dd|ac-?3|dolby digital)\b`, s)) out.push('DD')
  if (test(String.raw`\baac\b`, s)) out.push('AAC')
  if (test(String.raw`\bflac\b`, s)) out.push('FLAC')
  if (test(String.raw`\bopus\b`, s)) out.push('Opus')
  if (test(String.raw`\bmp3\b`, s)) out.push('MP3')
  return out
}

/** Largest size mentioned, in bytes. Add-ons sometimes list per-file and total sizes. */
export function parseSize(s: string): number | undefined {
  const pattern = /(\d+(?:[.,]\d+)?)\s*(TB|TiB|GB|GiB|MB|MiB)\b/gi
  let best: number | undefined
  for (const match of s.matchAll(pattern)) {
    const value = Number(match[1]!.replace(',', '.'))
    if (!Number.isFinite(value)) continue
    const unit = match[2]!.toLowerCase()
    const multiplier = unit.startsWith('t') ? 1_099_511_627_776 : unit.startsWith('g') ? 1_073_741_824 : 1_048_576
    best = Math.max(best ?? 0, Math.trunc(value * multiplier))
  }
  return best
}

const languageNames: [name: string, patterns: string[]][] = [
  ['English', ['english', '🇬🇧', '🇺🇸', String.raw`\beng\b`]],
  ['Hindi', ['hindi', '🇮🇳', String.raw`\bhin\b`]],
  ['Tamil', ['tamil', String.raw`\btam\b`]],
  ['Telugu', ['telugu', String.raw`\btel\b`]],
  ['Malayalam', ['malayalam', String.raw`\bmal\b`]],
  ['Kannada', ['kannada', String.raw`\bkan\b`]],
  ['Bengali', ['bengali', String.raw`\bben\b`]],
  ['Spanish', ['spanish', 'español', 'castellano', 'latino', '🇪🇸', '🇲🇽', String.raw`\bspa\b`]],
  ['French', ['french', 'français', String.raw`\bvff\b`, String.raw`\bvf\b`, '🇫🇷', String.raw`\bfre\b`]],
  ['German', ['german', 'deutsch', '🇩🇪', String.raw`\bger\b`]],
  ['Italian', ['italian', 'italiano', '🇮🇹', String.raw`\bita\b`]],
  ['Portuguese', ['portuguese', 'português', '🇧🇷', '🇵🇹', String.raw`\bpor\b`]],
  ['Russian', ['russian', '🇷🇺', String.raw`\brus\b`]],
  ['Japanese', ['japanese', '🇯🇵', String.raw`\bjpn\b`]],
  ['Korean', ['korean', '🇰🇷', String.raw`\bkor\b`]],
  ['Chinese', ['chinese', 'mandarin', 'cantonese', '🇨🇳', String.raw`\bchi\b`]],
  ['Arabic', ['arabic', '🇸🇦', String.raw`\bara\b`]],
  ['Turkish', ['turkish', '🇹🇷', String.raw`\btur\b`]],
  ['Polish', ['polish', '🇵🇱', String.raw`\bpol\b`]],
  ['Dutch', ['dutch', '🇳🇱', String.raw`\bdut\b`]],
  ['Multi', [String.raw`\bmulti\b`, 'dual audio', String.raw`\bdual\b`]],
]

function languages(lower: string): string[] {
  return languageNames.filter(([, patterns]) => patterns.some((p) => test(p, lower))).map(([name]) => name)
}

/** Debrid cache markers used by AIOStreams, Torrentio, Comet, MediaFusion and friends. */
function cached(s: string): boolean | undefined {
  if (test(String.raw`\[(rd|ad|pm|tb|dl|ed|oc|pkp|tr|eb)\+\]`, s) || s.includes('⚡') || test(String.raw`\binstant\b|\bcached\b`, s)) return true
  if (test(String.raw`\[(rd|ad|pm|tb|dl|ed|oc|pkp|tr|eb)( download|⏳)?\]`, s) || s.includes('⏳') || test(String.raw`\buncached\b`, s)) return false
  return undefined
}

/** Season and episode from a file name: S01E02, 1x02, "Season 1 Episode 2". */
export function episodeRef(filename: string): { season: number; episode: number } | undefined {
  const lower = filename.toLowerCase()
  const patterns = [/s(\d{1,2})[ ._-]?e(\d{1,3})/, /\b(\d{1,2})x(\d{2,3})\b/, /season[ ._-]?(\d{1,2})[ ._-]*episode[ ._-]?(\d{1,3})/]
  for (const pattern of patterns) {
    const m = pattern.exec(lower)
    if (m) return { season: Number(m[1]), episode: Number(m[2]) }
  }
  return undefined
}

/** Lowercase, accent-folded, punctuation-free: the form titles are compared in. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/** "The.Matrix.1999.1080p.BluRay.x264.mkv" → { title: "the matrix", year: 1999 } */
export function titleAndYear(filename: string): { title: string; year?: number } {
  let name = filename
  const dot = name.lastIndexOf('.')
  if (dot >= 0 && name.length - dot <= 5) name = name.slice(0, dot)
  name = name.replace(/[._]/g, ' ')
  let year: number | undefined
  // The last year-like token is the release year ("Blade Runner 2049 (2017)").
  const years = [...name.matchAll(/(?:^|[\s([])((?:19|20)\d{2})(?=[\s)\]]|$)/g)].filter((m) => m.index! > 0)
  const last = years.at(-1)
  if (last) {
    year = Number(last[1])
    name = name.slice(0, last.index! + last[0].length - last[1]!.length)
  } else {
    const m = /\b(s\d{1,2}e\d{1,3}|\d{3,4}p|season \d+)/i.exec(name)
    if (m) name = name.slice(0, m.index)
  }
  const title = name.replace(/[[\]()]/g, ' ').replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
  return { title: normalizeTitle(title), year }
}

/** "18.20 GB", "512.0 MB", as FlowKit formats them. */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1_073_741_824
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

/** Badges shown under a source row, e.g. ["1080p", "H264", "AAC", "2.0"]. */
export function badges(t: StreamTraits): string[] {
  const out: string[] = []
  if (t.resolution) out.push(resolutionLabel(t.resolution))
  out.push(...t.hdr)
  if (t.videoCodec) out.push(t.videoCodec)
  if (t.audioCodec) out.push(t.audioCodec)
  if (t.audioChannels) out.push(t.audioChannels)
  return out
}

export function resolutionLabel(r: ResolutionClass): string {
  return r === 2160 ? '4K' : r === 480 ? 'SD' : r === 0 ? 'Unknown' : `${r}p`
}

/* Things that aren't video stay out of the source list. Torrent indexes are full of fakes:
   "Movie.2026.1080p.mkv.exe", password-protected archives, and shortcut files. (SourceSafety.) */
const unsafeExtensions = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'vbs', 'js', 'jar', 'ps1', 'app', 'dmg', 'pkg', 'apk', 'lnk', 'url',
  'zip', 'rar', '7z', 'tar', 'gz', 'cab',
])

/** True for names ending in an executable, installer, archive or shortcut extension. */
export function isUnsafeFileName(name: string): boolean {
  const trimmed = name.trim().toLowerCase()
  const dot = trimmed.lastIndexOf('.')
  if (dot < 0) return false
  return unsafeExtensions.has(trimmed.slice(dot + 1))
}
