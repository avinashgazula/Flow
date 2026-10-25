import { useQueries, useQuery } from '@tanstack/react-query'
import { rank, type PrintPart } from '../../components/stripLayout'
import { FrameCard } from '../../components/Frame'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { useLibrary } from '../../lib/store/library'
import { useSettings } from '../../lib/store/settings'
import { formatLeft, formatRuntime, userLocale, useMinuteTick } from '../../lib/time'
import { useNearScreen } from '../../lib/useNearScreen'
import { continueEntries, episodesLeftText, followedShows, showStatus, type ContinueEntry } from './continue'
import { endsPart, episodeLine, episodeShort, inProgress, resumePrint, secondsLeft, spokenResume, watchedFraction } from './logic'
import { watchedShowsOf } from './marks'
import s from './HomeScreen.module.css'

/** How wide an Up Next still renders, for `srcset`: two across beside the lead on a desktop, a scrolling row below. */
const stillSizes = '(min-width: 1100px) 22vw, (min-width: 721px) 30vw, 240px'

/** Up Next: what's in progress, and the next episode of each series being followed, most recently watched first
 *  (the apps' Continue Watching and Up Next shelves, which share this place beside the lead). The title the lead
 *  is showing is left out. Each is a still: perforations for how far, print for the episode, the time left in
 *  yellow, when it would end, and for a series how many episodes are left. */
export function UpNext({ leadKey }: { leadKey?: string }) {
  const progress = useLibrary((l) => l.progress)
  const history = useLibrary((l) => l.history)
  const marks = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const limit = useSettings((x) => x.continueWatchingLimit)
  const now = useMinuteTick()

  const resumes = inProgress(progress)
  const followed = followedShows(history, new Set(resumes.map((p) => p.key)), 6)
  // The next episode needs the series' seasons: its detail (cached for a day), asked for the few most recent.
  const details = useQueries({ queries: followed.map((f) => q.detail('show', f.item.id)) })
  const watched = watchedShowsOf(marks, rewatches)
  const nexts = followed.flatMap((f, i) => {
    const detail = details[i]?.data
    const seen = watched.get(f.item.id)
    if (!detail || detail.seasons.length === 0 || !seen?.length) return []
    const next = showStatus(seen, detail, now).next
    return next ? [{ key: f.key, item: f.item, episode: next, updatedAt: f.watchedAt }] : []
  })
  const entries = continueEntries(resumes, nexts, limit).filter((e) => e.key !== leadKey)

  return (
    <section className={s.side} aria-labelledby="up-next">
      <h2 id="up-next" className={s.sectionTitle}>
        Up Next
      </h2>
      {entries.length ? (
        <ul className={s.stills}>
          {entries.slice(0, 6).map((e) => (
            <ContinueCard key={e.key} entry={e} />
          ))}
        </ul>
      ) : (
        <p className={s.teach}>Start a film or an episode and it waits here, with how long is left and when it would finish if you carried on now.</p>
      )}
    </section>
  )
}

function ContinueCard({ entry }: { entry: ContinueEntry }) {
  const { item, progress, episode } = entry
  const now = useMinuteTick()
  const [near, itemRef] = useNearScreen<HTMLLIElement>()
  const last = useStore(lastSourceStore, (st) => st.byTitle[entry.key])
  const marks = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const showLeft = useSettings((x) => x.showEpisodesRemaining)
  const isShow = item.type === 'show'
  const detail = useQuery({ ...q.detail(item.type, item.id), enabled: near && isShow })
  // A next episode names itself and has its own still once its season is known.
  const season = useQuery({ ...q.season(item.id, episode?.season ?? 1), enabled: near && entry.nextUp && !!episode })
  const ep = entry.nextUp ? season.data?.find((e) => e.number === episode?.episode) : undefined

  const left = isShow && detail.data ? showStatus(watchedShowsOf(marks, rewatches).get(item.id) ?? [], detail.data, now).left : 0
  const leftPrint: PrintPart[] = showLeft && left > 0 ? [{ text: episodesLeftText(left), rank: rank.episodesLeft }] : []

  let print: PrintPart[]
  let label: string
  let meta: string
  let still: string | undefined
  if (progress) {
    print = resumePrint(progress, now, last, userLocale, leftPrint)
    label = [spokenResume(progress, now, userLocale, last), left > 0 && showLeft ? episodesLeftText(left) : ''].filter(Boolean).join(', ')
    meta = episodeLine(progress.episode) ?? formatLeft(secondsLeft(progress))
    still = progress.episode?.still
  } else {
    const runtime = ep?.runtime ?? detail.data?.runtime
    print = [
      { text: episodeShort(episode) ?? '', rank: rank.episode },
      { text: 'up next', rank: rank.left },
      ...leftPrint,
      ...(runtime ? [endsPart(runtime * 60, now, userLocale), { text: formatRuntime(runtime * 60), rank: rank.facts }] : []),
    ]
    label = [item.title, episode ? `season ${episode.season} episode ${episode.episode}` : '', 'up next', left > 0 && showLeft ? episodesLeftText(left) : ''].filter(Boolean).join(', ')
    meta = episodeLine(episode && { ...episode, name: ep?.name }) ?? ''
    still = ep?.still
  }
  const season1 = (progress?.episode ?? episode)?.season
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: item.type, id: item.id }, search: season1 ? { season: season1 } : undefined }}
      itemRef={itemRef}
      shape="still"
      artPath={still ?? item.backdrop}
      artKind={still ? 'still' : 'backdrop'}
      sizes={stillSizes}
      progress={progress ? watchedFraction(progress) : 0}
      print={print}
      title={item.title}
      meta={meta}
      label={label}
      fallback={item.title}
      onIntent={() => prefetchDetail(item)}
    />
  )
}
