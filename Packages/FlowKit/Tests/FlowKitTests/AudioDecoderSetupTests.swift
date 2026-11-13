import XCTest
@testable import FlowKit

/// A just-enough FLAC decoder for the encoder's output (constant, verbatim and fixed-predictor subframes with
/// Rice-coded residuals), so tests can check that what goes into the encoder comes back out exactly.
enum TestFLAC {
    private struct Bits {
        let bytes: [UInt8]
        var position = 0
        init(_ bytes: [UInt8]) { self.bytes = bytes }
        mutating func read(_ n: Int) -> UInt64 {
            var v: UInt64 = 0
            for _ in 0..<n {
                let byte = bytes[position >> 3]
                v = v << 1 | UInt64((byte >> (7 - UInt8(position & 7))) & 1)
                position += 1
            }
            return v
        }
        mutating func signed(_ n: Int) -> Int64 {
            let v = read(n)
            return n == 0 ? 0 : Int64(bitPattern: v << UInt64(64 - n)) >> Int64(64 - n)
        }
        mutating func unary() -> UInt64 {
            var q: UInt64 = 0
            while read(1) == 0 { q += 1 }
            return q
        }
    }

    /// One frame's samples, interleaved.
    static func decode(frame: [UInt8], channels: Int, bitsPerSample: Int) -> [Int32] {
        var r = Bits(frame)
        let sync = r.read(14)
        precondition(sync == 0x3FFE, "frame sync")
        _ = r.read(2)
        let sizeCode = Int(r.read(4))
        let rateCode = Int(r.read(4))
        _ = r.read(4 + 3 + 1)
        let lead = Int(r.read(8))
        var extra = 0
        while lead & (0x80 >> extra) != 0 && extra < 7 { extra += 1 }
        if extra > 1 { _ = r.read(8 * (extra - 1)) }
        var blockSize = 4096
        switch sizeCode {
        case 7: blockSize = Int(r.read(16)) + 1
        case 6: blockSize = Int(r.read(8)) + 1
        case 12: blockSize = 4096
        default: preconditionFailure("block size code \(sizeCode)")
        }
        if rateCode == 12 { _ = r.read(8) } else if rateCode == 13 || rateCode == 14 { _ = r.read(16) }
        _ = r.read(8)   // header CRC
        var out = [Int32](repeating: 0, count: blockSize * channels)
        for c in 0..<channels {
            _ = r.read(1)
            let type = Int(r.read(6))
            let wasted = r.read(1)
            precondition(wasted == 0, "wasted bits aren't written by the encoder")
            var x = [Int64](repeating: 0, count: blockSize)
            if type == 0 {
                let v = r.signed(bitsPerSample)
                x = [Int64](repeating: v, count: blockSize)
            } else if type == 1 {
                for i in 0..<blockSize { x[i] = r.signed(bitsPerSample) }
            } else {
                let order = type - 8
                for i in 0..<order { x[i] = r.signed(bitsPerSample) }
                let method = Int(r.read(2))
                let paramBits = method == 0 ? 4 : 5
                let partitionOrder = Int(r.read(4))
                let size = blockSize >> partitionOrder
                for p in 0..<(1 << partitionOrder) {
                    let k = Int(r.read(paramBits))
                    let count = p == 0 ? size - order : size
                    let start = p == 0 ? order : p * size
                    for i in start..<(start + count) {
                        let u = r.unary() << UInt64(k) | (k > 0 ? r.read(k) : 0)
                        let e = Int64(u >> 1) ^ -Int64(u & 1)
                        switch order {
                        case 0: x[i] = e
                        case 1: x[i] = e + x[i - 1]
                        case 2: x[i] = e + 2 * x[i - 1] - x[i - 2]
                        case 3: x[i] = e + 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3]
                        default: x[i] = e + 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4]
                        }
                    }
                }
            }
            for i in 0..<blockSize { out[i * channels + c] = Int32(x[i]) }
        }
        return out
    }

    /// Encodes `samples` (interleaved) frame by frame, decodes them again and returns what came out.
    static func roundTrip(_ samples: [Int32], channels: Int, sampleRate: Int) -> [Int32] {
        var encoder = FLACEncoder(sampleRate: sampleRate, channels: channels, bitsPerSample: 24)
        var out: [Int32] = []
        let frames = samples.count / channels
        var offset = 0
        samples.withUnsafeBufferPointer { buffer in
            while offset < frames {
                let count = min(FLACEncoder.blockSize, frames - offset)
                let slice = UnsafeBufferPointer(rebasing: buffer[(offset * channels)..<((offset + count) * channels)])
                out += decode(frame: encoder.encodeFrame(slice, count: count), channels: channels, bitsPerSample: 24)
                offset += count
            }
        }
        return out
    }
}

