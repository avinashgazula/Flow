---
name: Flow
description: Index. Paper and ink ruled with 3px lines, a giant grotesque for titles, monospaced type for everything you press, one red for markers and one blue for action.
colors:
  bg: "#ffffff"
  fg: "#0a0a0a"
  red: "#c9120a"
  blue: "#1a3dff"
  onblue: "#ffffff"
  muted: "#555555"
  faint: "#636363"
  tint-1: "#f3f3f0"
  tint-2: "#e7e7e3"
  tint-3: "#d4d4ce"
  warn: "#a64b00"
  dark-bg: "#0a0a0a"
  dark-fg: "#f2f2ee"
  dark-red: "#ff5a4e"
  dark-blue: "#8fa2ff"
  dark-onblue: "#0a0a0a"
  dark-muted: "#b0b0ac"
  dark-faint: "#8f8f8b"
  overlay: "rgb(10 10 10 / 0.94)"
typography:
  display:
    fontFamily: "'Archivo', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "clamp(56px, 12vw, 168px)"
    fontWeight: 700
    lineHeight: 0.84
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.1
  heading:
    fontFamily: "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.1
  reading:
    fontFamily: "'IBM Plex Serif', Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.06em"
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.12em"
  meta:
    fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: "0"
  player: "10px"
spacing:
  xxs: "4px"
  xs: "8px"
  s: "12px"
  m: "16px"
  l: "24px"
  xl: "32px"
  xxl: "48px"
  xxxl: "64px"
  gutter: "clamp(20px, 4vw, 64px)"
  section: "40px"
components:
  button:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "48px"
    padding: "0 18px"
  button-primary:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.bg}"
  button-hover:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.onblue}"
  button-danger-hover:
    backgroundColor: "{colors.red}"
    textColor: "{colors.bg}"
  chip:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "0 14px"
  chip-current:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.bg}"
  field:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.none}"
    height: "48px"
    padding: "0 14px"
  nav-cell:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    height: "56px"
    padding: "0 24px"
  nav-cell-current:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.bg}"
  nav-logo:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.onblue}"
    height: "56px"
    padding: "0 24px"
  row-hover:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.onblue}"
---

# Design System: Flow

## Overview

**Creative North Star: "The Index"**

Flow for the web is an index of what the viewer owns: titles, episodes, channels, people. The design is that of a printed index set by a Swiss typographer and then made brutal: a sheet of paper, ruled in ink, with one huge word at the top of each page and everything below it in rows, cells and plain lines. The language comes from reference material the owner chose (an index site with giant uppercase titles, bordered nav cells and ruled lists); nothing of its content, name or wording is used. The Apple apps keep their own design; this system is the website's.

The page is white paper and black ink, or the reverse: both themes are first-class. The system's theme is followed until the viewer chooses, in the top bar, and the choice is kept in that browser. Structure is made by **3px ink rules** and shared cell borders, not by space and not by fills. Artwork is the only colour on most screens, and it sits inside rules: posters and stills are square, framed, never rounded, never shadowed.

It is explicitly not: a glass or blur UI, a gradient or shadow UI, a rounded-card dashboard, a streaming service's dark carousel wall, a badge-and-pill interface, or a decorative film motif. Nothing is soft. The video player is the one exception (see Player Chrome).

**Key Characteristics:**
- Paper `#ffffff` and ink `#0a0a0a` (dark: ink `#0a0a0a` and paper `#f2f2ee`); everything else is one of three accents or a quiet tint.
- 3px ink rules divide the page: under the nav, under page heads, around toolbars and grids of cells (cells share borders), at the top of a list; 1px ink lines divide the rows inside.
- Four open-source faces: Archivo for the giant title, Plex Sans Condensed for headings, Plex Mono for the interface, Plex Serif for reading.
- Red marks, blue acts. Nothing else is coloured.
- Square: every radius is 0 outside the player.
- Interaction is inversion: hover fills blue, the current place is inverted ink, focus is a blue ring.

## Colors

