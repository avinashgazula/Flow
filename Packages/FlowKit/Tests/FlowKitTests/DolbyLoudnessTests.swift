import XCTest
@testable import FlowKit

final class DolbyLoudnessTests: XCTestCase {
    /// Every Dolby frame in the fixture, boosted: the dialogue level drops toward −31 dB by the amount
    /// asked (never past it) and the rewritten frame still passes the decoder's CRC check.
    func testBoostRewritesDialnormAndKeepsCRCsValid() async throws {
        let url = MatroskaTests.fixture("hevc-eac3-ac3")
        let header = try await MatroskaReader.readHeader(FileByteSource(url: url))
        let bytes = [UInt8](try Data(contentsOf: url))
        guard let first = header.firstClusterPosition else { return XCTFail("no clusters") }
        let blocks = try MatroskaClusterParser.blocks(Array(bytes[Int(first)...]), timecodeScale: header.timecodeScale, tracks: header.tracks)
        var checked = [String: Int]()
        for track in header.tracks where ["A_AC3", "A_EAC3"].contains(track.codecID) {
            for block in blocks where block.track == track.number {
                for frame in block.frames {
                    let syncframes = track.codecID == "A_AC3" ? AC3.frames(frame) : [frame]
                    for original in syncframes {
                        XCTAssertTrue(Self.crcValid(original), "\(track.codecID) fixture frame fails its own CRC")
                        let before = try XCTUnwrap(DolbyLoudness.dialogueLevel(original))
                        let boosted = DolbyLoudness.boost(original, dB: 6)
                        XCTAssertEqual(boosted.count, original.count)
                        XCTAssertEqual(DolbyLoudness.dialogueLevel(boosted), min(31, before + 6))
                        XCTAssertTrue(Self.crcValid(boosted), "\(track.codecID) boosted frame fails its CRC")
                        XCTAssertEqual(DolbyLoudness.boost(original, dB: 0), original)
                        checked[track.codecID, default: 0] += 1
                    }
                }
            }
        }
        XCTAssertGreaterThan(checked["A_AC3"] ?? 0, 0)
        XCTAssertGreaterThan(checked["A_EAC3"] ?? 0, 0)
    }

    /// Through the remuxer: segments built after `setLoudnessBoost` carry the raised level, and each
    /// Dolby track reports the headroom it had.
    func testRemuxerAppliesBoostToNewSegments() async throws {
        let remuxer = try await MatroskaRemuxer.open(FileByteSource(url: MatroskaTests.fixture("hevc-eac3-ac3")))
        let dolby = remuxer.audio.filter { $0.codecString == "ec-3" || $0.codecString == "ac-3" }
        XCTAssertFalse(dolby.isEmpty)
        for track in dolby {
            let headroom = try XCTUnwrap(track.loudnessHeadroom)
            let plainBytes = try await remuxer.mediaSegment(track: track.id, index: 0)
            let plain = try XCTUnwrap(plainBytes)
            await remuxer.setLoudnessBoost(3)
            let boostedBytes = try await remuxer.mediaSegment(track: track.id, index: 0)
            let boosted = try XCTUnwrap(boostedBytes)
            await remuxer.setLoudnessBoost(0)
            XCTAssertEqual(plain.count, boosted.count)
            // Same bytes only when the track had no headroom to give.
            XCTAssertEqual(plain == boosted, headroom == 0)
        }
    }

    /// The check a decoder makes: AC-3's first 5/8 and last 3/8 each CRC to zero; E-AC-3's whole frame does.
    static func crcValid(_ f: [UInt8]) -> Bool {
        let bsid = Int(f[5] >> 3)
        if bsid <= 10 {
            guard let size = AC3.parse(f)?.frameBytes, size <= f.count else { return false }
            let fiveEighths = ((size >> 2) + (size >> 4)) << 1
            return DolbyLoudness.crc16(f, 2..<fiveEighths) == 0 && DolbyLoudness.crc16(f, fiveEighths..<size) == 0
        }
        let size = (Int(f[2] & 0x07) << 8 | Int(f[3])) * 2 + 2
        return size <= f.count && DolbyLoudness.crc16(f, 2..<size) == 0
    }
}
