import Foundation

/// Tracker for services that authenticate with a plain API key and expose a
/// Trakt-shaped sync API (`/sync/watched`, `/sync/playback`, `/watchlist/items`, `/scrobble/*`).
/// MDBList and PublicMetaDB both work this way; they differ only in base URL and how the key is sent.
public struct KeyedSyncClient: TrackingService, ListService {
    public enum KeyPlacement: Sendable { case query(String), bearer }

    public let kind: TrackerKind
    public let destination: ListDestination
    let baseURL: String
    let apiKey: String
    let placement: KeyPlacement
    let http: HTTPClient

    public init(kind: TrackerKind, destination: ListDestination, baseURL: String, apiKey: String, placement: KeyPlacement, http: HTTPClient = HTTPClient()) {
        self.kind = kind
        self.destination = destination
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.apiKey = apiKey
        self.placement = placement
        self.http = http
    }

    public static func mdblist(apiKey: String, http: HTTPClient = HTTPClient()) -> KeyedSyncClient {
        KeyedSyncClient(kind: .mdblist, destination: .mdblist, baseURL: "https://api.mdblist.com", apiKey: apiKey, placement: .query("apikey"), http: http)
    }

    public static func publicMetaDB(baseURL: String, apiKey: String, http: HTTPClient = HTTPClient()) -> KeyedSyncClient {
        KeyedSyncClient(kind: .publicMetaDB, destination: .publicMetaDB, baseURL: baseURL, apiKey: apiKey, placement: .bearer, http: http)
    }

    func request(_ method: HTTPMethod, _ path: String, query: [String: String?] = [:]) throws -> HTTPRequest {
        guard !apiKey.isEmpty else { throw FlowError.missingCredential("\(kind.displayName) API key") }
        var q = query
        var headers = ["Content-Type": "application/json"]
        switch placement {
        case .query(let name): q[name] = apiKey
        case .bearer: headers["Authorization"] = "Bearer \(apiKey)"
        }
        return try HTTPRequest(method, baseURL + path, query: q, headers: headers)
    }

    func get(_ path: String, query: [String: String?] = [:]) async throws -> JSONValue {
        try await http.json(JSONValue.self, request(.get, path, query: query))
    }

    func post(_ path: String, _ body: JSONValue) async throws {
        var r = try request(.post, path)
        try r.setJSONBody(body)
        try await http.send(r)
    }

    // MARK: Parsing

    /// Finds a TMDb id in the many shapes these APIs use: {ids:{tmdb}}, {tmdb}, {id, mediatype}.
    static func tmdb(_ value: JSONValue?) -> Int? {
        guard let value else { return nil }
        return value["ids"]?["tmdb"]?.int ?? value["tmdb"]?.int ?? value["tmdb_id"]?.int ?? value["id"]?.int
    }

    static func entries(_ json: JSONValue, dateKeys: [String]) -> [ListEntry] {
        func parse(_ array: [JSONValue]?, type: MediaType, nested: String) -> [ListEntry] {
            (array ?? []).compactMap { e in
                guard let id = tmdb(e[nested]) ?? tmdb(e) else { return nil }
                let date = dateKeys.lazy.compactMap { e[$0]?.string.flatMap(FlowDate.parse) }.first ?? .distantPast
                return ListEntry(key: MediaKey(type: type, tmdbID: id), addedAt: date)
            }
        }
        if let array = json.array {
            return array.compactMap { e in
                let isShow = ["show", "tv", "series"].contains(e["mediatype"]?.string ?? e["type"]?.string ?? "")
                guard let id = tmdb(e[isShow ? "show" : "movie"]) ?? tmdb(e) else { return nil }
                return ListEntry(key: MediaKey(type: isShow ? .show : .movie, tmdbID: id), addedAt: dateKeys.lazy.compactMap { e[$0]?.string.flatMap(FlowDate.parse) }.first ?? .distantPast)
            }
        }
        return parse(json["movies"]?.array, type: .movie, nested: "movie") + parse(json["shows"]?.array, type: .show, nested: "show")
    }