final class PCMTests: XCTestCase {
    private func le(_ v: UInt64, _ bytes: Int) -> [UInt8] { (0..<bytes).map { UInt8((v >> UInt64(8 * $0)) & 0xFF) } }
    private func be(_ v: UInt64, _ bytes: Int) -> [UInt8] { le(v, bytes).reversed() }

    func testExactValuesForEveryFlavour() {
        func decode(_ format: PCMFormat, _ bytes: [UInt8]) -> [Int32] { PCMDecoder(format: format).decode(bytes) }
        let u8 = PCMFormat(bitsPerSample: 8, isFloat: false, bigEndian: false, channels: 1)!
        XCTAssertEqual(decode(u8, [0x80, 0xFF, 0x00]), [0, 127 << 16, -128 << 16], "8-bit PCM is unsigned")
        let s16 = PCMFormat(bitsPerSample: 16, isFloat: false, bigEndian: false, channels: 2)!
        XCTAssertEqual(decode(s16, [0x34, 0x12, 0x00, 0x80]), [0x1234 << 8, -32768 << 8])
        let s16be = PCMFormat(bitsPerSample: 16, isFloat: false, bigEndian: true, channels: 2)!
        XCTAssertEqual(decode(s16be, [0x12, 0x34, 0x80, 0x00]), [0x1234 << 8, -32768 << 8])
        let s24 = PCMFormat(bitsPerSample: 24, isFloat: false, bigEndian: false, channels: 1)!
        XCTAssertEqual(decode(s24, [0x56, 0x34, 0x12, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x80]), [0x123456, -1, -8_388_608])
        let s24be = PCMFormat(bitsPerSample: 24, isFloat: false, bigEndian: true, channels: 1)!
        XCTAssertEqual(decode(s24be, [0x12, 0x34, 0x56, 0x80, 0x00, 0x00]), [0x123456, -8_388_608])
        let s32 = PCMFormat(bitsPerSample: 32, isFloat: false, bigEndian: false, channels: 1)!
        XCTAssertEqual(decode(s32, [0x78, 0x56, 0x34, 0x12, 0x00, 0x00, 0x00, 0x80]), [0x123456, -8_388_608], "the low 8 bits go")
        let f32 = PCMFormat(bitsPerSample: 32, isFloat: true, bigEndian: false, channels: 1)!
        XCTAssertEqual(decode(f32, le(UInt64(Float(1).bitPattern), 4) + le(UInt64(Float(-0.5).bitPattern), 4) + le(UInt64(Float(2).bitPattern), 4)
                              + le(UInt64(Float.nan.bitPattern), 4)), [8_388_607, -4_194_304, 8_388_607, 0], "clipped, not wrapped")
        let f64 = PCMFormat(bitsPerSample: 64, isFloat: true, bigEndian: false, channels: 1)!
        XCTAssertEqual(decode(f64, le(Double(-1).bitPattern, 8)), [-8_388_607])
    }

    func testIncompleteSampleFramesAreDropped() {
        let stereo = PCMFormat(bitsPerSample: 16, isFloat: false, bigEndian: false, channels: 2)!
        XCTAssertEqual(PCMDecoder(format: stereo).decode([1, 0, 2, 0, 3, 0]).count, 2, "three samples hold one stereo frame")
        XCTAssertTrue(PCMDecoder(format: stereo).decode([]).isEmpty)
    }

    func testFormatsFromMatroskaCodecIDs() {
        XCTAssertEqual(PCMFormat(codecID: "A_PCM/INT/BIG", bitDepth: 24, channels: 6), PCMFormat(bitsPerSample: 24, isFloat: false, bigEndian: true, channels: 6))
        XCTAssertEqual(PCMFormat(codecID: "A_PCM/FLOAT/IEEE", bitDepth: 32, channels: 2)?.isFloat, true)
        XCTAssertNil(PCMFormat(codecID: "A_PCM/INT/LIT", bitDepth: 12, channels: 2))
        XCTAssertNil(PCMFormat(codecID: "A_PCM/INT/LIT", bitDepth: nil, channels: 2))
        XCTAssertNil(PCMFormat(codecID: "A_PCM/INT/LIT", bitDepth: 16, channels: 9), "more than 7.1")
    }

