import Foundation

struct BitReader {
    let bytes: [UInt8]
    var bit = 0

    init(_ bytes: [UInt8], byteOffset: Int = 0) {
        self.bytes = bytes
        self.bit = byteOffset * 8
    }

    var bitsLeft: Int { bytes.count * 8 - bit }

    mutating func read(_ count: Int) -> UInt32 {
        var value: UInt32 = 0
        for _ in 0..<count {
            let byte = bit / 8
            let bitValue: UInt32 = byte < bytes.count ? UInt32((bytes[byte] >> (7 - UInt8(bit % 8))) & 1) : 0
            value = value << 1 | bitValue
            bit += 1
        }
        return value
    }

    mutating func skip(_ count: Int) { bit += count }
}

struct BitWriter {
    private(set) var bytes: [UInt8] = []
    private var bit = 0

    mutating func write(_ value: UInt32, _ count: Int) {
        for k in stride(from: count - 1, through: 0, by: -1) {
            if bit % 8 == 0 { bytes.append(0) }
            if (value >> UInt32(k)) & 1 == 1 { bytes[bytes.count - 1] |= 1 << (7 - UInt8(bit % 8)) }
            bit += 1
        }
    }
}

// MARK: - AAC

enum AAC {
    static let sampleRates: [Int] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

    /// Audio object type from an AudioSpecificConfig ("mp4a.40.<aot>").
    static func objectType(_ asc: [UInt8]) -> Int {
        var r = BitReader(asc)
        var aot = Int(r.read(5))
        if aot == 31 { aot = 32 + Int(r.read(6)) }
        return aot
    }

    /// Builds an AudioSpecificConfig for old-style codec IDs ("A_AAC/MPEG4/LC") that carry none.
    static func audioSpecificConfig(codecID: String, sampleRate: Double, channels: Int) -> [UInt8] {
        let profile: UInt32 = codecID.contains("MAIN") ? 1 : (codecID.contains("SSR") ? 3 : (codecID.contains("LTP") ? 4 : 2))
        let index = sampleRates.firstIndex(of: Int(sampleRate)) ?? 3
        var w = BitWriter()
        w.write(profile, 5)
        w.write(UInt32(index), 4)
        w.write(UInt32(min(channels, 7)), 4)
        w.write(0, 3)
        return w.bytes
    }
}

// MARK: - AC-3

enum AC3 {
    static let bitrates: [Int] = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640]
    static let acmodChannels = [2, 1, 2, 3, 3, 4, 4, 5]

    struct Header {
        var fscod: Int
        var frmsizecod: Int
        var bsid: Int
        var bsmod: Int
        var acmod: Int
        var lfeon: Int

        var frameBytes: Int {
            let rate = AC3.bitrates[min(frmsizecod >> 1, AC3.bitrates.count - 1)]
            switch fscod {
            case 0: return rate * 4
            case 1: return (rate * 320 / 147 + (frmsizecod & 1)) * 2
            default: return rate * 6
            }
        }

        var sampleRate: Int { [48000, 44100, 32000, 48000][fscod] }
        var channels: Int { AC3.acmodChannels[acmod] + lfeon }
    }

    static func parse(_ b: [UInt8], at offset: Int = 0) -> Header? {
        guard offset + 7 <= b.count, b[offset] == 0x0B, b[offset + 1] == 0x77 else { return nil }
        var r = BitReader(b, byteOffset: offset + 4)
        let fscod = Int(r.read(2))
        let frmsizecod = Int(r.read(6))
        let bsid = Int(r.read(5))
        guard bsid <= 10, fscod != 3 else { return nil }
        let bsmod = Int(r.read(3))
        let acmod = Int(r.read(3))
        if acmod & 1 != 0 && acmod != 1 { r.skip(2) }
        if acmod & 4 != 0 { r.skip(2) }
        if acmod == 2 { r.skip(2) }
        let lfeon = Int(r.read(1))
        return Header(fscod: fscod, frmsizecod: frmsizecod, bsid: bsid, bsmod: bsmod, acmod: acmod, lfeon: lfeon)
    }

    /// dac3 payload (ETSI TS 102 366 F.4).
    static func dac3(_ h: Header) -> [UInt8] {
        var w = BitWriter()
        w.write(UInt32(h.fscod), 2)
        w.write(UInt32(h.bsid), 5)
        w.write(UInt32(h.bsmod), 3)
        w.write(UInt32(h.acmod), 3)
        w.write(UInt32(h.lfeon), 1)
        w.write(UInt32(h.frmsizecod >> 1), 5)
        w.write(0, 5)
        return w.bytes
    }

    /// Splits a block into syncframes, so each MP4 sample is one frame of 1536 samples.
    static func frames(_ b: [UInt8]) -> [[UInt8]] {
        var out: [[UInt8]] = []
        var i = 0
        while i < b.count, let h = parse(b, at: i), h.frameBytes > 0, i + h.frameBytes <= b.count {
            out.append(Array(b[i..<(i + h.frameBytes)]))
            i += h.frameBytes
        }
        return out.isEmpty || i < b.count ? [b] : out
    }
}

