# Flow — guide for Claude Code

Flow is a SwiftUI media app for iPhone, iPad, Mac and Apple TV. It's an Apple-quality front end
for the viewer's own sources: Jellyfin, Emby and Plex servers, WebDAV, IPTV (M3U, Xtream) and
Stremio-style stream add-ons. Metadata comes from TMDb and TVDB, tracking from Trakt, Simkl or
the device. It hosts no content. README.md lists every feature.

The job on this Mac: **build it, run it in the simulators, look at it, and make it better.** You can
see the app here, unlike on CI. Use that: check every change on screen before calling it done.
`docs/TEST_PLAN.md` is the full test-and-improve playbook. Start there for any "test" or
"improve" request.

## Layout

```
Flow/                 the app (one SwiftUI code base, #if os(...) where platforms differ)
  App/                AppModel (+Library, +Playback, +Shelves), RootView/TabShell/MacShell, routing (Route),
                      deep links, intents, ScreenshotTour, CalendarExport
  Features/           one folder per area: Home, Detail, Sources, Player, Explore, Search, Library,
                      Calendar, LiveTV, Sports, Person, Downloads, Settings, Onboarding
  Components/         shared views: Shelves (hero, rows, SectionHeader), Cards, FolderShelves, Images
  Design/             Theme.swift (tokens: Space, Radius, Palette, Typeface, Motion; flowGlass), ImagePipeline
  Platform/           Platform.swift (sizes, sheet helpers like sheetDismissButton/sheetSaveButton)
  Resources/          Info/entitlements plists (generated from project.yml), assets, FlowSample.mkv
Packages/FlowKit/     everything testable without UI: models, TMDb/Trakt/Simkl/servers clients, source
                      parsing and ranking, MKV demuxer + fMP4/HLS remuxer, Dolby Vision RPU rewriting,
                      subtitles, X-Ray matching, sync, stats. Pure Swift, also builds on Linux.
Packages/FlowDecoders FFmpeg DTS/TrueHD decoders (built by scripts/build-ffmpeg-decoders.sh)
Widgets/, TopShelf/   widget and Apple TV Top Shelf extensions
project.yml           XcodeGen spec. Flow.xcodeproj is generated from it and committed.
scripts/sim.sh        simulator helper (below); scripts/screenshot-tour.sh is CI's screenshot tour
```

Key types: `AppModel` (observable app state, services, navigation `paths[tab]`), `PlaybackSession`
(one playing title: AVPlayer, remux, tracks, subtitles, skip segments, Up Next, X-Ray/Shazam hooks),
`PlayerView` (+ `IOSPlayerControls`, `TVPlayerController` in PlayerSurface.swift, `MacPlayerMenu`),
`SourcePickerView`, `DetailView`, `HeroCarousel`/`ShelfView` in Components/Shelves.swift.

## Commands

```bash
scripts/sim.sh run ios            # build + install + launch on an iPhone simulator, with sample data
scripts/sim.sh run ipad|tvos      # same for iPad / Apple TV;  --real uses real data and your keys
scripts/sim.sh mac                # build + run the Mac app
scripts/sim.sh shot home ios      # screenshot → shots/local/ios/home.png (then Read it to look at it)
scripts/sim.sh open "flow://title/movie/693134" ios   # deep link (Dune: Part Two in the sample data)
scripts/sim.sh logs ios           # app log;  reset = uninstall for a fresh first launch
scripts/sim.sh tour ios|ipad|tvos|macos   # the whole screenshot tour, as CI runs it → shots/tour/
cd Packages/FlowKit && swift test # unit tests (fast; run after any FlowKit change)
xcodegen generate                 # after adding/removing files or editing project.yml (sim.sh does it when needed)
```

