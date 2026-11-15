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
| Website unit tests | The website's logic is right | `web/src/**/*.test.ts`, `web/proxy/*.test.js` | `cd web && npm test` | Web: Build and test |
| Website browser tests | Every page and the main flows work in a real browser, with a keyboard, on a phone, offline, and pass an accessibility audit | `web/e2e` | `cd web && npm run build && npm run e2e` | Web: Browser tests (chromium, firefox, webkit) |
| Player check | Both player engines play, seek, switch tracks, resume and fail properly on a real simulator and the Mac | `Flow/App/PlayerCheck.swift` | `scripts/player-check.sh ios` (also `tvos`, `macos`, `ipad`) | Player check (ios, tvos, macos) |
| Screenshot tour | Every main screen still draws; the screenshots are published for a person to look at | `Flow/App/ScreenshotTour.swift` | `scripts/sim.sh tour ios` | Screenshots |

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

## Player check

- Scenarios print `PASS`/`FAIL` lines; the script exits 1 on a FAIL, 2 when the app dies, 3 on a hang.
  `shots/player-check/<platform>/` holds `check.log`, `summary.md` and screenshots; CI uploads them as an artifact.
- `FLOW_CHECK_ONLY=audio,resume scripts/player-check.sh ios` runs chosen scenarios.
- When a start fails, the log gets `DIAG` lines: what Apple's player was doing, its error log, and the last requests
  the local server answered.
- A new player feature gets a scenario here, on both engines where it applies.
