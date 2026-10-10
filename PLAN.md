# Flow — Product & Engineering Plan

Flow is a native media hub for iPhone, iPad, Mac and Apple TV. It does not host
content. It brings together metadata (TMDb, TVDB, Trakt), your tracking service
(Trakt, Simkl, MDBList, PublicMetaDB or on-device), and playable sources you
configure yourself: your Jellyfin, Emby or Plex servers, WebDAV shares, IPTV
providers (M3U / Xtream Codes) and Stremio-protocol stream add-ons.

---

## 1. Feature inventory

### 1.1 Navigation
| Platform | Shell |
|---|---|
| iOS / iPadOS | Floating tab bar: Home · Explore · Library · Live TV · Search. Settings opens from the gear on Home. |
| macOS | `NavigationSplitView` sidebar with the same five sections plus Settings (also in the standard Settings window, ⌘,). |
| tvOS | Top tab bar, focus-driven cards (`.buttonStyle(.card)`), larger type, no downloads. |

### 1.2 Home
- **Hero carousel** — trending titles with backdrop, logo art, rating, year, genres, certification, type pill and overview. Paging dots, auto-advance.
- **Continue Watching** — resume points from the active tracker (Trakt `/sync/playback`, Simkl, local) with progress bar, "11m left", SxxEyy badge, plus **Next Up** episodes.
- **Configurable shelves** — Watchlist, Trending Movies/Shows, Popular, Top Rated, Now Playing, Upcoming, Anticipated, Airing Today, TMDb Discover shelves (genre / year / language / provider / sort / date window), Trakt lists, MDBList lists, Media-server libraries, Favourites, Recently Watched.
- Watched check marks on posters; media-server badge on posters whose title is in your library.

### 1.3 Explore
- Movies / TV Shows segmented control.
- Filter sheet: genres, year range, minimum rating, original language, sort order, watch provider/region.
- Infinite grid ("Trending Now" by default), Reset.

### 1.4 Library
- Downloads (iOS / macOS), Sports (followed teams, upcoming fixtures).
- Watchlist, Watch History, Favourites, Lists — each with "see all".

### 1.5 Live TV
- IPTV providers: M3U playlist (+ XMLTV EPG URL) and Xtream Codes (live, VOD, series).
- Categories / groups, channel grid, now & next from EPG, favourite channels, recently watched channels, search.

### 1.6 Search
- Debounced multi-search (movies, shows, people), recent searches chips with Clear, trending rows when idle.
- Media-server results row (toggleable).
- Unreleased-title filter is **not** applied to search.

### 1.7 Detail page
- Backdrop/poster hero with logo art, year · runtime · genres · certification.
- Ratings row: IMDb, Rotten Tomatoes (critics + Popcornmeter), Metacritic, TMDb, Letterboxd, Trakt (via MDBList + TMDb + Trakt).
- Overview, **Play / Resume**, Watched (eye), Favourite (heart), Watchlist (bookmark), Download.
- Seasons and episodes (episode source TVDB/TMDb/Trakt, air dates converted to local time zone), per-episode watched state, Shuffle play.
- Rewatch mode (start a rewatch; Next Up follows rewatch progress).
- Cast & crew → person page (bio + filmography).
- Trailers (picker when several), Recommendations, Similar, Collection.

### 1.8 Source picker & playback
- Sources gathered in parallel from every enabled provider, grouped/ordered by **category order** (Media Servers, WebDAV, IPTV/VOD, Add-ons) then provider order.
- Stream title parsing: resolution, source (WEB-DL, BluRay, TS, CAM…), video codec, HDR/DV, audio codec + channels, size, languages, cached flag.
- **Custom source ordering** (optional): sort rules, filters (exclude CAM/TS, size bounds, required/excluded keywords, languages), result cap. Preferred resolution cap from Playback always applies.
- **Source appearance**: raw add-on text vs. parsed rows, title display, badge packs.
- Player: AVPlayer engine behind a `PlaybackEngine` protocol; "Connecting…" loading screen with logo and progress; resume; audio & subtitle track selection; external subtitle search (OpenSubtitles, SubDL, Wyzie, SubSource) with offset/size/style; skip intro/recap/credits (IntroDB, PublicMetaDB, Jellyfin media segments); auto-play next episode; scrobbling to the tracker; AirPlay; Picture in Picture (iOS/macOS); external players on iOS (Infuse, VLC, Outplayer).

### 1.9 Settings
| Section | Contents |
|---|---|
| General | Accent colour, start tab, poster titles, hero auto-advance, haptics |
| Account | Tracking With (Trakt / Simkl / PublicMetaDB / MDBList / This Device — exactly one), Trakt & Simkl device sign-in, Sync Now, Sign Out, Sync Interval, Watchlist Saved To, Favourites Saved To, API keys (PublicMetaDB, MDBList, IntroDB, Subtitle sources) |
| Shelves | Enable, reorder, add/edit Discover / list shelves |
| Media Servers | Add Jellyfin / Emby / Plex (Plex PIN sign-in), enable toggles, swipe to remove, poster badge, Only show my server's content, Search media servers, Use server artwork |
| WebDAV | Servers, root paths, test connection |
| Live TV | IPTV providers (M3U + EPG / Xtream), EPG refresh |
| Sources | Custom ordering switch, Source Appearance, category order, provider order, add-ons (manifest URLs), sort rules, filters, result cap |
| Data & Storage | iCloud Sync toggle with per-domain status (playback progress, rewatches, shelves, media servers, shuffle history), storage used of 1 MB, Push / Pull, Last Synced, clear caches |
| Share / Import Setup | Export configuration (optionally without secrets) as file / text / QR; import from file, paste or QR |
| Playback | Preferred resolution cap, auto-play next, skip intro/credits behaviour, resume prompt, default audio language, external player |
| Subtitles | Preferred languages, auto-enable, size, colour, background, default offset |
| Metadata | Episode source (TVDB recommended / TMDb / Trakt), air dates in my time zone, Show Unreleased Titles, primary source, TMDb language, TMDb API key, TVDB API key |

