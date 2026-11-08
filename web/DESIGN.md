---
name: Flow
description: Film Stock. A warm film-base black where every title is a reel with a printed edge strip, and one film-stock yellow marks only the next action.
colors:
  film-base: "#15120f"
  film-base-2: "#1f1b17"
  film-base-3: "#2a251f"
  film-base-4: "#3a342c"
  edge-band: "#0d0b09"
  rule: "rgb(255 236 200 / 0.1)"
  paper: "#f4efe6"
  ink-2: "#bfb5a6"
  ink-3: "#8d8476"
  edge-print: "#d9cdb6"
  film-stock: "#f6b40e"
  film-stock-hover: "#ffc233"
  film-stock-press: "#dda00a"
  on-stock: "#15120f"
  signal-red: "#f25c45"
  warn-amber: "#ff9f43"
  overlay: "rgb(21 18 15 / 0.94)"
  selection: "rgb(246 180 14 / 0.3)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  page-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title-name:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "46px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title3:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  edge-print:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
    fontFeature: "'tnum'"
  edge-print-small:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
    fontFeature: "'tnum'"
rounded:
  art: "6px"
  label: "8px"
  control: "10px"
  panel: "12px"
  perforation: "2px"
  hairline: "1px"
  full: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  s: "12px"
  m: "16px"
  l: "24px"
  xl: "32px"
  xxl: "48px"
  xxxl: "64px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.film-stock}"
    textColor: "{colors.on-stock}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.film-stock-hover}"
  button-primary-active:
    backgroundColor: "{colors.film-stock-press}"
  button-secondary:
    backgroundColor: "{colors.film-base-3}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  button-secondary-hover:
    backgroundColor: "{colors.film-base-4}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 12px"
  button-quiet-hover:
    backgroundColor: "{colors.film-base-2}"
    textColor: "{colors.paper}"
  chip:
    backgroundColor: "{colors.film-base-3}"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  chip-current:
    backgroundColor: "{colors.film-base-4}"
    textColor: "{colors.paper}"
  field:
    backgroundColor: "{colors.film-base-3}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  frame:
    backgroundColor: "{colors.film-base-2}"
    rounded: "{rounded.art}"
  edge-strip:
    backgroundColor: "{colors.edge-band}"
    textColor: "{colors.edge-print}"
    typography: "{typography.edge-print}"
    rounded: "{rounded.art}"
    height: "26px"
    padding: "0 10px"
  film-can:
    backgroundColor: "{colors.film-base-2}"
    textColor: "{colors.paper}"
    rounded: "{rounded.label}"
    padding: "8px 16px"
  panel:
    backgroundColor: "{colors.film-base-2}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
---

# Design System: Flow

## Overview

**Creative North Star: "The Film Stock"**

Flow treats every title as a reel of film it knows about. Each still and poster carries an edge strip beneath it, like the printed edge of 35mm stock: a row of perforations that fill as you watch, and a line of condensed print that says how long is left, when it ends and what format it plays in. The page is the dark between screenings in an evening living room: a warm film-base black that owns every surface, paper-white type with warm second and third inks, and one film-stock yellow that appears only where something can be done next. The scene is dark only; no light appearance exists.

The system is matte and flat. Content has no glass, glow, blur or drop shadow; depth comes from four steps of warm base, hairline rules and the fixed relationship between a frame and its strip. Hierarchy is set by size and weight in the interface face. Facts that other apps turn into badges (format, HDR, rating, time left) are printed on the strip or on a film-can label instead. The result is calm and exact rather than busy: one lead item per screen, rows at one artwork scale, and the same object (frame plus strip) wherever a title turns up.

The web build uses web controls (44px buttons, segmented controls, native selects, hover lift for a mouse) rather than imitating iOS chrome. The Apple apps share this palette and scale in SwiftUI, with system materials kept for system bars only; this document records what the web build shows.

**Key Characteristics:**
- Warm film-base black on every surface; no pure black except behind video.
- One accent, film-stock yellow, meaning "next action, focus, current, watched".
- The frame with its attached edge strip is the one repeating object.
- Condensed edge print for facts, in a single face and weight, only where the world prints (strips, film-can labels, small format labels). The player is the one place the motifs do not apply (see Player Chrome and Scrubber).
- Flat and matte: space, base steps and 1px rules instead of shadows.
- Motion is 150 to 220 ms ease-out and answers state changes only.

## Colors

A palette of one warm black in five steps, one warm paper in three inks, one yellow, and two signal colours kept for status.

