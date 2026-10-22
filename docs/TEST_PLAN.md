# Flow test and improvement playbook

For Claude Code (or anyone) on a Mac with Xcode. Read `CLAUDE.md` first for commands and rules.
This is the list of what to check, screen by screen and platform by platform, plus what has never
been seen on a real device. Then comes how to turn findings into improvements.

## The loop

Work one area at a time:

1. **Build and launch.** `scripts/sim.sh run ios` (then `ipad`, `tvos`, `mac`). Use sample data
   unless the area needs real sources.
2. **Walk it.** Go through the checks below for that area. Screenshot each state
   (`scripts/sim.sh shot <platform> <area>-<state>`) and Read the image. Watch `scripts/sim.sh logs`
   for errors.
3. **Write down findings** before fixing anything. For each one, record:
   - what happens and what should happen
   - the platform
   - the steps to reproduce
   - its severity:
     - **crash / data loss** (fix first)
     - **broken** (something doesn't work)
     - **wrong** (it works, but confusingly)
     - **polish** (spacing, wording, motion)
4. **Fix** in small commits. Logic fixes go in FlowKit with a test.
5. **Check the fix** on screen on every platform the change touches, with a before/after screenshot
   pair. Run `swift test` and build all three schemes.
6. When an area is clean, **look for improvements**: what would make it feel like Apple shipped it?
   Fewer taps, clearer words, better defaults, smoother motion, nicer empty and error states.

Report at the end of a session:
- What you tested, on which platforms.
- What you found and what you fixed, with screenshots.
- What's still open, and why.

## Data modes and accounts

| Mode | How | Good for |
|---|---|---|
| Sample data | default (`-FlowDemo YES`) | All UI, layout, navigation, the player with Apple's streams and the bundled MKV, demo IPTV |
| Real data | `--real`, TMDb key at onboarding or in `Config/Secrets.xcconfig` | Real catalogue, search, people, ratings, subtitles search, Shazam, X-Ray "In This Scene" |
| Real sources | Settings → Media Servers / Sources / Live TV | Source picker ranking, MKV remux of real files, Dolby Vision, DTS/TrueHD, server progress |
| Tracking | Settings → Account (Trakt/Simkl need your own OAuth client in Secrets.xcconfig) | Scrobbling, watchlist sync, ratings, Up Next |

Account caveats:
- iCloud needs a paid team: the KV-store entitlement.
- ShazamKit has to be enabled as an App Service on the app identifier in the developer portal.
- Widgets and Top Shelf need App Groups.

The simulator has no microphone input by default, and Apple TV has no microphone at all.

## Areas

Platforms: **i** iPhone, **P** iPad, **M** Mac, **T** Apple TV. Unmarked means all.

### Onboarding

- Welcome over the poster wall. The TMDb key field validates and shows a clear error for a bad key.
- **Explore with Sample Data** works, and so does "I have a setup from another device" (Import Setup).
- Leaving the demo from Settings returns to onboarding cleanly.
- Fresh install (`sim.sh reset`), then launch: nothing from the previous install leaks through.

### Home

The Film Stock design (October 2026): `web/DESIGN.md` records its rules, and the same palette and
pieces are in Theme.swift natively.

- **Title by hour:** "This Morning" 5–12, "This Afternoon" 12–17, "Tonight" 17–5, with the date below.
- **Lead:** the latest resume (else the top pick) as one large framed still. Its edge strip's
  perforations show progress, and its print says "S3 E7 · 18M LEFT · ENDS 9:30 PM"; time left is
  yellow. Yellow Resume (or Play) and a quiet Details sit below, in the same type size.
  T: Resume is focused on arrival and the lead fits the first screen.
- **Up Next:** framed stills with the same strips. On a wide window (P, M from 760 pt, T always)
  they sit beside the lead, in one or two columns; otherwise they form a row below it.
  - Progress agrees everywhere. After playing, Home, Library and the title page show the same time
    left, and the perforations match it (the tour's `home-after-playback` step shows this).
  - iOS 27: swipe for Watched and Remove; Remove asks first. The long-press menu still offers Go to
    Details, Mark as Watched and Remove.
  - "Skip Details on Continue Watching" plays directly.
- **Other shelves:** posters at one fixed size; Upcoming, Streaming Services and Genres folders, Because
  You Watched, media server rows, custom Discover shelves. Shelves load lazily, show placeholders and
  never jump.
- **Mac:** hovering a row shows paging arrows.
- **Apple TV:** Settings is the last tab. Something is always visibly focused.
- **Pull to refresh** (i, P). iOS 27: the navigation bar shrinks on scroll; Settings stays pinned.
- **Yellow is earned:** only the next action, focus, the current selection, watched perforations and
  time left. Toolbar icons are paper.

### Detail page

- **Header:**
  - Logo or title, metadata line, the ratings row (wraps to two centred lines on iPhone with many
    sources), Play or Resume naming the right episode.
  - "Your Rating" stars appear on watched titles. Tapping a star sets it; tapping the same star clears it.
- **Actions:** labelled Watched, Watchlist, Favourite, Download (i, P, M) and Share (i, P, M).
  - Shows on iPhone put Shuffle, Rewatch and Share under More.
  - Focused buttons turn white on T.
  - Share opens the share sheet with the TMDb link.
- **Collapsing title (i, P):** scroll until the logo goes under the navigation bar. The bar should
  fill in with the title, and clear again when scrolling back. *Never seen on a device.*
- **"S2E5 airs …" line:** offers Add to Calendar (i, P, M).
  - The first use asks for calendar access.
  - It creates an all-day event when there's no air time.
  - Denying access shows a clear toast.
- **Seasons and episodes:**
  - Watch Season. Watched checks.
  - Specials season, following the setting.
  - Episode spoiler blur, following the setting.
  - "Mark Watched Up to Here."
  - Episodes that fail to load show Try Again.
- **Other sections:** Where to Watch, About, Reviews (spoiler tags), Cast & Crew → Person,
  trailers, collection, recommendations. The Request button appears when Seerr is set up.
- **Transitions:** posters zoom into the detail page and back (i, P, iOS 18+).

### Source picker

Redesigned in October 2026 as a plain table: no Best Match card, no sparkles or gold, no boxed rows.

- **Order:** sources stay in the order the add-on or server gives them (AIOStreams' own sort).
  Custom ordering only applies when Settings → Sources → Use Custom Source Ordering is on.
- **Play button** at the top when there are 2+ sources, with one caption saying what it starts:
  "4K · Dolby Vision · Atmos · 18.20 GB · AIOStreams". It starts the source the title was **last
  played** from when that's still offered ("Last played · …"), else the first playable one.
  Remember Last Source (Settings → Sources) turns that off. Auto-Play starts the same source.
- **Rows:** one grouped surface per provider, under "AIOStreams 5", with hairlines between rows.
  - The resolution sits in a left-aligned column on the release type's baseline; the size is
    right-aligned in tabular digits.
  - Dolby Vision, HDR and premium audio are small outlined badges; codecs and channels are plain words.
  - Under them, languages and release group, then only the exceptions: "Last played", "Not cached",
    "Needs a debrid-enabled add-on". "Cached" is the norm and isn't shown.
  - Pressing highlights the row like a table cell (i, P). The Mac highlights on hover. On T each row
    is its own surface and turns white with dark text when focused.
  - Filenames only appear when Settings → Source Appearance asks for them; otherwise "Copy File Name" is in the menu.
- **States:** placeholder rows while searching, "Searching AIOStreams…" under the title, No Sources,
  and a line per failed or timed-out provider under the list.
- **Largest text sizes:** the resolution column folds into the title ("1080p · WEB-DL · 3.98 GB").
- **Settings respected:** Source Appearance (title, badges pack, size, compact, add-on formatting),
  filters, result cap, resolution cap (and on cellular), HDR preference, audio-language sort, Play
  From This Library Only, prefetch on detail.
- **Close and refresh** are glass circles (i, P, M). Back dismisses on T.

### Player: iPhone and iPad

- **Controls:**
  - Tap shows and hides them; they auto-hide after 4 s.
  - Double-tap a side to skip, with a flash and a light haptic.
  - Pinch to fill. The scrubber shows a thumbnail preview for MKVs.
- **Hold the picture:** plays at 2× with a "2×" pill and a haptic. Lifting returns to the chosen speed.
- **What Did They Say?** (hold the back button, or the options panel):
  - It goes back 10 s and shows subtitles until the moment it was asked, then hides them.
  - It must not skip back twice when the finger lifts.
  - It must not be remembered as a subtitle choice.
- **Options panel:** Audio, Subtitles, Source (switching mid-film keeps the position), Speed,
  Sleep Timer, Chapters, Zoom, What Did They Say?, Identify Song, Advanced Options.
  - In landscape on iPhone the list scrolls. Check that Advanced Options is reachable.
- **Advanced Options:** subtitle delay, size, font, colour, edge, background and position (with a
  live preview), Auto-sync (beta), Volume Boost (Dolby MKVs only).
- **Info card:** the stats card. In iPhone landscape the transport buttons move right while it's open.
- **X-Ray:**
  - It opens on pause (Settings → Playback → Show X-Ray When Paused) and closes on play.
  - The X-Ray button toggles it.
  - **Sections:**
    - **In This Scene:** needs subtitles on, or a subtitle service to fetch an SDH file. *Never seen
      with real data.*
    - **Cast,** including episode guest stars.
    - **Crew, Scenes** (tapping one seeks) and **Music.**
  - Tapping a person opens a sheet with bio, age and Also In, and pauses the film.
- **Shazam (Identify Song):**
  - Real MKV: reads the soundtrack (works with headphones).
  - Plain MP4: read directly.
  - HLS: asks for the microphone, then listens.
  - The card shows the artwork, Apple Music and My Shazam. The song then appears in X-Ray → Music,
    and tapping it seeks to where it played.
  - *Matching has never been run on a device.* Check that the errors read clearly when ShazamKit
    isn't enabled for the app ID, and when there's no network.
- **Up Next:**
  - The card and countdown ring, or waiting for the end.
  - Skip intro, recap and credits (button or automatic).
  - Scenes during or after the credits get a heads-up.
  - Because You Watched appears when a film ends, with **How was it?** stars.
- **Are You Still Watching?** After N unattended episodes (Settings → Playback, default 3), the
  next one waits for Continue Watching or Stop. Any tap, skip, seek or pause resets the count.
  *Never seen.* To test it, set the count to 2, use short sample episodes, and don't touch anything.
- **Sleep timer:** minutes and end of episode. The last 30 s fade the sound, then it pauses and the volume comes back.
- **System:**
  - Picture in Picture (and automatic PiP on leaving the app). AirPlay.
  - Lock screen and Control Centre Now Playing.
  - Resume prompt when Ask Before Resuming is on.
  - Rotation lock setting.
- **Failures:**
  - The connecting screen with progress.
  - The error screen with Try Again, Try Another Source and Open in external player.
  - Automatic next source when a stream won't start.
  - Reconnect after a dropped stream, which must keep the audio and subtitle picks.
- **Formats** (with real files):
  - MKV remux: H.264, HEVC, AV1 on supported hardware.
  - Dolby Vision 5 and 8. Profile 7 converted to 8.1.
  - DTS and TrueHD decoded to FLAC.
  - PGS subtitles drawn by Flow. ASS styling.

### Player: Apple TV

- The system player with Flow's subtitle layer, and info panel tabs **X-Ray** (faces in a row,
  In This Scene first) and **Details**. *The X-Ray tab has never been seen.*
- **Transport bar menu:** Disc Subtitles, Search Subtitles, What Did They Say?, Identify Song,
  Auto-sync. Skip segments, More Like This and Up Next appear as contextual buttons (tvOS cuts
  their titles off at about fourteen characters).
- **Still watching:** shows as a dimmed prompt beneath the transport bar, with a "Keep Watching"
  contextual button. Menu stops. Subtitles hide while it's up.
- **Shazam:** the card appears top right without stealing focus.
- **Live TV:**
  - The transport bar has Previous Channel, Next Channel and a Channels list.
  - The info panel shows the channel and what's on.

### Player: Mac

- Glass buttons at the top right: options (…), chapters, disc subtitles, X-Ray, info, subtitle search, close.
- **The options menu:** source, episodes, speed, sleep timer, subtitle timing, Volume Boost, What
  Did They Say? (⌘R), Identify Song (⇧⌘I).
- **Keyboard:** Space plays and pauses. ←/→ skip. F is full screen. S skips a segment. Esc closes.
- The window resizes down to 640×360 without overlapping controls. The X-Ray panel and song card fit.

### Explore, Search, Person

- **Explore:**
  - Movies/TV switch and genre chips.
  - Filters (year, window, rating, language, provider), then Reset.
  - Infinite scroll with no duplicates.
  - Changing filters mid-load shows the new filters' results.
- **Search:**
  - Debounced as you type, with a top result card and sections.
  - Media server results.
  - Recents keep one entry per search (not every prefix) and can be removed from the context menu.
  - Typing one character shows the idle content.
  - The empty state reads well.
- **Person:** the photo or a coloured monogram, born (with age), the bio, Known For, and Filmography filters.

### Library, Stats, Calendar, Downloads

- **Library tiles:** a two-column grid on iPhone (nothing truncated). Downloads, Upcoming,
  Sports, History and Stats.
- **Stats:**
  - The periods: This Year, Last 30 Days and All Time.
  - The hero time, the films / episodes / shows counts and the chart.
  - Top genres, most watched, longest streak and busiest day.
  - Empty states.
  - With Trakt on, history up to 2,000 entries: check how long it takes and whether Trakt honours the limit.
  - *Never seen with real history.*
- **Upcoming:**
  - The day strip with dots, which scrolls to its day.
  - Just Aired, then days.
  - Add to Calendar in the long-press menu (i, P, M).
  - Check a DST boundary: change the simulator's time zone and date.
- **Downloads (i, P, M):**
  - Picking a source within the limits. Automatic choice.
  - Progress, pausing, resuming and deleting.
  - A failed download shows its error and is not "done".
  - Playing offline (airplane mode).
- **Smart Downloads** (Settings → Data & Storage): Delete Watched Episodes and Download Next
  Episode. *Never seen.* Make sure deleting the file of the episode that just finished doesn't
  disturb playback of the next one.

### Live TV and Sports

- **List:**
  - Groups and favourites; the group chips fall back to All when the last favourite is removed.
  - Search.
  - Coloured monograms.
  - Progress bars tick every 30 s.
- **Guide:**
  - The timeline starts beside the channel column with no gap, especially on T.
  - The now line.
  - Tap an upcoming programme for its details sheet.
  - Long-press a live one for Watch Now or Details.
  - Rows load lazily with thousands of channels. Try a big M3U.
- **Player:**
  - Turns to landscape on iPhone like films do (Auto Rotate), and back to portrait on Close.
  - Close sits under the system player's AirPlay button; the now-and-next card sits above the
    scrubber and left of the play buttons.
  - Swipe up and down (i, P) or ↑/↓ (M) to change channel.
  - The now-and-next card.
  - The error screen offers Next Channel.
- **Sports:** follow teams, fixtures, channels showing a game, score-spoiler hiding.

### Settings and sync

Open every page and check each control does what its footer says. Check the Settings search finds
recent options (Volume Boost, Dolby Vision, X-Ray, Still Watching, Smart Downloads).

- **Apple TV:** Save sits under the form and focus reaches it. There are no invisible Cancel or Done items.
- **iCloud** (two simulators signed into the same Apple ID, or a simulator and a device):
  - A change on one device appears on the other.
  - Items removed from the watchlist, favourites or history stay removed.
  - Ratings sync.
  - A settings change isn't reverted by an older copy.
- **Share / Import Setup:**
  - Round trip by link and QR.
  - Passwords and keys on the receiving device are kept.
- **Export Tracking Data** produces sensible JSON.

### System integration

- The widget (i, P) and Top Shelf (T) show Continue Watching.
- Spotlight finds titles. Handoff works.
- `flow://` links: `title/movie/<id>`, `play/movie/<id>`, `continue`, `upcoming`, `search?q=`, `setup?d=`.
- Shortcuts and Siri actions.
- Notifications for new episodes and matches. Check the permission flow.

## Across every screen

- **Accessibility:**
  - VoiceOver labels on every control. The icon-only player buttons especially.
  - The order makes sense.
  - Dynamic Type at the largest sizes: no clipping, and tiles stack.
  - Reduce Motion. Increase Contrast.
  - Touch targets ≥ 44 pt.
  - On tvOS, focus is always visible.
- **Layout:**
  - iPhone SE size to Pro Max; portrait and landscape (Dynamic Island on the leading edge in landscape).
  - iPad split view and Stage Manager sizes.
  - Mac windows small to full screen.
  - Apple TV at 1080p and 4K.
- **Performance:**
  - Scroll Home, Explore and the Guide fast in Instruments (Time Profiler, Hangs, Animation Hitches).
  - Memory while paging the hero and long grids (ImagePipeline caching).
  - First launch time.
  - Remux start time for a large MKV.
- **Offline and slow networks:** `scripts/sim.sh run ios --real -- -FlowOffline YES` makes every
  request fail as if there were no connection (debug builds). On a device, Settings → Developer →
  Network Link Conditioner. Cached pages should still render, and errors should read clearly.
- **Words:**
  - Every message in plain sentences, with no jargon.
  - Errors say what to do next.
  - Consistent capitalisation: titles in Title Case, footers in sentence case.

## Not yet seen on a device (start here)

Built with care and checked by code review and CI screenshots. Status after the October 2026
simulator sessions (see "Session handover" below):

1. Shazam matching: the MKV soundtrack path, the direct-file path and the microphone path, plus
   the error wording. *Open: needs ShazamKit enabled on the App ID.*
2. X-Ray In This Scene with real subtitles, the person sheet, and the Apple TV X-Ray tab. *Open.*
3. Are You Still Watching?, the sleep-timer fade, What Did They Say? and hold-for-2×.
   *Seen and fixed except the sleep-timer fade, which hasn't been watched to the end.*
4. The collapsing navigation title on the detail page. *Seen and fixed.*
5. Ratings reaching Trakt and Simkl. Ratings syncing over iCloud. *Open: Config/Secrets.xcconfig
   still has placeholder Trakt and Simkl keys.*
6. Add to Calendar, both the permission flow and the events created. *Seen: allow, deny and the
   event itself all correct.*
7. Smart Downloads, especially the deletion timing during auto-advance. *Fixed in code (deletion
   waits until the player lets go of the file); not yet seen running.*
8. The Stats page with real Trakt history. *Open: needs Trakt keys.*
9. The Apple TV Settings tab, and "Open Settings" buttons landing on it. *Seen; the blank tab in
   the tour was the tour's own fault and is fixed.*
10. Share on a `ShareLink` styled as a detail action, especially on Mac. *Seen on iPhone (now with
    the poster in the sheet); Mac only in CI screenshots.*

## Ideas worth building next

Bigger:
- **Watch Together:** SharePlay with `AVPlayerPlaybackCoordinator`. Each person plays from their
  own sources, and play, pause and seek stay in sync.
- **X-Ray trivia and music credits** from a source that allows it.
- **"Previously on…":** a recap of where you left off, for shows not watched in a while.

Smaller:
- Per-show playback speed memory.
- A queue ("Play Next").
- Picture-in-picture for Live TV.
- A Stats share card.
- Calendar events that update when air dates change.

Judge any idea by whether it makes Flow simpler to use, not just bigger.

## Session handover

What the October 2026 sessions learned about working here, so the next one can start straight away.
Commits on `claude/build-flow-app` describe each fix; `git log` is the full record.

**Driving the simulators**
- `scripts/sim.sh shot <platform> <name>`: the platform comes first.
- Taps: the built-in iOS Simulator control tool is the most reliable. Its coordinates are portrait
  points even when the player has turned the screen to landscape. Attach it to the right device first.
- AXe: `axe describe-ui --udid <udid>` reads the accessibility tree and is the way to check
  VoiceOver labels. It can time out just after a simulator boots; try again a minute later.
- Apple TV: use the tvOS 26.5 Apple TV 4K simulator, as the tour does. On the tvOS 27 simulator Flow
  launches in the background, and `sim.sh` picks the newest runtime, so run it as
  `SIM_UDID=<the 26.5 Apple TV's udid> scripts/sim.sh run tvos` (`xcrun simctl list devices` shows it). The Simulator app can't be scripted here, so there are no remote presses:
  reach Apple TV screens through deep links and ScreenshotTour steps.
- Mac: `screencapture` fails from Claude's shell even with Screen Recording allowed, so the local Mac
  tour captures nothing. Use CI's Mac screenshots (`git show origin/ci-screenshots:macos/<file>`).
- The player hides its controls after 4 s, which is faster than a tool round trip. To test a gesture on
  them, temporarily lengthen `scheduleHide()` in PlayerView.swift, and don't commit it.
- Offline: `scripts/sim.sh run ios --real -- -FlowOffline YES` (debug builds) fails every request as
  if there were no connection.
- Sample data doesn't save settings, so anything remembered (last source, recents) lasts one launch.

**Releases**
- Pushing a tag like `v1.0.0` or `v1.0.0-beta.1` runs `.github/workflows/release.yml`, which builds
  unsigned `Flow-iOS.ipa`, `Flow-tvOS.ipa` and `Flow-macOS.zip` on GitHub (so no local API keys get
  baked in) and attaches them to a GitHub release. A tag with a hyphen is marked as a pre-release.
  Never build release IPAs locally: they'd carry the keys in Config/Secrets.xcconfig.

**Keys**
- Config/Secrets.xcconfig has real TMDB and TVDB keys. Its Trakt, Simkl and bundle-id lines are still
  the example placeholders, which Flow now treats as no key. Trakt and Simkl testing waits on real keys.
- The local bundle id is `com.yourname.flow`; the tour script reads whichever was built.

**Added in these sessions** (all with FlowKit tests where there's logic)
- `FlowLink` parses every `flow://` link (tv works like show; unknown links are ignored).
- `LastSource` remembers the source a title was played from (description only, never the link; left
  out of shared setups).
- `StillWatching` counts unattended episodes; a pause in an episode's last seconds doesn't reset it.
- `AirDateFormatting` keeps a bare TMDB air date on its own day in every time zone.
- `ReviewText` cleans TMDB and Trakt reviews (entities, tags, Markdown).
- `RecentSearches`, `ConfiguredKey`, `RatingSource.spokenScore`, and `FlowError.from(URLError)` for
  plain connection errors.
- `Theme.Palette.overPicture` tints glass that floats over video without a scrim.
- A `player-still-watching` tour step on every platform.
- The Film Stock redesign: `Reel` (edge-print time: `compactLeft`, `compactDuration`, `watchedFraction`),
  `WatchlistOrder` (a drag-arranged watchlist kept on the device over the tracker's order), and the
  `home-after-playback` tour step. iOS 27 APIs sit behind `#if compiler(>=6.4)` and
  `#available(iOS 27, macOS 27, tvOS 27, *)`. CI's Xcode 27 legs are experimental: they report but
  don't block. The swipe, reorder and confirm-removal interactions compile but haven't been tried by hand.

**Automated player and UI checks** (run these after any player change)
- `scripts/player-check.sh ios|ipad|tvos|macos` (debug, sample data): every sample stream through
  start, time, seek, skip back, pause, 2×, every audio and subtitle track, the MKV remux, chapters and
  PGS, then switching source, Skip Intro, fallback from a broken source, the error screen's wording,
  Up Next moving on, Ask Before Resuming and the panels. 75 checks, PASS/FAIL with evidence, and a
  screenshot of each screen in `shots/player-check/<platform>/`. All four platforms passed 75/75 on
  2026-10-12. `FLOW_CHECK_ONLY=episodes,resume` runs a subset.
- `scripts/ui-test.sh` (iPhone or iPad simulator via SIM_UDID): XCUITest with real taps, for screens
  the simulator tools can't drive reliably. Covers the Live TV player: Close, channel buttons, tapping
  the picture, and landscape on iPhone. Not run by CI.
- Simulator tool taps are not trustworthy inside UIKit-presented covers or on rotated screens; if a
  tap "does nothing", confirm with a UI test before changing code.

**Design changes to keep in mind**
- iPhone has its own tab bar (`Flow/App/FlowTabBar.swift`): a dark glass capsule of icons where the
  current tab grows into a white pill with its name. The system `TabView` still holds the tabs (its
  bar is hidden on iPhone), so each tab keeps its place. Search's field sits under its title on iPhone.
  iPad keeps the system top bar; Mac and Apple TV are unchanged. Don't bring back the stock bar: the
  owner asked for Flow to look like itself rather than the app it was modelled on.
- Lists of choices are grouped tables (`Flow/Components/GroupedTable.swift`): one surface, hairlines,
  table-cell highlight, white focused rows on Apple TV. The source picker, Live TV and Sports use it.
- A title's page ends with one About table (essentials always; the rest with Settings → General → About).

**Still open**
- Trakt and Simkl sign-in, ratings sync and Stats with real history (keys).
- Shazam on a device (ShazamKit on the App ID), X-Ray In This Scene with real subtitles.
- The sleep-timer fade watched to the end; Smart Downloads seen running.
- Not yet reviewed closely: Sports, the person page in depth, performance in Instruments.

