import { chordStep, goTarget, isTyping } from './shortcuts'
import { settingsStore } from '../../lib/store/settings'

/* The page-wide keys: G then a letter to go somewhere, `/` or Ctrl/Command K for Search, `?` for the list. Nothing fires
   in a field, with a modifier held (the browser's own), or under an open dialog or menu. In the player and full-screen
   Live TV, which have keys of their own, only `?` is heard. Root loads this after the first paint (a person can't press
   a key faster), so the first page carries none of it. */

export interface ShortcutContext {
  go: (to: { to: string; search?: Record<string, string> }) => void
  path: string
  help: () => void
}

/** Starts listening; `context` is read on every key, so it always reflects the page now. Returns how to stop. */
export function installShortcuts(context: () => ShortcutContext): () => void {
  let armedAt = 0
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat) return
    const { go, path, help } = context()
    // The player and full-screen Live TV (?play=) have keys of their own.
    const playing = path.startsWith('/watch') || (path === '/live' && /[?&]play=/.test(location.search))
    if (isTyping(e.target as HTMLElement | null)) return
    // Search: Ctrl or Command K, from anywhere but its own page, which already has it.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      if (playing || path === '/search') return
      e.preventDefault()
      go({ to: '/search' })
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '?') {
      e.preventDefault()
      help()
      return
    }
    // A menu, sheet or the source picker owns the keys while it is open.
    if (playing || document.querySelector('[role="menu"], dialog[open], [aria-modal="true"]')) return
    if (e.key === '/' && path !== '/search') {
      e.preventDefault()
      go({ to: '/search' })
      return
    }
    if (e.key.length !== 1) return
    const step = chordStep(armedAt, e.key, Date.now())
    armedAt = step.armedAt
    if (!step.finished) return
    const target = goTarget(step.finished, settingsStore.get().tabOrder)
    if (!target) return
    e.preventDefault()
    go(target)
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
