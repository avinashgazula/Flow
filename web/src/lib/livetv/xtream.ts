import { fetchJSON, LiveTVError, type Attempt, type FetchOptions } from './net'
import type { Channel, EPG, IPTVProviderConfig, Programme } from './types'

/* An Xtream Codes panel's "player_api.php", after FlowKit's XtreamClient: live categories and streams,
   the account's status, and a channel's short guide. Requests are built as plans (see plan.ts) by the
   caller, so each can go through the stream proxy. */

type JSON = unknown
type Fields = Record<string, unknown>

const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A string, from a JSON string or number (panels send ids both ways). */
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined)
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : undefined
}
const nonEmpty = (v: unknown) => str(v) || undefined

/** The panel's address without a trailing slash or "/player_api.php". */
export function xtreamBase(url: string): string {
  let s = url.trim()
  while (s.endsWith('/')) s = s.slice(0, -1)
  if (s.endsWith('/player_api.php')) s = s.slice(0, -'/player_api.php'.length)
  return s
}

/** A login or stream id as one path segment: a space or "#" in a password must not break the address. */
const segment = (value: string) => encodeURIComponent(value)

/** ".../live/user/pass/42.m3u8": a stream address carries the login in its path. */
export function xtreamStreamURL(base: string, kind: 'live' | 'movie' | 'series', username: string, password: string, id: string, ext: string): string {
  return `${xtreamBase(base)}/${kind}/${segment(username)}/${segment(password)}/${segment(id)}.${ext}`
}

/** The address of a player_api call. */
export function xtreamAPIURL(config: Pick<IPTVProviderConfig, 'url' | 'username' | 'password'>, action?: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ username: config.username ?? '', password: config.password ?? '' })
  if (action) query.set('action', action)
  for (const [k, v] of Object.entries(extra)) query.set(k, v)
  return `${xtreamBase(config.url)}/player_api.php?${query}`
}

/** How a call reaches the panel: the plan for its address. */
export type Planner = (url: string) => { attempts: Attempt[]; problem?: string }

export interface AccountInfo {
  status?: string
  /** Milliseconds since the epoch. */
  expiresAt?: number
  maxConnections?: number
  activeConnections?: number
}

export class XtreamClient {
  constructor(
    readonly config: IPTVProviderConfig,
    private readonly plan: Planner,
    private readonly options: FetchOptions = {},
  ) {}

  private async api(action?: string, extra?: Record<string, string>): Promise<JSON> {
    const url = xtreamAPIURL(this.config, action, extra)
    return (await fetchJSON<JSON>(url, this.plan(url), { timeoutMs: 60_000, ...this.options })).data
  }

  async accountInfo(): Promise<AccountInfo> {
    const json = await this.api()
    const user = isObject(json) && isObject(json['user_info']) ? json['user_info'] : undefined
    if (num(user?.['auth']) === 0) throw new LiveTVError('The panel didn’t accept that username and password. Check them, then try again.', 401)
    const expires = num(user?.['exp_date'])
    return {
      status: str(user?.['status']),
      expiresAt: expires === undefined ? undefined : expires * 1000,
      maxConnections: num(user?.['max_connections']),
      activeConnections: num(user?.['active_cons']),
    }
  }

  async channels(): Promise<Channel[]> {
    const [categories, streams] = await Promise.allSettled([this.api('get_live_categories'), this.api('get_live_streams')])
    if (streams.status === 'rejected') throw streams.reason
    // Categories only name the groups: without them the channels still play, as "Uncategorised".
    const groups = new Map<string, string>()
    if (categories.status === 'fulfilled' && Array.isArray(categories.value)) {
      for (const c of categories.value) {
        const id = isObject(c) ? str(c['category_id']) : undefined
        const name = isObject(c) ? str(c['category_name']) : undefined
        if (id !== undefined && name !== undefined) groups.set(id, name)
      }
    }
    if (!Array.isArray(streams.value)) {
      if (isObject(streams.value) && num((isObject(streams.value['user_info']) ? streams.value['user_info'] : {})['auth']) === 0) throw new LiveTVError('The panel didn’t accept that username and password. Check them, then try again.', 401)
      return []
    }
    const username = this.config.username ?? ''
    const password = this.config.password ?? ''
    const out: Channel[] = []
    for (const s of streams.value) {
      if (!isObject(s)) continue
      const id = str(s['stream_id'])
      if (id === undefined) continue
      const category = str(s['category_id'])
      out.push({
        id: `${this.config.id}:${id}`,
        providerID: this.config.id,
        name: str(s['name']) ?? `Channel ${id}`,
        number: num(s['num']),
        group: (category !== undefined ? groups.get(category) : undefined) ?? 'Uncategorised',
        logoURL: nonEmpty(s['stream_icon']),
        streamURL: xtreamStreamURL(this.config.url, 'live', username, password, id, 'm3u8'),
        epgID: nonEmpty(s['epg_channel_id']),
        userAgent: this.config.userAgent,
        hasCatchup: (num(s['tv_archive']) ?? 0) > 0,
      })
    }
    return out
  }

  /** Where the full guide is: the configured address, else the panel's own "xmltv.php". */
  epgURL(): string {
    if (this.config.epgURL) return this.config.epgURL
    const query = new URLSearchParams({ username: this.config.username ?? '', password: this.config.password ?? '' })
    return `${xtreamBase(this.config.url)}/xmltv.php?${query}`
  }

  /** The next few programmes for one stream, from "get_short_epg": a quick answer for a single channel
   *  when the full guide is missing it. Titles and descriptions arrive base64 encoded. */
  async shortEPG(streamID: string, epgID: string, limit = 6): Promise<EPG> {
    const json = await this.api('get_short_epg', { stream_id: streamID, limit: String(limit) })
    return shortEPGFrom(json, epgID)
  }
}

/** The stream id of a channel from this panel (its id is "<provider id>:<stream id>"). */
export function xtreamStreamID(channel: Pick<Channel, 'id' | 'providerID'>): string | undefined {
  const prefix = `${channel.providerID}:`
  return channel.id.startsWith(prefix) ? channel.id.slice(prefix.length) : undefined
}

function base64Text(value: unknown): string | undefined {
  const raw = str(value)
  if (!raw) return undefined
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes).trim() || undefined
  } catch {
    // Some panels send the text as it is.
    return raw
  }
}

/** A "get_short_epg" answer as a guide for one channel. */
export function shortEPGFrom(json: JSON, epgID: string): EPG {
  const listings = isObject(json) && Array.isArray(json['epg_listings']) ? json['epg_listings'] : []
  const programmes: Programme[] = []
  for (const l of listings) {
    if (!isObject(l)) continue
    const start = num(l['start_timestamp'])
    const end = num(l['stop_timestamp'] ?? l['end_timestamp'])
    if (start === undefined || end === undefined) continue
    programmes.push({ channelID: epgID, title: base64Text(l['title']) ?? 'Untitled', description: base64Text(l['description']), start: start * 1000, end: end * 1000 })
  }
  programmes.sort((a, b) => a.start - b.start)
  return { programmes: programmes.length ? { [epgID]: programmes } : {}, displayNames: {} }
}
