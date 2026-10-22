import { useState, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { addonHost, fetchManifest, providesStreams } from '../../lib/sources/addons'
import { SourceError } from '../../lib/sources/http'
import { settingsStore, useSettings, type AddonConfig } from '../../lib/store/settings'
import { ConfirmButton, Group, Note, Switch } from './controls'
import s from './SettingsScreen.module.css'

const typeNames: Record<string, string> = { movie: 'Movies', series: 'Series', tv: 'Live TV', channel: 'Channels', anime: 'Anime' }

function update(url: string, patch: Partial<AddonConfig>) {
  settingsStore.set((st) => ({ addons: st.addons.map((a) => (a.url === url ? { ...a, ...patch } : a)) }))
}

function move(url: string, delta: number) {
  settingsStore.set((st) => {
    const list = [...st.addons]
    const i = list.findIndex((a) => a.url === url)
    const j = i + delta
    if (i < 0 || j < 0 || j >= list.length) return {}
    ;[list[i], list[j]] = [list[j]!, list[i]!]
    return { addons: list }
  })
}

export function AddonsSection() {
  const addons = useSettings((x) => x.addons)
  const [text, setText] = useState('')
  const [state, setState] = useState<{ kind: 'idle' | 'installing' } | { kind: 'error' | 'done'; message: string }>({ kind: 'idle' })

  async function install(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setState({ kind: 'installing' })
    try {
      const { url, manifest } = await fetchManifest(text)
      if (!providesStreams(manifest)) throw new SourceError(`${manifest.name} doesn’t provide streams, so Flow can’t use it. Install an add-on that does, such as AIOStreams.`)
      if (settingsStore.get().addons.some((a) => a.url === url)) throw new SourceError(`${manifest.name} is already installed.`)
      settingsStore.set((st) => ({ addons: [...st.addons, { url, name: manifest.name, enabled: true, manifest }] }))
      setText('')
      setState({ kind: 'done', message: `Installed ${manifest.name}.` })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof SourceError ? error.message : error instanceof TypeError ? 'That doesn’t look like an add-on address. Paste the manifest link from its configure page.' : 'Couldn’t install that add-on. Try again.' })
    }
  }

  return (
    <>
      {addons.length > 0 && (
        <Group title="Installed" footer="Sources are asked in this order; the picker ranks what they find. The address of an add-on can hold your debrid key, so only its host is shown.">
          {addons.map((addon, i) => {
            const m = addon.manifest
            const types = (m?.types ?? []).map((t) => typeNames[t] ?? t).join(' · ')
            return (
              <div key={addon.url} className={s.item}>
                {m?.logo ? <img className={s.logo} src={m.logo} alt="" loading="lazy" decoding="async" /> : <span className={s.logo} aria-hidden><Icon name="link" size={18} /></span>}
                <span className={s.itemText}>
                  <span className={s.itemTitle}>
                    {addon.name}
                    {m?.version && <span className={s.itemVersion}>{m.version}</span>}
                  </span>
                  <span className={s.itemDetail}>{[types, addonHost(addon.url)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={s.itemActions}>
                  <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={() => move(addon.url, -1)} disabled={i === 0} aria-label={`Move ${addon.name} up`}>
                    <Icon name="chevronUp" size={16} strokeWidth={2.4} />
                  </button>
                  <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={() => move(addon.url, 1)} disabled={i === addons.length - 1} aria-label={`Move ${addon.name} down`}>
                    <Icon name="chevronDown" size={16} strokeWidth={2.4} />
                  </button>
                  <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={() => void navigator.clipboard?.writeText(addon.url)} aria-label={`Copy ${addon.name}’s manifest URL`}>
                    <Icon name="copy" size={16} />
                  </button>
                  <Switch checked={addon.enabled} onChange={(on) => update(addon.url, { enabled: on })} label={`Use ${addon.name}`} />
                </span>
                <span className={s.itemRemove}>
                  <ConfirmButton label="Remove" confirm={`Remove ${addon.name}`} onConfirm={() => settingsStore.set((st) => ({ addons: st.addons.filter((a) => a.url !== addon.url) }))} />
                </span>
              </div>
            )
          })}
        </Group>
      )}
      <Group title="Add an Add-on" footer="Paste the manifest link from a Stremio-compatible add-on’s configure page (for example AIOStreams). stremio:// links work too. Only add-ons that provide streams are used, and torrent results need a debrid service set up in the add-on.">
        <form className={s.inline} onSubmit={install}>
          <input
            className="field"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (state.kind !== 'installing') setState({ kind: 'idle' })
            }}
            placeholder="https://…/manifest.json"
            aria-label="Manifest URL"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-primary btn-compact" type="submit" disabled={!text.trim() || state.kind === 'installing'}>
            {state.kind === 'installing' ? 'Installing…' : 'Install'}
          </button>
        </form>
        {(state.kind === 'error' || state.kind === 'done') && (
          <div className={s.pad}>
            <Note tone={state.kind === 'error' ? 'error' : 'ok'}>{state.message}</Note>
          </div>
        )}
      </Group>
    </>
  )
}
