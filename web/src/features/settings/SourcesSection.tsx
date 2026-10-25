import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { addonHost } from '../../lib/sources/addons'
import { fixedCapabilities } from '../../lib/sources/capabilities'
import { effectiveProviderOrder, moveWithin } from '../../lib/sources/order'
import { parseStream } from '../../lib/sources/parser'
import { buildSource } from '../../lib/sources/rank'
import {
  badgeSets,
  categoryNames,
  defaultSortRules,
  maxSizes,
  minResolutions,
  minSizes,
  normaliseSourceOrdering,
  resultCaps,
  sortKeys,
  titleDisplays,
  type BadgeSet,
  type SourceCategory,
  type SourceFilters,
  type SourceOrdering,
  type SourceSortKey,
  type SourceTitleDisplay,
} from '../../lib/sources/sourceSettings'
import { demoProviderId } from '../../lib/sources/demo'
import { settingsStore, useSettings } from '../../lib/store/settings'
import picker from '../sources/SourcePicker.module.css'
import { SourceRow } from '../sources/SourceRow'
import { Group, Row, Select, Switch } from './controls'
import s from './SettingsScreen.module.css'

/* Settings → Sources: how the sources a title offers are ordered, filtered and shown. The same choices as the
   apps' Sources and Source Appearance pages, in the same words. */

/** The categories this browser has providers for. WebDAV and IPTV keep their places in the saved order. */
const shownCategories: SourceCategory[] = ['mediaServers', 'addons']
const serverKinds = { jellyfin: 'Jellyfin', emby: 'Emby', plex: 'Plex' }

/** Changes the saved ordering from its latest value, so two quick changes never undo each other. */
function change(fn: (current: SourceOrdering) => SourceOrdering) {
  settingsStore.set((st) => ({ sources: fn(normaliseSourceOrdering(st.sources)) }))
}
const changeFilters = (patch: Partial<SourceFilters>) => change((o) => ({ ...o, filters: { ...o.filters, ...patch } }))
const changeLook = (patch: Partial<SourceOrdering['appearance']>) => change((o) => ({ ...o, appearance: { ...o.appearance, ...patch } }))

interface Provider {
  id: string
  name: string
  detail: string
}

/** Every add-on and server in a category, in the order the viewer set (the order they were added, until then). */
function useProviders(ordering: SourceOrdering): Record<SourceCategory, Provider[]> {
  const addons = useSettings((x) => x.addons)
  const servers = useSettings((x) => x.servers)
  const demo = useSettings((x) => x.demo)
  return useMemo(() => {
    const natural: Record<SourceCategory, Provider[]> = {
      mediaServers: servers.map((v) => ({ id: v.id, name: v.name, detail: [serverKinds[v.kind], v.enabled ? '' : 'Off'].filter(Boolean).join(' · ') })),
      webDAV: [],
      iptv: [],
      addons: [
        ...(demo ? [{ id: demoProviderId, name: 'AIOStreams', detail: 'Sample data' }] : []),
        ...addons.map((a) => ({ id: a.url, name: a.name, detail: [addonHost(a.url), a.enabled ? '' : 'Off'].filter(Boolean).join(' · ') })),
      ],
    }
    const out = { ...natural }
    for (const category of shownCategories) {
      const order = effectiveProviderOrder(natural[category].map((p) => p.id), ordering.providerOrder[category])
      out[category] = order.map((id) => natural[category].find((p) => p.id === id)!)
    }
    return out
  }, [addons, servers, demo, ordering.providerOrder])
}

/** Up and down buttons for a row in an ordered list. The pressed button keeps focus when the row moves, or
 *  its opposite does when the row has reached an end. */
function useMoveFocus(deps: unknown) {
  const next = useRef<string>(undefined)
  useEffect(() => {
    const key = next.current
    next.current = undefined
    if (!key) return
    const [name, direction] = [key.slice(0, -2), key.slice(-2)]
    const find = (d: string) => document.querySelector<HTMLButtonElement>(`[data-move="${CSS.escape(name + d)}"]`)
    const press = find(direction)
    ;(press && !press.disabled ? press : find(direction === ':1' ? ':0' : ':1'))?.focus()
  }, [deps])
  return (name: string, direction: -1 | 1) => void (next.current = `${name}${direction === 1 ? ':1' : ':0'}`)
}

function MoveButtons({ name, label, index, count, onMove }: { name: string; label: string; index: number; count: number; onMove: (delta: -1 | 1) => void }) {
  return (
    <>
      <button type="button" data-move={`${name}:0`} className="btn btn-secondary btn-circle btn-compact" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${label} up`}>
        <Icon name="chevronUp" size={16} strokeWidth={2.4} />
      </button>
      <button type="button" data-move={`${name}:1`} className="btn btn-secondary btn-circle btn-compact" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${label} down`}>
        <Icon name="chevronDown" size={16} strokeWidth={2.4} />
      </button>
    </>
  )
}

