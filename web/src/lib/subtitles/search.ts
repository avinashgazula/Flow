/* Asking every service at once, and putting the answers in the order the apps do (FlowKit's SubtitleSearch):
   the viewer's languages in the order they chose them, then the kind they prefer (standard or SDH),
   then the most downloaded. A service that fails doesn't spoil the others: it is reported beside them. */

import { languageKey } from './names'
import { usableProviders } from './options'
import { providers, type Io } from './providers'
import { providerNames, SubtitleError, type Credentials, type Fetch, type ProviderId, type SubtitleFailure, type SubtitleQuery, type SubtitleResult } from './types'

export interface ProviderOutcome {
  provider: ProviderId
  count: number
  /** Words for the viewer when the service couldn't answer. */
  error?: string
  kind?: SubtitleFailure
}

export interface SearchOutcome {
  results: SubtitleResult[]
  outcomes: ProviderOutcome[]
}

/** Preferred languages first (in the order given), then the preferred kind, then the most downloaded. */
export function rankResults(results: SubtitleResult[], languages: string[], preferSDH: boolean): SubtitleResult[] {
  const order = new Map<string, number>()
  languages.forEach((code, i) => {
    const key = languageKey(code)
    if (!order.has(key)) order.set(key, i)
  })
  const place = (r: SubtitleResult) => order.get(languageKey(r.language)) ?? 99
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const la = place(a.r)
      const lb = place(b.r)
      if (la !== lb) return la - lb
      if (a.r.hearingImpaired !== b.r.hearingImpaired) return a.r.hearingImpaired === preferSDH ? -1 : 1
      const da = a.r.downloads ?? 0
      const db = b.r.downloads ?? 0
      if (da !== db) return db - da
      return a.i - b.i
    })
    .map((x) => x.r)
}

/** Services that said a web page can't read them, so a second search this visit doesn't ask again. */
const refused = new Map<ProviderId, string>()
export const forgetRefused = () => refused.clear()

/** The promise's answer, or a failure if it takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SubtitleError('took too long to answer', 'network')), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

export interface SearchOptions {
  fetch?: Fetch
  signal?: AbortSignal
  /** Services to ask; the default is all that are usable. */
  enabled?: readonly ProviderId[]
  /** Prefer SDH subtitles over standard ones (Settings → Subtitle Type). */
  preferSDH?: boolean
  timeoutMs?: number
  /** Told as each service answers or fails, so a screen can show who is still being waited for. */
  onProgress?: (outcome: ProviderOutcome) => void
}

export async function searchSubtitles(query: SubtitleQuery, credentials: Credentials, options: SearchOptions = {}): Promise<SearchOutcome> {
  const io: Io = { fetch: options.fetch ?? ((url, init) => fetch(url, init)), signal: options.signal }
  const asked = usableProviders(credentials, options.enabled)
  const outcomes = await Promise.all(
    asked.map(async (id): Promise<{ outcome: ProviderOutcome; results: SubtitleResult[] }> => {
      const done = (outcome: ProviderOutcome, results: SubtitleResult[]) => {
        options.onProgress?.(outcome)
        return { outcome, results }
      }
      const known = refused.get(id)
      if (known) return done({ provider: id, count: 0, error: known, kind: 'blocked' }, [])
      try {
        const results = await within(providers[id].search(query, credentials, io), options.timeoutMs ?? 15000)
        return done({ provider: id, count: results.length }, results)
      } catch (error) {
        if (options.signal?.aborted) throw error
        const e = error instanceof SubtitleError ? error : new SubtitleError(`${providerNames[id]} ${(error as Error)?.message ?? 'didn’t answer'}.`, 'network')
        if (e.kind === 'blocked') refused.set(id, e.message)
        return done({ provider: id, count: 0, error: e.message, kind: e.kind }, [])
      }
    }),
  )
  const seen = new Set<string>()
  const all = outcomes.flatMap((o) => o.results).filter((r) => !seen.has(r.id) && !!seen.add(r.id))
  return { results: rankResults(all, query.languages, options.preferSDH ?? false), outcomes: outcomes.map((o) => o.outcome) }
}
