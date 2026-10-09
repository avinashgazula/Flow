import Foundation

/// Random access to a file's bytes: a local file, or HTTP range requests against a stream.
public protocol ByteSource: Sendable {
    /// Total length in bytes, when known.
    func length() async throws -> Int64?
    /// Bytes in `range`; may return fewer at the end of the file.
    func read(_ range: Range<Int64>) async throws -> [UInt8]
}

public struct FileByteSource: ByteSource {
    public let url: URL
    public init(url: URL) { self.url = url }

    public func length() async throws -> Int64? {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes[.size] as? NSNumber)?.int64Value
    }

    public func read(_ range: Range<Int64>) async throws -> [UInt8] {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(range.lowerBound))
        let data = try handle.read(upToCount: Int(range.count)) ?? Data()
        return [UInt8](data)
    }
}

/// Bytes already in memory (tests, small files).
public struct MemoryByteSource: ByteSource {
    public let bytes: [UInt8]
    public init(_ bytes: [UInt8]) { self.bytes = bytes }
    public func length() async throws -> Int64? { Int64(bytes.count) }
    public func read(_ range: Range<Int64>) async throws -> [UInt8] {
        let lower = Int(min(range.lowerBound, Int64(bytes.count)))
        let upper = Int(min(range.upperBound, Int64(bytes.count)))
        return Array(bytes[lower..<upper])
    }
}

// MARK: - Model

public struct MatroskaColour: Hashable, Sendable {
    public var matrix: Int?
    public var bitsPerChannel: Int?
    public var range: Int?
    public var transfer: Int?
    public var primaries: Int?
    public var maxCLL: Int?
    public var maxFALL: Int?
    /// Mastering display: R, G, B, white point chromaticities (x, y) and max/min luminance.
    public var mastering: [Double]?

    /// 16 = SMPTE ST 2084 (PQ), 18 = ARIB STD-B67 (HLG).
    public var isPQ: Bool { transfer == 16 }
    public var isHLG: Bool { transfer == 18 }
}

public struct MatroskaTrack: Hashable, Sendable, Identifiable {
    public enum Kind: Int, Sendable { case video = 1, audio = 2, complex = 3, logo = 0x10, subtitle = 0x11, buttons = 0x12, control = 0x20, metadata = 0x21 }

    public var number: Int
    public var kind: Kind?
    public var codecID: String = ""
    public var codecPrivate: [UInt8] = []
    public var name: String?
    public var language: String = "eng"
    public var isEnabled = true
    public var isDefault = true
    public var isForced = false
    public var isHearingImpaired = false
    /// Nanoseconds per frame, when the muxer recorded it.
    public var defaultDuration: Int64?
    public var codecDelay: Int64 = 0
    /// Bytes removed from the start of every frame by "header stripping" compression.
    public var strippedHeader: [UInt8] = []
    public var isEncrypted = false
    public var isCompressedUnsupported = false

    // Video
    public var width = 0
    public var height = 0
    public var displayWidth: Int?
    public var displayHeight: Int?
    public var colour: MatroskaColour?
    /// Dolby Vision configuration record ("dvcC"/"dvvC" payload).
    public var dolbyVision: [UInt8]?
    public var dolbyVisionBoxType: String?

    // Audio
    public var sampleRate: Double = 0
    public var outputSampleRate: Double?
    public var channels = 0
    public var bitDepth: Int?

    public var id: Int { number }
}

public struct MatroskaCue: Hashable, Sendable {
    /// Presentation time in nanoseconds.
    public var time: Int64
    public var track: Int
    /// Cluster offset relative to the Segment's payload.
    public var clusterPosition: Int64
    /// Block offset inside the cluster's payload, when written.
    public var relativePosition: Int64?
}

public struct MatroskaChapter: Hashable, Sendable {
    public var start: Int64
    public var end: Int64?
    public var title: String
}

public struct MatroskaHeader: Sendable {
    public var docType: String
    /// Absolute offset of the Segment payload; cluster and seek positions are relative to it.
    public var segmentDataStart: Int64
    /// Absolute end of the Segment, when known.
    public var segmentEnd: Int64?
    public var timecodeScale: Int64 = 1_000_000
    /// Nanoseconds.
    public var duration: Int64?
    public var title: String?
    public var tracks: [MatroskaTrack] = []
    public var cues: [MatroskaCue] = []
    public var chapters: [MatroskaChapter] = []
    /// Absolute offset of the first Cluster.
    public var firstClusterPosition: Int64?

