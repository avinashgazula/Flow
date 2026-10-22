import XCTest
@testable import FlowKit

final class WatchlistOrderTests: XCTestCase {
    private func key(_ id: Int) -> MediaKey { MediaKey(type: .movie, tmdbID: id) }

    func testSavedOrderComesFirstAndNewerTitlesFollow() {
        let tracker = [key(1), key(2), key(3), key(4)]
        let saved = [key(3), key(1)]
        XCTAssertEqual(WatchlistOrder.applying(saved, to: tracker), [key(3), key(1), key(2), key(4)])
    }

    func testTitlesRemovedFromTheWatchlistDropOutOfTheSavedOrder() {
        let tracker = [key(1), key(2)]
        let saved = [key(9), key(2), key(1), key(2)]
        XCTAssertEqual(WatchlistOrder.applying(saved, to: tracker), [key(2), key(1)])
    }

    func testNothingSavedLeavesTheTrackersOrder() {
        let tracker = [key(5), key(6), key(7)]
        XCTAssertEqual(WatchlistOrder.applying([], to: tracker), tracker)
    }

    func testMovingBeforeATarget() {
        let keys = [key(1), key(2), key(3), key(4)]
        XCTAssertEqual(WatchlistOrder.moving([key(4)], before: key(2), in: keys), [key(1), key(4), key(2), key(3)])
        XCTAssertEqual(WatchlistOrder.moving([key(1), key(2)], before: key(4), in: keys), [key(3), key(1), key(2), key(4)])
    }

    func testMovingToTheEnd() {
        let keys = [key(1), key(2), key(3)]
        XCTAssertEqual(WatchlistOrder.moving([key(1)], before: nil, in: keys), [key(2), key(3), key(1)])
    }

    func testMovingBeforeAnItemThatIsMovingGoesToTheEnd() {
        let keys = [key(1), key(2), key(3)]
        XCTAssertEqual(WatchlistOrder.moving([key(1), key(2)], before: key(2), in: keys), [key(3), key(1), key(2)])
    }

    func testUnknownKeysAreIgnored() {
        let keys = [key(1), key(2)]
        XCTAssertEqual(WatchlistOrder.moving([key(9)], before: key(1), in: keys), [key(1), key(2)])
    }
}
