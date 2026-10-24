import { del } from 'idb-keyval'
import { useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { queryClient } from '../../lib/queryClient'
import { library, libraryStore } from '../../lib/store/library'
import { settingsStore } from '../../lib/store/settings'
import { applyBackup, createBackup, parseBackup, resetEverything } from './backup'
import { turnOff } from '../../lib/sync/engine'
import { ConfirmButton, Group, Note, Row } from './controls'
import { SyncGroup } from './SyncGroup'

export function DataSection() {
  const file = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string }>()

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
      <Group footer="The cache holds shelves, title details and search results so screens open at once. Clearing it never touches your library. Reset Everything also turns sync off on this device, and leaves what is synced alone.">
        <Row label="Clear Cache">
          <ConfirmButton label="Clear Cache" confirm="Clear" onConfirm={() => void clearCache()} />
        </Row>
        <Row label="Clear History" detail="Watched titles and episodes">
          <ConfirmButton label="Clear History" confirm="Clear History" onConfirm={() => (library.clearHistory(), setNote({ tone: 'ok', text: 'Cleared your watch history.' }))} />
        </Row>
        <Row label="Reset Everything" detail="Settings, sign-ins, library and cache">
          <ConfirmButton label="Reset Everything" confirm="Reset" onConfirm={() => void reset()} />
        </Row>
      </Group>
      {note && <Note tone={note.tone}>{note.text}</Note>}
    </>
  )
}
