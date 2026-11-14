import XCTest
@testable import FlowKit

/// Crashes the fuzzers found in real code, each pinned by the smallest input that caused it.
final class HardeningTests: XCTestCase {
    /// A damaged file's CodecDelay can be 2^48 ns; multiplying that by the 48 kHz rate overflowed Int64.
    func testHugeOpusCodecDelayIsClamped() throws {
        let setup = try XCTUnwrap(AudioDecoderSetup.resolve(codecID: "A_OPUS", codecPrivate: [], sampleRate: 48000, channels: 2,
                                                            codecDelay: 1 << 48, seekPreRoll: Int64.max))
        XCTAssertEqual(setup.preSkip, 86_400 * 48_000, "capped at a day of samples")
        XCTAssertEqual(AudioDecoderSetup.nanosecondsToOpusSamples(6_500_000), 312, "a real 6.5 ms delay is exact")
        XCTAssertEqual(AudioDecoderSetup.nanosecondsToOpusSamples(-5), 0)
    }

    /// A zip whose first entry claims a name longer than the file indexed past the end of the bytes.
    func testZipEntryNameLongerThanTheFileIsCorrupt() throws {
        var zip = [UInt8](Data(base64Encoded: Fixtures.subtitleZip)!)
        zip[26] = 0xFF; zip[27] = 0xFF // name length of the first local header
        XCTAssertThrowsError(try ZipArchive.entries(Data(zip)))
    }
}
