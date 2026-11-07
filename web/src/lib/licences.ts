/* What the website ships, and under which licence (Settings → About → Open Source Licences). The npm entries are checked
   against package.json and node_modules by licences.test.ts, so a library added or updated without a line here fails
   the tests. The rest is what the WebAssembly builds and fonts carry: see src/lib/audio/pkg/README.txt and public/fonts/README.txt. */

export interface Licence {
  /** The npm package, in package.json's spelling. */
  package: string
  name: string
  /** The version shipped, as installed. */
  version: string
  /** An SPDX expression. */
  licence: string
  /** The project's page, where the source is. */
  url: string
  /** What it is used for, one short phrase. */
  use: string
}

/** The libraries bundled into the pages: every entry in package.json's `dependencies`. */
export const libraries: Licence[] = [
  { package: 'react', name: 'React', version: '19.3.1', licence: 'MIT', url: 'https://github.com/react/react', use: 'Interface' },
  { package: 'react-dom', name: 'React DOM', version: '19.3.1', licence: 'MIT', url: 'https://github.com/react/react', use: 'Interface' },
  { package: '@tanstack/react-router', name: 'TanStack Router', version: '1.170.45', licence: 'MIT', url: 'https://github.com/TanStack/router', use: 'Pages and links' },
  { package: '@tanstack/react-query', name: 'TanStack Query', version: '5.104.4', licence: 'MIT', url: 'https://github.com/TanStack/query', use: 'Loading and caching titles' },
  { package: '@tanstack/react-query-persist-client', name: 'TanStack Query Persist Client', version: '5.104.4', licence: 'MIT', url: 'https://github.com/TanStack/query', use: 'Keeping the cache between visits' },
  { package: '@tanstack/query-async-storage-persister', name: 'TanStack Query Async Storage Persister', version: '5.104.4', licence: 'MIT', url: 'https://github.com/TanStack/query', use: 'Keeping the cache between visits' },
  { package: '@tanstack/react-virtual', name: 'TanStack Virtual', version: '3.14.21', licence: 'MIT', url: 'https://github.com/TanStack/virtual', use: 'Long lists' },
  { package: 'hls.js', name: 'hls.js', version: '1.7.3', licence: 'Apache-2.0', url: 'https://github.com/video-dev/hls.js', use: 'Playing HLS streams' },
  { package: 'idb-keyval', name: 'idb-keyval', version: '6.3.0', licence: 'Apache-2.0', url: 'https://github.com/jakearchibald/idb-keyval', use: 'Storing the cache and the guide' },
  { package: 'qrcode-generator', name: 'qrcode-generator', version: '2.0.4', licence: 'MIT', url: 'https://github.com/kazuhikoarase/qrcode-generator', use: 'The pairing code for Sync' },
  { package: 'jassub', name: 'JASSUB', version: '2.5.18', licence: 'LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0', url: 'https://github.com/ThaUnknown/jassub', use: 'Drawing ASS subtitles: libass and its libraries, as WebAssembly' },
]

/** The typefaces Flow can be set in, each with the licence file served beside it (public/fonts). */
export const typefaces: { name: string; file: string }[] = [
  { name: 'Barlow Condensed', file: 'OFL-Barlow-Condensed.txt' },
  { name: 'Geist', file: 'OFL-Geist.txt' },
  { name: 'Inter', file: 'OFL-Inter.txt' },
  { name: 'Ioskeley Mono', file: 'OFL-Ioskeley-Mono.txt' },
  { name: 'Manrope', file: 'OFL-Manrope.txt' },
]

/** FFmpeg's decoders, as the LGPL asks them to be offered: what it is, where the source is, and how to swap it. */
export const ffmpeg = {
  version: '7.1.1',
  source: 'https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz',
  home: 'https://ffmpeg.org',
  /** The notice that ships with the module, and the script that builds it from the release above. */
  notice: 'https://github.com/avinashgazula/Flow/tree/main/web/src/lib/audio/pkg',
  script: 'https://github.com/avinashgazula/Flow/blob/main/web/scripts/build-audio-decoders.sh',
}
