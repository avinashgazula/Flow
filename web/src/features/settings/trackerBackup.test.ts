import { describe, expect, it } from 'vitest'
import { backupFormat, parseBackup } from './backup'

/* The tracker choices in Settings → Account travel in the JSON backup, and a value that means nothing is skipped. */

const backup = (settings: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings }))

describe('tracker settings in the backup', () => {
  it('keeps where each list is saved, the sync interval and the scrobble switch', () => {
    const good = backup({ watchlistDestination: 'mdblist', favouritesDestination: 'trakt', syncInterval: 0, scrobble: false })
    expect(good.ok && good.skipped).toEqual([])
    if (good.ok) expect(good.settings).toMatchObject({ watchlistDestination: 'mdblist', favouritesDestination: 'trakt', syncInterval: 0, scrobble: false })
  })

  it('skips a destination, interval or switch that makes no sense, and a media server, which only the apps have', () => {
    const bad = backup({ watchlistDestination: 'mediaServer', favouritesDestination: 'publicMetaDB', syncInterval: 7, scrobble: 'yes', autoplayNext: true })
    expect(bad.ok && bad.skipped.sort()).toEqual(['favouritesDestination', 'scrobble', 'syncInterval', 'watchlistDestination'])
  })
})
