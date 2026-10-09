import Foundation

/// A title as it exists on one media server.
public struct MediaServerItem: Codable, Hashable, Sendable, Identifiable {
    public var serverID: String
    public var itemID: String
    public var type: MediaType
    public var title: String
    public var year: Int?
    public var ids: ExternalIDs
    public var posterURL: URL?
    public var backdropURL: URL?
    public var overview: String?
    public var addedAt: Date?
    public var isFavourite: Bool

    public init(serverID: String, itemID: String, type: MediaType, title: String, year: Int? = nil, ids: ExternalIDs = ExternalIDs(), posterURL: URL? = nil, backdropURL: URL? = nil, overview: String? = nil, addedAt: Date? = nil, isFavourite: Bool = false) {
        self.serverID = serverID
        self.itemID = itemID
        self.type = type
        self.title = title
        self.year = year
        self.ids = ids
        self.posterURL = posterURL
        self.backdropURL = backdropURL
        self.overview = overview
        self.addedAt = addedAt
        self.isFavourite = isFavourite
    }

    public var id: String { "\(serverID):\(itemID)" }

    /// A MediaItem good enough for posters; the detail page re-hydrates from TMDb.
    public var mediaItem: MediaItem {
        MediaItem(type: type, ids: ids, title: title, overview: overview, posterPath: posterURL?.absoluteString, backdropPath: backdropURL?.absoluteString,
                  releaseDate: year.flatMap { FlowDate.parse("\($0)-01-01") })
    }
}

public struct MediaLibrary: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var type: MediaType?
    public init(id: String, name: String, type: MediaType?) {
        self.id = id
        self.name = name
        self.type = type
    }
}

public struct PlaybackReport: Sendable {
    public enum State: String, Sendable { case started, progress, paused, stopped }
    public var state: State
    public var source: StreamSource
    public var positionSeconds: Double
    public var durationSeconds: Double?
    public var sessionID: String

    public init(state: State, source: StreamSource, positionSeconds: Double, durationSeconds: Double?, sessionID: String) {
        self.state = state
        self.source = source
        self.positionSeconds = positionSeconds
        self.durationSeconds = durationSeconds
        self.sessionID = sessionID
    }
}

public protocol MediaServerClient: SourceProvider {
    var config: MediaServerConfig { get }
    func libraries() async throws -> [MediaLibrary]
    /// Every movie and series on the server with provider ids — used for badges and filtering.
    func catalogue() async throws -> [MediaServerItem]
    func items(inLibrary id: String, limit: Int) async throws -> [MediaServerItem]
    func recentlyAdded(limit: Int) async throws -> [MediaServerItem]
    func search(_ text: String) async throws -> [MediaServerItem]
    func report(_ report: PlaybackReport) async
    func setFavourite(itemID: String, _ favourite: Bool) async throws
    func favourites() async throws -> [MediaServerItem]
}

extension MediaServerClient {
    public var providerID: String { config.id }
    public var providerName: String { config.name }
    public var category: SourceCategory { .mediaServers }
}

/// Maps TMDb keys to server items across every enabled server.
public actor MediaServerIndex {
    private var byKey: [MediaKey: [MediaServerItem]] = [:]
    private var byIMDb: [String: [MediaServerItem]] = [:]
    private var byTitle: [String: [MediaServerItem]] = [:]
    public private(set) var lastRefresh: Date?

    public init() {}

    public func replace(with items: [MediaServerItem]) {
        byKey = [:]
        byIMDb = [:]
        byTitle = [:]
        for item in items { insert(item) }
        lastRefresh = Date()
    }

    private func insert(_ item: MediaServerItem) {
        if let tmdb = item.ids.tmdb { byKey[MediaKey(type: item.type, tmdbID: tmdb), default: []].append(item) }
        if let imdb = item.ids.imdb { byIMDb[imdb, default: []].append(item) }
        byTitle[Self.titleKey(item.title, item.year, item.type), default: []].append(item)
    }

    static func titleKey(_ title: String, _ year: Int?, _ type: MediaType) -> String {
        "\(type.rawValue)|\(StreamParser.normalizeTitle(title))|\(year.map(String.init) ?? "")"
    }

    public func matches(for item: MediaItem) -> [MediaServerItem] {
        if let key = item.key, let found = byKey[key], !found.isEmpty { return found }
        if let imdb = item.ids.imdb, let found = byIMDb[imdb], !found.isEmpty { return found }
        return byTitle[Self.titleKey(item.title, item.year, item.type)] ?? []
    }

    public func contains(_ item: MediaItem) -> Bool { !matches(for: item).isEmpty }

    public var keys: Set<MediaKey> { Set(byKey.keys) }
    public var count: Int { byKey.count }
}

/// Item matching used by every server client when the index has no answer yet.
enum ServerMatching {
    static func best(_ candidates: [MediaServerItem], for item: MediaItem) -> MediaServerItem? {
        if let tmdb = item.ids.tmdb, let m = candidates.first(where: { $0.ids.tmdb == tmdb && $0.type == item.type }) { return m }
        if let imdb = item.ids.imdb, let m = candidates.first(where: { $0.ids.imdb == imdb }) { return m }
        let title = StreamParser.normalizeTitle(item.title)
        return candidates.first { c in
            c.type == item.type && StreamParser.normalizeTitle(c.title) == title && (item.year == nil || c.year == nil || abs((c.year ?? 0) - (item.year ?? 0)) <= 1)
        }
    }
}
