import XCTest
@testable import FlowKit

final class TitleHeadTests: XCTestCase {
    func testThePictureLeavesRoomForTheRatingsAndPlayOnTheFirstScreen() {
        XCTAssertEqual(TitleHead.height(shape: .phone, width: 402, viewport: 874), 437, accuracy: 0.001)
        XCTAssertEqual(TitleHead.height(shape: .phone, width: 320, viewport: 400), 300, "a tiny window still holds the logo and the facts")
        XCTAssertEqual(TitleHead.height(shape: .wide, width: 1024, viewport: 1366), 576, accuracy: 0.001, "16:9 when the window is tall")
        XCTAssertEqual(TitleHead.height(shape: .wide, width: 1440, viewport: 900), 558, accuracy: 0.001, "capped on a short one")
        XCTAssertEqual(TitleHead.height(shape: .tv, width: 1920, viewport: 1080), 756, accuracy: 0.001)
        XCTAssertLessThan(TitleHead.height(shape: .phone, width: 402, viewport: 874), HeroLead.height(shape: .phone, width: 402, viewport: 874),
                          "shorter than Home's lead")
    }

    func testTheFactsLineIsYearGenresAndLength() {
        XCTAssertEqual(TitleHead.facts(year: 2024, genres: ["Science Fiction", "Adventure", "Drama"], runtimeMinutes: 167, seasons: nil),
                       ["2024", "Science Fiction, Adventure", "2h47"])
        XCTAssertEqual(TitleHead.facts(year: 2008, genres: ["Drama"], runtimeMinutes: 47, seasons: 5), ["2008", "Drama", "5 seasons"],
                       "a show gives its seasons, not an episode's runtime")
        XCTAssertEqual(TitleHead.facts(year: nil, genres: [], runtimeMinutes: nil, seasons: 1), ["1 season"])
        XCTAssertEqual(TitleHead.facts(year: nil, genres: ["", ""], runtimeMinutes: 0, seasons: 0), [], "nothing known, nothing said")
    }

    func testRatingsShareTheirLinesEvenly() {
        XCTAssertEqual(TitleHead.ratingColumns(count: 3, perLine: 4), 3, "all in one line when they fit")
        XCTAssertEqual(TitleHead.ratingColumns(count: 4, perLine: 4), 4)
        XCTAssertEqual(TitleHead.ratingColumns(count: 5, perLine: 4), 3, "three and two, not four and one")
        XCTAssertEqual(TitleHead.ratingColumns(count: 6, perLine: 4), 3, "three and three")
        XCTAssertEqual(TitleHead.ratingColumns(count: 7, perLine: 4), 4)
        XCTAssertEqual(TitleHead.ratingColumns(count: 7, perLine: 7), 7)
        XCTAssertEqual(TitleHead.ratingColumns(count: 0, perLine: 4), 1)
    }

    func testAnEpisodesCardSaysHowLongAndHowRated() {
        XCTAssertEqual(TitleHead.episodeFacts(runtimeMinutes: 59, rating: 8.04), "59m · ★ 8.0")
        XCTAssertEqual(TitleHead.episodeFacts(runtimeMinutes: 62, rating: nil), "1h02")
        XCTAssertEqual(TitleHead.episodeFacts(runtimeMinutes: nil, rating: 7.5), "★ 7.5")
        XCTAssertEqual(TitleHead.episodeFacts(runtimeMinutes: 0, rating: 0), "")
    }
}
