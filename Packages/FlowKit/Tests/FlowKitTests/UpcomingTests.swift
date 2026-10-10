import XCTest
@testable import FlowKit

final class UpcomingTests: XCTestCase {
    private let now = FlowDate.parse("2026-10-10")!.addingTimeInterval(12 * 3600)

    private func show(_ id: Int, _ title: String) -> MediaItem {
        MediaItem(type: .show, ids: ExternalIDs(tmdb: id), title: title)
    }

    private func film(_ id: Int, _ title: String, release: String? = nil) -> MediaItem {
        MediaItem(type: .movie, ids: ExternalIDs(tmdb: id), title: title, releaseDate: release.flatMap(FlowDate.parse))
    }

    private func episode(_ show: Int, _ season: Int, _ number: Int, _ airs: String) -> Episode {
        Episode(showTMDB: show, season: season, number: number, title: "Episode \(number)", airDate: FlowDate.parse(airs))
    }

    private func build(shows: [UpcomingBuilder.ShowInput] = [], films: [UpcomingBuilder.FilmInput] = [], days: Int = 7, premieres: Bool = false, kind: FilmDateKind = .digital) -> [UpcomingEntry] {
        UpcomingBuilder.build(shows: shows, films: films, now: now, withinDays: days, includeWatchlistPremieres: premieres, filmDates: kind, region: "US")
    }

    func testCaughtUpShowsListTheirNextEpisodeInsideTheWindowSoonestFirst() {
        let entries = build(shows: [
            .init(item: show(1, "Later"), nextEpisode: episode(1, 2, 5, "2026-10-15"), caughtUp: true, onWatchlist: false),
            .init(item: show(2, "Sooner"), nextEpisode: episode(2, 1, 3, "2026-10-11"), caughtUp: true, onWatchlist: false),
            .init(item: show(3, "Far Off"), nextEpisode: episode(3, 1, 2, "2026-11-20"), caughtUp: true, onWatchlist: false),
            .init(item: show(4, "Behind"), nextEpisode: episode(4, 1, 2, "2026-10-12"), caughtUp: false, onWatchlist: true),
            .init(item: show(5, "No Date"), nextEpisode: nil, caughtUp: true, onWatchlist: false),
        ])
        XCTAssertEqual(entries.map(\.item.title), ["Sooner", "Later"])
        XCTAssertEqual(entries.map(\.kind), [.episode, .episode])
        XCTAssertEqual(entries.first?.episode?.code, "S01E03")
    }

    func testTodaysEpisodeStillCountsAfterItsMidnightAirDate() {
        let entries = build(shows: [.init(item: show(1, "Tonight"), nextEpisode: episode(1, 1, 4, "2026-10-10"), caughtUp: true, onWatchlist: false)])
        XCTAssertEqual(entries.count, 1)
    }

    func testWatchlistPremieresNeedTheSetting() {
        let inputs: [UpcomingBuilder.ShowInput] = [
            .init(item: show(1, "New Season"), nextEpisode: episode(1, 3, 1, "2026-10-13"), caughtUp: false, onWatchlist: true),
            .init(item: show(2, "Mid Season"), nextEpisode: episode(2, 3, 4, "2026-10-13"), caughtUp: false, onWatchlist: true),
            .init(item: show(3, "Not Listed"), nextEpisode: episode(3, 1, 1, "2026-10-13"), caughtUp: false, onWatchlist: false),
        ]
        XCTAssertTrue(build(shows: inputs).isEmpty)
        let entries = build(shows: inputs, premieres: true)
        XCTAssertEqual(entries.map(\.item.title), ["New Season"])
        XCTAssertEqual(entries.first?.kind, .premiere)
    }

    func testCaughtUpPremiereIsLabelledAsOne() {
        let entries = build(shows: [.init(item: show(1, "Back Again"), nextEpisode: episode(1, 2, 1, "2026-10-12"), caughtUp: true, onWatchlist: false)])
        XCTAssertEqual(entries.first?.kind, .premiere)
    }

    func testFilmsUseTheChosenReleaseDate() {
        let releases = [
            MovieRelease(country: "US", type: .theatrical, date: FlowDate.parse("2026-09-26")!),
            MovieRelease(country: "US", type: .digital, date: FlowDate.parse("2026-10-14")!),
            MovieRelease(country: "FR", type: .digital, date: FlowDate.parse("2026-10-11")!),
        ]
        let input = UpcomingBuilder.FilmInput(item: film(9, "Opening"), releases: releases)
        XCTAssertTrue(build(films: [input]).isEmpty, "Films only appear with watchlist premieres on")

        let digital = build(films: [input], premieres: true, kind: .digital)
        XCTAssertEqual(digital.first?.date, FlowDate.parse("2026-10-14"), "The viewer's region wins over an earlier release elsewhere")
        XCTAssertEqual(digital.first?.kind, .film)
        // The theatrical run opened before the window, so it isn't upcoming any more.
        XCTAssertTrue(build(films: [input], premieres: true, kind: .theatrical).isEmpty)
    }

    func testFilmFallsBackToItsOwnDatesWithoutReleaseData() {
        var item = film(9, "Sparse", release: "2026-10-16")
        let theatrical = build(films: [.init(item: item, releases: [])], premieres: true, kind: .theatrical)
        XCTAssertEqual(theatrical.count, 1)
        XCTAssertTrue(build(films: [.init(item: item, releases: [])], premieres: true, kind: .digital).isEmpty)
        item.homeReleaseDate = FlowDate.parse("2026-10-12")
        XCTAssertEqual(build(films: [.init(item: item, releases: [])], premieres: true, kind: .digital).count, 1)
    }

    func testEntriesInterleaveShowsAndFilmsByDate() {
        let entries = build(
            shows: [.init(item: show(1, "Show"), nextEpisode: episode(1, 1, 2, "2026-10-14"), caughtUp: true, onWatchlist: false)],
            films: [.init(item: film(2, "Film", release: "2026-10-12"), releases: [])],
            premieres: true, kind: .theatrical)
        XCTAssertEqual(entries.map(\.item.title), ["Film", "Show"])
    }

    func testBuiltInShelfCapsApplyOnlyToCatalogueRows() {
        XCTAssertTrue(BuiltInShelf.trendingMovies.isContentShelf)
        XCTAssertFalse(BuiltInShelf.watchlist.isContentShelf)
        XCTAssertFalse(BuiltInShelf.upcomingEpisodes.isContentShelf)
        XCTAssertTrue(BuiltInShelf.upcomingEpisodes.showsUpcomingByDesign)
    }
}
