import { compactSetup, exportSetup, extrasFrom, parseSetup, settingsFromSetup, setupToJSON, setupToLink, summariseSetup, type SetupBundle, type SetupSummary } from '../../lib/setup/codec'
import { setupExtrasStore } from '../../lib/setup/extras'
import { defaultSettings, settingsStore, type Settings } from '../../lib/store/settings'
import { applyBackup, parseBackup, readSettings } from './backup'

/* Export Setup and Import Setup in Settings → Data, and "I have a setup from another device" on Welcome: the apps'
   `flow-setup` file, read and written by lib/setup/codec.ts, with the website's own settings rules on top. The
   website's full backup (library, Trakt sign-in) stays alongside it in backup.ts. */

/** The setup file to save, as text, and the link the apps paste. */
export function createSetup(includeSecrets: boolean, settings: Settings = settingsStore.get(), now = new Date()) {
  const bundle = exportSetup(settings, { includeSecrets, extras: setupExtrasStore.get(), now })
  return { json: setupToJSON(bundle), link: setupToLink(bundle), qrLink: qrLinkFor(bundle, includeSecrets, now), filename: `flow-setup-${now.toISOString().slice(0, 10)}.json` }
}

/** The link for the QR code: the setup without what is already the default, which is most of a typical setup's size. */
function qrLinkFor(bundle: SetupBundle, includeSecrets: boolean, now: Date) {
  return setupToLink(compactSetup(bundle, exportSetup(defaultSettings, { includeSecrets, now })))
}

export type ReadSetup = { ok: true; bundle: SetupBundle; settings: Partial<Settings>; cleared: (keyof Settings)[]; skipped: string[]; summary: SetupSummary } | { ok: false; error: string }

/** What importing this text would change, or why it can't. Nothing is applied yet. */
export function readSetup(input: string, current: Settings = settingsStore.get()): ReadSetup {
  const parsed = parseSetup(input)
  if (!parsed.ok) return parsed
  const patch = settingsFromSetup(parsed.bundle, current)
  // A setting the file clears (no Seerr in it) is undefined in the patch, which the readers would skip.
  const cleared = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] === undefined) as (keyof Settings)[]
  const present = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const { settings, skipped } = readSettings(present)
  if (Object.keys(settings).length === 0 && cleared.length === 0) return { ok: false, error: 'That setup is empty. Choose a file from Share Setup in the apps or Export Setup on the website.' }
  return { ok: true, bundle: parsed.bundle, settings, cleared, skipped, summary: summariseSetup(parsed.bundle) }
}

/** Replaces the settings the setup holds, and remembers what the website can't show of it so an export gives it back. */
export function applySetup(read: Extract<ReadSetup, { ok: true }>) {
  const clear = Object.fromEntries(read.cleared.map((k) => [k, undefined]))
  // A key arriving is a way in: Welcome has nothing left to ask for.
  const way = read.settings.tmdbKey ? { demo: false, onboarded: true } : {}
  settingsStore.set({ ...clear, ...read.settings, ...way })
  setupExtrasStore.set(extrasFrom(read.bundle, settingsStore.get()))
}

/** Welcome takes either file: the apps' setup, or the website's own backup (settings, library and sign-ins). */
export function importAnything(input: string): { ok: true; what: string } | { ok: false; error: string } {
  const setup = readSetup(input)
  if (setup.ok) {
    applySetup(setup)
    return { ok: true, what: 'setup' }
  }
  const backup = parseBackup(input)
  if (backup.ok) {
    applyBackup(backup)
    if (backup.settings.tmdbKey) settingsStore.set({ demo: false, onboarded: true })
    return { ok: true, what: 'backup' }
  }
  return setup
}
