import XCTest
@testable import FlowKit

final class JSONFileStoreTests: XCTestCase {
    private func store() -> JSONFileStore {
        JSONFileStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("store-\(UUID().uuidString)"))
    }

    func testSaveLoadRemoveAndSize() throws {
        let s = store()
        defer { s.removeAll(); try? FileManager.default.removeItem(at: s.directory) }
        XCTAssertNil(s.load([Int].self, "nums"), "nothing saved yet")
        s.save([1, 2, 3], "nums")
        XCTAssertEqual(s.load([Int].self, "nums"), [1, 2, 3])
        XCTAssertEqual(String(decoding: try XCTUnwrap(s.loadData("nums")), as: UTF8.self), "[1,2,3]")
        XCTAssertGreaterThan(s.sizeInBytes, 0)
        XCTAssertNotNil(s.modificationDate("nums"))
        XCTAssertNil(s.modificationDate("missing"))
        XCTAssertNil(s.load(String.self, "nums"), "a file of the wrong shape reads as nothing")
        s.remove("nums")
        XCTAssertNil(s.load([Int].self, "nums"))
        s.save("a", "one"); s.save("b", "two")
        s.removeAll()
        XCTAssertEqual(s.sizeInBytes, 0)
    }

    func testSavingReplacesWholeFilesAtomically() {
        let s = store()
        defer { try? FileManager.default.removeItem(at: s.directory) }
        s.save(String(repeating: "x", count: 10_000), "v")
        s.save("short", "v")
        XCTAssertEqual(s.load(String.self, "v"), "short", "no tail of the longer file is left behind")
    }

    func testSecretsRoundTripThroughTheFileStore() {
        let s = store()
        defer { try? FileManager.default.removeItem(at: s.directory) }
        let secrets = FileSecretStore(store: s)
        XCTAssertEqual(secrets.load(), Credentials(), "empty before anything is saved")
        var credentials = Credentials()
        credentials.tmdbAPIKey = "abc"
        secrets.save(credentials)
        XCTAssertEqual(secrets.load().tmdbAPIKey, "abc")
    }

    func testStandardLocationsAreUsable() {
        let support = JSONFileStore.applicationSupport("FlowKitTests-\(UUID().uuidString)")
        let caches = JSONFileStore.caches("FlowKitTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: support.directory); try? FileManager.default.removeItem(at: caches.directory) }
        support.save(1, "n")
        caches.save(2, "n")
        XCTAssertEqual(support.load(Int.self, "n"), 1)
        XCTAssertEqual(caches.load(Int.self, "n"), 2)
        XCTAssertNotEqual(support.directory, caches.directory)
    }
}

final class ModelVocabularyTests: XCTestCase {
    func testResumePositionPrefersTheExactPositionThenDerivesItFromPercent() {
        let key = MediaKey(type: .movie, tmdbID: 1)
        XCTAssertEqual(PlaybackProgress(key: key, percent: 50, positionSeconds: 1234).resumePosition(runtimeSeconds: 7200), 1234)
        XCTAssertEqual(PlaybackProgress(key: key, percent: 25, durationSeconds: 4000).resumePosition(runtimeSeconds: 7200), 1000, "the progress's own duration wins")
        XCTAssertEqual(PlaybackProgress(key: key, percent: 50).resumePosition(runtimeSeconds: 7200), 3600)
        XCTAssertNil(PlaybackProgress(key: key, percent: 50).resumePosition(runtimeSeconds: nil), "no length, no position")
    }

    func testRatingsKnowWhenTheyAreEmpty() {
        XCTAssertTrue(Ratings().isEmpty)
        for set in [{ (r: inout Ratings) in r.imdb = 7 }, { $0.rottenTomatoes = 80 }, { $0.popcorn = 1 }, { $0.metacritic = 1 }, { $0.tmdb = 1 }, { $0.letterboxd = 1 }, { $0.trakt = 1 }] as [(inout Ratings) -> Void] {
            var r = Ratings()
            set(&r)
            XCTAssertFalse(r.isEmpty)
        }
    }

    func testSourceCategoriesHaveWordsAndSymbols() {
        for category in SourceCategory.allCases {
            XCTAssertFalse(category.displayName.isEmpty)
            XCTAssertFalse(category.systemImage.isEmpty)
            XCTAssertEqual(category.id, category.rawValue)
        }
        XCTAssertEqual(SourceCategory.iptv.displayName, "IPTV / VOD")
    }

    func testQualityOrdersFromCamToRemux() {
        XCTAssertLessThan(ReleaseQuality.cam, .hdtv)
        XCTAssertLessThan(ReleaseQuality.webdl, .bluray)
        XCTAssertLessThan(ReleaseQuality.bluray, .remux)
        XCTAssertEqual(ReleaseQuality.allCases.sorted(), ReleaseQuality.allCases)
        XCTAssertLessThan(VideoResolution.hd720, .uhd4k)
        XCTAssertEqual(VideoResolution.uhd1440.label, "1440p")
    }

    func testOnlyURLLocationsCarryHeaders() {
        XCTAssertEqual(StreamLocation.url(URL(string: "https://x")!, headers: ["A": "b"]).headers, ["A": "b"])
        XCTAssertEqual(StreamLocation.torrent(infoHash: "h", fileIndex: nil).headers, [:])
        XCTAssertEqual(StreamLocation.external(URL(string: "https://x")!).headers, [:])
    }

    func testSkipButtonsSayWhatTheySkip() {
        XCTAssertEqual(SkipSegmentKind.allCases.map(\.buttonTitle), ["Skip Intro", "Skip Recap", "Skip Credits", "Skip Preview", "Skip Ad"])
    }

    func testStremioIDsForTitlesAndEpisodes() {
        let item = MediaItem(type: .show, ids: ExternalIDs(imdb: "tt0944947"), title: "GoT")
        XCTAssertEqual(PlaybackRequest(item: item).stremioID, "tt0944947")
        XCTAssertEqual(PlaybackRequest(item: item, episode: Episode(showTMDB: 1, season: 2, number: 3, title: "x")).stremioID, "tt0944947:2:3")
        XCTAssertNil(PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(), title: "x")).stremioID)
    }
}
