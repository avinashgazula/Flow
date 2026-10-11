# Flow test and improvement playbook

For Claude Code (or anyone) on a Mac with Xcode. Read `CLAUDE.md` first for commands and rules.
This is the list of what to check, screen by screen and platform by platform, plus what has never
been seen on a real device. Then comes how to turn findings into improvements.

## The loop

Work one area at a time:

1. **Build and launch.** `scripts/sim.sh run ios` (then `ipad`, `tvos`, `mac`). Use sample data
   unless the area needs real sources.
2. **Walk it.** Go through the checks below for that area. Screenshot each state
   (`scripts/sim.sh shot <area>-<state> <platform>`) and Read the image. Watch `scripts/sim.sh logs`
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

- **Hero:**
  - The page indicator fills while auto-advancing, restarts on swipe and pauses while swiping.
  - At most 10 titles.
  - The artwork's glow reaches under the status bar (i, P).
  - Card style vs full-bleed (Settings → General). T is always full-bleed with focusable Play, +, i.
  - Reduce Motion stops auto-advance.
- **Continue Watching:**
  - The progress bar sits on the picture; "S3 E7 · 18m left" is below it.
  - The long-press menu offers Go to Details, Mark as Watched and Remove.
  - "Skip Details on Continue Watching" plays directly.
- **Other shelves:** Upcoming, Streaming Services and Genres folders, Because You Watched, media
  server rows, custom Discover shelves. Shelves load lazily, show placeholders and never jump.
- **Mac:** hovering a row shows paging arrows.
- **Apple TV:** Settings is the last tab, and no gear floats over the hero.
- **Pull to refresh** (i, P).

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

- A **Best Match** card when there are 2+ sources, with one Play (or Download) button. On T,
  focusing it must not cover the badges or spill outside the card.
- **Rows:**
  - The quality block (4K is tinted), "WEB-DL · 3.98 GB", languages, then badges in two tiers:
    DV/HDR/Atmos/lossless coloured, the rest quiet.
  - The whole row is the button, with a chevron and no play circles.
  - Filenames only appear when Settings → Source Appearance asks for them; otherwise "Copy File Name" is in the menu.
- **Grouping:** provider grouping, category headings, More Sources.
- **States:** loading shimmer, No Sources, and providers that fail or time out.
- **Settings respected:** sort rules, filters, result cap, resolution cap (and on cellular), HDR
  preference, audio-language sort, Play From This Library Only, prefetch on detail.
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
  Auto-sync. Skip segments, Because You Watched and Next Episode appear as contextual buttons.
- **Still watching:** shows as a dimmed prompt with a "Continue Watching" contextual button. Menu stops.
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
- **Offline and slow networks:** Settings → Developer → Network Link Conditioner on a device, or
  turn the Mac's network off. Cached pages should still render, and errors should read clearly.
- **Words:**
  - Every message in plain sentences, with no jargon.
  - Errors say what to do next.
  - Consistent capitalisation: titles in Title Case, footers in sentence case.

## Not yet seen on a device (start here)

Built with care and checked by code review and CI screenshots, but never exercised for real:

1. Shazam matching: the MKV soundtrack path, the direct-file path and the microphone path, plus
   the error wording.
2. X-Ray In This Scene with real subtitles, the person sheet, and the Apple TV X-Ray tab.
3. Are You Still Watching?, the sleep-timer fade, What Did They Say? and hold-for-2×.
4. The collapsing navigation title on the detail page.
5. Ratings reaching Trakt and Simkl. Ratings syncing over iCloud.
6. Add to Calendar, both the permission flow and the events created.
7. Smart Downloads, especially the deletion timing during auto-advance.
8. The Stats page with real Trakt history.
9. The Apple TV Settings tab, and "Open Settings" buttons landing on it.
10. Share on a `ShareLink` styled as a detail action, especially on Mac. Check it looks like the
    other actions.

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
