import Foundation

/// Xtream Codes "player_api" client: live channels, EPG, VOD movies and series.
public struct XtreamClient: IPTVProvider {
    public let config: IPTVProviderConfig
    let http: HTTPClient

    public init(config: IPTVProviderConfig, http: HTTPClient = HTTPClient()) {
        self.config = config
        self.http = http
    }

    var base: String {
        var s = config.url.absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        if s.hasSuffix("/player_api.php") { s.removeLast("/player_api.php".count) }
        return s
    }

    var username: String { config.username ?? "" }
    var password: String { config.password ?? "" }

    func api(_ action: String?, _ extra: [String: String?] = [:]) async throws -> JSONValue {
        var query: [String: String?] = ["username": username, "password": password]
        if let action { query["action"] = action }
        query.merge(extra) { _, b in b }
        var headers: [String: String] = [:]
        if let ua = config.userAgent { headers["User-Agent"] = ua }
        return try await http.json(JSONValue.self, HTTPRequest(.get, base + "/player_api.php", query: query, headers: headers, timeout: 60))
    }

    public struct AccountInfo: Sendable {
        public var status: String?
        public var expiresAt: Date?
        public var maxConnections: Int?
        public var activeConnections: Int?
    }

    public func accountInfo() async throws -> AccountInfo {
        let json = try await api(nil)
        let user = json["user_info"]
        guard user?["auth"]?.int != 0 else { throw FlowError.unauthorized }
        return AccountInfo(status: user?["status"]?.string, expiresAt: user?["exp_date"]?.double.map { Date(timeIntervalSince1970: $0) },
                           maxConnections: user?["max_connections"]?.int, activeConnections: user?["active_cons"]?.int)
    }

    public func channels() async throws -> [Channel] {
        async let categoriesJSON = api("get_live_categories")
        async let streamsJSON = api("get_live_streams")
        var groups: [String: String] = [:]
        for c in try await categoriesJSON.array ?? [] {
            if let id = c["category_id"]?.string, let name = c["category_name"]?.string { groups[id] = name }
        }
        return (try await streamsJSON.array ?? []).compactMap { s in
            guard let id = s["stream_id"]?.string, let url = URL(string: "\(base)/live/\(username)/\(password)/\(id).m3u8") else { return nil }
            return Channel(
                id: "\(config.id):\(id)",
                providerID: config.id,
                name: s["name"]?.string ?? "Channel \(id)",
                number: s["num"]?.int,
                group: s["category_id"]?.string.flatMap { groups[$0] } ?? "Uncategorised",
                logoURL: s["stream_icon"]?.string.flatMap { $0.isEmpty ? nil : URL(string: $0) },
                streamURL: url,
                epgID: s["epg_channel_id"]?.string.flatMap { $0.isEmpty ? nil : $0 },
                userAgent: config.userAgent,
                hasCatchup: (s["tv_archive"]?.int ?? 0) > 0
            )
        }
    }

    public func epg(window: ClosedRange<Date>) async throws -> EPG {
        let url = config.epgURL ?? URL(string: "\(base)/xmltv.php?username=\(username)&password=\(password)")!
        let (data, _) = try await http.data(HTTPRequest(.get, url: url, headers: ["Accept": "*/*"], timeout: 120))
        return XMLTVParser.parse(Gzip.isGzip(data) ? try Gzip.decompress(data) : data, window: window)
    }

    // MARK: VOD

    public struct VODMovie: Codable, Hashable, Sendable {
        public var streamID: String
        public var name: String
        public var tmdbID: Int?
        public var year: Int?
        public var container: String
        public var iconURL: URL?
    }

    public struct VODSeries: Codable, Hashable, Sendable {
        public var seriesID: String
        public var name: String
        public var tmdbID: Int?
        public var year: Int?
    }

    public func vodMovies() async throws -> [VODMovie] {
        (try await api("get_vod_streams").array ?? []).compactMap { v in
            guard let id = v["stream_id"]?.string, let name = v["name"]?.string else { return nil }
            let parsed = StreamParser.titleAndYear(from: name)
            return VODMovie(streamID: id, name: name, tmdbID: (v["tmdb"] ?? v["tmdb_id"])?.int, year: v["year"]?.int ?? parsed.year,
                            container: v["container_extension"]?.string ?? "mp4", iconURL: v["stream_icon"]?.string.flatMap(URL.init(string:)))
        }
    }

    public func vodSeries() async throws -> [VODSeries] {
        (try await api("get_series").array ?? []).compactMap { v in
            guard let id = v["series_id"]?.string, let name = v["name"]?.string else { return nil }
            let year = v["releaseDate"]?.string.flatMap(FlowDate.parse).map { Calendar(identifier: .gregorian).component(.year, from: $0) }
            return VODSeries(seriesID: id, name: name, tmdbID: (v["tmdb"] ?? v["tmdb_id"])?.int, year: year ?? StreamParser.titleAndYear(from: name).year)
        }
    }