Two themes, defined as tokens on `:root` (light) and `:root[data-theme="dark"]` (dark) in `styles/tokens.css`. A pre-paint script in `index.html` sets `data-theme` from the saved choice or `prefers-color-scheme`, so no first frame is the wrong theme. A subtree can force dark with `data-theme="dark"` (the player does), and the derived tokens follow.

### Primary
- **Ink / Paper** (`--fg` / `--bg`): `#0a0a0a` on `#ffffff`, and in dark `#f2f2ee` on `#0a0a0a`. Text, rules, borders, the solid button, the current nav cell. 19:1.

### Secondary
- **Index Red** (`--red`): `#c9120a` light, `#ff5a4e` dark. Section labels, row numerals, the second line of a title pair, progress fills, markers, "live", the dotted underline of a quiet link, destructive hover. 5.9:1 on paper (4.7:1 on the darkest tint), 6.4:1 on ink. Never for body text.
- **Action Blue** (`--blue`, text on it `--onblue`): `#1a3dff` with white, in dark `#8fa2ff` with ink. Links, hover fills, selection, the focus ring, the Flow logo cell, switch tracks. 7:1 on paper, 8:1 on ink.

### Neutral
- **Muted** (`--muted`): `#555555` / `#b0b0ac`. Secondary text, metadata. 7:1 or better.
- **Faint** (`--faint`): `#636363` / `#8f8f8b`. Captions, placeholders, disabled. 6:1 on paper, 4.9:1 on the darkest tint; never body copy.
- **Tints** (`--tint-1..3`): quiet fills for what is not there yet or is only a track: skeletons (always inside a 3px frame), slider and progress tracks, a hovered menu item. Nothing that holds content is tint-filled; that is a rule and the blue inversion.
- **Warn** (`--warn`): degraded states ("may stutter"). Rare.

The tokens are semantic: `--bg --fg --red --blue --onblue --muted --faint --rule`, with `--tint-1..3` for tracks and skeletons. The previous system's names are gone.

### Named Rules
**The Two Accents Rule.** Red is for marking, blue is for doing. A screen has no third colour besides artwork. If something is both, it is blue.
**The Inversion Rule.** The current place and every hover are shown by swapping colours (ink on paper becomes paper on ink, or ink on paper becomes white on blue), never by tint, glow, shadow or underline thickness.
**The Contrast Rule.** Every text pair is AA in both themes. Red and blue are checked on paper and on ink, and on each other's fills.

## Typography

**Display:** Archivo 700 (self-hosted). Page titles and the Home lead: uppercase, `clamp(56px, 12vw, 168px)`, line-height .84, letter-spacing -.03em. Long words use `.page-title.long`.
**Headings:** IBM Plex Sans Condensed 600/700. Section and row titles, big numbers, empty-state headlines, the search bar's input. Uppercase for category names.
**Interface:** IBM Plex Mono 400/600. The body face: nav, buttons, labels, metadata, footers. Labels are uppercase with .06 to .12em tracking.
**Reading:** IBM Plex Serif 400/600 and 400 italic. Overviews, reviews, biographies, episode synopses. `.reading` sets it at 17px/1.6 within the measure.

All four are SIL OFL, from the `@fontsource` packages, through Vite (`styles/fonts.css`): latin and latin-ext only, `font-display: swap`, only the weights above. Archivo 700 and Plex Mono 400 are preloaded by the build; the rest load when text uses them. The licences are in `public/fonts/` and Settings → About → Open Source Licences.

### Hierarchy
- **Display** (700, `--fs-display`, .84): the page title. A 3px rule runs under it, edge to edge.
- **Title** (700, 40/34px, 1.1, Condensed): a title page's name, a person's name.
- **Heading** (700, 22px, 1.1, Condensed): a section's name, a row's title.
- **Label** (600, 13px, uppercase, .12em, red): the name of a section above its list, `Browse by Genre`.
- **Body** (400, 15px, 1.5, Mono): interface text. Control text is 600 13px uppercase .06em.
- **Reading** (400, 17px, 1.6, Serif): anything a person reads as prose, 62ch at most.
- **Meta** (400, 12px, Mono, muted): `2H 47 · 8.4`-style lines under artwork.

