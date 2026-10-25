import { useEffect, useState, type FormEvent } from 'react'
import { proxyProblem } from '../../lib/sources/proxy'
import { settingsStore, useSettings, type Settings, type SkipBehaviour, type SubtitleMode } from '../../lib/store/settings'
import { Group, Note, Row, Select, Switch } from './controls'
import { SubtitleStyleGroup } from './SubtitleStyleGroup'
import { audioChoices, subtitleChoices, withCurrent } from './options'
import { detectPlatform, externalPlayerTitle, playersFor } from '../player/externalPlayers'
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

const skipChoices: { value: SkipBehaviour; label: string }[] = [
  { value: 'button', label: 'Show Button' },
  { value: 'automatic', label: 'Skip Automatically' },
  { value: 'off', label: 'Off' },
]

const stillWatchingChoices: { value: string; label: string }[] = [
  { value: '0', label: 'Never' },
  ...[2, 3, 4, 5].map((n) => ({ value: String(n), label: `After ${n} Episodes` })),
]

/** The IntroDB and PublicMetaDB keys. Saved on Save (or Enter), so a half-typed key is never used. */
function SkipServices() {
  const savedIntro = useSettings((x) => x.introDBKey)
  const savedMeta = useSettings((x) => x.publicMetaDBKey)
  const [intro, setIntro] = useState(savedIntro)
  const [meta, setMeta] = useState(savedMeta)
  const changed = intro.trim() !== savedIntro || meta.trim() !== savedMeta

  const save = () => {
    if (changed) settingsStore.set({ introDBKey: intro.trim(), publicMetaDBKey: meta.trim() })
  }
  const input = (id: string, label: string, value: string, set: (v: string) => void) => (
    <input
      id={id}
      className="field"
      type="password"
      value={value}
      onChange={(e) => set(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && save()}
      aria-label={label}
      placeholder="Paste your key"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
    />
  )

  return (
    <Group
      title="Skip Services"
      footer={
        <>
          IntroDB and PublicMetaDB know where intros, recaps and credits are in shows your own servers don’t mark. Get a key at{' '}
          <a href="https://introdb.app" target="_blank" rel="noreferrer">
            introdb.app
          </a>{' '}
          and{' '}
          <a href="https://publicmetadb.com" target="_blank" rel="noreferrer">
            publicmetadb.com
          </a>
          . A web page can reach IntroDB only through your stream proxy below, with <code>api.introdb.app</code> in its allowed hosts. PublicMetaDB doesn’t let web pages read its answers, so on the website its key is only kept for Flow Sync and the apps.
        </>
      }
    >
      <Row label="IntroDB API Key" htmlFor="introdb-key" stacked>
        {input('introdb-key', 'IntroDB API key', intro, setIntro)}
      </Row>
      <Row label="PublicMetaDB API Key" htmlFor="publicmetadb-key" stacked>
        {input('publicmetadb-key', 'PublicMetaDB API key', meta, setMeta)}
      </Row>
      <div className={s.saveRow}>
        <button className="btn btn-primary btn-compact" type="button" onClick={save} disabled={!changed}>
          Save
        </button>
      </div>
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
  const stillWatching = useSettings((x) => x.stillWatchingAfterEpisodes)
  const skipIntro = useSettings((x) => x.skipIntro)
  const skipRecap = useSettings((x) => x.skipRecap)
  const skipCredits = useSettings((x) => x.skipCredits)
  const remember = useSettings((x) => x.rememberLastSource)
  const waitsForEnd = useSettings((x) => x.upNextWaitsForEnd ?? false)
  const neverDolbyVision = useSettings((x) => x.neverUseDolbyVision ?? false)
  const postCredits = useSettings((x) => x.postCreditsAlert !== false)
  const becauseYouWatched = useSettings((x) => x.becauseYouWatched !== false)
  const externalPlayer = useSettings((x) => x.externalPlayer ?? 'none')
  // The apps exist on iPhone, iPad and Mac only; elsewhere the setting would have nothing to choose.
  const platform = typeof navigator === 'undefined' ? undefined : detectPlatform(navigator.userAgent, navigator.maxTouchPoints)
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
      <Group
        title="Dolby Vision"
        footer="Never Use Dolby Vision plays its HDR10 picture instead (profile 5, which has none, still plays as Dolby Vision). Applies to MKV files Flow plays itself, from the next time one starts."
      >
        <Row label="Never Use Dolby Vision">
          <Switch label="Never use Dolby Vision" checked={neverDolbyVision} onChange={(on) => settingsStore.set({ neverUseDolbyVision: on })} />
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
      <Group footer="Shows start the next episode when one ends, with a countdown you can cancel. Up Next counts down as the credits begin when a server, a skip service or the file’s chapters say where, else in the last 30 seconds; with Wait for the Episode to End, so the next one begins as this one finishes. After the number of episodes you pick played with nobody touching anything, Flow asks before the next.">
        <Row label="Autoplay Next Episode">
          <Switch label="Autoplay next episode" checked={autoplay} onChange={(on) => settingsStore.set({ autoplayNext: on })} />
        </Row>
        <Row label="Wait for the Episode to End">
          <Switch label="Wait for the episode to end" checked={waitsForEnd} onChange={(on) => settingsStore.set({ upNextWaitsForEnd: on })} disabled={!autoplay} />
        </Row>
        <Row label="Ask If Still Watching" htmlFor="still-watching">
          <Select
            id="still-watching"
            label="Ask if still watching"
            value={String(stillWatching)}
            onChange={(v) => settingsStore.set({ stillWatchingAfterEpisodes: Number(v) })}
            options={stillWatchingChoices.some((c) => c.value === String(stillWatching)) ? stillWatchingChoices : [...stillWatchingChoices, { value: String(stillWatching), label: `After ${stillWatching} Episodes` }]}
          />
        </Row>
      </Group>
      <Group footer="Segments come from your media server (Jellyfin media segments, Plex markers), IntroDB, PublicMetaDB or the file’s chapter names. Show Button puts a Skip button over the picture; Enter or S presses it. Skip Automatically skips as the segment begins and lets you undo it.">
        <Row label="Skip Intro" htmlFor="skip-intro">
          <Select id="skip-intro" label="Skip intro" value={skipIntro} onChange={(v) => settingsStore.set({ skipIntro: v })} options={skipChoices} />
        </Row>
        <Row label="Skip Recap" htmlFor="skip-recap">
          <Select id="skip-recap" label="Skip recap" value={skipRecap} onChange={(v) => settingsStore.set({ skipRecap: v })} options={skipChoices} />
        </Row>
        <Row label="Skip Credits" htmlFor="skip-credits">
          <Select id="skip-credits" label="Skip credits" value={skipCredits} onChange={(v) => settingsStore.set({ skipCredits: v })} options={skipChoices} />
        </Row>
      </Group>
      <Group footer="When a film has a scene during or after its credits, Flow says so as they begin and won’t skip them by itself. Because You Watched suggests what to watch next as the credits roll, and when the film ends.">
        <Row label="Post-Credits Scene Alert">
          <Switch label="Post-credits scene alert" checked={postCredits} onChange={(on) => settingsStore.set({ postCreditsAlert: on })} />
        </Row>
        <Row label="Because You Watched">
          <Switch label="Because you watched" checked={becauseYouWatched} onChange={(on) => settingsStore.set({ becauseYouWatched: on })} />
        </Row>
      </Group>
      {platform && (
        <Group title="Player" footer="Options → Open in lists these apps, with this one first. Another app gets the stream’s link (Infuse also the resume point), only for files it can fetch by their address alone. Flow tracks progress only in its own player.">
          <Row label="Player" htmlFor="external-player">
            <Select
              id="external-player"
              label="External player"
              value={externalPlayer}
              onChange={(v) => settingsStore.set({ externalPlayer: v })}
              options={[{ value: 'none', label: externalPlayerTitle('none') }, ...playersFor(platform).map((id) => ({ value: id, label: externalPlayerTitle(id) }))]}
            />
          </Row>
        </Group>
      )}
      <SkipServices />
      <StreamProxy />
    </>
  )
}