Build all three schemes before pushing: a change that compiles for iOS often breaks tvOS or macOS
(an API that's unavailable there, or a missing `#if`):

```bash
for s in Flow-iOS Flow-tvOS; do xcodebuild build -project Flow.xcodeproj -scheme $s -destination "generic/platform=${s#Flow-} Simulator" CODE_SIGNING_ALLOWED=NO -quiet; done
xcodebuild build -project Flow.xcodeproj -scheme Flow-macOS -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO -quiet
```

Deployment targets are iOS 17, macOS 14 and tvOS 17. Guard newer APIs with `#available` (see
`flowGlass`, which uses Liquid Glass on 26 and a material elsewhere). CI builds with Xcode 16.4
and 26.3, so code must compile on both: wrap iOS 26-only symbols in `#if compiler(>=6.2)`.

## Seeing the app

- **Sample data (`-FlowDemo YES`, the default in sim.sh):** every screen fills with real TMDb
  artwork, a demo IPTV provider, Apple's sample streams and a bundled MKV. No keys are needed and
  results are deterministic, so use it for UI work and before/after screenshots.
- **Real data (`--real`):** onboarding asks for a TMDb key. Keys can also be baked into
  `Config/Secrets.xcconfig`, which is git-ignored (copy Secrets.example.xcconfig). Use it for anything
  touching real sources, tracking, subtitles search, Shazam and X-Ray's dialogue matching.
- **Screenshot tour:** a scripted walk through ~25 screens: home, detail, sources, player and its
  panels, X-Ray, suggestions, person, explore, library, calendar, search, live TV and settings.
  - To capture a new screen deterministically, add a `Step` in `Flow/App/ScreenshotTour.swift`.
    That's often easier than tapping.
  - Steps can set `model.paths`, `selectedTab`, `activePlayback?.tourPanel`, and the like.
  - The tour writes each step to `$FLOW_TOUR_FILE`, which the script waits on.
- **Interacting:** `simctl` can't tap. Use any of:
  - **XcodeBuildMCP** (`claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest`): build, run, screenshot, tap,
    swipe, type and read the accessibility tree.
  - The **AXe** CLI (`brew install cameroncooke/axe/axe`, then `axe describe-ui`, `axe tap`, `axe swipe`; check
    `axe --help` for current flags).
  - Computer use on the Simulator window.
  - Deep links and tour steps, which are often enough.
- **Apple TV:** in the Simulator, arrow keys move focus, Return selects and Esc is Menu/Back.
  Check focus visibility on every tvOS change: something must always look focused.
- **Looking:** after a screenshot, Read the PNG and judge it like a picky Apple designer would:
  alignment, spacing rhythm, truncation, contrast on bright artwork, safe areas, the Dynamic
  Island in landscape, and focus states on tvOS.

## How to change things here

- **Match the surrounding code:** naming, comment density and the comment voice. Comments explain
  *why* in plain sentences; don't narrate the code.
- **Design system:** use Theme tokens (`Theme.Space`, `Theme.Radius`, `Theme.Palette`,
  `Theme.Typeface`, `Theme.Motion`, `flowGlass`, `GlassButtonStyle`, `PrimaryButtonStyle`,
  `CardButtonStyle`, `FocusLift`). Don't hard-code new colours or fonts unless the design calls for it.
  `Theme.scale` (1.9 on tvOS) sizes things for ten-foot viewing.
- **Platform sheet conventions:** tvOS has no visible Cancel/Done (Back dismisses), so use
  `sheetDismissButton`, `sheetDoneButton` and `sheetSaveButton`, which put Save under the form on tvOS.
- **Logic goes in FlowKit with a unit test** whenever it can: parsing, ranking, matching, dates,
  sync merges. The app layer can't be unit-tested on Linux CI, so keep it thin.
- **Settings** are `Codable` structs in FlowKit `Models/Settings.swift`. A new field needs a default
  so old saved settings still decode, because `SettingsCodec` fills missing keys from defaults. Then
  add it to the settings UI and to Settings search keywords (`SettingsPage.keywords`).
- **New source files** need `xcodegen generate`, and the regenerated `Flow.xcodeproj` gets
  committed with them. Info.plist and entitlements keys go in `project.yml`, never only in the plists.
- **Before you call something done:**
  - `swift test` passes.
  - All three schemes build.
  - You've seen the change on screen in the simulator on every platform it touches.
  - If it's a UI change, you have before/after screenshots.

## Rules

- **Never commit secrets:** API keys, tokens, passwords, server addresses or debrid links. The repo
  is public. Keys belong in `Config/Secrets.xcconfig` (git-ignored) or in the app's Settings.
  Screenshots taken with `--real` can show personal servers and history: keep them out of git
  (`shots/` is ignored).
- Don't weaken features to make a build pass. Find the right `#if` or `#available`.
- Don't disable or skip tests to get green.
- **Commit messages** describe what changed for the person using the app, in plain sentences.
  Look at `git log` for the house style.
- **Pushing** to `main` or a `claude/**` branch runs CI. CI builds all schemes, runs FlowKit tests on
  macOS and Linux, and runs the screenshot tour on every platform. It publishes the screenshots to
  the `ci-screenshots` branch.
