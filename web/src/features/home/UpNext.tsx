import { useQueries, useQuery } from '@tanstack/react-query'
import { rank, type PrintPart } from '../../components/printLayout'
import { FrameCard } from '../../components/Frame'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { useLibrary } from '../../lib/store/library'
import { useSettings, useSkipDetails } from '../../lib/store/settings'
import { formatLeft, formatRuntime, userLocale, useMinuteTick } from '../../lib/time'
import { useNearScreen } from '../../lib/useNearScreen'
import { continueEntries, episodesLeftText, followedShows, showStatus, type ContinueEntry } from './continue'
import { endsPart, episodeLine, episodeShort, inProgress, resumePrint, secondsLeft, spokenResume, watchedFraction } from './logic'
import { LazyCardMenu } from './LazyCardMenu'
import { watchedShowsOf } from './marks'
import { continueMeta } from './posterText'
import { continueLink } from './skipDetails'
import s from './HomeScreen.module.css'

/** How wide a Continue Watching still renders, for `srcset`: four across on a desktop (six on a wide one), three on a
 *  tablet, a scrolling row on a phone. */
const stillSizes = '(min-width: 1500px) 230px, (min-width: 1100px) 24vw, (min-width: 721px) 32vw, 280px'

/** Continue Watching: what's in progress, and the next episode of each series being followed, most recently watched
 *  first (the apps' Continue Watching shelf, which sits under the lead here). With only the apps' Up Next shelf on,
 *  it is called that and holds only the next episodes, as there. The title the lead is showing is left out. Each is
 *  a cell: a still with a red bar for how far, then the episode, the time left in red, when it would end, and for a
 *  series how many episodes are left. */
export function UpNext({ leadKey, title, nextOnly }: { leadKey?: string; title: string; nextOnly?: boolean }) {
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
  const entries = continueEntries(resumes, nexts, limit).filter((e) => e.key !== leadKey && (!nextOnly || e.nextUp))

  return (
    <section className={s.side} aria-labelledby="continue-watching">
      <h2 id="continue-watching" className={`section-label ${s.sectionTitle}`}>
        {title}
      </h2>
      {entries.length ? (
        <ul className={s.cells}>
          {entries.slice(0, 6).map((e) => (
            <ContinueCard key={e.key} entry={e} said={!nextOnly} />
          ))}
        </ul>
      ) : (
        <p className={s.teach}>Start a film or an episode and it waits here, with how long is left and when it would finish if you carried on now.</p>
      )}
    </section>
  )
}

/** `said`: the next episode says "up next" in its line, to tell it from one in progress. Under a heading that already
 *  says it, it would repeat it. */
function ContinueCard({ entry, said }: { entry: ContinueEntry; said: boolean }) {
  const { item, progress, episode } = entry
  const now = useMinuteTick()
  const [near, itemRef] = useNearScreen<HTMLLIElement>()
  const last = useStore(lastSourceStore, (st) => st.byTitle[entry.key])
  const marks = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const showLeft = useSettings((x) => x.showEpisodesRemaining)
  const showDate = useSettings((x) => x.showContinueWatchingReleaseDate !== false)
  const skipDetails = useSkipDetails()
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
      ...(said ? [{ text: 'up next', rank: rank.left }] : []),
      ...leftPrint,
      ...(runtime ? [endsPart(runtime * 60, now, userLocale), { text: formatRuntime(runtime * 60), rank: rank.facts }] : []),
    ]
    label = [item.title, episode ? `season ${episode.season} episode ${episode.episode}` : '', 'up next', left > 0 && showLeft ? episodesLeftText(left) : ''].filter(Boolean).join(', ')
    meta = episodeLine(episode && { ...episode, name: ep?.name }) ?? ''
    still = ep?.still
  }
  return (
    <FrameCard
      link={continueLink(entry, skipDetails)}
      itemRef={itemRef}
      shape="still"
      cell
      artPath={still ?? item.backdrop}
      artKind={still ? 'still' : 'backdrop'}
      sizes={stillSizes}
      progress={progress ? watchedFraction(progress) : 0}
      print={print}
      title={item.title}
      meta={continueMeta(meta, item.year, showDate)}
      label={label}
      fallback={item.title}
      onIntent={() => prefetchDetail(item)}
    >
      <LazyCardMenu item={item} entry={{ progress, episode }} />
    </FrameCard>
  )
}
