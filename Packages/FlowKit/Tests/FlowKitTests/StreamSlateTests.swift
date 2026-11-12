import XCTest
@testable import FlowKit

final class StreamSlateTests: XCTestCase {
    func testSlateAddressesAreRecognisedByWord() {
        XCTAssertTrue(StreamSlate.isSlateURL(URL(string: "https://slate.elfhosted.com/wrong-ip.mp4")!))
        XCTAssertTrue(StreamSlate.isSlateURL(URL(string: "https://cdn.example.com/slates/v1.5.0/different-connection.mkv")!))
        XCTAssertFalse(StreamSlate.isSlateURL(URL(string: "https://cdn.example.com/Slated.2024.1080p.mkv")!))
        XCTAssertFalse(StreamSlate.isSlateURL(URL(string: "https://rd.example.com/d/ABC123/Dune.2160p.mkv")!))
    }

    func testAFewMinutesIsTooShortForAFilm() {
        XCTAssertTrue(StreamSlate.isTooShort(duration: 9, expectedRuntimeMinutes: 166))
        XCTAssertTrue(StreamSlate.isTooShort(duration: 150, expectedRuntimeMinutes: 166))
        XCTAssertFalse(StreamSlate.isTooShort(duration: 600, expectedRuntimeMinutes: 166))
        // A normal cut of a 24-minute episode is not judged short, and a short film is never judged by length.
        XCTAssertFalse(StreamSlate.isTooShort(duration: 1200, expectedRuntimeMinutes: 24))
        XCTAssertFalse(StreamSlate.isTooShort(duration: 9, expectedRuntimeMinutes: 12))
        XCTAssertFalse(StreamSlate.isTooShort(duration: 9, expectedRuntimeMinutes: nil))
        XCTAssertFalse(StreamSlate.isTooShort(duration: 0, expectedRuntimeMinutes: 120))
    }

    func testATinyFileForABigListingIsTooSmall() {
        XCTAssertTrue(StreamSlate.isTooSmall(bytes: 600_000, listedBytes: 12_000_000_000))
        XCTAssertFalse(StreamSlate.isTooSmall(bytes: 9_000_000_000, listedBytes: 12_000_000_000))
        XCTAssertFalse(StreamSlate.isTooSmall(bytes: 600_000, listedBytes: nil))
        XCTAssertFalse(StreamSlate.isTooSmall(bytes: 600_000, listedBytes: 50_000_000))
    }

    func testDetectUsesWhateverIsKnown() {
        XCTAssertFalse(StreamSlate.detect())
        XCTAssertTrue(StreamSlate.detect(finalURL: URL(string: "https://x.test/slate/wrong-ip.mp4")!))
        XCTAssertTrue(StreamSlate.detect(duration: 12, expectedRuntimeMinutes: 100))
        XCTAssertFalse(StreamSlate.detect(finalURL: URL(string: "https://rd.test/file.mkv")!, duration: 6000, bytes: 8_000_000_000, listedBytes: 8_000_000_000, expectedRuntimeMinutes: 100))
    }

    func testElfHostedLinksAreBoundToTheConnection() {
        XCTAssertTrue(StreamSlate.bindsLinksToConnection(URL(string: "https://comet.elfhosted.com/playback/abc")!))
        XCTAssertFalse(StreamSlate.bindsLinksToConnection(URL(string: "https://notelfhosted.com/x")!))
    }
}
