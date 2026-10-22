/* Jellyfin's trickplay (10.9+): the server cuts a film into small pictures, one every few seconds, and
   lays them out in grids, one JPEG per grid. The player's seek preview reads a time off them with no
   decoding at all. The item says what exists (`Trickplay`, by media source and then by picture width);
   this turns it into what a player needs. */

import type { Trickplay } from './types'

export interface TrickplayDTO {
  Width?: number
  Height?: number
  TileWidth?: number
  TileHeight?: number
  ThumbnailCount?: number
  /** Milliseconds between pictures. */
  Interval?: number
}

/** The picture width to prefer: the smallest that is still sharp in the preview frame (about 240 px, twice that on a dense screen is too much to fetch). */
const WANTED_WIDTH = 240

/** The tiles for one media source, in the width that suits the preview. `base` is the server's address. */
export function trickplayFor(base: string, itemId: string, mediaSourceId: string, token: string, byWidth: Record<string, TrickplayDTO> | undefined): Trickplay | undefined {
  const usable = Object.entries(byWidth ?? {})
    .map(([key, info]) => ({ key, info, width: info.Width ?? Number(key) }))
    .filter(({ info, width }) => width > 0 && (info.Height ?? 0) > 0 && (info.TileWidth ?? 0) > 0 && (info.TileHeight ?? 0) > 0 && (info.ThumbnailCount ?? 0) > 0 && (info.Interval ?? 0) > 0)
    .sort((a, b) => a.width - b.width)
  const pick = usable.find((u) => u.width >= WANTED_WIDTH) ?? usable.at(-1)
  if (!pick) return undefined
  const { info, key, width } = pick
  const query = new URLSearchParams({ MediaSourceId: mediaSourceId, api_key: token })
  return {
    // `{n}` is where the tile's number goes (URLSearchParams would escape braces, so the path carries it).
    url: `${base}/Videos/${itemId}/Trickplay/${key}/{n}.jpg?${query}`,
    width,
    height: info.Height!,
    columns: info.TileWidth!,
    rows: info.TileHeight!,
    count: info.ThumbnailCount!,
    interval: info.Interval!,
  }
}

/** Which tile holds the picture for `seconds`, and which cell of it. Times past the end use the last picture. */
export function trickplayCell(t: Trickplay, seconds: number): { tile: number; column: number; row: number } {
  const index = Math.min(t.count - 1, Math.max(0, Math.floor((Math.max(0, seconds) * 1000) / t.interval)))
  const perTile = t.columns * t.rows
  const inTile = index % perTile
  return { tile: Math.floor(index / perTile), column: inTile % t.columns, row: Math.floor(inTile / t.columns) }
}
