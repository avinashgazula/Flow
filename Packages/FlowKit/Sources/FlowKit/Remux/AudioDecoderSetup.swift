import Foundation

/// How a Matroska audio track the Apple player can't play is decoded: which decoder, with what
/// configuration, and how the decoded samples line up with the file's timestamps. The FFmpeg
/// decoders in the app and the tests' fakes both start from this, so the codec knowledge (Opus
/// headers, A_MS/ACM wave formats, PCM layouts) lives here, where it is unit-tested on every platform.
public struct AudioDecoderSetup: Equatable, Sendable {
    public enum Codec: String, Sendable {
        case dts, truehd, mlp
        case opus, vorbis, mp1, mp2, mp3, alac, wavPack, tta
        case wmaV1, wmaV2, wmaPro, wmaLossless
        case adpcmMS, adpcmIMAWAV, alaw, mulaw
        case ac3, eac3
        /// Uncompressed samples, decoded by `PCMDecoder` without FFmpeg.
        case pcm

        /// What the audio menu calls it ("Opus 5.1").
        public var displayName: String {
            switch self {
            case .dts: return "DTS"
            case .truehd, .mlp: return "Dolby TrueHD"
            case .opus: return "Opus"
            case .vorbis: return "Vorbis"
            case .mp1: return "MP1"
            case .mp2: return "MP2"
            case .mp3: return "MP3"
            case .alac: return "ALAC"
            case .wavPack: return "WavPack"
            case .tta: return "TTA"
            case .wmaV1, .wmaV2: return "WMA"
            case .wmaPro: return "WMA Pro"
            case .wmaLossless: return "WMA Lossless"
            case .adpcmMS, .adpcmIMAWAV: return "ADPCM"
            case .alaw: return "A-law"
            case .mulaw: return "µ-law"
            case .ac3: return "Dolby Digital"
            case .eac3: return "Dolby Digital Plus"
            case .pcm: return "PCM"
            }
        }
    }

    public var codec: Codec
    /// What the decoder's header or "extra data" holds (Opus's OpusHead, Vorbis's laced headers, a WMA codec setup).
    public var extradata: [UInt8]
    /// Of the decoded audio: always 48 kHz for Opus, whatever the header says.
    public var sampleRate: Int
    public var channels: Int
    /// A_MS/ACM formats: the size of one compressed block, and the bits of one coded sample.
    public var blockAlign = 0
    public var bitsPerCodedSample = 0
    public var bitRate = 0
    public var pcm: PCMFormat?
    /// Opus: decoded samples to throw away at the very start of the stream (the encoder's lead-in).
    public var preSkip = 0
    /// Opus: how far block timestamps run ahead of the sound they carry, in samples (Matroska's CodecDelay).
    public var timestampLead = 0
    /// Opus: samples to decode before a seek target, so the decoder has warmed up and doesn't click (Matroska's SeekPreRoll).
    public var seekPreRoll = 0

    /// The Matroska codec IDs the app can decode and re-encode as FLAC.
    public static let codecIDs: Set<String> = ["A_DTS", "A_TRUEHD", "A_MLP", "A_OPUS", "A_VORBIS", "A_MPEG/L1", "A_MPEG/L2", "A_ALAC",
                                               "A_WAVPACK4", "A_TTA1", "A_MS/ACM", "A_PCM/INT/LIT", "A_PCM/INT/BIG", "A_PCM/FLOAT/IEEE"]

    /// Opus counts its pre-skip and pre-roll in 48 kHz samples, whatever the file's sample rate.
    public static let opusRate = 48_000

    public static func resolve(for track: MatroskaTrack) -> AudioDecoderSetup? {
        resolve(codecID: track.codecID, codecPrivate: track.codecPrivate, sampleRate: Int(track.sampleRate), channels: track.channels,
                bitDepth: track.bitDepth, codecDelay: track.codecDelay, seekPreRoll: track.seekPreRoll)
    }