/** A comma-separated list in a text field. What is typed stays as typed; the list behind it follows. */
function ListField({ id, label, values, placeholder, onChange }: { id: string; label: string; values: string[]; placeholder: string; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join(', '))
  const saved = values.join('\u0000')
  const typed = useRef(saved)
  // A list that arrives from elsewhere (a backup, another tab) shows at once; the viewer's own typing doesn't reset.
  useEffect(() => {
    if (saved !== typed.current) setText(values.join(', '))
    typed.current = saved
  }, [saved, values])
  return (
    <Row label={label} htmlFor={id} stacked>
      <input
        id={id}
        className="field"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          const list = e.target.value.split(',').map((x) => x.trim()).filter(Boolean)
          typed.current = list.join('\u0000')
          onChange(list)
        }}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </Row>
  )
}

const sizeOptions = (current: number | null, list: number[], none: string) => {
  const values = current && !list.includes(current) ? [...list, current].sort((a, b) => a - b) : list
  return [{ value: '', label: none }, ...values.map((v) => ({ value: String(v), label: `${v} GB` }))]
}
const capOptions = (current: number | null) => {
  const values = current && !resultCaps.includes(current) ? [...resultCaps, current].sort((a, b) => a - b) : resultCaps
  return [{ value: '', label: 'No Limit' }, ...values.map((v) => ({ value: String(v), label: `${v} sources` }))]
}

