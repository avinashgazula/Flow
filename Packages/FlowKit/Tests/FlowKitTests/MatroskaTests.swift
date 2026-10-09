import XCTest
@testable import FlowKit

/// Fixtures were made with ffmpeg; counts and times below match `ffprobe -show_packets`.
final class MatroskaTests: XCTestCase {
    static func fixture(_ name: String) -> URL {
        Bundle.module.url(forResource: name, withExtension: "mkv", subdirectory: "Resources")!
    }

    func testHeaderTracksCuesAndChapters() async throws {
        let header = try await MatroskaReader.readHeader(FileByteSource(url: Self.fixture("avc-aac-srt")))
        XCTAssertEqual(header.docType, "matroska")
        XCTAssertEqual(header.timecodeScale, 1_000_000)
        XCTAssertEqual(Double(header.duration ?? 0) / 1e9, 6.0, accuracy: 0.1)

        let video = try XCTUnwrap(header.tracks.first { $0.kind == .video })
        XCTAssertEqual(video.codecID, "V_MPEG4/ISO/AVC")
        XCTAssertEqual(video.width, 160)
        XCTAssertEqual(video.height, 90)
        XCTAssertEqual(video.codecPrivate.first, 1, "avcC configurationVersion")

        let audio = try XCTUnwrap(header.tracks.first { $0.kind == .audio })
        XCTAssertEqual(audio.codecID, "A_AAC")
        XCTAssertEqual(audio.sampleRate, 48000)
        XCTAssertEqual(audio.channels, 2)
        XCTAssertEqual(audio.language, "eng")

        let subs = try XCTUnwrap(header.tracks.first { $0.kind == .subtitle })
        XCTAssertEqual(subs.codecID, "S_TEXT/UTF8")

        XCTAssertFalse(header.cues.isEmpty)
        XCTAssertEqual(header.cues.first?.time, 0)
        XCTAssertEqual(header.cues.filter { $0.track == 1 }.map { $0.time / 1_000_000_000 }, [0, 1, 2, 3, 4, 5], "a keyframe every second")

        XCTAssertEqual(header.chapters.map(\.title), ["Opening", "Ending"])
        XCTAssertEqual(header.chapters.last?.start, 3_000_000_000)
    }

    func testClustersYieldEveryPacket() async throws {
        let url = Self.fixture("avc-aac-srt")
        let source = FileByteSource(url: url)
        let header = try await MatroskaReader.readHeader(source)
        let start = try XCTUnwrap(header.firstClusterPosition)
        let bytes = try await source.read(start..<(header.segmentEnd ?? 0))
        let blocks = try MatroskaClusterParser.blocks(bytes, timecodeScale: header.timecodeScale, tracks: header.tracks)

        let video = blocks.filter { $0.track == 1 }
        XCTAssertEqual(video.count, 144)
        XCTAssertEqual(blocks.filter { $0.track == 2 }.flatMap(\.frames).count, 283)
        XCTAssertEqual(video.prefix(4).map { $0.time / 1_000_000 }, [0, 125, 42, 83], "stored in decode order with B-frames")
        XCTAssertEqual(video.filter(\.isKeyframe).count, 6)

        let subtitles = blocks.filter { $0.track == 3 }
        XCTAssertEqual(subtitles.count, 2)
        XCTAssertEqual(subtitles.first?.time, 500_000_000)
        XCTAssertEqual(subtitles.first?.duration, 1_500_000_000)
        XCTAssertEqual(String(decoding: subtitles.first!.frames[0], as: UTF8.self), "Hello from <i>Flow</i>.")
    }

    func testHEVCWithHDRAndDolbyAudio() async throws {
        let header = try await MatroskaReader.readHeader(FileByteSource(url: Self.fixture("hevc-eac3-ac3")))
        let video = try XCTUnwrap(header.tracks.first { $0.kind == .video })
        XCTAssertEqual(video.codecID, "V_MPEGH/ISO/HEVC")
        XCTAssertEqual(video.colour?.transfer, 16)
        XCTAssertEqual(video.colour?.primaries, 9)
        XCTAssertEqual(header.tracks.filter { $0.kind == .audio }.map(\.codecID), ["A_EAC3", "A_AC3"])
        XCTAssertEqual(header.tracks.filter { $0.kind == .audio }.map(\.language), ["eng", "spa"])
    }