    public func track(_ number: Int) -> MatroskaTrack? { tracks.first { $0.number == number } }
}

public struct MatroskaBlock: Sendable {
    public var track: Int
    /// Presentation time in nanoseconds.
    public var time: Int64
    /// Nanoseconds, from BlockDuration when present.
    public var duration: Int64?
    public var isKeyframe: Bool
    /// Laced blocks carry several frames.
    public var frames: [[UInt8]]
}

public enum MatroskaError: Error, Equatable, LocalizedError {
    case notMatroska
    case unsupported(String)
    case malformed(String)

    public var errorDescription: String? {
        switch self {
        case .notMatroska: return "This isn't a Matroska file."
        case .unsupported(let what): return "Unsupported: \(what)."
        case .malformed(let what): return "The file looks damaged (\(what))."
        }
    }
}

// MARK: - Header

public enum MatroskaReader {
    /// Reads everything before the first cluster, then the Cues and Chapters wherever they live.
    public static func readHeader(_ source: ByteSource, probeSize: Int = 512 * 1024) async throws -> MatroskaHeader {
        let length = try await source.length()
        var buffer = try await source.read(0..<Int64(probeSize))
        guard buffer.count >= 4, Array(buffer[0..<4]) == [0x1A, 0x45, 0xDF, 0xA3] else { throw MatroskaError.notMatroska }

        let ebml = try EBML.readElement(buffer, at: 0)
        guard let ebmlEnd = ebml.end, ebmlEnd <= buffer.count else { throw MatroskaError.malformed("EBML header") }
        var docType = "matroska"
        for child in try EBML.children(buffer, from: ebml.dataStart, to: ebmlEnd) where child.id == MKV.docType {
            docType = EBML.string(buffer, child)
        }
        guard docType == "matroska" || docType == "webm" else { throw MatroskaError.notMatroska }

        let segment = try EBML.readElement(buffer, at: ebmlEnd)
        guard segment.id == MKV.segment else { throw MatroskaError.malformed("no Segment") }
        var header = MatroskaHeader(docType: docType, segmentDataStart: Int64(segment.dataStart))
        if let size = segment.size {
            header.segmentEnd = Int64(segment.dataStart + size)
        } else {
            header.segmentEnd = length
        }

        var seekPositions: [UInt32: Int64] = [:]
        var sawCues = false
        var sawChapters = false
        var offset = segment.dataStart

        // Walk top-level children until the first cluster. The window slides forward and jumps
        // straight over anything Flow doesn't need (attachments such as fonts can be many megabytes).
        var window = buffer
        var windowStart = 0
        let wanted: Set<UInt32> = [MKV.seekHead, MKV.info, MKV.tracks, MKV.cues, MKV.chapters]
        while true {
            if let segmentEnd = header.segmentEnd, Int64(offset) >= segmentEnd { break }
            if let length, Int64(offset) >= length { break }
            if offset - windowStart + 12 > window.count {
                window = try await source.read(Int64(offset)..<Int64(offset + probeSize))
                windowStart = offset
                if window.count < 2 { break }
            }
            var element = try EBML.readElement(window, at: offset - windowStart)
            if element.id == MKV.cluster {
                header.firstClusterPosition = Int64(offset)
                break
            }
            guard let relativeEnd = element.end else { throw MatroskaError.malformed("unknown-size top-level element") }
            let end = windowStart + relativeEnd
            if wanted.contains(element.id) && relativeEnd > window.count {
                guard end - offset < 64 * 1024 * 1024 else { offset = end; continue }
                window = try await source.read(Int64(offset)..<Int64(end))
                windowStart = offset
                element = try EBML.readElement(window, at: 0)
                guard let refreshedEnd = element.end, refreshedEnd <= window.count else { throw MatroskaError.malformed("truncated header") }
            }
            switch element.id {
            case MKV.seekHead:
                for (id, position) in try parseSeekHead(window, element) { seekPositions[id] = position }
            case MKV.info:
                try parseInfo(window, element, into: &header)
            case MKV.tracks:
                header.tracks = try parseTracks(window, element)
            case MKV.cues:
                header.cues = try parseCues(window, element)
                sawCues = true
            case MKV.chapters:
                header.chapters = try parseChapters(window, element)
                sawChapters = true
            default:
                break
            }
            offset = end
        }

        // Cues and chapters usually sit after the clusters; the SeekHead says where.
        if !sawCues, let position = seekPositions[MKV.cues] {
            if let element = try await readTopLevel(source, at: header.segmentDataStart + position, expecting: MKV.cues) {
                header.cues = try parseCues(element.bytes, element.element)
            }
        }
        if !sawChapters, let position = seekPositions[MKV.chapters] {
            if let element = try await readTopLevel(source, at: header.segmentDataStart + position, expecting: MKV.chapters) {
                header.chapters = (try? parseChapters(element.bytes, element.element)) ?? []
            }
        }
        // A second SeekHead at the end sometimes indexes the Cues.
        if header.cues.isEmpty, let position = seekPositions[MKV.seekHead],
           let element = try await readTopLevel(source, at: header.segmentDataStart + position, expecting: MKV.seekHead) {
            let more = try parseSeekHead(element.bytes, element.element)
            if let cuesPosition = more.first(where: { $0.0 == MKV.cues })?.1,
               let cues = try await readTopLevel(source, at: header.segmentDataStart + cuesPosition, expecting: MKV.cues) {
                header.cues = try parseCues(cues.bytes, cues.element)
            }
        }
        header.scaleCueTimes()
        header.cues.sort { $0.time < $1.time }
        return header
    }

