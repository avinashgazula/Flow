import { useEffect, useState, type FormEvent } from 'react'
import { proxyProblem } from '../../lib/sources/proxy'
import { settingsStore, useSettings, useSkipDetails, type Settings, type SkipBehaviour, type SubtitleMode } from '../../lib/store/settings'
import { ConfirmButton, Group, Note, Row, Select, Switch } from './controls'
import { LearnMore } from './LearnMore'
import { SubtitleServicesGroup } from './SubtitleServicesGroup'
import { SubtitleStyleGroup } from './SubtitleStyleGroup'
import { animeAudios, normaliseSubtitleOptions, subtitleTypes } from '../../lib/subtitles/options'
import { audioChoices, subtitleChoices, withCurrent } from './options'
import { detectPlatform, externalPlayerTitle, playersFor } from '../player/externalPlayers'
import { cellularChoices, countdownChoices, currentConnection, playbackPreferences, seekChoices, watchedChoices } from '../player/preferences'
import { titleChoices } from '../player/session'
import { offsetChoices, offsetLabel } from '../player/subtitleDelay'
import { canAutoRotate } from '../player/orientation'
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
          Most debrid servers don’t let web pages read their files, so a stream proxy you run fetches them for Flow. Put <code>{'{url}'}</code> where the file’s address goes.{' '}
          {proxyGuide ? (
            <a href={proxyGuide} target="_blank" rel="noreferrer">
              How to set one up
            </a>
          ) : (
            <>See web/proxy in Flow’s source to set one up</>
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
          .<LearnMore section="skipping-and-binge-watching" />
        </>
      }
    >
      <Row label="IntroDB API Key" htmlFor="introdb-key">
        {input('introdb-key', 'IntroDB API key', intro, setIntro)}
      </Row>
      <Row label="PublicMetaDB API Key" htmlFor="publicmetadb-key">
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
  { value: 'forced', label: 'Forced Only' },
  { value: 'off', label: 'Off' },
]

const secondsChoice = (n: number) => ({ value: String(n), label: `${n}s` })
const seekOptions = seekChoices.map(secondsChoice)
const countdownOptions = countdownChoices.map((n) => ({ value: String(n), label: `${n} seconds` }))
const watchedOptions = watchedChoices.map((n) => ({ value: String(n), label: `${n}%` }))
const offsetOptions = (current: number) => (offsetChoices.includes(current) ? offsetChoices : [...offsetChoices, current].sort((a, b) => a - b)).map((n) => ({ value: String(n), label: offsetLabel(n) }))

/** Remember Tracks for Each Show, and the button that forgets what it kept. The picks live on this device, so the
 *  count is read when the section opens and again after forgetting. */
