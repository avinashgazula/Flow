import XCTest
@testable import FlowKit

/// Our own MP4 parser accepting what our own writer wrote proves little. These tests hand the remuxer's
/// output to ffprobe and ffmpeg, which share none of its code, and check what they see: the streams, the
/// codec and format, every packet present, timestamps that only move forward without gaps, and no decode errors.
/// Skipped with a message when ffprobe isn't installed; FLOWKIT_REQUIRE_FFPROBE=1 (set in CI) fails instead.
final class RemuxFFprobeTests: XCTestCase {
    static let fixtures = ["avc-aac-srt", "hevc-eac3-ac3", "dts-commentary", "opus", "audio-any"]

    // MARK: Running the tools

    static func tool(_ name: String) -> String? {
        let path = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        for dir in path + ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"] {
            let candidate = dir + "/" + name
            if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        }
        return nil
    }

    override func setUpWithError() throws {
        guard Self.tool("ffprobe") != nil, Self.tool("ffmpeg") != nil else {
            if ProcessInfo.processInfo.environment["FLOWKIT_REQUIRE_FFPROBE"] == "1" {
                XCTFail("ffprobe and ffmpeg are required (FLOWKIT_REQUIRE_FFPROBE=1) but aren't installed")
            }
            throw XCTSkip("ffprobe and ffmpeg aren't installed: install ffmpeg to validate the remuxer's output independently")
        }
    }

    struct Output { var status: Int32; var out: Data; var err: String }

    static func run(_ tool: String, _ arguments: [String]) throws -> Output {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: Self.tool(tool)!)
        process.arguments = arguments
        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err
        process.standardInput = FileHandle.nullDevice
        try process.run()
        // Drain both pipes concurrently, or a full pipe blocks the child.
        final class Box: @unchecked Sendable { var data = Data() }
        let errBox = Box()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async { errBox.data = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        group.wait()
        process.waitUntilExit()
        return Output(status: process.terminationStatus, out: outData, err: String(decoding: errBox.data, as: UTF8.self))
    }

    struct Stream { var codec: String; var type: String; var width: Int?; var height: Int?; var sampleRate: Int?; var channels: Int? }
    struct Packet { var pts: Double; var dts: Double; var duration: Double; var keyframe: Bool }

    static func probeStreams(_ url: URL) throws -> [Stream] {
        let r = try run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", url.path])
        XCTAssertEqual(r.status, 0, "ffprobe \(url.lastPathComponent): \(r.err)")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: r.out) as? [String: Any])
        return (json["streams"] as? [[String: Any]] ?? []).map { s in
            Stream(codec: s["codec_name"] as? String ?? "", type: s["codec_type"] as? String ?? "",
                   width: s["width"] as? Int, height: s["height"] as? Int,
                   sampleRate: (s["sample_rate"] as? String).flatMap(Int.init), channels: s["channels"] as? Int)
        }
    }

    static func probePackets(_ url: URL, stream: Int = 0) throws -> [Packet] {
        let r = try run("ffprobe", ["-v", "error", "-select_streams", String(stream), "-show_packets", "-of", "json", url.path])
        XCTAssertEqual(r.status, 0, "ffprobe packets \(url.lastPathComponent): \(r.err)")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: r.out) as? [String: Any])
        return (json["packets"] as? [[String: Any]] ?? []).map { p in
            func d(_ k: String) -> Double { Double(p[k] as? String ?? "") ?? .nan }
            return Packet(pts: d("pts_time"), dts: d("dts_time"), duration: d("duration_time"), keyframe: (p["flags"] as? String ?? "").hasPrefix("K"))
        }
    }

    // MARK: Writing the remuxer's output

    static func tempDirectory(_ name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("flowkit-ffprobe-\(name)-\(ProcessInfo.processInfo.processIdentifier)")
        try? FileManager.default.removeItem(at: url)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// The init segment followed by every media segment: what a player ends up with after playing the track through.
    static func concatenated(_ remuxer: MatroskaRemuxer, track: Int, to url: URL) async throws {
        let initSegment = await remuxer.initSegment(track: track)
        var bytes = try XCTUnwrap(initSegment, "init segment for track \(track)")
        for segment in remuxer.segments {
            let media = try await remuxer.mediaSegment(track: track, index: segment.index)
            bytes += try XCTUnwrap(media, "segment \(segment.index) of track \(track)")
        }
        try Data(bytes).write(to: url)
    }

    static func expectedCodec(_ track: MatroskaRemuxer.OutputTrack) -> String {
        let s = track.codecString
        if s.hasPrefix("avc1") { return "h264" }
        if s.hasPrefix("hvc1") || s.hasPrefix("hev1") || s.hasPrefix("dvh1") || s.hasPrefix("dvhe") { return "hevc" }
        if s.hasPrefix("av01") { return "av1" }
        if s.hasPrefix("mp4a.40") { return "aac" }
        if s == "ec-3" { return "eac3" }
        if s == "ac-3" { return "ac3" }
        if s == "fLaC" || s == "flac" { return "flac" }
        return s
    }

    // MARK: Tests

    /// Every playable track of every fixture, played through as one file.
    func testEveryTrackIsAValidStreamWithEveryPacketInOrder() async throws {
        var checkedTracks = 0
        // Different segment lengths put the segment boundaries in different places in the clusters.
        for (name, target) in Self.fixtures.flatMap({ f in [1.0, 2.0, 3.0].map { (f, $0) } }) {
            let source = MatroskaTests.fixture(name)
            let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: source), targetSegment: target)
            let directory = try Self.tempDirectory(name)
            defer { try? FileManager.default.removeItem(at: directory) }
            let sourceDuration = Double(remuxer.header.duration ?? 0) / 1e9
            let tracks = [remuxer.video].compactMap { $0 } + remuxer.audio.filter { !$0.isDecodedOnDevice }
            XCTAssertFalse(tracks.isEmpty, "\(name) has a track this platform can remux")

            for track in tracks {
                let label = "\(name) (\(target) s segments) track \(track.id) (\(track.codecString))"
                let file = directory.appendingPathComponent("\(track.id).mp4")
                try await Self.concatenated(remuxer, track: track.id, to: file)

                let streams = try Self.probeStreams(file)
                XCTAssertEqual(streams.count, 1, "\(label): one stream")
                let stream = try XCTUnwrap(streams.first, label)
                XCTAssertEqual(stream.codec, Self.expectedCodec(track), label)
                if track.role == .video {
                    XCTAssertEqual(stream.type, "video", label)
                    XCTAssertEqual(stream.width, track.source.width, label)
                    XCTAssertEqual(stream.height, track.source.height, label)
                } else {
                    XCTAssertEqual(stream.type, "audio", label)
                    XCTAssertEqual(stream.sampleRate, Int(track.source.sampleRate), label)
                    XCTAssertEqual(stream.channels, track.source.channels, label)
                }

                // The same stream in the original file, read by ffprobe's Matroska demuxer: our output must
                // hold exactly its packets (no frame lost, none played twice).
                let sourceIndex = try XCTUnwrap(remuxer.header.tracks.firstIndex { $0.number == track.id }, label)
                let original = try Self.probePackets(source, stream: sourceIndex)
                let packets = try Self.probePackets(file)
                XCTAssertEqual(packets.count, original.count, "\(label): every packet exactly once")
                XCTAssertEqual(packets.filter(\.keyframe).count, original.filter(\.keyframe).count, "\(label): same keyframes")

                // Decode timestamps only move forward, and each packet starts where the last one ended.
                // (ffprobe reports no duration for the first packet of some fragmented AAC files; that one is skipped.)
                XCTAssertLessThanOrEqual(packets.filter { $0.duration.isNaN }.count, 1, "\(label): durations are known")
                for (a, b) in zip(packets, packets.dropFirst()) {
                    XCTAssertGreaterThan(b.dts, a.dts, "\(label): dts \(a.dts) then \(b.dts)")
                    if !a.duration.isNaN { XCTAssertEqual(b.dts, a.dts + a.duration, accuracy: 0.003, "\(label): no gap or overlap after dts \(a.dts)") }
                }
                if track.role == .video { for p in packets { XCTAssertGreaterThanOrEqual(p.pts + 1e-6, p.dts, "\(label): a frame is shown no earlier than it is decoded") } }
                let length = (packets.last.map { $0.dts + ($0.duration.isNaN ? 0 : $0.duration) } ?? 0) - (packets.first?.dts ?? 0)
                XCTAssertEqual(length, sourceDuration, accuracy: 0.25, "\(label): same length as the file")

                // A full decode finds nothing wrong.
                let decode = try Self.run("ffmpeg", ["-v", "error", "-xerror", "-i", file.path, "-f", "null", "-"])
                XCTAssertEqual(decode.status, 0, "\(label): \(decode.err)")
                XCTAssertEqual(decode.err, "", "\(label): decoder warnings")
                checkedTracks += 1
            }
        }
        XCTAssertEqual(checkedTracks, 27, "nine remuxable tracks at three segment lengths")
    }

    /// The playlists, the way an HLS player reads them: ffmpeg's HLS demuxer follows the master playlist
    /// through every rendition and segment and must see the whole presentation without a complaint.
    func testHLSPlaylistsPlayThroughWithoutComplaint() async throws {
        for name in ["avc-aac-srt", "hevc-eac3-ac3"] {
            let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture(name)), targetSegment: 2)
            let directory = try Self.tempDirectory("hls-\(name)")
            defer { try? FileManager.default.removeItem(at: directory) }
            try await RemuxTests.dump(remuxer, to: directory)
            let run = try Self.run("ffmpeg", ["-v", "error", "-xerror", "-allowed_extensions", "ALL", "-i", directory.appendingPathComponent("master.m3u8").path,
                                              "-map", "0:v", "-map", "0:a", "-f", "null", "-"])
            XCTAssertEqual(run.status, 0, "\(name): \(run.err)")
            XCTAssertEqual(run.err, "", "\(name): HLS demux complaints")
        }
    }

    /// WebVTT segments are readable by a WebVTT parser that isn't ours.
    func testSubtitleSegmentsAreValidWebVTT() async throws {
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("avc-aac-srt")), targetSegment: 2)
        let directory = try Self.tempDirectory("vtt")
        defer { try? FileManager.default.removeItem(at: directory) }
        var cues = 0
        for segment in remuxer.segments {
            let vtt = try await remuxer.subtitleSegment(track: remuxer.subtitles[0].id, index: segment.index)
            let text = try XCTUnwrap(vtt)
            let file = directory.appendingPathComponent("\(segment.index).vtt")
            try Data(text.utf8).write(to: file)
            XCTAssertEqual(try Self.probeStreams(file).map(\.codec), ["webvtt"], "segment \(segment.index)")
            let r = try Self.run("ffprobe", ["-v", "error", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", file.path])
            XCTAssertEqual(r.status, 0, r.err)
            cues += String(decoding: r.out, as: UTF8.self).split(separator: "\n").count
        }
        XCTAssertGreaterThanOrEqual(cues, 2, "the fixture's cues come through")
    }
}
