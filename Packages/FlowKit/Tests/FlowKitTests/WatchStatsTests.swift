import XCTest
@testable import FlowKit

final class WatchStatsTests: XCTestCase {
    private let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.firstWeekday = 2
        return calendar
    }()

    /// Saturday 10 October 2026, midday.
    private lazy var now = at("2026-10-10", hour: 12)

    private func at(_ day: String, hour: Int = 20) -> Date {
        FlowDate.parse(day)!.addingTimeInterval(Double(hour) * 3600)
    }

    private func film(_ id: Int, runtime: Int? = nil, genres: [String] = []) -> MediaItem {
        MediaItem(type: .movie, ids: ExternalIDs(tmdb: id), title: "Film \(id)", runtimeMinutes: runtime, genres: genres.enumerated().map { Genre(id: $0.offset, name: $0.element) })
    }

    private func show(_ id: Int, runtime: Int? = nil, genres: [String] = []) -> MediaItem {
        MediaItem(type: .show, ids: ExternalIDs(tmdb: id), title: "Show \(id)", runtimeMinutes: runtime, genres: genres.enumerated().map { Genre(id: $0.offset, name: $0.element) })
    }

    private func watched(_ item: MediaItem, _ day: String, episode: (Int, Int)? = nil, hour: Int = 20) -> HistoryEntry {
        HistoryEntry(key: item.key!, episode: episode.map { EpisodeRef(season: $0.0, episode: $0.1) }, watchedAt: at(day, hour: hour))
    }

    private func stats(_ period: StatsPeriod, _ entries: [HistoryEntry], items: [MediaItem] = []) -> WatchStats {
        WatchStats(period: period, entries: entries, items: Dictionary(items.map { ($0.key!, $0) }, uniquingKeysWith: { a, _ in a }), now: now, calendar: calendar)
    }

    func testEmptyHistoryHasNothingToReport() {
        let stats = stats(.allTime, [])
        XCTAssertTrue(stats.isEmpty)
        XCTAssertEqual(stats.totalMinutes, 0)
        XCTAssertEqual(stats.longestStreak, 0)
        XCTAssertNil(stats.busiestWeekday)
        XCTAssertTrue(stats.histogram.isEmpty)
    }

    func testCountsAndTotalTimeUseKnownRuntimes() {
        let dune = film(1, runtime: 155)
        let bear = show(2, runtime: 30)
        let result = stats(.thisYear, [
            watched(dune, "2026-03-01"),
            watched(bear, "2026-03-02", episode: (1, 1)),
            watched(bear, "2026-03-02", episode: (1, 2)),
            watched(bear, "2026-03-03", episode: (1, 3)),
        ], items: [dune, bear])
        XCTAssertEqual(result.filmsWatched, 1)
        XCTAssertEqual(result.episodesWatched, 3)
        XCTAssertEqual(result.showsWatched, 1)
        XCTAssertEqual(result.totalMinutes, 155 + 3 * 30)
    }

    func testUnknownRuntimesFallBackToDefaults() {
        let noRuntime = film(1)
        let result = stats(.allTime, [
            watched(noRuntime, "2026-05-01"),
            watched(show(2), "2026-05-02", episode: (1, 1)),   // not in the lookup at all
            watched(film(3, runtime: 0), "2026-05-03"),       // a zero runtime is unknown too
        ], items: [noRuntime, film(3, runtime: 0)])
        XCTAssertEqual(result.totalMinutes, 110 + 45 + 110)
    }

    func testSameEpisodeTwiceOnOneDayCountsOnce() {
        let bear = show(2, runtime: 30)
        let result = stats(.allTime, [
            watched(bear, "2026-04-01", episode: (1, 1), hour: 9),
            watched(bear, "2026-04-01", episode: (1, 1), hour: 22),
            watched(bear, "2026-04-08", episode: (1, 1)),     // a rewatch on another day still counts
        ], items: [bear])
        XCTAssertEqual(result.episodesWatched, 2)
        XCTAssertEqual(result.totalMinutes, 60)
        XCTAssertEqual(result.mostWatchedShows, [WatchStats.ShowCount(key: bear.key!, episodes: 2)])
    }

    func testPeriodFiltering() {
        let bear = show(2, runtime: 30)
        let entries = [
            watched(bear, "2025-12-31", episode: (1, 1)),
            watched(bear, "2026-01-01", episode: (1, 2)),
            watched(bear, "2026-09-10", episode: (1, 3)),     // 30 days back: just outside
            watched(bear, "2026-09-11", episode: (1, 4)),     // 29 days back: the first day inside
            watched(bear, "2026-10-10", episode: (1, 5), hour: 23),
            watched(bear, "2026-10-12", episode: (1, 6)),     // in the future
        ]
        XCTAssertEqual(stats(.allTime, entries, items: [bear]).episodesWatched, 5)
        XCTAssertEqual(stats(.thisYear, entries, items: [bear]).episodesWatched, 4)
        XCTAssertEqual(stats(.last30Days, entries, items: [bear]).episodesWatched, 2)
    }

    func testStreakRunsAcrossMonthAndYearBoundaries() {
        let bear = show(2, runtime: 30)
        let days = ["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02",   // 4 across a month boundary
                    "2026-02-10", "2026-02-11"]
        let result = stats(.thisYear, days.enumerated().map { watched(bear, $0.element, episode: (1, $0.offset + 1)) }, items: [bear])
        XCTAssertEqual(result.longestStreak, 4)
        XCTAssertEqual(result.longestStreakStart, at("2026-01-30", hour: 0))
        XCTAssertEqual(result.longestStreakEnd, at("2026-02-02", hour: 0))

        let overNewYear = stats(.allTime, ["2025-12-30", "2025-12-31", "2026-01-01"].enumerated().map { watched(bear, $0.element, episode: (1, $0.offset + 1)) }, items: [bear])
        XCTAssertEqual(overNewYear.longestStreak, 3)
    }

    func testSeveralWatchesInOneDayAreOneDayOfStreak() {
        let bear = show(2, runtime: 30)
        let result = stats(.allTime, [
            watched(bear, "2026-06-01", episode: (1, 1), hour: 8),
            watched(bear, "2026-06-01", episode: (1, 2), hour: 20),
            watched(bear, "2026-06-03", episode: (1, 3)),
        ], items: [bear])
        XCTAssertEqual(result.longestStreak, 1)
    }

    func testStreakAcrossDaylightSavingChange() {
        var zoned = calendar
        zoned.timeZone = TimeZone(identifier: "America/New_York")!
        let bear = show(2, runtime: 30)
        // New York changed clocks on 2026-03-08: a 23-hour day between two evenings.
        let entries = ["2026-03-07", "2026-03-08", "2026-03-09"].enumerated().map { watched(bear, $0.element, episode: (1, $0.offset + 1), hour: 22) }
        let result = WatchStats(period: .allTime, entries: entries, items: [bear.key!: bear], now: now, calendar: zoned)
        XCTAssertEqual(result.longestStreak, 3)
    }

    func testGenreSharesRankByWatchTime() {
        let drama = film(1, runtime: 120, genres: ["Drama", "Crime"])
        let comedy = show(2, runtime: 30, genres: ["Comedy"])
        let result = stats(.allTime, [
            watched(drama, "2026-02-01"),
            watched(comedy, "2026-02-02", episode: (1, 1)),
            watched(comedy, "2026-02-03", episode: (1, 2)),
        ], items: [drama, comedy])
        // Drama 120, Crime 120, Comedy 60: a multi-genre title counts towards each; shares sum to one.
        XCTAssertEqual(result.topGenres.map(\.name), ["Crime", "Drama", "Comedy"])
        XCTAssertEqual(result.topGenres.map(\.minutes), [120, 120, 60])
        XCTAssertEqual(result.topGenres[0].share, 0.4, accuracy: 0.0001)
        XCTAssertEqual(result.topGenres[2].share, 0.2, accuracy: 0.0001)
        XCTAssertEqual(result.topGenres.map(\.share).reduce(0, +), 1, accuracy: 0.0001)
    }

    func testTopGenresAndShowsAreCappedAtFive() {
        let shows = (1...7).map { show($0, runtime: 30, genres: ["Genre \($0)"]) }
        // Show n is watched n times (distinct episodes).
        let entries = shows.flatMap { item in (1...item.ids.tmdb!).map { watched(item, "2026-07-01", episode: (1, $0)) } }
        let result = stats(.allTime, entries, items: shows)
        XCTAssertEqual(result.topGenres.count, 5)
        XCTAssertEqual(result.topGenres.first?.name, "Genre 7")
        XCTAssertEqual(result.mostWatchedShows.map(\.episodes), [7, 6, 5, 4, 3])
        XCTAssertEqual(result.mostWatchedShows.first?.key, shows[6].key)
        XCTAssertEqual(result.showsWatched, 7)
    }

    func testBusiestWeekdayIsByWatchTime() {
        let bear = show(2, runtime: 30)
        let long = film(3, runtime: 180)
        let result = stats(.allTime, [
            watched(bear, "2026-10-05", episode: (1, 1)),     // Monday
            watched(bear, "2026-10-05", episode: (1, 2)),
            watched(bear, "2026-10-05", episode: (1, 3)),
            watched(long, "2026-10-09"),                      // Friday, longer in total
        ], items: [bear, long])
        XCTAssertEqual(result.busiestWeekday, 6)
    }

    func testYearHistogramHasTwelveMonthsAndMarksTheCurrentOne() {
        let bear = show(2, runtime: 30)
        let result = stats(.thisYear, [
            watched(bear, "2026-01-15", episode: (1, 1)),
            watched(bear, "2026-01-16", episode: (1, 2)),
            watched(bear, "2026-10-02", episode: (1, 3)),
        ], items: [bear])
        XCTAssertEqual(result.histogramGranularity, .month)
        XCTAssertEqual(result.histogram.count, 12)
        XCTAssertEqual(result.histogram[0].minutes, 60)
        XCTAssertEqual(result.histogram[9].minutes, 30)
        XCTAssertTrue(result.histogram[9].isCurrent)
        XCTAssertEqual(result.histogram.filter(\.isCurrent).count, 1)
        XCTAssertEqual(result.histogram.map(\.minutes).reduce(0, +), result.totalMinutes)
    }

    func testThirtyDayHistogramIsWeekly() {
        let bear = show(2, runtime: 30)
        let result = stats(.last30Days, [
            watched(bear, "2026-09-14", episode: (1, 1)),     // Monday of a week
            watched(bear, "2026-09-20", episode: (1, 2)),     // the same week's Sunday
            watched(bear, "2026-10-10", episode: (1, 3)),
        ], items: [bear])
        XCTAssertEqual(result.histogramGranularity, .week)
        XCTAssertEqual(result.histogram.first?.start, at("2026-09-07", hour: 0))
        XCTAssertEqual(result.histogram.count, 5)
        XCTAssertEqual(result.histogram.first { $0.start == at("2026-09-14", hour: 0) }?.minutes, 60)
        XCTAssertEqual(result.histogram.last?.minutes, 30)
        XCTAssertEqual(result.histogram.last?.isCurrent, true)
    }

    func testAllTimeHistogramSwitchesToYearsOverTwoYears() {
        let bear = show(2, runtime: 30)
        let recent = stats(.allTime, [watched(bear, "2026-05-01", episode: (1, 1))], items: [bear])
        XCTAssertEqual(recent.histogramGranularity, .month)
        XCTAssertEqual(recent.histogram.count, 6)

        let old = stats(.allTime, [watched(bear, "2022-05-01", episode: (1, 1)), watched(bear, "2026-05-01", episode: (1, 2))], items: [bear])
        XCTAssertEqual(old.histogramGranularity, .year)
        XCTAssertEqual(old.histogram.count, 5)
        XCTAssertEqual(old.histogram.map(\.minutes), [30, 0, 0, 0, 30])
    }

    func testDurationText() {
        XCTAssertEqual(WatchStats.durationText(minutes: 1), "1 minute")
        XCTAssertEqual(WatchStats.durationText(minutes: 45), "45 minutes")
        XCTAssertEqual(WatchStats.durationText(minutes: 61), "1 hour")
        XCTAssertEqual(WatchStats.durationText(minutes: 30 * 60), "30 hours")
        XCTAssertEqual(WatchStats.durationText(minutes: (3 * 24 + 4) * 60 + 20), "3 days 4 hours")
        XCTAssertEqual(WatchStats.durationText(minutes: 48 * 60), "2 days")
    }
}
