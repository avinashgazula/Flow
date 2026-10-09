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
        if let video = remuxer.video, !remuxer.trickPlayFrames.isEmpty {
            try write("iframes.m3u8", try await remuxer.respond(to: "iframes.m3u8"))
            for i in remuxer.trickPlayFrames.indices { try write("\(video.id)/i\(i).m4s", try await remuxer.respond(to: "\(video.id)/i\(i).m4s")) }
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
        XCTAssertEqual(SubtitleText.fromASSEvent("0,0,Default,,0,0,0,,{\\i1}Hello{\\i0}\\Nthere, friend"), "<i>Hello</i>\nthere, friend")
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
    /// Largest response the server sends, like hosts that cap each range reply.
    var cap = Int.max

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        guard honoursRange, let header = request.value(forHTTPHeaderField: "Range") else {
            return (Data(bytes), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let parts = header.dropFirst("bytes=".count).split(separator: "-").compactMap { Int($0) }
        let lower = min(parts[0], bytes.count)
        let upper = min(parts[1] + 1, bytes.count, lower + cap)
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

    func testServerThatCapsRangeResponses() async throws {
        let bytes = [UInt8](try Data(contentsOf: MatroskaTests.fixture("avc-aac-srt")))
        let source = HTTPByteSource(url: URL(string: "https://example.invalid/movie.mkv")!, transport: RangeServingTransport(bytes: bytes, cap: 10_000), headSize: 1024)
        let remuxer = try await MatroskaRemuxer.open(source, targetSegment: 2)
        let read = try await source.read(20_000..<70_000)
        XCTAssertEqual(read, Array(bytes[20_000..<70_000]))
        let fragment = try await remuxer.mediaSegment(track: 1, index: 1)
        XCTAssertGreaterThan(RemuxTests.sampleCount(fragment ?? []), 0)
    }

    func testServerWithoutRangesCantSeek() async throws {
        let bytes = [UInt8](try Data(contentsOf: MatroskaTests.fixture("avc-aac-srt")))
        let source = HTTPByteSource(url: URL(string: "https://example.invalid/movie.mkv")!, transport: RangeServingTransport(bytes: bytes, honoursRange: false), headSize: 1024)
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
        if let pgs = remuxer.bitmapSubtitles.first {
            await remuxer.selectBitmapSubtitle(pgs.id)
            for s in remuxer.segments { _ = try await remuxer.mediaSegment(track: remuxer.video!.id, index: s.index) }
            for t in [1.0, 3.0, 7.0, 11.9] {
                let cue = await remuxer.bitmapSubtitle(at: t)
                print("pgs at", t, ":", cue.map { "start \($0.start) end \($0.end ?? -1) forced \($0.isForced) objects \($0.objects.map { "\($0.width)x\($0.height)@\($0.x),\($0.y)" })" } ?? "none")
            }
        }
    }
}

/// Runs only when FLOW_REMUX_URL is set: remuxes a remote MKV over range requests and times it.
final class RemoteRemuxTests: XCTestCase {
    func testRemoteFile() async throws {
        guard let raw = ProcessInfo.processInfo.environment["FLOW_REMUX_URL"], let url = URL(string: raw) else { throw XCTSkip("no remote file") }
        let started = Date()
        let source = TimingSource(inner: HTTPByteSource(url: url))
        let remuxer = try await MatroskaRemuxer.open(source)
        for line in await source.log { print(line) }
        print(String(format: "opened in %.1fs", Date().timeIntervalSince(started)))
        print("duration:", remuxer.duration, "segments:", remuxer.segments.count, "delay(ns):", remuxer.presentationDelay)
        print("video:", remuxer.video.map { "\($0.codecString) \($0.source.width)x\($0.source.height) dv=\($0.source.dolbyVision != nil) transfer=\($0.source.colour?.transfer ?? -1)" } ?? "none")
        print("audio:", remuxer.audio.map { "\($0.label) [\($0.codecString)]" })
        print("subtitles:", remuxer.subtitles.map(\.label))
        print("skipped:", remuxer.skipped.map { "\($0.track.codecID): \($0.reason)" })
        print("chapters:", remuxer.header.chapters.count, "soundtrack playable:", remuxer.hasPlayableSoundtrack)
        let master = await remuxer.masterPlaylist()
        print(master)
        let out = RemuxTests.outputRoot.appendingPathComponent("remote")
        try? FileManager.default.removeItem(at: out)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        try Data(master.utf8).write(to: out.appendingPathComponent("master.m3u8"))
        if ProcessInfo.processInfo.environment["FLOW_REMUX_PGS"] != nil, let pgs = remuxer.bitmapSubtitles.first {
            print("bitmap tracks:", remuxer.bitmapSubtitles.map(\.label))
            await remuxer.selectBitmapSubtitle(pgs.id)
            let first = remuxer.segments.count / 3
            var seen = Set<Double>()
            for index in first..<(first + 12) {
                _ = try await remuxer.mediaSegment(track: remuxer.video!.id, index: index)
                let segment = remuxer.segments[index]
                var t = Double(segment.start) / 1e9
                while t < Double(segment.end) / 1e9 {
                    if let cue = await remuxer.bitmapSubtitle(at: t), !seen.contains(cue.start), let object = cue.objects.first {
                        seen.insert(cue.start)
                        let name = String(format: "cue-%.2f-%dx%d-at-%d-%d-of-%dx%d.rgba", cue.start, object.width, object.height, object.x, object.y, cue.canvasWidth, cue.canvasHeight)
                        try Data(cue.rgba(for: object)).write(to: out.appendingPathComponent(name))
                        print("cue", String(format: "%.2f–%.2f", cue.start, cue.end ?? -1), "objects:", cue.objects.count, "forced:", cue.isForced)
                    }
                    t += 0.25
                }
            }
            print("picture subtitles decoded:", seen.count)
            return
        }
        let tracks = [remuxer.video?.id].compactMap { $0 } + remuxer.audio.prefix(1).map(\.id)
        for index in [0, remuxer.segments.count / 2] {
            for track in tracks {
                let t0 = Date()
                let bytes = try await remuxer.mediaSegment(track: track, index: index) ?? []
                print(String(format: "segment %d track %d: %.1f MB in %.1fs, %d samples", index, track, Double(bytes.count) / 1e6, Date().timeIntervalSince(t0), RemuxTests.sampleCount(bytes)))
                let dir = out.appendingPathComponent("\(track)")
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try Data(await remuxer.initSegment(track: track) ?? []).write(to: dir.appendingPathComponent("init.mp4"))
                try Data(bytes).write(to: dir.appendingPathComponent("\(index).m4s"))
            }
        }
    }
}

actor TimingSource: ByteSource {
    let inner: ByteSource
    var log: [String] = []
    init(inner: ByteSource) { self.inner = inner }
    func length() async throws -> Int64? {
        let t = Date(); let v = try await inner.length()
        log.append(String(format: "length %.2fs", Date().timeIntervalSince(t)))
        return v
    }
    func read(_ range: Range<Int64>) async throws -> [UInt8] {
        let t = Date(); let v = try await inner.read(range)
        log.append("read \(range.lowerBound)..+\(range.count) -> \(v.count) bytes " + String(format: "%.2fs", Date().timeIntervalSince(t)))
        return v
    }
}

final class SoundtrackTests: XCTestCase {
    /// A commentary track is never a stand-in for a soundtrack Apple devices can't decode.
    func testCommentaryAloneIsNotASoundtrack() async throws {
        let url = Bundle.module.url(forResource: "dts-commentary", withExtension: "mkv", subdirectory: "Resources")!
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: url))
        XCTAssertEqual(remuxer.audio.map(\.codecString), ["ac-3"])
        XCTAssertTrue(remuxer.audio[0].source.isCommentary)
        XCTAssertEqual(remuxer.skipped.filter { $0.track.kind == .audio }.map(\.reason), ["DTS audio"])
        XCTAssertFalse(remuxer.hasPlayableSoundtrack)

        let sample = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("hevc-eac3-ac3")))
        XCTAssertTrue(sample.hasPlayableSoundtrack)
    }
}

