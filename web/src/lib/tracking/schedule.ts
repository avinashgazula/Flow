import type { Settings } from '../store/settings'

/* When the library syncs by itself (Settings → Account → Sync Interval), as the apps' SyncInterval: reopening Flow
   syncs only if the last sync is older than this. A web page is never really closed, so the same rule decides when a
   tab that comes back, or has been open a while, looks at the service again. Sync Now ignores it, and so does choosing a
   service. Changes made here are sent a couple of seconds after, whatever the interval. */

/** In the apps' order, in seconds. 0 is every time. */
export const syncIntervals = [0, 900, 3600, 10800, 43200, 86400] as const

export const defaultSyncInterval = 10800

export const syncIntervalLabel: Record<(typeof syncIntervals)[number], string> = {
  0: 'Every Launch',
  900: '15 Minutes',
  3600: '1 Hour',
  10800: '3 Hours',
  43200: '12 Hours',
  86400: '1 Day',
}

export function syncIntervalOf(s: Pick<Settings, 'syncInterval'>): number {
  return syncIntervals.includes(s.syncInterval as (typeof syncIntervals)[number]) ? s.syncInterval! : defaultSyncInterval
}

/** Whether it is time to sync by itself: never synced, or the last one is at least `interval` seconds old. A last sync
 *  in the future (a clock set back) counts as due rather than waiting out the difference. */
export function syncDue(lastSyncAt: string | null | undefined, intervalSeconds: number, now: number): boolean {
  const last = lastSyncAt ? Date.parse(lastSyncAt) : NaN
  if (Number.isNaN(last)) return true
  return now < last || now - last >= intervalSeconds * 1000
}

/** The oldest of several services' last syncs, so one that is behind makes the sync due; null if any never synced. */
export function oldestSync(times: (string | null | undefined)[]): string | null {
  if (!times.length || times.some((t) => !t || Number.isNaN(Date.parse(t)))) return null
  return times.reduce((a, b) => (Date.parse(a!) <= Date.parse(b!) ? a : b)) as string
}
