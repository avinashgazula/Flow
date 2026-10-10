import Foundation

/// Matroska is EBML: a tree of elements, each an ID, a size and a payload, with IDs and
/// sizes written as variable-length integers. This is the small part of EBML Flow needs.
enum EBML {
    struct Element {
        let id: UInt32
        /// Offset of the element's first header byte.
        let start: Int
        /// Offset of the payload.
        let dataStart: Int
        /// Payload size, or nil for "unknown" (live streams, unfinished files).
        let size: Int?

        var end: Int? { size.map { dataStart + $0 } }
    }

    enum Failure: Error, Equatable {
        case truncated
        case invalid(String)
    }

    /// Element IDs keep their length marker bits, as the spec writes them (0x1A45DFA3).
    static func readID(_ b: [UInt8], _ i: inout Int) throws -> UInt32 {
        guard i < b.count else { throw Failure.truncated }
        let first = b[i]
        let length = first.leadingZeroBitCount + 1
        guard length <= 4 else { throw Failure.invalid("element ID longer than 4 bytes") }
        guard i + length <= b.count else { throw Failure.truncated }
        var value: UInt32 = 0
        for k in 0..<length { value = value << 8 | UInt32(b[i + k]) }
        i += length
        return value
    }

    /// Sizes drop the marker bit; all ones means unknown.
    static func readSize(_ b: [UInt8], _ i: inout Int) throws -> Int? {
        let (value, length, allOnes) = try readVInt(b, &i)
        if allOnes { return nil }
        guard value <= UInt64(Int.max) else { throw Failure.invalid("size overflow") }
        _ = length
        return Int(value)
    }

    /// A vint with its marker removed, its byte length, and whether every value bit was set.
    static func readVInt(_ b: [UInt8], _ i: inout Int) throws -> (UInt64, Int, Bool) {
        guard i < b.count else { throw Failure.truncated }
        let first = b[i]
        guard first != 0 else { throw Failure.invalid("vint longer than 8 bytes") }
        let length = first.leadingZeroBitCount + 1
        guard i + length <= b.count else { throw Failure.truncated }
        var value = UInt64(first & (0xFF >> length))
        var allOnes = value == UInt64(0xFF >> length)
        for k in 1..<length {
            let byte = b[i + k]
            value = value << 8 | UInt64(byte)
            if byte != 0xFF { allOnes = false }
        }
        i += length
        return (value, length, allOnes)
    }

    static func readElement(_ b: [UInt8], at offset: Int) throws -> Element {
        var i = offset
        let id = try readID(b, &i)
        let size = try readSize(b, &i)
        return Element(id: id, start: offset, dataStart: i, size: size)
    }

    /// Children of a known-size element whose payload is fully in `b`.
    static func children(_ b: [UInt8], from start: Int, to end: Int) throws -> [Element] {
        var out: [Element] = []
        var i = start
        while i < end {
            let element = try readElement(b, at: i)
            guard let elementEnd = element.end else { throw Failure.invalid("unknown size inside a sized parent") }
            guard elementEnd <= end else { throw Failure.truncated }
            out.append(element)
            i = elementEnd
        }
        return out
    }

    /// Clamped to 2^48 so a corrupt value can't trap when converted to Int or multiplied by a
    /// timecode scale. Real positions and times stay far below it (2^48 bytes is 281 TB).
    static func uint(_ b: [UInt8], _ e: Element) -> UInt64 {
        guard let end = e.end, end <= b.count, end >= e.dataStart else { return 0 }
        var value: UInt64 = 0
        for k in e.dataStart..<end { value = value << 8 | UInt64(b[k]) }
        return min(value, 1 << 48)
    }

    static func int(_ b: [UInt8], _ e: Element) -> Int64 {
        guard let end = e.end, end > e.dataStart, end <= b.count else { return 0 }
        var value = Int64(Int8(bitPattern: b[e.dataStart]))
        for k in (e.dataStart + 1)..<end { value = value << 8 | Int64(b[k]) }
        return value
    }

    static func float(_ b: [UInt8], _ e: Element) -> Double {
        guard let end = e.end, end <= b.count else { return 0 }
        let bits = uint(b, e)
        switch end - e.dataStart {
        case 4: return Double(Float(bitPattern: UInt32(truncatingIfNeeded: bits)))
        case 8: return Double(bitPattern: bits)
        default: return 0
        }
    }

    static func string(_ b: [UInt8], _ e: Element) -> String {
        guard let end = e.end, end <= b.count else { return "" }
        var bytes = Array(b[e.dataStart..<end])
        while bytes.last == 0 { bytes.removeLast() }
        return String(decoding: bytes, as: UTF8.self)
    }