export function SourcesSection() {
  const saved = useSettings((x) => x.sources)
  const o = useMemo(() => normaliseSourceOrdering(saved), [saved])
  const providers = useProviders(o)
  const [announce, setAnnounce] = useState('')
  const focusAfter = useMoveFocus(saved)

  const f = o.filters
  const unusedKeys = sortKeys.filter((k) => !o.sortRules.some((r) => r.key === k.key))
  const isDefaultRules = o.sortRules.length === 4 && o.sortRules.every((r, i) => r.key === defaultSortRules()[i]!.key && r.descending)
  const titleOf = (key: SourceSortKey) => sortKeys.find((k) => k.key === key)!.title

  function moveCategory(category: SourceCategory, delta: -1 | 1) {
    // Only the categories shown here trade places with each other; the ones the browser has no providers for stay put.
    focusAfter(category, delta)
    change((c) => {
      const slots = c.categoryOrder.flatMap((x, i) => (shownCategories.includes(x) ? [i] : []))
      const shown = moveWithin(slots.map((i) => c.categoryOrder[i]!), slots.map((i) => c.categoryOrder[i]!).indexOf(category), delta)
      const order = [...c.categoryOrder]
      slots.forEach((slot, n) => (order[slot] = shown[n]!))
      return { ...c, categoryOrder: order }
    })
    setAnnounce(`${categoryNames[category]} moved ${delta === -1 ? 'up' : 'down'}.`)
  }
  function moveProvider(category: SourceCategory, id: string, name: string, delta: -1 | 1) {
    focusAfter(id, delta)
    const ids = providers[category].map((p) => p.id)
    change((c) => ({ ...c, providerOrder: { ...c.providerOrder, [category]: moveWithin(ids, ids.indexOf(id), delta) } }))
    setAnnounce(`${name} moved ${delta === -1 ? 'up' : 'down'}.`)
  }
  function moveRule(key: SourceSortKey, delta: -1 | 1) {
    focusAfter(`rule-${key}`, delta)
    change((c) => ({ ...c, sortRules: moveWithin(c.sortRules, c.sortRules.findIndex((r) => r.key === key), delta) }))
    setAnnounce(`${titleOf(key)} moved ${delta === -1 ? 'up' : 'down'}.`)
  }

  return (
    <>
      <Group footer="Adds the sort rules, filters and result cap below. Category and provider order apply whether this is on or off. Preferred Quality in Playback still decides which resolution leads.">
        <Row label="Use Custom Source Ordering">
          <Switch checked={o.useCustomOrdering} onChange={(on) => change((c) => ({ ...c, useCustomOrdering: on }))} label="Use Custom Source Ordering" />
        </Row>
      </Group>

      <Group title="Category Order" footer="Sources from earlier categories appear first in the picker. Providers inside a category are ordered below. Category and provider order work on their own: the switch above is only for the sort rules, filters and result cap.">
        {shownCategories
          .slice()
          .sort((a, b) => o.categoryOrder.indexOf(a) - o.categoryOrder.indexOf(b))
          .map((category, i, all) => {
            const count = providers[category].length
            return (
              <Row key={category} label={categoryNames[category]} detail={count === 0 ? 'Not configured' : `${count} provider${count === 1 ? '' : 's'}`}>
                <MoveButtons name={category} label={categoryNames[category]} index={i} count={all.length} onMove={(d) => moveCategory(category, d)} />
              </Row>
            )
          })}
      </Group>

      {shownCategories
        .slice()
        .sort((a, b) => o.categoryOrder.indexOf(a) - o.categoryOrder.indexOf(b))
        .filter((category) => providers[category].length > 0)
        .map((category) => (
          <Group key={category} title={`${categoryNames[category]} Order`}>
            {providers[category].map((p, i, all) => (
              <Row key={p.id} label={p.name} detail={p.detail}>
                <MoveButtons name={p.id} label={p.name} index={i} count={all.length} onMove={(d) => moveProvider(category, p.id, p.name, d)} />
              </Row>
            ))}
          </Group>
        ))}

      {o.useCustomOrdering && (
        <>
          <Group
            title="Sort Rules"
            footer="Applied top to bottom within each provider. Resolution follows your Preferred Quality: the quality you chose first, then higher ones, then lower. A source this browser can’t play stays last, whatever the rules say."
          >
            {o.sortRules.map((rule, i) => (
              <Row key={rule.key} label={titleOf(rule.key)}>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => change((c) => ({ ...c, sortRules: c.sortRules.map((r) => (r.key === rule.key ? { ...r, descending: !r.descending } : r)) }))}
                  aria-label={`${titleOf(rule.key)}: ${rule.descending ? 'Best First' : 'Lowest First'}. Change the direction`}
                >
                  {rule.descending ? 'Best First' : 'Lowest First'}
                </button>
                <MoveButtons name={`rule-${rule.key}`} label={`${titleOf(rule.key)} rule`} index={i} count={o.sortRules.length} onMove={(d) => moveRule(rule.key, d)} />
                <button
                  type="button"
                  className="btn btn-secondary btn-circle btn-compact"
                  onClick={() => change((c) => ({ ...c, sortRules: c.sortRules.filter((r) => r.key !== rule.key) }))}
                  aria-label={`Remove the ${titleOf(rule.key)} rule`}
                >
                  <Icon name="close" size={16} strokeWidth={2.4} />
                </button>
              </Row>
            ))}
            {o.sortRules.length === 0 && <Row label="No Rules" detail="Sources keep Flow’s own order within each provider." />}
            {unusedKeys.length > 0 && (
              <Row label="Add a Rule" htmlFor="add-rule">
                <Select
                  id="add-rule"
                  value=""
                  label="Add a rule"
                  options={[{ value: '', label: 'Choose…' }, ...unusedKeys.map((k) => ({ value: k.key, label: k.title }))]}
                  onChange={(key) => key && change((c) => ({ ...c, sortRules: [...c.sortRules, { key: key as SourceSortKey, descending: true }] }))}
                />
              </Row>
            )}
            <Row label="Default Rules" detail="Cached First, Resolution, Release Quality, File Size">
              <button type="button" className="btn btn-secondary btn-compact" disabled={isDefaultRules} onClick={() => change((c) => ({ ...c, sortRules: defaultSortRules() }))}>
                Reset
              </button>
            </Row>
          </Group>

          <Group title="Filters" footer="Sources a filter hides never reach the picker, which says how many it hid. Keywords are matched against the release name and the add-on’s text, ignoring case; separate several with commas. Preferred Languages only changes the order, through the Preferred Language rule.">
            <Row label="Hide CAM / TS / Screeners">
              <Switch checked={f.excludeCinemaCaptures} onChange={(on) => changeFilters({ excludeCinemaCaptures: on })} label="Hide CAM, TS and screeners" />
            </Row>
            <Row label="Hide Uncached Torrents">
              <Switch checked={f.excludeUncached} onChange={(on) => changeFilters({ excludeUncached: on })} label="Hide uncached torrents" />
            </Row>
            <Row label="Minimum Resolution" htmlFor="min-resolution">
              <Select id="min-resolution" value={String(f.minResolution)} label="Minimum resolution" options={minResolutions.map((r) => ({ value: String(r.value), label: r.label }))} onChange={(v) => changeFilters({ minResolution: Number(v) as SourceFilters['minResolution'] })} />
            </Row>
            <Row label="Maximum Size" htmlFor="max-size">
              <Select id="max-size" value={f.maxSizeGB ? String(f.maxSizeGB) : ''} label="Maximum size" options={sizeOptions(f.maxSizeGB, maxSizes, 'No Limit')} onChange={(v) => changeFilters({ maxSizeGB: v ? Number(v) : null })} />
            </Row>
            <Row label="Minimum Size" htmlFor="min-size">
              <Select id="min-size" value={f.minSizeGB ? String(f.minSizeGB) : ''} label="Minimum size" options={sizeOptions(f.minSizeGB, minSizes, 'None')} onChange={(v) => changeFilters({ minSizeGB: v ? Number(v) : null })} />
            </Row>
            <ListField id="exclude-keywords" label="Exclude Keywords" values={f.excludedKeywords} placeholder="hindi, hardcoded" onChange={(v) => changeFilters({ excludedKeywords: v })} />
            <ListField id="require-keywords" label="Require Any Keyword" values={f.requiredKeywords} placeholder="remux, bluray" onChange={(v) => changeFilters({ requiredKeywords: v })} />
            <ListField id="preferred-languages" label="Preferred Languages" values={f.preferredLanguages} placeholder="English, Hindi" onChange={(v) => changeFilters({ preferredLanguages: v })} />
            <ListField id="exclude-codecs" label="Exclude Codecs" values={f.excludedCodecs} placeholder="AV1" onChange={(v) => changeFilters({ excludedCodecs: v })} />
          </Group>

          <Group title="Result Cap" footer="Shows at most this many sources after sorting and filtering.">
            <Row label="Result Cap" htmlFor="result-cap">
              <Select id="result-cap" value={o.resultCap ? String(o.resultCap) : ''} label="Result cap" options={capOptions(o.resultCap)} onChange={(v) => change((c) => ({ ...c, resultCap: v ? Number(v) : null }))} />
            </Row>
          </Group>
        </>
      )}

      <Appearance look={o.appearance} />
      <p className="sr-only" role="status">
        {announce}
      </p>
    </>
  )
}

