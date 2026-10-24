/* The chapter names a Matroska file carries ("Opening", "Ending"), read from the first bytes the worker already
   has, so the player can mark an intro or the credits when no service knows the episode. The WebAssembly demuxer
   doesn't report chapters; this walks the EBML itself, which for the one element needed is a few dozen lines. It
   reads only what is in the bytes it is given: a file that keeps its chapters further in (rare; muxers put them
   ahead of the first cluster) simply has none here. Never throws. */

export interface MkvChapter {
  title: string
  /** Seconds. */
  start: number
}

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  cluster: 0x1f43b675,
  chapters: 0x1043a770,
  edition: 0x45b9,
  atom: 0xb6,
  timeStart: 0x91,
  flagEnabled: 0x4598,
  display: 0x80,
  string: 0x85,
} as const

/** An element's id (marker bits kept, as the spec writes them) and where its size begins. */
function readId(bytes: Uint8Array, at: number): { id: number; next: number } | undefined {
  const first = bytes[at]
  if (first === undefined || first === 0) return undefined
  const length = Math.clz32(first) - 23
  if (length > 4 || at + length > bytes.length) return undefined
  let id = 0
  for (let i = 0; i < length; i++) id = id * 256 + bytes[at + i]!
  return { id, next: at + length }
}

/** An element's size, and where its data begins; `size` is null when it is unknown (all ones). */
function readSize(bytes: Uint8Array, at: number): { size: number | null; next: number } | undefined {
  const first = bytes[at]
  if (first === undefined || first === 0) return undefined
  const length = Math.clz32(first) - 23
  if (length > 8 || at + length > bytes.length) return undefined
  const marker = 0xff >> length
  let value = first & marker
  let allOnes = value === marker
  for (let i = 1; i < length; i++) {
    const b = bytes[at + i]!
    if (b !== 0xff) allOnes = false
    value = value * 256 + b
  }
  return { size: allOnes ? null : value, next: at + length }
}

interface Child {
  id: number
  start: number
  end: number
}

/** The children of the element whose data is bytes[start, end). Stops at one that doesn't fit. */
function* children(bytes: Uint8Array, start: number, end: number): Generator<Child> {
  let at = start
  while (at < end) {
    const id = readId(bytes, at)
    const size = id && readSize(bytes, id.next)
    if (!id || !size || size.size === null) return
    const stop = size.next + size.size
    if (stop > end) return
    yield { id: id.id, start: size.next, end: stop }
    at = stop
  }
}

const uint = (bytes: Uint8Array, { start, end }: Child): number => {
  let value = 0
  for (let i = start; i < end; i++) value = value * 256 + bytes[i]!
  return value
}

/** The chapters in `parent` (an edition, or a chapter holding sub-chapters), nested ones included. */
function atoms(bytes: Uint8Array, parent: Child, out: MkvChapter[]) {
  for (const atom of children(bytes, parent.start, parent.end)) {
    if (atom.id !== ID.atom) continue
    let start: number | undefined
    let enabled = true
    let title: string | undefined
    for (const field of children(bytes, atom.start, atom.end)) {
      if (field.id === ID.timeStart) start = uint(bytes, field)
      else if (field.id === ID.flagEnabled) enabled = uint(bytes, field) !== 0
      else if (field.id === ID.display && title === undefined) {
        for (const name of children(bytes, field.start, field.end)) {
          if (name.id === ID.string) title = new TextDecoder().decode(bytes.subarray(name.start, name.end)).replace(/\0+$/, '').trim()
        }
      }
    }
    if (enabled && start !== undefined && title) out.push({ title, start: start / 1e9 })
    atoms(bytes, atom, out)
  }
}

/** The first edition's chapters in time order, or none when the bytes hold no whole chapter list. */
export function parseChapters(bytes: Uint8Array): MkvChapter[] {
  try {
    // The EBML header, then the Segment, whose size is the file's (more than the bytes read here), so only its start matters.
    const ebml = readId(bytes, 0)
    const header = ebml?.id === ID.ebml ? readSize(bytes, ebml.next) : undefined
    if (!header || header.size === null) return []
    const segment = readId(bytes, header.next + header.size)
    const segmentSize = segment?.id === ID.segment ? readSize(bytes, segment.next) : undefined
    if (!segmentSize) return []

    let at = segmentSize.next
    while (at < bytes.length) {
      const id = readId(bytes, at)
      const size = id && readSize(bytes, id.next)
      // The first cluster ends the header: whatever chapters there are, they would have come before it.
      if (!id || !size || size.size === null || id.id === ID.cluster) return []
      const stop = size.next + size.size
      if (id.id === ID.chapters) {
        // Only whole elements are read: half a chapter list would put the wrong chapter at the wrong time.
        if (stop > bytes.length) return []
        const out: MkvChapter[] = []
        for (const edition of children(bytes, size.next, stop)) {
          if (edition.id !== ID.edition) continue
          atoms(bytes, edition, out)
          break
        }
        return out.sort((a, b) => a.start - b.start)
      }
      at = stop
    }
    return []
  } catch {
    return []
  }
}