### Named Rules
**The Mono Is the Interface Rule.** Anything you press, and every label and number, is mono. Anything you read as sentences is serif. Headings are condensed. The giant title is the only Archivo.
**The Tabular Rule.** Times, durations, sizes, ratings and counts use tabular figures (`.num`, set globally on `time`, `td`, `th`).

## Layout

One column of content with a generous side gutter (`--gutter`: `clamp(20px, 4vw, 64px)`; `--page-inset` grows it past 1800px). Structure is rules: a page head (giant title, rule), then sections each opened by a red mono label and a rule, then rows or a grid of cells with shared borders. Rows are full-width; cells tile edge to edge; there are no gaps between ruled neighbours. Space is the 4-pt scale `--space-xxs` to `--space-xxxl`.

The top bar is fixed and 56px (+3px rule). At 720px and narrower it is a single 52px row (logo, Settings, theme), and the sections move to a fixed bar of bordered cells at the bottom, 52px high with the safe-area inset. Touch targets are 44px or more in both.

### Named Rules
**The Rule Is the Divider Rule.** Separate things with a line, not extra space or a fill. A 3px rule opens a section; 1px lines separate its items.

## Elevation & Depth

None. There are no shadows, blurs, glass, gradients or translucency on content. Depth is order: the nav is fixed above the page and is the same paper with a rule. Over video, the player's own chrome uses a flat translucent ink (`--overlay`).

### Named Rules
**The Flat Rule.** If a `box-shadow` or `backdrop-filter` is in a diff outside the player, it is wrong. (A 1px ring made with `box-shadow: 0 0 0 1px var(--hair)` is a border in disguise and is allowed.)

## Shapes

There are no radius tokens: new code writes no radius. The one round thing on the page is the loading ring. The player has `--radius-player` (10px) and `--radius-player-full`. Sliders have a square ink thumb and colour swatches are square chips with an ink edge.

## Components

### Buttons
Square, 3px ink border, min-height 48px, Mono 600 13px uppercase .06em. **Primary** (`.btn-primary`): solid ink, paper text; the one next action on a screen (Resume, Play). **Secondary** (default `.btn`, `.btn-secondary`): paper with the ink border. **Quiet** (`.btn-quiet`): no border, for icons and small actions. Hover fills blue with white text (blue border). `.btn-danger` hovers red. Icon buttons (`.btn-circle`, named for what it was) are 52px square. Compact is 40px (44px on touch). Disabled goes faint.

### Chips and Segmented Controls
Bordered mono uppercase cells. Current is inverted (ink fill, paper text), never blue. Hover is blue. Segmented controls share borders (cells touch).

### Fields
Square, 3px ink border, 48px, Mono. Focus is the blue ring. Search is the exception in scale: a giant Plex Sans Condensed input in a ruled bar with a solid ink "go" block.

### Links
In running text: blue, underlined; hover turns ink. A `.quiet-link` (footers, emphasised phrases) is ink, 600, with a 2px dotted red underline at 4px offset. Focus is always the 3px blue ring, 2px offset (`:focus-visible`).

### Navigation
The top bar is bordered cells on a 3px bottom rule. The **logo cell** (left) is blue with the Flow wordmark in Plex Sans Condensed 700. The sections, **Sample Data** (only while sample data is on, in red), **Settings** and the **Light/Dark** toggle follow as cells with 3px left borders: uppercase Mono 600 14px, 56px high. Current is inverted; hover is blue; focus is blue with an inset ring. The toggle is a button with `aria-pressed` (true when dark); its label names the theme it switches to. Between 721 and 1100px Settings and the toggle show icons only (spoken labels stay). The bar slides away on scroll down and returns on scroll up or when it takes keyboard focus; with reduced motion it just appears and disappears. On phones the sections are the bottom bar: five equal cells, icon over a 12px label, 3px top rule, current inverted.

