import { useEffect, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import { Icon } from '../../components/Icon'
import { imageURL } from '../../lib/tmdb/images'
import { keepFocus } from './Controls'
import { clock } from './format'
import s from './Player.module.css'

const slowAfter = 15_000
/** While a stream opens: the title's still as a plain rounded picture on the flat base, a thin progress line under it, and
 *  the title and the episode, with where the stream comes from and its format as a quiet line. The line fills as the
 *  stream buffers, and slides while there is nothing to measure yet. Offers Resume when there's somewhere to resume from.
 *  After the native ConnectingView. */
export function ConnectingView({ backdrop, logo, title, line, print, sourceKey, progress, resumeAt, leaving, onResume, onStartOver, onTryAnother, onClose, onGone }: {
  backdrop?: string
  logo?: string
  title: string
  line?: string
  /** Where it comes from, the format. Always at least one. */
  print: string[]
  sourceKey?: string
  /** 0–1 as the stream opens, 'idle' while looking for a source, undefined for none. */
  progress?: number | 'idle'
  resumeAt: number | null
  /** Playback has started: fade out, then `onGone`. */
  leaving: boolean
  onResume: () => void
  onStartOver: () => void
  onTryAnother?: () => void
  onClose: () => void
  onGone: () => void
}) {
  // Slow is per source: trying another one starts the fifteen seconds again.
  const [slowFor, setSlowFor] = useState<string>()
  useEffect(() => {
    if (!sourceKey || leaving) return
    const timer = setTimeout(() => setSlowFor(sourceKey), slowAfter)
    return () => clearTimeout(timer)
  }, [sourceKey, leaving])
  const slow = !!sourceKey && slowFor === sourceKey && resumeAt === null

  // With nothing to measure yet the line slides along (still, for Reduce Motion).
  const chasing = progress === 'idle' && resumeAt === null
  const filled = resumeAt !== null ? undefined : typeof progress === 'number' ? Math.max(0.04, Math.min(1, progress)) : undefined

  return (
    <div className={s.connecting} data-leaving={leaving ? '' : undefined} onTransitionEnd={(e) => leaving && e.target === e.currentTarget && onGone()}>
      <div className={s.connectingBody}>
        <div className={s.connectingCentre}>
          <div className={s.connectingFrame}>
            <Artwork className={s.connectingArt} path={backdrop} kind="backdrop" alt="" sizes="(max-width: 720px) 100vw, 560px" priority />
            {(filled !== undefined || chasing) && (
              <div
                className={s.connectingLine}
                data-idle={chasing ? '' : undefined}
                role="progressbar"
                aria-label="Loading"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={filled !== undefined && typeof progress === 'number' ? Math.round(progress * 100) : undefined}
              >
                <span style={filled !== undefined ? ({ '--filled': filled } as React.CSSProperties) : undefined} />
              </div>
            )}
          </div>
          {logo ? <img className={s.connectingLogo} src={imageURL(logo, 500)} alt={title} /> : <h1 className={s.connectingTitle}>{title}</h1>}
          {line && <p className={s.connectingSub}>{line}</p>}
          <p className={s.connectingFacts}>{print.join(' · ')}</p>
        </div>
        <div className={s.connectingFoot}>
          {resumeAt !== null ? (
            <div className={s.resume}>
              <button className="btn btn-primary" onClick={onResume} autoFocus>
                <Icon name="play" size={18} /> Resume from {clock(resumeAt)}
              </button>
              <button className="btn btn-secondary" onClick={onStartOver} onMouseDown={keepFocus}>
                <Icon name="history" size={18} /> Start Over
              </button>
            </div>
          ) : (
            slow && (
              <>
                <p className={s.slow}>This is taking longer than usual.</p>
                {onTryAnother && (
                  <button className="btn btn-secondary btn-compact" onClick={onTryAnother}>
                    Try Another Source
                  </button>
                )}
              </>
            )
          )}
        </div>
      </div>
      <button className={`btn btn-quiet btn-circle ${s.connectingClose}`} onClick={onClose} aria-label="Close Player">
        <Icon name="close" size={20} strokeWidth={2.4} />
      </button>
    </div>
  )
}

export function ErrorView({ message, detail, canTryAnother, onTryAnother, onRetry, onClose }: { message: string; detail?: string; canTryAnother: boolean; onTryAnother: () => void; onRetry: () => void; onClose: () => void }) {
  return (
    <div className={s.error} role="alertdialog" aria-labelledby="player-error-title" aria-describedby="player-error-message">
      <span className={s.errorIcon}>
        <Icon name="alert" size={36} strokeWidth={2.2} />
      </span>
      <h2 id="player-error-title" className={s.errorTitle}>
        Couldn’t Play
      </h2>
      <p id="player-error-message" className={s.errorMessage}>
        {message}
      </p>
      <div className={s.errorActions}>
        {canTryAnother && (
          <button className="btn btn-primary" onClick={onTryAnother} autoFocus>
            Try Another Source
          </button>
        )}
        <button className="btn btn-secondary" onClick={onRetry} autoFocus={!canTryAnother}>
          Try Again
        </button>
        <button className="btn btn-quiet" onClick={onClose}>
          Back
        </button>
      </div>
      {detail && <p className={s.errorDetail}>{detail}</p>}
    </div>
  )
}