function RememberedTracks() {
  const remember = useSettings((x) => x.rememberTracksPerShow !== false)
  const [shows, setShows] = useState(() => titleChoices.showCount())
  return (
    <Group footer="Pick Japanese audio and English subtitles once, and the rest of the show starts that way. They are kept on this device.">
      <Row label="Remember Tracks for Each Show">
        <Switch label="Remember tracks for each show" checked={remember} onChange={(on) => settingsStore.set({ rememberTracksPerShow: on })} />
      </Row>
      <Row label="Forget Remembered Tracks" detail={shows === 0 ? 'No shows remembered' : shows === 1 ? '1 show' : `${shows} shows`}>
        <ConfirmButton
          label="Forget"
          confirm="Forget All"
          disabled={shows === 0}
          onConfirm={() => {
            titleChoices.forgetShows()
            setShows(0)
          }}
        />
      </Row>
    </Group>
  )
}

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
  const subtitleOptions = useSettings((x) => x.subtitleOptions)
  const extras = normaliseSubtitleOptions(subtitleOptions)
  const setExtras = (patch: Partial<typeof extras>) => settingsStore.set({ subtitleOptions: { ...extras, ...patch } })
  const waitsForEnd = useSettings((x) => x.upNextWaitsForEnd ?? false)
  const neverDolbyVision = useSettings((x) => x.neverUseDolbyVision ?? false)
  const preferHDR = useSettings((x) => x.preferHDR !== false)
  const postCredits = useSettings((x) => x.postCreditsAlert !== false)
  const becauseYouWatched = useSettings((x) => x.becauseYouWatched !== false)
  const xrayWhenPaused = useSettings((x) => x.xrayWhenPaused !== false)
  const recogniseFaces = useSettings((x) => x.recogniseFaces !== false)
  const externalPlayer = useSettings((x) => x.externalPlayer ?? 'none')
  // One primitive each: a selector that built an object would be a new snapshot every time.
  const askToResume = useSettings((x) => playbackPreferences(x).askToResume)
  const watchedAt = useSettings((x) => Math.round(playbackPreferences(x).watchedAt * 100))
  const seekBack = useSettings((x) => playbackPreferences(x).seekBack)
  const seekForward = useSettings((x) => playbackPreferences(x).seekForward)
  const countdown = useSettings((x) => playbackPreferences(x).countdown)
  const showProgress = useSettings((x) => x.showLoadingProgress !== false)
  const tryNext = useSettings((x) => x.tryNextSourceOnFailure !== false)
  const decodeLossless = useSettings((x) => x.decodeLosslessAudio !== false)
  const matroska = useSettings((x) => x.matroskaPlayback ?? 'remux')
  const cellular = useSettings((x) => x.cellularResolutionCap ?? '2160p')
  const syncOffset = useSettings((x) => x.defaultSubtitleOffset ?? 0)
  const autoSync = useSettings((x) => x.subtitleAutoSync === true)
  const skipDetails = useSkipDetails()
  const pip = useSettings((x) => x.pictureInPicture !== false)
  const autoRotate = useSettings((x) => x.autoRotate !== false)
  // Both switches appear only where the browser can act on them.
  const hasPip = typeof document !== 'undefined' && (document.pictureInPictureEnabled || (typeof HTMLVideoElement !== 'undefined' && 'webkitSetPresentationMode' in HTMLVideoElement.prototype))
  const canRotate = canAutoRotate()
  // The Network Information API is Chromium's alone; elsewhere there is nothing to tell a metered link by.
  const hasConnection = currentConnection() !== undefined
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
      <Group footer={`Skip Details on Continue Watching plays a title from its card on Home instead of opening its page.${canRotate ? ' Auto Rotate to Landscape turns the phone sideways when the player goes full screen.' : ''}`}>
        <Row label="Skip Details on Continue Watching" detail="Play from the card instead of opening the title">
          <Switch label="Skip details on Continue Watching" checked={skipDetails} onChange={(on) => settingsStore.set({ skipDetailsOnContinueWatching: on })} />
        </Row>
        {canRotate && (
          <Row label="Auto Rotate to Landscape" detail="When the player goes full screen">
            <Switch label="Auto rotate to landscape" checked={autoRotate} onChange={(on) => settingsStore.set({ autoRotate: on })} />
          </Row>
        )}
        {hasPip && (
          <Row label="Picture in Picture" detail="Show the button in the player">
            <Switch label="Picture in Picture" checked={pip} onChange={(on) => settingsStore.set({ pictureInPicture: on })} />
          </Row>
        )}
      </Group>
      <Group
        footer={`The picker puts this resolution first when a title has it, then the next best. Anything this browser can’t play is marked and never chosen for you.${hasConnection ? ' Resolution on Cellular applies instead when the browser reports Data Saver or a slow connection: Flow then starts a source no taller than that, and the picker still lists the rest.' : ''}`}
      >
        <Row label="Preferred Quality" htmlFor="quality">
          <Select id="quality" label="Preferred quality" value={quality} onChange={(v) => settingsStore.set({ preferredQuality: v })} options={qualities} />
        </Row>
        {hasConnection && (
          <Row label="Resolution on Cellular" htmlFor="cellular-cap">
            <Select id="cellular-cap" label="Resolution on cellular" value={cellular} onChange={(v) => settingsStore.set({ cellularResolutionCap: v })} options={cellularChoices} />
          </Row>
        )}
        <Row label="HDR When Available" detail="Rank HDR releases first on an HDR screen">
          <Switch label="HDR when available" checked={preferHDR} onChange={(on) => settingsStore.set({ preferHDR: on })} />
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
      <Group title="Loading Screen">
        <Row label="Show Progress Bar">
          <Switch label="Show progress bar" checked={showProgress} onChange={(on) => settingsStore.set({ showLoadingProgress: on })} />
        </Row>
      </Group>
      <Group footer="Flow starts each title on the first of these it has, and never on commentary. A track you choose in the player is remembered for that film, and for that show unless Remember Tracks for Each Show is off.">
        <Row label="Audio Language" htmlFor="audio-1">
          <Select id="audio-1" label="Audio language" value={audioFirst} onChange={(v) => setAudio(v, v ? audioSecond : '')} options={audioOptions(audioFirst, 'Stream Default')} />
        </Row>
        <Row label="Second Choice" htmlFor="audio-2">
          <Select id="audio-2" label="Second choice for audio" value={audioSecond} onChange={(v) => setAudio(audioFirst, v)} options={audioOptions(audioSecond, 'None')} disabled={!audioFirst} />
        </Row>
        <Row label="Anime Audio" htmlFor="anime-audio">
          <Select id="anime-audio" label="Anime audio" value={extras.animeAudio} onChange={(v) => setExtras({ animeAudio: v })} options={animeAudios} />
        </Row>
      </Group>
      <RememberedTracks />
      <Group footer="Foreign Audio Only turns subtitles on when the audio isn’t in your Subtitle Language, and shows only forced ones otherwise. Subtitle Type picks SDH (with sound cues and speakers) or standard subtitles where a language has both.">
        <Row label="Show Subtitles" htmlFor="subtitle-mode">
          <Select id="subtitle-mode" label="When to show subtitles" value={subtitleMode} onChange={(v) => settingsStore.set({ subtitleMode: v })} options={subtitleModes} />
        </Row>
        <Row label="Subtitle Language" htmlFor="subtitle-1">
          <Select id="subtitle-1" label="Subtitle language" value={first} onChange={(v) => setSubtitles(v, v ? second : '')} options={options(first)} />
        </Row>
        <Row label="Second Choice" htmlFor="subtitle-2">
          <Select id="subtitle-2" label="Second choice for subtitles" value={second} onChange={(v) => setSubtitles(first, v)} options={options(second)} disabled={!first} />
        </Row>
        <Row label="Subtitle Type" htmlFor="subtitle-type">
          <Select id="subtitle-type" label="Subtitle type" value={extras.type} onChange={(v) => setExtras({ type: v })} options={subtitleTypes} />
        </Row>
        <Row label="Sync Offset" detail="Where every title’s subtitle delay starts" htmlFor="sync-offset">
          <Select id="sync-offset" label="Subtitle sync offset" value={String(syncOffset)} onChange={(v) => settingsStore.set({ defaultSubtitleOffset: Number(v) })} options={offsetOptions(syncOffset)} />
        </Row>
      </Group>
      <SubtitleStyleGroup />
      <Group title="Auto-sync (Beta)" footer="Aligns out-of-sync subtitles to the dialogue. Turn it on, start playback, and an Auto-sync action appears on the player’s Subtitle Delay page. It needs a video whose sound this browser may read, and a scene with dialogue.">
        <Row label="Auto-sync">
          <Switch label="Auto-sync" checked={autoSync} onChange={(on) => settingsStore.set({ subtitleAutoSync: on })} />
        </Row>
      </Group>
      <Group footer="Draws ASS and SSA subtitles the way their author styled them, instead of the style above. It matters mostly for anime, and loads a 1 MB drawing engine the first time one shows. Subtitles inside an MKV keep your style.">
        <Row label="Keep Original ASS Styling">
          <Switch label="Keep original ASS styling" checked={extras.keepASSStyling} onChange={(on) => setExtras({ keepASSStyling: on })} />
        </Row>
      </Group>
      <SubtitleServicesGroup />
      <Group footer="The next episode starts after a countdown you can cancel, from where the credits begin or in the last 30 seconds. After the number of episodes you pick with nobody touching anything, Flow asks before the next.">
        <Row label="Autoplay Next Episode">
          <Switch label="Autoplay next episode" checked={autoplay} onChange={(on) => settingsStore.set({ autoplayNext: on })} />
        </Row>
        <Row label="Countdown" htmlFor="countdown">
          <Select id="countdown" label="Up Next countdown" value={String(countdown)} onChange={(v) => settingsStore.set({ nextEpisodeCountdownSeconds: Number(v) })} options={countdownOptions} disabled={!autoplay} />
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
      <Group title="Resume & Progress" footer="Without the question, a title picks up where you left it. Mark Watched At moves a title to History once this much of it has played.">
        <Row label="Ask Before Resuming">
          <Switch label="Ask before resuming" checked={askToResume} onChange={(on) => settingsStore.set({ askToResume: on })} />
        </Row>
        <Row label="Mark Watched At" htmlFor="watched-at">
          <Select id="watched-at" label="Mark watched at" value={String(watchedAt)} onChange={(v) => settingsStore.set({ watchedThresholdPercent: Number(v) })} options={watchedOptions} />
        </Row>
        <Row label="Skip Back" htmlFor="skip-back">
          <Select id="skip-back" label="Skip back" value={String(seekBack)} onChange={(v) => settingsStore.set({ seekBackwardSeconds: Number(v) })} options={seekOptions} />
        </Row>
        <Row label="Skip Forward" htmlFor="skip-forward">
          <Select id="skip-forward" label="Skip forward" value={String(seekForward)} onChange={(v) => settingsStore.set({ seekForwardSeconds: Number(v) })} options={seekOptions} />
        </Row>
      </Group>
      <Group
        title="Formats"
        footer={`Flow plays MKV files itself by repackaging them on the fly, without re-encoding. DTS and Dolby TrueHD, which browsers can’t play, are decoded and re-encoded as stereo while you watch where the browser can; with that off those tracks are marked unavailable. When a source won’t start, Flow moves to the next one${platform ? ', or hands an MKV to your external player when MKV Files says so' : ''}.`}
      >
        <Row label="Try the Next Source Automatically">
          <Switch label="Try the next source automatically" checked={tryNext} onChange={(on) => settingsStore.set({ tryNextSourceOnFailure: on })} />
        </Row>
        <Row label="Decode DTS and Dolby TrueHD">
          <Switch label="Decode DTS and Dolby TrueHD" checked={decodeLossless} onChange={(on) => settingsStore.set({ decodeLosslessAudio: on })} />
        </Row>
        {platform && (
          <Row label="MKV Files" htmlFor="mkv-files" detail={externalPlayer === 'none' ? 'Choose an external player below first' : undefined}>
            <Select
              id="mkv-files"
              label="MKV files"
              value={matroska}
              onChange={(v) => settingsStore.set({ matroskaPlayback: v })}
              options={[
                { value: 'remux', label: 'Play in Flow' },
                { value: 'external', label: 'External Player' },
              ]}
            />
          </Row>
        )}
      </Group>
      <Group footer="Segments come from your media server, IntroDB, PublicMetaDB or the file’s chapters. Show Button puts a Skip button over the picture (press Enter or S); Skip Automatically skips as the segment begins and lets you undo it.">
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
      <Group title="X-Ray" footer="X-Ray shows the cast and crew, jumps to scenes, and names who is in the scene. Recognise Faces finds the faces in the picture and matches them to the cast’s photos, on this device: no picture, face or photo leaves it. It downloads about 15 MB the first time. When it can’t, or off, X-Ray names who the last minutes of dialogue mention. Open X-Ray with its button or by pressing X.">
        <Row label="Show X-Ray When Paused">
          <Switch label="Show X-Ray when paused" checked={xrayWhenPaused} onChange={(on) => settingsStore.set({ xrayWhenPaused: on })} />
        </Row>
        <Row label="Recognise Faces">
          <Switch label="Recognise faces" checked={recogniseFaces} onChange={(on) => settingsStore.set({ recogniseFaces: on })} />
        </Row>
      </Group>
      {platform && (
        <Group title="External Player" footer="Options → Open in lists these apps, with this one first. Another app gets the stream’s link (Infuse also the resume point), only for files it can fetch by their address alone. Flow tracks progress only in its own player.">
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
