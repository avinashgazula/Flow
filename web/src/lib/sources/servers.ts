/* One face for the three server clients: ask a server for its libraries, its titles or a search, and tell it what is
   playing, without the caller knowing whether it is Jellyfin, Emby or Plex. FlowKit's MediaServerClient protocol.
   Each client loads only when a server of its kind is asked, so none of this is in the first load. */

import type { ServerConfig } from '../store/settings'
import type { PlaybackReport, ServerLibrary, ServerTitle } from './types'

const client = (config: ServerConfig) => (config.kind === 'plex' ? import('./plex') : import('./jellyfin'))

export const librariesOf = async (config: ServerConfig, signal?: AbortSignal): Promise<ServerLibrary[]> => (await client(config)).libraries(config, signal)
export const catalogueOf = async (config: ServerConfig, signal?: AbortSignal): Promise<ServerTitle[]> => (await client(config)).catalogue(config, signal)
export const titlesIn = async (config: ServerConfig, libraryId: string, limit: number, signal?: AbortSignal): Promise<ServerTitle[]> => (await client(config)).itemsIn(config, libraryId, limit, signal)
export const recentOf = async (config: ServerConfig, limit: number, signal?: AbortSignal): Promise<ServerTitle[]> => (await client(config)).recentlyAdded(config, limit, signal)
export const searchOf = async (config: ServerConfig, text: string, signal?: AbortSignal): Promise<ServerTitle[]> => (await client(config)).search(config, text, signal)
export const reportTo = async (config: ServerConfig, report: PlaybackReport, keepalive = false): Promise<void> => (await client(config)).report(config, report, keepalive)