    /// Every flavour, through the FLAC encoder and a FLAC decoder, comes back as the same samples.
    func testEveryFlavourSurvivesFLACBitExactly() {
        var seed: UInt64 = 99
        func random() -> UInt64 { seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407; return seed >> 11 }
        let frames = FLACEncoder.blockSize + 321
        for (bits, isFloat, big) in [(8, false, false), (16, false, false), (16, false, true), (24, false, false), (24, false, true),
                                      (32, false, false), (32, false, true), (32, true, false), (64, true, false)] {
            let channels = 2
            let format = PCMFormat(bitsPerSample: bits, isFloat: isFloat, bigEndian: big, channels: channels)!
            var bytes: [UInt8] = []
            for i in 0..<(frames * channels) {
                // A tone with noise for the first half, then full-scale extremes and silence.
                let tone = sin(Double(i / channels) / 20) * 0.6 + (Double(random() % 1000) - 500) / 5000
                let value: Double = i < frames ? tone : [1.0, -1.0, 0.0, 0.999][i % 4]
                if isFloat {
                    bytes += bits == 32 ? le(UInt64(Float(value).bitPattern), 4) : le(value.bitPattern, 8)
                } else if bits == 8 {
                    bytes.append(UInt8(max(0, min(255, (value * 127).rounded() + 128))))
                } else {
                    let scale = Double((1 << (bits - 1)) - 1)
                    let v = Int64((value * scale).rounded())
                    let u = UInt64(bitPattern: v) & ((1 << UInt64(bits)) - 1)
                    bytes += big ? self.be(u, bits / 8) : le(u, bits / 8)
                }
            }
            let decoded = PCMDecoder(format: format).decode(bytes)
            XCTAssertEqual(decoded.count, frames * channels, "\(bits)-bit \(isFloat ? "float" : "integer") \(big ? "big" : "little") endian")
            let back = TestFLAC.roundTrip(decoded, channels: channels, sampleRate: 48000)
            XCTAssertTrue(back == decoded, "\(bits)-bit \(isFloat ? "float" : "integer") \(big ? "big" : "little") endian: FLAC returned different samples")
        }
    }
}

final class ChannelOrderTests: XCTestCase {
    private func reordered(_ vorbis: [String]) -> [String] {
        AudioChannelOrder.waveFromVorbis(channels: vorbis.count).map { vorbis[$0] }
    }

    func testVorbisAndOpusSurroundOrderBecomesWaveOrder() {
        XCTAssertEqual(reordered(["M"]), ["M"])
        XCTAssertEqual(reordered(["L", "R"]), ["L", "R"])
        XCTAssertEqual(reordered(["L", "C", "R"]), ["L", "R", "C"])
        XCTAssertEqual(reordered(["L", "R", "BL", "BR"]), ["L", "R", "BL", "BR"])
        XCTAssertEqual(reordered(["L", "C", "R", "BL", "BR"]), ["L", "R", "C", "BL", "BR"])
        XCTAssertEqual(reordered(["L", "C", "R", "BL", "BR", "LFE"]), ["L", "R", "C", "LFE", "BL", "BR"], "5.1")
        XCTAssertEqual(reordered(["L", "C", "R", "SL", "SR", "BC", "LFE"]), ["L", "R", "C", "LFE", "BC", "SL", "SR"], "6.1")
        XCTAssertEqual(reordered(["L", "C", "R", "SL", "SR", "BL", "BR", "LFE"]), ["L", "R", "C", "LFE", "BL", "BR", "SL", "SR"], "7.1")
        for n in 1...8 { XCTAssertEqual(Set(AudioChannelOrder.waveFromVorbis(channels: n)), Set(0..<n), "\(n) channels: a permutation") }
    }

    func testFFmpegChannelIDsSortIntoWaveOrder() {
        // AV_CHAN_FRONT_LEFT 0, FRONT_RIGHT 1, FRONT_CENTER 2, LOW_FREQUENCY 3, BACK_LEFT 4, BACK_RIGHT 5, SIDE_LEFT 9, SIDE_RIGHT 10.
        XCTAssertEqual(AudioChannelOrder.waveOrder(forChannelIDs: [0, 1, 2, 3, 9, 10]), [0, 1, 2, 3, 4, 5])
        XCTAssertEqual(AudioChannelOrder.waveOrder(forChannelIDs: [2, 0, 1]), [1, 2, 0])
        XCTAssertEqual(AudioChannelOrder.waveOrder(forChannelIDs: [0, 1, 2, 3, 10, 9, 5, 4]), [0, 1, 2, 3, 7, 6, 5, 4])
    }
}

