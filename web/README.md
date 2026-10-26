# Flow for the web

The same Flow, in a browser: Home, title pages, Explore, Search, Library, your sources and the
player, built to feel instant.

```bash
cd web
npm install
npm run dev          # http://localhost:5173  (add ?demo for sample data)
npm run build        # type-check, then a production build in dist/
npm run preview      # serve dist/ at http://localhost:4173
npm test             # unit tests (Vitest)
```

## How it's put together

- **Vite + React 19**, with the React Compiler memoising every component.
- **TanStack Router** (file routes in `src/routes/`): each route is its own chunk. Links preload
  the route's code and data on intent (hover, focus or touch start), so a click usually lands on a
  page that's already loaded. Loaders start queries but don't await them; a page paints straight
  away and fills in.
- **TanStack Query** owns all server data (`src/lib/queries.ts`). The cache is saved to IndexedDB
  and restored at launch, so a repeat visit paints from disk before the network answers. A title
  page opens on what the tapped card already knew (`placeholderData`) while the rest loads.
- **TanStack Virtual** for long grids (Explore, Library).
- **Rust → WebAssembly** (`crates/`) for the work that's actually heavy in a browser: demuxing
  Matroska and remuxing it to fragmented MP4 for Media Source Extensions, in a Web Worker.
- **CSS Modules + tokens** (`src/styles/tokens.css`: Film Stock: warm film-base black and one film-stock yellow, with edge-print type). No
  CSS-in-JS runtime. The default typeface is the system's (SF on Apple devices); Settings →
  Appearance offers Inter, Geist, Manrope and Ioskeley Mono, and only the chosen one downloads.

| Path | What's there |
| --- | --- |
| `src/routes/` | One file per screen; `__root.tsx` holds the navigation and onboarding gate. |
| `src/lib/shelves.ts` | Home's shelf list, as the apps' `ShelfConfig`: built-in rows, Discover shelves, room for Trakt and server lists, and the apps' JSON for Copy and Paste in Settings → Shelves. |
| `src/features/<area>/` | Each screen's components and CSS. |
| `src/components/` | Shared pieces: `Artwork`, `Frame` (frame + edge strip: the signature), `Cards`, `Shelf`, `Nav`, `Icon`. |
| `src/lib/tmdb/` | TMDB client (normalises responses into `types.ts`), images, sample data. |
| `src/lib/store/` | Settings and library (watchlist, progress, history) in localStorage. |
| `src/lib/trakt/` | Trakt: PKCE sign-in, the API client, the library sync and the player's scrobbler (see Trakt below). |
| `src/lib/sources/` | Stream add-ons, Jellyfin/Emby, Plex and WebDAV, and source ranking. |
| `src/features/player/` | The player. |
| `src/features/livetv/`, `src/lib/livetv/` | Live TV: the channel list, the timeline guide and the live player; the M3U, Xtream Codes and XMLTV code behind them. |
| `proxy/` | The stream proxy: a Cloudflare Worker that makes blocked file hosts readable. |

## Rules for speed

- Images go through `Artwork` (or `srcSet`/`imageURL`): sized boxes, `srcset`, lazy below the
  fold, one high-priority image per screen.
- No new runtime dependency without a reason it can't be twenty lines of our own code. Anything
  large (hls.js, the WASM remuxer, sample data) is a dynamic `import()` on the path that needs it.
- Off-screen sections use `content-visibility: auto`; long lists are virtualised.
- State that changes often (playback time) lives in refs or the DOM, not in React state that
  re-renders a screen.

## Installing and offline

Flow is an installable web app (`public/manifest.webmanifest`: Film Base colours, maskable icons, shortcuts for Continue
Watching, Upcoming and Search) and opens with no network. `scripts/pwa.ts` runs after the build: it lists the hashed code
and styles (Vite's output, without sourcemaps, wasm or anything over 300 KB, which is hls.js), adds the page, the offline
page, the manifest, the icon and the edge-print font, and builds `src/sw/sw.ts` with that list into `dist/sw.js`. The cache
is named after a fingerprint of its contents, so a deploy that changes any file replaces the whole cache.

- **What it caches** is decided by `src/sw/rules.ts` and its tests: Flow's own origin and base path only, GET only, nothing
  with a Range header or a media extension, never `samples/`. TMDB, add-ons, servers, the stream proxy and artwork are other
  origins, so the worker never sees them as anything but a request to let through. Chunks that weren't precached (hls.js, a
  typeface) are stored the first time they load.
- **Page loads** go to the network first and fall back to the saved shell after 4 s or when offline, so a new deploy shows
  at once and an old connection still opens Flow. `offline.html` is the last resort.
