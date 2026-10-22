import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { browserCapabilities, type Source } from '../../lib/sources'
import { isHDR } from '../../lib/sources/smooth'
import { keepFocus } from './Controls'
import { type PlayerController, usePlayer } from './controller'
import { codecName } from './format'
import { bufferAhead, megabits } from './struggle'
import s from './Controls.module.css'

type Row = [label: string, value: string]

const dash = '—'

const engineNames = { remux: 'Matroska remux', hls: 'HLS in hls.js', native: 'Browser’s own player' } as const

/** What the device said about decoding this kind of video (smooth.ts), in a few words. */
function decodingWords(source: Source | null): string {
  const answer = source && browserCapabilities().smoothVideo(source.videoCodec, source.resolution, isHDR(source.hdr))
  if (!answer) return dash
  if (!answer.smooth) return 'May stutter'
  return answer.powerEfficient ? 'Smooth and efficient' : 'Smooth, in software'
}

/** The rows of the card, read from the element and the engine. */
export function readInfo(controller: PlayerController, source: Source | null, audio: { label?: string; converted?: boolean; note?: string } | undefined): Row[] {
  const video = controller.video
  const engine = controller.engine
  const quality = video?.getVideoPlaybackQuality?.()
  const net = engine?.netStats?.() ?? null
  const info = engine?.videoInfo?.()
  const codec = source?.videoCodec ?? codecName(info?.codec)
  const range = info?.range && info.range !== 'SDR' ? info.range : source?.hdr?.length ? source.hdr.join(' · ') : undefined
  const frames = quality ? `${quality.droppedVideoFrames.toLocaleString()} / ${quality.totalVideoFrames.toLocaleString()}${quality.totalVideoFrames > 0 ? ` (${((quality.droppedVideoFrames / quality.totalVideoFrames) * 100).toFixed(1)}%)` : ''}` : dash
  const audioCodec = source?.audio?.[0] ?? audio?.label
  const engineName = engine ? (engine.fallback === 'blocked' ? 'Browser’s own player, host blocks web pages' : engineNames[engine.kind]) : dash
  return [
    ['Resolution', video && video.videoWidth > 0 ? `${video.videoWidth}×${video.videoHeight}` : dash],
    ['Video', [codec, range].filter(Boolean).join(' · ') || dash],
    ['Decoding', decodingWords(source)],
    ['Engine', engine?.viaProxy ? `${engineName} · via stream proxy` : engineName],
    ['Dropped Frames', frames],
    ['Buffer Ahead', video ? `${bufferAhead(video).toFixed(1)} s` : dash],
    ['Download', net && net.bytesPerSecond > 0 ? megabits(net.bytesPerSecond) : dash],
    ['File Bitrate', net && net.bitrate > 0 ? megabits(net.bitrate) : dash],
    ['Audio', audioCodec ? `${audioCodec} · ${audio?.converted ? audio.note ?? 'Converted' : 'Not converted'}` : dash],
  ]
}

/** A small glass card of what the player is doing, for working out why a film stutters: the
 *  picture's size, the codec, the engine, dropped frames, the buffer and the download. Opened with
 *  I or from Options, refreshed once a second, and left out of the way of the controls. */
export function PlaybackInfo({ controller, source }: { controller: PlayerController; source: Source | null }) {
  const audio = usePlayer(controller, (st) => st.audio)
  const audioId = usePlayer(controller, (st) => st.audioId)
  const track = audio.find((t) => t.id === audioId)
  const [rows, setRows] = useState<Row[]>(() => readInfo(controller, source, track))

  useEffect(() => {
    const tick = () => setRows(readInfo(controller, source, track))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [controller, source, track])

  return (
    <aside className={s.info} aria-label="Playback info">
      <header className={s.infoHeader}>
        <h2 className={s.infoTitle}>Playback Info</h2>
        <button className={s.infoClose} aria-label="Close Playback Info" title="Close (I)" onClick={controller.toggleInfo} onMouseDown={keepFocus}>
          <Icon name="close" size={14} strokeWidth={2.6} />
        </button>
      </header>
      <dl className={s.infoRows}>
        {rows.map(([label, value]) => (
          <div key={label} className={s.infoRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
