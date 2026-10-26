import { describe, expect, it } from 'vitest'
import { buildICS } from '../../lib/ics'
import type { Library } from '../../lib/store/library'
import type { Episode, MediaItem } from '../../lib/tmdb/types'
import { arrange, code, spoken, stripPrint, followedShowItems, hasAired, icsEvent, label, meta, needsSeason, relativeDay, showEntries, filmEntries, stripDays, type CalendarEntry } from './calendar'

// Sunday 25 October 2026, 10:30 in the viewer's own zone: dates below are local days, as TMDB's are.
const now = new Date(2026, 9, 25, 10, 30).getTime()
const at = (m: number, d: number) => new Date(2026, m - 1, d).getTime()

const show = (id: number, title = `Show ${id}`): MediaItem => ({ type: 'show', id, title, overview: 'A show.', genres: [] })
const film = (id: number, title = `Film ${id}`, extra: Partial<MediaItem> = {}): MediaItem => ({ type: 'movie', id, title, overview: 'A film.', genres: [], year: 2026, ...extra })
const ep = (season: number, number: number, airDate: string | undefined, name = `Episode ${number}`): Episode => ({ id: season * 100 + number, season, number, name, overview: '', airDate })

describe('which shows are followed', () => {
  const lib = (parts: Partial<Pick<Library, 'progress' | 'watchlist' | 'favourites' | 'history'>>) => ({ progress: {}, watchlist: [], favourites: [], history: [], ...parts })
  const entry = (item: MediaItem) => ({ key: `${item.type}:${item.id}`, item, addedAt: 0 })

  it('takes Continue Watching, the watchlist, favourites and History, each once, shows only', () => {
    const a = show(1)
    const b = show(2)
    const c = show(3)
    const d = show(4)
    const list = followedShowItems(
      lib({
        progress: { 'show:1': { key: 'show:1', item: a, position: 100, duration: 1000, updatedAt: 5 }, 'movie:9': { key: 'movie:9', item: film(9), position: 100, duration: 1000, updatedAt: 9 } },
        watchlist: [entry(b), entry(film(8))],
        favourites: [entry(a), entry(c)],
        history: [{ key: 'show:4', item: d, watchedAt: 1 }, { key: 'show:2', item: b, watchedAt: 2 }],
      }),
    )
    expect(list.map((i) => i.id)).toEqual([1, 2, 3, 4])
  })

  it('stops at the most it will ask about', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({ key: `show:${i}`, item: show(i), watchedAt: i }))
    expect(followedShowItems(lib({ history }))).toHaveLength(40)
    expect(followedShowItems(lib({ history }), 5)).toHaveLength(5)
  })
})

describe('a show’s episodes', () => {
  it('lists the rest of the airing season inside the window, and the episode that aired in the last week', () => {
    const season = [ep(2, 1, '2026-10-01'), ep(2, 2, '2026-10-20'), ep(2, 3, '2026-10-27'), ep(2, 4, '2026-11-03'), ep(2, 5, '2026-11-10'), ep(2, 6, '2026-12-30'), ep(2, 7, undefined)]
    const entries = showEntries(show(1), { nextEpisode: season[2], lastEpisode: ep(2, 2, '2026-10-20') }, season, now)
    expect(entries.map((e) => e.episode!.number).sort()).toEqual([2, 3, 4, 5])
    expect(entries.find((e) => e.episode!.number === 3)).toMatchObject({ iso: '2026-10-27', date: at(10, 27), id: 'show:1:s2e3' })
  })

  it('falls back to the next episode alone when the season is not known', () => {
    const next = ep(1, 5, '2026-10-30')
    expect(showEntries(show(1), { nextEpisode: next }, undefined, now).map((e) => e.episode!.number)).toEqual([5])
  })

  it('leaves out an episode that aired more than a week ago or is too far off, and a show with no details', () => {
    expect(showEntries(show(1), { lastEpisode: ep(1, 3, '2026-10-17') }, undefined, now)).toEqual([])
    expect(showEntries(show(1), { nextEpisode: ep(1, 4, '2027-01-01') }, undefined, now)).toEqual([])
    expect(showEntries(show(1), undefined, undefined, now)).toEqual([])
    expect(showEntries(show(1), { lastEpisode: ep(1, 3, '2026-10-18') }, undefined, now)).toHaveLength(1)
  })

  it('asks for the season only when the next episode is in the window', () => {
    expect(needsSeason({ nextEpisode: ep(3, 2, '2026-11-01') }, now)).toBe(3)
    expect(needsSeason({ nextEpisode: ep(3, 2, '2027-03-01') }, now)).toBeUndefined()
    expect(needsSeason({}, now)).toBeUndefined()
    expect(needsSeason(undefined, now)).toBeUndefined()
  })
})

