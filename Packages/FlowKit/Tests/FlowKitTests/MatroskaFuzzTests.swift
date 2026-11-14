import XCTest
@testable import FlowKit

/// Matroska files come from anywhere (a damaged download, a hostile server). Whatever the bytes,
/// reading and remuxing must neither crash nor hang: the answer is an error, nothing, or a partial result.
/// Seeds are fixed, so a failure reproduces: re-run with the same seed and case number.
final class MatroskaFuzzTests: XCTestCase {
    static let names = ["avc-aac-srt", "hevc-eac3-ac3", "dts-commentary", "opus", "audio-any"]

    static func bytes(_ name: String) throws -> [UInt8] {
        [UInt8](try Data(contentsOf: MatroskaTests.fixture(name)))
    }

    /// Everything a player does with a file, against mutated bytes. Returns normally for any outcome
    /// that isn't a crash; asserts that what comes back is self-consistent.
    @discardableResult
    func exercise(_ bytes: [UInt8], file: StaticString = #filePath, line: UInt = #line) async -> Bool {
        let source = MemoryByteSource(bytes)
        guard let remuxer = try? await MatroskaRemuxer.open(source, targetSegment: 2) else { return false }
        XCTAssertTrue(remuxer.duration.isFinite && remuxer.duration >= 0, "duration \(remuxer.duration)", file: file, line: line)
        for (i, s) in remuxer.segments.enumerated() {
            XCTAssertEqual(s.index, i, "segment indexes run 0..<n", file: file, line: line)
            XCTAssertLessThanOrEqual(s.start, s.end, "segment runs forwards", file: file, line: line)
        }
        let master = await remuxer.masterPlaylist()
        XCTAssertTrue(master.hasPrefix("#EXTM3U"), file: file, line: line)
        let tracks = [remuxer.video?.id].compactMap { $0 } + remuxer.audio.map(\.id)
        for track in tracks {
            _ = try? await remuxer.respond(to: "\(track).m3u8")
            if let initSegment = await remuxer.initSegment(track: track) {
                XCTAssertEqual(Array(initSegment[4..<8]), Array("ftyp".utf8), "init segment starts with ftyp", file: file, line: line)
            }
            for s in remuxer.segments.prefix(3) {
                if case .media(let media)? = try? await remuxer.respond(to: "\(track)/\(s.index).m4s") {
                    XCTAssertLessThan(media.count, 64 << 20, "a segment is never absurdly large", file: file, line: line)
                }
            }
        }
        for sub in remuxer.subtitles { _ = try? await remuxer.respond(to: "\(sub.id)/0.vtt") }
        _ = try? await remuxer.respond(to: "iframes.m3u8")
        _ = try? await remuxer.previewFrame(at: 1)
        _ = try? await remuxer.audioClip(at: 1)
        return true
    }

    /// A file cut off at any point in its first 3 KB (all the header) stops opening cleanly, never crashes.
    func testEveryTruncationOfTheHeader() async throws {
        for name in Self.names {
            let bytes = try Self.bytes(name)
            for cut in 0..<min(3072, bytes.count) {
                let source = MemoryByteSource(Mutation.truncated(bytes, at: cut))
                if let header = try? await MatroskaReader.readHeader(source) {
                    XCTAssertTrue(header.timecodeScale > 0, "\(name) cut at \(cut)")
                }
                // A cut this early can't contain a playable file.
                if cut < 200 { let remuxer = try? await MatroskaRemuxer.open(source); XCTAssertNil(remuxer, "\(name) cut at \(cut)") }
            }
        }
    }

    /// The same, sampled across the rest of the file: a download that stops anywhere still opens or fails cleanly.
    func testTruncationsAcrossTheFile() async throws {
        for name in Self.names {
            let bytes = try Self.bytes(name)
            await Fuzz.casesAsync("truncate \(name)", seed: 11, count: 60) { _, rng in
                await exercise(Mutation.truncated(bytes, at: Int.random(in: 0...bytes.count, using: &rng)))
            }
        }
    }