    /// Reads one top-level element. A generous first read usually gets all of it in one round trip.
    static func readTopLevel(_ source: ByteSource, at position: Int64, expecting id: UInt32) async throws -> (bytes: [UInt8], element: EBML.Element)? {
        var bytes = try await source.read(position..<(position + 1024 * 1024))
        guard let probe = try? EBML.readElement(bytes, at: 0), probe.id == id, let size = probe.size else { return nil }
        let total = probe.dataStart + size
        if bytes.count < total {
            bytes += try await source.read((position + Int64(bytes.count))..<(position + Int64(total)))
        }
        guard bytes.count >= total else { return nil }
        bytes = Array(bytes.prefix(total))
        return (bytes, try EBML.readElement(bytes, at: 0))
    }

    static func parseSeekHead(_ b: [UInt8], _ e: EBML.Element) throws -> [(UInt32, Int64)] {
        var out: [(UInt32, Int64)] = []
        for seek in try EBML.children(b, from: e.dataStart, to: e.end!) where seek.id == MKV.seek {
            var id: UInt32?
            var position: Int64?
            for child in try EBML.children(b, from: seek.dataStart, to: seek.end!) {
                if child.id == MKV.seekID { id = UInt32(truncatingIfNeeded: EBML.uint(b, child)) }
                if child.id == MKV.seekPosition { position = Int64(EBML.uint(b, child)) }
            }
            if let id, let position { out.append((id, position)) }
        }
        return out
    }

    static func parseInfo(_ b: [UInt8], _ e: EBML.Element, into header: inout MatroskaHeader) throws {
        var rawDuration: Double?
        for child in try EBML.children(b, from: e.dataStart, to: e.end!) {
            switch child.id {
            case MKV.timecodeScale: header.timecodeScale = max(1, Int64(EBML.uint(b, child)))
            case MKV.duration: rawDuration = EBML.float(b, child)
            case MKV.title: header.title = EBML.string(b, child)
            default: break
            }
        }
        if let rawDuration { header.duration = Int64(rawDuration * Double(header.timecodeScale)) }
    }

