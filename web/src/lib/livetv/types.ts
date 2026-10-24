/* Live TV, as the apps model it (FlowKit/LiveTV): channels from an M3U playlist or an Xtream Codes
   panel, and programme guides from XMLTV. Times are milliseconds since the epoch, so a guide stores
   and structured-clones (IndexedDB, the worker) as plain numbers. */

export type IPTVProviderKind = 'm3u' | 'xtream'

/** One IPTV provider, with the fields of FlowKit's IPTVProviderConfig. */
export interface IPTVProviderConfig {
  id: string
  name: string
  kind: IPTVProviderKind
  /** The playlist address (M3U) or the panel's address (Xtream). */
  url: string
  /** Where the XMLTV guide is, when the playlist or panel doesn't say. */
  epgURL?: string
  username?: string
  password?: string
  enabled: boolean
  /** The apps offer a provider's movies and series in the source picker; the web has no such source yet. */
  useForVOD: boolean
  /** Sent by the apps. A browser won't let a page set its own User-Agent, so the web keeps it only so a
   *  backup round-trips. */
  userAgent?: string
}

/** The Live TV part of Settings (FlowKit's LiveTVSettings). */
export interface LiveTVSettings {
  providers: IPTVProviderConfig[]
  /** Hours before the guide is downloaded again. */
  epgRefreshHours: number
  favouriteChannelIDs: string[]
  recentChannelIDs: string[]
  hideEmptyGroups: boolean
}

export const defaultLiveTV: LiveTVSettings = {
  providers: [],
  epgRefreshHours: 12,
  favouriteChannelIDs: [],
  recentChannelIDs: [],
  hideEmptyGroups: true,
}

export interface Channel {
  id: string
  providerID: string
  name: string
  number?: number
  group: string
  logoURL?: string
  streamURL: string
  /** Id used to look up programmes in the guide. */
  epgID?: string
  userAgent?: string
  hasCatchup: boolean
}

export interface Programme {
  channelID: string
  title: string
  subtitle?: string
  description?: string
  /** Milliseconds since the epoch. */
  start: number
  end: number
  category?: string
  iconURL?: string
}

/** Programmes by guide channel id, each list sorted by start time. */
export interface EPG {
  programmes: Record<string, Programme[]>
  /** The guide's own name for a channel, by its id. */
  displayNames: Record<string, string>
}

export const emptyEPG = (): EPG => ({ programmes: {}, displayNames: {} })