### 1.10 Sync model
- Tracker owns watch history, watchlist, ratings and resume positions when one is connected.
- iCloud key-value store (1 MB) syncs settings, playback progress (local tracker), rewatches, shelves, media servers and shuffle history. Push/Pull additionally moves the on-device watchlist, history and favourites.

---

## 2. Architecture

```
Flow/
├── project.yml                 XcodeGen spec → Flow.xcodeproj (iOS, macOS, tvOS targets)
├── Packages/FlowKit/           Platform-independent core (builds + tests on Linux too)
│   ├── Models/                 MediaItem, Episode, Person, StreamSource, Shelf, settings…
│   ├── Networking/             HTTPClient (async/await), query building, errors
│   ├── Metadata/               TMDb, TVDB v4, Trakt metadata, episode-source resolver, release filter
│   ├── Tracking/               TrackingService protocol + Trakt, Simkl, MDBList, PublicMetaDB, Local
│   ├── Ratings/                MDBList ratings aggregation
│   ├── Sources/                Stremio add-on client, stream-title parser, source ranker, aggregator
│   ├── MediaServers/           Jellyfin/Emby client, Plex client, library index
│   ├── WebDAV/                 PROPFIND client + filename matcher
│   ├── LiveTV/                 M3U parser, XMLTV parser, Xtream Codes client
│   ├── Subtitles/              SRT/VTT parser, OpenSubtitles, SubDL, Wyzie, ZIP extraction
│   ├── Skip/                   Skip-segment providers (IntroDB, PublicMetaDB, Jellyfin segments)
│   ├── Sports/                 TheSportsDB teams & fixtures
│   ├── Sync/                   KeyValueStore abstraction, CloudSync engine, Setup share codec
│   └── Persistence/            JSON file store, caches
├── Flow/                       SwiftUI app shared by all three platforms
│   ├── App/                    FlowApp, AppModel (dependency container), RootView per platform
│   ├── Components/             Poster cards, shelves, hero carousel, rating badges, async images
│   ├── Features/               Home, Explore, Library, LiveTV, Search, Detail, Person, Sources, Player, Downloads, Sports, Settings/*
│   └── Resources/              Assets, Info.plist per platform, entitlements
└── .github/workflows/ci.yml    Linux tests for FlowKit + macOS xcodebuild for all three apps
```

Principles
- **FlowKit has no UI imports**, so business logic is unit-tested on every platform (and Linux CI).
- App state uses the Observation framework (`@Observable`), iOS 17 / macOS 14 / tvOS 17 minimum.
- Every external service is behind a protocol so providers can be swapped or mocked.
- Secrets (API keys, tokens) live in the Keychain on device; non-secret settings in `UserDefaults` + iCloud KVS.
- All network calls are `async`, cancellable, and fan out with task groups (source aggregation, ratings).

## 3. Delivery phases
1. Core models, networking, TMDb metadata, settings store. ✅
2. Home / Explore / Search / Detail on all platforms. ✅
3. Tracking (Trakt, Simkl, MDBList, PublicMetaDB, local) + Continue Watching / scrobbling. ✅
4. Sources: add-ons, media servers, WebDAV, IPTV VOD; ranking; player. ✅
5. Live TV with EPG. ✅
6. Subtitles, skip segments, downloads, sports. ✅
7. iCloud sync, Share / Import Setup. ✅
8. MKV playback in Apple's player: on-device remux to HLS (`FlowKit/Remux`). ✅
9. Polish: tvOS focus tuning, accessibility, localisation, App Store assets. ⏳

### MKV remux engine (`Packages/FlowKit/Sources/FlowKit/Remux`)
- **Reading**: `EBML`/`MatroskaReader` read the header, tracks, seek index (Cues) and chapters with a few range reads (`HTTPByteSource`). Results are cached by file identity (`MatroskaHeaderCache`).
- **Packaging**: `MatroskaRemuxer` plans keyframe-aligned segments, sized by bitrate. It writes fragmented MP4 (`MP4`) and WebVTT, and serves HLS (master, media and I-frame playlists) to AVPlayer through `LocalHLSServer` on 127.0.0.1.
- **Audio setup**: `AudioConfig` builds the codec boxes for AAC, AC-3, E-AC-3 (with Atmos detection), FLAC and MP3.
- **Picture subtitles**: PGS and VobSub are decoded (`PGS`, `VobSub`) and drawn by the app over the video.
- **Networking**: the next segment is prefetched; large reads go out as parallel range requests; failed reads are retried.
- **Robustness**: the parser is fuzz-tested against corrupt input.

## 4. Known assumptions
- PublicMetaDB and IntroDB endpoint shapes are implemented against a configurable base URL (`Settings → Account → API Keys`) because their public API contracts are not standardised; adjust `PublicMetaDBClient` / `IntroDBClient` if your instance differs.
- AVPlayer can't decode DTS, TrueHD, Vorbis or VP9, and won't play Opus through HLS (CI probes checked this on macOS 15 and the iOS 26 and tvOS 26 simulators). Such tracks are skipped and named. Sources whose soundtrack plays are tried first, and media servers are asked for HLS when direct play isn't possible.
- Trakt and Simkl require your own OAuth client IDs (see README).
