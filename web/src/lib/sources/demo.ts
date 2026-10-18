/* Sample-data sources, as FlowKit's DemoSourceProvider: AIOStreams-style rows that play Apple's public
   HLS samples, plus a small bundled MKV that shows the remuxer at work. Nothing needs an account. */

import type { Capabilities } from './capabilities'
import { parseStream } from './parser'
import { buildSource } from './rank'
import type { PlaybackRequest, Source } from './types'

export const demoProviderId = 'demo.aiostreams'
export const demoMatroskaId = 'demo#mkv'

/** Reachable everywhere and always playable. */
export const sampleStreams = [
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
]

export function matroskaSampleURL(): string {
  const path = `${import.meta.env.BASE_URL ?? '/'}samples/flow-sample.mkv`
  return typeof location === 'undefined' ? path : new URL(path, location.href).toString()
}

const pad = (n: number) => String(n).padStart(2, '0')

export async function demoSources(request: PlaybackRequest, caps: Capabilities, signal?: AbortSignal): Promise<Source[]> {
  // A short wait keeps the loading state honest, as in the apps.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 450)
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true })
  })
  const episode = request.type === 'show' ? `.S${pad(request.season ?? 1)}E${pad(request.episode ?? 1)}` : ''
  const name = `${request.item.title.replace(/[:'’]/g, '').replace(/\s+/g, '.')}${episode}`
  const rows: [text: string, filename: string, stream: number][] = [
    ['🧿 1080p 🎫\nWEB-DL\n🔊 AAC\n📦 3.98 GB\n🌎 English', `${name}.1080p.WEB-DL.AAC.H264.mkv`, 0],
    ['✨ 4K 🎫\nWEB-DL\nDV HDR10\n🔊 DD+ Atmos 5.1\n📦 18.2 GB\n🌎 English', `${name}.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.HEVC.mkv`, 0],
    ['🧿 1080p 🎫\nBluRay\n🔊 DTS-HD MA 7.1\n📦 12.4 GB\n🌎 English • Spanish', `${name}.1080p.BluRay.DTS-HD.MA.7.1.x264.mkv`, 1],
    ['🧿 720p\nWEBRip\n🔊 AAC 2.0\n📦 1.18 GB\n🌎 English • Hindi • Tamil', `${name}.720p.WEBRip.AAC.2.0.x264.mkv`, 1],
  ]
  const sources = rows.map(([text, filename, stream], index) => {
    const traits = parseStream(text, filename)
    traits.isCached = true
    // The sample streams are H.264 and AAC whatever the row says, so playability is judged on what
    // will actually play, while the badges still show the release the row stands for.
    const source = buildSource(
      {
        id: `demo#${index}`,
        origin: 'demo',
        provider: 'AIOStreams',
        providerId: demoProviderId,
        title: filename,
        url: sampleStreams[stream]!,
        container: 'm3u8',
        filename,
        detail: `AIOStreams\n${text}`,
        traits,
        bingeGroup: `demo-${index}`,
      },
      caps,
    )
    // The DTS row stays unplayable on purpose: it shows how the picker explains a source it can't play.
    if (source.unsupported && index !== 2) delete source.unsupported
    return source
  })
  const text = '🧿 720p\nMKV · remuxed in the browser\n🔊 DTS • AAC • AC-3\n🌎 English • Spanish'
  sources.push(
    buildSource(
      {
        id: demoMatroskaId,
        origin: 'demo',
        provider: 'AIOStreams',
        providerId: demoProviderId,
        title: 'Flow.Sample.720p.DTS.AAC.AC3.mkv',
        url: matroskaSampleURL(),
        container: 'mkv',
        filename: 'Flow.Sample.720p.DTS.AAC.AC3.mkv',
        detail: `AIOStreams\n${text}`,
        traits: parseStream(text, 'Flow.Sample.720p.mkv'),
      },
      caps,
    ),
  )
  return sources
}
