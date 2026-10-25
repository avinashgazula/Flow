import { settingsStore, useSettings } from '../../lib/store/settings'
import { Group, Row, Select, Switch } from './controls'
import { textSizes } from './options'

/** What a title's page shows and how large its text is, as the apps' Detail Views in General settings. */
export function TitlePagesGroup() {
  const about = useSettings((x) => x.showAboutSection)
  const where = useSettings((x) => x.showWhereToWatch)
  const reviews = useSettings((x) => x.showReviews)
  const spoilers = useSettings((x) => x.showEpisodeSpoilers)
  const specials = useSettings((x) => x.showSpecialsSeason)
  const size = useSettings((x) => x.detailTextSize)
  return (
    <Group
      title="Title Pages"
      footer="About always lists the release date, runtime, director and rating at the foot of the page; this adds status, language, country, budget, revenue and production companies. Where to Watch shows subscription, free, rent and buy availability (JustWatch, through TMDB). Reviews shows TMDB and Trakt reviews. With Episode Spoilers off, the still of an episode that has aired and isn’t watched stays blurred and its synopsis stays hidden. Specials Season adds season 0 to a series’ seasons."
    >
      <Row label="About">
        <Switch label="About" checked={about} onChange={(on) => settingsStore.set({ showAboutSection: on })} />
      </Row>
      <Row label="Where to Watch">
        <Switch label="Where to Watch" checked={where} onChange={(on) => settingsStore.set({ showWhereToWatch: on })} />
      </Row>
      <Row label="Reviews">
        <Switch label="Reviews" checked={reviews} onChange={(on) => settingsStore.set({ showReviews: on })} />
      </Row>
      <Row label="Episode Spoilers">
        <Switch label="Episode spoilers" checked={spoilers} onChange={(on) => settingsStore.set({ showEpisodeSpoilers: on })} />
      </Row>
      <Row label="Specials Season">
        <Switch label="Specials season" checked={specials} onChange={(on) => settingsStore.set({ showSpecialsSeason: on })} />
      </Row>
      <Row label="Text Size" htmlFor="detail-text-size">
        <Select id="detail-text-size" label="Title page text size" value={size} onChange={(v) => settingsStore.set({ detailTextSize: v })} options={textSizes} />
      </Row>
    </Group>
  )
}
