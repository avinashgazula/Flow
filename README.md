# Flow

A native media hub for **iPhone, iPad, Mac and Apple TV**, built with SwiftUI.

Flow puts your movies, shows and live TV in one place. It doesn't host any content. It plays from sources you set up yourself: your Jellyfin, Emby or Plex servers, WebDAV shares, IPTV providers (M3U or Xtream Codes) and Stremio-compatible stream add-ons such as AIOStreams. Metadata comes from TMDb and TVDB. Watch history syncs with Trakt, Simkl, MDBList, PublicMetaDB or just this device, with iCloud keeping your devices in step.

See **[PLAN.md](PLAN.md)** for the full feature list and architecture.

## Highlights

- **Home**: a paged hero with logo art, Continue Watching with Up Next, "Because You Watched…" recommendations, and shelves you can configure (trending, popular, TMDb Discover queries, Trakt and MDBList lists, media-server libraries).
- **Explore**: Movies and TV grids with filters for genre, year, release window, rating, language and streaming service.
- **Library**: Watchlist, Watch History, Favourites, Downloads, followed Sports teams, and **Upcoming**, a day-by-day calendar of new episodes and releases from the shows and films you follow.
- **Live TV**: channel groups, favourites, and a timeline guide with a live "now" line, fed by XMLTV or Xtream.
- **Search**: movies, shows and people, with a top-result card, genre browsing, results from your media servers and recent searches.
- **Detail pages**: ratings from IMDb, Rotten Tomatoes, Popcornmeter, Metacritic, TMDb, Letterboxd and Trakt. Cast, trailers, seasons and episodes (TVDB numbering by default), Shuffle, Rewatch, buttons for watched, favourite, watchlist and download, and Where to Watch (streaming, rental and purchase options from JustWatch via TMDb).
- **Source picker**: gathers results from every provider in parallel. Categories and providers are ordered, there are optional sort rules, filters and a result cap, and the add-on text and badges are parsed.
- **Player**: resume, skip intro, recap and credits (from Jellyfin media segments, Plex markers, IntroDB, PublicMetaDB or MKV chapter names), a Playback Info panel, an Up Next card with a countdown ring (or one that waits for the episode to end), a heads-up when a film has a scene during or after its credits, "Because You Watched" suggestions as a film's credits roll and when it ends, double-tap to skip on iPhone, scrobbling, subtitle search (OpenSubtitles, SubDL, Wyzie, SubSource), AirPlay and Picture in Picture.
- **Player controls (iPhone and iPad)**: an options panel for audio, subtitles, source (switch mid-film without losing your place), speed, sleep timer, chapters and zoom; an episode shelf for shows; skip segments and chapters marked on the scrubber; a volume slider; and Advanced Options for subtitle delay, size, colour, background and position, plus Volume Boost, which raises quiet Dolby Digital (Plus) soundtracks in MKVs by the headroom their mix leaves.
- **External players**: Infuse, VLC, Outplayer, SenPlayer, VidHub, CineUltra and Moon Player on iPhone and iPad; Infuse, VidHub, IINA and mpv on the Mac. Flow passes the resume position where the player accepts one.
- **MKV playback**: Matroska files play in Apple's own player. Flow remuxes them on the device, without re-encoding, into HLS served from a loopback address.
  - Codecs: H.264, HEVC (HDR10, and Dolby Vision profiles 5 and 8; profile 7 plays as HDR10), AV1 (on devices with an AV1 decoder), AAC, Dolby Digital (Plus) with Atmos, FLAC and MP3, plus DTS (including DTS-HD Master Audio) and Dolby TrueHD, which Flow decodes with FFmpeg and hands over as lossless FLAC.
  - Every audio track, text subtitles and chapters come through, plus Blu-ray and DVD picture subtitles (PGS and VobSub), which Flow draws itself.
  - Scrubbing previews on Apple TV, iPhone and iPad.
  - Each file's index is cached, so reopening it is quick.
- **Sync**: Trakt or Simkl device sign-in, iCloud key-value sync, and Share/Import Setup by file, link or QR code.
- **System**: a Continue Watching widget on iPhone and iPad, an Apple TV Top Shelf (Continue Watching with progress, and your Watchlist), Spotlight indexing, Handoff, `flow://` deep links, and Shortcuts/Siri actions for Continue Watching, Upcoming and Search. The widget and Top Shelf read a snapshot shared through the `group.<bundle id>` App Group, so enable App Groups for your team when you sign the app.
- **Demo mode**: "Explore with Sample Data" fills every screen with real TMDb artwork and Apple's sample streams, no keys required.

## Project layout

```
Packages/FlowKit   Platform-independent core: models, API clients, parsers, ranking, sync (unit-tested, builds on Linux too)
Flow/              SwiftUI app shared by the iOS, macOS and tvOS targets
Widgets/           WidgetKit extension (iOS): Continue Watching
TopShelf/          Top Shelf extension (tvOS)
Shared/            The snapshot the app writes for its extensions
scripts/           Screenshot tour used by CI (demo data, every platform)
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

- Apple's player can't play Opus or Vorbis audio or VP9 video from these files. Flow skips those tracks, says so, and prefers sources whose soundtrack plays. Media servers are asked for HLS when direct play isn't possible. On iPhone, iPad and Mac, MKV files can also go to an external player (Settings → Playback).
- The PublicMetaDB and IntroDB base URLs are configurable because deployments differ.

## Third-party software

Flow decodes DTS and Dolby TrueHD with [FFmpeg](https://ffmpeg.org) 7.1.1, licensed under the
[LGPL 2.1](Packages/FlowDecoders/Sources/FlowDecoders/Resources/COPYING.LGPLv2.1). It is built from the
unmodified release with only the DTS and TrueHD/MLP decoders (no GPL or non-free parts) by
`scripts/build-ffmpeg-decoders.sh`, which CI runs on macOS to produce
`Packages/FlowDecoders/FFmpegDecoders`. Flow links it statically; because Flow's source is public, it
can be rebuilt against a modified FFmpeg. The licence also appears in the app under Settings → General →
Open Source Licences, and **Decode DTS and Dolby TrueHD** in Playback settings turns the decoding off.
