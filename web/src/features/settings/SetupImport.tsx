import { useRef, useState, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { parseBackup } from './backup'
import { applySetup, importAnything, readSetup, type ReadSetup } from './setup'
import s from './SetupImport.module.css'

/* Reading a setup: choose the file or paste its link, see what it holds, then let it replace the matching settings.
   Used in Settings → Data and on Welcome, where `backups` also lets the website's own backup file through. */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** `link` is a setup that arrived by address (#setup=): it is read at once, so the review is the first thing shown. */
export function SetupImport({ backups = false, link, onImported, onCancel }: { backups?: boolean; link?: string; onImported: (message: string) => void; onCancel?: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [paste, setPaste] = useState<string>()
  const [first] = useState(() => (link ? readSetup(link) : undefined))
  const [error, setError] = useState<string | undefined>(first && !first.ok ? first.error : undefined)
  const [read, setRead] = useState<Extract<ReadSetup, { ok: true }> | undefined>(first?.ok ? first : undefined)

  function take(input: string) {
    setError(undefined)
    const result = readSetup(input)
    if (result.ok) return setRead(result)
    // Welcome also takes the website's backup, which has no review step: it is the person's own data coming back.
    if (backups && parseBackup(input).ok) {
      const done = importAnything(input)
      return done.ok ? onImported('Restored your backup.') : setError(done.error)
    }
    setError(result.error)
  }

  async function choose(chosen: File | undefined) {
    if (!chosen) return
    try {
      take(await chosen.text())
    } catch {
      setError('Couldn’t read that file. Choose a setup exported from Marquee or shared from the Marquee apps.')
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (paste?.trim()) take(paste)
  }

  if (read) {
    const { summary, skipped } = read
    const rows: [string, string][] = [
      ['Shelves', String(summary.shelves)],
      ['Media Servers', String(summary.servers)],
      ['WebDAV Shares', String(summary.webDAV)],
      ['IPTV Providers', String(summary.providers)],
      ['Stream Add-ons', String(summary.addons)],
      ['API Keys', summary.hasKeys ? 'Included' : 'Not included'],
    ]
    if (summary.exportedAt) rows.push(['Exported', summary.exportedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })])
    return (
      <div className={s.box}>
        <h4 className={s.heading}>This setup contains</h4>
        <dl className={s.summary}>
          {rows.map(([label, value]) => (
            <div key={label} className={s.line}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {skipped.length > 0 && <p className={s.error}>Skipped what couldn’t be read: {skipped.join(', ')}.</p>}
        <p className={s.hint}>Keys, tokens and passwords already on this device are kept unless the setup includes new ones.</p>
        <div className={s.actions}>
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={() => {
              applySetup(read)
              onImported(`Imported ${plural(summary.shelves, 'shelf', 'shelves')}, ${plural(summary.servers, 'server', 'servers')} and the rest of the setup.`)
            }}
          >
            Import and Replace My Setup
          </button>
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => (setRead(undefined), onCancel?.())}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={s.box}>
      <div className={s.actions}>
        <button type="button" className="btn btn-secondary btn-compact" onClick={() => file.current?.click()}>
          <Icon name="upload" size={16} /> Choose File
        </button>
        <input ref={file} type="file" accept="application/json,.json,text/plain" hidden onChange={(e) => void choose(e.target.files?.[0])} />
        <button type="button" className="btn btn-secondary btn-compact" aria-expanded={paste !== undefined} onClick={() => setPaste((v) => (v === undefined ? '' : undefined))}>
          <Icon name="copy" size={16} /> Paste Link
        </button>
        {onCancel && (
          <button type="button" className="btn btn-quiet btn-compact" onClick={onCancel}>
            Back
          </button>
        )}
      </div>
      {paste !== undefined && (
        <form className={s.paste} onSubmit={submit}>
          <input className="field" value={paste} onChange={(e) => (setPaste(e.target.value), setError(undefined))} placeholder="flow://setup?d=… or the setup’s JSON" aria-label="Setup link or JSON" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus />
          <button className="btn btn-primary btn-compact" type="submit" disabled={!paste.trim()}>
            Read Setup
          </button>
        </form>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <p className={s.hint}>Choose a setup file from Share Setup in the apps or Export Setup on the website, or paste its link.</p>
    </div>
  )
}
