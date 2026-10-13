import XCTest
@testable import FlowKit

final class WatchedTitlesTests: XCTestCase {
    private func movie(_ id: Int) -> MediaKey { MediaKey(type: .movie, tmdbID: id) }
    private func show(_ id: Int) -> MediaKey { MediaKey(type: .show, tmdbID: id) }

    func testNothingWatchedIsEmpty() {
        XCTAssertTrue(WatchedTitles.keys(history: [], movies: [], shows: [:]).isEmpty)
    }

    func testWatchedSetsCountWhenThePlayLogIsEmpty() {
        let shows = [show(7): ShowWatchState(key: show(7), watched: [EpisodeRef(season: 1, episode: 1)], lastWatchedAt: Date())]
        let keys = WatchedTitles.keys(history: [], movies: [10, 20], shows: shows)
        XCTAssertEqual(Set(keys), [movie(10), movie(20), show(7)])
    }

    func testPlayLogComesFirstAndNothingRepeats() {
        let log = [HistoryEntry(key: movie(20)), HistoryEntry(key: show(7), episode: EpisodeRef(season: 1, episode: 2)), HistoryEntry(key: movie(20))]
        let shows = [show(7): ShowWatchState(key: show(7), watched: [EpisodeRef(season: 1, episode: 2)], lastWatchedAt: Date())]
        let keys = WatchedTitles.keys(history: log, movies: [10, 20], shows: shows)
        XCTAssertEqual(keys, [movie(20), show(7), movie(10)])
    }

    func testShowsFollowByRecencyAndShowsWithNoEpisodesWatchedAreSkipped() {
        let now = Date()
        let shows = [
            show(1): ShowWatchState(key: show(1), watched: [EpisodeRef(season: 1, episode: 1)], lastWatchedAt: now.addingTimeInterval(-86400)),
            show(2): ShowWatchState(key: show(2), watched: [EpisodeRef(season: 1, episode: 1)], lastWatchedAt: now),
            show(3): ShowWatchState(key: show(3), watched: [], lastWatchedAt: now),
        ]
        XCTAssertEqual(WatchedTitles.keys(history: [], movies: [], shows: shows), [show(2), show(1)])
    }
}
