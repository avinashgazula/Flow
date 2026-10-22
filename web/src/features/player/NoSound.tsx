import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { browserCapabilities, type Source } from '../../lib/sources'
import { useSettings } from '../../lib/store/settings'
import { keepFocus } from './Controls'
import { type PlayerController, usePlayer } from './controller'
import { audioVerdict, silentAudioNames } from './silence'
import s from './Controls.module.css'

/** For a file Flow could only hand to the browser's own player: watches for the picture playing
 *  with no audio decoded, and when it sees that says so and offers a source that will have sound.
 *  It reads the element on `timeupdate` into refs and re-renders once, when it decides.
 *  `conversionFailed` is the other way to end up here: Flow was converting the audio and gave up, so
 *  there is nothing to watch for. The notice says so at once, with the same two ways forward. */
export function NoSoundNotice({ controller, source, conversionFailed = false, onSilent, onTryAnother, onShowing }: { controller: PlayerController; source: Source | null; conversionFailed?: boolean; onSilent: () => void; onTryAnother: () => void; onShowing?: (showing: boolean) => void }) {
  const [silent, setSilent] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // This notice only shows for the browser's own player, which the remuxer falls back to after the
  // proxy (if there is one) was tried. So with a proxy set, the proxy is what didn't work.
  const proxySet = useSettings((x) => x.streamProxy.trim() !== '')
  // Why the proxy couldn't open the file, as the remuxer worded it: the host that refused and what it said.
  const proxyError = usePlayer(controller, (st) => st.proxyError)

  useEffect(() => {
    if (conversionFailed) onSilent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversionFailed])

  useEffect(() => {
    const video = controller.video
    if (!video || conversionFailed) return
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

  const shown = (silent || conversionFailed) && !dismissed
  // Other notices wait while this one is up.
  useEffect(() => {
    onShowing?.(shown)
    return () => onShowing?.(false)
  }, [shown, onShowing])
  if (!shown) return null
  const names = silentAudioNames(source?.audio, browserCapabilities())
  return (
    <aside className={s.noSound} aria-label="No sound" role="status">
      <h2 className={s.noSoundTitle}>
        <Icon name="mute" size={18} strokeWidth={2.2} /> {conversionFailed ? 'Couldn’t Convert the Audio' : 'No Sound in This Browser'}
      </h2>
      <p className={s.noSoundText}>
        {conversionFailed
          ? `This file’s audio${names.length > 0 ? ` (${names.join(' and ')})` : ''} can’t play in a web browser, and Flow couldn’t convert it, so the picture is playing without sound.`
          : `This file’s audio${names.length > 0 ? ` (${names.join(' and ')})` : ''} can’t play in a web browser, and its host doesn’t let Flow convert it.`}
      </p>
      {!conversionFailed && proxySet && proxyError && (
        <p className={s.noSoundReason}>
          <strong>Your stream proxy couldn’t open this file.</strong> {proxyError}
        </p>
      )}
      <div className={s.noSoundActions}>
        <button className="btn btn-primary btn-compact" onClick={onTryAnother} onMouseDown={keepFocus}>
          Try Another Source
        </button>
        <button className="btn btn-quiet btn-compact" onClick={() => setDismissed(true)} onMouseDown={keepFocus}>
          Keep Watching
        </button>
      </div>
      {!conversionFailed && (
        <p className={s.noSoundHint}>
          {proxySet ? (
            <>
              {proxyError ? 'Check the proxy in' : 'Your stream proxy couldn’t reach this file. Check its address in'}{' '}
              <Link to="/settings" hash="playback">
                Settings → Playback
              </Link>
              .
            </>
          ) : browserCapabilities().convertAudio ? (
            <>
              Add a stream proxy in{' '}
              <Link to="/settings" hash="playback">
                Settings → Playback
              </Link>{' '}
              and Flow can convert this audio.
            </>
          ) : (
            <>
              A stream proxy, added in{' '}
              <Link to="/settings" hash="playback">
                Settings → Playback
              </Link>
              , lets Flow pick an audio track this browser can play, if the file has one.
            </>
          )}
        </p>
      )}
    </aside>
  )
}
