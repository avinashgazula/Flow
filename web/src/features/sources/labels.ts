import { formatBytes } from '../../lib/sources/parser'
import type { Source } from '../../lib/sources'

/* The words a source is shown with, as the native picker's SourceSummary and PremiumBadge. */

export const resolutionLabel = (s: Source) => (s.resolution === '2160p' ? '4K' : s.resolution === '480p' ? 'SD' : s.resolution)
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

/** Provider, languages and release group. */
export function metaLine(s: Source): string {
  return [s.provider, s.languages?.join(' · '), s.releaseGroup?.toUpperCase()].filter(Boolean).join(' · ')
}

/** "1080p WEB-DL, AIOStreams, 3.98 GB, English, Dolby Vision", for screen readers. */
export function spokenLabel(s: Source, lastPlayed: boolean): string {
  const parts = [[resolutionLabel(s), s.quality].filter(Boolean).join(' '), s.provider, sizeLabel(s), s.languages?.join(' and '), ...premiumBadges(s).map((b) => b.text)]
  if (s.cached) parts.push('Cached')
  if (s.unsupported) parts.push(s.unsupported)
  else if (s.note) parts.push(s.note)
  return (lastPlayed ? 'Last played, ' : '') + parts.filter(Boolean).join(', ')
}
