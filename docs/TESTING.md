# Testing Marquee

What each automated test layer proves, how to run it, and how to add to it. `docs/TEST_PLAN.md` is the other half:
the by-hand checklist for looking at the app in the simulators.

`scripts/test-all.sh` runs every layer the machine can run (`--quick` stops after the unit tests). CI runs all of
them on every push to `main` or a `claude/**` branch.

## The layers

| Layer | Proves | Where | Run it | CI job |
|---|---|---|---|---|
| FlowKit unit tests | The logic is right: parsing, ranking, sync, the remuxer, the player's decisions | `Packages/FlowKit/Tests` | `scripts/flowkit-coverage.sh` (or `cd Packages/FlowKit && swift test`) | FlowKit tests (Linux, macOS) |
| Contract vectors | The apps and the website give the same answer to the same input | `testdata/contracts`, read by `ContractTests.swift` and `web/src/contracts` | Runs with both unit suites | FlowKit tests; Web: Build and test |
| Website unit tests | The website's logic is right | `web/src/**/*.test.ts`, `web/proxy/*.test.js` | `cd web && npm run coverage` (or `npm test`) | Web: Build and test |
| Website browser tests | Every page and the main flows work in a real browser, with a keyboard, on a phone, offline, and pass an accessibility audit | `web/e2e` | `cd web && npm run build && E2E_SUITE=site npm run e2e` | Web: Browser tests (chromium, firefox, webkit) |
| Website playback matrix | Each container, picture codec and sound codec really plays through the engine the README promises, in each browser | `web/e2e/media` | See below | Web: Playback matrix (chromium, firefox, webkit) |
| App UI tests | Real taps reach real screens on iPhone and iPad; every main screen passes an accessibility audit and works at the largest text size; Apple TV always has exactly one thing focused | `UITests`, `UITestsTV` | `scripts/ui-test.sh ios` (also `ipad`, `tvos`) | UI tests (ios, ipad, tvos) |
| Player check | Both player engines play, seek, switch tracks, resume and fail properly on a real simulator and the Mac | `Flow/App/PlayerCheck.swift` | `scripts/player-check.sh ios` (also `tvos`, `macos`, `ipad`) | Player check (ios, tvos, macos) |
| Screenshot tour | Every main screen still draws; the screenshots are published for a person to look at | `Flow/App/ScreenshotTour.swift` | `scripts/sim.sh tour ios` | Screenshots |
| AltStore source | The release workflow's `source.json` update adds, replaces and trims versions, and the result has every field AltStore requires | `scripts/test_altstore_source.py` | `python3 scripts/test_altstore_source.py` | Not in CI yet |

## Rules

- **A test has to be able to fail.** Before you trust a new test, break the code it covers and watch it fail.
- **A failing test means the code is wrong until shown otherwise.** Fix the bug in the right layer. Never skip, disable
  or loosen a test to get green, and never lower a coverage floor.
- **No network, keys, wall clock or unseeded randomness.** Stub the transport, inject the clock, fix the seed. The one
  exception is the player check's scenarios that play Apple's public sample streams: they are labelled `[network]`,
  get one retry, and a retry is listed in the job summary.
- **Wait on a condition, never on a fixed sleep.** A timeout is how a wait fails, not how it passes.
- **A flake is a bug.** Find what raced.

## FlowKit

- `scripts/flowkit-coverage.sh` runs the suite with coverage, prints line coverage per folder and fails when a folder
  is under its floor in `Packages/FlowKit/coverage-floors.txt`. Raise a floor when you add tests.
- **Clients** (Trakt, Simkl, TMDB, TVDB, Jellyfin, Emby, Plex, WebDAV, Xtream, subtitle services) are tested through
  `StubTransport`: script the responses, assert the requests.
- **Fuzzing.** Every parser of outside bytes (Matroska, subtitles, M3U, XMLTV, links, settings, backups, zip and gzip,
  audio headers) is fed seeded corruptions of real fixtures (`FuzzSupport.swift`): no crash, no hang, a sensible
  result. A failure names its seed. `FLOW_FUZZ_SCALE=20 swift test --filter Fuzz` runs twenty times as many cases.
- **The remuxer's output is checked by ffmpeg**, not only by our own parser (`RemuxProbeTests.swift`): streams,
  codecs, packet counts, timestamps that only go forward, a clean decode. Without `ffprobe` on the PATH those tests
  skip; CI sets `FLOWKIT_REQUIRE_FFPROBE=1`, which turns a missing `ffprobe` into a failure.
- **The player's decisions** live in `Sources/FlowKit/Playback` as plain functions (`PlayerRouting`, `ResumeDecision`,
  `PlayerProgress`, `UpNextTiming`, `TrackSelection`, `StillWatching`) with a test row for every branch. A new rule
  about what the player should do goes there, with its rows, and `PlaybackSession` only calls it.

