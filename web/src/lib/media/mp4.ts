/* Just enough ISO base media file format to take apart what the engine's muxer writes: the init segment
   (ftyp + moov), which says what the track is and on what clock, and the fragments (moof + mdat), which say
   where on that clock they sit and whether they begin on a key frame. The page needs the first to build the
   exact MIME type MediaSource is opened with, the second to follow what has been buffered. Pure functions
   over bytes, so they're tested without a browser. */

export interface Box {
  type: string
  /** Offset of the box's first byte (its size field). */
  start: number
  /** Offset of the first byte after its header. */
  body: number
  /** Offset of the first byte after the box. */
  end: number
}

const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
const i32 = (b: Uint8Array, at: number) => (u32(b, at) | 0)
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 4294967296 + u32(b, at + 4)
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!)

/** The boxes laid end to end in `data[from, to)`. A box whose size runs past `to` ends the list; one that says it runs to the end of the file (size 0) is taken so. */
export function boxes(data: Uint8Array, from = 0, to = data.length): Box[] {
  const list: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = u32(data, at)
    let header = 8
    if (size === 1) {
      if (at + 16 > to) break
      size = u64(data, at + 8)
      header = 16
    } else if (size === 0) {
      size = to - at
    }
    if (size < header || at + size > to) break
    list.push({ type: fourcc(data, at + 4), start: at, body: at + header, end: at + size })
    at += size
  }
  return list
}

/** The box at the end of a path of types ("moov/trak/mdia"), searching the first match at each level. */
export function find(data: Uint8Array, path: string, within?: Box): Box | undefined {
  let parent = within
  for (const type of path.split('/')) {
    const found = boxes(data, parent?.body ?? 0, parent?.end ?? data.length).find((b) => b.type === type)
    if (!found) return undefined
    parent = found
  }
  return parent
}

export interface Segments {
  /** ftyp and moov, when present. */
  init: Uint8Array | null
  /** Each moof with the mdat that follows it. */
  fragments: Uint8Array[]
}

/** Splits muxer output into its init segment and fragments. Anything else at the top level (a styp, an mfra) is dropped; a fragment cut off at the end is too. */
export function splitSegments(data: Uint8Array): Segments {
  const top = boxes(data)
  let initEnd = 0
  let sawMoov = false
  const fragments: Uint8Array[] = []
  for (let i = 0; i < top.length; i++) {
    const box = top[i]!
    if (box.type === 'ftyp' || box.type === 'moov') {
      if (box.type === 'moov') sawMoov = true
      initEnd = Math.max(initEnd, box.end)
    } else if (box.type === 'moof') {
      const next = top[i + 1]
      if (next?.type === 'mdat') {
        fragments.push(data.subarray(box.start, next.end))
        i++
      }
    }
  }
  return { init: sawMoov ? data.subarray(0, initEnd) : null, fragments }
}

export interface TrackInit {
  /** Ticks per second of the track's clock (from mdhd). */
  timescale: number
  /** Sample entry type: "avc1", "hvc1", "mp4a", "ac-3", "flac", "Opus"… */
  entry: string
  /** The codec string MediaSource takes ("avc1.4D401E", "mp4a.40.2", "flac"), or '' when it can't be worked out. */
  codec: string
  width: number
  height: number
  channels: number
  sampleRate: number
}

/** What the init segment says about its first track. */
export function readInit(init: Uint8Array): TrackInit | null {
  const moov = find(init, 'moov')
  const trak = moov && boxes(init, moov.body, moov.end).find((b) => b.type === 'trak')
  return trak ? readTrack(init, trak) : null
}

