import XCTest
@testable import FlowKit

final class BrowseHelpersTests: XCTestCase {
    func testInterleavedKeepsTheLongerListsTail() {
        XCTAssertEqual([1, 3, 5].interleaved(with: [2, 4]), [1, 2, 3, 4, 5])
        XCTAssertEqual([Int]().interleaved(with: [7, 8]), [7, 8], "One list failing to load must not empty the row")
        XCTAssertEqual([7, 8].interleaved(with: []), [7, 8])
        XCTAssertEqual([Int]().interleaved(with: []), [])
    }

    /// The aired-episode count a show is compared against leaves specials out, so watched specials can't complete it.
    func testRegularWatchedCountIgnoresSpecials() {
        let key = MediaKey(type: .show, tmdbID: 1)
        let state = ShowWatchState(key: key, watched: [EpisodeRef(season: 0, episode: 1), EpisodeRef(season: 0, episode: 2),
                                                       EpisodeRef(season: 1, episode: 1)])
        XCTAssertEqual(state.watched.count, 3)
        XCTAssertEqual(state.regularWatchedCount, 1)
    }
}
