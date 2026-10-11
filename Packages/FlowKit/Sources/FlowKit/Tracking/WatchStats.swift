import Foundation

/// The window a stats page covers.
public enum StatsPeriod: String, CaseIterable, Hashable, Sendable, Identifiable {
    case thisYear, last30Days, allTime

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .thisYear: return "This Year"
        case .last30Days: return "Last 30 Days"
        case .allTime: return "All Time"
        }
    }
}

/// Viewing statistics ("Your Year in Flow"), computed from watch history. Pure and deterministic: days are
/// reckoned in the `calendar` passed in (the user's own by default), so tests can pin a time zone.
///
/// Rules worth knowing:
/// - The same episode (or film) logged twice on one day counts once; a rewatch on another day counts again.
/// - Watch time is the sum of runtimes. A show's `runtimeMinutes` is its typical episode length. A title that
///   isn't in `items`, or has no runtime, falls back to ``defaultEpisodeMinutes`` / ``defaultFilmMinutes``.
/// - Entries dated after today are ignored.
public struct WatchStats: Equatable, Sendable {
    /// Assumed length of an episode whose runtime is unknown.
    public static let defaultEpisodeMinutes = 45
    /// Assumed length of a film whose runtime is unknown.
    public static let defaultFilmMinutes = 110

    public struct GenreShare: Equatable, Sendable, Identifiable {
        public var name: String
        public var minutes: Int
        /// 0...1 of the minutes attributed to genres. A title with several genres counts towards each.
        public var share: Double
        public var id: String { name }
    }

    public struct ShowCount: Equatable, Sendable, Identifiable {
        public var key: MediaKey
        public var episodes: Int
        public var id: MediaKey { key }
    }

    /// One bar of the histogram.
    public struct Bucket: Equatable, Sendable, Identifiable {
        public var start: Date
        public var minutes: Int
        /// The bucket that contains today.
        public var isCurrent: Bool
        public var id: Date { start }
    }

    public enum Granularity: Sendable { case week, month, year }

    public let period: StatsPeriod
    public let totalMinutes: Int
    /// Distinct film plays (a film watched on two different days counts twice).
    public let filmsWatched: Int
    public let episodesWatched: Int
    public let showsWatched: Int
    public let topGenres: [GenreShare]
    public let mostWatchedShows: [ShowCount]
    /// Consecutive days with at least one watch.
    public let longestStreak: Int
    public let longestStreakStart: Date?
    public let longestStreakEnd: Date?
    /// `Calendar` weekday (1...7) with the most watch time.
    public let busiestWeekday: Int?
    public let histogram: [Bucket]
    public let histogramGranularity: Granularity

    public var isEmpty: Bool { filmsWatched + episodesWatched == 0 }

