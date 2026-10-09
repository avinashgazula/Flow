import Foundation

public enum ScrobbleAction: String, Sendable { case start, pause, stop }

/// A watch-tracking backend. Exactly one is active at a time (Settings → Account → Tracking With).
public protocol TrackingService: Sendable {
    var kind: TrackerKind { get }

    func profile() async throws -> UserProfile?
    /// Resume points, newest first.
    func playbackProgress() async throws -> [PlaybackProgress]
    func removePlaybackProgress(_ progress: PlaybackProgress) async throws
    /// Recent history, newest first.
    func history(limit: Int) async throws -> [HistoryEntry]
    func watchedMovies() async throws -> Set<Int>
    func watchedShows() async throws -> [ShowWatchState]
    /// Marks a movie, a whole show (`episodes == nil`) or specific episodes watched.
    func markWatched(_ item: MediaItem, episodes: [EpisodeRef]?, at date: Date) async throws
    func markUnwatched(_ item: MediaItem, episodes: [EpisodeRef]?) async throws
    func scrobble(_ action: ScrobbleAction, request: PlaybackRequest, percent: Double) async throws
}

/// A backend that can hold a watchlist or favourites.
public protocol ListService: Sendable {
    var destination: ListDestination { get }
    func watchlist() async throws -> [ListEntry]
    func setWatchlisted(_ item: MediaItem, _ listed: Bool) async throws
    func favourites() async throws -> [ListEntry]
    func setFavourite(_ item: MediaItem, _ favourite: Bool) async throws
}

extension ListService {
    public func favourites() async throws -> [ListEntry] {
        throw FlowError.unsupported("\(destination.displayName) does not support favourites.")
    }

    public func setFavourite(_ item: MediaItem, _ favourite: Bool) async throws {
        throw FlowError.unsupported("\(destination.displayName) does not support favourites.")
    }
}

/// Builds the Continue Watching row from resume points and Next Up computation.
public enum ContinueWatchingBuilder {
    public struct Entry: Hashable, Sendable, Identifiable {
        public var key: MediaKey
        public var episode: EpisodeRef?
        public var progress: PlaybackProgress?
        public var updatedAt: Date
        public var isNextUp: Bool

        public var id: String { "\(key):\(episode?.code ?? "")" }
    }

    /// Merges in-progress items with next-up episodes. A show appears once: its resume
    /// point wins over a next-up suggestion. Items past `finishedPercent` are dropped.
    public static func build(progress: [PlaybackProgress], nextUp: [(MediaKey, EpisodeRef, Date)], finishedPercent: Double = 90, minimumPercent: Double = 1) -> [Entry] {
        var byShow: [MediaKey: Entry] = [:]
        for p in progress where p.percent >= minimumPercent && p.percent < finishedPercent {
            let entry = Entry(key: p.key, episode: p.episode, progress: p, updatedAt: p.updatedAt, isNextUp: false)
            if let existing = byShow[p.key], existing.updatedAt >= entry.updatedAt { continue }
            byShow[p.key] = entry
        }
        for (key, episode, date) in nextUp where byShow[key] == nil {
            byShow[key] = Entry(key: key, episode: episode, progress: nil, updatedAt: date, isNextUp: true)
        }
        return byShow.values.sorted { $0.updatedAt > $1.updatedAt }
    }
}