    /// nil when `codecID` isn't one of `codecIDs`, or its configuration can't be understood.
    public static func resolve(codecID: String, codecPrivate: [UInt8], sampleRate: Int, channels: Int, bitDepth: Int? = nil,
                               codecDelay: Int64 = 0, seekPreRoll: Int64? = nil) -> AudioDecoderSetup? {
        func plain(_ codec: Codec, extradata: [UInt8] = codecPrivate) -> AudioDecoderSetup {
            AudioDecoderSetup(codec: codec, extradata: extradata, sampleRate: sampleRate, channels: channels)
        }
        switch codecID {
        case "A_DTS": return clamped(plain(.dts))
        case "A_TRUEHD": return clamped(plain(.truehd))
        case "A_MLP": return clamped(plain(.mlp))
        case "A_OPUS":
            let head = OpusHead.parse(codecPrivate)
            let channelCount = head?.channels ?? channels
            guard channelCount > 0 else { return nil }
            guard let extradata = head != nil ? codecPrivate : OpusHead.make(channels: channelCount, preSkip: OpusHead.defaultPreSkip, inputRate: sampleRate) else { return nil }
            var setup = AudioDecoderSetup(codec: .opus, extradata: extradata, sampleRate: opusRate, channels: channelCount)
            setup.preSkip = head?.preSkip ?? (codecDelay > 0 ? nanosecondsToOpusSamples(codecDelay) : OpusHead.defaultPreSkip)
            setup.timestampLead = codecDelay > 0 ? nanosecondsToOpusSamples(codecDelay) : setup.preSkip
            setup.seekPreRoll = nanosecondsToOpusSamples(seekPreRoll.flatMap { $0 > 0 ? $0 : nil } ?? 80_000_000)
            return setup
        case "A_VORBIS":
            // The decoder believes its own identification header over the track's numbers, so do the same.
            guard let id = VorbisIdentification.parse(codecPrivate) else { return nil }
            return AudioDecoderSetup(codec: .vorbis, extradata: codecPrivate, sampleRate: id.sampleRate, channels: id.channels)
        case "A_MPEG/L2": return plain(.mp2, extradata: [])
        case "A_MPEG/L1": return plain(.mp1, extradata: [])
        case "A_ALAC":
            guard let cookie = ALACCookie.parse(codecPrivate) else { return nil }
            return AudioDecoderSetup(codec: .alac, extradata: cookie.atom, sampleRate: sampleRate > 0 ? sampleRate : cookie.sampleRate,
                                     channels: channels > 0 ? channels : cookie.channels)
        case "A_WAVPACK4": return plain(.wavPack)
        case "A_TTA1":
            let header = codecPrivate.count >= 22 ? codecPrivate : TTAHeader.make(channels: channels, bitsPerSample: bitDepth ?? 16, sampleRate: sampleRate)
            return plain(.tta, extradata: header)
        case "A_MS/ACM":
            guard let format = WaveFormat.parse(codecPrivate) else { return nil }
            return acm(format)
        case "A_PCM/INT/LIT", "A_PCM/INT/BIG", "A_PCM/FLOAT/IEEE":
            guard let format = PCMFormat(codecID: codecID, bitDepth: bitDepth, channels: channels) else { return nil }
            var setup = plain(.pcm, extradata: [])
            setup.pcm = format
            setup.bitsPerCodedSample = format.bitsPerSample
            return setup
        default:
            return nil
        }
    }

    private static func clamped(_ setup: AudioDecoderSetup) -> AudioDecoderSetup {
        var s = setup
        s.channels = max(1, min(8, s.channels))
        return s
    }