- **Updates wait.** A new worker never takes over by itself (a film isn't swapped to new code half way through); the page
  shows "Flow was updated" with Reload, and Reload tells the worker to take over and reloads. Registered in production
  builds only (`lib/pwa/update.ts`).
- **Address bar search.** The build writes `opensearch.xml` (`search?q={searchTerms}`) with absolute addresses, from
  `FLOW_SITE_URL`, `PAGES_DOMAIN` or the GitHub repository; a local build gets relative ones, which browsers ignore.
- **Install.** Settings → About has Install Flow where the browser sends `beforeinstallprompt`, and one sentence about Share
  → Add to Home Screen on iPhone and iPad. Nothing asks unprompted.

## Matroska

Browsers can't play `.mkv`, so `src/lib/remux` does it: a Rust crate (`crates/flow-remux`, 175 KB of
WebAssembly) demuxes Matroska in a Web Worker, fed by range requests (header, seek index, then
clusters a few MB at a time), and remuxes it to fragmented MP4 for Media Source Extensions. The page
only sees `attachMatroska(video, url)`; nothing loads until an MKV is played. The built wasm and its
JS glue are committed in `src/lib/remux/pkg/`, so the site builds without Rust. After changing the
crate, run `npm run wasm` (needs Rust with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli`
0.2.129) and `cargo test` in `crates/flow-remux`.

**Reading fast files.** A 4K remux at 60 to 100 Mb/s behind a stream proxy can't be read one request
at a time: each request waits out the proxy's latency, and a capped connection never fills the pipe.
`reader.ts` keeps three range requests in flight (through the proxy, or for any file above 25 Mb/s;
two otherwise), starting small and doubling up to 16 MB (4 MB direct), and hands the bytes to the
remuxer strictly in order, holding at most three pieces in memory. A piece that drops is asked for
again from its last byte without disturbing the others. `pacing.ts` decides how far ahead to read:
as far as the browser's buffer quota holds at the file's bitrate (about 11 s at 10 MB/s, the full
minute for an ordinary film), lowered when the browser says its buffer is full and climbed back a
little at a time. `session.netStats` and `session.onStats` report the download rate, the file's
bitrate and the requests in flight about once a second.

**Audio conversion.** A track the browser can't play (TrueHD, DTS, and Dolby Digital where there's
no decoder) is handed to `src/lib/remux/convert.ts` raw, as the worker reads it. FFmpeg's decoders,
built to a 290 KB WebAssembly module (LGPL, `src/lib/audio/pkg/flow-audio.wasm`, rebuilt with
`npm run audio-wasm`), turn it into stereo PCM; `AudioEncoder` makes Opus; `OpusMuxer` wraps the
packets in fragmented MP4 about a second at a time. The module is fetched only when such a track is
chosen, so nothing about it is in the first-load code. Sound is counted in samples from the first
fragment after a start or seek and re-anchored when the file has a gap, so it stays with the
picture. Tracks that play as they are are never converted, and a failure at any step (the module
won't load, a decoder crashes, the encoder errors) drops the audio buffer so the picture plays on.

**Chapters.** The remuxer reads the chapter list the way the apps do: the default edition (else the first), nested
chapters included, hidden and disabled ones left out, an unnamed one numbered by the player. A list before the clusters
comes with the header; one after them is found through the SeekHead and read behind the index, so it never delays the
first picture. Times are shifted by the timeline's delay, so a chapter's start is a time on `<video>`. The Options panel
gets a Chapters page (name and time, the one playing checked, a choice seeks) and the scrubber gets a thin Ink 2 tick
under the rail's holes at each chapter after the first (none when there are more than 40, which would make a comb); the
holes keep their colours. Jellyfin and Emby list chapters on the item, and those win when playing from them
(`Source.chapters`); the file's are for every other source.

**Picture subtitles.** Blu-ray PGS and DVD VobSub (`crates/flow-remux/src/picture.rs`, a port of FlowKit's decoders)
are decoded to palette-indexed bitmaps in the worker. The crate keeps the raw packets of every picture track (a few KB
each, 16 MB at most, the ones furthest from the playhead going first), so choosing a track mid-film has the pictures of
what already streamed; choosing one at the start costs nothing extra. `pictures.ts` keeps each cue until the next begins
(ten seconds when nothing says), under a memory budget. `PictureSubtitles.tsx` draws them on a canvas laid on the picture
as the apps do (`pictureLayout.ts`: the disc's canvas spans the picture's width and is centred on it, anamorphic DVD video
stretched sideways), follows Zoom, the subtitle delay and the viewer's subtitle position, and rises just clear of the
controls when a line would sit behind them. DVB subtitles still say they aren't supported.

**Remembered headers.** `headerCache.ts` keeps what reading a file's far end cost, so reopening it is quick: the remuxer
exports its SeekHead, Info, Tracks, chapters and Cues as one blob (`exportHeader()`), saved in IndexedDB once both far
reads are done and loaded with `importHeader()` before the header is read, which leaves nothing to fetch past the first
512 KB. A resume part-way in then doesn't wait for the index. A file is named by a hash of its address, size and ETag or
Last-Modified (when the server lists them in `Access-Control-Expose-Headers`), and, for links that change on every
request, by a hash of its first 64 KB and its size; the address itself is never stored. Records go after 30 days unused,
beyond 24 MB or 150 files, or when the server shows a different ETag or date. Any failure is a miss.

## Smooth playback

`canPlayType` says a browser accepts a codec, not that this device keeps up with it: 4K HEVC or AV1
without a hardware decoder plays as a slideshow. At startup (when the page is idle) `lib/sources/smooth.ts`
asks `navigator.mediaCapabilities.decodingInfo` about each class sources come in (H.264, HEVC, AV1 and
VP9 at 2160p, 1440p and 1080p, with and without HDR; Dolby Vision counts as its HEVC base layer) and
remembers `smooth` and `powerEfficient`. Ranking reads those answers synchronously: a class known not to
be smooth sinks below a smooth 1080p copy and says "May stutter on this device" in the picker; software
decoding that keeps up costs a little. An unanswered class, or a browser without the API, changes nothing.

While a film plays, `features/player/Struggle.tsx` samples the element every two seconds
(`getVideoPlaybackQuality`, stalls, seconds buffered ahead) into the rules in `struggle.ts`: more than 8 %
of frames dropped over ten seconds, or two stalls in a minute, never in the first eight seconds after a
start or seek. A dry buffer means the connection (and says how fast the file arrives against how fast it
needs to); frames dropped with a full buffer mean the device. The notice offers the best lower-resolution
source that plays, keeping the position, and "Keep Watching" is remembered per title. Press **I** (or
Options → Playback Info) for a card with the picture size, codec, engine, dropped frames, buffer and
download rate.

## Ordering and showing sources

Settings → Sources has the apps' source settings (`lib/sources/sourceSettings.ts`, `order.ts`, with the apps' test
cases in `order.test.ts`): category order and each category's provider order, which always apply; with Use Custom
Source Ordering on, sort rules (cached, resolution, quality, size, seeders, HDR, language, each best first or lowest
first), filters (CAM and screeners, uncached, minimum resolution, size bounds, required and excluded keywords,
excluded codecs) and a result cap; and Source Appearance (add-on text or a parsed summary, which title a row leads
with, badges, file size, compact rows, with a live preview). The scoring in `rank.ts` still runs first and decides
ties, so the smooth-decode, HDR and audio-language ranking holds wherever a setting doesn't say otherwise; a source
this browser can't play, or is known to stutter on, goes last whatever the rules. The picker's chips (resolution,
provider) are session-only and sit on top of the saved filters, and the picker says how many sources they hid.
The settings are stored as `sources` and are left out of the defaults on purpose, so nothing here loads with the app.

## Media servers

Settings → Media Servers and what the servers add to Home, Search and the player, as the apps have them
(`lib/sources/jellyfin.ts`, `plex.ts`, `webdav.ts`, with the apps' words and defaults):

- **Home.** Recently Added to Your Server is a real shelf (off by default, as in the apps): the newest 30 of every
  enabled server, merged, newest first. **Server Home Rows** (Settings → Shelves) gives each switched-on server a row
  per library, named as the server names it ("Movies"; "Living Room · Movies" with more than one server), 60 titles
  each, newest first. A `mediaServerLibrary` shelf pasted from the apps becomes the same row. A server's titles carry
  TMDB ids (Plex's guids, Jellyfin's provider ids); each row reads its posters from TMDB like any other, and **Use Server
  Artwork** puts the server's own pictures over them. A title the server never matched to TMDB isn't listed, since its
  page couldn't open. The apps have no "continue watching" shelf from a server either: the server's own Continue
  Watching follows from the playback reports below.
- **SERVER on a poster.** A title on any enabled server ends its edge print with SERVER, after the rating (the apps'
  `EdgePrint.poster(onServer:)`), printed after the rating but ranked above it and the runtime, so a strip with little room keeps "8.2 · SERVER" and a
  phone's 112 px poster (which keeps its holes, as every strip does) keeps SERVER alone. It is on the Search top
  result too, and **Show Badge on Posters** (on) switches it. What is on a server comes from an index of every
  server's titles by TMDB id (a server's titles without one by name and year), read lazily and kept in the saved query cache
  (`marks.ts`, `serverCatalogue.ts`), refreshed after half an hour or from Settings → Refresh Library Index. A server that
  doesn't answer is named there and left out; if none answers nothing is judged. **Only Show My Server's Content** leaves
  out of Home's rows and Search what no server lists (people stay), with no filtering while the index can't be read.
  Explore isn't filtered yet.
- **Play From This Library Only** (Settings → Sources → Library). A title opened from one of a server's library rows on
  Home remembers that server for the visit (`rememberLibraryOrigin`, sessionStorage); the source search asks that server
  first and only asks everyone when it has nothing. Titles opened anywhere else are unchanged.
- **Playback is reported.** `useServerReport` tells the server a source came from: started when the picture first moves,
  progress every ten seconds, paused, and stopped when it ends, the player closes or the page closes (a `keepalive` request, which a browser may still drop on a hard
  close, so Continue Watching can lag until the server times the session out). Jellyfin and Emby get `Sessions/Playing`, `/Progress` and `/Stopped` with the position in ticks; Plex gets
  `/:/timeline` and a `/:/scrobble` for a stop at 90 % or more (Plex's own watched line). **Track Only With Your Tracking
  Service** stops the reports and ignores the server's resume point. Sample streams report nothing.
- **WebDAV.** Settings → Media Servers → WebDAV Shares: name, address, an optional login, and the Movies and TV Shows
  folders (`/Movies` and `/TV Shows`). Flow lists them with `PROPFIND` (two levels down, at most 400 folders a level, kept
  for five minutes) and offers the files named like the title ("Movie (2020).mkv", "Show/Season 1/Show S01E02.mkv") in the
  picker, under the WebDAV category between Media Servers and Add-ons.

**What a browser needs from a WebDAV share.** Listing is a cross-origin `PROPFIND` with `Authorization` and `Depth`
headers, so the browser asks the server first (a CORS preflight) and almost no WebDAV server answers it. The server has to
allow this site's address, the `PROPFIND` and `OPTIONS` methods, and the `Authorization`, `Depth` and `Content-Type`
headers; the error says exactly that when the browser gets no answer (it can't tell a server that is off from one that
refuses web pages). The stream proxy can't stand in for the listing: its Worker answers `GET` and `HEAD` only and never
forwards a login, by design. It does carry the files themselves when a share allows listing but not reading. Playing
needs more of the same: a password goes as an `Authorization` header, which a media element can't send, so a
password-protected share plays Matroska (the remuxer reads with headers; the share must expose `Content-Range`) and
offers MP4 and WebM as "Needs request headers a browser can't send". A login in the address (`https://user:pass@…`) is
blocked by browsers for media, so Flow never builds one. Shares are kept in settings and in the backup (passwords
included, like the servers' tokens), not in Flow Sync.

Tests: `servers.test.ts` (answers in the servers' response shapes: libraries, newest titles, search, catalogue paging,
the report calls), `report.test.ts` (the order and timing of reports), `webdav.test.ts` (Apache and Nextcloud answers,
matching, sources, errors), `libraryFirst.test.ts`, and the index and SERVER print in `home/serverIndex.test.ts`,
`marks.test.ts` and `stripLayout.test.ts`.

## Skipping and binge watching

The player has what the apps have for watching a series (`features/player/segments.ts`, `segmentSources.ts`,
`stillWatching.ts`, each with the apps' own test cases):

- **Skip Intro, Skip Recap, Skip Credits** as a yellow button bottom right above the scrubber while the segment plays
  (Enter or **S** presses it). Settings → Playback sets each to Show Button, Skip Automatically (skips once as the
  segment begins and says "Skipped intro" with Undo) or Off. The scrubber marks each segment with a thin tick under the holes.
- **Where segments come from**, first answer wins: the server the file plays from (Jellyfin media segments, Plex
  markers), IntroDB, PublicMetaDB (each only with a key), then the file's chapter names ("Opening", "Ending"), read
  by the remuxer from wherever the file keeps them (see Matroska below). No answer means no button, never an error.
- **CORS.** IntroDB's CORS header allows only introdb.app, so from the website it is asked through the stream proxy
  (with `api.introdb.app` in its `ALLOWED_HOSTS`). PublicMetaDB sends no CORS headers and needs an Authorization header
  the proxy doesn't forward, so it can't be read from a web page; its key is kept for Flow Sync and the apps. A refused
  service isn't asked again until the page reloads.
- **Next Episode.** Up Next comes up as the credits begin when a segment says where (else in the last 30 seconds), with
  a Next Episode button. Credits that run to the end of an episode with another after it are skipped to that episode.
- **Are You Still Watching?** After the number of episodes in Settings (3, as in the apps) play one after another
  with no click, key or pause, the next episode waits behind "Keep Watching" and "Stop".
- **Wait for the Episode to End** (Settings → Playback) brings Up Next up so its countdown ends as the episode does, instead of at the credits.
- Sample data (`?demo`) has an intro at 0:05 to 0:20 and credits for the last 18 seconds of any sample stream.

## Player extras

What the apps' player has beyond that, each with the apps' words and defaults (pure logic in its own module with a test):

- **Sleep Timer** (Options): 15, 30, 45 minutes, 1 hour, 90 minutes or End of Episode or Movie (`sleepTimer.ts`). The sound fades over the last 30
  seconds, then the picture pauses (where a browser won't let a page set the volume, iPhone and iPad, it just pauses). The timer carries
  on into the next episode; End of Episode lets this one finish and closes the player.
- **Hold for 2×:** a finger held on the picture for 0.45 s plays at double speed until it lifts (a wander of 40 px cancels); on a keyboard, hold **X**.
- **What Did They Say?** (Options, **W**, or a finger held on Back 10 Seconds) goes back ten seconds and shows subtitles for just that stretch
  even when they are off, then puts them back (`replay.ts`).
- **Subtitle Delay** (Options, beside Subtitle Style): -10 to +10 seconds in tenths, positive later. It shifts every cue Flow draws, is remembered for
  the title until the page closes, and has a Reset (`subtitleDelay.ts`).
- **Never Use Dolby Vision** (Settings → Playback): the remuxer leaves out the Dolby Vision configuration, so the file plays as its HDR10 picture
  (profile 5, which has none, stays Dolby Vision). It is in the Rust crate (`codecs::hdr10_only`), rebuilt into `src/lib/remux/pkg`.
- **Volume Boost** (Options): up to 12 dB through a Web Audio gain and a limiter (`volumeBoost.ts`). It is offered only where routing the
  video through Web Audio can't silence it (the remuxer's and hls.js's own MediaSource streams, and same-origin files), and the graph is built
  only once the audio context is running.
- **Screen kept awake** while the picture plays, with the Screen Wake Lock API; let go on pause and when the page hides, taken again when it shows (`wakeLock.ts`).
- **Open in** (Options, and a preferred app in Settings → Playback): the apps' list for the platform (Infuse, VLC, Outplayer, SenPlayer, VidHub, CineUltra
  and Moon Player on iPhone and iPad; Infuse, VidHub, IINA and mpv on a Mac), by their link schemes (`externalPlayers.ts`). Offered only for a plain web
  address that needs no request headers, so not for the remuxed or proxied copy the page plays. Infuse gets the resume point. It is never opened by itself:
  a page can't tell whether the app is installed.
- **Post-Credits Scene Alert** and **Because You Watched** (Settings → Playback, on): as a film's credits begin, a quiet note says if TMDB's keywords
  (`duringcreditsstinger`, `aftercreditsstinger`) name a scene to stay for, and such credits are never skipped by themselves. Otherwise a few of its
  recommendations come up beside the credits (closing them gives back Skip Credits), and where the film ends they fill the screen. The keywords
  are asked for once the film is playing (`/movie/{id}/keywords`), so the title page's request is unchanged. Films of half an hour or more only.

## Subtitles

Options → Audio and Subtitles → **Search Subtitles…** asks OpenSubtitles, SubDL, Wyzie and SubSource at once (`lib/subtitles/`:
`providers.ts` builds each request and reads each answer, as FlowKit's `Subtitles.swift` does, with tests on recorded answers
in `__fixtures__/`; `search.ts` ranks them like the apps: your languages in order, then your Subtitle Type, then downloads).
Keys are in Settings → Playback → Subtitle Keys and travel through Flow Sync under the apps' names (`openSubtitlesAPIKey`,
`openSubtitlesUsername`, `openSubtitlesPassword`, `subdlAPIKey`, `subSourceAPIKey`), sent only once set. A pick is downloaded,
unzipped (`zip.ts`: gzip and zip through `DecompressionStream`, plus a zip directory reader in about eighty lines), decoded
(UTF-8, UTF-16 or Windows-1252) and becomes a track of its own, drawn with the viewer's style and moved by the subtitle delay.
When the file lacks the subtitles Settings ask for (Always, or Foreign Audio Only with foreign audio) the first result in your
language is fetched by itself a couple of seconds in, as in the apps, when any service has a key.

What a web page can do, checked against the live services:

- **OpenSubtitles** allows every origin and every header a preflight asks for except `Authorization` (a wildcard never covers
  it), so the page asks with the API key alone; the login's token can't be sent, and downloads count against the key's daily limit.
  The file it points to is on `www.opensubtitles.com`, which sends no CORS headers: it is fetched through the stream proxy, so
  `www.opensubtitles.com` (and `dl.opensubtitles.org`) belong in the proxy's `ALLOWED_HOSTS`.
- **SubDL** allows every origin for its API and `dl.subdl.com`; its files are zips.
- **Wyzie** has moved to `sub.wyzie.io` and wants a free key (`key=`; claim one at store.wyzie.io/redeem). The apps ask the same
  host, and the key syncs as `wyzieAPIKey`.
- **SubSource** sends no `Access-Control-Allow-Origin` at all and its key is a header the stream proxy doesn't pass on, so a web
  page can't use it. It is tried, and the page says why when the browser refuses; the key is kept for Flow Sync and the apps.

**Selection** (`player/languages.ts`, with the apps' `TrackSelection` rules): Show Subtitles has Forced Only beside Foreign Audio
Only, Always and Off; Subtitle Type (Standard or SDH) decides between two tracks of one language, in the file and in search
results; Anime Audio (No Preference, Sub, Dub) applies to Japanese animation (TMDB's Animation genre with Japanese as the original
language): Sub plays Japanese audio and always shows subtitles, Dub shows none, not even forced ones. A subtitle in the file is
taken before one from a search.

**ASS styling.** Settings → Playback → Keep Original ASS Styling (off, as in the apps) draws ASS and SSA files the way their author
styled them, with libass through JASSUB 2.5.18 (`player/ass.ts`). A renderer of our own would be a partial libass, so JASSUB it is;
its cost is a 2.2 MB WebAssembly module (920 KB gzipped), a 146 KB default font and 15 KB of script, about 1.1 MB over the wire, in lazy chunks that only `ass.ts` imports and only an ASS track
shown with the setting on loads (nothing of it is in the first load or the service worker's precache). Local fonts aren't queried
(Chrome would ask for permission), so a font the browser can't supply is drawn in the default one. Two of JASSUB's CommonJS
dependencies are stood in for (`src/lib/shims`, `vite.config.ts`) so the module-wrapper helper they need doesn't join the first load.
It covers ASS files Flow reads itself (from a source or a search); ASS tracks inside an MKV arrive as cues without the script.

## Seek previews

Hovering or dragging the scrubber, or pressing an arrow key, shows a small frame (`SeekPreview.tsx`) of where you
would land, with the time on a strip under it; where no picture is available it is the time alone. Dragging moves the
time at once and seeks the real video on release, except where there is no preview picture (a phone playing a plain
file), where the picture follows the finger a few times a second as before. Where the pictures come from:

- **Matroska:** the worker reads one keyframe on its own lane (`worker.ts`, `thumbs.ts`). The demuxer's `thumbTarget`
  names the cluster and the keyframe's position inside it from the seek index, so the read starts there and stops as soon
  as the keyframe is whole: 512 KB first (more once the file's keyframes are known to be bigger, up to 4 MB), then one
  request for what is missing. WebCodecs decodes it in the worker, it is drawn at most 320 px wide, and the last sixty
  are kept. One preview is read at a time at low priority, the newest replaces one still waiting (and one that has only
  just started), and none starts while the stream has under two seconds buffered ahead. Without `VideoDecoder`, or a
  decoder for the file's codec (HEVC and H.264 depend on the device), the player says so once and shows the time only.
- **Files the browser plays itself** (MP4, WebM, including the blocked-host fallback): a hidden muted second `<video>`
  with the same address, seeked on hover and shown in the frame, so it needs no CORS. Created on the first hover; not on
  phones or with Data Saver on.
- **Jellyfin 10.9+:** the server's trickplay tiles, whatever the engine; no decoding at all.

## Live TV

Home, Explore, Library, **Live TV**, Search. Live TV is the apps' Live TV on the web: IPTV providers (an
M3U/M3U8 playlist, or an Xtream Codes login) are added in Settings → Live TV, with an optional XMLTV guide
address. `?demo` brings the sample **Flow Live** provider.

- **Parsers** (`src/lib/livetv/`, tests ported from FlowKit's): `m3u.ts` (tvg-id, tvg-name, tvg-logo,
  tvg-chno, group-title, catch-up flags, per-channel user agents; VOD entries kept apart), `xtream.ts`
  (categories, live streams, account, short guide, stream addresses with the login escaped), `xmltv.ts` (a
  streaming reader: gzip unpacked on the way in, only the playlist's channels and the next day and a half
  kept) and `epg.worker.ts` (runs it off the main thread). Channels and the guide are kept in IndexedDB
  until the refresh time in Settings passes (`cache.ts`, `load.ts`).
- **Network:** most IPTV hosts send no CORS headers and many are `http://`. Playlist, guide and API
  requests go direct first, then through the **Stream Proxy** (Settings → Playback) if that fails, and
  straight through it for a host already known to be blocked or one a page can't call at all. Live
  streams are opened the same way: hls.js is given a loader that sends the manifest and every segment
  through the proxy (`lib/sources/hlsProxy.ts`). Errors name the host, never the address (it carries the
  login), and say what to do. The Worker in `proxy/` fetches only https on port 443, so a provider on
  `http://` or `:8080` needs a proxy that allows it, such as MediaFlow Proxy.
- **Playing:** `LivePlayer` reuses the film player's engine (hls.js; Safari plays HLS itself) and
  controller. A raw MPEG-TS address is tried as HLS first (as the apps do); a browser can't play raw
  MPEG-TS, so a channel only available that way says so.
- **Not yet:** the providers aren't part of Flow Sync (a follow-up: the sync payload would carry
  `liveTV`, with logins encrypted like the server tokens), and the browser can't send a custom
  User-Agent.

## Trakt

Settings → Account signs the website in to the owner's own Trakt app, with the Client ID alone: the sign-in is the
authorization-code flow with PKCE (no client secret, as in the apps). Trakt's API sends CORS headers
(`access-control-allow-origin: *`, and it echoes the headers a preflight asks for), so the page talks to
`api.trakt.tv` directly and no proxy is involved.

- **Redirect URI.** `<site origin><base>settings/trakt-callback`, shown in Settings → Account with a Copy button. The
  owner adds exactly that to the Trakt app at trakt.tv/oauth/applications, next to the apps' `flow://trakt-callback`.
  The address isn't a screen: `lib/trakt/arrive.ts` sends the browser to Settings → Account before the router reads
  it and finishes the sign-in in the background, so a failure is told in Account.
- **Through Flow Sync.** The Client ID travels in the `keys` section (`traktClientID`, `simklClientID`) and the token in
  `accounts.trakt` in the apps' shape, with the `redirectURI` it was issued against; Simkl's entry is never touched. A
  sign-in, a refreshed token and a sign-out are pushed at once, and a token pulled from another device signs the site
  in with no prompt. Before refreshing, Sync is pulled first, since another device may have rotated the token (and
  again if the refresh is refused). A refresh quotes the redirect the token was issued against.
- **Library.** While signed in, the watchlist, recent history, watched episodes and resume points come in on sign-in,
  when the tab returns and every five minutes (`lib/trakt/merge.ts` holds the rules), and what changes on the website
  (watchlist, marked watched, a dismissed resume point) goes up a couple of seconds later from a queue that survives a
  reload. The watchlist is two-way; history is additions only. Signed out, the library works as it always has. Sample
  data is never sent.
- **Scrobbling.** The player starts, pauses and stops a scrobble with how far in (`features/player/useTraktScrobble.ts`
  hooks it up). A stop at 80 % or more is Trakt's watch and also marks the title watched here.
- **Ratings.** A title page offers five stars (two points each, as the apps) for a title that is watched or already
  scored. `titleLibrary.rate` keeps the score in the library whoever is signed in and, when signed in, calls
  `rateTitle(item, 1–10 | null)` in `lib/trakt/engine.ts`, which queues and sends it like the rest. The player can offer the
  same stars at the end of a film with `<StarRating item={item} />` from `features/detail/StarRating`.
- **Marking unwatched.** `titleLibrary.markUnwatched` takes a film or episodes out of what is watched and calls
  `unwatchTitle` in the engine, which queues a removal from Trakt's history. (A cleared history never un-watches
  anything on Trakt, which is why this is an explicit call and not something the library's changes are diffed into.)
  An episode whose removal is still waiting isn't brought back by the next pull.
- **Budget.** `lib/trakt/boot.ts` is the only part in the first load; the sign-in, sync and scrobbler are lazy chunks.

## Ratings, requests and episode numbering

Settings → Metadata and Requests hold the keys and choices; every key is checked with its service before it is kept.

- **Ratings** (`lib/ratings/`, `features/detail/Ratings.tsx`). The title page prints IMDb, Rotten Tomatoes, Popcornmeter,
  Metacritic, TMDB, Letterboxd and Trakt as aligned numbers with the site's name under each (no logos or boxes), from
  MDBList with the viewer's key, as FlowKit's `MDBListClient` and `CatalogService.ratings`. TMDB's own score is there at
  once, and Trakt's community score is asked for directly when MDBList lacks it. Settings → Metadata → Ratings Shown
  chooses and orders them (arrows, so a keyboard works). **Tap a Rating** opens that site's page (`RatingLinks`); it is
  on by default here, where the apps default it off, because a score on the web is a plain link. Sample data answers with
  the apps' sample formulas. The apps' **rating icon packs** (custom logos from a JSON address) are left out: the title
  page is numbers and names.
- **Poster Enhancement** swaps a poster's address for RatingPosterDB's (`posterOf` in `lib/ratings/posters.ts`, used by
  the poster cards and search results), off by default; `fallback=true` makes the service answer with the plain poster
  when it has no rated art. A change applies to posters rendered afterwards.
- **Requests** (`lib/requests/seerr.ts`, `RequestButton.tsx`). With a Seerr, Overseerr or Jellyseerr connected, a title
  none of the viewer's media servers has gets a Request button; its words are Request, Requested, Processing and
  Available. A series with more than one season asks All Seasons or Latest Season in place. The address `demo.flow.invalid`
  answers from the sample catalogue.
- **Episode numbering** (`lib/tvdb/`). Settings → Metadata → Episode Source is TVDB by default (as the apps), TMDB or
  Trakt. With the TVDB key, `q.season` reads the series' episodes from TVDB once (`lib/tvdb/season.ts`), fills TMDB's
  stills, scores and missing words in where the numbering lines up (`withTMDB`, from `EpisodeProvider`), and falls back to
  TMDB's own list on any failure. Because every screen reads episodes through `q.season`, Next Up, the player and Home
  follow the numbering too. The season list itself still comes from TMDB, as in the apps.
- **CORS.** MDBList, RatingPosterDB, TVDB (login POST and the Authorization header on reads) and Trakt all answer browsers
  with `Access-Control-Allow-Origin: *`, checked from Chromium and Firefox, so none of them uses the stream proxy. Seerr
  can't use it either: the proxy only fetches with GET and passes no headers on, and a request is a POST with `X-Api-Key`.
  The instance has to allow web pages itself (a reverse proxy adding CORS headers); Settings says so when it can't be read.
- **Sync.** `mdblistAPIKey`, `tvdbAPIKey` and `rpdbAPIKey` travel in the `keys` section, written only once this browser
  has one so a blank browser never clears the apps' copy. The Seerr address and key stay in this browser.

## Title pages

`features/detail/` is the page for a film or series, matching the apps' Detail view:

- **About** (always the release, runtime, seasons, director and rating; with Settings → Appearance → Title Pages → About
  on, also status, language, country, budget, revenue, companies and network), **Where to Watch** (a row of logos for
  Subscription, Free, Rent and Buy in the viewer's own region), **Reviews** (TMDB's plus Trakt's most-liked comments when
  a Client ID is set; cleaned by `lib/reviewText.ts`, a port of FlowKit's `ReviewText`; a Trakt review flagged as a spoiler,
  or words inside `[spoiler]` tags, stay blurred until tapped), logo art for the title, and a trailer picker.
- **Watching.** Every aired episode has a check, the season has Watch Season, and the show has Watched. **Shuffle** picks a
  random episode not yet picked this round, preferring one not watched (`lib/watching.ts`, from FlowKit's `nextShuffle`);
  **Rewatch** makes Next Up and the episode checks follow what is watched again.
- **Settings** (Appearance → Title Pages): About, Where to Watch, Reviews, Episode Spoilers (off blurs the still and hides the
  synopsis of an aired episode not yet watched), Specials Season and Text Size.
- The code that reads a title's details (`lib/tmdb/detail.ts`), the reviews (`lib/reviews.ts`, `Reviews.tsx`) and the library
  actions beyond marking one thing watched (`lib/store/titleLibrary.ts`) are chunks of their own, so the first page carries none of them.

## Library: Upcoming, Sports and Stats

Library's overview opens three more pages, as the apps' tiles do, each at `/library?list=` (so the PWA shortcut to
Upcoming is `library?list=upcoming`) and each a chunk of its own, loaded when opened (`features/library/`).

- **Upcoming** (`calendar.ts`, `UpcomingPage.tsx`): a day-by-day calendar of the shows you follow (Continue Watching, the
  watchlist, favourites and History) and the films on your watchlist: a strip of the next two weeks that jumps to a day, Just
  Aired for the last seven days, a section for each day after. Films are dated by Settings → Shelves → Film Dates (digital
  release by default, as on Home; `home/upcoming.ts` holds the one rule for both). **Add to Calendar** downloads an `.ics`
  (`lib/ics.ts`, with tests): one event, or every upcoming one with Add All to Calendar. TMDB gives only a day, so each is an
  all-day event, and its id comes from the episode or film, so adding it twice updates it.
- **Stats** (`lib/stats.ts`, `statsView.ts`): a port of FlowKit's WatchStats, case for case: watch time, films, episodes and
  shows, hours by month, week or year, top genres, most-watched shows, longest streak and favourite weekday, for This Year,
  Last 30 Days or All Time. History now records each watch's length in minutes (`HistoryEntry.runtime`), from the player or the
  scrobbler; older entries take their title's typical runtime from TMDB, and failing that the apps' defaults (45 and 110
  minutes). The library keeps the latest 500 plays, so All Time reaches as far back as that.
- **Sports** (`lib/sports/`, `SportsPage.tsx`): the teams you follow, with fixtures and results from TheSportsDB, called
  directly (its API allows browser requests, so the stream proxy isn't involved). Tapping a game plays the best matching
  Live TV channel, or lists the channels (Settings → Live TV → Sports, Choose Channel on Tap); the button beside the game does
  the other. `match.ts` is FlowKit's SportsChannelMatcher: guide entries around kick-off that name the teams, then channels
  named after the league. Show Score Spoilers off covers final scores until tapped. The key, the two switches and the teams
  are the `sports` setting, absent until first changed, so none of it loads with the first page.
  Unlike the apps, there is no notification for a finished match.

A page that reads queries with react-query (as these do) must import something from `lib/queries.ts`, or the bundler splits
the shared query code into more first-load files and the budget grows.

## Sample data

`?demo` in the address, or **Explore with Sample Data** on the welcome screen, fills every screen
from `src/lib/tmdb/demo.ts` with no key. The same catalogue as the apps' Demo mode. It also gives Library months of viewing
for Stats, three films with release dates near today for Upcoming, and two made-up clubs for Sports (`lib/sports/demo.ts`), one of
them playing within the hour with a channel on air in the sample guide.

## Limits of a browser

- **Mixed content:** a page served over HTTPS can't reach an `http://` server. Use HTTPS for your
  Jellyfin/Emby/Plex server, or run Flow locally (`npm run preview`) to reach one on your network.
- **CORS:** TMDB, Trakt, Stremio add-ons, Jellyfin, Emby and Plex all allow browser requests (a WebDAV share has to be set to; see Media servers). Some IPTV
  playlists and file hosts don't (most debrid download servers send no CORS headers), and those can't
  be read from a web page. Settings → Playback has a **Stream Proxy** field: a proxy you run fetches
  such files for Flow and adds the headers. `proxy/` holds a Cloudflare Worker for it
  (`proxy/README.md`), and MediaFlow Proxy works too. Flow uses it only for hosts that need it.
- **Codecs:** browsers can't decode DTS or TrueHD audio, and some have no Dolby Digital decoder
  either (Chrome on Linux and Firefox). Flow plays another audio track when the file has one that
  plays as it is. Otherwise it converts the sound: a Web Worker decodes it with FFmpeg's decoders
  (WebAssembly) and WebCodecs' `AudioEncoder` makes stereo Opus of it, which the page plays. That
  needs a browser that can encode Opus (Chrome, Edge, Firefox and Safari 26) and a file Flow can
  read: not one behind a host that blocks web pages and no stream proxy. Converted sound is stereo
  (5.1 and 7.1 are mixed down), and the audio menu says so. If the conversion fails, the picture
  plays on without sound and the player says why.
