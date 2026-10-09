import Foundation

/// Writes the fragmented MP4 (CMAF-style) that HLS plays: one init segment per track,
/// then moof/mdat fragments.
enum MP4 {
    struct Writer {
        var bytes: [UInt8] = []
        mutating func u8(_ v: UInt8) { bytes.append(v) }
        mutating func u16(_ v: UInt16) { bytes += [UInt8(v >> 8), UInt8(v & 0xFF)] }
        mutating func u24(_ v: UInt32) { bytes += [UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)] }
        mutating func u32(_ v: UInt32) { bytes += [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)] }
        mutating func i32(_ v: Int32) { u32(UInt32(bitPattern: v)) }
        mutating func u64(_ v: UInt64) { u32(UInt32(v >> 32)); u32(UInt32(v & 0xFFFF_FFFF)) }
        mutating func fourCC(_ s: String) { bytes += Array(s.utf8.prefix(4)) }
        mutating func zeros(_ n: Int) { bytes += [UInt8](repeating: 0, count: n) }
        mutating func append(_ b: [UInt8]) { bytes += b }
    }

    static func box(_ type: String, _ body: [UInt8]) -> [UInt8] {
        var w = Writer()
        w.u32(UInt32(8 + body.count))
        w.fourCC(type)
        w.append(body)
        return w.bytes
    }

    static func box(_ type: String, _ build: (inout Writer) -> Void) -> [UInt8] {
        var w = Writer()
        build(&w)
        return box(type, w.bytes)
    }

    static func fullBox(_ type: String, version: UInt8 = 0, flags: UInt32 = 0, _ build: (inout Writer) -> Void) -> [UInt8] {
        var w = Writer()
        w.u8(version)
        w.u24(flags)
        build(&w)
        return box(type, w.bytes)
    }

    static let unityMatrix: [UInt32] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000]

    struct TrackInfo {
        var isVideo: Bool
        var timescale: UInt32
        var language: String
        var width = 0
        var height = 0
        /// Display size, for anamorphic video.
        var displayWidth = 0
        var displayHeight = 0
        /// The complete sample entry box (avc1, hvc1, mp4a, ac-3, …).
        var sampleEntry: [UInt8]
    }

    static func initSegment(_ t: TrackInfo) -> [UInt8] {
        let ftyp = box("ftyp") { w in
            w.fourCC("iso6"); w.u32(0)
            for brand in ["iso6", "cmfc", "mp41", "isom"] { w.fourCC(brand) }
        }
        let mvhd = fullBox("mvhd") { w in
            w.u32(0); w.u32(0); w.u32(1000); w.u32(0)
            w.u32(0x0001_0000); w.u16(0x0100); w.zeros(10)
            unityMatrix.forEach { w.u32($0) }
            w.zeros(24)
            w.u32(2)
        }
        let tkhd = fullBox("tkhd", flags: 0x7) { w in
            w.u32(0); w.u32(0); w.u32(1); w.u32(0); w.u32(0); w.zeros(8)
            w.u16(0); w.u16(t.isVideo ? 0 : 1); w.u16(t.isVideo ? 0 : 0x0100); w.u16(0)
            unityMatrix.forEach { w.u32($0) }
            let width = t.displayWidth > 0 ? t.displayWidth : t.width
            let height = t.displayHeight > 0 ? t.displayHeight : t.height
            w.u32(UInt32(width) << 16); w.u32(UInt32(height) << 16)
        }
        let mdhd = fullBox("mdhd") { w in
            w.u32(0); w.u32(0); w.u32(t.timescale); w.u32(0)
            w.u16(packedLanguage(t.language)); w.u16(0)
        }
        let hdlr = fullBox("hdlr") { w in
            w.u32(0); w.fourCC(t.isVideo ? "vide" : "soun"); w.zeros(12)
            w.append(Array((t.isVideo ? "VideoHandler" : "SoundHandler").utf8)); w.u8(0)
        }
        let mediaHeader = t.isVideo
            ? fullBox("vmhd", flags: 1) { w in w.zeros(8) }
            : fullBox("smhd") { w in w.zeros(4) }
        let dinf = box("dinf", fullBox("dref") { w in
            w.u32(1)
            w.append(fullBox("url ", flags: 1) { _ in })
        })
        let stbl = box("stbl",
                       fullBox("stsd") { w in w.u32(1); w.append(t.sampleEntry) }
                       + fullBox("stts") { w in w.u32(0) }
                       + fullBox("stsc") { w in w.u32(0) }
                       + fullBox("stsz") { w in w.u32(0); w.u32(0) }
                       + fullBox("stco") { w in w.u32(0) })
        let minf = box("minf", mediaHeader + dinf + stbl)
        let trak = box("trak", tkhd + box("mdia", mdhd + hdlr + minf))
        let mvex = box("mvex", fullBox("trex") { w in w.u32(1); w.u32(1); w.u32(0); w.u32(0); w.u32(0) })
        return ftyp + box("moov", mvhd + trak + mvex)
    }

    struct Sample {
        var data: [UInt8]
        var duration: UInt32
        var compositionOffset: Int32 = 0
        var isSync: Bool
    }

    static func fragment(sequence: UInt32, baseDecodeTime: UInt64, samples: [Sample], isVideo: Bool) -> [UInt8] {
        func moof(dataOffset: Int32) -> [UInt8] {
            let mfhd = fullBox("mfhd") { w in w.u32(sequence) }
            let tfhd = fullBox("tfhd", flags: 0x020000) { w in w.u32(1) }
            let tfdt = fullBox("tfdt", version: 1) { w in w.u64(baseDecodeTime) }
            var flags: UInt32 = 0x000001 | 0x000100 | 0x000200 | 0x000400
            if isVideo { flags |= 0x000800 }
            let trun = fullBox("trun", version: 1, flags: flags) { w in
                w.u32(UInt32(samples.count))
                w.i32(dataOffset)
                for s in samples {
                    w.u32(s.duration)
                    w.u32(UInt32(s.data.count))
                    w.u32(s.isSync ? 0x0200_0000 : 0x0101_0000)
                    if isVideo { w.i32(s.compositionOffset) }
                }
            }
            return box("moof", mfhd + box("traf", tfhd + tfdt + trun))
        }
        let size = moof(dataOffset: 0).count
        var mdat = Writer()
        let payload = samples.reduce(0) { $0 + $1.data.count }
        mdat.u32(UInt32(8 + payload))
        mdat.fourCC("mdat")
        mdat.bytes.reserveCapacity(8 + payload)
        for s in samples { mdat.append(s.data) }
        return moof(dataOffset: Int32(size + 8)) + mdat.bytes
    }

    /// ISO-639-2/T code packed into 15 bits; "und" when unknown.
    static func packedLanguage(_ code: String) -> UInt16 {
        let letters = Array(code.lowercased().utf8)
        guard letters.count == 3, letters.allSatisfy({ (97...122).contains($0) }) else { return packedLanguage("und") }
        return letters.reduce(UInt16(0)) { $0 << 5 | UInt16($1 - 0x60) }
    }

    // MARK: Sample entries

    static func visualSampleEntry(_ type: String, width: Int, height: Int, children: [UInt8]) -> [UInt8] {
        box(type) { w in
            w.zeros(6); w.u16(1)
            w.u16(0); w.u16(0); w.zeros(12)
            w.u16(UInt16(clamping: width)); w.u16(UInt16(clamping: height))
            w.u32(0x0048_0000); w.u32(0x0048_0000); w.u32(0)
            w.u16(1); w.zeros(32); w.u16(0x0018); w.u16(0xFFFF)
            w.append(children)
        }
    }

    static func audioSampleEntry(_ type: String, channels: Int, sampleRate: Int, children: [UInt8]) -> [UInt8] {
        box(type) { w in
            w.zeros(6); w.u16(1)
            w.zeros(8)
            w.u16(UInt16(clamping: channels)); w.u16(16); w.u16(0); w.u16(0)
            w.u32(UInt32(clamping: min(sampleRate, 65535)) << 16)
            w.append(children)
        }
    }

    static func esds(objectType: UInt8, decoderSpecificInfo: [UInt8], bitrate: UInt32) -> [UInt8] {
        func descriptor(_ tag: UInt8, _ body: [UInt8]) -> [UInt8] {
            // Four-byte size form keeps every decoder happy.
            let n = body.count
            return [tag, 0x80 | UInt8((n >> 21) & 0x7F), 0x80 | UInt8((n >> 14) & 0x7F), 0x80 | UInt8((n >> 7) & 0x7F), UInt8(n & 0x7F)] + body
        }
        var config = Writer()
        config.u8(objectType)
        config.u8(0x15) // audio stream
        config.u24(0)
        config.u32(bitrate)
        config.u32(bitrate)
        if !decoderSpecificInfo.isEmpty { config.append(descriptor(0x05, decoderSpecificInfo)) }
        var es = Writer()
        es.u16(1)
        es.u8(0)
        es.append(descriptor(0x04, config.bytes))
        es.append(descriptor(0x06, [0x02]))
        return fullBox("esds") { w in w.append(descriptor(0x03, es.bytes)) }
    }

    static func colr(_ c: MatroskaColour) -> [UInt8] {
        box("colr") { w in
            w.fourCC("nclx")
            w.u16(UInt16(clamping: c.primaries ?? 2))
            w.u16(UInt16(clamping: c.transfer ?? 2))
            w.u16(UInt16(clamping: c.matrix ?? 2))
            w.u8(c.range == 2 ? 0x80 : 0)
        }
    }

    /// Mastering display colour volume: primaries in G, B, R order, units of 0.00002; luminance in 0.0001 cd/m².
    static func mdcv(_ m: [Double]) -> [UInt8] {
        box("mdcv") { w in
            let chroma = { (v: Double) in UInt16(clamping: Int((v * 50000).rounded())) }
            for pair in [(2, 3), (4, 5), (0, 1)] { w.u16(chroma(m[pair.0])); w.u16(chroma(m[pair.1])) }
            w.u16(chroma(m[6])); w.u16(chroma(m[7]))
            w.u32(UInt32(clamping: Int((m[8] * 10000).rounded())))
            w.u32(UInt32(clamping: Int((m[9] * 10000).rounded())))
        }
    }

    static func clli(maxCLL: Int, maxFALL: Int) -> [UInt8] {
        box("clli") { w in w.u16(UInt16(clamping: maxCLL)); w.u16(UInt16(clamping: maxFALL)) }
    }

    static func pasp(h: Int, v: Int) -> [UInt8] {
        box("pasp") { w in w.u32(UInt32(clamping: h)); w.u32(UInt32(clamping: v)) }
    }
}