    func testBitFlipsAndGarbage() async throws {
        for (k, name) in Self.names.enumerated() {
            let bytes = try Self.bytes(name)
            await Fuzz.casesAsync("flips \(name)", seed: 100 + UInt64(k), count: 60) { index, rng in
                let mutated = index % 2 == 0
                    ? Mutation.bitFlips(bytes, count: Int.random(in: 1...16, using: &rng), using: &rng)
                    : Mutation.insertedGarbage(bytes, using: &rng)
                await exercise(mutated)
            }
        }
    }

    /// Length fields set to 0, huge, negative-looking or all ones, aimed at the size field of real elements.
    func testLengthFieldsAtExtremes() async throws {
        for (k, name) in Self.names.enumerated() {
            let bytes = try Self.bytes(name)
            let fields = Fuzz.ebmlSizeFields(bytes)
            XCTAssertGreaterThan(fields.count, 20, "found the element sizes of \(name)")
            var opened = 0
            await Fuzz.casesAsync("sizes \(name)", seed: 200 + UInt64(k), count: 150) { _, rng in
                var mutated = bytes
                for _ in 0..<Int.random(in: 1...3, using: &rng) {
                    let field = fields[Int.random(in: 0..<fields.count, using: &rng)]
                    let value = Mutation.extremes[Int.random(in: 0..<Mutation.extremes.count, using: &rng)]
                    // Keep the size's length marker valid half the time, so the walk goes deeper than "invalid vint".
                    for (i, byte) in value.enumerated() where field.lowerBound + i < mutated.count { mutated[field.lowerBound + i] = byte }
                }
                if await exercise(mutated) { opened += 1 }
            }
            // If nothing opened, the run only proved that broken files are rejected, not that the deeper code survives.
            XCTAssertGreaterThan(opened, 15, "\(name): mutated files that still open")
        }
    }

    func testDuplicatedAndReorderedElements() async throws {
        for (k, name) in Self.names.enumerated() {
            let bytes = try Self.bytes(name)
            await Fuzz.casesAsync("shuffle \(name)", seed: 300 + UInt64(k), count: 60) { index, rng in
                await exercise(index % 2 == 0 ? Mutation.duplicatedChunk(bytes, using: &rng) : Mutation.swappedChunks(bytes, using: &rng))
            }
        }
    }

    /// The cluster parser alone, on bytes that were never a cluster.
    func testClusterParserOnMutatedClusters() async throws {
        for (k, name) in Self.names.enumerated() {
            let bytes = try Self.bytes(name)
            let header = try await MatroskaReader.readHeader(MemoryByteSource(bytes))
            let start = Int(header.firstClusterPosition ?? 0)
            let clusters = Array(bytes[start..<min(bytes.count, start + 40_000)])
            Fuzz.cases("clusters \(name)", seed: 400 + UInt64(k), count: 300) { _, rng in
                let mutated = Mutation.random(clusters, using: &rng)
                if let blocks = try? MatroskaClusterParser.blocks(mutated, timecodeScale: header.timecodeScale, tracks: header.tracks) {
                    for b in blocks { XCTAssertTrue(b.frames.allSatisfy { $0.count <= mutated.count }, "a frame can't be longer than its input") }
                }
            }
            // A hostile timecode scale must not overflow the time maths either.
            for scale in [0, 1, -1, Int64.max, Int64.min, 1 << 40] as [Int64] {
                _ = try? MatroskaClusterParser.blocks(clusters, timecodeScale: scale, tracks: header.tracks)
            }
        }
    }

    func testNonMatroskaBytesAreRejected() async {
        for bytes in [[], [0x1A], [0x1A, 0x45, 0xDF], [0x1A, 0x45, 0xDF, 0xA3], [0x1A, 0x45, 0xDF, 0xA3, 0xFF], [UInt8](repeating: 0xFF, count: 600_000)] as [[UInt8]] {
            let source = MemoryByteSource(bytes)
            let header = try? await MatroskaReader.readHeader(source)
            XCTAssertNil(header, "\(bytes.count) bytes")
        }
    }
}
