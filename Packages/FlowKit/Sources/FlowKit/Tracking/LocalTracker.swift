import Foundation

/// Everything "This Device" tracks. Synced with iCloud by `CloudSync`.
public struct LocalLibrary: Codable, Hashable, Sendable {
    public var progress: [PlaybackProgress] = []
    public var history: [HistoryEntry] = []
    public var watchlist: [ListEntry] = []
    public var favourites: [ListEntry] = []
    public var rewatches: [Rewatch] = []
    public var shuffle: [ShuffleRecord] = []
    /// Cached display data so lists render offline.
    public var items: [String: MediaItem] = [:]

    public init() {}

    public mutating func remember(_ item: MediaItem) {
        guard let key = item.key else { return }
        items[key.description] = item
    }

    /// Union merge used when pulling from iCloud: newest timestamp wins per entry.
    public func merged(with other: LocalLibrary) -> LocalLibrary {
        var out = LocalLibrary()
        out.progress = Self.mergeNewest(progress + other.progress, id: \.id, date: \.updatedAt)
        out.history = Self.mergeNewest(history + other.history, id: \.id, date: \.watchedAt)
        out.watchlist = Self.mergeNewest(watchlist + other.watchlist, id: \.id, date: \.addedAt)
        out.favourites = Self.mergeNewest(favourites + other.favourites, id: \.id, date: \.addedAt)
        out.rewatches = Self.mergeNewest(rewatches + other.rewatches, id: \.id, date: \.startedAt)
        var shuffleByKey: [MediaKey: ShuffleRecord] = [:]
        for record in shuffle + other.shuffle {
            var existing = shuffleByKey[record.key] ?? ShuffleRecord(key: record.key)
            for ep in record.played where !existing.played.contains(ep) { existing.played.append(ep) }
            shuffleByKey[record.key] = existing
        }
        out.shuffle = Array(shuffleByKey.values)
        out.items = items.merging(other.items) { a, _ in a }
        return out
    }

    static func mergeNewest<T>(_ values: [T], id: KeyPath<T, String>, date: KeyPath<T, Date>) -> [T] {
        var best: [String: T] = [:]
        for v in values {
            if let existing = best[v[keyPath: id]], existing[keyPath: date] >= v[keyPath: date] { continue }
            best[v[keyPath: id]] = v
        }
        return best.values.sorted { $0[keyPath: date] > $1[keyPath: date] }
    }
}