    static func parseTracks(_ b: [UInt8], _ e: EBML.Element) throws -> [MatroskaTrack] {
        var tracks: [MatroskaTrack] = []
        for entry in try EBML.children(b, from: e.dataStart, to: e.end!) where entry.id == MKV.trackEntry {
            var t = MatroskaTrack(number: 0)
            var bcp47: String?
            for child in try EBML.children(b, from: entry.dataStart, to: entry.end!) {
                switch child.id {
                case MKV.trackNumber: t.number = Int(EBML.uint(b, child))
                case MKV.trackType: t.kind = MatroskaTrack.Kind(rawValue: Int(EBML.uint(b, child)))
                case MKV.flagEnabled: t.isEnabled = EBML.uint(b, child) != 0
                case MKV.flagDefault: t.isDefault = EBML.uint(b, child) != 0
                case MKV.flagForced: t.isForced = EBML.uint(b, child) != 0
                case MKV.flagHearingImpaired: t.isHearingImpaired = EBML.uint(b, child) != 0
                case MKV.defaultDuration: t.defaultDuration = Int64(EBML.uint(b, child))
                case MKV.name: t.name = EBML.string(b, child)
                case MKV.language: t.language = EBML.string(b, child)
                case MKV.languageBCP47: bcp47 = EBML.string(b, child)
                case MKV.codecID: t.codecID = EBML.string(b, child)
                case MKV.codecPrivate: t.codecPrivate = EBML.bytes(b, child)
                case MKV.codecDelay: t.codecDelay = Int64(EBML.uint(b, child))
                case MKV.contentEncodings: try parseEncodings(b, child, into: &t)
                case MKV.video: try parseVideo(b, child, into: &t)
                case MKV.audio:
                    for a in try EBML.children(b, from: child.dataStart, to: child.end!) {
                        switch a.id {
                        case MKV.samplingFrequency: t.sampleRate = EBML.float(b, a)
                        case MKV.outputSamplingFrequency: t.outputSampleRate = EBML.float(b, a)
                        case MKV.channels: t.channels = Int(EBML.uint(b, a))
                        case MKV.bitDepth: t.bitDepth = Int(EBML.uint(b, a))
                        default: break
                        }
                    }
                case MKV.blockAdditionMapping:
                    var type: UInt64 = 0
                    var extra: [UInt8] = []
                    for m in try EBML.children(b, from: child.dataStart, to: child.end!) {
                        if m.id == MKV.blockAddIDType { type = EBML.uint(b, m) }
                        if m.id == MKV.blockAddIDExtraData { extra = EBML.bytes(b, m) }
                    }
                    if type == 0x6476_6343 || type == 0x6476_7643 || type == 0x6476_7743, !extra.isEmpty {
                        t.dolbyVision = extra
                        t.dolbyVisionBoxType = type == 0x6476_6343 ? "dvcC" : (type == 0x6476_7643 ? "dvvC" : "dvwC")
                    }
                default: break
                }
            }
            if let bcp47, !bcp47.isEmpty { t.language = bcp47 }
            if t.sampleRate == 0 { t.sampleRate = 8000 }
            if t.channels == 0 { t.channels = 1 }
            tracks.append(t)
        }
        return tracks
    }

    private static func parseEncodings(_ b: [UInt8], _ e: EBML.Element, into t: inout MatroskaTrack) throws {
        for encoding in try EBML.children(b, from: e.dataStart, to: e.end!) where encoding.id == MKV.contentEncoding {
            for child in try EBML.children(b, from: encoding.dataStart, to: encoding.end!) {
                if child.id == MKV.contentEncryption { t.isEncrypted = true }
                if child.id == MKV.contentCompression {
                    var algorithm: UInt64 = 0
                    var settings: [UInt8] = []
                    for c in try EBML.children(b, from: child.dataStart, to: child.end!) {
                        if c.id == MKV.contentCompAlgo { algorithm = EBML.uint(b, c) }
                        if c.id == MKV.contentCompSettings { settings = EBML.bytes(b, c) }
                    }
                    if algorithm == 3 { t.strippedHeader = settings } else { t.isCompressedUnsupported = true }
                }
            }
        }
    }

    private static func parseVideo(_ b: [UInt8], _ e: EBML.Element, into t: inout MatroskaTrack) throws {
        for v in try EBML.children(b, from: e.dataStart, to: e.end!) {
            switch v.id {
            case MKV.pixelWidth: t.width = Int(EBML.uint(b, v))
            case MKV.pixelHeight: t.height = Int(EBML.uint(b, v))
            case MKV.displayWidth: t.displayWidth = Int(EBML.uint(b, v))
            case MKV.displayHeight: t.displayHeight = Int(EBML.uint(b, v))
            case MKV.colour:
                var c = MatroskaColour()
                for field in try EBML.children(b, from: v.dataStart, to: v.end!) {
                    switch field.id {
                    case MKV.matrixCoefficients: c.matrix = Int(EBML.uint(b, field))
                    case MKV.bitsPerChannel: c.bitsPerChannel = Int(EBML.uint(b, field))
                    case MKV.colourRange: c.range = Int(EBML.uint(b, field))
                    case MKV.transferCharacteristics: c.transfer = Int(EBML.uint(b, field))
                    case MKV.primaries: c.primaries = Int(EBML.uint(b, field))
                    case MKV.maxCLL: c.maxCLL = Int(EBML.uint(b, field))
                    case MKV.maxFALL: c.maxFALL = Int(EBML.uint(b, field))
                    case MKV.masteringMetadata:
                        var values = [Double](repeating: 0, count: 10)
                        var found = false
                        for m in try EBML.children(b, from: field.dataStart, to: field.end!) where (0x55D1...0x55DA).contains(m.id) {
                            values[Int(m.id - 0x55D1)] = EBML.float(b, m)
                            found = true
                        }
                        if found { c.mastering = values }
                    default: break
                    }
                }
                t.colour = c
            default: break
            }
        }
    }

