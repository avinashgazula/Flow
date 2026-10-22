# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The same owner and household as the apps (see `../PRODUCT.md`), on a laptop or desktop browser, sometimes a phone browser. The website is the way in from any computer, without installing anything.

## Product Purpose

Flow for the web is the Apple apps' product in a browser: Home, title pages, Explore, Search, Library, settings and the player, with the same sources, history and ranking. Product truth, positioning and principles are the root `PRODUCT.md`'s.

## Capabilities and Constraints

- Vite, React 19, TanStack Router/Query/Virtual, CSS Modules with tokens in `src/styles/tokens.css`; a Rust→WebAssembly Matroska remuxer and FFmpeg audio decoders loaded on demand.
- Performance budget: first-load JS 125 KB and CSS 12 KB gzipped (`npm run budget`); fonts beyond the system stack load only when chosen in Settings → Appearance.
- Browsers can't reach files on hosts without CORS headers; Real-Debrid needs the user's stream proxy.
- Deployed to media.gazula.dev from GitHub Pages.

## Brand Commitments

- It should feel like the same product as the native apps, at home in a browser: web controls on the web, not imitations of iOS chrome. Nothing else about the current look is binding.