    func testLacing() throws {
        // Track 1, time +5, Xiph lacing (0x02), three frames of 2, 3 and 1 bytes.
        let xiph: [UInt8] = [0x81, 0x00, 0x05, 0x02, 0x02, 2, 3, 0xA, 0xA, 0xB, 0xB, 0xB, 0xC]
        let block = try XCTUnwrap(MatroskaClusterParser.parseBlock(xiph, 0, xiph.count, clusterTime: 10, scale: 1_000_000, simple: true, stripped: [:]))
        XCTAssertEqual(block.frames, [[0xA, 0xA], [0xB, 0xB, 0xB], [0xC]])
        XCTAssertEqual(block.time, 15_000_000)

        // EBML lacing (0x06): first size 2 as a vint (0x82), then +1 as a signed vint (0xBF + 1 = 0xC0), remainder 1.
        let ebml: [UInt8] = [0x81, 0x00, 0x00, 0x86, 0x02, 0x82, 0xC0, 0xA, 0xA, 0xB, 0xB, 0xB, 0xC]
        let laced = try XCTUnwrap(MatroskaClusterParser.parseBlock(ebml, 0, ebml.count, clusterTime: 0, scale: 1_000_000, simple: true, stripped: [:]))
        XCTAssertEqual(laced.frames, [[0xA, 0xA], [0xB, 0xB, 0xB], [0xC]])
        XCTAssertTrue(laced.isKeyframe)

        // Fixed lacing (0x04): two frames of 2 bytes, and header stripping puts the prefix back.
        let fixed: [UInt8] = [0x81, 0x00, 0x00, 0x04, 0x01, 1, 2, 3, 4]
        let restored = try XCTUnwrap(MatroskaClusterParser.parseBlock(fixed, 0, fixed.count, clusterTime: 0, scale: 1_000_000, simple: true, stripped: [1: [0x0B, 0x77]]))
        XCTAssertEqual(restored.frames, [[0x0B, 0x77, 1, 2], [0x0B, 0x77, 3, 4]])
    }

    func testRejectsOtherFiles() async {
        do {
            _ = try await MatroskaReader.readHeader(MemoryByteSource(Array("not a video at all".utf8)))
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? MatroskaError, .notMatroska)
        }
    }
}

final class ContainerDetectorTests: XCTestCase {
    func testNamesAndBytes() {
        let url = { (s: String) in URL(string: s)! }
        XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/Movie.2024.2160p.mkv"), filename: nil), .matroska)
        XCTAssertEqual(ContainerDetector.container(url: url("https://debrid.test/d/ABC123"), filename: "Show.S01E01.1080p.WEB.mkv"), .matroska)
        XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/master.m3u8?token=1"), filename: nil), .native)
        XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/old.avi"), filename: nil), .unsupported("AVI"))
        XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/stream?id=9"), filename: nil), .unknown)
        XCTAssertEqual(ContainerDetector.sniff([0x1A, 0x45, 0xDF, 0xA3, 0x01]), .matroska)
        XCTAssertEqual(ContainerDetector.sniff([0, 0, 0, 0x20] + Array("ftypisom".utf8)), .native)
    }
}

final class MatroskaAttachmentTests: XCTestCase {
    /// A big attachment before the clusters is jumped over, not read.
    func testSkipsLargeAttachments() async throws {
        let url = Bundle.module.url(forResource: "avc-aac-srt", withExtension: "mkv", subdirectory: "Resources")!
        var bytes = [UInt8](try Data(contentsOf: url))
        let header = try await MatroskaReader.readHeader(MemoryByteSource(bytes))
        let insertAt = Int(header.firstClusterPosition!)
        // Attachments element (0x1941A469) with an 8-byte size and 3 MB of payload.
        let payload = 3 * 1024 * 1024
        var element: [UInt8] = [0x19, 0x41, 0xA4, 0x69, 0x01]
        for shift in stride(from: 48, through: 0, by: -8) { element.append(UInt8((payload >> shift) & 0xFF)) }
        element += [UInt8](repeating: 0x55, count: payload)
        bytes.insert(contentsOf: element, at: insertAt)
        // Grow the Segment's 8-byte size field to match (ffmpeg writes it right after the Segment ID).
        let segmentID: [UInt8] = [0x18, 0x53, 0x80, 0x67]
        let segmentAt = (0..<64).first { Array(bytes[$0..<$0 + 4]) == segmentID }!
        var size = 0
        for k in 0..<7 { size = size << 8 | Int(bytes[segmentAt + 5 + k]) }
        size += element.count
        for k in 0..<7 { bytes[segmentAt + 5 + k] = UInt8((size >> (8 * (6 - k))) & 0xFF) }

        let counting = CountingSource(inner: MemoryByteSource(bytes))
        let shifted = try await MatroskaReader.readHeader(counting)
        XCTAssertEqual(shifted.firstClusterPosition, header.firstClusterPosition! + Int64(element.count))
        XCTAssertEqual(shifted.tracks.count, header.tracks.count)
        let read = await counting.total
        XCTAssertLessThan(read, 2 * 1024 * 1024, "the attachment's payload isn't downloaded")
    }
}