final class AudioDecoderSetupTests: XCTestCase {
    private func track(_ name: String, codec: String) async throws -> MatroskaTrack {
        let header = try await MatroskaReader.readHeader(FileByteSource(url: MatroskaTests.fixture(name)))
        return try XCTUnwrap(header.tracks.first { $0.codecID == codec })
    }

    func testOpusHeadAndTiming() async throws {
        let t = try await track("opus", codec: "A_OPUS")
        let setup = try XCTUnwrap(AudioDecoderSetup.resolve(for: t))
        XCTAssertEqual(setup.codec, .opus)
        XCTAssertEqual(setup.sampleRate, 48000)
        XCTAssertEqual(setup.preSkip, 312, "the encoder's lead-in, from OpusHead")
        XCTAssertEqual(setup.timestampLead, 312, "CodecDelay of 6.5 ms")
        XCTAssertEqual(setup.seekPreRoll, 3840, "80 ms")
        let head = try XCTUnwrap(OpusHead.parse(t.codecPrivate))
        XCTAssertEqual(head.channels, setup.channels)
        XCTAssertEqual(setup.extradata, t.codecPrivate)
    }

    func testOpusTimingFollowsCodecDelayAndSeekPreRoll() {
        var head = Array("OpusHead".utf8) + [1, 2, 0x80, 0x02] + [0x80, 0xBB, 0, 0] + [0, 0, 0]   // pre-skip 640, 48000 Hz input
        var setup = AudioDecoderSetup.resolve(codecID: "A_OPUS", codecPrivate: head, sampleRate: 48000, channels: 2, codecDelay: 13_333_333, seekPreRoll: 40_000_000)
        XCTAssertEqual(setup?.preSkip, 640)
        XCTAssertEqual(setup?.timestampLead, 639, "CodecDelay is in nanoseconds, and rounds down")
        XCTAssertEqual(setup?.seekPreRoll, 1920)
        // No CodecDelay: the pre-skip stands in, so the first sound still lands at time zero.
        setup = AudioDecoderSetup.resolve(codecID: "A_OPUS", codecPrivate: head, sampleRate: 44100, channels: 2)
        XCTAssertEqual(setup?.timestampLead, 640)
        XCTAssertEqual(setup?.sampleRate, 48000, "Opus always decodes at 48 kHz")
        // No CodecPrivate: a header is made for mono and stereo, never guessed for surround.
        head = []
        XCTAssertNotNil(OpusHead.parse(AudioDecoderSetup.resolve(codecID: "A_OPUS", codecPrivate: head, sampleRate: 48000, channels: 2)!.extradata))
        XCTAssertNil(AudioDecoderSetup.resolve(codecID: "A_OPUS", codecPrivate: head, sampleRate: 48000, channels: 6))
    }

    func testVorbisTakesItsOwnHeadersRateAndChannels() async throws {
        let t = try await track("audio-any", codec: "A_VORBIS")
        let setup = try XCTUnwrap(AudioDecoderSetup.resolve(for: t))
        XCTAssertEqual(setup.codec, .vorbis)
        XCTAssertEqual(setup.sampleRate, 44100, "not 48 kHz: FLAC carries 44.1 kHz as it is")
        XCTAssertEqual(setup.channels, 2)
        XCTAssertNil(AudioDecoderSetup.resolve(codecID: "A_VORBIS", codecPrivate: [1, 2, 3], sampleRate: 44100, channels: 2))
    }