    public init(period: StatsPeriod, entries: [HistoryEntry], items: [MediaKey: MediaItem] = [:], now: Date = Date(), calendar: Calendar = .current) {
        self.period = period
        let today = calendar.startOfDay(for: now)
        let year = calendar.dateInterval(of: .year, for: now)
        var lower: Date?
        var upper = calendar.date(byAdding: .day, value: 1, to: today) ?? now
        switch period {
        case .thisYear:
            lower = year?.start
            if let end = year?.end { upper = min(upper, end) }
        case .last30Days:
            lower = calendar.date(byAdding: .day, value: -29, to: today)
        case .allTime:
            break
        }

        // One play per title/episode per day.
        struct PlayID: Hashable { var key: MediaKey; var episode: EpisodeRef?; var day: Date }
        struct Play { var key: MediaKey; var day: Date; var minutes: Int }
        var seen = Set<PlayID>()
        var plays: [Play] = []
        // Newest first, which the show tie-break below relies on.
        for entry in entries.sorted(by: { $0.watchedAt > $1.watchedAt }) {
            guard entry.watchedAt < upper, lower.map({ entry.watchedAt >= $0 }) ?? true else { continue }
            let day = calendar.startOfDay(for: entry.watchedAt)
            guard seen.insert(PlayID(key: entry.key, episode: entry.episode, day: day)).inserted else { continue }
            let fallback = entry.key.type == .movie ? Self.defaultFilmMinutes : Self.defaultEpisodeMinutes
            let known = items[entry.key]?.runtimeMinutes.flatMap { $0 > 0 ? $0 : nil }
            plays.append(Play(key: entry.key, day: day, minutes: known ?? fallback))
        }

        totalMinutes = plays.reduce(0) { $0 + $1.minutes }
        filmsWatched = plays.filter { $0.key.type == .movie }.count
        let episodePlays = plays.filter { $0.key.type == .show }
        episodesWatched = episodePlays.count
        showsWatched = Set(episodePlays.map(\.key)).count

        // Genres, by watch time.
        var genreMinutes: [String: Int] = [:]
        for play in plays {
            for genre in items[play.key]?.genres ?? [] { genreMinutes[genre.name, default: 0] += play.minutes }
        }
        let attributed = genreMinutes.values.reduce(0, +)
        topGenres = genreMinutes
            .sorted { ($0.value, $1.key) > ($1.value, $0.key) }
            .prefix(5)
            .map { GenreShare(name: $0.key, minutes: $0.value, share: attributed > 0 ? Double($0.value) / Double(attributed) : 0) }

        // Shows, by episodes watched; ties go to the more recently watched show.
        var episodeCounts: [MediaKey: Int] = [:]
        var recency: [MediaKey: Int] = [:]
        for (index, play) in episodePlays.enumerated() {
            episodeCounts[play.key, default: 0] += 1
            if recency[play.key] == nil { recency[play.key] = index }
        }
        mostWatchedShows = episodeCounts
            .sorted { ($0.value, recency[$1.key] ?? 0, $1.key.description) > ($1.value, recency[$0.key] ?? 0, $0.key.description) }
            .prefix(5)
            .map { ShowCount(key: $0.key, episodes: $0.value) }

        // Streak: the longest run of consecutive calendar days.
        let days = Set(plays.map(\.day)).sorted()
        var bestLength = 0
        var bestStart: Date?
        var bestEnd: Date?
        var runLength = 0
        var runStart: Date?
        var previous: Date?
        for day in days {
            if let previous, calendar.dateComponents([.day], from: previous, to: day).day == 1 {
                runLength += 1
            } else {
                runLength = 1
                runStart = day
            }
            if runLength > bestLength {
                bestLength = runLength
                bestStart = runStart
                bestEnd = day
            }
            previous = day
        }
        longestStreak = bestLength
        longestStreakStart = bestStart
        longestStreakEnd = bestEnd

        // Busiest weekday, by watch time (the earlier weekday wins a tie).
        var weekdayMinutes: [Int: Int] = [:]
        for play in plays { weekdayMinutes[calendar.component(.weekday, from: play.day), default: 0] += play.minutes }
        busiestWeekday = weekdayMinutes.max { ($0.value, $1.key) < ($1.value, $0.key) }?.key

        // Histogram: months for a year, weeks for 30 days, months (or years past two) for everything.
        let earliest = days.first
        let granularity: Granularity
        switch period {
        case .thisYear: granularity = .month
        case .last30Days: granularity = .week
        case .allTime:
            let months = earliest.flatMap { calendar.dateComponents([.month], from: $0, to: now).month } ?? 0
            granularity = months > 24 ? .year : .month
        }
        histogramGranularity = granularity
        let component: Calendar.Component = granularity == .week ? .weekOfYear : granularity == .month ? .month : .year
        func bucketStart(_ date: Date) -> Date { calendar.dateInterval(of: component, for: date)?.start ?? date }
        if let first = period == .thisYear ? year?.start : lower ?? earliest {
            // A year shows all twelve months, so the bars keep their place as the year fills in.
            let last = period == .thisYear ? (year?.end ?? now).addingTimeInterval(-1) : now
            let currentStart = bucketStart(now)
            var minutesByBucket: [Date: Int] = [:]
            for play in plays { minutesByBucket[bucketStart(play.day), default: 0] += play.minutes }
            var buckets: [Bucket] = []
            var cursor = bucketStart(first)
            while cursor <= last {
                buckets.append(Bucket(start: cursor, minutes: minutesByBucket[cursor] ?? 0, isCurrent: cursor == currentStart))
                guard let next = calendar.date(byAdding: component, value: 1, to: cursor) else { break }
                cursor = next
            }
            histogram = buckets
        } else {
            histogram = []
        }
    }

    /// "45 minutes", "20 hours" or "3 days 4 hours": the hero line.
    public static func durationText(minutes: Int) -> String {
        func unit(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }
        let hours = minutes / 60
        if hours >= 48 {
            let rest = hours % 24
            return rest == 0 ? unit(hours / 24, "day") : "\(unit(hours / 24, "day")) \(unit(rest, "hour"))"
        }
        if hours >= 1 { return unit(hours, "hour") }
        return unit(minutes, "minute")
    }
}
