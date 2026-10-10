import Foundation

/// One dated row on the Upcoming shelf: an episode of a show you're caught up on, a season premiere
/// from your watchlist, or a watchlisted film about to come out.
public struct UpcomingEntry: Hashable, Sendable, Identifiable {
    public enum Kind: String, Sendable { case episode, premiere, film }

    public var item: MediaItem
    /// Nil for films.
    public var episode: Episode?
    public var date: Date
    public var kind: Kind

    public init(item: MediaItem, episode: Episode?, date: Date, kind: Kind) {
        self.item = item
        self.episode = episode
        self.date = date
        self.kind = kind
    }

    public var id: String { episode?.id ?? "film:\(item.id)" }
}

/// Decides what the Upcoming shelf lists. Pure: the app gathers the inputs, this picks and orders.
public enum UpcomingBuilder {
    /// A show with the next episode TMDb knows of.
    public struct ShowInput: Sendable {
        public var item: MediaItem
        public var nextEpisode: Episode?
        /// Everything that has aired is watched (and something has been).
        public var caughtUp: Bool
        public var onWatchlist: Bool

        public init(item: MediaItem, nextEpisode: Episode?, caughtUp: Bool, onWatchlist: Bool) {
            self.item = item
            self.nextEpisode = nextEpisode
            self.caughtUp = caughtUp
            self.onWatchlist = onWatchlist
        }
    }

    /// A watchlisted film with its per-country release dates.
    public struct FilmInput: Sendable {
        public var item: MediaItem
        public var releases: [MovieRelease]

        public init(item: MediaItem, releases: [MovieRelease]) {
            self.item = item
            self.releases = releases
        }
    }

    /// Entries dated from today through `withinDays` days out, soonest first.
    /// Caught-up shows list their next episode; `includeWatchlistPremieres` adds season premieres of
    /// watchlisted shows and unreleased watchlisted films, dated by `filmDates`.
    public static func build(shows: [ShowInput], films: [FilmInput], now: Date = Date(), withinDays: Int, includeWatchlistPremieres: Bool,
                             filmDates: FilmDateKind, region: String? = nil) -> [UpcomingEntry] {
        // TMDb dates are bare days, parsed as midnight UTC; today's must still count after midnight.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let start = calendar.startOfDay(for: now)
        let end = now.addingTimeInterval(Double(withinDays) * 86400)
        func inWindow(_ date: Date) -> Bool { date >= start && date <= end }

        var entries: [UpcomingEntry] = []
        var seen = Set<String>()
        for show in shows {
            guard let next = show.nextEpisode, let date = next.airDate, inWindow(date) else { continue }
            let premiere = next.number == 1
            if show.caughtUp {
                entries.append(UpcomingEntry(item: show.item, episode: next, date: date, kind: premiere ? .premiere : .episode))
            } else if includeWatchlistPremieres, show.onWatchlist, premiere {
                entries.append(UpcomingEntry(item: show.item, episode: next, date: date, kind: .premiere))
            }
        }
        if includeWatchlistPremieres {
            for film in films {
                guard let date = filmDate(film, kind: filmDates, region: region), inWindow(date) else { continue }
                entries.append(UpcomingEntry(item: film.item, episode: nil, date: date, kind: .film))
            }
        }
        return entries
            .filter { seen.insert($0.id).inserted }
            .sorted { ($0.date, $0.item.title) < ($1.date, $1.item.title) }
    }

    /// The date a film counts as out: its digital (or other home) release, or its theatrical one.
    /// Prefers the viewer's region, then any country; falls back to the dates on the item itself.
    public static func filmDate(_ film: FilmInput, kind: FilmDateKind, region: String?) -> Date? {
        let types: [MovieReleaseType] = kind == .digital ? [.digital] : [.theatrical, .theatricalLimited]
        let matching = film.releases.filter { types.contains($0.type) }
        var candidates = matching
        if let region {
            let local = matching.filter { $0.country == region }
            if !local.isEmpty { candidates = local }
        }
        if let date = candidates.map(\.date).min() { return date }
        // Without release data, the primary date is the theatrical one.
        return kind == .digital ? film.item.homeReleaseDate : film.item.releaseDate
    }
}
