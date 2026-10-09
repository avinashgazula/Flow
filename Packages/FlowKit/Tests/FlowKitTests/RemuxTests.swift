import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class RemuxTests: XCTestCase {
    /// Writes every playlist and segment a player would fetch, so tools can check the output.
    static func dump(_ remuxer: MatroskaRemuxer, to directory: URL) async throws {
        let fm = FileManager.default
        try? fm.removeItem(at: directory)
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        func write(_ path: String, _ response: MatroskaRemuxer.Response?) throws {
            let url = directory.appendingPathComponent(path)
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            switch response {
            case .playlist(let s), .text(let s): try Data(s.utf8).write(to: url)
            case .media(let b): try Data(b).write(to: url)
            case nil: XCTFail("no response for \(path)")
            }
        }
        try write("master.m3u8", try await remuxer.respond(to: "master.m3u8"))
        let tracks = [remuxer.video?.id].compactMap { $0 } + remuxer.audio.map(\.id)
        for track in tracks {
            try write("\(track).m3u8", try await remuxer.respond(to: "\(track).m3u8"))
            try write("\(track)/init.mp4", try await remuxer.respond(to: "\(track)/init.mp4"))
            for s in remuxer.segments { try write("\(track)/\(s.index).m4s", try await remuxer.respond(to: "\(track)/\(s.index).m4s")) }
        }
        for sub in remuxer.subtitles {
            try write("\(sub.id).m3u8", try await remuxer.respond(to: "\(sub.id).m3u8"))
            for s in remuxer.segments { try write("\(sub.id)/\(s.index).vtt", try await remuxer.respond(to: "\(sub.id)/\(s.index).vtt")) }
        }
    }

    static var outputRoot: URL {
        if let dir = ProcessInfo.processInfo.environment["FLOW_REMUX_OUT"] { return URL(fileURLWithPath: dir) }
        return FileManager.default.temporaryDirectory.appendingPathComponent("flow-remux")
    }

    func testH264AACWithSubtitles() async throws {
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("avc-aac-srt")), targetSegment: 2)
        let video = try XCTUnwrap(remuxer.video)
        XCTAssertTrue(video.codecString.hasPrefix("avc1.64"), video.codecString)
        XCTAssertEqual(remuxer.audio.map(\.codecString), ["mp4a.40.2"])
        XCTAssertEqual(remuxer.subtitles.count, 1)
        XCTAssertEqual(remuxer.segments.count, 3)
        XCTAssertEqual(remuxer.segments.map(\.duration).reduce(0, +), 6, accuracy: 0.1)

        let master = await remuxer.masterPlaylist()
        XCTAssertTrue(master.contains("TYPE=AUDIO"))
        XCTAssertTrue(master.contains("TYPE=SUBTITLES"))
        XCTAssertTrue(master.contains("NAME=\"English (AAC Stereo)\""))
        XCTAssertTrue(master.contains("RESOLUTION=160x90"))

        let vtt = try await remuxer.subtitleSegment(track: 3, index: 0)
        XCTAssertTrue(vtt?.contains("00:00:00.500 --> 00:00:02.000\nHello from <i>Flow</i>.") == true, vtt ?? "")

        // Every video frame lands in exactly one segment.
        var frames = 0
        for s in remuxer.segments {
            let fragment = try await remuxer.mediaSegment(track: video.id, index: s.index)!
            frames += Self.sampleCount(fragment)
        }
        XCTAssertEqual(frames, 144)
        try await Self.dump(remuxer, to: Self.outputRoot.appendingPathComponent("avc"))
    }

    func testHEVCWithDolbyAudio() async throws {
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("hevc-eac3-ac3")), targetSegment: 2)
        let video = try XCTUnwrap(remuxer.video)
        XCTAssertTrue(video.codecString.hasPrefix("hvc1.2.4.L"), video.codecString)
        XCTAssertEqual(remuxer.audio.map(\.codecString), ["ec-3", "ac-3"])
        let master = await remuxer.masterPlaylist()
        XCTAssertTrue(master.contains("VIDEO-RANGE=PQ"))
        XCTAssertTrue(master.contains("LANGUAGE=\"es\""))
        try await Self.dump(remuxer, to: Self.outputRoot.appendingPathComponent("hevc"))
    }

    func testCodecConfigurations() throws {
        // A 48 kHz, 448 kb/s, 5.1 AC-3 header: fscod 0, frmsizecod 0x1A, bsid 8, bsmod 0, acmod 7, lfe on.
        let frame: [UInt8] = [0x0B, 0x77, 0, 0, 0x1E, 0x40, 0xE1, 0x00]
        let header = try XCTUnwrap(AC3.parse(frame))
        XCTAssertEqual(header.acmod, 7)
        XCTAssertEqual(header.channels, 6)
        XCTAssertEqual(header.frameBytes, 1792)
        XCTAssertEqual(AC3.dac3(header).count, 3)

        XCTAssertEqual(AAC.objectType([0x11, 0x90]), 2)
        XCTAssertEqual(AAC.audioSpecificConfig(codecID: "A_AAC/MPEG4/LC", sampleRate: 48000, channels: 2), [0x11, 0x90])
        XCTAssertEqual(MP4.packedLanguage("eng"), 0x15C7)
        XCTAssertEqual(LanguageName.bcp47("spa"), "es")
        XCTAssertEqual(SubtitleText.fromASSEvent("0,0,Default,,0,0,0,,{\\i1}Hello{\\i0}\\Nthere, friend"), "Hello\nthere, friend")
    }

    /// trun sample_count of a fragment.
    static func sampleCount(_ b: [UInt8]) -> Int {
        guard let range = b.indices.dropLast(12).first(where: { b[$0] == 0x74 && b[$0 + 1] == 0x72 && b[$0 + 2] == 0x75 && b[$0 + 3] == 0x6E }) else { return 0 }
        let i = range + 8
        return Int(b[i]) << 24 | Int(b[i + 1]) << 16 | Int(b[i + 2]) << 8 | Int(b[i + 3])
    }
}

