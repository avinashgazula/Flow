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

THESIS: Flow's home is tonight's programme, not a poster wall. Every listing says when it would end, how long is left and which version will play, aligned in a timetable column. It refuses the full-bleed backdrop carousel with a white pill button that every streaming app ships.

OWN-WORLD: A two-ink repertory programme on a screen. Deep programme-ink blue owns every surface; paper-white type; a blue-tinted second ink for secondary text; one fluorescent pink spot reserved for the next action, focus and "now". San Francisco throughout with tabular figures; titles set by weight and size, never condensed display. No badges or chips: formats are plain text in their column. Small artwork at one fixed scale per section. Flat ink: no glass, glow or gradient on content (system bars keep system materials).

STORY: The viewer opens Flow, sees what they were watching and exactly when it would finish, and resumes in one move; or reads down tonight's picks, each with runtime, end time, rating and best version, and starts one.

FIRST VIEWPORT: iPhone Home: large title "Tonight" with the date. The lead listing (the resume item) is a full-width 16:9 still with its timetable line beneath (start → end time, title, episode, minutes left, best version) and a pink Resume field. Then "Carry On" listings (time column | fixed-size artwork | title, episode, minutes left) and the first listings of "Pick Something New". Native tab bar. Web at 1440: the programme column beside a large still of the selected listing. Apple TV: the programme list on the left, the focused listing's still on the right; focus fills the row in pink.

FORM: a repertory cinema's printed monthly programme (timetable listings); candidate 1 of 7, Impeccable's pick, chosen by the user over the assigned direction. seed:c27adc5ae91211d3

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Light appearance: not designed; the apps and site stay dark-only (evening living-room scene).
- The app icon and name may change later; not part of this round.
