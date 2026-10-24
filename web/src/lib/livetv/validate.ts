import type { IPTVProviderConfig, LiveTVSettings } from './types'

/* What a backup file may hold for Live TV. A provider that isn't usable (no address Flow can call) is
   refused with the rest, rather than saved and failing later. */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optionalString = (v: unknown) => v === undefined || typeof v === 'string'
const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** True for an http or https address. */
export function isWebAddress(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value)
    return (protocol === 'http:' || protocol === 'https:') && hostname.length > 0
  } catch {
    return false
  }
}

export function isProvider(v: unknown): v is IPTVProviderConfig {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.name === 'string' &&
    (v.kind === 'm3u' || v.kind === 'xtream') &&
    typeof v.url === 'string' &&
    isWebAddress(v.url) &&
    (v.epgURL === undefined || (typeof v.epgURL === 'string' && isWebAddress(v.epgURL))) &&
    optionalString(v.username) &&
    optionalString(v.password) &&
    typeof v.enabled === 'boolean' &&
    typeof v.useForVOD === 'boolean' &&
    optionalString(v.userAgent)
  )
}

export function isLiveTVSettings(v: unknown): v is LiveTVSettings {
  return (
    isObject(v) &&
    Array.isArray(v.providers) &&
    v.providers.every(isProvider) &&
    typeof v.epgRefreshHours === 'number' &&
    Number.isInteger(v.epgRefreshHours) &&
    v.epgRefreshHours >= 1 &&
    v.epgRefreshHours <= 168 &&
    strings(v.favouriteChannelIDs) &&
    strings(v.recentChannelIDs) &&
    typeof v.hideEmptyGroups === 'boolean'
  )
}