## Contract vectors

`testdata/contracts/<area>.json` holds cases of `{ name, input, expected }`, written from the intended behaviour, and
`manifest.json` says which side reads which file. Both readers fail when a file is not listed or not read.

When you change a rule that exists on both sides (links, sync, accounts, source parsing and ranking, languages and
track choice, calendar files), change the vectors first, then both implementations. If the two sides should differ on
purpose, leave the case out rather than writing two expectations, and say why where the rule is implemented.

## Website browser tests

- Playwright, against the production build with sample data. Nothing leaves the machine: artwork and streams have
  local stand-ins, and a request to an outside host with no stand-in fails the test.
- Every test also fails on a console error, a page error, an unhandled rejection or a failed request to the site.
- `E2E_BROWSERS=chromium,firefox,webkit` picks browsers (CI runs all three, each as a desktop window and a phone).
- Prefer role and name selectors: they check accessibility as they go.

## Website unit coverage

`npm run coverage` runs vitest with coverage and fails when a folder of `web/src` is under its floor in
`web/coverage-floors.json`. The floors are what the suite reached, rounded down. The player, the remuxer and the
engines are low there on purpose: they are browser and worker code, and the browser tests and the playback matrix are
what exercise them. Raise a floor when you add tests; never lower one.

## Website playback matrix

The playback matrix (`web/e2e/media`, CI job "Playback matrix") plays 43 generated clips, each a different container,
picture codec and sound codec, through the real player in Chromium, Firefox and WebKit. For each it checks the engine
named in Playback Info, a running clock, the picture's colour bars, a measured tone, a seek, every sound track, and
the messages the README promises for 4K, HDR, a broken or missing video encoder and disc images.

```bash
cd web && npm run build && npm run e2e-media-fixtures
E2E_SUITE=media npx playwright test --project chromium-desktop --workers 1
```

It needs ffmpeg and Playwright's Chromium, and one worker: the machine runs out of resources with more. Each
browser's expectation is computed from what that browser itself says it can decode or encode, so a browser that
lacks a decoder is expected to convert, and one that can't convert is expected to show the promised message. A
failing cell prints what the page, the engine's worker and a real encode-and-append probe say.

Known gaps, written into the specs as open findings rather than skipped silently: in Playwright's WebKit a second
sound track and DTS or TrueHD in Matroska play silent, so those steps don't assert the tone there; Firefox on the CI
runner has no audio device, so its cells assert that sound is present and the clock runs, not the tone.

## Player check

- Scenarios print `PASS`/`FAIL` lines; the script exits 1 on a FAIL, 2 when the app dies, 3 on a hang.
  `shots/player-check/<platform>/` holds `check.log`, `summary.md` and screenshots; CI uploads them as an artifact.
- `FLOW_CHECK_ONLY=audio,resume scripts/player-check.sh ios` runs chosen scenarios.
- When a start fails, the log gets `DIAG` lines: what Apple's player was doing, its error log, and the last requests
  the local server answered.
- A new player feature gets a scenario here, on both engines where it applies.

## App UI tests

- XCUITest on sample data (`-FlowDemo YES`), started fresh per test class. `UITests/Support/FlowUITestCase.swift` has
  the shared steps: launching, tabs, deep links, opening Dune's page, choosing a source, pausing, reading the
  player's clock from the scrubber's spoken value.
- Debug builds take `-FlowKeepPlayerControls YES`, which the tests pass: the player's controls stay up, so a press never
  races their four-second hide timer.
- Tests that need the player to stay mid-film use the first sample source, one of Apple's public streams that runs for
  minutes (it needs the network, as the sample artwork does). The bundled clips are 6 to 12 seconds long and would end
  while a test works.
- Accessibility audits (`AccessibilityAuditUITests`) run on each main screen. Exclusions are one audit type on one kind
  of element, each with its reason in `AuditingUITestCase.deliberateChoice`; clipped text is not audited, because single
  line labels are a design choice. A timed-out audit runs once more. The audit reads a bordered button's ink border as
  its background, so a contrast finding on a button is measured from its own pixels inside the border and stands unless
  those reach 4.5:1; a button the floating tab bar covers is judged once scrolled into view, not through the bar. A
  contrast finding prints the element's picture to the log as base64 PNG.
- Apple TV (`UITestsTV`) drives the remote and checks that exactly one element has focus after every press and that
  Menu returns where it came from.
- A failing test prints the screen (`app.debugDescription`) at its first failure, so the CI log shows what was there.
- New stable hooks are accessibility identifiers (`settings-row-<page>`, `source-<id>`, `player-scrubber`,
  `search-field`, `onboarding-key`), never visible changes.
- `xcodegen generate` picks up the UI test targets from `project.yml`; regenerate and commit `Flow.xcodeproj` on a Mac.