final class PrefetchTests: XCTestCase {
    actor RecordingSource: ByteSource {
        let inner: FileByteSource
        var ranges: [Range<Int64>] = []
        init(_ inner: FileByteSource) { self.inner = inner }
        func length() async throws -> Int64? { try await inner.length() }
        func read(_ range: Range<Int64>) async throws -> [UInt8] {
            ranges.append(range)
            return try await inner.read(range)
        }
    }

    func testServingASegmentFetchesTheNext() async throws {
        let source = RecordingSource(FileByteSource(url: MatroskaTests.fixture("avc-aac-srt")))
        let remuxer = try await MatroskaRemuxer.open(source, targetSegment: 2)
        let next = remuxer.segments[1]
        _ = try await remuxer.mediaSegment(track: 1, index: 0)
        for _ in 0..<100 {
            if await source.ranges.contains(next.byteStart..<next.byteEnd) { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let fetched = await source.ranges.contains(next.byteStart..<next.byteEnd)
        XCTAssertTrue(fetched)
        _ = try await remuxer.mediaSegment(track: 1, index: 1)
        let fetches = await source.ranges.filter { $0 == next.byteStart..<next.byteEnd }.count
        XCTAssertEqual(fetches, 1, "segment 1 is served from the prefetch, not fetched again")
    }
}

final class SegmentLengthTests: XCTestCase {
    func header(megabitsPerSecond: Double) -> MatroskaHeader {
        var h = MatroskaHeader(docType: "matroska", segmentDataStart: 100)
        let seconds = 7200.0
        h.duration = Int64(seconds * 1e9)
        h.segmentEnd = 100 + Int64(megabitsPerSecond * 1_000_000 / 8 * seconds)
        return h
    }

    func testHighBitrateFilesGetShorterSegments() {
        XCTAssertEqual(MatroskaRemuxer.segmentLength(header: header(megabitsPerSecond: 8)), 6)
        XCTAssertEqual(MatroskaRemuxer.segmentLength(header: header(megabitsPerSecond: 20)), 4)
        XCTAssertEqual(MatroskaRemuxer.segmentLength(header: header(megabitsPerSecond: 80)), 2)
        XCTAssertEqual(MatroskaRemuxer.segmentLength(header: MatroskaHeader(docType: "matroska", segmentDataStart: 0)), 6)
    }
}

final class AudioOrderTests: XCTestCase {
    func testPreferredLanguageLeads() async throws {
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("hevc-eac3-ac3")), targetSegment: 2)
        let languages = remuxer.audio.map(\.language)
        XCTAssertEqual(languages.count, 2)
        let spanish = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("hevc-eac3-ac3")), targetSegment: 2, preferredAudioLanguage: "es")
        XCTAssertEqual(LanguageName.bcp47(spanish.audio[0].language), "es")
        let master = await spanish.masterPlaylist()
        let defaultLine = master.split(separator: "\n").first { $0.contains("TYPE=AUDIO") && $0.contains("DEFAULT=YES") } ?? ""
        XCTAssertTrue(defaultLine.contains("LANGUAGE=\"es\""), String(defaultLine))
    }
}

