import Foundation

/// Plex: plex.tv PIN linking, server discovery, library browsing and direct/HLS playback.
public struct PlexClient: MediaServerClient {
    public let config: MediaServerConfig
    let http: HTTPClient
    let clientIdentifier: String

    public init(config: MediaServerConfig, clientIdentifier: String, http: HTTPClient = HTTPClient()) {
        self.config = config
        self.clientIdentifier = clientIdentifier
        self.http = http
    }

    static func plexHeaders(clientIdentifier: String, token: String? = nil) -> [String: String] {
        var h = [
            "X-Plex-Product": "Flow",
            "X-Plex-Version": "1.0",
            "X-Plex-Client-Identifier": clientIdentifier,
            "X-Plex-Platform": "iOS",
            "X-Plex-Device-Name": "Flow",
            "Accept": "application/json",
        ]
        if let token { h["X-Plex-Token"] = token }
        return h
    }

    // MARK: Linking

    public struct Pin: Sendable { public var id: Int; public var code: String }

    /// 4-character code the user enters at plex.tv/link.
    public static func createPin(clientIdentifier: String, http: HTTPClient = HTTPClient()) async throws -> (Pin, DeviceCode) {
        struct Response: Decodable { var id: Int; var code: String; var expiresIn: Double? }
        let r = try await http.json(Response.self, HTTPRequest(.post, url: URL(string: "https://plex.tv/api/v2/pins")!, headers: plexHeaders(clientIdentifier: clientIdentifier)))
        let pin = Pin(id: r.id, code: r.code)
        return (pin, DeviceCode(deviceCode: String(r.id), userCode: r.code, verificationURL: URL(string: "https://plex.tv/link")!, expiresIn: r.expiresIn ?? 900, interval: 2))
    }

    public static func pollPin(_ pin: Pin, clientIdentifier: String, expiresIn: TimeInterval = 900, http: HTTPClient = HTTPClient()) async throws -> String {
        struct Response: Decodable { var authToken: String? }
        let deadline = Date().addingTimeInterval(expiresIn)
        while Date() < deadline {
            try Task.checkCancellation()
            let r = try await http.json(Response.self, HTTPRequest(.get, url: URL(string: "https://plex.tv/api/v2/pins/\(pin.id)")!, headers: plexHeaders(clientIdentifier: clientIdentifier)))
            if let token = r.authToken, !token.isEmpty { return token }
            try await Task.sleep(nanoseconds: 2_000_000_000)
        }
        throw FlowError.timedOut
    }

    public struct DiscoveredServer: Hashable, Sendable, Identifiable {
        public var name: String
        public var machineID: String
        public var accessToken: String
        public var connections: [Connection]
        public var id: String { machineID }
        public struct Connection: Hashable, Sendable { public var uri: URL; public var local: Bool; public var relay: Bool }

        /// Prefers a reachable local connection, then direct remote, then relay.
        public var preferredConnections: [Connection] {
            connections.sorted { a, b in
                let ra = a.local ? 0 : a.relay ? 2 : 1, rb = b.local ? 0 : b.relay ? 2 : 1
                return ra < rb
            }
        }
    }

    public static func discoverServers(userToken: String, clientIdentifier: String, http: HTTPClient = HTTPClient()) async throws -> [DiscoveredServer] {
        struct Resource: Decodable {
            var name: String; var clientIdentifier: String; var provides: String; var accessToken: String?
            var connections: [C]?
            struct C: Decodable { var uri: String; var local: Bool?; var relay: Bool? }
        }
        let resources = try await http.json([Resource].self, HTTPRequest(.get, "https://plex.tv/api/v2/resources", query: ["includeHttps": "1", "includeRelay": "1"], headers: plexHeaders(clientIdentifier: clientIdentifier, token: userToken)))
        return resources.filter { $0.provides.contains("server") }.map { r in
            DiscoveredServer(name: r.name, machineID: r.clientIdentifier, accessToken: r.accessToken ?? userToken,
                             connections: (r.connections ?? []).compactMap { c in URL(string: c.uri).map { .init(uri: $0, local: c.local ?? false, relay: c.relay ?? false) } })
        }
    }

