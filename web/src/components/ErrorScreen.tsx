import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useState } from 'react'
import { Icon } from './Icon'
import s from './ErrorScreen.module.css'

/** What a screen shows when it breaks: a plain explanation, ways out, and the details that let
 *  someone fix it, copyable in one tap. */
export function ErrorScreen({ error, reset, info }: ErrorComponentProps) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const err = error instanceof Error ? error : new Error(String(error))
  const details = [
    `${err.name}: ${err.message}`,
    `Page: ${location.href}`,
    `Browser: ${navigator.userAgent}`,
    `Build: ${import.meta.env.VITE_BUILD ?? 'local'}`,
    '',
    err.stack ?? '',
    info?.componentStack ? `\nComponents:${info.componentStack}` : '',
  ].join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(details)
      setCopied(true)
    } catch {
      // Clipboard needs https: the details stay selectable below instead.
    }
  }

  return (
    <div className={s.screen} role="alert">
      <div className={s.card}>
        <span className={s.icon}>
          <Icon name="warning" size={26} strokeWidth={2} />
        </span>
        <h1 className={s.title}>Something Went Wrong</h1>
        <p className={s.lede}>This screen hit a problem. Try again, or go back. If it keeps happening, copy the details and send them along.</p>
        <div className={s.actions}>
          <button
            className="btn btn-primary"
            onClick={() => {
              reset()
              void router.invalidate()
            }}
          >
            Try Again
          </button>
          <button className="btn btn-glass" onClick={() => (history.length > 1 ? router.history.back() : void router.navigate({ to: '/' }))}>
            Go Back
          </button>
        </div>
        <details className={s.details}>
          <summary>Details</summary>
          <pre>{details}</pre>
          <button className="btn btn-glass btn-compact" onClick={copy}>
            <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy Details'}
          </button>
        </details>
      </div>
    </div>
  )
}
