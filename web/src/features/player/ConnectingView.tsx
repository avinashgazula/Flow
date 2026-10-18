import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { imageURL, srcSet } from '../../lib/tmdb/images'
import { keepFocus } from './Controls'
import { clock } from './format'
import s from './Player.module.css'

const slowAfter = 15_000

/** While a stream opens: the title's backdrop, dimmed and slowly pushing in like a camera settling
 *  on the first shot, with the title, the episode, a hairline that fills as it buffers, and where
 *  it's coming from. Offers Resume when there's somewhere to resume from. After the native
 *  ConnectingView. */
export function ConnectingView({ backdrop, logo, title, line, provider, sourceKey, progress, resumeAt, leaving, onResume, onStartOver, onTryAnother, onClose, onGone }: {
  backdrop?: string
  logo?: string
  title: string
  line?: string
  /** Undefined while there's no source yet (finding or picking one). */
  provider?: string
  sourceKey?: string
  /** 0–1 as the stream opens, 'idle' while looking for a source, undefined for no hairline. */
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

  return (
    <div className={s.connecting} data-leaving={leaving ? '' : undefined} onTransitionEnd={(e) => leaving && e.target === e.currentTarget && onGone()}>
      {backdrop && (
        <img
          className={s.connectingArt}
          src={imageURL(backdrop, 1280)}
          srcSet={srcSet(backdrop, 'backdrop')}
          sizes="100vw"
          alt=""
          fetchPriority="high"
          onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
          ref={(img) => {
            if (img?.complete && img.naturalWidth) img.setAttribute('data-loaded', '')
          }}
        />
      )}
      <div className={s.connectingShade} />
      <div className={s.connectingBody}>
        <div className={s.connectingCentre}>
          {logo ? <img className={s.connectingLogo} src={imageURL(logo, 500)} alt={title} /> : <h1 className={s.connectingTitle}>{title}</h1>}
          {line && <p className={s.connectingLine}>{line}</p>}
          {resumeAt === null && typeof progress === 'number' && (
            <div className={s.hairline} role="progressbar" aria-label="Loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ transform: `scaleX(${Math.max(0.04, Math.min(1, progress))})` }} />
            </div>
          )}
          {resumeAt === null && progress === 'idle' && <div className={s.hairlineIdle} role="progressbar" aria-label="Loading" />}
        </div>
        <div className={s.connectingFoot}>
          {resumeAt !== null ? (
            <div className={s.resume}>
              <button className="btn btn-primary" onClick={onResume} autoFocus>
                <Icon name="play" size={18} /> Resume from {clock(resumeAt)}
              </button>
              <button className="btn btn-glass" onClick={onStartOver} onMouseDown={keepFocus}>
                <Icon name="history" size={18} /> Start Over
              </button>
            </div>
          ) : (
            <>
              {slow && (
                <>
                  <p className={s.slow}>This is taking longer than usual.</p>
                  {onTryAnother && (
                    <button className="btn btn-glass btn-compact" onClick={onTryAnother}>
                      Try Another Source
                    </button>
                  )}
                </>
              )}
              {provider && <p className={s.from}>From {provider}</p>}
            </>
          )}
        </div>
      </div>
      <button className={`btn btn-glass btn-circle ${s.connectingClose}`} onClick={onClose} aria-label="Close Player">
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
        <button className="btn btn-glass" onClick={onRetry} autoFocus={!canTryAnother}>
          Try Again
        </button>
        <button className="btn btn-glass" onClick={onClose}>
          Back
        </button>
      </div>
      {detail && <p className={s.errorDetail}>{detail}</p>}
    </div>
  )
}
