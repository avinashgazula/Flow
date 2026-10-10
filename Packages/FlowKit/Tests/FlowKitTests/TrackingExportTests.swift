import XCTest
@testable import FlowKit

final class TrackingExportTests: XCTestCase {
    func testExportCarriesEveryTrackingList() throws {
        let movie = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 5), title: "M")
        var library = LocalLibrary()
        library.remember(movie)
        library.history = [HistoryEntry(key: movie.key!, watchedAt: Date(timeIntervalSince1970: 100))]
        library.watchlist = [ListEntry(key: movie.key!)]
        library.favourites = [ListEntry(key: movie.key!)]
        library.progress = [PlaybackProgress(key: movie.key!, percent: 40)]
        library.rewatches = [Rewatch(key: MediaKey(type: .show, tmdbID: 6))]

        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: TrackingExport(library: library).json()) as? [String: Any])
        XCTAssertEqual(object["format"] as? String, "flow-tracking")
        for key in ["history", "watchlist", "favourites", "resumePositions", "rewatches"] {
            XCTAssertEqual((object[key] as? [Any])?.count, 1, key)
        }
        XCTAssertNil(object["items"], "Display caches stay out of the export")
    }

    func testClearTrackingEmptiesTheCloudCopyButKeepsShelves() throws {
        let cloud = CloudSync(store: InMemoryKeyValueStore())
        var settings = AppSettings()
        settings.shelves = [.builtIn(.trendingMovies)]
        var library = LocalLibrary()
        library.progress = [PlaybackProgress(key: MediaKey(type: .movie, tmdbID: 5), percent: 40)]
        library.watchlist = [ListEntry(key: MediaKey(type: .movie, tmdbID: 5))]
        try cloud.push(settings: settings, library: library, includeLibrary: true)

        try cloud.clearTracking()
        let snapshot = cloud.pull()
        XCTAssertEqual(snapshot.progress?.count, 0)
        XCTAssertEqual(snapshot.library?.watchlist.count, 0)
        XCTAssertEqual(snapshot.shelves?.count, 1)
    }

    func testClearProgressKeepsHistory() async throws {
        let movie = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 5), title: "M")
        var library = LocalLibrary()
        library.history = [HistoryEntry(key: movie.key!, watchedAt: Date())]
        library.progress = [PlaybackProgress(key: movie.key!, percent: 40)]
        let tracker = LocalTracker(library: library) { _ in }
        await tracker.clearProgress()
        let progress = try await tracker.playbackProgress()
        let history = try await tracker.history(limit: 10)
        XCTAssertTrue(progress.isEmpty)
        XCTAssertEqual(history.count, 1)
    }
}
