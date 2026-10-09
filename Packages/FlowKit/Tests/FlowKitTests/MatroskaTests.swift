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