    static func parseCues(_ b: [UInt8], _ e: EBML.Element) throws -> [MatroskaCue] {
        var cues: [MatroskaCue] = []
        for point in try EBML.children(b, from: e.dataStart, to: e.end!) where point.id == MKV.cuePoint {
            var time: Int64 = 0
            var positions: [(Int, Int64, Int64?)] = []
            for child in try EBML.children(b, from: point.dataStart, to: point.end!) {
                if child.id == MKV.cueTime { time = Int64(EBML.uint(b, child)) }
                if child.id == MKV.cueTrackPositions {
                    var track = 0
                    var cluster: Int64 = 0
                    var relative: Int64?
                    for p in try EBML.children(b, from: child.dataStart, to: child.end!) {
                        switch p.id {
                        case MKV.cueTrack: track = Int(EBML.uint(b, p))
                        case MKV.cueClusterPosition: cluster = Int64(EBML.uint(b, p))
                        case MKV.cueRelativePosition: relative = Int64(EBML.uint(b, p))
                        default: break
                        }
                    }
                    positions.append((track, cluster, relative))
                }
            }
            for (track, cluster, relative) in positions {
                // Times are in timecode-scale units here; the caller scales them once it knows the scale.
                cues.append(MatroskaCue(time: time, track: track, clusterPosition: cluster, relativePosition: relative))
            }
        }
        return cues
    }

    static func parseChapters(_ b: [UInt8], _ e: EBML.Element) throws -> [MatroskaChapter] {
        var editions: [(isDefault: Bool, chapters: [MatroskaChapter])] = []
        for edition in try EBML.children(b, from: e.dataStart, to: e.end!) where edition.id == MKV.editionEntry {
            var isDefault = false
            var chapters: [MatroskaChapter] = []
            func atoms(_ parent: EBML.Element) throws {
                for atom in try EBML.children(b, from: parent.dataStart, to: parent.end!) {
                    if atom.id == MKV.editionFlagDefault { isDefault = EBML.uint(b, atom) != 0 }
                    guard atom.id == MKV.chapterAtom else { continue }
                    var start: Int64 = 0
                    var end: Int64?
                    var hidden = false
                    var title = ""
                    for child in try EBML.children(b, from: atom.dataStart, to: atom.end!) {
                        switch child.id {
                        case MKV.chapterTimeStart: start = Int64(EBML.uint(b, child))
                        case MKV.chapterTimeEnd: end = Int64(EBML.uint(b, child))
                        case MKV.chapterFlagHidden: hidden = EBML.uint(b, child) != 0
                        case MKV.chapterDisplay where title.isEmpty:
                            for d in try EBML.children(b, from: child.dataStart, to: child.end!) where d.id == MKV.chapString {
                                title = EBML.string(b, d)
                            }
                        default: break
                        }
                    }
                    if !hidden { chapters.append(MatroskaChapter(start: start, end: end, title: title)) }
                }
            }
            try atoms(edition)
            editions.append((isDefault, chapters))
        }
        let chosen = editions.first { $0.isDefault } ?? editions.first
        return (chosen?.chapters ?? []).sorted { $0.start < $1.start }
    }
}

extension MatroskaHeader {
    /// Cue times arrive in timecode-scale units; this puts them in nanoseconds.
    mutating func scaleCueTimes() {
        for i in cues.indices { cues[i].time *= timecodeScale }
    }
}

// MARK: - Clusters

