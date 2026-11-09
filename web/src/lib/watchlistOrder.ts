/* A watchlist in the order the viewer arranged it, as FlowKit's WatchlistOrder. The list itself is what the viewer
   saved and when; the order they see it in is kept beside it and laid over whatever the list holds. Keys are the
   library's own, "movie:693134". Pure, so the rules are tested without a browser. */

/** `keys` with the saved order laid over them: saved keys still on the list come first, in the saved order;
 *  anything newer follows in the list's own order. A key saved twice counts once. */
export function applying(saved: readonly string[], keys: readonly string[]): string[] {
  const present = new Set(keys)
  const seen = new Set<string>()
  const ordered = saved.filter((k) => present.has(k) && !seen.has(k) && !!seen.add(k))
  return [...ordered, ...keys.filter((k) => !seen.has(k) && !!seen.add(k))]
}

/** `keys` with `moved` (in the order given) taken out and put back just before `target`, or at the end when
 *  `target` is missing or is itself being moved. Keys not in the list are ignored. */
export function moving(moved: readonly string[], target: string | undefined, keys: readonly string[]): string[] {
  const out = new Set(moved)
  const carried = moved.filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !out.has(k))
  const at = target === undefined ? -1 : rest.indexOf(target)
  if (at < 0) return [...rest, ...carried]
  return [...rest.slice(0, at), ...carried, ...rest.slice(at)]
}

/** One key a step earlier (`-1`) or later (`1`), for the keyboard. The ends stay put, and so does a key that is
 *  not on the list. */
export function shifting(key: string, step: -1 | 1, keys: readonly string[]): string[] {
  const at = keys.indexOf(key)
  const to = at + step
  if (at < 0 || to < 0 || to >= keys.length) return [...keys]
  // Earlier lands before the one above it; later lands before the one two below (or the end).
  return moving([key], step < 0 ? keys[to] : keys[to + 1], keys)
}
