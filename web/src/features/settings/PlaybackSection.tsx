import { useEffect, useState, type FormEvent } from 'react'
import { proxyProblem } from '../../lib/sources/proxy'
import { settingsStore, useSettings, type Settings, type SubtitleMode } from '../../lib/store/settings'
import { Group, Note, Row, Select, Switch } from './controls'
import { SubtitleStyleGroup } from './SubtitleStyleGroup'
import { audioChoices, subtitleChoices, withCurrent } from './options'
import s from './SettingsScreen.module.css'

const qualities: { value: Settings['preferredQuality']; label: string }[] = [
  { value: '2160p', label: '4K' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'any', label: 'Best Available' },
]

/** Where the proxy's own instructions live, when this build knows the repository it came from
 *  (vite.config.ts reads it from CI); otherwise the footer just names the folder. */
const proxyGuide = import.meta.env.VITE_PROXY_GUIDE as string | undefined

/** The address of a proxy Flow fetches blocked files through. Saved on Save, so a half-typed
 *  address never reaches playback. */
function StreamProxy() {
  const saved = useSettings((x) => x.streamProxy)
  const [value, setValue] = useState(saved)
  const [problem, setProblem] = useState<string>()
  // An address that arrives from another device (Flow Sync) shows here at once.
  useEffect(() => {
    setValue(saved)
  }, [saved])

  function submit(event: FormEvent) {
    event.preventDefault()
    const found = proxyProblem(value)
    setProblem(found)
    if (!found) settingsStore.set({ streamProxy: value.trim() })
  }

  return (
    <Group
      title="Stream Proxy"
      footer={
        <>
          Most debrid download servers don’t let web pages read their files, so Flow can’t pick or convert their audio. A stream proxy you run fetches such files for Flow. Put <code>{'{url}'}</code> where the
          file’s address goes, like <code>https://proxy.example.com/?url={'{url}'}</code>. MediaFlow Proxy works too:{' '}
          <code>https://mediaflow.example.com/proxy/stream?d={'{url}'}&amp;api_password=…</code>. Flow includes a Cloudflare Worker you can deploy yourself:{' '}
          {proxyGuide ? (
            <a href={proxyGuide} target="_blank" rel="noreferrer">
              read how in web/proxy
            </a>
          ) : (
            <>see web/proxy in Flow’s source</>
          )}
          .
        </>
      }
    >
      <form className={s.inline} onSubmit={submit}>
        <input
          id="stream-proxy"
          className="field"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setProblem(undefined)
          }}
          placeholder="https://proxy.example.com/?url={url}"
          aria-label="Stream proxy address"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button className="btn btn-primary btn-compact" type="submit" disabled={value.trim() === saved}>
          Save
        </button>
      </form>
      {problem && (
        <div className={s.pad}>
          <Note tone="error">{problem}</Note>
        </div>
      )}
      {!problem && saved && value.trim() === saved && (
        <div className={s.pad}>
          <Note tone="ok">Flow uses this proxy for files from hosts that block web pages.</Note>
        </div>
      )}
    </Group>
  )
}

const subtitleModes: { value: SubtitleMode; label: string }[] = [
  { value: 'foreign', label: 'Foreign Audio Only' },
  { value: 'always', label: 'Always' },
  { value: 'off', label: 'Off' },
]

export function PlaybackSection() {
  const quality = useSettings((x) => x.preferredQuality)
  const audioLanguages = useSettings((x) => x.audioLanguages)
  const subtitles = useSettings((x) => x.subtitleLanguages)
  const subtitleMode = useSettings((x) => x.subtitleMode)
  const autoplay = useSettings((x) => x.autoplayNext)
  const remember = useSettings((x) => x.rememberLastSource)
  const audioFirst = audioLanguages[0] ?? ''
  const audioSecond = audioLanguages[1] ?? ''
  const first = subtitles[0] ?? ''
  const second = subtitles[1] ?? ''

  // The list is kept without gaps: choosing none for the first language drops the second too.
  const setSubtitles = (a: string, b: string) => settingsStore.set({ subtitleLanguages: [a, b].filter((x, i, all) => x && all.indexOf(x) === i) })
  const setAudio = (a: string, b: string) => settingsStore.set({ audioLanguages: [a, b].filter((x, i, all) => x && all.indexOf(x) === i) })
  const audioOptions = (current: string, none: string) => [{ value: '', label: none }, ...(current ? withCurrent(audioChoices, current) : audioChoices)]
  const options = (current: string) => [{ value: '', label: 'None' }, ...(current ? withCurrent(subtitleChoices, current) : subtitleChoices)]

  return (
    <>
      <Group footer="The picker puts this resolution first when a title has it, and falls back to the next best. Anything the browser can’t play is marked and never chosen for you.">
        <Row label="Preferred Quality" htmlFor="quality">
          <Select id="quality" label="Preferred quality" value={quality} onChange={(v) => settingsStore.set({ preferredQuality: v })} options={qualities} />
        </Row>
        <Row label="Remember Last Source" detail="Offer the source a title was last played from first">
          <Switch label="Remember last source" checked={remember} onChange={(on) => settingsStore.set({ rememberLastSource: on })} />
        </Row>
      </Group>
      <Group footer="Flow starts each title on the first of these it has, and never on commentary. Original Language is the one the title was made in. A track you choose in the player is remembered for that title or show.">
        <Row label="Audio Language" htmlFor="audio-1">
          <Select id="audio-1" label="Audio language" value={audioFirst} onChange={(v) => setAudio(v, v ? audioSecond : '')} options={audioOptions(audioFirst, 'Stream Default')} />
        </Row>
        <Row label="Second Choice" htmlFor="audio-2">
          <Select id="audio-2" label="Second choice for audio" value={audioSecond} onChange={(v) => setAudio(audioFirst, v)} options={audioOptions(audioSecond, 'None')} disabled={!audioFirst} />
        </Row>
      </Group>
      <Group footer="Foreign Audio Only turns subtitles on when the audio isn’t in your Subtitle Language. Always turns them on for every title that has them in your languages.">
        <Row label="Show Subtitles" htmlFor="subtitle-mode">
          <Select id="subtitle-mode" label="When to show subtitles" value={subtitleMode} onChange={(v) => settingsStore.set({ subtitleMode: v })} options={subtitleModes} />
        </Row>
        <Row label="Subtitle Language" htmlFor="subtitle-1">
          <Select id="subtitle-1" label="Subtitle language" value={first} onChange={(v) => setSubtitles(v, v ? second : '')} options={options(first)} />
        </Row>
        <Row label="Second Choice" htmlFor="subtitle-2">
          <Select id="subtitle-2" label="Second choice for subtitles" value={second} onChange={(v) => setSubtitles(first, v)} options={options(second)} disabled={!first} />
        </Row>
      </Group>
      <SubtitleStyleGroup />
      <Group footer="Shows start the next episode when one ends, with a countdown you can cancel.">
        <Row label="Autoplay Next Episode">
          <Switch label="Autoplay next episode" checked={autoplay} onChange={(on) => settingsStore.set({ autoplayNext: on })} />
        </Row>
      </Group>
      <StreamProxy />
    </>
  )
}
