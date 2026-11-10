/* A setup or a sync pairing opened by address: `<site>/#setup=<payload>` or `<site>/#sync=k=…&s=…&t=…`, and the forms the
   apps share (`flow://setup?d=…`, `flow://sync?…`) when they are put after the `#`. A browser can't open `flow://`, and the
   fragment never reaches a server, so the web form is the one a link can carry. The page reads it once at start, takes it
   out of the address (so the key isn't left in the bar or the history), and hands it to whoever shows it: Welcome when
   nothing is set up yet, otherwise Settings → Data. */

export type HashLink = { kind: 'setup'; link: string } | { kind: 'sync'; link: string }

/** What the address's fragment holds, if it is one of these links. `link` is in the form each reader already takes:
 *  `flow://setup?d=<payload>` for the setup review, and a pairing link or fragment for Join a Sync. */
export function parseHashLink(hash: string): HashLink | undefined {
  const raw = hash.replace(/^#/, '')
  const sync = /^(?:sync=|flow:\/\/sync\b|flow%3A%2F%2Fsync)/i.exec(raw)
  if (sync) {
    const rest = raw.slice(sync[0].startsWith('sync=') ? 5 : 0)
    if (!rest.trim()) return undefined
    // A link with its own scheme is read as the apps' form; bare parameters keep the fragment's.
    const whole = /^flow%3A/i.test(rest) ? safeDecode(rest) : /^flow:/i.test(rest) ? rest : `sync=${rest}`
    return { kind: 'sync', link: whole }
  }
  const setup = /^(?:setup=|flow:\/\/setup\b|flow%3A%2F%2Fsetup)/i.exec(raw)
  if (!setup) return undefined
  let rest = raw.slice(setup[0].startsWith('setup=') ? 6 : 0)
  if (rest.includes('%')) rest = safeDecode(rest)
  const payload = /[?&]d=([^&\s]+)/.exec(rest)?.[1] ?? (rest.startsWith('d=') ? rest.slice(2) : /^flow:\/\//i.test(rest) ? '' : rest)
  const clean = payload.trim()
  return clean ? { kind: 'setup', link: `flow://setup?d=${clean}` } : undefined
}

const safeDecode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

let pending: HashLink | undefined

/** Reads the address's fragment once, at start, before the router does. A link is kept for `takeLink`. Where Welcome has
 *  nothing to ask for any more (`ready`), the address becomes Settings → Data, where the setup review and Join This Sync? live;
 *  otherwise Welcome is what opens, with the link in it, wherever the link was opened. */
export function arriveFromHashLink(ready: boolean) {
  if (typeof location === 'undefined') return
  const link = parseHashLink(location.hash)
  if (!link) return
  pending = link
  const base = import.meta.env.BASE_URL
  const settings = location.pathname.startsWith(`${base}settings`)
  const to = settings ? `${location.pathname}#data` : ready ? `${base}settings#data` : `${location.pathname}${location.search}`
  history.replaceState(history.state, '', to)
}

/** The link that arrived, without taking it. */
export const peekLink = () => pending

/** The link that arrived, if it is a `kind`, and forget it: whoever shows it owns it from here. */
export function takeLink(kind: HashLink['kind']): string | undefined {
  const link = pending?.kind === kind ? pending.link : undefined
  if (link) pending = undefined
  return link
}