/// Serves a file's bytes with Range support, like a real streaming server.
struct RangeServingTransport: HTTPTransport {
    let bytes: [UInt8]
    var honoursRange = true

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        guard honoursRange, let header = request.value(forHTTPHeaderField: "Range") else {
            return (Data(bytes), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let parts = header.dropFirst("bytes=".count).split(separator: "-").compactMap { Int($0) }
        let lower = min(parts[0], bytes.count)
        let upper = min(parts[1] + 1, bytes.count)
        let fields = ["Content-Range": "bytes \(lower)-\(upper - 1)/\(bytes.count)"]
        return (Data(bytes[lower..<upper]), HTTPURLResponse(url: url, statusCode: 206, httpVersion: nil, headerFields: fields)!)
    }
}

final class HTTPByteSourceTests: XCTestCase {
    func testRemuxesOverRangeRequests() async throws {
        let bytes = [UInt8](try Data(contentsOf: MatroskaTests.fixture("avc-aac-srt")))
        let source = HTTPByteSource(url: URL(string: "https://example.invalid/movie.mkv")!, transport: RangeServingTransport(bytes: bytes))
        let length = try await source.length()
        XCTAssertEqual(length, Int64(bytes.count))
        let remuxer = try await MatroskaRemuxer.open(source, targetSegment: 2)
        let fragment = try await remuxer.mediaSegment(track: 1, index: 1)
        XCTAssertGreaterThan(RemuxTests.sampleCount(fragment ?? []), 0)
        XCTAssertEqual(HTTPByteSource.total(from: "bytes 0-1/146515"), 146515)
    }

    func testServerWithoutRangesCantSeek() async throws {
        let bytes = [UInt8](try Data(contentsOf: MatroskaTests.fixture("avc-aac-srt")))
        let source = HTTPByteSource(url: URL(string: "https://example.invalid/movie.mkv")!, transport: RangeServingTransport(bytes: bytes, honoursRange: false))
        do {
            _ = try await source.read(1000..<2000)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? MatroskaError, .unsupported("this server doesn't support seeking (no range requests)"))
        }
    }
}

/// Runs only when FLOW_REMUX_SAMPLE points at a file: remuxes it into FLOW_REMUX_OUT for inspection.
final class RemuxSampleTests: XCTestCase {
    func testRemuxSampleFile() async throws {
        guard let path = ProcessInfo.processInfo.environment["FLOW_REMUX_SAMPLE"] else { throw XCTSkip("no sample") }
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: URL(fileURLWithPath: path)))
        print("video:", remuxer.video?.codecString ?? "-", "audio:", remuxer.audio.map(\.label), "subs:", remuxer.subtitles.map(\.label),
              "skipped:", remuxer.skipped.map(\.reason), "segments:", remuxer.segments.count, "delay:", remuxer.presentationDelay)
        try await RemuxTests.dump(remuxer, to: RemuxTests.outputRoot.appendingPathComponent("sample"))
    }
}