    /// Picks the first connection that answers and returns a config for it.
    public static func config(for server: DiscoveredServer, clientIdentifier: String, http: HTTPClient = HTTPClient()) async throws -> MediaServerConfig {
        for connection in server.preferredConnections {
            let probe = HTTPRequest(.get, url: connection.uri.appendingPathComponent("identity"), headers: plexHeaders(clientIdentifier: clientIdentifier, token: server.accessToken), timeout: 5)
            if (try? await http.data(probe)) != nil {
                return MediaServerConfig(kind: .plex, name: server.name, baseURL: connection.uri, accessToken: server.accessToken, isRemote: !connection.local, machineID: server.machineID)
            }
        }
        throw FlowError.unsupported("Couldn't reach \(server.name) on any of its addresses.")
    }

    // MARK: Requests

    var token: String { config.accessToken ?? "" }

    func get(_ path: String, query: [String: String?] = [:]) async throws -> MediaContainer {
        let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }
        let r = HTTPRequest(.get, url: config.baseURL.appendingPathComponent(path), query: items, headers: Self.plexHeaders(clientIdentifier: clientIdentifier, token: token))
        struct Wrapper: Decodable { var MediaContainer: MediaContainer }
        return try await http.json(Wrapper.self, r).MediaContainer
    }

    struct MediaContainer: Decodable {
        var Metadata: [Metadata]?
        var Directory: [Directory]?
        var Hub: [Hub]?
        var size: Int?
        var totalSize: Int?
    }

    struct Hub: Decodable { var type: String?; var Metadata: [Metadata]? }
    struct Directory: Decodable { var key: String; var title: String; var type: String }

    struct Metadata: Decodable {
        var ratingKey: String
        var key: String?
        var title: String?
        var type: String?
        var year: Int?
        var summary: String?
        var thumb: String?
        var art: String?
        var index: Int?
        var parentIndex: Int?
        var viewOffset: Double?
        var duration: Double?
        var addedAt: Double?
        var Guid: [G]?
        var Media: [MediaDTO]?
        var Marker: [MarkerDTO]?
        struct G: Decodable { var id: String }
    }

    struct MediaDTO: Decodable {
        var id: Int?
        var videoResolution: String?
        var videoCodec: String?
        var audioCodec: String?
        var audioChannels: Int?
        var container: String?
        var Part: [PartDTO]?
    }

    struct PartDTO: Decodable { var key: String; var size: Int64?; var file: String?; var container: String? }
    struct MarkerDTO: Decodable { var type: String; var startTimeOffset: Double; var endTimeOffset: Double }

    func ids(_ m: Metadata) -> ExternalIDs {
        var ids = ExternalIDs()
        for g in m.Guid ?? [] {
            if g.id.hasPrefix("tmdb://") { ids.tmdb = Int(g.id.dropFirst(7)) }
            else if g.id.hasPrefix("imdb://") { ids.imdb = String(g.id.dropFirst(7)) }
            else if g.id.hasPrefix("tvdb://") { ids.tvdb = Int(g.id.dropFirst(7)) }
        }
        return ids
    }

    func imageURL(_ path: String?, width: Int, height: Int) -> URL? {
        guard let path else { return nil }
        var c = URLComponents(url: config.baseURL.appendingPathComponent("photo/:/transcode"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "width", value: String(width)), URLQueryItem(name: "height", value: String(height)),
                        URLQueryItem(name: "minSize", value: "1"), URLQueryItem(name: "url", value: path), URLQueryItem(name: "X-Plex-Token", value: token)]
        return c.url
    }

    func serverItem(_ m: Metadata) -> MediaServerItem? {
        let type: MediaType
        switch m.type {
        case "movie": type = .movie
        case "show": type = .show
        default: return nil
        }
        return MediaServerItem(serverID: config.id, itemID: m.ratingKey, type: type, title: m.title ?? "", year: m.year, ids: ids(m),
                               posterURL: imageURL(m.thumb, width: 500, height: 750), backdropURL: imageURL(m.art, width: 1280, height: 720),
                               overview: m.summary, addedAt: m.addedAt.map { Date(timeIntervalSince1970: $0) })
    }

    // MARK: MediaServerClient

    public func libraries() async throws -> [MediaLibrary] {
        let c = try await get("library/sections")
        return (c.Directory ?? []).compactMap { d in
            switch d.type {
            case "movie": return MediaLibrary(id: d.key, name: d.title, type: .movie)
            case "show": return MediaLibrary(id: d.key, name: d.title, type: .show)
            default: return nil
            }
        }
    }

    public func catalogue() async throws -> [MediaServerItem] {
        var all: [MediaServerItem] = []
        for library in try await libraries() {
            let c = try await get("library/sections/\(library.id)/all", query: ["includeGuids": "1"])
            all += (c.Metadata ?? []).compactMap(serverItem)
        }
        return all
    }

    public func items(inLibrary id: String, limit: Int) async throws -> [MediaServerItem] {
        let c = try await get("library/sections/\(id)/all", query: ["includeGuids": "1", "sort": "addedAt:desc", "X-Plex-Container-Start": "0", "X-Plex-Container-Size": String(limit)])
        return (c.Metadata ?? []).compactMap(serverItem)
    }

    public func recentlyAdded(limit: Int) async throws -> [MediaServerItem] {
        let c = try await get("library/recentlyAdded", query: ["includeGuids": "1", "X-Plex-Container-Start": "0", "X-Plex-Container-Size": String(limit * 2)])
        // Episodes/seasons come back too; keep movies and shows.
        return Array((c.Metadata ?? []).compactMap(serverItem).prefix(limit))
    }

    public func search(_ text: String) async throws -> [MediaServerItem] {
        let c = try await get("hubs/search", query: ["query": text, "limit": "30", "includeGuids": "1"])
        return (c.Hub ?? []).flatMap { $0.Metadata ?? [] }.compactMap(serverItem)
    }

    public func favourites() async throws -> [MediaServerItem] { [] }

    public func setFavourite(itemID: String, _ favourite: Bool) async throws {
        throw FlowError.unsupported("Plex doesn't support favourites. Choose another destination in Settings → Account.")
    }

    public func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
        let type = request.item.type == .movie ? "1" : "2"
        var candidates: [Metadata] = []
        if let tmdb = request.item.ids.tmdb {
            let c = try? await get("library/all", query: ["guid": "tmdb://\(tmdb)", "type": type, "includeGuids": "1"])
            candidates = c?.Metadata ?? []
        }
        if candidates.isEmpty {
            let c = try await get("library/search", query: ["query": request.item.title, "searchTypes": request.item.type == .movie ? "movies" : "tv", "includeGuids": "1"])
            candidates = (c.Metadata ?? []).filter { $0.type == (request.item.type == .movie ? "movie" : "show") }
        }
        let items = candidates.compactMap(serverItem)
        guard let match = ServerMatching.best(items, for: request.item) else { return [] }
        var ratingKey = match.itemID
        if let episode = request.episode {
            let leaves = try await get("library/metadata/\(ratingKey)/allLeaves")
            guard let ep = leaves.Metadata?.first(where: { $0.parentIndex == episode.season && $0.index == episode.number }) else { return [] }
            ratingKey = ep.ratingKey
        }
        guard let full = try await get("library/metadata/\(ratingKey)", query: ["includeMarkers": "1"]).Metadata?.first else { return [] }
        let segments: [SkipSegment] = (full.Marker ?? []).compactMap { m in
            let kind: SkipSegmentKind? = m.type == "intro" ? .intro : m.type == "credits" ? .credits : nil
            return kind.map { SkipSegment(kind: $0, start: m.startTimeOffset / 1000, end: m.endTimeOffset / 1000) }
        }
        return (full.Media ?? []).enumerated().compactMap { index, media in
            guard let part = media.Part?.first else { return nil }
            let filename = part.file.map { ($0 as NSString).lastPathComponent }
            var traits = StreamParser.parse(filename ?? "")
            if let r = media.videoResolution?.lowercased() {
                traits.resolution = r == "4k" ? .uhd4k : r == "1080" ? .hd1080 : r == "720" ? .hd720 : (Int(r) ?? 0) > 0 ? .sd : traits.resolution
            }
            if let v = media.videoCodec?.lowercased() { traits.videoCodec = v == "hevc" ? "HEVC" : v == "h264" ? "H264" : v.uppercased() }
            if let a = media.audioCodec?.lowercased() { traits.audioCodec = ["eac3": "DD+", "ac3": "DD", "truehd": "TrueHD", "dca": "DTS", "aac": "AAC"][a] ?? a.uppercased() }
            if let ch = media.audioChannels { traits.audioChannels = ch >= 8 ? "7.1" : ch >= 6 ? "5.1" : "2.0" }
            traits.sizeBytes = part.size
            traits.isCached = true
            let container = (part.container ?? media.container ?? "").lowercased()
            let url: URL
            if ["mp4", "mov", "m4v"].contains(container) {
                var c = URLComponents(url: config.baseURL.appendingPathComponent(part.key), resolvingAgainstBaseURL: false)!
                c.queryItems = [URLQueryItem(name: "X-Plex-Token", value: token)]
                url = c.url!
            } else {
                var c = URLComponents(url: config.baseURL.appendingPathComponent("video/:/transcode/universal/start.m3u8"), resolvingAgainstBaseURL: false)!
                c.queryItems = [
                    URLQueryItem(name: "path", value: "/library/metadata/\(ratingKey)"), URLQueryItem(name: "mediaIndex", value: String(index)),
                    URLQueryItem(name: "partIndex", value: "0"), URLQueryItem(name: "protocol", value: "hls"),
                    URLQueryItem(name: "directPlay", value: "0"), URLQueryItem(name: "directStream", value: "1"), URLQueryItem(name: "directStreamAudio", value: "1"),
                    URLQueryItem(name: "fastSeek", value: "1"), URLQueryItem(name: "session", value: UUID().uuidString),
                    URLQueryItem(name: "X-Plex-Client-Identifier", value: clientIdentifier), URLQueryItem(name: "X-Plex-Platform", value: "iOS"),
                    URLQueryItem(name: "X-Plex-Product", value: "Flow"), URLQueryItem(name: "X-Plex-Token", value: token),
                ]
                url = c.url!
            }
            return StreamSource(
                id: "\(config.id)#\(ratingKey)#\(media.id ?? index)",
                category: .mediaServers,
                providerID: config.id,
                providerName: config.name,
                title: [filename, traits.badges.joined(separator: " · ")].compactMap { $0 }.joined(separator: "\n"),
                detail: filename,
                filename: filename,
                location: .url(url, headers: [:]),
                traits: traits,
                serverResumeSeconds: full.viewOffset.map { $0 / 1000 },
                segments: segments
            )
        }
    }

    public func report(_ report: PlaybackReport) async {
        let parts = report.source.id.components(separatedBy: "#")
        guard parts.count >= 2 else { return }
        let state: String
        switch report.state {
        case .started, .progress: state = "playing"
        case .paused: state = "paused"
        case .stopped: state = "stopped"
        }
        var query: [String: String?] = [
            "ratingKey": parts[1], "key": "/library/metadata/\(parts[1])", "state": state,
            "time": String(Int(report.positionSeconds * 1000)),
        ]
        if let d = report.durationSeconds { query["duration"] = String(Int(d * 1000)) }
        _ = try? await get(":/timeline", query: query)
    }
}
