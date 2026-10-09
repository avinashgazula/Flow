import Foundation

/// Simkl API: PIN sign-in, all-items sync, watchlist ("plantowatch") and scrobbling.
public actor SimklClient: TrackingService, ListService {
    public nonisolated let kind: TrackerKind = .simkl
    public nonisolated let destination: ListDestination = .simkl

    private let clientID: String
    private var token: OAuthToken?
    private let http: HTTPClient
    private let onTokenChange: @Sendable (OAuthToken?) -> Void
    private let base = "https://api.simkl.com"

    public init(clientID: String, token: OAuthToken?, http: HTTPClient = HTTPClient(), onTokenChange: @escaping @Sendable (OAuthToken?) -> Void = { _ in }) {
        self.clientID = clientID
        self.token = token
        self.http = http
        self.onTokenChange = onTokenChange
    }

    private func request(_ method: HTTPMethod = .get, _ path: String, query: [String: String?] = [:], auth: Bool = true) throws -> HTTPRequest {
        guard !clientID.isEmpty else { throw FlowError.missingCredential("Simkl client ID") }
        var headers = ["simkl-api-key": clientID, "Content-Type": "application/json"]
        if auth {
            guard let token else { throw FlowError.unauthorized }
            headers["Authorization"] = "Bearer \(token.accessToken)"
        }
        var q = query
        q["client_id"] = clientID
        return try HTTPRequest(method, base + path, query: q, headers: headers)
    }

    private func get(_ path: String, query: [String: String?] = [:], auth: Bool = true) async throws -> JSONValue {
        let (data, _) = try await http.data(request(.get, path, query: query, auth: auth))
        if data.isEmpty || String(data: data, encoding: .utf8) == "null" { return .null }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func post<B: Encodable>(_ path: String, body: B) async throws {
        var r = try request(.post, path)
        try r.setJSONBody(body)
        try await http.send(r)
    }

    // MARK: PIN sign-in

    public func startDeviceAuth() async throws -> DeviceCode {
        let json = try await get("/oauth/pin", auth: false)
        guard let code = json["user_code"]?.string else { throw FlowError.decoding("Simkl PIN") }
        return DeviceCode(
            deviceCode: code,
            userCode: code,
            verificationURL: json["verification_url"]?.string.flatMap(URL.init(string:)) ?? URL(string: "https://simkl.com/pin")!,
            expiresIn: json["expires_in"]?.double ?? 900,
            interval: json["interval"]?.double ?? 5
        )
    }

    public func pollDeviceToken(_ code: DeviceCode) async throws -> OAuthToken {
        let deadline = Date().addingTimeInterval(code.expiresIn)
        while Date() < deadline {
            try Task.checkCancellation()
            let json = try await get("/oauth/pin/\(code.userCode)", auth: false)
            if json["result"]?.string == "OK", let access = json["access_token"]?.string {
                let t = OAuthToken(accessToken: access)
                token = t
                onTokenChange(t)
                return t
            }
            try await Task.sleep(nanoseconds: UInt64(max(code.interval, 1) * 1_000_000_000))
        }
        throw FlowError.timedOut
    }

    public func signOut() {
        token = nil
        onTokenChange(nil)
    }

    // MARK: Parsing helpers

    static func tmdbID(_ media: JSONValue?) -> Int? {
        media?["ids"]?["tmdb"]?.int
    }

    static func ids(_ item: MediaItem) -> [String: JSONValue] {
        var ids: [String: JSONValue] = [:]
        if let tmdb = item.ids.tmdb { ids["tmdb"] = .number(Double(tmdb)) }
        if let imdb = item.ids.imdb { ids["imdb"] = .string(imdb) }
        if let tvdb = item.ids.tvdb { ids["tvdb"] = .number(Double(tvdb)) }
        if let simkl = item.ids.simkl { ids["simkl"] = .number(Double(simkl)) }
        return ids
    }

    static func entry(_ item: MediaItem, extra: [String: JSONValue] = [:]) -> JSONValue {
        var object: [String: JSONValue] = ["ids": .object(ids(item)), "title": .string(item.title)]
        if let year = item.year { object["year"] = .number(Double(year)) }
        for (k, v) in extra { object[k] = v }
        return .object(object)
    }

    static func body(_ item: MediaItem, extra: [String: JSONValue] = [:]) -> JSONValue {
        .object([item.type == .movie ? "movies" : "shows": .array([entry(item, extra: extra)])])
    }

    // MARK: TrackingService

    public func profile() async throws -> UserProfile? {
        let json = try await get("/users/settings")
        guard let name = json["user"]?["name"]?.string else { return nil }
        return UserProfile(username: name, displayName: name, avatarURL: json["user"]?["avatar"]?.string.flatMap(URL.init(string:)))
    }

    public func playbackProgress() async throws -> [PlaybackProgress] {
        let json = try await get("/sync/playback")
        return (json.array ?? []).compactMap { entry in
            let isMovie = entry["type"]?.string == "movie"
            guard let tmdb = Self.tmdbID(isMovie ? entry["movie"] : entry["show"]) else { return nil }
            let episode = entry["episode"].flatMap { e -> EpisodeRef? in
                guard let s = e["season"]?.int, let n = (e["number"] ?? e["episode"])?.int else { return nil }
                return EpisodeRef(season: s, episode: n)
            }
            return PlaybackProgress(key: MediaKey(type: isMovie ? .movie : .show, tmdbID: tmdb), episode: episode, percent: entry["progress"]?.double ?? 0,
                                    updatedAt: entry["paused_at"]?.string.flatMap(FlowDate.parse) ?? Date(), remoteID: entry["id"]?.string)
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    public func removePlaybackProgress(_ progress: PlaybackProgress) async throws {
        guard let id = progress.remoteID else { return }
        try await http.send(request(.delete, "/sync/playback/\(id)"))
    }

    public func history(limit: Int) async throws -> [HistoryEntry] {
        // Simkl has no flat history feed; derive from last-watched timestamps.
        async let movies = get("/sync/all-items/movies/completed")
        async let shows = get("/sync/all-items/shows", query: ["extended": "full", "episode_watched_at": "yes"])
        var entries: [HistoryEntry] = []
        for m in try await movies["movies"]?.array ?? [] {
            if let tmdb = Self.tmdbID(m["movie"]), let date = m["last_watched_at"]?.string.flatMap(FlowDate.parse) {
                entries.append(HistoryEntry(key: MediaKey(type: .movie, tmdbID: tmdb), watchedAt: date))
            }
        }
        for s in try await shows["shows"]?.array ?? [] {
            guard let tmdb = Self.tmdbID(s["show"]) else { continue }
            for season in s["seasons"]?.array ?? [] {
                for ep in season["episodes"]?.array ?? [] {
                    if let sn = season["number"]?.int, let en = ep["number"]?.int, let date = ep["watched_at"]?.string.flatMap(FlowDate.parse) {
                        entries.append(HistoryEntry(key: MediaKey(type: .show, tmdbID: tmdb), episode: EpisodeRef(season: sn, episode: en), watchedAt: date))
                    }
                }
            }
        }
        return Array(entries.sorted { $0.watchedAt > $1.watchedAt }.prefix(limit))
    }

    public func watchedMovies() async throws -> Set<Int> {
        let json = try await get("/sync/all-items/movies/completed")
        return Set((json["movies"]?.array ?? []).compactMap { Self.tmdbID($0["movie"]) })
    }

    public func watchedShows() async throws -> [ShowWatchState] {
        let json = try await get("/sync/all-items/shows", query: ["extended": "full"])
        return (json["shows"]?.array ?? []).compactMap { s in
            guard let tmdb = Self.tmdbID(s["show"]) else { return nil }
            var watched = Set<EpisodeRef>()
            for season in s["seasons"]?.array ?? [] {
                guard let sn = season["number"]?.int else { continue }
                for ep in season["episodes"]?.array ?? [] {
                    if let en = ep["number"]?.int { watched.insert(EpisodeRef(season: sn, episode: en)) }
                }
            }
            return ShowWatchState(key: MediaKey(type: .show, tmdbID: tmdb), watched: watched, lastWatchedAt: s["last_watched_at"]?.string.flatMap(FlowDate.parse))
        }
    }

    static func episodesExtra(_ episodes: [EpisodeRef]?, at date: Date?) -> [String: JSONValue] {
        var extra: [String: JSONValue] = [:]
        if let date { extra["watched_at"] = .string(FlowDate.iso8601String(date)) }
        if let episodes {
            extra["seasons"] = .array(Dictionary(grouping: episodes, by: \.season).sorted { $0.key < $1.key }.map { season, refs in
                .object(["number": .number(Double(season)), "episodes": .array(refs.sorted().map { .object(["number": .number(Double($0.episode))]) })])
            })
        }
        return extra
    }

    public func markWatched(_ item: MediaItem, episodes: [EpisodeRef]?, at date: Date) async throws {
        try await post("/sync/history", body: Self.body(item, extra: Self.episodesExtra(episodes, at: date)))
    }

    public func markUnwatched(_ item: MediaItem, episodes: [EpisodeRef]?) async throws {
        try await post("/sync/history/remove", body: Self.body(item, extra: Self.episodesExtra(episodes, at: nil)))
    }

    public func scrobble(_ action: ScrobbleAction, request: PlaybackRequest, percent: Double) async throws {
        var body: [String: JSONValue] = ["progress": .number(min(100, max(0, percent)))]
        if let episode = request.episode {
            body["show"] = Self.entry(request.item)
            body["episode"] = .object(["season": .number(Double(episode.season)), "number": .number(Double(episode.number))])
        } else {
            body["movie"] = Self.entry(request.item)
        }
        try await post("/scrobble/\(action.rawValue)", body: JSONValue.object(body))
    }

    // MARK: ListService

    public func watchlist() async throws -> [ListEntry] {
        async let movies = get("/sync/all-items/movies/plantowatch")
        async let shows = get("/sync/all-items/shows/plantowatch")
        var entries: [ListEntry] = []
        for m in try await movies["movies"]?.array ?? [] {
            if let tmdb = Self.tmdbID(m["movie"]) {
                entries.append(ListEntry(key: MediaKey(type: .movie, tmdbID: tmdb), addedAt: m["added_to_watchlist_at"]?.string.flatMap(FlowDate.parse) ?? .distantPast))
            }
        }
        for s in try await shows["shows"]?.array ?? [] {
            if let tmdb = Self.tmdbID(s["show"]) {
                entries.append(ListEntry(key: MediaKey(type: .show, tmdbID: tmdb), addedAt: s["added_to_watchlist_at"]?.string.flatMap(FlowDate.parse) ?? .distantPast))
            }
        }
        return entries.sorted { $0.addedAt > $1.addedAt }
    }

    public func setWatchlisted(_ item: MediaItem, _ listed: Bool) async throws {
        if listed {
            try await post("/sync/add-to-list", body: Self.body(item, extra: ["to": .string("plantowatch")]))
        } else {
            try await post("/sync/history/remove", body: Self.body(item))
        }
    }
}
