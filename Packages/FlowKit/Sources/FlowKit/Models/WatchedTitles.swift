import Foundation

/// Every title the viewer has watched, drawn from everything the app knows rather than from the
/// tracker's play log alone: that log is capped (Trakt returns the latest hundred) and can be empty
/// or fail on its own while the watched sets and resume points are fine.
public enum WatchedTitles {
    /// Most recent first: titles in the play log in log order, then shows by when they were last watched,
    /// then films, whose watched state carries no date, newest TMDb id first so the order is stable.
    public static func keys(history: [HistoryEntry], movies: Set<Int>, shows: [MediaKey: ShowWatchState]) -> [MediaKey] {
        var seen = Set<MediaKey>()
        var out: [MediaKey] = []
        func add(_ key: MediaKey) { if seen.insert(key).inserted { out.append(key) } }

        for entry in history { add(entry.key) }
        let watchedShows = shows.values.filter { !$0.watched.isEmpty }
            .sorted { ($0.lastWatchedAt ?? .distantPast, $0.key.tmdbID) > ($1.lastWatchedAt ?? .distantPast, $1.key.tmdbID) }
        for state in watchedShows { add(state.key) }
        for id in movies.sorted(by: >) { add(MediaKey(type: .movie, tmdbID: id)) }
        return out
    }
}
