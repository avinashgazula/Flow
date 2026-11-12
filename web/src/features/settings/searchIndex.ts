/* Search Settings, as the apps have it (SettingsPage.keywords), but by row: a word matches a row's title, its
   keywords, its detail line, then its group's and section's names and footer. The rows come from the page itself
   (Settings reads them off the sections once they are drawn), so a new row is searchable the day it is added;
   what the page can't know is what else people call a row, and that is `rowKeywords` below. */

export interface RawRow {
  /** Names the row on the page, so choosing a result can find it again. */
  key: string
  section: string
  sectionTitle: string
  group: string
  title: string
  detail: string
  footer: string
}

export interface Entry extends RawRow {
  keywords: string
}

export interface Hit {
  entry: Entry
  /** 0 title, 1 keyword, 2 detail, 3 group or section name, 4 footer. Lower is a closer match. */
  tier: number
}

export interface Result {
  section: string
  sectionTitle: string
  hits: Hit[]
}

/** Lower case, no accents, straight quotes, single spaces: what both the words typed and the page's words are read as. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[\s ]+/g, ' ')
    .trim()
}

/** Other names for a row, by its title (normalised), ported from the apps' per-page keywords and spread over the
 *  rows they describe, so "pip" finds Picture in Picture and "sdh" finds Subtitle Type. */
export const rowKeywords: Record<string, string> = {
  'preferred quality': 'resolution 4k 2160 1440 1080 720 cap best',
  'resolution on cellular': 'data saver mobile metered hotspot resolution',
  'hdr when available': 'hdr sdr dolby vision',
  'never use dolby vision': 'dv dolby vision hdr10 profile',
  'remember last source': 'resume previous source',
  'skip details on continue watching': 'resume open title play straight card continue watching',
  'auto rotate to landscape': 'rotate orientation landscape phone full screen',
  'picture in picture': 'pip floating window',
  'auto-sync': 'subtitles captions delay offset align dialogue beta',
  'audio language': 'audio original dub language original',
  'anime audio': 'japanese dub sub',
  'remember tracks for each show': 'audio subtitles languages per show',
  'show subtitles': 'captions forced foreign sdh',
  'subtitle language': 'captions languages',
  'subtitle type': 'captions sdh hearing impaired forced standard',
  'sync offset': 'subtitles delay captions timing',
  'keep original ass styling': 'ass ssa anime subtitles styling fonts',
  'decode dts and dolby truehd': 'dts truehd lossless audio atmos',
  'autoplay next episode': 'up next binge countdown play next',
  'countdown': 'up next autoplay seconds',
  'wait for the episode to end': 'up next credits autoplay',
  'ask if still watching': 'binge sleep autoplay episodes',
  'ask before resuming': 'resume start over continue',
  'mark watched at': 'threshold watched percent history progress',
  'skip back': 'seek rewind seconds',
  'skip forward': 'seek fast forward seconds',
  'skip intro': 'intro opening skip segments',
  'skip recap': 'recap previously on skip segments',
  'skip credits': 'credits outro skip segments end',
  'post-credits scene alert': 'credits scene stinger marvel',
  'because you watched': 'suggestions recommendations credits',
  'show x-ray when paused': 'xray cast crew scene who',
  'recognise faces': 'xray face recognition scene who actors on screen privacy',
  'try the next source automatically': 'failure fallback source fails',
  'mkv files': 'matroska remux external player',
  'player': 'external player infuse vlc outplayer',
  'introdb api key': 'intro skip segments key',
  'publicmetadb api key': 'skip segments key',
  'show progress bar': 'loading screen',
  'show titles under posters': 'poster titles names',
  'show release year': 'year posters',
  'opening tab': 'start tab launch home',
  'show continue watching': 'resume shelf home',
  'show continue watching release date': 'year continue watching',
  'shelf limit': 'continue watching limit most recent',
  'show upcoming': 'next episode air dates home shelf',
  'include watchlist premieres': 'upcoming premieres new seasons films',
  'film dates': 'digital theatrical release upcoming',
  'upcoming within': 'days upcoming window',
  'content shelf length': 'shelf titles how many rows',
  'rotate automatically': 'hero top pick carousel lead auto advance',
  'primary source': 'hero top pick lead trending',
  'secondary source': 'hero top pick lead second',
  'episode source': 'tvdb tmdb episodes order',
  'air dates in my time zone': 'time zone local episodes',
  'show unreleased titles': 'unreleased upcoming coming soon',
  'prefetch on detail view': 'preload speed detail',
  'include adult titles': 'adult explicit nsfw',
  'language': 'metadata region tmdb',
  'region': 'country where to watch providers',
  'show badge on posters': 'server jellyfin emby plex badge',
  'use server artwork': 'jellyfin emby plex posters artwork',
  "only show my server's content": 'library only server',
  'play from this library only': 'library only server',
  'track only with your tracking service': 'trakt simkl scrobble server',
  'use custom source ordering': 'order sort filter rules debrid',
  'hide uncached torrents': 'debrid cached realdebrid',
  'hide cam / ts / screeners': 'cam telesync quality filter',
  'minimum resolution': 'filter cap quality',
  'minimum size': 'filter file size',
  'maximum size': 'filter file size',
  'result cap': 'limit sources how many',
  'provider timeout': 'timeout addons slow stremio',
  'auto-play best source': 'autoplay best match',
  'prefer sources with playable audio': 'audio dts truehd playable',
  'show add-on formatting': 'aiostreams addon names formatting',
  'show file size': 'size source picker',
  'compact rows': 'source picker appearance badges',
  'scrobble while watching': 'trakt simkl tracking progress sync',
  'sync interval': 'trakt simkl tracking hours',
  'refresh guide every': 'iptv epg xmltv hours',
  'hide empty groups': 'iptv m3u channels groups',
  'favourite channels': 'iptv live tv',
  'thesportsdb key': 'sports api key scores',
  'show score spoilers': 'sports scores hide',
  'choose channel on tap': 'sports live tv',
  'export setup': 'share backup qr settings sources',
  'import setup': 'restore settings iphone ipad',
  'export backup': 'library watchlist progress json download',
  'import backup': 'library watchlist progress json restore',
  'watch progress': 'reset clear resume',
  'watch history': 'reset clear watched',
  'watchlist': 'reset clear',
  'remembered sources': 'reset clear last source',
  'cached shelves and details': 'cache storage clear refresh',
  'join a sync': 'flow sync pairing link key devices',
  'create account': 'marquee account register sign up number 16 digit devices sync cloud',
  'log in': 'marquee account sign in login number devices',
  'account number': 'marquee account copy show hide write down devices',
  'log out': 'marquee account sign out forget device',
  'delete account': 'marquee account erase remove data',
  'pairing link': 'flow sync qr code share devices',
  'text size': 'detail font accessibility larger',
  'install flow': 'pwa app home screen',
  'sample data': 'demo leave demo',
  'open source licences': 'licenses legal',
}

