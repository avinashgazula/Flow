import { del } from 'idb-keyval'
import { useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { queryClient } from '../../lib/queryClient'
import { library, libraryStore, useLibrary } from '../../lib/store/library'
import { lastSources } from '../player/session'
import { settingsStore } from '../../lib/store/settings'
import { applyBackup, createBackup, parseBackup, resetEverything } from './backup'
import { turnOff } from '../../lib/sync/engine'
import { ConfirmButton, Group, Note, Row } from './controls'
import { SyncGroup } from './SyncGroup'

export function DataSection() {
  const file = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string }>()
  const progress = useLibrary((l) => Object.keys(l.progress).length)
  const history = useLibrary((l) => l.history.length)
  const watchlist = useLibrary((l) => l.watchlist.length)
  // What the browser remembers lives outside the stores; it is counted again after each change.
  const [remembered, setRemembered] = useState(() => lastSources.count())
  const items = (n: number) => (n === 1 ? '1 title' : `${n} titles`)

  function exportBackup() {
    const backup = createBackup(settingsStore.get(), libraryStore.get())
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `flow-backup-${backup.exportedAt.slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    setNote({ tone: 'ok', text: 'Saved a backup. It includes your sign-ins and keys, so keep it private.' })
  }

  async function importBackup(chosen: File | undefined) {
    if (!chosen) return
    try {
      const parsed = parseBackup(await chosen.text())
      if (!parsed.ok) return setNote({ tone: 'error', text: parsed.error })
      applyBackup(parsed)
      setNote({ tone: 'ok', text: parsed.skipped.length ? `Imported ${chosen.name}. Skipped what couldn’t be read: ${parsed.skipped.join(', ')}.` : `Imported ${chosen.name}.` })
    } catch {
      setNote({ tone: 'error', text: 'Couldn’t read that file. Choose a backup exported from Flow.' })
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  async function clearCache() {
    queryClient.clear()
    try {
      await del('flow.queries.v1')
    } catch {
      // Without IndexedDB there's no saved copy to remove.
    }
    setNote({ tone: 'ok', text: 'Cleared the cache. Screens load fresh from TMDB.' })
  }

  async function reset() {
    // A reset would otherwise count as clearing every setting, and sync would carry that to your other devices.
    turnOff()
    resetEverything()
    await clearCache()
    setNote({ tone: 'ok', text: 'Flow is back to a fresh start.' })
  }

  return (
    <>
      <SyncGroup />
      <Group footer="Settings, sign-ins, your watchlist, favourites and progress, as one JSON file. Import replaces what the file contains and leaves the rest alone.">
        <Row label="Export" detail="Settings and library">
          <button type="button" className="btn btn-secondary btn-compact" onClick={exportBackup}>
            <Icon name="download" size={16} /> Export
          </button>
        </Row>
        <Row label="Import" detail="From a Flow backup">
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => file.current?.click()}>
            <Icon name="upload" size={16} /> Import
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importBackup(e.target.files?.[0])} />
        </Row>
      </Group>
      <Group title="On This Device" footer="Each button clears one thing here and leaves the rest. Clearing the cache never touches your library.">
        <Row label="Cached Shelves and Details" detail="Kept so screens open at once">
          <ConfirmButton label="Clear" confirm="Clear Cache" onConfirm={() => void clearCache()} />
        </Row>
        <Row label="Watch History" detail={history ? `${items(history)} watched` : 'Nothing watched yet'}>
          <ConfirmButton label="Clear" confirm="Clear History" disabled={!history} onConfirm={() => (library.clearHistory(), setNote({ tone: 'ok', text: 'Cleared your watch history.' }))} />
        </Row>
        <Row label="Watch Progress" detail={progress ? `Resume points for ${items(progress)}` : 'No resume points'}>
          <ConfirmButton
            label="Reset"
            confirm="Reset Progress"
            disabled={!progress}
            onConfirm={() => (library.resetProgress(), setNote({ tone: 'ok', text: 'Cleared your resume points. Continue Watching is empty; what you watched stays in History.' }))}
          />
        </Row>
        <Row label="Watchlist" detail={watchlist ? items(watchlist) : 'Nothing on it'}>
          <ConfirmButton label="Clear" confirm="Clear Watchlist" disabled={!watchlist} onConfirm={() => (library.clearWatchlist(), setNote({ tone: 'ok', text: 'Cleared your watchlist. Favourites and History are untouched.' }))} />
        </Row>
        <Row label="Remembered Sources" detail={remembered ? `Last source for ${items(remembered)}` : 'None remembered'}>
          <ConfirmButton
            label="Forget"
            confirm="Forget Sources"
            disabled={!remembered}
            onConfirm={() => (lastSources.forgetAll(), setRemembered(0), setNote({ tone: 'ok', text: 'Forgot the sources titles last played from. The picker chooses afresh.' }))}
          />
        </Row>
      </Group>
      <Group footer="Also turns sync off on this device. What is already synced stays where it is.">
        <Row label="Everything on This Device" detail="Settings, sign-ins, library and cache">
          <ConfirmButton label="Reset Everything" confirm="Reset" onConfirm={() => void reset()} />
        </Row>
      </Group>
      {note && <Note tone={note.tone}>{note.text}</Note>}
    </>
  )
}