actor CountingSource: ByteSource {
    let inner: MemoryByteSource
    var total = 0
    init(inner: MemoryByteSource) { self.inner = inner }
    func length() async throws -> Int64? { try await inner.length() }
    func read(_ range: Range<Int64>) async throws -> [UInt8] {
        let bytes = try await inner.read(range)
        total += bytes.count
        return bytes
    }
}

final class PGSTests: XCTestCase {
    static func segment(_ type: UInt8, _ payload: [UInt8]) -> [UInt8] {
        [type, UInt8(payload.count >> 8), UInt8(payload.count & 0xFF)] + payload
    }

    /// One display set: a 4×2 white-and-clear object at (100, 900) on a 1920×1080 canvas.
    static var showSet: [UInt8] {
        let pcs: [UInt8] = [0x07, 0x80, 0x04, 0x38, 0x10, 0x00, 0x01, 0x80, 0x00, 0x00, 0x01,
                            0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x03, 0x84]
        let pds: [UInt8] = [0x00, 0x00, 0x01, 235, 128, 128, 255]
        // Row 0: four pixels of colour 1. Row 1: 1, two transparent, 1.
        let rle: [UInt8] = [0x00, 0x84, 0x01, 0x00, 0x00, 0x01, 0x00, 0x02, 0x01, 0x00, 0x00]
        let length = rle.count + 4
        let ods: [UInt8] = [0x00, 0x00, 0x00, 0xC0, UInt8(length >> 16), UInt8((length >> 8) & 0xFF), UInt8(length & 0xFF), 0x00, 0x04, 0x00, 0x02] + rle
        return segment(0x16, pcs) + segment(0x14, pds) + segment(0x15, ods) + segment(0x80, [])
    }

    static var clearSet: [UInt8] {
        segment(0x16, [0x07, 0x80, 0x04, 0x38, 0x10, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]) + segment(0x80, [])
    }

    func testDecodesADisplaySet() throws {
        var decoder = PGSDecoder()
        let cue = try XCTUnwrap(decoder.decode(Self.showSet, at: 12.5))
        XCTAssertEqual(cue.start, 12.5)
        XCTAssertEqual(cue.canvasWidth, 1920)
        XCTAssertEqual(cue.canvasHeight, 1080)
        let object = try XCTUnwrap(cue.objects.first)
        XCTAssertEqual([object.x, object.y, object.width, object.height], [100, 900, 4, 2])
        XCTAssertEqual(object.indices, [1, 1, 1, 1, 1, 0, 0, 1])
        let pixels = cue.rgba(for: object)
        XCTAssertEqual(Array(pixels[0..<4]), [255, 255, 255, 255], "Y 235 is full white, opaque")
        XCTAssertEqual(Array(pixels[20..<24]), [0, 0, 0, 0], "palette index 0 is transparent")

        let cleared = try XCTUnwrap(decoder.decode(Self.clearSet, at: 15))
        XCTAssertTrue(cleared.objects.isEmpty)
    }
}

final class HeaderCacheTests: XCTestCase {
    func testSecondOpenSkipsTheIndex() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flow-header-cache-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = MatroskaHeaderCache(directory: directory)
        let bytes = [UInt8](try Data(contentsOf: MatroskaTests.fixture("avc-aac-srt")))

        let first = CountingSource(inner: MemoryByteSource(bytes))
        let parsed = try await MatroskaReader.readHeader(first, probeSize: 4096, cache: cache)
        let firstReads = await first.total

        // A new cache instance over the same directory: the header comes back from disk.
        let second = CountingSource(inner: MemoryByteSource(bytes))
        let cached = try await MatroskaReader.readHeader(second, probeSize: 4096, cache: MatroskaHeaderCache(directory: directory))
        let secondReads = await second.total
        XCTAssertEqual(cached.cues, parsed.cues)
        XCTAssertEqual(cached.tracks, parsed.tracks)
        XCTAssertEqual(cached.chapters, parsed.chapters)
        XCTAssertEqual(secondReads, 4096, "only the identifying head is read")
        XCTAssertGreaterThan(firstReads, secondReads)
    }
}