describe('films', () => {
  const releases = [
    { country: 'US', type: 3, date: '2026-09-01' },
    { country: 'US', type: 4, date: '2026-10-30' },
  ]
  it('dates a film by the release asked for, within a week back and a year ahead', () => {
    const f = { item: film(1), releases }
    expect(filmEntries([f], 'digital', 'US', now).map((e) => e.iso)).toEqual(['2026-10-30'])
    expect(filmEntries([f], 'theatrical', 'US', now)).toEqual([]) // September is behind us by more than a week
    expect(filmEntries([{ item: film(2), releases: [{ country: 'US', type: 4, date: '2026-10-10' }] }], 'digital', 'US', now)).toEqual([])
    expect(filmEntries([{ item: film(3), releases: [{ country: 'US', type: 3, date: '2027-10-26' }] }], 'theatrical', undefined, now)).toEqual([])
    expect(filmEntries([{ item: film(3), releases: [{ country: 'US', type: 3, date: '2027-10-24' }] }], 'theatrical', undefined, now)).toHaveLength(1)
    expect(filmEntries([f], 'digital', 'US', now)[0]).toMatchObject({ id: 'movie:1', release: 'digital' })
  })
})

describe('arranging the days', () => {
  const entries: CalendarEntry[] = [
    ...showEntries(show(1, 'B Show'), { nextEpisode: ep(1, 2, '2026-10-27') }, undefined, now),
    ...showEntries(show(2, 'A Show'), { nextEpisode: ep(1, 5, '2026-10-27') }, undefined, now),
    ...showEntries(show(3), { lastEpisode: ep(1, 9, '2026-10-22') }, undefined, now),
    ...showEntries(show(4), { lastEpisode: ep(1, 3, '2026-10-24') }, undefined, now),
    ...showEntries(show(5), { nextEpisode: ep(1, 1, '2026-10-25') }, undefined, now),
    ...filmEntries([{ item: film(7), releases: [{ country: 'US', type: 4, date: '2026-11-06' }] }], 'digital', 'US', now),
  ]

  it('puts the last week in Just Aired, newest first, and groups today onward by day', () => {
    const { justAired, days } = arrange(entries, now)
    expect(justAired.map((e) => e.item.id)).toEqual([4, 3])
    expect(days.map((d) => d.iso)).toEqual(['2026-10-25', '2026-10-27', '2026-11-06'])
    expect(days[1]!.entries.map((e) => e.item.title)).toEqual(['A Show', 'B Show'])
    expect(days[0]!.date).toBe(at(10, 25))
  })

  it('counts today as out', () => {
    expect(hasAired({ date: at(10, 25) }, now)).toBe(true)
    expect(hasAired({ date: at(10, 26) }, now)).toBe(false)
  })

  it('marks the days of the strip that have something on, today first, fourteen days', () => {
    const { days } = arrange(entries, now)
    const strip = stripDays(now, new Set(days.map((d) => d.date)))
    expect(strip).toHaveLength(14)
    expect(strip[0]).toEqual({ date: at(10, 25), today: true, marked: true })
    expect(strip.filter((d) => d.marked).map((d) => new Date(d.date).getDate())).toEqual([25, 27, 6])
    expect(strip.at(-1)!.date).toBe(at(11, 7))
  })

  it('keeps fourteen distinct days across a clock change', () => {
    // 25 October 2026 is the day Europe's clocks go back; the strip must not skip or repeat a day anywhere.
    const strip = stripDays(new Date(2026, 9, 24, 12).getTime(), new Set())
    expect(new Set(strip.map((d) => new Date(d.date).getDate())).size).toBe(14)
    const mar = stripDays(new Date(2026, 2, 28, 12).getTime(), new Set())
    expect(new Set(mar.map((d) => new Date(d.date).getDate())).size).toBe(14)
  })
})

