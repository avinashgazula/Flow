import Foundation

/// Key-value storage abstraction over NSUbiquitousKeyValueStore (1 MB total quota).
public protocol KeyValueStore: AnyObject, Sendable {
    func data(forKey key: String) -> Data?
    func set(_ data: Data?, forKey key: String)
    @discardableResult func synchronize() -> Bool
    var allKeys: [String] { get }
}

public final class InMemoryKeyValueStore: KeyValueStore, @unchecked Sendable {
    private var storage: [String: Data] = [:]
    private let lock = NSLock()
    public init() {}
    public func data(forKey key: String) -> Data? { lock.lock(); defer { lock.unlock() }; return storage[key] }
    public func set(_ data: Data?, forKey key: String) { lock.lock(); storage[key] = data; lock.unlock() }
    public func synchronize() -> Bool { true }
    public var allKeys: [String] { lock.lock(); defer { lock.unlock() }; return Array(storage.keys) }
}

#if os(iOS) || os(macOS) || os(tvOS) || os(visionOS)
public final class UbiquitousKeyValueStore: KeyValueStore, @unchecked Sendable {
    let store = NSUbiquitousKeyValueStore.default
    public init() {}
    public func data(forKey key: String) -> Data? { store.data(forKey: key) }
    public func set(_ data: Data?, forKey key: String) {
        if let data { store.set(data, forKey: key) } else { store.removeObject(forKey: key) }
    }
    public func synchronize() -> Bool { store.synchronize() }
    public var allKeys: [String] { Array(store.dictionaryRepresentation.keys) }
    public static let didChangeExternally = NSUbiquitousKeyValueStore.didChangeExternallyNotification
}
#endif

public enum CloudDomain: String, CaseIterable, Sendable, Identifiable {
    case playbackProgress, rewatches, shelves, mediaServers, shuffleHistory, settings, library

    public var id: String { rawValue }
    var key: String { "flow.\(rawValue)" }

    public var title: String {
        switch self {
        case .playbackProgress: return "Playback Progress"
        case .rewatches: return "Rewatches"
        case .shelves: return "Shelves"
        case .mediaServers: return "Media Servers"
        case .shuffleHistory: return "Shuffle History"
        case .settings: return "Settings"
        case .library: return "Watchlist, History & Favourites"
        }
    }

    /// Domains listed in Data & Storage.
    public static let visible: [CloudDomain] = [.playbackProgress, .rewatches, .shelves, .mediaServers, .shuffleHistory]
}

public struct CloudDomainStatus: Hashable, Sendable, Identifiable {
    public var domain: CloudDomain
    public var localCount: Int
    public var cloudCount: Int?
    public var id: String { domain.id }
}

/// Everything that came down from iCloud on a pull.
public struct CloudSnapshot: Sendable {
    public var settings: AppSettings?
    public var shelves: [ShelfConfig]?
    public var mediaServers: [MediaServerConfig]?
    public var progress: [PlaybackProgress]?
    public var rewatches: [Rewatch]?
    public var shuffle: [ShuffleRecord]?
    public var library: LocalLibrary?
}

public struct CloudSync: Sendable {
    public static let quotaBytes = 1_048_576
    let store: KeyValueStore

    public init(store: KeyValueStore) { self.store = store }

    struct Envelope<T: Codable>: Codable {
        var updatedAt: Date
        var payload: T
    }

    private func write<T: Codable>(_ value: T, _ domain: CloudDomain) throws {
        let data = try SettingsCodec.encode(Envelope(updatedAt: Date(), payload: value))
        store.set(data, forKey: domain.key)
    }

    private func read<T: Codable>(_ type: T.Type, _ domain: CloudDomain) -> T? {
        guard let data = store.data(forKey: domain.key) else { return nil }
        return try? JSONDecoder.flow.decode(Envelope<T>.self, from: data).payload
    }

    /// Settings without the domains stored separately or device-local state.
    static func portableSettings(_ settings: AppSettings) -> AppSettings {
        var s = settings
        s.shelves = []
        s.mediaServers.servers = []
        s.sync = SyncSettings()
        return s
    }

    /// Pushes local state. The full library (watchlist/history/favourites) only goes up on an explicit push.
    public func push(settings: AppSettings, library: LocalLibrary, includeLibrary: Bool) throws {
        try write(Self.portableSettings(settings), .settings)
        try write(settings.shelves, .shelves)
        try write(settings.mediaServers.servers, .mediaServers)
        try write(Array(library.progress.prefix(150)), .playbackProgress)
        try write(library.rewatches, .rewatches)
        try write(library.shuffle, .shuffleHistory)
        if includeLibrary {
            var trimmed = LocalLibrary()
            trimmed.watchlist = library.watchlist
            trimmed.favourites = library.favourites
            trimmed.history = Array(library.history.prefix(1500))
            try write(trimmed, .library)
        }
        store.synchronize()
    }