    /// Windows' wave format tags (what A_MS/ACM tracks carry in CodecPrivate) to decoders.
    private static func acm(_ f: WaveFormat) -> AudioDecoderSetup? {
        guard f.channels > 0, f.sampleRate > 0 else { return nil }
        var setup = AudioDecoderSetup(codec: .pcm, extradata: f.extra, sampleRate: f.sampleRate, channels: f.channels)
        setup.blockAlign = f.blockAlign
        setup.bitsPerCodedSample = f.bitsPerSample
        setup.bitRate = f.bytesPerSecond * 8
        switch f.effectiveTag {
        case WaveFormat.pcm, WaveFormat.ieeeFloat:
            guard let format = PCMFormat(bitsPerSample: f.bitsPerSample, isFloat: f.effectiveTag == WaveFormat.ieeeFloat, bigEndian: false, channels: f.channels) else { return nil }
            setup.pcm = format
        case 0x0002: setup.codec = .adpcmMS
        case 0x0011: setup.codec = .adpcmIMAWAV
        case 0x0006: setup.codec = .alaw
        case 0x0007: setup.codec = .mulaw
        case 0x0050: setup.codec = .mp2
        case 0x0055: setup.codec = .mp3
        case 0x2000: setup.codec = .ac3
        case 0x2001: setup.codec = .dts
        case 0x0160: setup.codec = .wmaV1
        case 0x0161: setup.codec = .wmaV2
        case 0x0162: setup.codec = .wmaPro
        case 0x0163: setup.codec = .wmaLossless
        default: return nil
        }
        return setup
    }

    /// A corrupt CodecDelay can be up to 2^48 ns, which times 48,000 overflows; a day is far beyond any real delay.
    static func nanosecondsToOpusSamples(_ ns: Int64) -> Int {
        let clamped = max(0, min(ns, 86_400 * 1_000_000_000))
        return Int(clamped * Int64(opusRate) / 1_000_000_000)
    }
}

// MARK: PCM

/// Uncompressed audio as Matroska stores it: A_PCM/INT/LIT, A_PCM/INT/BIG and A_PCM/FLOAT/IEEE.
public struct PCMFormat: Equatable, Sendable {
    public var bitsPerSample: Int
    public var isFloat: Bool
    public var bigEndian: Bool
    public var channels: Int

    public init?(bitsPerSample: Int, isFloat: Bool, bigEndian: Bool, channels: Int) {
        guard (1...8).contains(channels) else { return nil }
        guard isFloat ? [32, 64].contains(bitsPerSample) : [8, 16, 24, 32].contains(bitsPerSample) else { return nil }
        self.bitsPerSample = bitsPerSample
        self.isFloat = isFloat
        self.bigEndian = bigEndian
        self.channels = channels
    }

    public init?(codecID: String, bitDepth: Int?, channels: Int) {
        guard let bits = bitDepth else { return nil }
        self.init(bitsPerSample: bits, isFloat: codecID == "A_PCM/FLOAT/IEEE", bigEndian: codecID == "A_PCM/INT/BIG", channels: channels)
    }

    var bytesPerSample: Int { bitsPerSample / 8 }
}

/// Turns PCM frames into the 24-bit samples the FLAC encoder takes. Samples are already in WAVE channel
/// order, so there is nothing to reorder; 8-bit PCM is unsigned (as in WAVE files), the rest signed.
public final class PCMDecoder: AudioDecoding {
    private let format: PCMFormat

    public init(format: PCMFormat) { self.format = format }

    public func reset() {}

    @_optimize(speed) public func decode(_ frame: [UInt8]) -> [Int32] {
        let width = format.bytesPerSample
        let count = frame.count / (width * format.channels) * format.channels
        guard count > 0 else { return [] }
        var out = [Int32](repeating: 0, count: count)
        let big = format.bigEndian
        frame.withUnsafeBufferPointer { b in
            func unsigned(_ i: Int, _ bytes: Int) -> UInt64 {
                var v: UInt64 = 0
                for k in 0..<bytes {
                    let byte = UInt64(b[i * bytes + (big ? k : bytes - 1 - k)])
                    v = v << 8 | byte
                }
                return v
            }
            for i in 0..<count {
                switch (format.isFloat, format.bitsPerSample) {
                case (false, 8): out[i] = (Int32(b[i]) - 128) << 16
                case (false, 16): out[i] = Int32(Int16(truncatingIfNeeded: unsigned(i, 2))) << 8
                case (false, 24):
                    let u = Int32(truncatingIfNeeded: unsigned(i, 3))
                    out[i] = (u << 8) >> 8
                case (false, 32): out[i] = Int32(truncatingIfNeeded: unsigned(i, 4)) >> 8
                case (true, 32): out[i] = Self.scale(Double(Float(bitPattern: UInt32(truncatingIfNeeded: unsigned(i, 4)))))
                default: out[i] = Self.scale(Double(bitPattern: unsigned(i, 8)))
                }
            }
        }
        return out
    }

