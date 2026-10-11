import XCTest
@testable import FlowKit

/// Removals travel with the library, so a merge with a copy that still has the entry doesn't undo them.
final class LibraryRemovalTests: XCTestCase {
    private let film = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093"), title: "The Matrix")

    private func tracker(_ library: LocalLibrary = LocalLibrary()) -> LocalTracker {
        LocalTracker(library: library) { _ in }
    }

    func testRemovedWatchlistEntryStaysRemovedAfterMergingAnOlderCopy() async throws {
        let local = tracker()
        try await local.setWatchlisted(film, true)
        let otherDevice = await local.library
        try await local.setWatchlisted(film, false)
        await local.merge(otherDevice)
        let watchlist = try await local.watchlist()
        XCTAssertTrue(watchlist.isEmpty)
    }

    func testAddingAgainAfterRemovalWins() async throws {
        let local = tracker()
        try await local.setFavourite(film, true)
        try await local.setFavourite(film, false)
        let removedCopy = await local.library
        try await Task.sleep(nanoseconds: 10_000_000)
        try await local.setFavourite(film, true)
        await local.merge(removedCopy)
        let favourites = try await local.favourites()
        XCTAssertEqual(favourites.count, 1)
    }

    func testRemovalReachesAnotherDevice() async throws {
        let a = tracker(), b = tracker()
        try await a.markWatched(film, episodes: nil, at: Date(timeIntervalSinceNow: -60))
        await b.merge(await a.library)
        try await a.markUnwatched(film, episodes: nil)
        await b.merge(await a.library)
        let watched = try await b.watchedMovies()
        XCTAssertTrue(watched.isEmpty)
    }

    func testMergeIsStableOnceDevicesAgree() async throws {
        let local = tracker()
        try await local.setWatchlisted(film, true)
        try await local.setWatchlisted(film, false)
        let lib = await local.library
        XCTAssertEqual(lib.merged(with: lib), lib.merged(with: lib).merged(with: lib))
    }

    func testOldLibraryWithoutRemovalsStillDecodes() throws {
        let json = #"{"watchlist":[{"key":{"type":"movie","tmdbID":603},"addedAt":0}]}"#
        let decoder = JSONDecoder()
        let lib = try decoder.decode(LocalLibrary.self, from: Data(json.utf8))
        XCTAssertEqual(lib.watchlist.count, 1)
        XCTAssertTrue(lib.removed.isEmpty)
        XCTAssertTrue(lib.history.isEmpty)
    }

    func testRatingsSyncNewestWinsAndRemovalSticks() async throws {
        let a = tracker(), b = tracker()
        await a.setRating(6, for: film)
        await b.merge(await a.library)
        try await Task.sleep(nanoseconds: 10_000_000)
        await b.setRating(9, for: film)
        await a.merge(await b.library)
        let rated = await a.rating(for: film.key!)
        XCTAssertEqual(rated, 9)
        await a.setRating(nil, for: film)
        await b.merge(await a.library)
        let cleared = await b.rating(for: film.key!)
        XCTAssertNil(cleared)
    }
}
