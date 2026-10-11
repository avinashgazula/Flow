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
    /// When something was taken off a list, by `Self.tombstone`, so a merge with a copy that still
    /// has it (iCloud, another device) doesn't bring it back. Anything added again later wins.
    public var removed: [String: Date] = [:]
    /// The viewer's own scores, 1–10, by media key.
    public var ratings: [String: Rating] = [:]

    public struct Rating: Codable, Hashable, Sendable {
        public var value: Int
        public var ratedAt: Date
        public init(value: Int, ratedAt: Date = Date()) { self.value = value; self.ratedAt = ratedAt }
    }

    public init() {}

    /// How long a removal is remembered: past that, a device that has been offline all along can bring the entry back.
    static let tombstoneLifetime: TimeInterval = 180 * 86_400
    static let tombstoneLimit = 2000

    static func tombstone(_ list: String, _ id: String) -> String { "\(list):\(id)" }

    /// Records the removal of everything `old` had and this copy doesn't.
    mutating func recordRemovals(since old: LocalLibrary, at date: Date = Date()) {
        func diff<T>(_ list: String, _ before: [T], _ after: [T], _ id: KeyPath<T, String>) {
            let kept = Set(after.map { $0[keyPath: id] })
            for entry in before where !kept.contains(entry[keyPath: id]) { removed[Self.tombstone(list, entry[keyPath: id])] = date }
        }
        diff("progress", old.progress, progress, \.id)
        diff("history", old.history, history, \.id)
        diff("watchlist", old.watchlist, watchlist, \.id)
        diff("favourites", old.favourites, favourites, \.id)
        diff("rewatches", old.rewatches, rewatches, \.id)
        for key in old.ratings.keys where ratings[key] == nil { removed[Self.tombstone("ratings", key)] = date }
        pruneRemovals(now: date)
    }

    private mutating func pruneRemovals(now: Date) {
        removed = removed.filter { now.timeIntervalSince($0.value) < Self.tombstoneLifetime }
        if removed.count > Self.tombstoneLimit {
            let keep = removed.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.prefix(Self.tombstoneLimit)
            removed = Dictionary(uniqueKeysWithValues: keep.map { ($0.key, $0.value) })
        }
    }

    /// Whether `id` on `list` was removed at or after `date`, the time the entry was made.
    private static func wasRemoved(_ removed: [String: Date], _ list: String, _ id: String, after date: Date) -> Bool {
        guard let at = removed[tombstone(list, id)] else { return false }
        return at >= date
    }

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
        // Dictionary order is random; a stable order lets two devices see that they already agree.
        out.shuffle = shuffleByKey.values.sorted { $0.key.description < $1.key.description }
        out.items = items.merging(other.items) { a, _ in a }
        let gone = removed.merging(other.removed) { max($0, $1) }
        out.removed = gone
        // The newer score wins; a removed one stays removed until rated again.
        out.ratings = ratings.merging(other.ratings) { $0.ratedAt >= $1.ratedAt ? $0 : $1 }
            .filter { key, rating in !Self.wasRemoved(gone, "ratings", key, after: rating.ratedAt) }
        out.progress.removeAll { Self.wasRemoved(gone, "progress", $0.id, after: $0.updatedAt) }
        out.history.removeAll { Self.wasRemoved(gone, "history", $0.id, after: $0.watchedAt) }
        out.watchlist.removeAll { Self.wasRemoved(gone, "watchlist", $0.id, after: $0.addedAt) }
        out.favourites.removeAll { Self.wasRemoved(gone, "favourites", $0.id, after: $0.addedAt) }
        out.rewatches.removeAll { Self.wasRemoved(gone, "rewatches", $0.id, after: $0.startedAt) }
        return out
    }

    static func mergeNewest<T>(_ values: [T], id: KeyPath<T, String>, date: KeyPath<T, Date>) -> [T] {
        var best: [String: T] = [:]
        for v in values {
            if let existing = best[v[keyPath: id]], existing[keyPath: date] >= v[keyPath: date] { continue }
            best[v[keyPath: id]] = v
        }
        // Ties (a whole season marked watched at once) break by id so the order is the same every time.
        return best.values.sorted {
            let (a, b) = ($0[keyPath: date], $1[keyPath: date])
            return a != b ? a > b : $0[keyPath: id] < $1[keyPath: id]
        }
    }
}

extension LocalLibrary {
    /// Every field optional on the way in, so a library saved by an older version (without `removed`,
    /// or anything added later) still loads instead of starting empty.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init()
        progress = try c.decodeIfPresent([PlaybackProgress].self, forKey: .progress) ?? []
        history = try c.decodeIfPresent([HistoryEntry].self, forKey: .history) ?? []
        watchlist = try c.decodeIfPresent([ListEntry].self, forKey: .watchlist) ?? []
        favourites = try c.decodeIfPresent([ListEntry].self, forKey: .favourites) ?? []
        rewatches = try c.decodeIfPresent([Rewatch].self, forKey: .rewatches) ?? []
        shuffle = try c.decodeIfPresent([ShuffleRecord].self, forKey: .shuffle) ?? []
        items = try c.decodeIfPresent([String: MediaItem].self, forKey: .items) ?? [:]
        removed = try c.decodeIfPresent([String: Date].self, forKey: .removed) ?? [:]
        ratings = try c.decodeIfPresent([String: Rating].self, forKey: .ratings) ?? [:]
    }
}

/// What "Export Tracking Data" writes: the on-device library without display caches or shuffle bookkeeping.
public struct TrackingExport: Codable, Sendable {
    public var format = "flow-tracking"
    public var version = 1
    public var exportedAt: Date
    public var history: [HistoryEntry]
    public var watchlist: [ListEntry]
    public var favourites: [ListEntry]
    public var resumePositions: [PlaybackProgress]
    public var rewatches: [Rewatch]

    public init(library: LocalLibrary, exportedAt: Date = Date()) {
        self.exportedAt = exportedAt
        history = library.history
        watchlist = library.watchlist
        favourites = library.favourites
        resumePositions = library.progress
        rewatches = library.rewatches
    }

    public func json() throws -> Data { try SettingsCodec.encode(self, pretty: true) }
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
        let before = library
        change(&library)
        library.recordRemovals(since: before)
        save(library)
    }

    public func replace(_ library: LocalLibrary) {
        self.library = library
        save(library)
    }

    /// Folds in another copy (iCloud) on top of what is here right now, so a change made while the
    /// pull was being worked out isn't overwritten by a merge of an older snapshot. Saves only if it changed anything.
    public func merge(_ other: LocalLibrary) {
        let merged = library.merged(with: other)
        guard merged != library else { return }
        library = merged
        save(merged)
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

    // MARK: Ratings

    public func rating(for key: MediaKey) -> Int? { library.ratings[key.description]?.value }

    public func setRating(_ value: Int?, for item: MediaItem) {
        guard let key = item.key else { return }
        mutate { lib in
            if let value {
                lib.remember(item)
                lib.ratings[key.description] = LocalLibrary.Rating(value: min(10, max(1, value)))
            } else {
                lib.ratings[key.description] = nil
            }
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

    // MARK: Reset

    public func clearProgress() { mutate { $0.progress = [] } }
}
