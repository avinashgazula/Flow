# Flow for the web

The same Flow, in a browser: Home, title pages, Explore, Search, Library, your sources and the
player, built to feel instant.

```bash
cd web
npm install
npm run dev          # http://localhost:5173  (add ?demo for sample data)
npm run build        # type-check, then a production build in dist/
npm run preview      # serve dist/ at http://localhost:4173
npm test             # unit tests (Vitest)
```

## How it's put together

- **Vite + React 19**, with the React Compiler memoising every component.
- **TanStack Router** (file routes in `src/routes/`): each route is its own chunk. Links preload
  the route's code and data on intent (hover, focus or touch start), so a click usually lands on a
  page that's already loaded. Loaders start queries but don't await them; a page paints straight
  away and fills in.
- **TanStack Query** owns all server data (`src/lib/queries.ts`). The cache is saved to IndexedDB
  and restored at launch, so a repeat visit paints from disk before the network answers. A title
  page opens on what the tapped card already knew (`placeholderData`) while the rest loads.
- **TanStack Virtual** for long grids (Explore, Library).
- **Rust → WebAssembly** (`crates/`) for the work that's actually heavy in a browser: demuxing
  Matroska and remuxing it to fragmented MP4 for Media Source Extensions, in a Web Worker.
- **CSS Modules + tokens** (`src/styles/tokens.css`, mirrored from `Flow/Design/Theme.swift`). No
  CSS-in-JS runtime. The default typeface is the system's (SF on Apple devices); Settings →
  Appearance offers Inter, Geist, Manrope and Ioskeley Mono, and only the chosen one downloads.

| Path | What's there |
| --- | --- |
| `src/routes/` | One file per screen; `__root.tsx` holds the navigation and onboarding gate. |
| `src/features/<area>/` | Each screen's components and CSS. |
| `src/components/` | Shared pieces: `Artwork`, `Cards`, `Shelf`, `Hero`, `Nav`, `Icon`. |
| `src/lib/tmdb/` | TMDB client (normalises responses into `types.ts`), images, sample data. |
| `src/lib/store/` | Settings and library (watchlist, progress, history) in localStorage. |
| `src/lib/sources/` | Stream add-ons, Jellyfin/Emby and Plex, and source ranking. |
| `src/features/player/` | The player. |
| `proxy/` | The stream proxy: a Cloudflare Worker that makes blocked file hosts readable. |

## Rules for speed

- Images go through `Artwork` (or `srcSet`/`imageURL`): sized boxes, `srcset`, lazy below the
  fold, one high-priority image per screen.
- No new runtime dependency without a reason it can't be twenty lines of our own code. Anything
  large (hls.js, the WASM remuxer, sample data) is a dynamic `import()` on the path that needs it.
- Off-screen sections use `content-visibility: auto`; long lists are virtualised.
- State that changes often (playback time) lives in refs or the DOM, not in React state that
  re-renders a screen.

## Matroska

Browsers can't play `.mkv`, so `src/lib/remux` does it: a Rust crate (`crates/flow-remux`, 120 KB of
WebAssembly) demuxes Matroska in a Web Worker, fed by range requests (header, seek index, then
clusters a few MB at a time), and remuxes it to fragmented MP4 for Media Source Extensions. The page
only sees `attachMatroska(video, url)`; nothing loads until an MKV is played. The built wasm and its
JS glue are committed in `src/lib/remux/pkg/`, so the site builds without Rust. After changing the
crate, run `npm run wasm` (needs Rust with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli`
0.2.129) and `cargo test` in `crates/flow-remux`.

## Sample data

`?demo` in the address, or **Explore with Sample Data** on the welcome screen, fills every screen
from `src/lib/tmdb/demo.ts` with no key. The same catalogue as the apps' Demo mode.

## Limits of a browser

- **Mixed content:** a page served over HTTPS can't reach an `http://` server. Use HTTPS for your
  Jellyfin/Emby/Plex server, or run Flow locally (`npm run preview`) to reach one on your network.
- **CORS:** TMDB, Stremio add-ons, Jellyfin, Emby and Plex all allow browser requests. Some IPTV
  playlists and file hosts don't (most debrid download servers send no CORS headers), and those can't
  be read from a web page. Settings → Playback has a **Stream Proxy** field: a proxy you run fetches
  such files for Flow and adds the headers. `proxy/` holds a Cloudflare Worker for it
  (`proxy/README.md`), and MediaFlow Proxy works too. Flow uses it only for hosts that need it.
- **Codecs:** browsers can't decode DTS or TrueHD audio. Flow picks another audio track, or
  another source, when one is all a file has. Where the browser can encode Opus (WebCodecs), Flow can
  convert such audio instead, but only for a file it can read: not one behind a host that blocks web
  pages and no stream proxy.
