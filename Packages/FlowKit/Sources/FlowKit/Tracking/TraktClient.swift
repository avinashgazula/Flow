import Foundation

/// Trakt API v2: device sign-in, sync, scrobbling, lists, catalogue and ratings.
public actor TraktClient: TrackingService, ListService {
    public nonisolated let kind: TrackerKind = .trakt
    public nonisolated let destination: ListDestination = .trakt

    public nonisolated let clientID: String
    private let clientSecret: String
    private var token: OAuthToken?
    private let http: HTTPClient
    private let onTokenChange: @Sendable (OAuthToken?) -> Void
    private let base = "https://api.trakt.tv"

    public init(clientID: String, clientSecret: String, token: OAuthToken?, http: HTTPClient = HTTPClient(), onTokenChange: @escaping @Sendable (OAuthToken?) -> Void = { _ in }) {
        self.clientID = clientID
        self.clientSecret = clientSecret
        self.token = token
        self.http = http
        self.onTokenChange = onTokenChange
    }

    public var isSignedIn: Bool { token != nil }

    // MARK: Requests

    private func headers(authenticated: Bool) async throws -> [String: String] {
        guard !clientID.isEmpty else { throw FlowError.missingCredential("Trakt client ID") }
        var h = ["trakt-api-version": "2", "trakt-api-key": clientID, "Content-Type": "application/json"]
        if authenticated {
            guard var current = token else { throw FlowError.unauthorized }
            if current.isExpired, current.refreshToken != nil {
                current = try await refresh(current)
            }
            h["Authorization"] = "Bearer \(current.accessToken)"
        }
        return h
    }

    private func request(_ method: HTTPMethod = .get, _ path: String, query: [String: String?] = [:], auth: Bool = true) async throws -> HTTPRequest {
        try HTTPRequest(method, base + path, query: query, headers: try await headers(authenticated: auth))
    }

    private func get<T: Decodable>(_ type: T.Type, _ path: String, query: [String: String?] = [:], auth: Bool = true) async throws -> T {
        try await http.json(T.self, request(.get, path, query: query, auth: auth))
    }

    private func post<B: Encodable>(_ path: String, body: B) async throws {
        var r = try await request(.post, path)
        try r.setJSONBody(body)
        try await http.send(r)
    }

    // MARK: Device sign-in

    public func startDeviceAuth() async throws -> DeviceCode {
        struct Body: Encodable { var client_id: String }
        struct Response: Decodable { var device_code: String; var user_code: String; var verification_url: String; var expires_in: Double; var interval: Double }
        var r = try HTTPRequest(.post, base + "/oauth/device/code", headers: ["Content-Type": "application/json"])
        try r.setJSONBody(Body(client_id: clientID))
        let response = try await http.json(Response.self, r)
        return DeviceCode(deviceCode: response.device_code, userCode: response.user_code, verificationURL: URL(string: response.verification_url) ?? URL(string: "https://trakt.tv/activate")!, expiresIn: response.expires_in, interval: response.interval)
    }

    /// Polls until the user approves the code. Throws `FlowError.timedOut` when the code expires.
    public func pollDeviceToken(_ code: DeviceCode) async throws -> OAuthToken {
        struct Body: Encodable { var code: String; var client_id: String; var client_secret: String }
        let deadline = Date().addingTimeInterval(code.expiresIn)
        var interval = max(code.interval, 1)
        while Date() < deadline {
            try Task.checkCancellation()
            var r = try HTTPRequest(.post, base + "/oauth/device/token", headers: ["Content-Type": "application/json"])
            try r.setJSONBody(Body(code: code.deviceCode, client_id: clientID, client_secret: clientSecret))
            let (data, response) = try await http.data(r, acceptStatus: 200..<600)
            switch response.statusCode {
            case 200:
                let t = try Self.decodeToken(data)
                token = t
                onTokenChange(t)
                return t
            case 400: break // pending
            case 429: interval += 1
            case 404, 409, 410, 418: throw FlowError.unauthorized
            default: throw FlowError.http(status: response.statusCode, body: nil)
            }
            try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
        }
        throw FlowError.timedOut
    }

    private func refresh(_ current: OAuthToken) async throws -> OAuthToken {
        struct Body: Encodable { var refresh_token: String; var client_id: String; var client_secret: String; var redirect_uri = "urn:ietf:wg:oauth:2.0:oob"; var grant_type = "refresh_token" }
        var r = try HTTPRequest(.post, base + "/oauth/token", headers: ["Content-Type": "application/json"])
        try r.setJSONBody(Body(refresh_token: current.refreshToken ?? "", client_id: clientID, client_secret: clientSecret))
        let (data, _) = try await http.data(r)
        let t = try Self.decodeToken(data)
        token = t
        onTokenChange(t)
        return t
    }

    static func decodeToken(_ data: Data) throws -> OAuthToken {
        struct Response: Decodable { var access_token: String; var refresh_token: String?; var expires_in: Double?; var created_at: Double? }
        let r = try JSONDecoder().decode(Response.self, from: data)
        let created = r.created_at.map { Date(timeIntervalSince1970: $0) } ?? Date()
        return OAuthToken(accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_in.map { created.addingTimeInterval($0) })
    }

    public func signOut() async {
        if let token {
            struct Body: Encodable { var token: String; var client_id: String; var client_secret: String }
            if var r = try? HTTPRequest(.post, base + "/oauth/revoke", headers: ["Content-Type": "application/json"]) {
                try? r.setJSONBody(Body(token: token.accessToken, client_id: clientID, client_secret: clientSecret))
                _ = try? await http.data(r)
            }
        }
        token = nil
        onTokenChange(nil)
    }

    // MARK: DTOs

    struct IDs: Codable, Hashable {
        var trakt: Int?
        var slug: String?
        var imdb: String?
        var tmdb: Int?
        var tvdb: Int?

        var external: ExternalIDs { ExternalIDs(tmdb: tmdb, imdb: imdb, tvdb: tvdb, trakt: trakt, traktSlug: slug) }

        init(_ ids: ExternalIDs) {
            trakt = ids.trakt
            imdb = ids.imdb
            tmdb = ids.tmdb
            tvdb = ids.tvdb
        }
    }

    struct Media: Codable { var title: String?; var year: Int?; var ids: IDs }
    struct EpisodeDTO: Codable {
        var season: Int
        var number: Int
        var title: String?
        var overview: String?
        var first_aired: Date?
        var runtime: Int?
        var ids: IDs?
    }

    struct PlaybackDTO: Decodable {
        var id: Int
        var progress: Double
        var paused_at: Date?
        var type: String
        var movie: Media?
        var show: Media?
        var episode: EpisodeDTO?
    }

    struct HistoryDTO: Decodable {
        var id: Int
        var watched_at: Date
        var type: String
        var movie: Media?
        var show: Media?
        var episode: EpisodeDTO?
    }

    struct ListedDTO: Decodable {
        var listed_at: Date?
        var type: String
        var movie: Media?
        var show: Media?
    }

    static func key(type: String, movie: Media?, show: Media?) -> MediaKey? {
        if type == "movie", let tmdb = movie?.ids.tmdb { return MediaKey(type: .movie, tmdbID: tmdb) }
        if let tmdb = show?.ids.tmdb { return MediaKey(type: .show, tmdbID: tmdb) }
        return nil
    }

    // MARK: TrackingService

    public func profile() async throws -> UserProfile? {
        struct Settings: Decodable {
            struct User: Decodable {
                var username: String
                var name: String?
                var images: Images?
                struct Images: Decodable { struct Avatar: Decodable { var full: String? }; var avatar: Avatar? }
            }
            var user: User
        }
        let s = try await get(Settings.self, "/users/settings")
        return UserProfile(username: s.user.username, displayName: s.user.name, avatarURL: s.user.images?.avatar?.full.flatMap(URL.init(string:)))
    }

    public func playbackProgress() async throws -> [PlaybackProgress] {
        let items = try await get([PlaybackDTO].self, "/sync/playback", query: ["limit": "100"])
        return items.compactMap { dto in
            guard let key = Self.key(type: dto.type, movie: dto.movie, show: dto.show) else { return nil }
            let episode = dto.episode.map { EpisodeRef(season: $0.season, episode: $0.number) }
            return PlaybackProgress(key: key, episode: episode, percent: dto.progress, updatedAt: dto.paused_at ?? Date(), remoteID: String(dto.id))
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    public func removePlaybackProgress(_ progress: PlaybackProgress) async throws {
        guard let id = progress.remoteID else { return }
        try await http.send(request(.delete, "/sync/playback/\(id)"))
    }

    public func history(limit: Int) async throws -> [HistoryEntry] {
        let items = try await get([HistoryDTO].self, "/sync/history", query: ["limit": String(limit)])
        return items.compactMap { dto in
            guard let key = Self.key(type: dto.type, movie: dto.movie, show: dto.show) else { return nil }
            return HistoryEntry(key: key, episode: dto.episode.map { EpisodeRef(season: $0.season, episode: $0.number) }, watchedAt: dto.watched_at, remoteID: String(dto.id))
        }
    }

    public func watchedMovies() async throws -> Set<Int> {
        struct DTO: Decodable { var movie: Media }
        return Set(try await get([DTO].self, "/sync/watched/movies").compactMap(\.movie.ids.tmdb))
    }

    public func watchedShows() async throws -> [ShowWatchState] {
        struct DTO: Decodable {
            var last_watched_at: Date?
            var show: Media
            var seasons: [S]?
            struct S: Decodable { var number: Int; var episodes: [E]; struct E: Decodable { var number: Int } }
        }
        let items = try await get([DTO].self, "/sync/watched/shows")
        return items.compactMap { dto in
            guard let tmdb = dto.show.ids.tmdb else { return nil }
            let watched = Set((dto.seasons ?? []).flatMap { s in s.episodes.map { EpisodeRef(season: s.number, episode: $0.number) } })
            return ShowWatchState(key: MediaKey(type: .show, tmdbID: tmdb), watched: watched, lastWatchedAt: dto.last_watched_at)
        }
    }

    struct SyncBody: Encodable {
        struct MovieEntry: Encodable { var ids: IDs; var watched_at: Date? }
        struct ShowEntry: Encodable {
            var ids: IDs
            var seasons: [SeasonEntry]?
            var watched_at: Date?
        }
        struct SeasonEntry: Encodable { var number: Int; var episodes: [EpisodeEntry] }
        struct EpisodeEntry: Encodable { var number: Int; var watched_at: Date? }
        var movies: [MovieEntry] = []
        var shows: [ShowEntry] = []
    }

    static func syncBody(_ item: MediaItem, episodes: [EpisodeRef]?, at date: Date?) -> SyncBody {
        var body = SyncBody()
        let ids = IDs(item.ids)
        if item.type == .movie {
            body.movies = [.init(ids: ids, watched_at: date)]
        } else if let episodes {
            let seasons = Dictionary(grouping: episodes, by: \.season).sorted { $0.key < $1.key }.map { season, refs in
                SyncBody.SeasonEntry(number: season, episodes: refs.sorted().map { .init(number: $0.episode, watched_at: date) })
            }
            body.shows = [.init(ids: ids, seasons: seasons)]
        } else {
            body.shows = [.init(ids: ids, seasons: nil, watched_at: date)]
        }
        return body
    }

    public func markWatched(_ item: MediaItem, episodes: [EpisodeRef]?, at date: Date) async throws {
        try await post("/sync/history", body: Self.syncBody(item, episodes: episodes, at: date))
    }

    public func markUnwatched(_ item: MediaItem, episodes: [EpisodeRef]?) async throws {
        try await post("/sync/history/remove", body: Self.syncBody(item, episodes: episodes, at: nil))
    }

    public func scrobble(_ action: ScrobbleAction, request: PlaybackRequest, percent: Double) async throws {
        struct MovieBody: Encodable { var movie: Media; var progress: Double }
        struct EpisodeBody: Encodable { var show: Media; var episode: Ep; var progress: Double; struct Ep: Encodable { var season: Int; var number: Int } }
        let media = Media(title: request.item.title, year: request.item.year, ids: IDs(request.item.ids))
        let progress = min(100, max(0, percent))
        if let episode = request.episode {
            try await post("/scrobble/\(action.rawValue)", body: EpisodeBody(show: media, episode: .init(season: episode.season, number: episode.number), progress: progress))
        } else {
            try await post("/scrobble/\(action.rawValue)", body: MovieBody(movie: media, progress: progress))
        }
    }

    // MARK: ListService

    private func listEntries(_ path: String) async throws -> [ListEntry] {
        let items = try await get([ListedDTO].self, path)
        return items.compactMap { dto in
            Self.key(type: dto.type, movie: dto.movie, show: dto.show).map { ListEntry(key: $0, addedAt: dto.listed_at ?? Date()) }
        }.sorted { $0.addedAt > $1.addedAt }
    }

    private func listBody(_ item: MediaItem) -> SyncBody {
        var body = SyncBody()
        if item.type == .movie { body.movies = [.init(ids: IDs(item.ids))] } else { body.shows = [.init(ids: IDs(item.ids))] }
        return body
    }

    public func watchlist() async throws -> [ListEntry] { try await listEntries("/sync/watchlist") }

    public func setWatchlisted(_ item: MediaItem, _ listed: Bool) async throws {
        try await post(listed ? "/sync/watchlist" : "/sync/watchlist/remove", body: listBody(item))
    }

    public func favourites() async throws -> [ListEntry] { try await listEntries("/sync/favorites") }

    public func setFavourite(_ item: MediaItem, _ favourite: Bool) async throws {
        try await post(favourite ? "/sync/favorites" : "/sync/favorites/remove", body: listBody(item))
    }

    // MARK: Catalogue

    /// Items from a public or personal list as TMDb keys.
    public func listItems(user: String, slug: String) async throws -> [MediaKey] {
        let items = try await get([ListedDTO].self, "/users/\(user)/lists/\(slug)/items", auth: token != nil)
        return items.compactMap { Self.key(type: $0.type, movie: $0.movie, show: $0.show) }
    }

    public struct ListSummary: Decodable, Hashable, Sendable {
        public var name: String
        public var ids: Ids
        public var item_count: Int?
        public struct Ids: Decodable, Hashable, Sendable { public var slug: String }
    }

    public func myLists() async throws -> [ListSummary] {
        try await get([ListSummary].self, "/users/me/lists")
    }

    public func anticipated(_ type: MediaType) async throws -> [MediaKey] {
        struct DTO: Decodable { var movie: Media?; var show: Media? }
        let items = try await get([DTO].self, "/\(type.traktPath)/anticipated", query: ["limit": "40"], auth: false)
        return items.compactMap { ($0.movie ?? $0.show)?.ids.tmdb.map { MediaKey(type: type, tmdbID: $0) } }
    }

    public func recommendations(_ type: MediaType) async throws -> [MediaKey] {
        let items = try await get([Media].self, "/recommendations/\(type.traktPath)", query: ["limit": "40", "ignore_collected": "true"])
        return items.compactMap { $0.ids.tmdb.map { MediaKey(type: type, tmdbID: $0) } }
    }

    /// Community rating as a percentage.
    public func rating(_ type: MediaType, id: String) async throws -> Int? {
        struct DTO: Decodable { var rating: Double? }
        return try await get(DTO.self, "/\(type.traktPath)/\(id)/ratings", auth: false).rating.map { Int(($0 * 10).rounded()) }
    }

    public func episodes(showID: String, showTMDB: Int) async throws -> [Episode] {
        struct SeasonDTO: Decodable { var number: Int; var episodes: [EpisodeDTO]? }
        let seasons = try await get([SeasonDTO].self, "/shows/\(showID)/seasons", query: ["extended": "episodes,full"], auth: false)
        return seasons.flatMap { s in
            (s.episodes ?? []).map {
                Episode(showTMDB: showTMDB, season: $0.season, number: $0.number, title: $0.title ?? "Episode \($0.number)", overview: $0.overview, airDate: $0.first_aired, runtimeMinutes: $0.runtime, ids: $0.ids?.external ?? ExternalIDs())
            }
        }
    }
}
