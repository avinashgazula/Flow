import Foundation

/// Simkl API: sign-in (a PIN, or the OAuth 2.0 device flow for newer Simkl apps), all-items sync, watchlist ("plantowatch") and scrobbling.
public actor SimklClient: TrackingService, ListService {
    public nonisolated let kind: TrackerKind = .simkl
    public nonisolated let destination: ListDestination = .simkl

    private let clientID: String
    private var token: OAuthToken?
    private let http: HTTPClient
    private let onTokenChange: @Sendable (OAuthToken?) -> Void
    /// How long to wait between looks while a sign-in is pending. A parameter so tests needn't wait.
    private let pause: @Sendable (TimeInterval) async throws -> Void
    /// An OAuth 2.0 app's refresh token may be single use, so overlapping requests share one refresh.
    private var refreshTask: Task<OAuthToken, Error>?
    private let base = "https://api.simkl.com"

    public init(clientID: String, token: OAuthToken?, http: HTTPClient = HTTPClient(), onTokenChange: @escaping @Sendable (OAuthToken?) -> Void = { _ in },
                pause: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }) {
        self.clientID = clientID
        self.token = token
        self.http = http
        self.onTokenChange = onTokenChange
        self.pause = pause
    }

    private func request(_ method: HTTPMethod = .get, _ path: String, query: [String: String?] = [:], auth: Bool = true) async throws -> HTTPRequest {
        guard !clientID.isEmpty else { throw FlowError.missingCredential("Simkl client ID") }
        var headers = ["simkl-api-key": clientID, "Content-Type": "application/json"]
        if auth {
            guard var current = token else { throw FlowError.unauthorized }
            // Only a token from an OAuth 2.0 app has an expiry; an older app's never does, so it is never refreshed.
            if current.isExpired, current.refreshToken != nil {
                current = try await refresh(current)
            }
            headers["Authorization"] = "Bearer \(current.accessToken)"
        }
        var q = query
        q["client_id"] = clientID
        return try HTTPRequest(method, base + path, query: q, headers: headers)
    }

    private func get(_ path: String, query: [String: String?] = [:], auth: Bool = true) async throws -> JSONValue {
        let (data, _) = try await http.data(await request(.get, path, query: query, auth: auth))
        if data.isEmpty || String(data: data, encoding: .utf8) == "null" { return .null }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func post<B: Encodable>(_ path: String, body: B) async throws {
        var r = try await request(.post, path)
        try r.setJSONBody(body)
        try await http.send(r)
    }

    // MARK: Sign-in

    /// Starts a sign-in. Tries the PIN flow first; a Simkl app registered as OAuth 2.0 is turned away from it
    /// with a 400, and then the device flow gives the code instead. The code remembers which one it came from
    /// (see `usesDeviceFlow`), so `pollDeviceToken` polls the matching endpoint.
    public func startDeviceAuth() async throws -> DeviceCode {
        let json: JSONValue
        do {
            json = try await get("/oauth/pin", auth: false)
        } catch FlowError.http(let status, let body) where status == 400 && SimklOAuth.wantsDeviceFlow(body) {
            return try await startOAuth2Device()
        }
        guard let code = json["user_code"]?.string else { throw FlowError.decoding("Simkl PIN") }
        return DeviceCode(
            deviceCode: code,
            userCode: code,
            verificationURL: json["verification_url"]?.string.flatMap(URL.init(string:)) ?? URL(string: "https://simkl.com/pin")!,
            expiresIn: json["expires_in"]?.double ?? 900,
            interval: json["interval"]?.double ?? 5
        )
    }

    /// A PIN's device code is the PIN itself, while the device flow's is a long code of its own, so the two
    /// can be told apart without adding a field to the `DeviceCode` Trakt shares.
    public nonisolated static func usesDeviceFlow(_ code: DeviceCode) -> Bool {
        code.deviceCode != code.userCode
    }

    private func startOAuth2Device() async throws -> DeviceCode {
        var r = try await request(.post, "/oauth2/device", auth: false)
        // Without a scope Simkl grants reading only, and every watch, rating and list change sent back is refused.
        try r.setJSONBody(["client_id": clientID, "scope": "media:read media:write"])
        let data: Data
        do {
            (data, _) = try await http.data(r)
        } catch FlowError.unauthorized, FlowError.notFound {
            throw FlowError.unsupported(SimklOAuth.clientIDRefused)
        } catch FlowError.http(let status, _) where status < 500 {
            // Nobody is signed in yet, so a refusal here is about the app.
            throw FlowError.unsupported(SimklOAuth.clientIDRefused)
        }
        guard let json = try? JSONDecoder().decode(JSONValue.self, from: data),
              let device = json["device_code"]?.string, let user = json["user_code"]?.string else { throw FlowError.decoding("Simkl device code") }
        // The address with the code in it when Simkl gives one, so the page opens with it filled in.
        let url = [json["verification_uri_complete"]?.string, json["verification_uri"]?.string].compactMap { $0 }.compactMap(URL.init(string:)).first { $0.scheme == "https" }
        return DeviceCode(deviceCode: device, userCode: user, verificationURL: url ?? URL(string: "https://simkl.com/pin")!, expiresIn: json["expires_in"]?.double ?? 900, interval: max(json["interval"]?.double ?? 5, 1))
    }

    public func pollDeviceToken(_ code: DeviceCode) async throws -> OAuthToken {
        if Self.usesDeviceFlow(code) { return try await pollOAuth2(code) }
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
            try await pause(max(code.interval, 1))
        }
        throw FlowError.timedOut
    }

    /// RFC 8628: ask until approved, wait longer when told to slow down, stop when the code is dead or refused.
    private func pollOAuth2(_ code: DeviceCode) async throws -> OAuthToken {
        let deadline = Date().addingTimeInterval(code.expiresIn)
        var interval = max(code.interval, 1)
        while Date() < deadline {
            try Task.checkCancellation()
            var r = try await request(.post, "/oauth2/token", auth: false)
            try r.setJSONBody(["client_id": clientID, "device_code": code.deviceCode, "grant_type": SimklOAuth.deviceGrant])
            let (data, response) = try await http.data(r, acceptStatus: 200..<600)
            if (200..<300).contains(response.statusCode) {
                guard let t = SimklOAuth.token(from: data) else { throw FlowError.decoding("Simkl token") }
                token = t
                onTokenChange(t)
                return t
            }
            switch SimklOAuth.errorCode(data) {
            case "authorization_pending": break
            case "slow_down": interval += 5
            case "expired_token": throw FlowError.unsupported(SimklOAuth.codeExpired)
            case "access_denied": throw FlowError.unsupported(SimklOAuth.codeDeclined)
            default:
                switch response.statusCode {
                case 429: interval += 5
                case 500...: break // Simkl is having a moment; the code is good for a while yet.
                case 401, 403: throw FlowError.unauthorized
                default: throw FlowError.http(status: response.statusCode, body: nil)
                }
            }
            try await pause(interval)
        }
        throw FlowError.timedOut
    }

    private func refresh(_ current: OAuthToken) async throws -> OAuthToken {
        if let refreshTask { return try await refreshTask.value }
        let task = Task { try await self.performRefresh(current) }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    /// Simkl turning the refresh token down (400 or 401) means the sign-in has ended, which is what `unauthorized` says.
    private func performRefresh(_ current: OAuthToken) async throws -> OAuthToken {
        var r = try await request(.post, "/oauth2/token", auth: false)
        try r.setJSONBody(["client_id": clientID, "grant_type": "refresh_token", "refresh_token": current.refreshToken ?? ""])
        let data: Data
        do {
            (data, _) = try await http.data(r)
        } catch FlowError.http(let status, _) where status == 400 {
            throw FlowError.unauthorized
        }
        guard var t = SimklOAuth.token(from: data) else { throw FlowError.decoding("Simkl token") }
        // A refresh answer that sends no new refresh token leaves the old one good.
        if t.refreshToken == nil { t.refreshToken = current.refreshToken }
        token = t
        onTokenChange(t)
        return t
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
        try await http.send(await request(.delete, "/sync/playback/\(id)"))
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

extension SimklClient: RatingService {
    public func rate(_ item: MediaItem, rating: Int?) async throws {
        let extra: [String: JSONValue] = rating.map { ["rating": .number(Double(min(10, max(1, $0))))] } ?? [:]
        try await post(rating == nil ? "/sync/ratings/remove" : "/sync/ratings", body: Self.body(item, extra: extra))
    }
}

/// Reading Simkl's OAuth 2.0 answers. Kept apart from the client so the shapes can be tested on their own.
enum SimklOAuth {
    static let deviceGrant = "urn:ietf:params:oauth:grant-type:device_code"
    static let clientIDRefused = "Simkl didn't accept this app's client ID. Check the Simkl Client ID in Settings → Account → API Keys."
    static let codeExpired = "That code expired before it was approved. Start the sign-in again."
    static let codeDeclined = "The sign-in was declined on Simkl. Start again if you want to sign in."

    /// An OAuth 2.0 app is answered a 400 at /oauth/pin that says to use /oauth2/device.
    static func wantsDeviceFlow(_ body: String?) -> Bool {
        guard let body else { return false }
        if let json = try? JSONDecoder().decode(JSONValue.self, from: Data(body.utf8)) {
            return json["error"]?.string == "unauthorized_client" || json["message"]?.string?.contains("/oauth2/device") == true
        }
        return body.contains("/oauth2/device")
    }

    /// The `error` of a failed token call ("authorization_pending", "slow_down", ...).
    static func errorCode(_ data: Data) -> String? {
        (try? JSONDecoder().decode(JSONValue.self, from: data))?["error"]?.string
    }

    /// A token answer, read defensively: only `access_token` is certain, `expires_in` may be a number or text.
    static func token(from data: Data, now: Date = Date()) -> OAuthToken? {
        guard let json = try? JSONDecoder().decode(JSONValue.self, from: data),
              let access = json["access_token"]?.string, !access.isEmpty else { return nil }
        let seconds = json["expires_in"]?.double ?? json["expires_in"]?.string.flatMap(Double.init)
        return OAuthToken(accessToken: access,
                          refreshToken: json["refresh_token"]?.string.flatMap { $0.isEmpty ? nil : $0 },
                          expiresAt: seconds.flatMap { $0 > 0 ? now.addingTimeInterval($0) : nil })
    }
}
