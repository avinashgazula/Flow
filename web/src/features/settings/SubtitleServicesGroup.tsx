import { useState } from 'react'
import { normaliseSubtitleOptions, hasCredentials, credentialsOf } from '../../lib/subtitles/options'
import { providerIds, providerNames, type ProviderId } from '../../lib/subtitles/types'
import { settingsStore, useSettings, type Settings } from '../../lib/store/settings'
import { Group, Row, Switch } from './controls'
import s from './SettingsScreen.module.css'

type KeyField = 'openSubtitlesKey' | 'openSubtitlesUsername' | 'openSubtitlesPassword' | 'subdlKey' | 'subSourceKey' | 'wyzieKey'

const fields: { field: KeyField; label: string; id: string; secret: boolean; placeholder: string }[] = [
  { field: 'openSubtitlesKey', label: 'OpenSubtitles API Key', id: 'os-key', secret: true, placeholder: 'Paste your key' },
  { field: 'openSubtitlesUsername', label: 'OpenSubtitles Username', id: 'os-user', secret: false, placeholder: 'Optional' },
  { field: 'openSubtitlesPassword', label: 'OpenSubtitles Password', id: 'os-pass', secret: true, placeholder: 'Optional' },
  { field: 'subdlKey', label: 'SubDL API Key', id: 'subdl-key', secret: true, placeholder: 'Paste your key' },
  { field: 'wyzieKey', label: 'Wyzie API Key', id: 'wyzie-key', secret: true, placeholder: 'Paste your free key' },
  { field: 'subSourceKey', label: 'SubSource API Key', id: 'subsource-key', secret: true, placeholder: 'Paste your key' },
]

/** What is special about each service on the website, one line under its switch. */
const notes: Record<ProviderId, string | undefined> = {
  opensubtitles: 'Downloads go through your stream proxy',
  subdl: undefined,
  wyzie: undefined,
  subsource: 'Works in the apps only',
}
const needs = (id: ProviderId) => (id === 'wyzie' ? 'Needs a free API key' : 'Needs an API key')

const links = (
  <>
    <a href="https://www.opensubtitles.com/consumers" target="_blank" rel="noreferrer">
      opensubtitles.com
    </a>
    ,{' '}
    <a href="https://subdl.com/panel/api" target="_blank" rel="noreferrer">
      subdl.com
    </a>
    ,{' '}
    <a href="https://store.wyzie.io/redeem" target="_blank" rel="noreferrer">
      store.wyzie.io
    </a>{' '}
    and{' '}
    <a href="https://subsource.net" target="_blank" rel="noreferrer">
      subsource.net
    </a>
  </>
)

/** Which subtitle services the player's Search Subtitles asks, and the keys and logins they need. */
export function SubtitleServicesGroup() {
  const saved = useSettings((x) => x)
  const options = normaliseSubtitleOptions(saved.subtitleOptions)
  const credentials = credentialsOf(saved)
  const [draft, setDraft] = useState<Partial<Record<KeyField, string>>>({})
  const value = (f: KeyField) => draft[f] ?? saved[f] ?? ''
  const changed = fields.some(({ field }) => value(field).trim() !== (saved[field] ?? ''))

  const toggle = (id: ProviderId, on: boolean) => {
    const providers = providerIds.filter((p) => (p === id ? on : options.providers.includes(p)))
    settingsStore.set({ subtitleOptions: { ...options, providers } })
  }
  const save = () => {
    if (!changed) return
    const patch: Partial<Settings> = {}
    for (const { field } of fields) {
      const next = value(field).trim()
      // Cleared fields go back to absent, which is how the settings begin.
      if (next !== (saved[field] ?? '')) Object.assign(patch, { [field]: next || undefined })
    }
    settingsStore.set(patch)
    setDraft({})
  }

  return (
    <>
      <Group
        title="Subtitle Services"
        footer="Search Subtitles in the player asks every service that is on and has a key, and lists what they have in your languages. A service without a key is skipped."
      >
        {providerIds.map((id) => (
          <Row key={id} label={providerNames[id]} detail={[hasCredentials(id, credentials) ? 'Key saved' : needs(id), notes[id]].filter(Boolean).join('. ')}>
            <Switch label={`Search ${providerNames[id]}`} checked={options.providers.includes(id)} onChange={(on) => toggle(id, on)} />
          </Row>
        ))}
      </Group>
      <Group
        title="Subtitle Keys"
        footer={
          <>
            Get keys at {links}. They sync with the apps, apart from Wyzie’s, which the apps have no place for. OpenSubtitles keeps its downloads on a host that blocks web pages, so they are fetched through your stream proxy below, with{' '}
            <code>www.opensubtitles.com</code> and <code>dl.opensubtitles.org</code> in its allowed hosts. OpenSubtitles doesn’t let a web page send the login, so here downloads count against the key’s own daily limit, and the username and password are kept for the apps. SubSource doesn’t let web pages read its answers at all, so its key is kept for the apps.
          </>
        }
      >
        {fields.map(({ field, label, id, secret, placeholder }) => (
          <Row key={field} label={label} htmlFor={id} stacked>
            <input
              id={id}
              className="field"
              type={secret ? 'password' : 'text'}
              value={value(field)}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder={placeholder}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </Row>
        ))}
        <div className={s.saveRow}>
          <button className="btn btn-primary btn-compact" type="button" onClick={save} disabled={!changed}>
            Save
          </button>
        </div>
      </Group>
    </>
  )
}