/** A source row as the picker will draw it, with the current choices. */
function Appearance({ look }: { look: SourceOrdering['appearance'] }) {
  const sample = useMemo(() => {
    const text = 'AIOStreams\n✨ 4K 🎫\nWEB-DL\nDV HDR10\n🔊 DD+ Atmos 5.1\n📦 18.2 GB\n🌎 English • Spanish'
    const name = 'Movie.2026.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.HEVC-GROUP.mkv'
    const caps = fixedCapabilities({ video: ['H264', 'HEVC'], audio: ['AAC', 'DD', 'DD+'] })
    const traits = parseStream(text, name)
    traits.isCached = true
    return buildSource({ id: 'preview', origin: 'addon', provider: 'AIOStreams', providerId: 'preview', title: name, filename: name, detail: text, url: 'https://example.invalid/movie.mkv', traits }, caps)
  }, [])
  const byProvider = look.titleDisplay === 'provider'
  return (
    <>
      <Group
        title="Source Appearance"
        footer="Add-on formatting shows each add-on’s own text, emoji and all. Turn it off for a clean summary read from the release name. Title picks what each row leads with: the provider’s name, which then heads its group, the file name, or the first line of the add-on’s text. Badges print Dolby Vision, HDR and premium audio as edge print: All Formats shows everything a release says, Minimal at most two, None leaves them out."
      >
        <Row label="Show Add-on Formatting">
          <Switch checked={look.showRawText} onChange={(on) => changeLook({ showRawText: on })} label="Show add-on formatting" />
        </Row>
        <Row label="Title" htmlFor="source-title">
          <Select<SourceTitleDisplay> id="source-title" value={look.titleDisplay} label="Title" options={titleDisplays} onChange={(v) => changeLook({ titleDisplay: v })} />
        </Row>
        <Row label="Badges" htmlFor="source-badges">
          <Select<BadgeSet> id="source-badges" value={look.badges} label="Badges" options={badgeSets} onChange={(v) => changeLook({ badges: v })} />
        </Row>
        <Row label="Show File Size">
          <Switch checked={look.showSize} onChange={(on) => changeLook({ showSize: on })} label="Show file size" />
        </Row>
        <Row label="Compact Rows">
          <Switch checked={look.compact} onChange={(on) => changeLook({ compact: on })} label="Compact rows" />
        </Row>
      </Group>
      <Group title="Preview">
        <div className={s.preview} inert aria-hidden>
          {byProvider && (
            <h3 className={picker.group} role="presentation">
              AIOStreams <span className={picker.count}>1</span>
            </h3>
          )}
          <SourceRow source={sample} appearance={look} providerAbove={byProvider} active={false} best={false} lastPlayed={false} divider={false} onPick={() => {}} onHover={() => {}} />
        </div>
      </Group>
    </>
  )
}
