import { formatBytes } from '../../lib/sources/parser'
import type { Source } from '../../lib/sources'
import type { SourceAppearance } from '../../lib/sources/sourceSettings'

/* The words a source is shown with, as the native picker's SourceSummary and PremiumBadge. */

export const resolutionLabel = (s: Source) => (s.resolution === '2160p' ? '4K' : s.resolution === '480p' ? 'SD' : s.resolution)
/** The resolution as printed on a label: "2160p", "1080p", "SD". */
export const resolutionText = (s: Pick<Source, 'resolution'>) => (s.resolution === '480p' ? 'SD' : s.resolution)
export const sizeLabel = (s: Source) => (s.sizeBytes ? formatBytes(s.sizeBytes) : undefined)

const hdrNames: Record<string, string> = { DV: 'Dolby Vision', 'HDR10+': 'HDR10+', HDR10: 'HDR10', HDR: 'HDR', HLG: 'HLG' }
const premiumAudio = new Set(['Atmos', 'TrueHD Atmos', 'TrueHD', 'DTS-HD MA', 'DTS:X'])

export interface Badge {
  text: string
  kind: 'picture' | 'sound'
}

/** The formats that change what you see and hear, as outlined badges. */
export function premiumBadges(s: Source): Badge[] {
  return [
    ...(s.hdr ?? []).map((h) => ({ text: hdrNames[h] ?? h, kind: 'picture' as const })),
    ...(s.audio ?? []).slice(0, 1).filter((a) => premiumAudio.has(a)).map((a) => ({ text: a, kind: 'sound' as const })),
  ]
}

/** Codecs and channels in plain words: "HEVC · DD+ · 5.1". */
export function plainFormats(s: Source): string | undefined {
  // A release with several audio tracks lists them all ("DTS · DD · AAC"): the playable one matters.
  const audio = (s.audio ?? []).filter((a, i) => !(i === 0 && premiumAudio.has(a))).slice(0, 3)
  const words = [s.videoCodec, ...audio, s.audioChannels].filter(Boolean)
  return words.length ? words.join(' · ') : undefined
}

/** "4K · Dolby Vision · Atmos · 18.20 GB · AIOStreams": exactly what Play will start. */
export function playDescription(s: Source): string {
  return [resolutionLabel(s), ...premiumBadges(s).map((b) => b.text), sizeLabel(s), s.provider].filter(Boolean).join(' · ')
}

/** The format line in edge print: "Dolby Vision · TrueHD · HEVC · 7.1 · REMUX". Only what the release says.
 *  `quality: false` leaves the release type off, for a row that already leads with it. */
export function formatLine(s: Source, quality = true): string {
  return [...premiumBadges(s).map((b) => b.text), plainFormats(s), quality ? s.quality : undefined].filter(Boolean).join(' · ')
}

/** Size, provider, languages and release group, plain: "18.20 GB · AIOStreams · English, Spanish · FLUX". */
export function detailLine(s: Source): string {
  return [sizeLabel(s), s.provider, s.languages?.join(', '), s.releaseGroup?.toUpperCase()].filter(Boolean).join(' · ')
}

/** Provider, languages and release group. */
export function metaLine(s: Source): string {
  return [s.provider, s.languages?.join(' · '), s.releaseGroup?.toUpperCase()].filter(Boolean).join(' · ')
}

/** What a row says in Settings → Sources → Appearance's terms: the release type or name as its title, the format
 *  print above it, the facts below it, and the add-on's own lines when it is shown as the add-on wrote it. */
export interface RowText {
  title: string
  /** Edge print, or nothing when badges are off or the add-on's own text is shown. */
  formats?: string
  /** Size, provider, languages and release group, plain. */
  meta?: string
  /** The add-on's own lines after its first, kept as written, when "Show Add-on Formatting" is on. */
  raw: string[]
}

/** `providerAbove`: the provider's name heads the group the row sits in, so the row needn't say it. As the
 *  apps' SourceSummary: with Provider Name the heading carries it and the row leads with the release type. */
export function rowText(s: Source, a: SourceAppearance, providerAbove: boolean): RowText {
  const size = a.showSize ? sizeLabel(s) : undefined
  const lines = (s.detail ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const byProvider = a.titleDisplay === 'provider'
  let title: string | undefined
  if (byProvider) title = providerAbove ? (s.quality ?? (size ? undefined : (s.filename ?? s.provider))) : s.provider
  else if (a.titleDisplay === 'filename') title = s.filename ?? s.title
  else title = lines[0] ?? s.provider
  title ??= s.filename ?? s.title ?? s.provider
  const qualityIsTitle = title === s.quality
  const meta = [size, providerAbove || title === s.provider ? undefined : s.provider, s.languages?.join(', '), s.releaseGroup?.toUpperCase()].filter(Boolean).join(' · ')
  // The add-on's first line is usually its name, which the title or the group heading already says.
  const raw = lines.filter((l, i) => !(i === 0 && (l === title || l === s.provider)))
  let formats: string | undefined
  if (!a.showRawText && a.badges === 'all') formats = formatLine(s, !qualityIsTitle)
  else if (!a.showRawText && a.badges === 'minimal') formats = premiumBadges(s).slice(0, 2).map((b) => b.text).join(' · ')
  return { title, formats: formats || undefined, meta: meta || undefined, raw: a.showRawText ? raw : [] }
}

/** "1080p WEB-DL, AIOStreams, 3.98 GB, English, Dolby Vision", for screen readers. `show` leaves out what the
 *  row doesn't print: the provider when a heading says it, the size when Show File Size is off. */
export function spokenLabel(s: Source, lastPlayed: boolean, show: { provider?: boolean; size?: boolean } = {}): string {
  const parts = [[resolutionLabel(s), s.quality].filter(Boolean).join(' '), show.provider === false ? undefined : s.provider, show.size === false ? undefined : sizeLabel(s), s.languages?.join(' and '), ...premiumBadges(s).map((b) => b.text)]
  if (s.cached) parts.push('Cached')
  if (s.unsupported) parts.push(s.unsupported)
  else if (s.note) parts.push(s.note)
  return (lastPlayed ? 'Last played, ' : '') + parts.filter(Boolean).join(', ')
}
