/* Where this browser keeps its Flow Sync setup: the sync key, the Worker's address and token, and the times
   the merge needs. Its own localStorage key, read fresh on every use so a second tab never works from stale
   numbers, and not part of the settings backup (a backup file would carry the key to anyone it is sent to).
   main.tsx reads the same key name to decide whether the engine needs to load at all. */

import type { Metas } from './payload'

export const configKey = 'flow.sync.v1'

export interface SyncConfig {
  /** The 26-character key, no dashes. The only secret. */
  key: string
  /** The Worker's origin. */
  server: string
  /** The Worker's TOKEN; empty when it has none. */
  token: string
  /** When each section last changed, and the value then (see payload.ts). */
  metas: Metas
  /** The last time a sync finished, ISO 8601. */
  lastSyncAt?: string
}

export function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(configKey)
    const data: unknown = raw ? JSON.parse(raw) : null
    if (typeof data !== 'object' || data === null) return null
    const c = data as Partial<SyncConfig>
    if (typeof c.key !== 'string' || typeof c.server !== 'string') return null
    return { key: c.key, server: c.server, token: typeof c.token === 'string' ? c.token : '', metas: typeof c.metas === 'object' && c.metas !== null ? c.metas : {}, ...(typeof c.lastSyncAt === 'string' ? { lastSyncAt: c.lastSyncAt } : {}) }
  } catch {
    return null
  }
}

export function saveConfig(config: SyncConfig) {
  try {
    localStorage.setItem(configKey, JSON.stringify(config))
  } catch {
    // Without storage sync can't remember its key; the next load simply finds it off.
  }
}

export function clearConfig() {
  try {
    localStorage.removeItem(configKey)
  } catch {
    // Nothing was stored.
  }
}