describe('the words', () => {
  it('names the day', () => {
    expect(relativeDay(at(10, 25), now, 'en-US')).toBe('Today')
    expect(relativeDay(at(10, 26), now, 'en-US')).toBe('Tomorrow')
    expect(relativeDay(at(10, 24), now, 'en-US')).toBe('Yesterday')
    expect(relativeDay(at(10, 28), now, 'en-US')).toBe('Wednesday')
    expect(relativeDay(at(10, 20), now, 'en-US')).toBe('Tuesday')
    expect(relativeDay(at(11, 6), now, 'en-US')).toBe('Nov 6')
    expect(relativeDay(at(10, 18), now, 'en-US')).toBe('Oct 18')
  })

  it('labels premieres, new episodes and a film’s day, and names the line under the title', () => {
    const [premiere] = showEntries(show(1), { nextEpisode: ep(1, 1, '2026-10-30') }, undefined, now)
    const [season] = showEntries(show(1), { nextEpisode: ep(3, 1, '2026-10-30') }, undefined, now)
    const [soon] = showEntries(show(1), { nextEpisode: ep(3, 4, '2026-10-30') }, undefined, now)
    const [aired] = showEntries(show(1), { lastEpisode: ep(3, 4, '2026-10-23') }, undefined, now)
    expect(label(premiere!, now)).toBe('Series Premiere')
    expect(label(season!, now)).toBe('Season Premiere')
    expect(label(soon!, now)).toBeUndefined()
    expect(label(aired!, now)).toBe('New')
    const [coming] = filmEntries([{ item: film(7), releases: [{ country: 'US', type: 4, date: '2026-11-06' }] }], 'digital', 'US', now)
    const [out] = filmEntries([{ item: film(7), releases: [{ country: 'US', type: 3, date: '2026-10-22' }] }], 'theatrical', 'US', now)
    expect(label(coming!, now)).toBe('Release')
    expect(label(out!, now)).toBe('Out Now')
    expect(meta(coming!)).toBe('2026 · Digital release')
    expect(meta(out!)).toBe('2026 · In cinemas')
    expect(meta(soon!)).toBe('Episode 4')
    expect(code({ season: 3, number: 4 })).toBe('S3 E4')
  })
})

describe('the print under a still', () => {
  const [soon] = showEntries(show(1), { nextEpisode: ep(3, 1, '2026-10-30') }, undefined, now)
  const [plain] = showEntries(show(1), { nextEpisode: ep(3, 4, '2026-10-30') }, undefined, now)
  const [aired] = showEntries(show(1), { lastEpisode: ep(3, 4, '2026-10-23') }, undefined, now)
  const text = (parts: ReturnType<typeof stripPrint>) => parts.map((p) => (typeof p === 'string' ? p : 'key' in p ? `*${p.key}` : p.text))

  it('leads with the episode, then the label, then the day', () => {
    expect(text(stripPrint(soon!, { now, watched: false }))).toEqual(['S3 E1', 'Season Premiere'])
    expect(text(stripPrint(plain!, { now, watched: false }))).toEqual(['S3 E4'])
    expect(text(stripPrint(aired!, { now, watched: false, day: 'Friday' }))).toEqual(['S3 E4', '*New', 'Friday'])
  })

  it('says Watched in place of the label for an episode already seen', () => {
    expect(text(stripPrint(aired!, { now, watched: true }))).toEqual(['S3 E4', 'Watched'])
  })

  it('calls a film a film, and speaks the whole thing', () => {
    const [f] = filmEntries([{ item: film(7, 'Dune'), releases: [{ country: 'US', type: 4, date: '2026-11-06' }] }], 'digital', 'US', now)
    expect(text(stripPrint(f!, { now, watched: false }))).toEqual(['Film', 'Release'])
    expect(spoken(f!, { now, watched: false })).toBe('Dune, film, Release')
    expect(spoken(aired!, { now, watched: true, day: 'Friday' })).toBe('Show 1, season 3 episode 4, New, Friday, watched')
  })
})

describe('Add to Calendar', () => {
  it('titles an episode as the apps do, on its own day, with a stable id', () => {
    const [entry] = showEntries(show(1396, 'Breaking Bad'), { nextEpisode: { ...ep(3, 7, '2026-10-27', 'One Minute'), overview: 'Hank is back.' } }, undefined, now)
    const event = icsEvent(entry!)
    expect(event).toEqual({
      uid: 'show-1396-s3e7@flow-web',
      title: 'Breaking Bad — S3E7 · One Minute',
      day: '2026-10-27',
      description: 'Hank is back.',
      url: 'https://www.themoviedb.org/tv/1396/season/3/episode/7',
    })
    expect(icsEvent(entry!).uid).toBe(event.uid)
    expect(buildICS([event], now)).toContain('DTSTART;VALUE=DATE:20261027')
  })

  it('titles a film by the release it is dated by, and falls back to the film’s own synopsis', () => {
    const [digital] = filmEntries([{ item: film(7, 'Dune'), releases: [{ country: 'US', type: 4, date: '2026-11-06' }] }], 'digital', 'US', now)
    const [theatrical] = filmEntries([{ item: film(8, 'Heat'), releases: [{ country: 'US', type: 3, date: '2026-11-06' }] }], 'theatrical', 'US', now)
    expect(icsEvent(digital!)).toMatchObject({ uid: 'movie-7@flow-web', title: 'Dune — out now', day: '2026-11-06', description: 'A film.', url: 'https://www.themoviedb.org/movie/7' })
    expect(icsEvent(theatrical!).title).toBe('Heat — in cinemas')
  })
})