    static func scale(_ v: Double) -> Int32 {
        guard v.isFinite else { return 0 }
        return Int32(max(-8_388_608, min(8_388_607, (v * 8_388_607).rounded())))
    }
}

// MARK: Codec headers

/// Opus's identification header, which Matroska stores as CodecPrivate.
public struct OpusHead: Equatable, Sendable {
    public var channels: Int
    /// 48 kHz samples the decoder produces before the first one that belongs to the music.
    public var preSkip: Int
    public var inputRate: Int
    public var mappingFamily: Int

    public static let defaultPreSkip = 312

    public static func parse(_ b: [UInt8]) -> OpusHead? {
        guard b.count >= 19, Array(b[0..<8]) == Array("OpusHead".utf8), b[8] == 1, b[9] > 0 else { return nil }
        return OpusHead(channels: Int(b[9]), preSkip: Int(b[10]) | Int(b[11]) << 8,
                        inputRate: Int(b[12]) | Int(b[13]) << 8 | Int(b[14]) << 16 | Int(b[15]) << 24, mappingFamily: Int(b[18]))
    }

    /// A header for the rare file without CodecPrivate. Only mono and stereo need no channel table.
    public static func make(channels: Int, preSkip: Int, inputRate: Int) -> [UInt8]? {
        guard (1...2).contains(channels) else { return nil }
        var out = Array("OpusHead".utf8) + [1, UInt8(channels), UInt8(preSkip & 0xFF), UInt8(preSkip >> 8)]
        let rate = UInt32(max(0, inputRate))
        out += [UInt8(rate & 0xFF), UInt8((rate >> 8) & 0xFF), UInt8((rate >> 16) & 0xFF), UInt8(rate >> 24)]
        return out + [0, 0, 0]
    }
}

/// The first of Vorbis's three headers, from the Xiph-laced CodecPrivate (a count byte of 2, two lengths, then the headers).
struct VorbisIdentification {
    var channels: Int
    var sampleRate: Int

    static func parse(_ b: [UInt8]) -> VorbisIdentification? {
        guard b.count > 8, b[0] == 2 else { return nil }
        var i = 1
        for _ in 0..<2 {
            while i < b.count, b[i] == 255 { i += 1 }
            i += 1
        }
        guard i + 16 <= b.count, b[i] == 1, Array(b[(i + 1)..<(i + 7)]) == Array("vorbis".utf8) else { return nil }
        let rate = Int(b[i + 12]) | Int(b[i + 13]) << 8 | Int(b[i + 14]) << 16 | Int(b[i + 15]) << 24
        guard b[i + 11] > 0, rate > 0 else { return nil }
        return VorbisIdentification(channels: Int(b[i + 11]), sampleRate: rate)
    }
}

/// ALAC's "magic cookie": 24 bytes of configuration, which FFmpeg wants wrapped in an `alac` atom.
struct ALACCookie {
    var atom: [UInt8]
    var channels: Int
    var sampleRate: Int

    static func parse(_ b: [UInt8]) -> ALACCookie? {
        let wrapped = b.count >= 36 && Array(b[4..<8]) == Array("alac".utf8)
        let cookie = wrapped ? Array(b[12...]) : b
        guard cookie.count >= 24 else { return nil }
        let rate = Int(cookie[20]) << 24 | Int(cookie[21]) << 16 | Int(cookie[22]) << 8 | Int(cookie[23])
        var atom = b
        if !wrapped {
            let size = UInt32(12 + b.count)
            atom = [UInt8(size >> 24), UInt8((size >> 16) & 0xFF), UInt8((size >> 8) & 0xFF), UInt8(size & 0xFF)] + Array("alac".utf8) + [0, 0, 0, 0] + b
        }
        return ALACCookie(atom: atom, channels: Int(cookie[9]), sampleRate: rate)
    }
}

