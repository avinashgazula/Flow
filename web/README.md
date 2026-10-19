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

**Audio conversion.** A track the browser can't play (TrueHD, DTS, and Dolby Digital where there's
no decoder) is handed to `src/lib/remux/convert.ts` raw, as the worker reads it. FFmpeg's decoders,
built to a 290 KB WebAssembly module (LGPL, `src/lib/audio/pkg/flow-audio.wasm`, rebuilt with
`npm run audio-wasm`), turn it into stereo PCM; `AudioEncoder` makes Opus; `OpusMuxer` wraps the
packets in fragmented MP4 about a second at a time. The module is fetched only when such a track is
chosen, so nothing about it is in the first-load code. Sound is counted in samples from the first
fragment after a start or seek and re-anchored when the file has a gap, so it stays with the
picture. Tracks that play as they are are never converted, and a failure at any step (the module
won't load, a decoder crashes, the encoder errors) drops the audio buffer so the picture plays on.

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
- **Codecs:** browsers can't decode DTS or TrueHD audio, and some have no Dolby Digital decoder
  either (Chrome on Linux and Firefox). Flow plays another audio track when the file has one that
  plays as it is. Otherwise it converts the sound: a Web Worker decodes it with FFmpeg's decoders
  (WebAssembly) and WebCodecs' `AudioEncoder` makes stereo Opus of it, which the page plays. That
  needs a browser that can encode Opus (Chrome, Edge, Firefox and Safari 26) and a file Flow can
  read: not one behind a host that blocks web pages and no stream proxy. Converted sound is stereo
  (5.1 and 7.1 are mixed down), and the audio menu says so. If the conversion fails, the picture
  plays on without sound and the player says why.