### Rows and Lists
A `.row` is full width; on hover and focus it inverts to blue. A list (`.rows`) has a 3px rule above and 1px ink lines between rows. Numbered lists use red condensed numerals (`01`) in a fixed column; titles are Condensed (uppercase for categories) or Serif; metadata is mono and muted, and turns white on the blue hover.

### Page Head
`.page-title`: the giant Archivo title, uppercase, with the 3px rule under it running edge to edge. A short uppercase mono note or a count (`.page-note`) can sit at its right.

### Loading, Empty and Error States
Loading is the ring (`.spinner`: ink with a red quarter) or a bordered bar with a red fill (`.pbar`). Empty and error states (`StateView`, `ErrorScreen`) are a condensed headline, one serif sentence on what to do next, and an action, left-aligned with the page. App notes (offline, updated) are ruled boxes bottom left, above the tab bar on phones.

### Artwork
Posters and stills are square, inside a ruled cell or row, with their metadata as mono text underneath. Progress is a thin red bar with a 2px ink border, or a plain red line. Loading ghosts are the same box: a 3px frame with a tint fill, then flat bars for the printed line, title and year.

### Player Chrome and Scrubber (the exception)
The video player is a conventional streaming player: its layout and controls are unchanged and it sits on true black. It is always dark: its root carries `data-theme="dark"` so every token resolves to the dark set whatever the page's theme. It takes the system's faces (Plex Mono and Sans Condensed), square panels and buttons, red for the played part of the scrubber and blue for focus. It uses `--radius-player` for any rounding. It has no 3px page rules on the picture itself. The panels beside or over it (options, X-Ray, episodes) are ink panels with 3px paper rules.

### Facts Lines and Rating Cells
A line of facts under a title (`2024 | 2 H 47 MIN | PG-13 | SCIENCE FICTION`) is mono uppercase with a 1px rule between parts, never a leading dot: it wraps only between parts and the rule a wrapped line would start with is clipped. Ratings are a ruled row of cells (a big red condensed numeral over the source's name in mono); each cell is as wide as its label, the row wraps when they do not fit, and a long name wraps inside its cell instead of running into the next. Where a dotted list must wrap (the version line of "How This Plays"), the dot trails its part.

### Settings Rows
Ruled sections, rows with Mono labels, square switches (ink off, blue on), square selects; footers in Mono, muted, sentence case.

## Do's and Don'ts

### Do:
- **Do** open every page with the giant Archivo title and its 3px rule.
- **Do** divide with rules: 3px to open a section or a block, 1px between rows.
- **Do** show hover and the current place by inversion: blue on hover, ink on paper for current.
- **Do** keep both themes AA, and check red and blue on both grounds.
- **Do** set sentences in Plex Serif and everything you press in Plex Mono.
- **Do** keep targets at 44px or more, and a 3px blue focus ring on everything focusable.
- **Do** keep artwork square and framed, with its facts as mono text beneath.
- **Do** use the tokens (`--bg --fg --red --blue --onblue --muted --faint --rule`) and let `data-theme` do the rest.

### Don't:
- **Don't** round a corner, add a shadow, a blur, a gradient or glass outside the player.
- **Don't** use red or blue as decoration: red marks, blue acts, and that is all.
- **Don't** put a pill, badge or kicker on content; labels are red mono text.
- **Don't** hard-code a colour or a font: use the tokens, so both themes and the player's dark scope follow.
- **Don't** colour the current chip or tab blue: current is inverted ink.
- **Don't** use a second accent, an icon container or a card with a fill and a radius.
- **Don't** copy the reference's words, name, logo or images: Flow keeps its own.
- **Don't** let text meet the edge of a ruled cell without padding.

## Notes

Flow for the web is a front end for the viewer's own sources and hosts no content. The apps (SwiftUI) keep their own design. The reference for this language is an index site the owner chose; only its grammar is used. Every screen has been restyled on this foundation.
