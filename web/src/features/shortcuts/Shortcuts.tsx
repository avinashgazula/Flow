import { useEffect, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { useSettings } from '../../lib/store/settings'
import { orderTabs } from '../../lib/tabs'
import { isMac, shortcutGroups, type Combo } from './shortcutList'
import s from './Shortcuts.module.css'

/* The keyboard shortcuts sheet, opened by ? from anywhere. A native modal dialog, so the browser traps focus in it and
   keeps the page behind it still; Escape and the Close button put focus back where it was. It loads when first asked
   for. The player listens on the whole window, so while the sheet is open the keys stay with the sheet. */

function Keys({ combo }: { combo: Combo }) {
  return (
    <span className={s.combo}>
      {combo.keys.map((key, i) => (
        <span key={key} className={s.part}>
          {i > 0 && combo.then && <span className={s.then}>then</span>}
          <kbd className={s.key}>{key}</kbd>
        </span>
      ))}
    </span>
  )
}

export default function Shortcuts({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const saved = useSettings((x) => x.tabOrder)
  const groups = shortcutGroups(isMac(), orderTabs(saved))

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    const previous = document.activeElement as HTMLElement | null
    el.showModal()
    // Escape is the sheet's own: the player behind it would otherwise leave the film on the same press.
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key !== 'Tab') e.stopPropagation()
    }
    window.addEventListener('keydown', keys, true)
    return () => {
      window.removeEventListener('keydown', keys, true)
      el.close()
      previous?.focus?.({ preventScroll: true })
    }
  }, [onClose])

  return (
    <dialog ref={dialog} className={s.sheet} aria-labelledby="shortcuts-title" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      <div className={s.head}>
        <h2 id="shortcuts-title" className={s.title}>
          Keyboard Shortcuts
        </h2>
        <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} strokeWidth={2.4} />
        </button>
      </div>
      <div className={s.body}>
        {groups.map((group) => (
          <section key={group.title} className={s.group} aria-labelledby={`sc-${group.title}`}>
            <h3 id={`sc-${group.title}`} className={s.groupTitle}>
              {group.title}
            </h3>
            <dl className={s.rows}>
              {group.rows.map((row) => (
                <div key={row.label} className={s.row}>
                  <dt className={s.label}>{row.label}</dt>
                  <dd className={s.keys}>
                    {row.combos.map((combo, i) => (
                      <span key={combo.keys.join()} className={s.alt}>
                        {i > 0 && <span className={s.or}>or</span>}
                        <Keys combo={combo} />
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className={s.foot}>Shortcuts never fire while you are typing in a field.</p>
    </dialog>
  )
}