final class TrickPlayTests: XCTestCase {
    func testDumpFixtures() async throws {
        guard ProcessInfo.processInfo.environment["FLOW_REMUX_OUT"] != nil else { throw XCTSkip("set FLOW_REMUX_OUT to inspect output") }
        for name in ["hevc-eac3-ac3", "avc-aac-srt"] {
            let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture(name)), targetSegment: 2)
            try await RemuxTests.dump(remuxer, to: RemuxTests.outputRoot.appendingPathComponent(name))
        }
    }

    func testIFramePlaylistServesSingleKeyframes() async throws {
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("hevc-eac3-ac3")), targetSegment: 2)
        let frames = remuxer.trickPlayFrames
        XCTAssertGreaterThanOrEqual(frames.count, 2)
        let master = await remuxer.masterPlaylist()
        XCTAssertTrue(master.contains("#EXT-X-I-FRAME-STREAM-INF:"), master)
        let maybePlaylist = await remuxer.iframePlaylist()
        let playlist = try XCTUnwrap(maybePlaylist)
        XCTAssertTrue(playlist.contains("#EXT-X-I-FRAMES-ONLY"))
        XCTAssertEqual(playlist.components(separatedBy: "#EXTINF").count - 1, frames.count)
        for i in frames.indices {
            let maybeFragment = try await remuxer.iframeSegment(index: i)
            let fragment = try XCTUnwrap(maybeFragment)
            XCTAssertEqual(RemuxTests.sampleCount(fragment), 1)
        }
        let nothing = try await remuxer.iframeSegment(index: frames.count)
        XCTAssertNil(nothing)
    }

    func testCutOffKeyframeIsReadAgainInFull() {
        // A cluster (unknown children) whose second child, a 300-byte SimpleBlock, is cut off at 100 bytes.
        let child1: [UInt8] = [0xE7, 0x81, 0x00]
        let child2: [UInt8] = [0xA3, 0x41, 0x2C] + [UInt8](repeating: 0, count: 300)
        let body = child1 + child2
        let cluster: [UInt8] = [0x1F, 0x43, 0xB6, 0x75, 0x40 | UInt8(body.count >> 8), UInt8(body.count & 0xFF)]
        let full = cluster + body
        let cut = Array(full.prefix(100))
        XCTAssertEqual(MatroskaRemuxer.firstIncompleteChildEnd(cut), full.count)
        XCTAssertNil(MatroskaRemuxer.firstIncompleteChildEnd(full))
    }
}

