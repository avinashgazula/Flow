/* Where this browser keeps its Marquee Account: the account number (the only secret), which server holds it, and
   what the sync needs to remember between visits. Its own localStorage keys, read fresh on every use so a second tab
   never works from stale numbers, and not part of the settings backup (a backup file would carry the number to anyone it
   is sent to). main.tsx reads the same key name to decide whether the engine needs to load at all, and that is all
   this file is for there: nothing here imports more than types. */

import type { Metas } from '../sync/payload'
import { emptyState, type WireState } from './wire'

export const configKey = 'flow.account.v1'
const stateKey = 'flow.account.state.v1'
const serverKey = 'flow.account.server'

export interface AccountConfig {
  /** The 16 digits, no spaces. */
  number: string
  /** The account server's origin. */
  server: string
  /** The revision of each value as this browser last saw it. */
  revs: Record<string, number>
  /** What each value said when this browser last saw it (a short hash), so only what changed is written. */
  hashes: Record<string, string>
  /** When each settings section last changed (see lib/sync/payload.ts). */
  metas: Metas
  lastSyncAt?: string
}

export function loadConfig(): AccountConfig | null {
  try {
    const raw = localStorage.getItem(configKey)
    const data: unknown = raw ? JSON.parse(raw) : null
    if (typeof data !== 'object' || data === null) return null
    const c = data as Partial<AccountConfig>
    if (typeof c.number !== 'string' || typeof c.server !== 'string') return null
    const obj = <T>(v: unknown): T => (typeof v === 'object' && v !== null ? (v as T) : ({} as T))
    return { number: c.number, server: c.server, revs: obj(c.revs), hashes: obj(c.hashes), metas: obj(c.metas), ...(typeof c.lastSyncAt === 'string' ? { lastSyncAt: c.lastSyncAt } : {}) }
  } catch {
    return null
  }
}

export function saveConfig(config: AccountConfig) {
  try {
    localStorage.setItem(configKey, JSON.stringify(config))
  } catch {
    // Without storage the account can't be remembered; the next load simply finds it off.
  }
}

const settingsCopyKey = 'flow.account.settings.v1'

/** The settings record as the account last held it (text), for a sync that finds it unchanged. */
export function loadSettingsCopy(): string | null {
  try {
    return localStorage.getItem(settingsCopyKey)
  } catch {
    return null
  }
}
export function saveSettingsCopy(text: string) {
  try {
    localStorage.setItem(settingsCopyKey, text)
  } catch {
    // The next sync reads it from the account again.
  }
}

export function clearConfig() {
  try {
    localStorage.removeItem(configKey)
    localStorage.removeItem(stateKey)
    localStorage.removeItem(settingsCopyKey)
  } catch {
    // Nothing was stored.
  }
}

export const accountIsOn = () => loadConfig() !== null

/** The library as it stood when this browser last synced it. */
export function loadBase(): WireState {
  try {
    const raw = localStorage.getItem(stateKey)
    const data: unknown = raw ? JSON.parse(raw) : null
    return typeof data === 'object' && data !== null ? { ...emptyState(), ...(data as Partial<WireState>) } : emptyState()
  } catch {
    return emptyState()
  }
}

/** Whether the library as last synced is still stored: without it, what the account holds can't be told from what this browser lacks. */
export function hasBase(): boolean {
  try {
    return localStorage.getItem(stateKey) !== null
  } catch {
    return false
  }
}

export function saveBase(state: WireState) {
  try {
    localStorage.setItem(stateKey, JSON.stringify(state))
  } catch {
    // A full browser store: the next sync starts from an empty base and merges again, which loses nothing.
  }
}

/** A server typed in Settings, for a site built without one. */
export const typedServer = (): string => {
  try {
    return localStorage.getItem(serverKey) ?? ''
  } catch {
    return ''
  }
}
export function saveTypedServer(server: string) {
  try {
    if (server) localStorage.setItem(serverKey, server)
    else localStorage.removeItem(serverKey)
  } catch {
    // The field just empties on reload.
  }
}
