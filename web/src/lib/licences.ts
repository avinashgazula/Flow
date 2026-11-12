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
  { package: '@fontsource/archivo', name: 'Archivo (fontsource)', version: '5.3.0', licence: 'OFL-1.1', url: 'https://github.com/fontsource/font-files', use: 'The page titles' },
  { package: '@fontsource/ibm-plex-mono', name: 'IBM Plex Mono (fontsource)', version: '5.3.0', licence: 'OFL-1.1', url: 'https://github.com/fontsource/font-files', use: 'Interface text and labels' },
  { package: '@fontsource/ibm-plex-sans-condensed', name: 'IBM Plex Sans Condensed (fontsource)', version: '5.3.0', licence: 'OFL-1.1', url: 'https://github.com/fontsource/font-files', use: 'Headings and titles in lists' },
  { package: '@fontsource/ibm-plex-serif', name: 'IBM Plex Serif (fontsource)', version: '5.3.0', licence: 'OFL-1.1', url: 'https://github.com/fontsource/font-files', use: 'Reading text' },
  { package: 'onnxruntime-web', name: 'ONNX Runtime Web', version: '1.31.1', licence: 'MIT', url: 'https://github.com/microsoft/onnxruntime', use: 'Running the face models in X-Ray, as WebAssembly' },
  { package: 'simple-icons', name: 'Simple Icons', version: '16.37.0', licence: 'CC0-1.0', url: 'https://github.com/simple-icons/simple-icons', use: 'The marks beside each rating on a title page' },
  { package: 'lucide-react', name: 'Lucide', version: '1.72.0', licence: 'ISC', url: 'https://github.com/lucide-icons/lucide', use: 'The icons in the player' },
  { package: 'jassub', name: 'JASSUB', version: '2.5.18', licence: 'LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0', url: 'https://github.com/ThaUnknown/jassub', use: 'Drawing ASS subtitles: libass and its libraries, as WebAssembly' },
]

/** The two neural networks behind X-Ray's face recognition, each served from the site's own files. `sha256` is the file as shipped;
 *  web/scripts/prepare-face-models.py makes it from the OpenCV Zoo's original. */
export interface Model {
  name: string
  licence: string
  /** The licence text served beside the site (public/licences). */
  file: string
  url: string
  use: string
  /** The shipped file under src/features/player/xray/faces/models, and its SHA-256. */
  shipped: string
  sha256: string
}

export const models: Model[] = [
  {
    name: 'YuNet',
    licence: 'MIT',
    file: 'MIT-YuNet.txt',
    url: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet',
    use: 'Finding the faces in a frame (face_detection_yunet_2026may.onnx, unchanged), by Shiqi Yu and the libfacedetection authors',
    shipped: 'yunet.onnx',
    sha256: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
  },
  {
    name: 'SFace',
    licence: 'Apache-2.0',
    file: 'Apache-2.0-SFace.txt',
    url: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface',
    use: 'Making a print of a face to compare with the cast’s (face_recognition_sface_2021dec_int8bq.onnx with its unused weight inputs removed), by Yaoyao Zhong and the OpenCV Zoo contributors',
    shipped: 'sface-int8.onnx',
    sha256: '487a139eb85ccd5ff30aef7d0add7f12d2bb7abb90c5f08a7f481b452a660e00',
  },
]

/** The typefaces Marquee is set in, each with the licence file served beside it (public/fonts). */
export const typefaces: { name: string; file: string }[] = [
  { name: 'Archivo', file: 'OFL-Archivo.txt' },
  { name: 'IBM Plex Mono', file: 'OFL-Plex-Mono.txt' },
  { name: 'IBM Plex Sans Condensed', file: 'OFL-Plex-Sans-Condensed.txt' },
  { name: 'IBM Plex Serif', file: 'OFL-Plex-Serif.txt' },
]

/** The commit this build came from, so the links below show the exact build script and notice that made it; a local
 *  build has none and links the working branch instead. */
const ref = import.meta.env.VITE_BUILD && import.meta.env.VITE_BUILD !== 'local' ? import.meta.env.VITE_BUILD : 'claude/build-flow-app'

/** FFmpeg's two WebAssembly modules, as the LGPL asks them to be offered: what it is, where the source is, and how to swap them. */
export const ffmpeg = {
  version: '7.1.1',
  source: 'https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz',
  home: 'https://ffmpeg.org',
  /** The notice that ships with the module, and the script that builds it from the release above. */
  notice: `https://github.com/avinashgazula/Flow/tree/${ref}/web/src/lib/audio/pkg`,
  script: `https://github.com/avinashgazula/Flow/blob/${ref}/web/scripts/build-audio-decoders.sh`,
  /** The universal media engine: demuxers, the MP4 muxer, the decoders and the FLAC and AAC encoders (flow-media.wasm). */
  mediaNotice: `https://github.com/avinashgazula/Flow/tree/${ref}/web/src/lib/media/pkg`,
  mediaScript: `https://github.com/avinashgazula/Flow/blob/${ref}/web/scripts/build-media-engine.sh`,
}