    static func itemPayload(_ item: MediaItem, extra: [String: JSONValue] = [:]) -> JSONValue {
        var ids: [String: JSONValue] = [:]
        if let tmdb = item.ids.tmdb { ids["tmdb"] = .number(Double(tmdb)) }
        if let imdb = item.ids.imdb { ids["imdb"] = .string(imdb) }
        if let tvdb = item.ids.tvdb { ids["tvdb"] = .number(Double(tvdb)) }
        var object: [String: JSONValue] = ["ids": .object(ids)]
        for (k, v) in extra { object[k] = v }
        return .object([item.type == .movie ? "movies" : "shows": .array([.object(object)])])
    }

    // MARK: TrackingService

    public func profile() async throws -> UserProfile? {
        let json = try? await get("/user")
        let name = json?["username"]?.string ?? json?["name"]?.string ?? kind.displayName
        return UserProfile(username: name)
    }

    public func playbackProgress() async throws -> [PlaybackProgress] {
        let json = try await get("/sync/playback")
        return (json.array ?? json["playback"]?.array ?? []).compactMap { e in
            let isMovie = (e["type"]?.string ?? "movie") == "movie"
            let showNode = e["show"] ?? e["episode"]?["show"]
            guard let id = Self.tmdb(isMovie ? e["movie"] : showNode) else { return nil }
            let ep = e["episode"].flatMap { x -> EpisodeRef? in
                guard let s = x["season"]?.int, let n = x["number"]?.int else { return nil }
                return EpisodeRef(season: s, episode: n)
            }
            return PlaybackProgress(key: MediaKey(type: isMovie ? .movie : .show, tmdbID: id), episode: ep, percent: e["progress"]?.double ?? 0,
                                    updatedAt: e["paused_at"]?.string.flatMap(FlowDate.parse) ?? Date(), remoteID: e["id"]?.string)
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    public func removePlaybackProgress(_ progress: PlaybackProgress) async throws {
        guard let id = progress.remoteID else { return }
        try await http.send(request(.delete, "/sync/playback/\(id)"))
    }

    public func history(limit: Int) async throws -> [HistoryEntry] {
        let json = try await get("/sync/history", query: ["limit": String(limit)])
        return (json.array ?? []).compactMap { e in
            let isMovie = (e["type"]?.string ?? "movie") == "movie"
            guard let id = Self.tmdb(isMovie ? e["movie"] : (e["show"] ?? e["episode"]?["show"])) else { return nil }
            let ep = e["episode"].flatMap { x -> EpisodeRef? in
                guard let s = x["season"]?.int, let n = x["number"]?.int else { return nil }
                return EpisodeRef(season: s, episode: n)
            }
            return HistoryEntry(key: MediaKey(type: isMovie ? .movie : .show, tmdbID: id), episode: ep, watchedAt: e["watched_at"]?.string.flatMap(FlowDate.parse) ?? .distantPast)
        }
    }

    public func watchedMovies() async throws -> Set<Int> {
        let json = try await get("/sync/watched")
        return Set((json["movies"]?.array ?? []).compactMap { Self.tmdb($0["movie"]) ?? Self.tmdb($0) })
    }

    public func watchedShows() async throws -> [ShowWatchState] {
        let json = try await get("/sync/watched")
        var states: [Int: ShowWatchState] = [:]
        for s in json["shows"]?.array ?? [] {
            guard let id = Self.tmdb(s["show"]) ?? Self.tmdb(s) else { continue }
            var state = states[id] ?? ShowWatchState(key: MediaKey(type: .show, tmdbID: id))
            for season in s["seasons"]?.array ?? [] {
                guard let sn = season["number"]?.int else { continue }
                for ep in season["episodes"]?.array ?? [] { if let en = ep["number"]?.int { state.watched.insert(EpisodeRef(season: sn, episode: en)) } }
            }
            state.lastWatchedAt = s["last_watched_at"]?.string.flatMap(FlowDate.parse)
            states[id] = state
        }
        // Flat episode list shape.
        for e in json["episodes"]?.array ?? [] {
            guard let id = Self.tmdb(e["show"] ?? e["episode"]?["show"]), let sn = (e["episode"]?["season"] ?? e["season"])?.int, let en = (e["episode"]?["number"] ?? e["number"])?.int else { continue }
            states[id, default: ShowWatchState(key: MediaKey(type: .show, tmdbID: id))].watched.insert(EpisodeRef(season: sn, episode: en))
        }
        return Array(states.values)
    }

    public func markWatched(_ item: MediaItem, episodes: [EpisodeRef]?, at date: Date) async throws {
        try await post("/sync/watched", Self.itemPayload(item, extra: SimklClient.episodesExtra(episodes, at: date)))
    }

    public func markUnwatched(_ item: MediaItem, episodes: [EpisodeRef]?) async throws {
        try await post("/sync/watched/remove", Self.itemPayload(item, extra: SimklClient.episodesExtra(episodes, at: nil)))
    }

    public func scrobble(_ action: ScrobbleAction, request: PlaybackRequest, percent: Double) async throws {
        var ids: [String: JSONValue] = [:]
        if let tmdb = request.item.ids.tmdb { ids["tmdb"] = .number(Double(tmdb)) }
        if let imdb = request.item.ids.imdb { ids["imdb"] = .string(imdb) }
        var body: [String: JSONValue] = ["progress": .number(min(100, max(0, percent)))]
        if let ep = request.episode {
            body["show"] = .object(["ids": .object(ids)])
            body["episode"] = .object(["season": .number(Double(ep.season)), "number": .number(Double(ep.number))])
        } else {
            body["movie"] = .object(["ids": .object(ids)])
        }
        try await post("/scrobble/\(action.rawValue)", .object(body))
    }

    // MARK: ListService

    public func watchlist() async throws -> [ListEntry] {
        Self.entries(try await get("/watchlist/items"), dateKeys: ["watchlist_at", "listed_at", "added_at"]).sorted { $0.addedAt > $1.addedAt }
    }

    public func setWatchlisted(_ item: MediaItem, _ listed: Bool) async throws {
        guard let tmdb = item.ids.tmdb else { return }
        let body: JSONValue = .object([item.type == .movie ? "movies" : "shows": .array([.object(["tmdb": .number(Double(tmdb))])])])
        try await post(listed ? "/watchlist/items/add" : "/watchlist/items/remove", body)
    }
}

/// MDBList-only features: aggregated ratings and user lists.
public struct MDBListClient: Sendable {
    let sync: KeyedSyncClient

    public init(apiKey: String, http: HTTPClient = HTTPClient()) {
        sync = .mdblist(apiKey: apiKey, http: http)
    }

    /// IMDb, Rotten Tomatoes, Popcornmeter, Metacritic, TMDb, Letterboxd and Trakt scores.
    public func ratings(_ type: MediaType, tmdbID: Int) async throws -> Ratings {
        let json = try await sync.get("/tmdb/\(type == .movie ? "movie" : "show")/\(tmdbID)")
        return Self.parseRatings(json)
    }

    public static func parseRatings(_ json: JSONValue) -> Ratings {
        var r = Ratings()
        for entry in json["ratings"]?.array ?? [] {
            let value = entry["value"]?.double
            let score = entry["score"]?.int
            guard value != nil || score != nil else { continue }
            switch entry["source"]?.string {
            case "imdb": r.imdb = value; r.imdbVotes = entry["votes"]?.int
            case "tomatoes": r.rottenTomatoes = value.map { Int($0) } ?? score
            case "popcorn", "tomatoesaudience", "audience": r.popcorn = value.map { Int($0) } ?? score
            case "metacritic": r.metacritic = value.map { Int($0) } ?? score
            case "tmdb": r.tmdb = value.map { $0 > 10 ? $0 / 10 : $0 }
            case "letterboxd": r.letterboxd = value
            case "trakt": r.trakt = value.map { Int($0) } ?? score
            default: break
            }
        }
        return r
    }

    public struct UserList: Hashable, Sendable, Identifiable {
        public var id: Int
        public var name: String
        public var itemCount: Int
    }

    public func myLists() async throws -> [UserList] {
        let json = try await sync.get("/lists/user")
        return (json.array ?? []).compactMap { e in
            guard let id = e["id"]?.int, let name = e["name"]?.string else { return nil }
            return UserList(id: id, name: name, itemCount: e["items"]?.int ?? 0)
        }
    }

    public func listItems(_ id: Int) async throws -> [MediaKey] {
        let json = try await sync.get("/lists/\(id)/items", query: ["limit": "200"])
        return KeyedSyncClient.entries(json, dateKeys: []).map(\.key)
    }
}