public enum MatroskaClusterParser {
    /// Parses every block in `bytes`, which starts at a Cluster boundary.
    /// A trailing partial cluster is parsed as far as its complete children go.
    public static func blocks(_ b: [UInt8], timecodeScale: Int64, tracks: [MatroskaTrack]) throws -> [MatroskaBlock] {
        let stripped = Dictionary(uniqueKeysWithValues: tracks.filter { !$0.strippedHeader.isEmpty }.map { ($0.number, $0.strippedHeader) })
        var out: [MatroskaBlock] = []
        var i = 0
        while i + 4 < b.count {
            guard let cluster = try? EBML.readElement(b, at: i) else { break }
            guard cluster.id == MKV.cluster else {
                // Something else between clusters (Cues, Tags, Void): skip it if its size is known.
                guard let end = cluster.end else { break }
                i = end
                continue
            }
            let clusterEnd = min(cluster.end ?? b.count, b.count)
            var clusterTime: Int64 = 0
            var j = cluster.dataStart
            while j < clusterEnd {
                guard let child = try? EBML.readElement(b, at: j) else { break }
                if cluster.size == nil && MKV.topLevel.contains(child.id) { break }
                guard let childEnd = child.end, childEnd <= clusterEnd else { break }
                switch child.id {
                case MKV.timecode:
                    clusterTime = Int64(EBML.uint(b, child))
                case MKV.simpleBlock:
                    if let block = parseBlock(b, child.dataStart, childEnd, clusterTime: clusterTime, scale: timecodeScale, simple: true, stripped: stripped) {
                        out.append(block)
                    }
                case MKV.blockGroup:
                    var block: MatroskaBlock?
                    var duration: Int64?
                    var hasReference = false
                    for g in (try? EBML.children(b, from: child.dataStart, to: childEnd)) ?? [] {
                        switch g.id {
                        case MKV.block:
                            block = parseBlock(b, g.dataStart, g.end!, clusterTime: clusterTime, scale: timecodeScale, simple: false, stripped: stripped)
                        case MKV.blockDuration: duration = Int64(EBML.uint(b, g)) * timecodeScale
                        case MKV.referenceBlock: hasReference = true
                        default: break
                        }
                    }
                    if var block {
                        block.duration = duration
                        block.isKeyframe = !hasReference
                        out.append(block)
                    }
                default:
                    break
                }
                j = childEnd
            }
            i = cluster.size == nil ? j : (cluster.end ?? b.count)
        }
        return out
    }

    static func parseBlock(_ b: [UInt8], _ start: Int, _ end: Int, clusterTime: Int64, scale: Int64, simple: Bool, stripped: [Int: [UInt8]]) -> MatroskaBlock? {
        var i = start
        guard let (trackNumber, _, _) = try? EBML.readVInt(b, &i), i + 3 <= end else { return nil }
        let relative = Int16(bitPattern: UInt16(b[i]) << 8 | UInt16(b[i + 1]))
        let flags = b[i + 2]
        i += 3
        let track = Int(trackNumber)
        let time = (clusterTime + Int64(relative)) * scale
        let keyframe = simple ? (flags & 0x80) != 0 : true

        var frames: [[UInt8]] = []
        switch (flags >> 1) & 0x03 {
        case 0:
            frames = [Array(b[i..<end])]
        case 1: // Xiph lacing
            guard i < end else { return nil }
            let count = Int(b[i]) + 1
            i += 1
            var sizes: [Int] = []
            for _ in 0..<(count - 1) {
                var size = 0
                while i < end {
                    let v = Int(b[i]); i += 1
                    size += v
                    if v != 255 { break }
                }
                sizes.append(size)
            }
            frames = slice(b, &i, end, sizes: sizes)
        case 2: // fixed-size lacing
            guard i < end else { return nil }
            let count = Int(b[i]) + 1
            i += 1
            let size = (end - i) / count
            frames = (0..<count).map { k in Array(b[(i + k * size)..<(i + (k + 1) * size)]) }
        default: // EBML lacing
            guard i < end else { return nil }
            let count = Int(b[i]) + 1
            i += 1
            guard let (first, _, _) = try? EBML.readVInt(b, &i) else { return nil }
            var sizes = [Int(first)]
            for _ in 1..<max(1, count - 1) where count > 2 {
                guard let (raw, length, _) = try? EBML.readVInt(b, &i) else { return nil }
                // Signed difference: subtract half the range for this length.
                let bias = (Int64(1) << (7 * length - 1)) - 1
                sizes.append(sizes.last! + Int(Int64(raw) - bias))
            }
            frames = slice(b, &i, end, sizes: sizes)
        }
        if let prefix = stripped[track] { frames = frames.map { prefix + $0 } }
        return MatroskaBlock(track: track, time: time, duration: nil, isKeyframe: keyframe, frames: frames)
    }

    /// Frames with explicit sizes, then the remainder as the last frame.
    private static func slice(_ b: [UInt8], _ i: inout Int, _ end: Int, sizes: [Int]) -> [[UInt8]] {
        var frames: [[UInt8]] = []
        for size in sizes {
            guard size >= 0, i + size <= end else { return frames }
            frames.append(Array(b[i..<(i + size)]))
            i += size
        }
        if i <= end { frames.append(Array(b[i..<end])) }
        return frames
    }
}
