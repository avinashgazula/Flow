---
version: 1
slug: "web-src-routes-index-tsx"
primary_target: "web/src/routes/index.tsx"
related_targets: ["Flow/Features/Home"]
---

# Surface brief: Flow, all watching surfaces

Scope: the whole product's browsing and watching surfaces on every platform: Home, title pages, the source picker, the player chrome, Explore, Search, Library, Live TV and Settings; the Apple apps (iPhone, iPad, Mac, Apple TV) and the website. Visitor mode: Operate.

Audience and job: the owner's household, mostly evenings in a low-lit living room on Apple TV, also iPhone and a laptop browser. They come to carry on watching or to pick something new. Ratings, the trailer and whether a version that plays well exists decide a title. A redesign must not read as another streaming clone, be busy, be plain, or be awkward with the Siri Remote.

Constraints: native Apple navigation and controls stay (tab bar, stacks, sheets, system controls, San Francisco, Siri Remote focus); web uses web controls. Performance budgets in web/PRODUCT.md.

## Direction contract

THESIS: Flow treats every title as a reel of film it knows about: each still and poster carries an edge strip, like the printed edge of 35mm stock, whose perforations fill as you watch and whose edge print says how long is left, when it ends and what format it plays in. It refuses the full-bleed backdrop carousel, the white pill button and the badge soup every streaming app ships.

OWN-WORLD: Warm film-base black owns every surface; paper-white type with warm second and third inks; film-stock yellow reserved for the one next action, focus and selection; signal red only for live and errors. San Francisco for all interface text; a condensed, tracked, uppercase edge-print voice (SF Condensed natively, Barlow Condensed on the web) only on edge strips and labels. Formats as edge print, never badges. Frames radius 6 with the strip attached below; matte, flat, no glass or glow on content (system bars keep system materials); artwork at one fixed scale per row.

STORY: The viewer opens Flow and sees the reel they were watching, how much is left and when it ends, and resumes in one press; or scans Up Next and the picks, reading each strip's runtime, rating and format, and plays one. A title's page answers "will it play well" on a film-can label.

FIRST VIEWPORT: Desktop web: the lead item (resume or top pick) as a large 16:9 frame with its edge strip (perforations = progress, print = episode, time left in yellow, end time, format), the title, a yellow Resume and a quiet Details; Up Next beside it as a 2-column grid of framed stills with strips; Pick Something New posters below with strips. iPhone: large title by time of day, the lead frame full width with strip, title, yellow Resume, then Up Next and picks; native tab bar tinted yellow. Apple TV: the lead frame left, Up Next right, rows below; focus is a yellow outline round frame and strip with a lift, the strip's print turning yellow.

FORM: 35mm film stock: edge print, perforations, stock labels and film-can labels; candidate 7 of 7, the direction assigned by the roll, chosen by the user after comparing sketches with Impeccable's pick. seed:c27adc5ae91211d3

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Raised by the directions it beat: yellow marks only the current action (orienteering map's reserved course colour); size and weight, never badges, set hierarchy (type specimen); one dominant item per screen (zoo guide map); matte unprinted ground with no decorative blur (factory catalog sleeves); one fixed artwork scale per row (botanical folio).

## Unresolved

- Light appearance: not designed; the apps and site stay dark-only (evening living-room scene).
- Superseded: "Tonight's Programme" (two-ink timetable) was built partway on the web and then replaced by Film Stock at the owner's choice after sketches.
- The app icon and name may change later; not part of this round.
