import type { ServerConfig } from '../store/settings'
import { catalogueOf, librariesOf, recentOf, titlesIn } from './servers'
import { buildIndex, type ServerIndex } from './serverIndex'
import type { ServerLibrary, ServerTitle } from './types'

/* What Home's server rows and the index ask of the servers, with the choices the apps make: the index is every
   server's whole listing (one that doesn't answer is left out and named), a row is a server's newest titles, and
   a title the server never matched to TMDB can't be opened on its page, so it isn't listed. */

/** Every enabled server's titles as an index. A server that fails is named in `failed`; if they all fail, it throws. */
export async function loadIndex(servers: readonly ServerConfig[], signal?: AbortSignal): Promise<ServerIndex> {
  const results = await Promise.allSettled(servers.map((server) => catalogueOf(server, signal)))
  signal?.throwIfAborted()
  const titles: ServerTitle[] = []
  const failed: string[] = []
  let reason: unknown
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') titles.push(...r.value)
    else (failed.push(servers[i]!.name), (reason ??= r.reason))
  })
  if (failed.length === servers.length) throw reason
  return buildIndex(titles, failed)
}

/** Newest first across servers, each title once. */
export function merged(lists: readonly ServerTitle[][]): ServerTitle[] {
  const seen = new Set<string>()
  return lists
    .flat()
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .filter((t) => {
      const key = `${t.type}:${t.tmdb ?? `${t.serverId}:${t.itemId}`}`
      return !seen.has(key) && !!seen.add(key)
    })
}

/** "Recently Added to Your Server": the newest 30 of each server, merged. A server that doesn't answer adds nothing. */
export async function recentTitles(servers: readonly ServerConfig[], signal?: AbortSignal): Promise<ServerTitle[]> {
  const lists = await Promise.all(servers.map((s) => recentOf(s, 30, signal).catch(() => [] as ServerTitle[])))
  signal?.throwIfAborted()
  return merged(lists)
}

/** One library's newest 60 (the apps' row length). */
export async function libraryTitles(server: ServerConfig, libraryId: string, signal?: AbortSignal): Promise<ServerTitle[]> {
  return merged([await titlesIn(server, libraryId, 60, signal)])
}

export const serverLibraries = (server: ServerConfig, signal?: AbortSignal): Promise<ServerLibrary[]> => librariesOf(server, signal)