const keywordsFor = (title: string): string => rowKeywords[normalise(title)] ?? ''

export function buildIndex(rows: RawRow[]): Entry[] {
  return rows.map((row) => ({ ...row, keywords: keywordsFor(row.title) }))
}

/** A short word matches the start of a word; a longer one matches anywhere, so "dolby" finds "Dolby Vision" and
 *  "rotate" finds "Auto Rotate". */
export function contains(text: string, word: string): boolean {
  if (!text) return false
  if (word.length >= 3) return text.includes(word)
  return text.startsWith(word) || text.includes(` ${word}`)
}

/** The closest tier at which every word typed is found, or undefined when some word is nowhere. */
export function tierOf(entry: Entry, words: string[]): number | undefined {
  const fields = [normalise(entry.title), normalise(entry.keywords), normalise(entry.detail), normalise(`${entry.group} ${entry.sectionTitle}`), normalise(entry.footer)]
  let worst = 0
  for (const word of words) {
    const at = fields.findIndex((f) => contains(f, word))
    if (at < 0) return undefined
    worst = Math.max(worst, at)
  }
  return worst
}

/** The rows that match, by section in the page's order and by closeness within a section, at most `limit` in all
 *  (the closest first, so the cap never drops a title match for a footer one). */
export function search(index: Entry[], query: string, sectionOrder: string[], limit = 60): Result[] {
  const words = normalise(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  const hits: Hit[] = []
  index.forEach((entry) => {
    const tier = tierOf(entry, words)
    if (tier !== undefined) hits.push({ entry, tier })
  })
  // Array.sort is stable, so rows of one tier stay in page order.
  const kept = hits.sort((a, b) => a.tier - b.tier).slice(0, limit)
  const by = new Map<string, Result>()
  for (const hit of kept) {
    const { section, sectionTitle } = hit.entry
    const result = by.get(section) ?? { section, sectionTitle, hits: [] }
    result.hits.push(hit)
    by.set(section, result)
  }
  const position = (id: string) => sectionOrder.indexOf(id)
  const pageOrder = new Map(index.map((e, i) => [e.key, i]))
  return [...by.values()]
    .sort((a, b) => position(a.section) - position(b.section))
    .map((r) => ({ ...r, hits: r.hits.sort((a, b) => a.tier - b.tier || pageOrder.get(a.entry.key)! - pageOrder.get(b.entry.key)!) }))
}

/** Moves a position through `count` results, wrapping at both ends. */
export function step(at: number, by: 1 | -1, count: number): number {
  if (count === 0) return -1
  return at < 0 ? (by === 1 ? 0 : count - 1) : (at + by + count) % count
}