/// The 22-byte True Audio header, for files whose CodecPrivate left it out.
enum TTAHeader {
    static func make(channels: Int, bitsPerSample: Int, sampleRate: Int) -> [UInt8] {
        func le(_ v: Int, _ n: Int) -> [UInt8] { (0..<n).map { UInt8((v >> (8 * $0)) & 0xFF) } }
        return Array("TTA1".utf8) + le(1, 2) + le(channels, 2) + le(bitsPerSample, 2) + le(sampleRate, 4) + le(0xFFFF_FFFF, 4) + le(0, 4)
    }
}

/// A Windows WAVEFORMATEX (or WAVEFORMATEXTENSIBLE), which A_MS/ACM tracks keep in CodecPrivate.
public struct WaveFormat: Equatable, Sendable {
    public static let pcm = 0x0001
    public static let ieeeFloat = 0x0003
    public static let extensible = 0xFFFE

    public var tag: Int
    public var channels: Int
    public var sampleRate: Int
    public var bytesPerSecond: Int
    public var blockAlign: Int
    public var bitsPerSample: Int
    /// The bytes after the 18-byte header (for WAVEFORMATEXTENSIBLE: after its 22-byte extension).
    public var extra: [UInt8]
    /// For WAVEFORMATEXTENSIBLE, the format tag its SubFormat GUID starts with.
    var subFormat: Int?

    /// What the track really holds: the SubFormat of an "extensible" header, else the tag itself.
    public var effectiveTag: Int { tag == Self.extensible ? (subFormat ?? tag) : tag }

    public static func parse(_ b: [UInt8]) -> WaveFormat? {
        guard b.count >= 16 else { return nil }
        func u16(_ i: Int) -> Int { Int(b[i]) | Int(b[i + 1]) << 8 }
        func u32(_ i: Int) -> Int { u16(i) | u16(i + 2) << 16 }
        var format = WaveFormat(tag: u16(0), channels: u16(2), sampleRate: u32(4), bytesPerSecond: u32(8), blockAlign: u16(12), bitsPerSample: u16(14), extra: [])
        let declared = b.count >= 18 ? u16(16) : 0
        let extra = b.count > 18 ? Array(b[18..<min(b.count, 18 + declared)]) : []
        if format.tag == extensible, extra.count >= 22 {
            format.subFormat = Int(extra[6]) | Int(extra[7]) << 8
            format.extra = Array(extra[22...])
        } else {
            format.extra = extra
        }
        return format
    }
}

// MARK: Channel order

/// Where each decoded channel belongs in WAVE order (L R C LFE BL BR SL SR), which is what FLAC and the
/// remuxer's `AudioDecoding` contract use.
public enum AudioChannelOrder {
    /// Vorbis, and Opus's surround mapping, order channels for the codec's convenience, not WAVE's. Entry `i`
    /// is the Vorbis channel that WAVE channel `i` takes. Layouts: 3: L C R; 4: L R BL BR; 5: L C R BL BR;
    /// 6: L C R BL BR LFE; 7: L C R SL SR BC LFE; 8: L C R SL SR BL BR LFE.
    public static func waveFromVorbis(channels: Int) -> [Int] {
        switch channels {
        case 3: return [0, 2, 1]
        case 5: return [0, 2, 1, 3, 4]
        case 6: return [0, 2, 1, 5, 3, 4]
        case 7: return [0, 2, 1, 6, 5, 3, 4]
        case 8: return [0, 2, 1, 7, 5, 6, 3, 4]
        default: return Array(0..<max(0, channels))
        }
    }

    /// For channels named by FFmpeg's channel IDs (AV_CHAN_FRONT_LEFT = 0 … in WAVE's own order, so sorting by
    /// ID gives WAVE order): entry `i` is the decoded channel that WAVE channel `i` takes.
    public static func waveOrder(forChannelIDs ids: [Int]) -> [Int] {
        ids.indices.sorted { ids[$0] != ids[$1] ? ids[$0] < ids[$1] : $0 < $1 }
    }
}