final class VobSubTests: XCTestCase {
    /// A 4×2 subpicture at (10, 20): a white top line, a red bottom line, shown for two seconds.
    static func packet() -> [UInt8] {
        let pixels: [UInt8] = [0x11, 0x12] // one run of four per line: colour 1, then colour 2
        let (x1, x2, y1, y2) = (10, 13, 20, 21)
        let first = 4 + pixels.count
        var seq1: [UInt8] = [0x00, 0x00, 0, 0, 0x01, 0x03, 0x32, 0x10, 0x04, 0xFF, 0xF0,
                             0x05, UInt8(x1 >> 4), UInt8((x1 & 0xF) << 4 | x2 >> 8), UInt8(x2 & 0xFF),
                             UInt8(y1 >> 4), UInt8((y1 & 0xF) << 4 | y2 >> 8), UInt8(y2 & 0xFF),
                             0x06, 0x00, 0x04, 0x00, 0x05, 0xFF]
        let second = first + seq1.count
        seq1[2] = UInt8(second >> 8); seq1[3] = UInt8(second & 0xFF)
        let seq2: [UInt8] = [0x00, 176, UInt8(second >> 8), UInt8(second & 0xFF), 0x02, 0xFF]
        let total = second + seq2.count
        return [UInt8(total >> 8), UInt8(total & 0xFF), UInt8(first >> 8), UInt8(first & 0xFF)] + pixels + seq1 + seq2
    }

    func testDecodesASubpicture() throws {
        let idx = "# VobSub index file\nsize: 720x576\npalette: 000000, ffffff, ff0000, 00ff00, 0000ff, 111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, aaaaaa, bbbbbb\n"
        let decoder = VobSubDecoder(codecPrivate: Array(idx.utf8), videoWidth: 1920, videoHeight: 1080)
        XCTAssertEqual(decoder.canvasWidth, 720)
        XCTAssertEqual(decoder.canvasHeight, 576)
        let cue = try XCTUnwrap(decoder.decode(Self.packet(), at: 5))
        XCTAssertEqual(cue.start, 5)
        XCTAssertEqual(cue.end ?? 0, 5 + 176 * 1024 / 90_000, accuracy: 0.001)
        XCTAssertFalse(cue.isForced)
        let object = try XCTUnwrap(cue.objects.first)
        XCTAssertEqual([object.x, object.y, object.width, object.height], [10, 20, 4, 2])
        XCTAssertEqual(object.indices, [1, 1, 1, 1, 2, 2, 2, 2])
        let rgba = cue.rgba(for: object)
        XCTAssertEqual(Array(rgba[0..<4]), [255, 255, 255, 255])
        XCTAssertEqual(Array(rgba[16..<20]), [255, 0, 0, 255])
    }

    func testRemuxerOffersVobSubAsAPictureTrack() {
        var track = MatroskaTrack(number: 3, kind: .subtitle, codecID: "S_VOBSUB")
        track.language = "eng"
        guard case .success(let out) = MatroskaRemuxer.output(for: track, firstFrame: nil) else { return XCTFail("VobSub rejected") }
        XCTAssertEqual(out.role, .bitmap)
    }
}

/// Decodes the picture subtitles of a local MKV and writes each cue's pixels for inspection
/// (FLOW_BITMAP_SAMPLE=path, output in FLOW_REMUX_OUT).
final class BitmapSampleTests: XCTestCase {
    func testDumpPictureSubtitles() async throws {
        guard let path = ProcessInfo.processInfo.environment["FLOW_BITMAP_SAMPLE"] else { throw XCTSkip("no sample") }
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: URL(fileURLWithPath: path)))
        let track = try XCTUnwrap(remuxer.bitmapSubtitles.first)
        await remuxer.selectBitmapSubtitle(track.id)
        let video = try XCTUnwrap(remuxer.video)
        for s in remuxer.segments { _ = try await remuxer.mediaSegment(track: video.id, index: s.index) }
        let out = RemuxTests.outputRoot.appendingPathComponent("bitmaps")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        var seen = Set<Double>()
        for t in stride(from: 0.0, to: remuxer.duration, by: 0.25) {
            guard let cue = await remuxer.bitmapSubtitle(at: t), seen.insert(cue.start).inserted else { continue }
            print("cue", cue.start, cue.end ?? -1, "canvas", cue.canvasWidth, cue.canvasHeight, "objects", cue.objects.map { [$0.x, $0.y, $0.width, $0.height] })
            for (i, o) in cue.objects.enumerated() {
                try Data(cue.rgba(for: o)).write(to: out.appendingPathComponent("\(cue.start)-\(i)-\(o.width)x\(o.height).rgba"))
            }
        }
        XCTAssertFalse(seen.isEmpty)
    }
}