### Primary
- **Film-Stock Yellow** (#f6b40e, 10:1 on the base): The only accent. Fills the primary button (Resume, Play), draws the 2px keyboard focus ring, underlines the current nav item and segmented choice, fills watched perforations, tints the current tab and caret and selection, and prints the "time left" fact in edge print. Hover #ffc233, pressed #dda00a. Text on a yellow fill is On-Stock (#15120f, 10:1).

### Secondary
- **Signal Red** (#f25c45): Live, recording and errors only.
- **Warn Amber** (#ff9f43): Degraded playback notes such as "may stutter", in film-can labels and notices.

### Neutral
- **Film Base** (#15120f): Every page background, the nav, the theme colour, the base of the overlay.
- **Film Base 2** (#1f1b17): Panels, sheets, film-can labels, empty frames, hovered quiet items and the mobile tab bar.
- **Film Base 3** (#2a251f): Secondary buttons, fields, chips, segmented tracks.
- **Film Base 4** (#3a342c): Hover for those controls, the current chip, unwatched perforations, scrollbar thumbs, strong dividers.
- **Edge Band** (#0d0b09): The darkest step; the colour of an edge strip.
- **Paper** (#f4efe6, 16:1): Primary text.
- **Ink 2** (#bfb5a6, 9.2:1): Secondary text, meta lines, resting nav links, placeholder.
- **Ink 3** (#8d8476, 5.1:1): Captions, film-can keys, disabled text. Never for body copy.
- **Edge Print** (#d9cdb6, 12.5:1): Text on the edge band.
- **Rule** (rgb(255 236 200 / 0.1)): Hairlines around panels, under the scrolled nav; prefer space.
- **Overlay** (rgb(21 18 15 / 0.94)): Player chrome, notices and the source picker scrim; flat, never blurred.

### Named Rules
**The One Next Action Rule.** Yellow marks the one thing to do next, the place keyboard focus is, the current place in navigation and the progress that has been watched. If two things on a screen are yellow fills, one of them is wrong.

**The Warm Ink Rule.** Text is paper and its two warm inks. Grey is never introduced; every neutral carries the same brown-yellow undertone as the base.

**The Current Is Lighter Rule.** In chips and segmented controls the current choice is a lighter base with paper text. Yellow appears there only as the 2px underline on a segmented choice.

## Typography

**Display and Body Font:** the viewer's system face (-apple-system, "SF Pro Text", "Segoe UI", Roboto, system-ui). Settings offers Inter, Geist, Manrope or Ioskeley Mono; the choice swaps the family only and never sizes or weights.
**Edge Print Font:** Barlow Condensed 600 (self-hosted Latin subset), falling back to Arial Narrow and Roboto Condensed.

**Character:** Plain, large and bold interface type does the hierarchy; the condensed face is a printed voice used sparingly, so it reads as a different kind of information.

### Hierarchy
- **Display** (700, 34px on phones and 40px from 721px, 1.1, -0.02em): Page titles and the home greeting.
- **Title** (700, 30px, 34px from 721px, 1.1, -0.02em): The lead's title; sheet titles run 24px at 700 (-0.015em).
- **Headline** (600, 20px, 1.25, -0.005em): Section headings. Row titles are quieter: 600 at 15px in Ink 2.
- **Body** (400, 17px, 1.5): Running text, measured to 62ch where it runs long.
- **Control** (600, 15px, line-height 1): Buttons, chips, segmented choices, item titles under a frame.
- **Meta** (400, 13px, 1.35, Ink 2): The line of plain facts under an item's title; captions drop to 12px.
- **Edge Print** (600, 12px, 0.14em tracking, uppercase, tabular): Strip print and film-can keys (never the player, which sets its times in the interface face). Poster strips set it at 11px and 0.1em; film-can values run 15px and 0.08em in Paper.

### Named Rules
**The Print Only Where Printed Rule.** The condensed uppercase voice belongs to strips, film-can labels, the seek preview's time and small format labels. Titles, headings, buttons and navigation stay in the interface face.

**The Tabular Rule.** Times, durations, sizes, ratings and counts use tabular figures (`.num`, `time`, tables, and edge print), so a ticking clock never shimmers.

**The Set By Weight Rule.** Hierarchy comes from size and weight, never from colour or capsules. Section headings are plain sentence-case titles, not labels above titles.

## Layout

A single column of content on a 4-point scale (4, 8, 12, 16, 24, 32, 48, 64) with a 40px gap before a section (32px on phones). The page inset is a fluid gutter (16px to 48px, 4vw) that grows on very wide screens so content stops at 1800px; the nav uses the same inset so the wordmark and the page title share a left edge. Home content stops at 1360px and centres. There is more space above a section heading than below it (heading to row is 12px).

Rows have one artwork scale each (a row is a shelf, headed by its name in Ink 2 with a See all link; Settings → Shelves chooses them and their order, and the old "Pick Something New" heading is gone because the shelves name themselves). Posters are 112px wide in a phone's scrolling row, five across on a tablet and seven across from 1100px; stills are 240px (phone) or 280px in a scroll row, and two across in a grid beside the lead. From 1100px the home first screen is the lead (1.25fr) beside Continue Watching (1fr; the apps' Up Next shelf, when it is the only one on, takes that name and holds only next episodes) with 32px between; below that the lead stacks, or sits beside its facts at 420px on a tablet. The wall of posters wraps at 140px minimum. Folder rows (Streaming Services, Genres) are an index, not cards: Film Base 2 rows 48px tall with the name (a service's logo, 28px, before it) and a chevron, wrapping at 200px, two across on a phone. Upcoming and landscape shelves are stills at one size, scrolling sideways at every width with round buttons in the heading for a mouse. Breakpoints that matter are 720/721px (phone to tablet) and 1100px (desktop).

Phones swap the top links for a five-tab bar (56px plus the safe-area inset) and the nav shrinks from 64px to 56px. Rows that scroll sideways bleed to the screen edge so the cut-off item says it scrolls.

## Elevation & Depth

Flat and matte. Depth is tonal: Film Base for the ground, Film Base 2 for things that sit on it (panels, sheets, labels), Film Base 3 and 4 for controls and their hover. Content carries no drop shadow, glow, blur or glass; the player's chrome and the source picker sit on a 94% base overlay with a hairline, not on a blurred backdrop. The top nav is solid Film Base and gains a 1px Rule underneath only once the page has scrolled under it.

### Shadow Vocabulary
- **Hairline ring** (`box-shadow: 0 0 0 1px var(--rule)`): The edge of a sheet or the seek preview card, in place of a border.
- **Scrolled-nav rule** (`box-shadow: 0 1px 0 var(--rule)`): Nav underline once content scrolls.
- **Selection ring** (`box-shadow: inset 0 0 0 2px var(--paper)`): The chosen typeface card in Settings, accompanied by a check so it never rests on colour alone.
- **Progress thumb focus** (`0 0 0 2px #000, 0 0 0 4px var(--stock)`): The thumb's focus state on the player's black gradient.
- **Subtitle halo** (a three-layer dark `text-shadow`): Legibility of subtitle text over any picture; it belongs to the picture, not to the interface.

### Named Rules
**The Matte Content Rule.** Artwork, cards and strips are never lifted by a shadow or softened by blur. A hover lift is a 2px translate, never a shadow.

## Shapes

Small, quiet corners with one deliberate silhouette. A frame is radius 6; with a strip attached it is round on top only (6 6 0 0) and the strip is round underneath (0 0 6 6), so the two read as one object. Film-can labels are radius 8, controls (buttons, chips, fields, segmented tracks) radius 10, panels, sheets and Up Next radius 12. Icon buttons are 44px squares at control radius; the player's buttons are round (a faint white disc on hover) because that is how every player draws them.

The signature geometry is the perforation: a 7 by 9px hole with a 2px radius on an 11px pitch, drawn as a repeating mask so its colour comes from tokens (unwatched Film Base 4, watched Film-Stock Yellow). The player does not use it: its progress bar is one plain track.

### Named Rules
**The One Object Rule.** A frame never appears without its attached radius logic: if it has a strip, 6 on top and 6 below; if it has none, 6 all round. Never round the join.

## Components

### Buttons
- **Shape:** Gently squared (10px radius), 44px tall (48px large, 36px compact; compact is 44px where the pointer is a finger), label 600 at 15px with an 18px icon and 8px gap.
- **Primary:** Film-Stock Yellow fill, On-Stock text, 0 20px padding (24px large). One per screen: Resume or Play.
- **Secondary:** Film Base 3 fill, Paper text; Film Base 4 on hover. Sits beside the primary (Details).
- **Quiet:** Transparent, Ink 2 text, 0 12px padding; Film Base 2 and Paper on hover.
- **States:** Pressed scales to 0.98 and goes to #dda00a on the primary; disabled goes flat Film Base 3 with Ink 3 text; focus is the yellow ring.

### Chips and Segmented Controls
- **Chip:** 36px tall (its hit area is 44px where the pointer is a finger, reaching 4px above and below), Film Base 3, Ink 2 text, 10px radius; hover Film Base 4 and Paper; current is Film Base 4 and Paper, never yellow. Rows of chips scroll sideways on every width, with a fade on each side that has more, and round scroll buttons for a mouse only.
- **Segmented:** A Film Base 3 track with 3px inset, 34px segments (38px on a touch screen) at 8px radius; current is Film Base 4, Paper text and a 2px yellow underline. Arrow keys move along it.

### Fields
- **Style:** Film Base 3, no stroke, 44px tall, 10px radius; Film Base 4 on hover.
- **Focus:** The standard yellow ring at a 2px offset. Selects keep the native picker with a drawn chevron in Ink 2.

### Frame and Edge Strip (signature)
The plate is a still (16:9) or poster (2:3) filling its parent's width, with its strip attached underneath. The strip is a 26px band (22px on posters) in Edge Band with 10px side padding: perforations at left, edge print after them. Perforations are the progress meter, filled in whole holes (rounded up, at least one once started); a title not started keeps all holes unfilled because it is still a reel. Perforation counts are fixed per strip kind and row (stills 3 to 4, posters 3 to 5; a lead fills up to 30, a title page's still up to 18), so every strip in a row aligns. A narrow strip keeps its fewest holes (three on a poster in a phone's row, eight on a lead) and drops print instead: format first, then the end time. A title watched through prints WATCHED first with every hole filled, on its page as on its poster. The print is a priority list: time left (yellow), end time, format, episode code, SERVER, rating, runtime or seasons, year. SERVER is the one fact about where a title lives: a title on one of the viewer's media servers ends its print with it ("8.2 · SERVER"), never a badge on the artwork. It is printed after the rating but outranks it, so a phone's narrow poster keeps SERVER and gives up the rating first. The same strip may print a title's episodes left ("5 episodes left", a series only) just under the time left: it outranks the end time, so a narrow still keeps how much of the series remains. A poster that has been watched prints WATCHED first and fills its perforations; a series part way prints "3/10". Lowest priority goes first when space is short, and no fact is ever cut mid-word. A strip always carries something real; there is no strip without facts.

### The Lead's Reel
The lead may turn through up to ten titles (what is in progress first, then the top picks). The page you are on is a small edge band under the buttons: one perforation per title (the current one Paper, the rest Film Base 4), the count in edge print ("02 / 10") and, only while it turns by itself, a quiet pause. Holes are 24 by 32px buttons that arrow keys move along. It turns every eight seconds only when nothing is in progress, never while the pointer or keyboard is in the lead, and never under reduced motion; choosing a title stops it. Every slide's title and facts share one grid cell so the block never changes height, and a title's logo (44px tall, TMDB's) replaces its name once loaded, the words staying for a screen reader. The lead stays one frame with one strip: no backdrop, no full-bleed carousel, unless the viewer chooses Fullscreen (Settings → Shelves → Top Pick → Style), the apps' Fullscreen top pick. Then the same one object runs edge to edge (4:5 on a phone, 21:9 from 721px, never over 72% of the window, radius 0 because nothing is left to round), its title, facts, buttons and reel sit on its lower part over a flat scrim of the film base, and the strip is the band along its foot; Continue Watching moves under it, four across on a desktop.

### Item Cards
A frame item is one link: plate, a 15px/600 title (one line, ellipsis) and one 13px Ink 2 meta line. On hover (mouse only) the plate lifts 2px and the print turns Paper; on press it scales to 0.98; on keyboard focus a 2px yellow ring goes round frame and strip together. An item that cannot play is dimmed to 55% with its reason in the meta line.

### Card Menu
Home's cards have a menu, as the apps' long press does: Go to Details, Mark as Watched (or Unwatched) and Remove from Continue Watching on a card with a resume point, or the watchlist toggle on a poster. It opens from a More button (a flat 36px chip on the overlay, top right of the frame, like the episode mark: shown on hover or focus for a mouse, always on a touch screen, 28px on a phone), from a right-click, or from a long press. The menu is a flat Film Base 2 panel with a hairline ring and 12px radius, 44px rows in the interface face with a drawn icon, no glass, no shadow and no red for the destructive row: the words say it. It is a `menu` with arrow keys, Home and End; Escape closes it and gives focus back to the button. The episode cards on a title page have the same menu with Play, Mark as Watched and Mark Watched Up to Here. Show Titles Under Posters off leaves the poster's title to its spoken label, and Show Release Year prints the year as the one line under the frame.

### Film-Can Label
The title page's "how this plays" answer. A Film Base 2 panel with a hairline and 8px radius, rows of key and value in edge print: keys in Ink 3 (12px), values in Paper (15px, 0.08em). Direct play is yellow, compromises amber, quiet states Ink 3. The version row wraps only between parts, with the separator dot leading the next part. The sources row is a whole-line control with an underline and a chevron.

### Navigation
Solid Film Base bar, 64px (56px on phones), wordmark with a small yellow mark, links 15px at 500 in Ink 2; the current link is Paper at 600 with a 2px yellow underline. On phones the links give way to a Film Base 2 tab bar where the current tab is yellow. The order of both is a setting (Settings → Appearance → Tab Order, up and down buttons); a section the saved order doesn't know takes its default place.

### Player Chrome and Scrubber
**The player is the one place Film Stock's motifs don't apply.** No edge strips, perforations or edge print inside the player (the film player and the live player): it looks like Apple TV+ on the web, Netflix or YouTube, because a person watching a film wants the controls they already know. Panels keep their Film Base 2 structure; everything else here is conventional. The warm Film Base, Paper type and the yellow focus ring and next action are still the site's colours; nothing else carries over.

Chrome is flat: plain white (Paper) line icons straight on the picture over a black gradient (about 65% at the top for 150px, 85% fading to nothing over 240px at the bottom, behind the subtitles), panels and notices on Film Base 2 at 94% with a Rule border, no blur. Close is top left (on a phone the title sits beside it); the bottom is one progress bar over one 48px row of controls, with the page gutter (28px, 16px on a phone) at the sides. Left of the row: play or pause, skip back and forward (the configured seconds in the arrow), volume (the speaker with a slider that opens beside it on hover or focus) and the title with "S1 E1 · Episode name" under it in 14px and 12px Ink 2. Right of it: Episodes, X-Ray, Audio and Subtitles, Options, AirPlay or cast where the browser has it, Picture in Picture and full screen. Every button is a 44px target with a round hover disc (white at 16%), the open panel's button a steady disc (white at 20%, never yellow), and the 2px yellow focus ring for the keyboard.

**The progress bar** is one continuous track with the time played on its left and the time left on its right (a click on that one swaps it for the whole length, as on Netflix, and the choice is remembered), both 13px in the interface face with tabular figures; on a wide window "Ends 3:45 PM" follows in Ink 2. The track is 4px (6px under the pointer, on focus and while dragging, animated), unplayed Paper at 25%, read-ahead Paper at 30% on top of that, played solid Paper. Paper, not the brand yellow: yellow stays for the next action and the focus ring everywhere else in Flow, and white reads best on the black gradient over bright and dark frames alike. A 14px round Paper thumb shows under the pointer, while dragging and on focus (always on a touch screen, where there is no hover). Chapters and the ends of skippable stretches (intro, recap, credits) are 2px gaps in the track, as on YouTube, never ticks (none past 40 chapters, which would be a comb). The track is a `role="slider"` with the time and chapter in `aria-valuetext`; arrow keys, Home and End seek as before. Over the bar a tooltip follows the pointer: a rounded thumbnail (200px, 160 on a phone) on a dark card, the time under it in 14px semibold and the chapter's name in 12px Ink 2; with no picture it is a pill with the time alone. It is written to by the DOM, so neither hovering nor playing re-renders React.

**The middle** is the picture. With a mouse a single large play or pause flashes there when it toggles (and the keyboard's other actions), and is gone in half a second. On a touch screen the transport is also there: skip back, play or pause and skip forward as clean Paper glyphs on translucent black discs (50%), the row's own copies left out; a double tap on either half skips with a ripple at that side, and a hold plays at 2×.

**Over the picture, one action at a time.** The Skip Intro, Skip Recap or Next Episode button is a solid white button with dark text, as Netflix draws it, bottom right above the control row, and rides up with the controls. Skip Credits waits as a translucent dark button while a note tells the viewer to stay for a scene in or after the credits. An automatic skip leaves a short Film Base 2 note ("Skipped intro") with a quiet Undo. Are You Still Watching? is a Film Base 2 card with Keep Watching (primary, focused) and Stop. The Up Next card leads with the episode's plain rounded still (a 3px line along its foot runs down with the countdown) and title, with "Starts in 9s" in words; a phone held sideways leaves the still out. Quiet words (the sleep timer, a scene to stay for, an app opening, the "2×" of a hold) sit top centre on Film Base 2 at 94% with a Rule border, one at a time, in the interface face. Because You Watched is a solid Film Base 2 card where Up Next stands (it takes the Skip button's corner until closed; the subtitle line keeps beside it on a wide window and above it on a narrow one, and a phone's card holds two frames) with plain rounded stills and 13px titles, each fact said once (the line under the title), and at a film's end a flat near-black screen with the same stills in a row; neither blurs or tints the picture. X-Ray is a solid Film Base 2 card (12px radius, hairline ring, no glass) on the right between the buttons' row and the scrubber's band, 380px wide, with a phone's a sheet on that band 36% of the screen high (the transport steps aside, the subtitle line rides just above it, and on a wide window keeps beside it). It opens on a pause and closes on Play; one opened by hand stays, and Options, Episodes and Playback Info take its place rather than stand beside it, while Skip, Up Next and Because You Watched wait as they do for any panel. Its header is the name in Body weight and a 40px close; the tabs (In Scene, Cast, Scenes) are the chips from Explore's Filters, the current one a step lighter and never yellow. A person is a row: a 44px photo in a frame (6px radius, hairline ring, initials on Film Base 3 when TMDB has none), the name at 15px 600, the character at 13px in Ink 2, no chevrons and no badges; the crew sit under a plain 13px Ink 2 heading. Opening someone swaps the card's content for their page (a 96px portrait, name, character, life line, five lines of biography with Read More, a row of Also In posters) behind a back arrow, and the full page opens in a new tab so the film is never left. The only yellow is the focus ring and the check on the scene playing. The options panel's Chapters page is a plain list of rows (name left, start time right in tabular figures, the chapter playing in semibold with the one yellow check) that opens scrolled to the playing chapter; a choice seeks and closes the panel. Picture subtitles (Blu-ray, DVD) are the disc's own bitmaps, drawn flat on the picture where the disc put them, never restyled, tinted or shadowed; only their position follows the viewer's subtitle position and the controls, and a panel over the picture (they stand beside it or move above it exactly as the text line does; a cue too big for the room left is scaled down to fit). Every panel keeps the subtitle line in view: beside it on a wide or short window, above it on a phone held upright (Options and Audio and Subtitles are capped at 46% of the screen high there, the Episodes shelf does it at every width, and Playback Info takes the room beside the line in a short window). The options panel's Subtitle Delay and Volume Boost pages are a 24px tabular value between 44px nudge buttons, a slider and a Reset.

### Live TV
Live TV fills the window under the nav: title and tools, group chips, then one base-2 panel that scrolls inside itself. The **channel list** is rows divided by a hairline: logo plate, number and name, what is on with the time left, a 2px red line for how far through it is, then "Next". The **guide** is a timeline: a sticky ruler of half hours in tabular figures, a sticky channel column, programmes as blocks as long as they run in Film Base with a hairline, the one on now in Film Base 3 with a red hairline for how far through it is (yellow stays for focus), and a 2px red now-line with a dot in the ruler. The guide opens with the line a little way in, a programme on now keeps its words to the right of the line, and a label that a column or edge would cut to a fragment is hidden rather than shown. Red means live and nothing else; the LIVE mark is a red dot and the word, not a badge. A programme's details dock under the guide in a base-2 panel (a modal would hide the guide it describes), with Watch Now as the one yellow fill. The **live player** speaks the film player's language: Guide top left, what is on and next as plain text above one control row (play, volume and a LIVE mark, a red dot and the word, on the left; channel up and down, the channel list, Picture in Picture and full screen on the right), a thin Paper line for how far through the programme it is (there is nothing to seek, so no draggable bar), and the channel list as a side panel (a bottom sheet on phones).

### App Notes
Two quiet notes about Flow itself: "You're offline. Flow needs a connection to reach your sources." while the browser has no connection, and "Flow was updated." with a secondary Reload and a dismiss. Flat Film Base 2 panels with a hairline ring, 12px radius, 15px Paper text; bottom left on a wide screen, full width just above the tab bar on a phone, rising in over 220ms. Neither is yellow (Reload is not the screen's next action), neither blocks anything, and neither shows during playback. `offline.html` is the same words on the film-base ground with one primary Try Again, for the case where even the saved page is gone.

### Title Page Sections
**Where to Watch** is a row of 44px square logos (radius 6, a hairline ring) for each way to watch, labelled in ink-2 (Subscription, Free, Rent, Buy); the service's name is the link's spoken name and tooltip, and a service with no logo is its name set small in the square. No badges, no per-service captions. **Reviews** are entries on a hairline rule, not cards: a 36px initial, author, source and date, the score as a star and number in paper, then the text in ink-2 folded to five lines with Read More; two columns from 760px. **About** is the same key and value grid as before, with Title Case keys as in the apps. **Ratings** are aligned numbers (600, 24px, tabular) with the site's name under each in Ink 3 at 12px, wrapping to a second line rather than shrinking; no logos, boxes or colour, and a score that links shows its name underlined on hover and focus. **Request** is a secondary button beside Trailer while there is something to ask; once Seerr has the title or is working on it, the same place says so in plain Ink 2 text with a small icon ("Available in Seerr", "Requested", "Processing"), not a button that does nothing. For a series the button opens an in-place question, "Which seasons?", with All Seasons, Latest Season and Cancel, never a dialog, scrolled clear of the tab bar. On a phone Play takes a line and Trailer and Request share the next. The meta line under the title ("2024 · 2 h 47 min · PG-13 · Science Fiction, Adventure") wraps only between its parts, the dot leading the next one; on a phone the ratings fall into columns so the numbers line up. **Your Rating** is five 36px-wide stars, paper when chosen and ink-3 outlines when not (yellow is the next action, not a score). The episode mark on a still is a flat 36px chip on the overlay: an empty ring in ink-2 until watched, then a yellow check, so the state is a shape and not only a colour. The trailer sheet puts the title's other videos as chips under the frame (the current one a lighter base, never yellow).

**The one blur.** A spoiler waiting to be read (a review flagged as one, words in spoiler tags, the still of an aired episode when Episode Spoilers is off) is blurred until the viewer asks for it. That is a state with a way out (a Show Spoilers control on every review that has blurred words, or watching the episode), not decoration, so it doesn't break the Matte Content Rule.

### Library Pages
Library opens with an index of folder rows (Upcoming, Sports, History, Stats: a name and what it holds, Film Base 2, 56px) above its lists. The pages that read the library rather than list it (History, Upcoming, Sports and Stats) share one rhythm and one right edge: content stops at the reading width (`--reading-width`, 960px), and on a wide screen the index is four equal columns so it ends where the shelves under it do. A heading in Headline weight with its quiet caption, then rows on a hairline, as History does. **Upcoming** has a strip of the next 14 days (52 by 68 cells: a day with something on is a Film Base 3 button with a dot, an empty day a hairline ring in Ink 3, today the lightest step), Just Aired as a row of stills, then a section for each day with the still, the title, the episode and a quiet Add to Calendar. A day's heading says the day once: the word with its date after it for today and tomorrow ("Tomorrow", "Tuesday, November 3"), a weekday with the month and day for the rest of the week ("Thursday", "November 5"), and the whole date, alone, beyond that. From 900px the heading is a rail beside its rows (rows stop at 680px), so a day with one entry is one row tall and the button stays near its title. **Stats** states its answer as one sentence at Title size, the time in Paper and the rest in Ink 2, never as tiles of big numbers; the evidence follows on Film Base 2 panels: hours as bars on a hairline (Ink 3, the current one Paper, each value sitting on top of its own bar), genres as a name, a share in tabular figures and a bar that ends round, five posters, and two ruled rows of habits. **Sports** sections are a team's badge or initials, its name and its games as rows, with the channel list opening under the game, not over the page. A covered score is the one blur: a blurred stand-in with "Show score" beside it, so the way out is in words.

### Sheets and Panels
The source picker is a flat Film Base 2 sheet (12px radius, hairline ring) over the overlay scrim; each source is a film-can row. Panels fade in over 150ms; the sheet rises over 220ms. Explore's Filters sheet is the same material: a side panel on wide screens and a bottom sheet on phones. Its choices are chips (current is Film Base 4); a chosen streaming service gets a 2px Paper ring outside its logo plus a drawn check by its name, so a choice never looks like keyboard focus.

The picker's rows follow Settings → Sources → Appearance without adding colour: with rows titled by provider (the default) each provider heads its group in the same plain 13px heading with its count in Ink 3, and a row leads with its release type; badges are edge print in one ink (All Formats, Minimal or None), never coloured packs, which the apps' Colored pack maps to All Formats. The add-on's own text, when asked for, is set in 13px Ink 2 under the title, clamped to eight lines (three when compact). Sources hidden by the viewer's filters are counted in the status line, and an empty list says why.

### Search Subtitles
A page of the player's options panel (same Film Base 2 card, Back in the header). Top: a row of dots, one for each service asked, lit Paper as it answers (a service still being waited for breathes; one that failed stays dark), and one plain sentence under it. Results are the panel's rows, grouped under plain language headings in the viewer's order: the release name at 15px (two lines at most, broken anywhere because it is a run of dots), then the service and its download count at 12px in Ink 2; SDH is a small 12px Ink 2 label in front of them. The current track has the one yellow check. A download that fails says so in Signal Red above the list, with what to add or change. The foot lists what each service said in two quiet columns, a service that failed in Warn Amber. Nothing to search with is a sentence and a link to Settings → Playback, not an empty list.

### Hover
Hover styles live in `@media (hover: hover)`, so a touch screen never keeps a button looking hovered after a tap (the player's X-Ray and Episodes discs were the sign). The steady disc on a cluster button is the open panel and nothing else.

### Settings Rows
Grouped Film Base 2 lists with a Rule between rows and a sentence-case footer under each group. Yellow appears only on a switch that is on, the one primary action of the group, and focus. A lone text field (a key, an address) sits beside its label at 20rem on a wide screen and takes the line under its label on a phone. On a phone one rule places every other control: a switch, select (at most 52% of the row, long values cut with an ellipsis) or a single button sits beside its label; a slider and a pair of text buttons (Export and Copy Link) take the full line under it, left-aligned. A control is never dropped onto a line of its own at the right. Destructive actions (Clear, Reset, Forget, Reset Everything, Turn Off and Erase) are secondary buttons with Signal Red text and a confirm step. Data rows are titled by what they hold (Watch History, Watch Progress, Watchlist, Remembered Sources, Cached Shelves and Details) with the verb as the button; a row with nothing to clear is disabled, and Reset Everything is a group of its own at the end, with its footer. A choice that cannot be made yet (a tracker that is not signed in) is Ink 3 with a not-allowed cursor, `aria-disabled`, and the reason under its name. Footers are one or two sentences of what the viewer needs; the detail that only a developer wants (allowed hosts, CORS) is behind a Learn more link to the web README. Host names and literal addresses in a footer are set in the interface face at a heavier weight, never in monospace. The sync key is set in the system monospace face, grouped in fours, because it is typed by hand and 0 must never be read as O; it's the one place a monospace face appears. About offers Install Flow as a secondary compact button only where the browser can install it (an iPhone or iPad gets one sentence about Share instead), and nothing once it is installed. Account is two groups: the Trakt app (its Client ID field with a quiet Save, and the Redirect URI set in the interface face with a Copy button, since it is copied and not typed) and the sign-in, whose only yellow is Sign In to Trakt, or Sign In Again when Trakt ended the sign-in. What went wrong sits in the group as a Signal Red sentence that says what to do next.

## Do's and Don'ts

### Do:
- **Do** put the page on Film Base (#15120f) and lift only with the next base step (#1f1b17, #2a251f, #3a342c).
- **Do** reserve Film-Stock Yellow (#f6b40e) for the next action, keyboard focus, the current place in navigation, watched perforations and the one time-left fact.
- **Do** show a format, rating, runtime or end time as edge print on a strip or film-can label, ranked by the fixed priority.
- **Do** pair every frame with the same strip logic and keep all frames in a row at one scale.
- **Do** give every screen one dominant item (the lead, the answer, the player) and let size and weight carry the rest.
- **Do** use tabular figures for anything numeric and 150 to 220ms ease-out for state changes.
- **Do** keep the 2px yellow focus ring at a 3px offset (2px on fields), following the element's corners.
- **Do** keep the secondary text at Ink 2 or better, and Ink 3 only for captions and keys.

### Don't:
- **Don't** use yellow for decoration, for a second filled button on a screen, or for the current chip.
- **Don't** put drop shadows, glow, blur or glass on content, chrome over video, or sheets. Hairline rings are the allowed edge.
- **Don't** use the condensed face for titles, headings, buttons or navigation, and don't set edge print in another weight.
- **Don't** make a strip without facts, or invent a fact to fill one; and don't cut print mid-word to fit it.
- **Don't** introduce grey text or a cool tint; every neutral keeps the warm undertone.
- **Don't** mix poster and still scales in one row or vary perforation counts within a row.
- **Don't** carry Film Stock into the player: no edge strips, perforations or edge print over the picture. It is a conventional player.
- **Don't** introduce a light appearance; Flow is dark only.

## Notes

The Apple apps map these same tokens to SwiftUI (`Flow/Design/Theme.swift`) on another branch; system bars keep system materials there. Nothing in this file depends on that mapping.
