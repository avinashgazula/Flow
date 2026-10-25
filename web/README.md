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
| `src/lib/sources/` | Stream add-ons, Jellyfin/Emby and Plex, and source ranking. |
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

Browsers can't play `.mkv`, so `src/lib/remux` does it: a Rust crate (`crates/flow-remux`, 130 KB of
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

## Skipping and binge watching

The player has what the apps have for watching a series (`features/player/segments.ts`, `segmentSources.ts`,
`stillWatching.ts`, each with the apps' own test cases):

- **Skip Intro, Skip Recap, Skip Credits** as a yellow button bottom right above the scrubber while the segment plays
  (Enter or **S** presses it). Settings → Playback sets each to Show Button, Skip Automatically (skips once as the
  segment begins and says "Skipped intro" with Undo) or Off. The scrubber marks each segment with a thin tick under the holes.
- **Where segments come from**, first answer wins: the server the file plays from (Jellyfin media segments, Plex
  markers), IntroDB, PublicMetaDB (each only with a key), then the file's chapter names ("Opening", "Ending"), read
  from the first bytes of an MKV by `lib/remux/chapters.ts`. No answer means no button, never an error.
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

## Sample data

`?demo` in the address, or **Explore with Sample Data** on the welcome screen, fills every screen
from `src/lib/tmdb/demo.ts` with no key. The same catalogue as the apps' Demo mode.

## Limits of a browser

- **Mixed content:** a page served over HTTPS can't reach an `http://` server. Use HTTPS for your
  Jellyfin/Emby/Plex server, or run Flow locally (`npm run preview`) to reach one on your network.
- **CORS:** TMDB, Trakt, Stremio add-ons, Jellyfin, Emby and Plex all allow browser requests. Some IPTV
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
