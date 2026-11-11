import Foundation

/// Reads a file made by "Export Tracking Data" (`flow-tracking`) or by the website's Export Backup (`flow-web-backup`) and
/// folds its library into this device's. Settings in a website backup are left alone: the apps have their own, and
/// Share Setup carries those. Pure, so the parsing and the merge are tested.
public enum LibraryBackup {
    public enum Source: Sendable, Equatable {
        case tracking
        case web
    }

    /// What a file holds, for the confirm step to say.
    public struct Counts: Sendable, Equatable {
        public var history = 0
        public var watchlist = 0
        public var favourites = 0
        public var progress = 0
        public var rewatches = 0
        public var ratings = 0

        public var total: Int { history + watchlist + favourites + progress + rewatches + ratings }

        /// "120 watched, 8 on the watchlist, …", in the order the Data screen lists them. Empty parts are left out.
        public var summary: String {
            [(history, "watched"), (watchlist, "on the watchlist"), (favourites, "favourites"),
             (progress, "resume positions"), (rewatches, "rewatches"), (ratings, "ratings")]
                .filter { $0.0 > 0 }.map { "\($0.0) \($0.1)" }.joined(separator: ", ")
        }
    }

    public struct Parsed: Sendable {
        public var source: Source
        public var library: LocalLibrary
        public var exportedAt: Date?
        public var counts: Counts
    }

    public enum ParseError: Error, Equatable, LocalizedError {
        case notJSON, notABackup, newerVersion, empty

        /// Each says what to do next.
        public var errorDescription: String? {
            switch self {
            case .notJSON: return "That file isn't valid JSON. Choose a file exported from Flow."
            case .notABackup: return "That isn't a Flow backup. Choose a file from Export Tracking Data, or a website backup."
            case .newerVersion: return "That backup is from a newer version of Flow. Update Flow, then try again."
            case .empty: return "That backup has no watch history, lists or resume positions in it."
            }
        }
    }

    public static func parse(_ data: Data) throws -> Parsed {
        guard let object = try? JSONSerialization.jsonObject(with: data) else { throw ParseError.notJSON }
        guard let root = object as? [String: Any], let format = root["format"] as? String else { throw ParseError.notABackup }
        if let version = root["version"] as? Int, version > 1 { throw ParseError.newerVersion }
        var parsed: Parsed
        switch format {
        case "flow-tracking": parsed = try parseTracking(data)
        case "flow-web-backup": parsed = parseWeb(root)
        default: throw ParseError.notABackup
        }
        let library = parsed.library
        parsed.counts = Counts(history: library.history.count, watchlist: library.watchlist.count, favourites: library.favourites.count,
                               progress: library.progress.count, rewatches: library.rewatches.count, ratings: library.ratings.count)
        guard parsed.counts.total > 0 else { throw ParseError.empty }
        return parsed
    }

    /// This device's library with the backup's folded in: anything already here stays, and where both have the same
    /// title or episode the newer entry wins. What was taken off a list on this device and is in the backup comes back,
    /// since choosing the file is asking for it.
    public static func restore(_ backup: LocalLibrary, into current: LocalLibrary) -> LocalLibrary {
        var base = current
        func forget(_ list: String, _ ids: [String]) {
            for id in ids { base.removed[LocalLibrary.tombstone(list, id)] = nil }
        }
        forget("progress", backup.progress.map(\.id))
        forget("history", backup.history.map(\.id))
        forget("watchlist", backup.watchlist.map(\.id))
        forget("favourites", backup.favourites.map(\.id))
        forget("rewatches", backup.rewatches.map(\.id))
        forget("ratings", Array(backup.ratings.keys))
        return base.merged(with: backup)
    }

    // MARK: Flow's own export