    private func waveFormat(tag: Int, channels: Int, rate: Int, bytesPerSecond: Int, align: Int, bits: Int, extra: [UInt8]) -> [UInt8] {
        func u16(_ v: Int) -> [UInt8] { [UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)] }
        func u32(_ v: Int) -> [UInt8] { u16(v & 0xFFFF) + u16(v >> 16) }
        return u16(tag) + u16(channels) + u32(rate) + u32(bytesPerSecond) + u16(align) + u16(bits) + u16(extra.count) + extra
    }

    func testMicrosoftACMFormatsPickTheirDecoder() throws {
        func setup(_ tag: Int, channels: Int = 2, extra: [UInt8] = [], bits: Int = 16) -> AudioDecoderSetup? {
            let wf = waveFormat(tag: tag, channels: channels, rate: 44100, bytesPerSecond: 16000, align: 1486, bits: bits, extra: extra)
            return AudioDecoderSetup.resolve(codecID: "A_MS/ACM", codecPrivate: wf, sampleRate: 0, channels: 0)
        }
        XCTAssertEqual(setup(0x50)?.codec, .mp2)
        XCTAssertEqual(setup(0x55)?.codec, .mp3)
        XCTAssertEqual(setup(0x2000)?.codec, .ac3)
        XCTAssertEqual(setup(0x0002, bits: 4)?.codec, .adpcmMS)
        XCTAssertEqual(setup(0x0011, bits: 4)?.codec, .adpcmIMAWAV)
        XCTAssertEqual(setup(0x0006, bits: 8)?.codec, .alaw)
        XCTAssertEqual(setup(0x0007, bits: 8)?.codec, .mulaw)
        XCTAssertEqual(setup(0x0160)?.codec, .wmaV1)
        XCTAssertEqual(setup(0x0163)?.codec, .wmaLossless)
        XCTAssertNil(setup(0x7777), "an unknown format is reported, not guessed")
        let wma = try XCTUnwrap(setup(0x0161, extra: [0, 0, 0, 0, 0x0F, 0, 0, 0, 0, 0]))
        XCTAssertEqual(wma.codec, .wmaV2)
        XCTAssertEqual(wma.sampleRate, 44100)
        XCTAssertEqual(wma.channels, 2)
        XCTAssertEqual(wma.blockAlign, 1486)
        XCTAssertEqual(wma.bitRate, 128_000)
        XCTAssertEqual(wma.extradata.count, 10, "the codec's own setup bytes go to the decoder")
        let pcm = try XCTUnwrap(setup(0x0001, channels: 2, bits: 24))
        XCTAssertEqual(pcm.pcm, PCMFormat(bitsPerSample: 24, isFloat: false, bigEndian: false, channels: 2), "PCM in ACM needs no FFmpeg")
    }

    func testExtensibleFormatsUseTheirSubFormat() throws {
        // WAVEFORMATEXTENSIBLE: 22 more bytes (valid bits, channel mask, GUID starting with the real tag).
        let guid: [UInt8] = [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71]
        let extra: [UInt8] = [32, 0, 0x3F, 0, 0, 0] + guid
        let wf = waveFormat(tag: 0xFFFE, channels: 6, rate: 48000, bytesPerSecond: 48000 * 24, align: 24, bits: 32, extra: extra)
        let format = try XCTUnwrap(WaveFormat.parse(wf))
        XCTAssertEqual(format.effectiveTag, WaveFormat.ieeeFloat)
        let setup = try XCTUnwrap(AudioDecoderSetup.resolve(codecID: "A_MS/ACM", codecPrivate: wf, sampleRate: 0, channels: 0))
        XCTAssertEqual(setup.pcm, PCMFormat(bitsPerSample: 32, isFloat: true, bigEndian: false, channels: 6))
        XCTAssertNil(WaveFormat.parse([1, 0, 2]), "too short")
    }

    func testALACAndTTAHeaders() throws {
        var cookie = [UInt8](repeating: 0, count: 24)
        cookie[9] = 2
        cookie[20] = 0; cookie[21] = 0; cookie[22] = 0xAC; cookie[23] = 0x44   // 44100
        let setup = try XCTUnwrap(AudioDecoderSetup.resolve(codecID: "A_ALAC", codecPrivate: cookie, sampleRate: 0, channels: 0))
        XCTAssertEqual(setup.sampleRate, 44100)
        XCTAssertEqual(setup.channels, 2)
        XCTAssertEqual(setup.extradata.count, 36, "size, 'alac', version, then the cookie: what FFmpeg expects")
        XCTAssertEqual(Array(setup.extradata[4..<8]), Array("alac".utf8))
        XCTAssertEqual(setup.extradata[3], 36)
        let again = try XCTUnwrap(AudioDecoderSetup.resolve(codecID: "A_ALAC", codecPrivate: setup.extradata, sampleRate: 44100, channels: 2))
        XCTAssertEqual(again.extradata, setup.extradata, "an already wrapped cookie isn't wrapped twice")
        XCTAssertNil(AudioDecoderSetup.resolve(codecID: "A_ALAC", codecPrivate: [1, 2], sampleRate: 44100, channels: 2))

        let tta = try XCTUnwrap(AudioDecoderSetup.resolve(codecID: "A_TTA1", codecPrivate: [], sampleRate: 48000, channels: 2, bitDepth: 24))
        XCTAssertEqual(tta.extradata.count, 22)
        XCTAssertEqual(Array(tta.extradata.prefix(4)), Array("TTA1".utf8))
    }

    func testOnlyTheDecodableCodecsAreClaimed() {
        for id in ["A_AAC", "A_MPEG/L3", "A_AC3", "A_EAC3", "A_FLAC", "A_REAL/COOK", "A_QUICKTIME"] {
            XCTAssertFalse(AudioDecoderSetup.codecIDs.contains(id), "\(id) plays as it is or isn't handled")
            XCTAssertNil(AudioDecoderSetup.resolve(codecID: id, codecPrivate: [], sampleRate: 48000, channels: 2))
        }
    }
}