    public func movieURL(_ movie: VODMovie) -> URL? {
        URL(string: "\(base)/movie/\(username)/\(password)/\(movie.streamID).\(movie.container)")
    }

    public func episodeURL(seriesID: String, episode: EpisodeRef) async throws -> (URL, String)? {
        let info = try await api("get_series_info", ["series_id": seriesID])
        guard let seasons = info["episodes"]?.object else { return nil }
        for (_, list) in seasons {
            for e in list.array ?? [] {
                let season = e["season"]?.int ?? 0
                let number = e["episode_num"]?.int ?? 0
                if season == episode.season && number == episode.episode, let id = e["id"]?.string {
                    let ext = e["container_extension"]?.string ?? "mp4"
                    return URL(string: "\(base)/series/\(username)/\(password)/\(id).\(ext)").map { ($0, e["title"]?.string ?? "") }
                }
            }
        }
        return nil
    }
}

/// Exposes IPTV VOD catalogues (Xtream movies/series, M3U VOD entries) as playback sources.
public actor IPTVVODProvider: SourceProvider {
    public nonisolated let providerID: String
    public nonisolated let providerName: String
    public nonisolated let category: SourceCategory = .iptv

    private let xtream: XtreamClient?
    private let m3u: M3UProvider?
    private var movies: [XtreamClient.VODMovie]?
    private var series: [XtreamClient.VODSeries]?
    private var m3uVOD: [Channel]?

    public init(config: IPTVProviderConfig, http: HTTPClient = HTTPClient()) {
        providerID = config.id
        providerName = config.name
        xtream = config.kind == .xtream ? XtreamClient(config: config, http: http) : nil
        m3u = config.kind == .m3u ? M3UProvider(config: config, http: http) : nil
    }

    static func matches(name: String, year: Int?, tmdb: Int?, item: MediaItem) -> Bool {
        if let tmdb, let wanted = item.ids.tmdb { return tmdb == wanted }
        let parsed = StreamParser.titleAndYear(from: name)
        // Provider names often carry prefixes like "EN - " or "|UK| ".
        let cleaned = StreamParser.normalizeTitle(parsed.title.replacingOccurrences(of: #"^[a-z]{2,3} "#, with: "", options: .regularExpression))
        let wanted = StreamParser.normalizeTitle(item.title)
        guard cleaned == wanted || parsed.title == wanted else { return false }
        guard let y = year ?? parsed.year, let itemYear = item.year else { return true }
        return abs(y - itemYear) <= 1
    }

    public func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
        let item = request.item
        var out: [StreamSource] = []
        if let xtream {
            if let episode = request.episode {
                if series == nil { series = try await xtream.vodSeries() }
                for s in (series ?? []).filter({ Self.matches(name: $0.name, year: $0.year, tmdb: $0.tmdbID, item: item) }).prefix(3) {
                    if let (url, title) = try await xtream.episodeURL(seriesID: s.seriesID, episode: episode.ref) {
                        out.append(source(id: "\(s.seriesID)-\(episode.code)", text: "\(s.name)\n\(title)", url: url))
                    }
                }
            } else {
                if movies == nil { movies = try await xtream.vodMovies() }
                for m in (movies ?? []).filter({ Self.matches(name: $0.name, year: $0.year, tmdb: $0.tmdbID, item: item) }).prefix(5) {
                    if let url = xtream.movieURL(m) { out.append(source(id: m.streamID, text: m.name, url: url)) }
                }
            }
        } else if let m3u {
            if m3uVOD == nil { m3uVOD = try await m3u.vodEntries() }
            let candidates = (m3uVOD ?? []).filter { entry in
                if let episode = request.episode {
                    return StreamParser.episodeRef(in: entry.name) == episode.ref && Self.matches(name: entry.name.replacingOccurrences(of: #"(?i)s\d+\s?e\d+.*"#, with: "", options: .regularExpression), year: nil, tmdb: nil, item: item)
                }
                return Self.matches(name: entry.name, year: nil, tmdb: nil, item: item)
            }
            out = candidates.prefix(5).map { source(id: $0.id, text: $0.name, url: $0.streamURL) }
        }
        return out
    }

    private func source(id: String, text: String, url: URL) -> StreamSource {
        var traits = StreamParser.parse(text, url.lastPathComponent)
        traits.isCached = true
        return StreamSource(id: "\(providerID)#\(id)", category: .iptv, providerID: providerID, providerName: providerName,
                            title: text, detail: nil, filename: text, location: .url(url, headers: [:]), traits: traits)
    }
}