// MARK: - E-AC-3

enum EAC3 {
    struct Frame {
        var streamType: Int // 0 independent, 1 dependent, 2 AC-3 converted
        var substreamID: Int
        var bytes: Int
        var fscod: Int
        var blocks: Int
        var acmod: Int
        var lfeon: Int
        var bsid: Int
        var chanmap: Int?

        var sampleRate: Int { [48000, 44100, 32000, 24000, 22050, 16000][min(fscod, 5)] }
    }

    static func parse(_ b: [UInt8], at offset: Int = 0) -> Frame? {
        guard offset + 6 <= b.count, b[offset] == 0x0B, b[offset + 1] == 0x77 else { return nil }
        var r = BitReader(b, byteOffset: offset + 2)
        let strmtyp = Int(r.read(2))
        let substreamid = Int(r.read(3))
        let frmsiz = Int(r.read(11))
        var fscod = Int(r.read(2))
        var numblks = 6
        if fscod == 3 {
            fscod = 3 + Int(r.read(2))
        } else {
            numblks = [1, 2, 3, 6][Int(r.read(2))]
        }
        let acmod = Int(r.read(3))
        let lfeon = Int(r.read(1))
        let bsid = Int(r.read(5))
        guard bsid > 10 && bsid <= 16 else { return nil }
        r.skip(5) // dialnorm
        if r.read(1) == 1 { r.skip(8) } // compre, compr
        if acmod == 0 {
            r.skip(5)
            if r.read(1) == 1 { r.skip(8) }
        }
        var chanmap: Int?
        if strmtyp == 1, r.read(1) == 1 { chanmap = Int(r.read(16)) }
        return Frame(streamType: strmtyp, substreamID: substreamid, bytes: (frmsiz + 1) * 2, fscod: fscod, blocks: numblks,
                     acmod: acmod, lfeon: lfeon, bsid: bsid, chanmap: chanmap)
    }

    static func frames(_ b: [UInt8]) -> [Frame] {
        var out: [Frame] = []
        var i = 0
        while i < b.count, let f = parse(b, at: i), f.bytes > 0, i + f.bytes <= b.count {
            out.append(f)
            i += f.bytes
        }
        return out
    }

    /// PCM samples carried by one block (independent substream frames only).
    static func samples(in b: [UInt8]) -> Int {
        let independent = frames(b).filter { $0.streamType != 1 }
        return independent.isEmpty ? 1536 : independent.reduce(0) { $0 + $1.blocks * 256 }
    }

