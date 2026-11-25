import Foundation

/// Where a film is in its release, for the source picker: a title still in cinemas has no sources because nothing
/// is out at home yet, not because something is broken. Pure; the app passes in the release dates it looked up.
public enum HomeRelease {
    public enum Status: Equatable, Sendable {
        /// A digital, physical or TV release has passed somewhere, so copies exist.
        case available
        /// Out in cinemas, with no home release yet. `digitalOn` is the next home date TMDb knows of.
        case inCinemas(since: Date, digitalOn: Date?)
        /// Not out anywhere yet. `on` is the first cinema date TMDb lists, if any.
        case upcoming(on: Date?)
        /// No release data at all: callers keep their ordinary wording.
        case unknown
    }

    /// TMDb dates are bare days read as midnight UTC, so "on or before now" holds from the start of the day, as
    /// `ReleaseFilter` decides. A home release in any country counts as available, since a copy made anywhere plays
    /// anywhere; the viewer's `region` only picks which cinema and digital dates are named.
    public static func status(releases: [MovieRelease], region: String?, now: Date) -> Status {
        guard !releases.isEmpty else { return .unknown }
        if releases.contains(where: { $0.type.isHome && $0.date <= now }) { return .available }

        func earliest(_ list: [MovieRelease]) -> Date? {
            if let region {
                let local = list.filter { $0.country == region }
                if let date = local.map(\.date).min() { return date }
            }
            return list.map(\.date).min()
        }
        let cinema = releases.filter { $0.type == .premiere || $0.type == .theatrical || $0.type == .theatricalLimited }
        if let since = earliest(cinema.filter { $0.date <= now }) {
            let ahead = releases.filter { $0.date > now }
            let digitalOn = earliest(ahead.filter { $0.type == .digital }) ?? earliest(ahead.filter { $0.type == .physical })
            return .inCinemas(since: since, digitalOn: digitalOn)
        }
        return .upcoming(on: earliest(cinema))
    }
}
