import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { browserCapabilities, type Source } from '../../lib/sources'
import { keepFocus } from './Controls'
import type { PlayerController } from './controller'
import { audioVerdict, silentAudioNames } from './silence'
import s from './Controls.module.css'

/** For a file Flow could only hand to the browser's own player: watches for the picture playing
 *  with no audio decoded, and when it sees that says so and offers a source that will have sound.
 *  It reads the element on `timeupdate` into refs and re-renders once, when it decides. */
export function NoSoundNotice({ controller, source, onSilent, onTryAnother }: { controller: PlayerController; source: Source | null; onSilent: () => void; onTryAnother: () => void }) {
  const [silent, setSilent] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const video = controller.video
    if (!video) return
    let played = 0
    let last = video.currentTime
    const check = () => {
      // Only time spent playing counts: a pause, a seek or a stall says nothing about the decoder.
      const now = video.currentTime
      if (!video.paused && !video.seeking && now > last && now - last < 2) played += now - last
      last = now
      const verdict = audioVerdict(video, played)
      if (!verdict) return
      video.removeEventListener('timeupdate', check)
      if (verdict === 'silent') {
        setSilent(true)
        onSilent()
      }
    }
    video.addEventListener('timeupdate', check)
    return () => video.removeEventListener('timeupdate', check)
    // The callback only forgets the source; it needn't restart the watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller])

  const shown = silent && !dismissed
  if (!shown) return null
  const names = silentAudioNames(source?.audio, browserCapabilities())
  return (
    <aside className={s.noSound} aria-label="No sound" role="status">
      <h2 className={s.noSoundTitle}>
        <Icon name="mute" size={18} strokeWidth={2.2} /> No Sound in This Browser
      </h2>
      <p className={s.noSoundText}>
        This file’s audio{names.length > 0 ? ` (${names.join(' and ')})` : ''} can’t play in a web browser, and its host doesn’t let Flow convert it.
      </p>
      <div className={s.noSoundActions}>
        <button className="btn btn-primary btn-compact" onClick={onTryAnother} onMouseDown={keepFocus}>
          Try Another Source
        </button>
        <button className="btn btn-glass btn-compact" onClick={() => setDismissed(true)} onMouseDown={keepFocus}>
          Keep Watching
        </button>
      </div>
      <p className={s.noSoundHint}>A stream proxy in AIOStreams (MediaFlow Proxy or StremThru) lets Flow pick an audio track this browser can play, if the file has one.</p>
    </aside>
  )
}
