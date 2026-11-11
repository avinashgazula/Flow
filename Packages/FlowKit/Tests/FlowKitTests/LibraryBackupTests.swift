import XCTest
@testable import FlowKit

final class LibraryBackupTests: XCTestCase {
    private let movie = MediaKey(type: .movie, tmdbID: 5)
    private let show = MediaKey(type: .show, tmdbID: 6)

    func testOwnExportRoundTrips() throws {
        var library = LocalLibrary()
        library.history = [HistoryEntry(key: movie, watchedAt: Date(timeIntervalSince1970: 100)),
                           HistoryEntry(key: show, episode: EpisodeRef(season: 1, episode: 2), watchedAt: Date(timeIntervalSince1970: 200))]
        library.watchlist = [ListEntry(key: movie, addedAt: Date(timeIntervalSince1970: 50))]
        library.progress = [PlaybackProgress(key: movie, percent: 40, updatedAt: Date(timeIntervalSince1970: 60))]
        library.rewatches = [Rewatch(key: show, startedAt: Date(timeIntervalSince1970: 70), watched: [EpisodeRef(season: 1, episode: 1)])]
        let data = try TrackingExport(library: library).json()

        let parsed = try LibraryBackup.parse(data)
        XCTAssertEqual(parsed.source, .tracking)
        XCTAssertEqual(parsed.library.history, library.history)
        XCTAssertEqual(parsed.library.watchlist, library.watchlist)
        XCTAssertEqual(parsed.library.progress, library.progress)
        XCTAssertEqual(parsed.library.rewatches, library.rewatches)
        XCTAssertEqual(parsed.counts.summary, "2 watched, 1 on the watchlist, 1 resume positions, 1 rewatches")
    }

    func testWebBackupLibraryPart() throws {
        let json = """
        {"format":"flow-web-backup","version":1,"exportedAt":"2026-10-01T10:00:00.000Z","settings":{"tmdbKey":"x"},
         "library":{
          "history":[{"key":"movie:5","item":{"type":"movie","id":5,"title":"Dune","poster":"/p.jpg","date":"2021-10-22","overview":""},"watchedAt":1700000000000}],
          "watchedEpisodes":{"show:6:s1e2":1700000500000,"show:6:s1e3":1700000600000},
          "watchlist":[{"key":"show:6","item":{"type":"show","id":6,"title":"Show"},"addedAt":1700000000000}],
          "favourites":[],
          "progress":{"movie:7":{"key":"movie:7","item":{"type":"movie","id":7,"title":"Other"},"position":1800,"duration":7200,"updatedAt":1700000000000}},
          "ratings":{"movie:5":8,"bogus":3},
          "rewatches":{"show:6":{"startedAt":1700000000000,"watched":["s1e1","junk"]}}}}
        """
        let parsed = try LibraryBackup.parse(Data(json.utf8))
        XCTAssertEqual(parsed.source, .web)
        XCTAssertEqual(parsed.library.history.count, 3)
        XCTAssertEqual(parsed.library.history.first { $0.key == movie }?.watchedAt, Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(parsed.library.history.filter { $0.key == show }.compactMap(\.episode).sorted(), [EpisodeRef(season: 1, episode: 2), EpisodeRef(season: 1, episode: 3)])
        XCTAssertEqual(parsed.library.watchlist.map(\.key), [show])
        XCTAssertEqual(parsed.library.progress.first?.percent, 25)
        XCTAssertEqual(parsed.library.ratings["movie:5"]?.value, 8)
        XCTAssertNil(parsed.library.ratings["bogus"])
        XCTAssertEqual(parsed.library.rewatches.first?.watched, [EpisodeRef(season: 1, episode: 1)])
        XCTAssertEqual(parsed.library.items["movie:5"]?.title, "Dune")
        XCTAssertEqual(parsed.library.items["movie:5"]?.posterPath, "/p.jpg")
    }

    func testWebEpisodeAlreadyInHistoryIsNotDoubled() throws {
        let json = """
        {"format":"flow-web-backup","version":1,"library":{
          "history":[{"key":"show:6","item":{"type":"show","id":6,"title":"S"},"episode":{"season":1,"episode":2},"watchedAt":1700000000000}],
          "watchedEpisodes":{"show:6:s1e2":1700000000000}}}
        """
        XCTAssertEqual(try LibraryBackup.parse(Data(json.utf8)).library.history.count, 1)
    }

    func testRejectsWhatIsNotABackup() {
        XCTAssertThrowsError(try LibraryBackup.parse(Data("nope".utf8))) { XCTAssertEqual($0 as? LibraryBackup.ParseError, .notJSON) }
        XCTAssertThrowsError(try LibraryBackup.parse(Data("{\"format\":\"other\"}".utf8))) { XCTAssertEqual($0 as? LibraryBackup.ParseError, .notABackup) }
        XCTAssertThrowsError(try LibraryBackup.parse(Data("{\"format\":\"flow-tracking\",\"version\":9}".utf8))) { XCTAssertEqual($0 as? LibraryBackup.ParseError, .newerVersion) }
        XCTAssertThrowsError(try LibraryBackup.parse(Data("{\"format\":\"flow-web-backup\",\"version\":1,\"library\":{}}".utf8))) { XCTAssertEqual($0 as? LibraryBackup.ParseError, .empty) }
    }

    func testRestoreKeepsWhatIsHereAndBringsBackWhatWasRemoved() {
        var current = LocalLibrary()
        current.watchlist = [ListEntry(key: show, addedAt: Date(timeIntervalSince1970: 500))]
        var backup = LocalLibrary()
        backup.watchlist = [ListEntry(key: movie, addedAt: Date(timeIntervalSince1970: 100))]
        // The movie was taken off the watchlist here after the backup entry was made.
        current.removed[LocalLibrary.tombstone("watchlist", movie.description)] = Date(timeIntervalSince1970: 300)

        let restored = LibraryBackup.restore(backup, into: current)
        XCTAssertEqual(Set(restored.watchlist.map(\.key)), [movie, show])
    }

    func testRestoreTakesTheNewerEntryForTheSameTitle() {
        var current = LocalLibrary()
        current.progress = [PlaybackProgress(key: movie, percent: 80, updatedAt: Date(timeIntervalSince1970: 900))]
        var backup = LocalLibrary()
        backup.progress = [PlaybackProgress(key: movie, percent: 10, updatedAt: Date(timeIntervalSince1970: 100))]
        XCTAssertEqual(LibraryBackup.restore(backup, into: current).progress.first?.percent, 80)
    }
}
