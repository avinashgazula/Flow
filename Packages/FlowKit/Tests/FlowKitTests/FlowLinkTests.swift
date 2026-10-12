import XCTest
@testable import FlowKit

final class FlowLinkTests: XCTestCase {
    private func link(_ string: String) -> FlowLink? { URL(string: string).flatMap(FlowLink.init(url:)) }

    func testTitlesAndPlayback() {
        XCTAssertEqual(link("flow://title/movie/693134"), .title(MediaKey(type: .movie, tmdbID: 693134)))
        XCTAssertEqual(link("flow://title/show/1399"), .title(MediaKey(type: .show, tmdbID: 1399)))
        XCTAssertEqual(link("flow://play/movie/603"), .play(MediaKey(type: .movie, tmdbID: 603)))
    }

    func testTVIsAShowAsOnTMDb() {
        XCTAssertEqual(link("flow://title/tv/100088"), .title(MediaKey(type: .show, tmdbID: 100088)))
        XCTAssertEqual(link("flow://play/TV/100088"), .play(MediaKey(type: .show, tmdbID: 100088)))
    }

    func testOtherDestinations() {
        XCTAssertEqual(link("flow://continue"), .resume)
        XCTAssertEqual(link("flow://upcoming"), .upcoming)
        XCTAssertEqual(link("flow://search?q=the%20bear"), .search("the bear"))
        XCTAssertEqual(link("flow://search"), .search(""))
        XCTAssertEqual(link("flow://setup?d=abc"), .setup("flow://setup?d=abc"))
    }

    func testUnknownLinksAreIgnored() {
        XCTAssertNil(link("flow://title/person/123"))
        XCTAssertNil(link("flow://title/movie"))
        XCTAssertNil(link("flow://title/movie/dune"))
        XCTAssertNil(link("flow://somewhere"))
        XCTAssertNil(link("https://title/movie/603"))
    }
}