    /// Each list reads entry by entry, so one entry from a newer build doesn't lose the rest.
    private struct Lossy<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }

    private struct TrackingFile: Decodable {
        var exportedAt: Date?
        var history: [Lossy<HistoryEntry>]?
        var watchlist: [Lossy<ListEntry>]?
        var favourites: [Lossy<ListEntry>]?
        var resumePositions: [Lossy<PlaybackProgress>]?
        var rewatches: [Lossy<Rewatch>]?
    }

    private static func parseTracking(_ data: Data) throws -> Parsed {
        guard let file = try? JSONDecoder.flow.decode(TrackingFile.self, from: data) else { throw ParseError.notABackup }
        var library = LocalLibrary()
        library.history = (file.history ?? []).compactMap(\.value)
        library.watchlist = (file.watchlist ?? []).compactMap(\.value)
        library.favourites = (file.favourites ?? []).compactMap(\.value)
        library.progress = (file.resumePositions ?? []).compactMap(\.value)
        library.rewatches = (file.rewatches ?? []).compactMap(\.value)
        return Parsed(source: .tracking, library: library, exportedAt: file.exportedAt, counts: Counts())
    }

    // MARK: The website's backup

    private static func parseWeb(_ root: [String: Any]) -> Parsed {
        let exportedAt = (root["exportedAt"] as? String).flatMap(FlowDate.parse)
        var library = LocalLibrary()
        guard let web = root["library"] as? [String: Any] else { return Parsed(source: .web, library: library, exportedAt: exportedAt, counts: Counts()) }

        func key(_ entry: [String: Any]) -> MediaKey? { (entry["key"] as? String).flatMap { MediaKey(string: $0) } }
        func date(_ value: Any?) -> Date? { (value as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } }
        func episode(_ value: Any?) -> EpisodeRef? {
            guard let e = value as? [String: Any], let season = e["season"] as? Int, let number = e["episode"] as? Int else { return nil }
            return EpisodeRef(season: season, episode: number)
        }
        func remember(_ entry: [String: Any], _ key: MediaKey) {
            if let item = item(entry["item"], key: key) { library.items[key.description] = item }
        }

        for case let entry as [String: Any] in (web["history"] as? [Any]) ?? [] {
            guard let key = key(entry), let at = date(entry["watchedAt"]) else { continue }
            library.history.append(HistoryEntry(key: key, episode: episode(entry["episode"]), watchedAt: at))
            remember(entry, key)
        }
        // Episodes ticked off without a play ("show:1396:s3e7") are watched too; the apps read watched state from history.
        var logged = Set(library.history.map { "\($0.key):\($0.episode?.code ?? "-")" })
        for (raw, value) in (web["watchedEpisodes"] as? [String: Any]) ?? [:] {
            let parts = raw.split(separator: ":")
            guard parts.count == 3, let key = MediaKey(string: "\(parts[0]):\(parts[1])"), let ref = episodeRef(String(parts[2])),
                  let at = date(value), logged.insert("\(key):\(ref.code)").inserted else { continue }
            library.history.append(HistoryEntry(key: key, episode: ref, watchedAt: at))
        }
        func listEntries(_ name: String) -> [ListEntry] {
            var out: [ListEntry] = []
            for case let entry as [String: Any] in (web[name] as? [Any]) ?? [] {
                guard let key = key(entry), let at = date(entry["addedAt"]) else { continue }
                out.append(ListEntry(key: key, addedAt: at))
                remember(entry, key)
            }
            return out
        }
        library.watchlist = listEntries("watchlist")
        library.favourites = listEntries("favourites")
        for case let entry as [String: Any] in ((web["progress"] as? [String: Any]) ?? [:]).values {
            guard let key = key(entry), let position = entry["position"] as? Double, let duration = entry["duration"] as? Double, duration > 0,
                  let at = date(entry["updatedAt"]) else { continue }
            library.progress.append(PlaybackProgress(key: key, episode: episode(entry["episode"]), percent: min(100, position / duration * 100),
                                                     positionSeconds: position, durationSeconds: duration, updatedAt: at))
            remember(entry, key)
        }
        for (raw, value) in (web["ratings"] as? [String: Any]) ?? [:] {
            guard MediaKey(string: raw) != nil, let score = value as? Int, (1...10).contains(score) else { continue }
            library.ratings[raw] = LocalLibrary.Rating(value: score, ratedAt: exportedAt ?? Date())
        }
        for (raw, value) in (web["rewatches"] as? [String: Any]) ?? [:] {
            guard let key = MediaKey(string: raw), let entry = value as? [String: Any], let started = date(entry["startedAt"]) else { continue }
            let watched = ((entry["watched"] as? [Any]) ?? []).compactMap { ($0 as? String).flatMap(episodeRef) }
            library.rewatches.append(Rewatch(key: key, startedAt: started, watched: Set(watched)))
        }
        // The website's key order is by recency, which the merge sorts out; dictionary order here would not be stable.
        library.progress.sort { $0.id < $1.id }
        library.rewatches.sort { $0.id < $1.id }
        return Parsed(source: .web, library: library, exportedAt: exportedAt, counts: Counts())
    }

    /// "s3e7" as season 3, episode 7.
    static func episodeRef(_ raw: String) -> EpisodeRef? {
        let lower = raw.lowercased()
        guard lower.hasPrefix("s"), let e = lower.firstIndex(of: "e"),
              let season = Int(lower[lower.index(after: lower.startIndex)..<e]), let number = Int(lower[lower.index(after: e)...]) else { return nil }
        return EpisodeRef(season: season, episode: number)
    }

    /// The little the website keeps about a title, as the display cache the apps' lists draw from while offline.
    private static func item(_ value: Any?, key: MediaKey) -> MediaItem? {
        guard let raw = value as? [String: Any], let title = raw["title"] as? String, !title.isEmpty else { return nil }
        func path(_ field: String) -> String? { (raw[field] as? String).flatMap { $0.hasPrefix("/") ? $0 : nil } }
        return MediaItem(type: key.type, ids: ExternalIDs(tmdb: key.tmdbID), title: title,
                         overview: (raw["overview"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                         posterPath: path("poster"), backdropPath: path("backdrop"),
                         releaseDate: (raw["date"] as? String).flatMap(FlowDate.parse),
                         voteAverage: raw["rating"] as? Double, originalLanguage: raw["originalLanguage"] as? String)
    }
}