final class PreviewFrameTests: XCTestCase {
    func testPreviewFrameIsTheKeyframeBefore() async throws {
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("avc-aac-srt")), targetSegment: 2)
        let frames = remuxer.trickPlayFrames
        XCTAssertGreaterThanOrEqual(frames.count, 2)
        let late = Double(frames[1].time) / 1e9 + 0.5
        XCTAssertEqual(remuxer.trickPlayIndex(at: late), 1)
        XCTAssertEqual(remuxer.trickPlayIndex(at: 0), 0)
        let frame = try await remuxer.previewFrame(at: late)
        XCTAssertEqual(frame?.time ?? -1, Double(frames[1].time) / 1e9, accuracy: 0.05)
        // Length-prefixed NAL units: the first unit's length fits inside the picture.
        let data = try XCTUnwrap(frame?.data)
        let first = Int(data[0]) << 24 | Int(data[1]) << 16 | Int(data[2]) << 8 | Int(data[3])
        XCTAssertLessThanOrEqual(first + 4, data.count)
    }
}

final class SubtitleTextTests: XCTestCase {
    func testASSFormattingBecomesWebVTT() {
        XCTAssertEqual(SubtitleText.fromASSEvent(#"1,0,Default,,0,0,0,,{\i1}Whispering{\i0} loudly\Nnext line"#), "<i>Whispering</i> loudly\nnext line")
        XCTAssertEqual(SubtitleText.fromASSEvent(#"1,0,Default,,0,0,0,,{\b1\i1}Both"#), "<b><i>Both</i></b>")
        XCTAssertEqual(SubtitleText.fromASSEvent(#"1,0,Default,,0,0,0,,{\b1\i1}Both{\b0} italic"#), "<b><i>Both</i></b><i> italic</i>")
        XCTAssertEqual(SubtitleText.fromASSEvent(#"1,0,Default,,0,0,0,,{\pos(10,20)\fad(200,200)}Plain"#), "Plain")
        XCTAssertEqual(SubtitleText.fromASSEvent(#"1,0,Sign,,0,0,0,,{\p1}m 0 0 l 100 0 100 100 0 100{\p0}"#), "")
        XCTAssertEqual(SubtitleText.fromASSEvent(#"1,0,Default,,0,0,0,,Tom & Jerry <3"#), "Tom &amp; Jerry &lt;3")
    }

    func testSRTKeepsSimpleTagsAndEscapesTheRest() {
        XCTAssertEqual(SubtitleText.cleanSRT("<i>Hello</i> <font color=\"red\">there</font> & a --> b"), "<i>Hello</i> there &amp; a --&gt; b")
        XCTAssertEqual(SubtitleText.cleanSRT("<B>Loud</B>"), "<b>Loud</b>")
    }
}

final class SummaryTests: XCTestCase {
    func testVideoSummary() async throws {
        let hevc = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("hevc-eac3-ac3")), targetSegment: 2)
        let summary = try XCTUnwrap(hevc.videoSummary)
        XCTAssertTrue(summary.hasPrefix("HEVC · 160×90"), summary)
        XCTAssertTrue(summary.hasSuffix("HDR10") || summary.hasSuffix("PQ"), summary)
        let dts = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("dts-commentary")), targetSegment: 2)
        XCTAssertTrue(dts.skippedSummary.contains { $0.hasPrefix("DTS audio") }, "\(dts.skippedSummary)")
    }

    func testDolbyVisionNaming() {
        var t = MatroskaTrack(number: 1, kind: .video, codecID: "V_MPEGH/ISO/HEVC")
        t.dolbyVision = [1, 0, 8 << 1, 0, 1 << 4]
        XCTAssertEqual(MatroskaRemuxer.dynamicRange(t), "Dolby Vision 8.1")
        t.dolbyVision = [1, 0, 5 << 1, 0, 0]
        XCTAssertEqual(MatroskaRemuxer.dynamicRange(t), "Dolby Vision 5")
    }
}