/** The sound tracks of a file's moov (found in `data`, which may be the start or the end of the file), or null when no moov is in it. */
export function soundTracks(data: Uint8Array): TrackInit[] | null {
  const moov = find(data, 'moov')
  if (!moov) return null
  const out: TrackInit[] = []
  for (const trak of boxes(data, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue
    const hdlr = find(data, 'mdia/hdlr', trak)
    if (!hdlr || fourcc(data, hdlr.body + 8) !== 'soun') continue
    const track = readTrack(data, trak)
    if (track) out.push(track)
  }
  return out
}

/** One track of a moov: its clock, sample entry and codec string. */
export function readTrack(init: Uint8Array, trak: Box): TrackInit | null {
  const mdhd = find(init, 'mdia/mdhd', trak)
  const stsd = find(init, 'mdia/minf/stbl/stsd', trak)
  if (!mdhd || !stsd) return null
  const timescale = init[mdhd.body] === 1 ? u32(init, mdhd.body + 20) : u32(init, mdhd.body + 12)
  // stsd: version+flags (4), entry count (4), then the entries as boxes.
  const entry = boxes(init, stsd.body + 8, stsd.end)[0]
  if (!entry) return null
  const type = entry.type
  const isVideo = ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09', 'dvh1', 'dvhe', 'mp4v', 'vp08'].includes(type)
  // Visual sample entry: 78 bytes before its child boxes. Audio: 28.
  const childFrom = entry.body + (isVideo ? 78 : 28)
  const kids = boxes(init, childFrom, entry.end)
  const kid = (name: string) => kids.find((k) => k.type === name)
  const out: TrackInit = {
    timescale,
    entry: type,
    codec: '',
    width: isVideo ? (init[entry.body + 24]! << 8) | init[entry.body + 25]! : 0,
    height: isVideo ? (init[entry.body + 26]! << 8) | init[entry.body + 27]! : 0,
    channels: isVideo ? 0 : (init[entry.body + 16]! << 8) | init[entry.body + 17]!,
    sampleRate: isVideo ? 0 : ((init[entry.body + 24]! << 8) | init[entry.body + 25]!),
  }
  const config = (name: string) => {
    const k = kid(name)
    return k ? init.subarray(k.body, k.end) : undefined
  }
  switch (type) {
    case 'avc1':
    case 'avc3': {
      const c = config('avcC')
      out.codec = c && c.length >= 4 ? `${type}.${hex(c[1]!)}${hex(c[2]!)}${hex(c[3]!)}` : ''
      break
    }
    case 'hvc1':
    case 'hev1': {
      const c = config('hvcC')
      out.codec = c ? hevcCodec(type, c) : ''
      break
    }
    case 'dvh1':
    case 'dvhe': {
      // Dolby Vision on HEVC: the base layer's own entry isn't separate here; the page plays the HEVC part.
      const c = config('hvcC')
      out.codec = c ? hevcCodec('hvc1', c) : ''
      break
    }
    case 'av01': {
      const c = config('av1C')
      out.codec = c ? av1Codec(c) : ''
      break
    }
    case 'vp09': {
      const c = config('vpcC')
      out.codec = c && c.length >= 8 ? `vp09.${pad2(c[4]!)}.${pad2(c[5]!)}.${pad2(c[6]! >> 4)}` : ''
      break
    }
    case 'mp4a': {
      const k = kid('esds')
      out.codec = k ? esdsCodec(init.subarray(k.body, k.end)) : ''
      break
    }
    case 'ac-3':
      out.codec = 'ac-3'
      break
    case 'ec-3':
      out.codec = 'ec-3'
      break
    case 'fLaC':
      out.codec = 'flac'
      break
    case 'Opus':
      out.codec = 'opus'
      break
    case 'alac':
      out.codec = 'alac'
      break
  }
  return out
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
const pad2 = (n: number) => String(n).padStart(2, '0')

/** "hvc1.1.6.L93.B0" from an hvcC record (ISO/IEC 14496-15, annex E). */
export function hevcCodec(entry: string, hvcc: Uint8Array): string {
  if (hvcc.length < 13) return ''
  const space = ['', 'A', 'B', 'C'][hvcc[1]! >> 6]!
  const tier = (hvcc[1]! & 0x20) !== 0 ? 'H' : 'L'
  const profile = hvcc[1]! & 0x1f
  // The 32 compatibility flags, bit-reversed, as hex without leading zeros.
  let flags = u32(hvcc, 2)
  let reversed = 0
  for (let i = 0; i < 32; i++) {
    reversed = (reversed * 2 + (flags & 1)) >>> 0
    flags >>>= 1
  }
  const constraints = Array.from(hvcc.subarray(6, 12))
  while (constraints.length > 0 && constraints[constraints.length - 1] === 0) constraints.pop()
  const level = hvcc[12]!
  return [`${entry}.${space}${profile}`, reversed.toString(16).toUpperCase(), `${tier}${level}`, ...constraints.map((b) => b.toString(16).toUpperCase())].join('.')
}

/** "av01.0.08M.10" from an av1C record. */
export function av1Codec(av1c: Uint8Array): string {
  if (av1c.length < 4) return ''
  const profile = av1c[1]! >> 5
  const level = av1c[1]! & 0x1f
  const tier = (av1c[2]! & 0x80) !== 0 ? 'H' : 'M'
  const high = (av1c[2]! & 0x40) !== 0
  const twelve = (av1c[2]! & 0x20) !== 0
  const depth = high ? (twelve ? 12 : 10) : 8
  return `av01.${profile}.${pad2(level)}${tier}.${pad2(depth)}`
}

/** "mp4a.40.2" from an esds box's body: the object type, and for AAC the audio object type inside its config. */
export function esdsCodec(esds: Uint8Array): string {
  let at = 4 // version and flags
  const length = () => {
    let n = 0
    for (let i = 0; i < 4 && at < esds.length; i++) {
      const b = esds[at++]!
      n = (n << 7) | (b & 0x7f)
      if (!(b & 0x80)) break
    }
    return n
  }
  if (esds[at++] !== 0x03) return ''
  length()
  at += 2 // ES id
  const flags = esds[at++]!
  if (flags & 0x80) at += 2
  if (flags & 0x40) at += 1 + esds[at]!
  if (flags & 0x20) at += 2
  if (esds[at++] !== 0x04) return ''
  length()
  const objectType = esds[at]!
  at += 13
  if (objectType !== 0x40 && objectType !== 0x66 && objectType !== 0x67 && objectType !== 0x68) return `mp4a.${hex(objectType)}`
  let aot = 0
  if (esds[at++] === 0x05) {
    length()
    aot = esds[at]! >> 3
    if (aot === 31) aot = 32 + (((esds[at]! & 7) << 3) | (esds[at + 1]! >> 5))
  }
  return aot ? `mp4a.40.${aot}` : 'mp4a.40.2'
}

export interface FragmentTimes {
  /** Seconds: the earliest presentation time of any sample in the fragment. */
  start: number
  /** Seconds: when the last sample's presentation ends. */
  end: number
  /** The first sample (in decode order) is a sync sample. */
  key: boolean
  samples: number
}

/** Where a fragment (moof + mdat) sits on its track's clock, read from its first traf. */
export function fragmentTimes(fragment: Uint8Array, timescale: number): FragmentTimes | null {
  const moof = boxes(fragment).find((b) => b.type === 'moof')
  if (!moof) return null
  const traf = boxes(fragment, moof.body, moof.end).find((b) => b.type === 'traf')
  if (!traf) return null
  const kids = boxes(fragment, traf.body, traf.end)
  const tfhd = kids.find((b) => b.type === 'tfhd')
  const tfdt = kids.find((b) => b.type === 'tfdt')
  const truns = kids.filter((b) => b.type === 'trun')
  if (!tfhd || !tfdt || truns.length === 0) return null

  const tfFlags = u32(fragment, tfhd.body) & 0xffffff
  let at = tfhd.body + 8 // version/flags, track id
  if (tfFlags & 0x1) at += 8
  if (tfFlags & 0x2) at += 4
  const defaultDuration = tfFlags & 0x8 ? u32(fragment, at) : 0
  if (tfFlags & 0x8) at += 4
  if (tfFlags & 0x10) at += 4
  const defaultFlags = tfFlags & 0x20 ? u32(fragment, at) : 0

  const version = fragment[tfdt.body]!
  let dts = version === 1 ? u64(fragment, tfdt.body + 4) : u32(fragment, tfdt.body + 4)
  let first = Infinity
  let last = -Infinity
  let key: boolean | null = null
  let samples = 0
  for (const trun of truns) {
    const flags = u32(fragment, trun.body) & 0xffffff
    const trunVersion = fragment[trun.body]!
    const count = u32(fragment, trun.body + 4)
    let p = trun.body + 8
    if (flags & 0x1) p += 4
    const firstFlags = flags & 0x4 ? u32(fragment, p) : null
    if (flags & 0x4) p += 4
    for (let i = 0; i < count; i++) {
      const duration = flags & 0x100 ? u32(fragment, p) : defaultDuration
      if (flags & 0x100) p += 4
      if (flags & 0x200) p += 4
      let sampleFlags = defaultFlags
      if (flags & 0x400) {
        sampleFlags = u32(fragment, p)
        p += 4
      } else if (i === 0 && firstFlags !== null) {
        sampleFlags = firstFlags
      }
      let offset = 0
      if (flags & 0x800) {
        offset = trunVersion === 0 ? u32(fragment, p) : i32(fragment, p)
        p += 4
      }
      if (key === null) key = (sampleFlags & 0x10000) === 0
      first = Math.min(first, dts + offset)
      last = Math.max(last, dts + offset + duration)
      dts += duration
      samples++
    }
  }
  if (samples === 0 || timescale <= 0) return null
  return { start: first / timescale, end: last / timescale, key: key ?? true, samples }
}