/// On-device tracker. Mutations are persisted through `save` immediately.
public actor LocalTracker: TrackingService, ListService {
    public nonisolated let kind: TrackerKind = .local
    public nonisolated let destination: ListDestination = .local

    public private(set) var library: LocalLibrary
    private let save: @Sendable (LocalLibrary) -> Void

    public init(library: LocalLibrary, save: @escaping @Sendable (LocalLibrary) -> Void) {
        self.library = library
        self.save = save
    }

    private func mutate(_ change: (inout LocalLibrary) -> Void) {
        change(&library)
        save(library)
    }

    public func replace(_ library: LocalLibrary) {
        self.library = library
        save(library)
    }

    // MARK: Progress (also used to keep resume points for every tracker that lacks them)

    public func recordProgress(_ progress: PlaybackProgress, item: MediaItem) {
        mutate { lib in
            lib.remember(item)
            lib.progress.removeAll { $0.key == progress.key }
            lib.progress.insert(progress, at: 0)
            if lib.progress.count > 300 { lib.progress.removeLast(lib.progress.count - 300) }
        }
    }

    public func profile() async throws -> UserProfile? { UserProfile(username: "This Device") }
    public func playbackProgress() async throws -> [PlaybackProgress] { library.progress }

    public func removePlaybackProgress(_ progress: PlaybackProgress) async throws {
        mutate { $0.progress.removeAll { $0.id == progress.id } }
    }

    public func history(limit: Int) async throws -> [HistoryEntry] { Array(library.history.prefix(limit)) }

    public func watchedMovies() async throws -> Set<Int> {
        Set(library.history.filter { $0.key.type == .movie }.map(\.key.tmdbID))
    }

    public func watchedShows() async throws -> [ShowWatchState] {
        let grouped = Dictionary(grouping: library.history.filter { $0.key.type == .show && $0.episode != nil }, by: \.key)
        return grouped.map { key, entries in
            ShowWatchState(key: key, watched: Set(entries.compactMap(\.episode)), lastWatchedAt: entries.map(\.watchedAt).max())
        }
    }

    /// Marking a whole show requires the episode list, so the caller passes episodes explicitly;
    /// `nil` for a show records nothing beyond remembering the item.
    public func markWatched(_ item: MediaItem, episodes: [EpisodeRef]?, at date: Date) async throws {
        guard let key = item.key else { return }
        mutate { lib in
            lib.remember(item)
            if item.type == .movie {
                lib.history.insert(HistoryEntry(key: key, watchedAt: date), at: 0)
                lib.progress.removeAll { $0.key == key }
            } else {
                for ep in episodes ?? [] {
                    lib.history.removeAll { $0.key == key && $0.episode == ep }
                    lib.history.insert(HistoryEntry(key: key, episode: ep, watchedAt: date), at: 0)
                }
                lib.progress.removeAll { p in p.key == key && (episodes ?? []).contains { $0 == p.episode } }
            }
            lib.history.sort { $0.watchedAt > $1.watchedAt }
        }
    }

    public func markUnwatched(_ item: MediaItem, episodes: [EpisodeRef]?) async throws {
        guard let key = item.key else { return }
        mutate { lib in
            if let episodes {
                lib.history.removeAll { $0.key == key && $0.episode.map(episodes.contains) == true }
            } else {
                lib.history.removeAll { $0.key == key }
            }
        }
    }

    public func scrobble(_ action: ScrobbleAction, request: PlaybackRequest, percent: Double) async throws {
        guard let key = request.item.key else { return }
        if action == .stop, percent >= 90 {
            try await markWatched(request.item, episodes: request.episodeRef.map { [$0] }, at: Date())
            if let ep = request.episodeRef { advanceRewatch(key, episode: ep) }
        } else {
            recordProgress(PlaybackProgress(key: key, episode: request.episodeRef, percent: percent), item: request.item)
        }
    }

    // MARK: Lists

    public func watchlist() async throws -> [ListEntry] { library.watchlist }

    public func setWatchlisted(_ item: MediaItem, _ listed: Bool) async throws {
        guard let key = item.key else { return }
        mutate { lib in
            lib.watchlist.removeAll { $0.key == key }
            if listed { lib.remember(item); lib.watchlist.insert(ListEntry(key: key), at: 0) }
        }
    }

    public func favourites() async throws -> [ListEntry] { library.favourites }

    public func setFavourite(_ item: MediaItem, _ favourite: Bool) async throws {
        guard let key = item.key else { return }
        mutate { lib in
            lib.favourites.removeAll { $0.key == key }
            if favourite { lib.remember(item); lib.favourites.insert(ListEntry(key: key), at: 0) }
        }
    }

    // MARK: Rewatches

    public func startRewatch(_ key: MediaKey) {
        mutate { lib in
            lib.rewatches.removeAll { $0.key == key }
            lib.rewatches.append(Rewatch(key: key))
        }
    }

    public func endRewatch(_ key: MediaKey) {
        mutate { $0.rewatches.removeAll { $0.key == key } }
    }

    public func advanceRewatch(_ key: MediaKey, episode: EpisodeRef) {
        mutate { lib in
            guard let i = lib.rewatches.firstIndex(where: { $0.key == key }) else { return }
            lib.rewatches[i].watched.insert(episode)
        }
    }

    public func rewatch(for key: MediaKey) -> Rewatch? { library.rewatches.first { $0.key == key } }

    public func clearRewatches() { mutate { $0.rewatches = [] } }

    // MARK: Shuffle

    /// Picks a random episode not yet played in this shuffle cycle; resets once all are played.
    public func nextShuffle(for key: MediaKey, from episodes: [EpisodeRef]) -> EpisodeRef? {
        let pool = episodes.filter { $0.season > 0 }
        guard !pool.isEmpty else { return nil }
        var record = library.shuffle.first { $0.key == key } ?? ShuffleRecord(key: key)
        var remaining = pool.filter { !record.played.contains($0) }
        if remaining.isEmpty { record.played = []; remaining = pool }
        guard let pick = remaining.randomElement() else { return nil }
        record.played.append(pick)
        let updated = record
        mutate { lib in
            lib.shuffle.removeAll { $0.key == key }
            lib.shuffle.append(updated)
        }
        return pick
    }

    public func clearShuffleHistory() { mutate { $0.shuffle = [] } }
}