// MARK: Through the remuxer

private final class SilentDecoder: AudioDecoding {
    let channels: Int
    let frameSamples: Int
    var calls = 0
    var resets = 0
    init(channels: Int, frameSamples: Int) { self.channels = channels; self.frameSamples = frameSamples }
    func decode(_ frame: [UInt8]) -> [Int32] { calls += 1; return [Int32](repeating: 1000, count: frameSamples * channels) }
    func reset() { resets += 1 }
}

private final class RecordingProvider: AudioDecoderProvider, @unchecked Sendable {
    var made: [String: SilentDecoder] = [:]
    func makeDecoder(codecID: String, codecPrivate: [UInt8], sampleRate: Int, channels: Int) -> AudioDecoding? {
        guard let setup = AudioDecoderSetup.resolve(codecID: codecID, codecPrivate: codecPrivate, sampleRate: sampleRate, channels: channels) else { return nil }
        let decoder = SilentDecoder(channels: setup.channels, frameSamples: codecID == "A_OPUS" ? 960 : 1024)
        made[codecID] = decoder
        return decoder
    }
}

final class DecodedAudioTrackTests: XCTestCase {
    override func tearDown() { MatroskaRemuxer.audioDecoders = nil }

    /// Samples in a fragment, from its track run's durations.
    static func duration(_ b: [UInt8]) -> Int {
        guard let at = b.indices.dropLast(16).first(where: { b[$0] == 0x74 && b[$0 + 1] == 0x72 && b[$0 + 2] == 0x75 && b[$0 + 3] == 0x6E }) else { return 0 }
        func u32(_ i: Int) -> Int { Int(b[i]) << 24 | Int(b[i + 1]) << 16 | Int(b[i + 2]) << 8 | Int(b[i + 3]) }
        let count = u32(at + 8)
        return (0..<count).reduce(0) { $0 + u32(at + 16 + $1 * 12) }
    }