    static func bytes(_ b: [UInt8], _ e: Element) -> [UInt8] {
        guard let end = e.end, end <= b.count else { return [] }
        return Array(b[e.dataStart..<end])
    }
}

/// Element IDs used by Flow's Matroska reader.
enum MKV {
    static let ebml: UInt32 = 0x1A45DFA3
    static let docType: UInt32 = 0x4282
    static let segment: UInt32 = 0x18538067
    static let seekHead: UInt32 = 0x114D9B74
    static let seek: UInt32 = 0x4DBB
    static let seekID: UInt32 = 0x53AB
    static let seekPosition: UInt32 = 0x53AC
    static let info: UInt32 = 0x1549A966
    static let timecodeScale: UInt32 = 0x2AD7B1
    static let duration: UInt32 = 0x4489
    static let title: UInt32 = 0x7BA9
    static let tracks: UInt32 = 0x1654AE6B
    static let trackEntry: UInt32 = 0xAE
    static let trackNumber: UInt32 = 0xD7
    static let trackType: UInt32 = 0x83
    static let flagEnabled: UInt32 = 0xB9
    static let flagDefault: UInt32 = 0x88
    static let flagForced: UInt32 = 0x55AA
    static let flagHearingImpaired: UInt32 = 0x55AB
    static let flagCommentary: UInt32 = 0x55AF
    static let defaultDuration: UInt32 = 0x23E383
    static let name: UInt32 = 0x536E
    static let language: UInt32 = 0x22B59C
    static let languageBCP47: UInt32 = 0x22B59D
    static let codecID: UInt32 = 0x86
    static let codecPrivate: UInt32 = 0x63A2
    static let codecDelay: UInt32 = 0x56AA
    static let contentEncodings: UInt32 = 0x6D80
    static let contentEncoding: UInt32 = 0x6240
    static let contentCompression: UInt32 = 0x5034
    static let contentCompAlgo: UInt32 = 0x4254
    static let contentCompSettings: UInt32 = 0x4255
    static let contentEncryption: UInt32 = 0x5035
    static let video: UInt32 = 0xE0
    static let pixelWidth: UInt32 = 0xB0
    static let pixelHeight: UInt32 = 0xBA
    static let displayWidth: UInt32 = 0x54B0
    static let displayHeight: UInt32 = 0x54BA
    static let colour: UInt32 = 0x55B0
    static let matrixCoefficients: UInt32 = 0x55B1
    static let bitsPerChannel: UInt32 = 0x55B2
    static let colourRange: UInt32 = 0x55B9
    static let transferCharacteristics: UInt32 = 0x55BA
    static let primaries: UInt32 = 0x55BB
    static let maxCLL: UInt32 = 0x55BC
    static let maxFALL: UInt32 = 0x55BD
    static let masteringMetadata: UInt32 = 0x55D0
    static let blockAdditionMapping: UInt32 = 0x41E4
    static let blockAddIDType: UInt32 = 0x41E7
    static let blockAddIDExtraData: UInt32 = 0x41ED
    static let audio: UInt32 = 0xE1
    static let samplingFrequency: UInt32 = 0xB5
    static let outputSamplingFrequency: UInt32 = 0x78B5
    static let channels: UInt32 = 0x9F
    static let bitDepth: UInt32 = 0x6264
    static let cues: UInt32 = 0x1C53BB6B
    static let cuePoint: UInt32 = 0xBB
    static let cueTime: UInt32 = 0xB3
    static let cueTrackPositions: UInt32 = 0xB7
    static let cueTrack: UInt32 = 0xF7
    static let cueClusterPosition: UInt32 = 0xF1
    static let cueRelativePosition: UInt32 = 0xF0
    static let chapters: UInt32 = 0x1043A770
    static let editionEntry: UInt32 = 0x45B9
    static let editionFlagDefault: UInt32 = 0x45DB
    static let chapterAtom: UInt32 = 0xB6
    static let chapterTimeStart: UInt32 = 0x91
    static let chapterTimeEnd: UInt32 = 0x92
    static let chapterFlagHidden: UInt32 = 0x98
    static let chapterDisplay: UInt32 = 0x80
    static let chapString: UInt32 = 0x85
    static let cluster: UInt32 = 0x1F43B675
    static let timecode: UInt32 = 0xE7
    static let simpleBlock: UInt32 = 0xA3
    static let blockGroup: UInt32 = 0xA0
    static let block: UInt32 = 0xA1
    static let blockDuration: UInt32 = 0x9B
    static let referenceBlock: UInt32 = 0xFB
    static let tags: UInt32 = 0x1254C367
    static let attachments: UInt32 = 0x1941A469

    /// Top-level Segment children: an unknown-size Cluster ends where one of these begins.
    static let topLevel: Set<UInt32> = [seekHead, info, tracks, cues, chapters, cluster, tags, attachments]
}