    /// Pushes only the lightweight domains that change during normal use.
    public func pushIncremental(progress: [PlaybackProgress], rewatches: [Rewatch], shuffle: [ShuffleRecord]) throws {
        try write(Array(progress.prefix(150)), .playbackProgress)
        try write(rewatches, .rewatches)
        try write(shuffle, .shuffleHistory)
        store.synchronize()
    }

    public func pull() -> CloudSnapshot {
        store.synchronize()
        let settingsData = store.data(forKey: CloudDomain.settings.key)
        var settings: AppSettings?
        if let settingsData, let object = try? JSONSerialization.jsonObject(with: settingsData) as? [String: Any], let payload = object["payload"],
           let payloadData = try? JSONSerialization.data(withJSONObject: payload) {
            settings = try? SettingsCodec.decode(AppSettings.self, from: payloadData, defaults: AppSettings())
        }
        return CloudSnapshot(
            settings: settings,
            shelves: read([ShelfConfig].self, .shelves),
            mediaServers: read([MediaServerConfig].self, .mediaServers),
            progress: read([PlaybackProgress].self, .playbackProgress),
            rewatches: read([Rewatch].self, .rewatches),
            shuffle: read([ShuffleRecord].self, .shuffleHistory),
            library: read(LocalLibrary.self, .library)
        )
    }

    /// Merges a pull into local state: settings/shelves/servers take the cloud copy,
    /// progress, rewatches, shuffle and the library are unioned (newest wins).
    public static func apply(_ snapshot: CloudSnapshot, settings: AppSettings, library: LocalLibrary) -> (AppSettings, LocalLibrary) {
        var s = settings
        if let cloud = snapshot.settings {
            let keepShelves = s.shelves, keepServers = s.mediaServers.servers, keepSync = s.sync
            s = cloud
            s.shelves = keepShelves
            s.mediaServers.servers = keepServers
            s.sync = keepSync
        }
        if let shelves = snapshot.shelves, !shelves.isEmpty { s.shelves = shelves }
        if let servers = snapshot.mediaServers {
            let local = Dictionary(s.mediaServers.servers.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            var merged = servers
            for server in s.mediaServers.servers where !servers.contains(where: { $0.id == server.id }) { merged.append(server) }
            s.mediaServers.servers = merged.map { local[$0.id]?.accessToken != nil && $0.accessToken == nil ? local[$0.id]! : $0 }
        }
        var cloudLibrary = snapshot.library ?? LocalLibrary()
        cloudLibrary.progress = snapshot.progress ?? []
        cloudLibrary.rewatches = snapshot.rewatches ?? []
        cloudLibrary.shuffle = snapshot.shuffle ?? []
        return (s, library.merged(with: cloudLibrary))
    }

    public func status(settings: AppSettings, library: LocalLibrary) -> [CloudDomainStatus] {
        let snapshot = pull()
        return CloudDomain.visible.map { domain in
            switch domain {
            case .playbackProgress: return CloudDomainStatus(domain: domain, localCount: library.progress.count, cloudCount: snapshot.progress?.count)
            case .rewatches: return CloudDomainStatus(domain: domain, localCount: library.rewatches.count, cloudCount: snapshot.rewatches?.count)
            case .shelves: return CloudDomainStatus(domain: domain, localCount: settings.shelves.filter(\.enabled).count, cloudCount: snapshot.shelves?.filter(\.enabled).count)
            case .mediaServers: return CloudDomainStatus(domain: domain, localCount: settings.mediaServers.servers.count, cloudCount: snapshot.mediaServers?.count)
            case .shuffleHistory: return CloudDomainStatus(domain: domain, localCount: library.shuffle.count, cloudCount: snapshot.shuffle?.count)
            case .settings, .library: return CloudDomainStatus(domain: domain, localCount: 0, cloudCount: nil)
            }
        }
    }

    public var usedBytes: Int {
        CloudDomain.allCases.reduce(0) { $0 + (store.data(forKey: $1.key)?.count ?? 0) + $1.key.utf8.count }
    }

    public func clear() {
        for domain in CloudDomain.allCases { store.set(nil, forKey: domain.key) }
        store.synchronize()
    }
}