    func testOpusVorbisAndPCMTracksPlayAndAreLabelled() async throws {
        MatroskaRemuxer.audioDecoders = RecordingProvider()
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("audio-any")), targetSegment: 2)
        XCTAssertTrue(remuxer.skipped.isEmpty, "\(remuxer.skipped.map(\.reason))")
        XCTAssertEqual(remuxer.audio.map(\.label), ["English (Opus Stereo)", "Spanish (Vorbis Stereo)", "French (PCM Mono)"])
        XCTAssertEqual(remuxer.audio.map(\.timescale), [48000, 44100, 8000], "each track keeps its own sample rate")
        XCTAssertEqual(Set(remuxer.audio.map(\.codecString)), ["fLaC"])
        XCTAssertTrue(remuxer.audio.allSatisfy(\.isDecodedOnDevice))
        XCTAssertTrue(remuxer.hasPlayableSoundtrack)
        let master = await remuxer.masterPlaylist()
        XCTAssertTrue(master.contains("fLaC"))
    }

    func testViewersLanguageDecidesWhichDecodedTrackLeads() async throws {
        MatroskaRemuxer.audioDecoders = RecordingProvider()
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("audio-any")), targetSegment: 2, preferredAudioLanguage: "fr")
        XCTAssertEqual(remuxer.audio.first?.source.codecID, "A_PCM/INT/LIT")
    }

    func testWithoutDecodersEveryOneIsSkippedWithAReason() async throws {
        MatroskaRemuxer.audioDecoders = nil
        for name in ["audio-any", "opus"] {
            let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture(name)), targetSegment: 2)
            XCTAssertTrue(remuxer.audio.isEmpty, name)
            XCTAssertFalse(remuxer.hasPlayableSoundtrack, "the player says why instead of playing silence")
        }
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("audio-any")), targetSegment: 2)
        XCTAssertEqual(remuxer.skipped.map(\.reason), ["Opus audio", "Vorbis audio", "Uncompressed PCM audio"])
    }

    func testAnOpusSoundtrackWithTooManyChannelsSaysSo() {
        var t = MatroskaTrack(number: 1, kind: .audio)
        t.codecID = "A_OPUS"
        t.codecPrivate = Array("OpusHead".utf8) + [1, 9, 0x38, 0x01, 0x80, 0xBB, 0, 0, 0, 0, 2]
        t.channels = 9
        MatroskaRemuxer.audioDecoders = RecordingProvider()
        guard case .failure(let reason) = MatroskaRemuxer.output(for: t, firstFrame: nil) else { return XCTFail("9 channels can't be played") }
        XCTAssertEqual(reason.message, "Opus audio with 9 channels")
    }

    func testPCMAndACMTracksGetPlainLabels() {
        MatroskaRemuxer.audioDecoders = RecordingProvider()
        var pcm = MatroskaTrack(number: 1, kind: .audio)
        pcm.codecID = "A_PCM/INT/LIT"
        pcm.channels = 6
        pcm.sampleRate = 96000
        pcm.bitDepth = 24
        guard case .success(let out) = MatroskaRemuxer.output(for: pcm, firstFrame: nil) else { return XCTFail("PCM plays") }
        XCTAssertEqual(out.label, "English (PCM 5.1)")
        XCTAssertEqual(out.timescale, 96000, "FLAC carries 96 kHz as it is")
        XCTAssertEqual(MatroskaRemuxer.channelLayoutName(7), "6.1")
        XCTAssertEqual(MatroskaRemuxer.channelLayoutName(8), "7.1")
        XCTAssertEqual(MatroskaRemuxer.channelLayoutName(4), "4.0")
    }

    /// PCM needs no FFmpeg: with decoding on, what the player gets is the file's samples, exactly.
    func testPCMReachesThePlayerBitExactly() async throws {
        MatroskaRemuxer.audioDecoders = RecordingProvider()
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("audio-any")), targetSegment: 2)
        let pcm = try XCTUnwrap(remuxer.audio.first { $0.source.codecID == "A_PCM/INT/LIT" })
        // What the file holds, decoded straight from its blocks.
        let header = remuxer.header
        let file = [UInt8](try Data(contentsOf: MatroskaTests.fixture("audio-any")))
        let all = Array(file[Int(try XCTUnwrap(header.firstClusterPosition))...])
        let blocks = try MatroskaClusterParser.blocks(all, timecodeScale: header.timecodeScale, tracks: header.tracks).filter { $0.track == pcm.id }
        let format = try XCTUnwrap(PCMFormat(codecID: "A_PCM/INT/LIT", bitDepth: pcm.source.bitDepth, channels: pcm.source.channels))
        let expected = blocks.flatMap { $0.frames.flatMap { PCMDecoder(format: format).decode($0) } }
        XCTAssertGreaterThan(expected.count, 8000 * 7)

        var decoded: [Int32] = []
        var total = 0
        for s in remuxer.segments {
            let fragment = try await remuxer.mediaSegment(track: pcm.id, index: s.index) ?? []
            total += Self.duration(fragment)
            decoded += Self.flacFrames(fragment).flatMap { TestFLAC.decode(frame: $0, channels: 1, bitsPerSample: 24) }
        }
        XCTAssertEqual(total, expected.count)
        XCTAssertTrue(decoded.prefix(expected.count) == expected[...], "the FLAC the player decodes is the file's PCM")
    }

    /// The player gives up on a slow request and asks again: the second answer is the first, not another decode.
    func testARetriedSegmentIsAnsweredWithoutDecodingAgain() async throws {
        let provider = RecordingProvider()
        MatroskaRemuxer.audioDecoders = provider
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("opus")), targetSegment: 1)
        let opus = try XCTUnwrap(remuxer.audio.first { $0.source.channels == 2 })
        let first = try await remuxer.mediaSegment(track: opus.id, index: 0)
        let calls = try XCTUnwrap(provider.made["A_OPUS"]).calls
        let again = try await remuxer.mediaSegment(track: opus.id, index: 0)
        XCTAssertEqual(try XCTUnwrap(provider.made["A_OPUS"]).calls, calls)
        XCTAssertTrue(first == again)
    }

    /// The whole FLAC frames in a fragment's mdat, split by the run's sample sizes.
    static func flacFrames(_ b: [UInt8]) -> [[UInt8]] {
        guard let at = b.indices.dropLast(16).first(where: { b[$0] == 0x74 && b[$0 + 1] == 0x72 && b[$0 + 2] == 0x75 && b[$0 + 3] == 0x6E }) else { return [] }
        func u32(_ i: Int) -> Int { Int(b[i]) << 24 | Int(b[i + 1]) << 16 | Int(b[i + 2]) << 8 | Int(b[i + 3]) }
        let count = u32(at + 8)
        let mdat = b.indices.dropLast(8).first(where: { b[$0] == 0x6D && b[$0 + 1] == 0x64 && b[$0 + 2] == 0x61 && b[$0 + 3] == 0x74 })! + 4
        var offset = mdat
        var out: [[UInt8]] = []
        for k in 0..<count {
            let size = u32(at + 16 + k * 12 + 4)
            out.append(Array(b[offset..<(offset + size)]))
            offset += size
        }
        return out
    }

    func testOpusStartsAtTheRightTimeWithoutItsLeadIn() async throws {
        let provider = RecordingProvider()
        MatroskaRemuxer.audioDecoders = provider
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("opus")), targetSegment: 1)
        let opus = try XCTUnwrap(remuxer.audio.first { $0.source.channels == 2 })
        XCTAssertEqual(opus.label, "Japanese (Opus Stereo)")
        var total = 0
        var first: UInt64?
        for s in remuxer.segments {
            let fragment = try await remuxer.mediaSegment(track: opus.id, index: s.index) ?? []
            first = first ?? RemuxTests.baseDecodeTime(fragment)
            total += Self.duration(fragment)
        }
        let decoder = try XCTUnwrap(provider.made["A_OPUS"])
        XCTAssertGreaterThan(decoder.calls, 100)
        XCTAssertEqual(total, decoder.calls * 960 - 312, "the 312 samples of lead-in are gone, and nothing else")
        // Audio blocks run 6.5 ms ahead of their sound (CodecDelay), so the first real sample is at zero: the delay B-frames need, no more.
        XCTAssertEqual(Int(try XCTUnwrap(first)), Int(remuxer.presentationDelay * 48000 / 1_000_000_000), accuracy: 1)
    }

    func testSeekingWarmsOpusUpOnTheEndOfThePreviousSegment() async throws {
        let provider = RecordingProvider()
        MatroskaRemuxer.audioDecoders = provider
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("opus")), targetSegment: 1)
        let opus = try XCTUnwrap(remuxer.audio.first { $0.source.channels == 2 })
        let last = remuxer.segments.count - 1
        XCTAssertGreaterThan(last, 1)
        // The Opus blocks in the last segment's bytes.
        let file = [UInt8](try Data(contentsOf: MatroskaTests.fixture("opus")))
        let segment = remuxer.segments[last]
        let own = try MatroskaClusterParser.blocks(MatroskaRemuxer.fromFirstCluster(Array(file[Int(segment.byteStart)..<Int(segment.byteEnd)])),
                                                   timecodeScale: remuxer.header.timecodeScale, tracks: remuxer.header.tracks).filter { $0.track == opus.id }
        XCTAssertFalse(own.isEmpty)

        // A seek straight to it: a fresh decoder, which first decodes about 100 ms of the segment before.
        let seeker = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("opus")), targetSegment: 1)
        let fragment = try await seeker.mediaSegment(track: opus.id, index: last) ?? []
        let warmUp = try XCTUnwrap(provider.made["A_OPUS"]).calls - own.count
        XCTAssertTrue((1...8).contains(warmUp), "decoded \(warmUp) blocks before the segment, to warm up")
        // The segment's sound starts about where its picture does (its bytes may begin a cluster early).
        let base = Double(try XCTUnwrap(RemuxTests.baseDecodeTime(fragment))) / 48000
        XCTAssertEqual(base, Double(segment.start) / 1e9, accuracy: 1.5)
    }
}
