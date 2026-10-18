import type { Source } from '../../lib/sources'

/* Stand-in streams for sample data, when no add-on or server has anything for a title. They're
   public test streams, not the title itself, and say so wherever a source is named. Remove this
   file and its one call in PlayerScreen once sample data has sources of its own. */

const sampleSubtitles = `1
00:00:01,000 --> 00:00:05,500
<i>Sample subtitles</i>, drawn by Flow

2
00:00:06,000 --> 00:00:11,000
Loaded from an SRT file
and converted in the browser

3
00:00:12,000 --> 00:00:40,000
This is a sample stream, not the title you picked.
`

export function sampleSources(): Source[] {
  return [
    {
      id: 'sample:apple-bipbop-advanced',
      origin: 'demo',
      provider: 'Sample Stream',
      title: 'Apple HLS sample (not this title) · fMP4, subtitles',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
      engine: 'hls',
      resolution: '1080p',
      videoCodec: 'H.264',
      audio: ['AAC'],
      container: 'HLS',
    },
    {
      id: 'sample:apple-bipbop-16x9',
      origin: 'demo',
      provider: 'Sample Stream',
      title: 'Apple HLS sample (not this title) · two audio tracks, eight subtitles',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
      engine: 'hls',
      resolution: '1080p',
      videoCodec: 'H.264',
      audio: ['AAC'],
      container: 'HLS',
    },
    {
      id: 'sample:sintel-trailer-mp4',
      origin: 'demo',
      provider: 'Sample MP4',
      title: 'Sintel trailer (not this title) · MP4 with SRT subtitles',
      url: 'https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4',
      engine: 'native',
      resolution: '720p',
      videoCodec: 'H.264',
      audio: ['AAC'],
      container: 'MP4',
      subtitles: [{ url: `data:text/plain;charset=utf-8,${encodeURIComponent(sampleSubtitles)}`, language: 'en', label: 'English (SRT)', format: 'srt' }],
    },
  ]
}