    /// dec3 payload (ETSI TS 102 366 F.6) from the frames of one block.
    static func dec3(_ block: [UInt8]) -> [UInt8]? {
        let all = frames(block)
        guard let first = all.first(where: { $0.streamType != 1 }) else { return nil }
        let independents = all.filter { $0.streamType != 1 }
        let bytesPerPeriod = all.reduce(0) { $0 + $1.bytes }
        let samples = independents.reduce(0) { $0 + $1.blocks * 256 }
        let kbps = samples > 0 ? bytesPerPeriod * 8 * first.sampleRate / samples / 1000 : 0

        var w = BitWriter()
        w.write(UInt32(min(kbps, 8191)), 13)
        w.write(UInt32(max(0, independents.count - 1)), 3)
        // Dependent substreams follow the independent one they extend.
        var groups: [[Frame]] = []
        for frame in all {
            if frame.streamType == 1, !groups.isEmpty { groups[groups.count - 1].append(frame) } else { groups.append([frame]) }
        }
        for group in groups {
            let frame = group[0]
            let dependents = Array(group.dropFirst())
            w.write(UInt32(min(frame.fscod, 3)), 2)
            w.write(UInt32(frame.bsid), 5)
            w.write(0, 1) // reserved
            w.write(0, 1) // asvc
            w.write(0, 3) // bsmod
            w.write(UInt32(frame.acmod), 3)
            w.write(UInt32(frame.lfeon), 1)
            w.write(0, 3)
            w.write(UInt32(dependents.count), 4)
            if dependents.isEmpty {
                w.write(0, 1)
            } else {
                let location = dependents.reduce(0) { $0 | (($1.chanmap ?? 0) >> 5) & 0x1FF }
                w.write(UInt32(location), 9)
            }
        }
        return w.bytes
    }

    static func channels(_ block: [UInt8]) -> Int {
        let all = frames(block)
        guard let first = all.first(where: { $0.streamType != 1 }) else { return 2 }
        var count = AC3.acmodChannels[first.acmod] + first.lfeon
        if all.contains(where: { $0.streamType == 1 }) { count = max(count, 8) }
        return count
    }
}

// MARK: - FLAC

enum FLAC {
    /// Samples in one frame, from the frame header.
    static func blockSize(_ f: [UInt8]) -> Int? {
        guard f.count > 6, f[0] == 0xFF, f[1] & 0xFE == 0xF8 else { return nil }
        let code = Int(f[2] >> 4)
        switch code {
        case 1: return 192
        case 2...5: return 576 << (code - 2)
        case 8...15: return 256 << (code - 8)
        case 6, 7:
            // Skip the UTF-8 coded frame/sample number, then read the explicit size.
            var i = 4
            let lead = f[i].leadingZeroBitCount == 0 ? (~f[i]).leadingZeroBitCount : 0
            i += max(1, lead)
            guard i + (code == 6 ? 1 : 2) <= f.count else { return nil }
            return code == 6 ? Int(f[i]) + 1 : (Int(f[i]) << 8 | Int(f[i + 1])) + 1
        default: return nil
        }
    }

    /// dfLa payload: the metadata blocks from CodecPrivate ("fLaC" + blocks), last-block flag fixed up.
    static func dfLa(_ codecPrivate: [UInt8]) -> [UInt8]? {
        var b = codecPrivate
        if b.starts(with: Array("fLaC".utf8)) { b.removeFirst(4) }
        guard b.count >= 38 else { return nil }
        // Keep STREAMINFO only; it is all a decoder needs.
        var streamInfo = Array(b[0..<38])
        streamInfo[0] = 0x80 | (streamInfo[0] & 0x7F)
        return streamInfo
    }
}

// MARK: - MP3

enum MP3 {
    static func samplesPerFrame(_ f: [UInt8]) -> Int {
        guard f.count >= 4, f[0] == 0xFF, f[1] & 0xE0 == 0xE0 else { return 1152 }
        let version = (f[1] >> 3) & 0x03 // 3 = MPEG-1
        let layer = (f[1] >> 1) & 0x03 // 1 = Layer III
        if layer == 3 { return 384 }
        if layer == 1 && version != 3 { return 576 }
        return 1152
    }
}
