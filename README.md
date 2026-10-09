# Flow

A native media hub for **iPhone, iPad, Mac and Apple TV**, built with SwiftUI.

Flow puts your movies, shows and live TV in one place. It doesn't host any content. It plays from sources you set up yourself: your Jellyfin, Emby or Plex servers, WebDAV shares, IPTV providers (M3U or Xtream Codes) and Stremio-compatible stream add-ons such as AIOStreams. Metadata comes from TMDb and TVDB. Watch history syncs with Trakt, Simkl, MDBList, PublicMetaDB or just this device, with iCloud keeping your devices in step.

See **[PLAN.md](PLAN.md)** for the full feature list and architecture.

## Highlights

- **Home**: a paged hero with logo art, Continue Watching with Up Next, and shelves you can configure (trending, popular, TMDb Discover queries, Trakt and MDBList lists, media-server libraries).
- **Explore**: Movies and TV grids with filters for genre, year, release window, rating, language and streaming service.
- **Library**: Watchlist, Watch History, Favourites, Downloads and followed Sports teams.
- **Live TV**: channel groups, favourites and an EPG with now and next from XMLTV or Xtream.
- **Search**: movies, shows and people, plus results from your media servers and recent searches.
- **Detail pages**: ratings from IMDb, Rotten Tomatoes, Popcornmeter, Metacritic, TMDb, Letterboxd and Trakt. Cast, trailers, seasons and episodes (TVDB numbering by default), Shuffle, Rewatch, and buttons for watched, favourite, watchlist and download.
- **Source picker**: gathers results from every provider in parallel. Categories and providers are ordered, there are optional sort rules, filters and a result cap, and the add-on text and badges are parsed.
- **Player**: resume, skip intro, recap and credits (from Jellyfin media segments, Plex markers, IntroDB or PublicMetaDB), next-episode countdown, scrobbling, subtitle search (OpenSubtitles, SubDL, Wyzie, SubSource), AirPlay, Picture in Picture and external players.
- **Sync**: Trakt or Simkl device sign-in, iCloud key-value sync, and Share/Import Setup by file, link or QR code.

## Project layout

```
Packages/FlowKit   Platform-independent core: models, API clients, parsers, ranking, sync (unit-tested, builds on Linux too)
Flow/              SwiftUI app shared by the iOS, macOS and tvOS targets
project.yml        XcodeGen spec for Flow.xcodeproj
Config/            Build settings and optional baked-in API keys
```

## Getting started

Requires Xcode 16 or later. The apps target iOS 17, macOS 14 and tvOS 17.

1. Open `Flow.xcodeproj`. If you change `project.yml`, regenerate it with `brew install xcodegen && xcodegen generate`.
2. Optionally copy `Config/Secrets.example.xcconfig` to `Config/Secrets.xcconfig`. Set your bundle ID, team and any default API keys there. This file is git-ignored.
3. Choose the **Flow-iOS**, **Flow-macOS** or **Flow-tvOS** scheme and run it.
4. On first launch Flow asks for a TMDb API key (free at themoviedb.org). Everything else is optional and lives in Settings.

iCloud sync uses the iCloud key-value store entitlement, which needs a paid developer team. With a free personal team, delete the `com.apple.developer.ubiquity-kvstore-identifier` entitlement and Flow keeps your data on the device.

### Optional services

| Service | What it enables | Where to set it |
|---|---|---|
| Trakt / Simkl | Tracking, watchlist, scrobbling, lists | Settings → Account (needs your own OAuth client ID) |
| TVDB | TVDB episode ordering | Settings → Metadata |
| MDBList | Ratings row, list shelves, optional tracking | Settings → Account → API Keys |
| IntroDB / PublicMetaDB | Skip segments, tracking | Settings → Account → API Keys |
| OpenSubtitles / SubDL / SubSource | Subtitle search (Wyzie needs no key) | Settings → Account → API Keys |

## Tests

```
cd Packages/FlowKit && swift test
```

CI (`.github/workflows/ci.yml`) runs the FlowKit tests on Linux and macOS and builds all three apps with `xcodebuild`.

## Notes

- AVPlayer can't play every container (MKV, for example). Media servers are asked for HLS when direct play isn't possible. For other sources, pick an MP4/HLS stream or hand off to an external player on iOS.
- The PublicMetaDB and IntroDB base URLs are configurable because deployments differ.
