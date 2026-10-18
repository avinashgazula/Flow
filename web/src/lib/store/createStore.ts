import { useSyncExternalStore } from 'react'

/** A tiny persisted store: one localStorage key, synchronous reads, and per-selector subscriptions,
 *  so a change to the watchlist re-renders only the components that read the watchlist. */
export interface Store<T> {
  get(): T
  set(update: Partial<T> | ((state: T) => Partial<T>)): void
  subscribe(listener: () => void): () => void
}

export function createStore<T extends object>(key: string, initial: T, version = 1): Store<T> {
  const storageKey = `flow.${key}.v${version}`
  let state: T = { ...initial, ...read(storageKey) }
  const listeners = new Set<() => void>()
  let writeScheduled = false

  function persist() {
    if (writeScheduled) return
    writeScheduled = true
    // Coalesce bursts (progress ticks, several toggles) into one write after the frame.
    queueMicrotask(() => {
      writeScheduled = false
      try {
        localStorage.setItem(storageKey, JSON.stringify(state))
      } catch {
        // Private windows and full storage still work for the session.
      }
    })
  }

  if (typeof window !== 'undefined') {
    // Another tab changed it: follow along.
    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey) return
      state = { ...initial, ...read(storageKey) }
      listeners.forEach((l) => l())
    })
  }

  return {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update
      state = { ...state, ...patch }
      persist()
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function read<T>(key: string): Partial<T> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Partial<T>) : {}
  } catch {
    return {}
  }
}

export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()))
}
