# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

The native apps (iPhone, iPad, Mac and Apple TV) are one SwiftUI code base and follow Apple's platform conventions on each. The website in `web/` is the same product in a browser and has its own record in `web/PRODUCT.md`.

## Users

The owner and their household. They set up their own sources (a self-hosted Jellyfin-compatible server, Stremio-style add-ons such as AIOStreams, Real-Debrid) and want one calm place to find and watch films, shows and live TV. Nobody else configures or supports it, so expert settings are acceptable, but everyday watching must never need them.

Where they watch, most to least:

- Apple TV in the living room: a big screen, the Siri Remote, usually evenings with the lights low.
- iPhone: in bed, commuting, or picking something to watch later.
- Mac, or the website in a browser on a laptop.

## Product Purpose

Flow is a front end for media the viewer already has access to. It hosts no content. It gathers what a title is (TMDB and TVDB metadata, artwork, ratings, cast), where it can be played from (every configured source, ranked), and where the viewer left off (Trakt, Simkl or on-device history), then plays it as well as the device allows.

Success: choosing something and pressing play takes seconds, the best playable source is picked without thought, and playback (resume, audio and subtitle language, skip intro, Up Next) just works.

## Positioning

Unlike a media server's own client, Flow merges several unrelated sources (media servers, debrid add-ons, IPTV, WebDAV) into one catalogue with one watch history, and does the player-side work itself: remuxing MKV, rewriting Dolby Vision, converting audio the device can't decode, choosing tracks by language.

## Operating Context

- Browse: Home (Continue Watching, Up Next, upcoming episodes), Explore, Search, Library (watchlist, history, stats), Live TV guide, Sports.
- Decide: a title's page with ratings, cast, seasons and episodes, trailers.
- Play: a source picker that ranks every provider's results, then the player (audio/subtitle choice, skip segments, Up Next, X-Ray cast panel, Shazam).
- Set up: sources, add-ons, servers, tracking accounts, playback preferences.

## Capabilities and Constraints

- Apple apps target iOS 17, macOS 14 and tvOS 17; CI builds with Xcode 16.4 and 26.3. Liquid Glass is available on 26 only.
- Metadata and artwork come from TMDB (and TVDB); artwork quality and aspect vary by title.
- Real-Debrid files are reached through add-on play links; in a browser they need the user's Cloudflare Worker proxy.
- Terminology: title, source, add-on, server, Continue Watching, Up Next, Watchlist, X-Ray.

## Brand Commitments

- The apps must feel native on each Apple platform: system navigation (tab bar, navigation stacks, sheets), system controls, San Francisco for interface text, standard gestures, Siri Remote focus behaviour on tvOS. Confirmed by the owner.
- Nothing else about the current look is binding. The name Flow and its play-triangle icon may change; artwork-first browsing is not required.

## Evidence on Hand

- Demo mode fills every screen with real TMDB artwork and Apple's sample streams (`-FlowDemo YES`, `?demo` on the web).
- No testimonials, users, metrics or press exist; none may be invented.

## Product Principles

1. Seconds to play: every screen shortens the path from wanting to watch to watching.
2. The device decides the details: the best source, track and format are chosen for the viewer, and explained only when it matters.
3. Native first: platform conventions outrank novelty on every Apple device.
4. The living room is the hardest test: what works at ten feet with a remote works everywhere.
5. Honest states: when something can't play, say why and what to do next.

## Accessibility & Inclusion

Dynamic Type, VoiceOver labels on icon-only controls, Reduce Motion and visible tvOS focus are required (see CLAUDE.md).
