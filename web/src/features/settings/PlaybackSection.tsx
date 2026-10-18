import { settingsStore, useSettings, type Settings } from '../../lib/store/settings'
import { Group, Row, Select, Switch } from './controls'
import { subtitleChoices, withCurrent } from './options'

const qualities: { value: Settings['preferredQuality']; label: string }[] = [
  { value: '2160p', label: '4K' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'any', label: 'Best Available' },
]

export function PlaybackSection() {
  const quality = useSettings((x) => x.preferredQuality)
  const subtitles = useSettings((x) => x.subtitleLanguages)
  const autoplay = useSettings((x) => x.autoplayNext)
  const remember = useSettings((x) => x.rememberLastSource)
  const first = subtitles[0] ?? ''
  const second = subtitles[1] ?? ''

  // The list is kept without gaps: choosing none for the first language drops the second too.
  const setSubtitles = (a: string, b: string) => settingsStore.set({ subtitleLanguages: [a, b].filter((x, i, all) => x && all.indexOf(x) === i) })
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
      <Group footer="Subtitles turn on by themselves when a title has one in these languages.">
        <Row label="Subtitle Language" htmlFor="subtitle-1">
          <Select id="subtitle-1" label="Subtitle language" value={first} onChange={(v) => setSubtitles(v, v ? second : '')} options={options(first)} />
        </Row>
        <Row label="Second Choice" htmlFor="subtitle-2">
          <Select id="subtitle-2" label="Second choice for subtitles" value={second} onChange={(v) => setSubtitles(first, v)} options={options(second)} disabled={!first} />
        </Row>
      </Group>
      <Group footer="Shows start the next episode when one ends, with a countdown you can cancel.">
        <Row label="Autoplay Next Episode">
          <Switch label="Autoplay next episode" checked={autoplay} onChange={(on) => settingsStore.set({ autoplayNext: on })} />
        </Row>
      </Group>
    </>
  )
}
