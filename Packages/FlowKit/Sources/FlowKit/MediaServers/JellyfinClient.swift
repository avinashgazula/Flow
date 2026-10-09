import Foundation

/// Jellyfin and Emby share the same REST API for everything Flow uses.
public struct JellyfinClient: MediaServerClient {
    public let config: MediaServerConfig
    let http: HTTPClient
    let deviceID: String
    let deviceName: String

    static let ticksPerSecond: Double = 10_000_000

    public init(config: MediaServerConfig, deviceID: String, deviceName: String = "Flow", http: HTTPClient = HTTPClient()) {
        self.config = config
        self.deviceID = deviceID
        self.deviceName = deviceName
        self.http = http
    }

    // MARK: Auth

    static func authHeader(deviceID: String, deviceName: String, token: String?) -> String {
        var value = #"MediaBrowser Client="Flow", Device="\#(deviceName)", DeviceId="\#(deviceID)", Version="1.0""#
        if let token { value += #", Token="\#(token)""# }
        return value
    }

    public struct ServerInfo: Decodable, Sendable {
        public var ServerName: String?
        public var Version: String?
        public var Id: String?
        public var ProductName: String?
    }

    public static func publicInfo(baseURL: URL, http: HTTPClient = HTTPClient()) async throws -> ServerInfo {
        try await http.json(ServerInfo.self, HTTPRequest(.get, url: baseURL.appendingPathComponent("System/Info/Public"), timeout: 10))
    }

    /// Signs in with username/password and returns a ready-to-save config.
    public static func signIn(kind: MediaServerKind, baseURL: URL, username: String, password: String, deviceID: String, deviceName: String, http: HTTPClient = HTTPClient()) async throws -> MediaServerConfig {
        struct Body: Encodable { var Username: String; var Pw: String }
        struct Response: Decodable { struct User: Decodable { var Id: String; var Name: String }; var User: User; var AccessToken: String }
        var request = HTTPRequest(.post, url: baseURL.appendingPathComponent("Users/AuthenticateByName"),
                                  headers: ["X-Emby-Authorization": authHeader(deviceID: deviceID, deviceName: deviceName, token: nil)])
        try request.setJSONBody(Body(Username: username, Pw: password))
        let response = try await http.json(Response.self, request)
        let info = try? await publicInfo(baseURL: baseURL, http: http)
        let host = baseURL.host ?? ""
        let isLocal = host.hasPrefix("192.168.") || host.hasPrefix("10.") || host.hasSuffix(".local") || host == "localhost"
        return MediaServerConfig(kind: kind, name: info?.ServerName ?? kind.displayName, baseURL: baseURL, userID: response.User.Id,
                                 accessToken: response.AccessToken, username: response.User.Name, isRemote: !isLocal)
    }

    var token: String { config.accessToken ?? "" }
    var userID: String { config.userID ?? "" }

    func url(_ path: String) -> URL { config.baseURL.appendingPathComponent(path) }

    func request(_ method: HTTPMethod = .get, _ path: String, query: [String: String?] = [:]) -> HTTPRequest {
        let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
        return HTTPRequest(method, url: url(path), query: items, headers: [
            "X-Emby-Authorization": Self.authHeader(deviceID: deviceID, deviceName: deviceName, token: token),
            "X-Emby-Token": token,
        ])
    }

    // MARK: DTOs

    struct ItemsResponse: Decodable { var Items: [ItemDTO]; var TotalRecordCount: Int? }

    struct ItemDTO: Decodable {
        var Id: String
        var Name: String?
        var kind: String?
        var ProductionYear: Int?
        var ProviderIds: [String: String]?
        var ImageTags: [String: String]?
        var BackdropImageTags: [String]?
        var Overview: String?
        var DateCreated: String?
        var ParentIndexNumber: Int?
        var IndexNumber: Int?
        var SeriesId: String?
        var RunTimeTicks: Int64?
        var UserData: UserDataDTO?
        var MediaSources: [MediaSourceDTO]?
        var CollectionType: String?

        enum CodingKeys: String, CodingKey {
            case Id, Name, kind = "Type", ProductionYear, ProviderIds, ImageTags, BackdropImageTags, Overview, DateCreated
            case ParentIndexNumber, IndexNumber, SeriesId, RunTimeTicks, UserData, MediaSources, CollectionType
        }
    }

    struct UserDataDTO: Decodable { var PlaybackPositionTicks: Int64?; var Played: Bool?; var IsFavorite: Bool? }

    struct MediaSourceDTO: Decodable {
        var Id: String
        var Name: String?
        var Container: String?
        var Size: Int64?
        var Bitrate: Int?
        var Path: String?
        var SupportsDirectPlay: Bool?
        var SupportsDirectStream: Bool?
        var MediaStreams: [MediaStreamDTO]?
    }

    struct MediaStreamDTO: Decodable {
        var kind: String?
        var Codec: String?
        var Height: Int?
        var Width: Int?
        var DisplayTitle: String?
        var Language: String?
        var Channels: Int?
        var VideoRange: String?
        var VideoRangeType: String?
        var IsDefault: Bool?

        enum CodingKeys: String, CodingKey {
            case kind = "Type", Codec, Height, Width, DisplayTitle, Language, Channels, VideoRange, VideoRangeType, IsDefault
        }
    }

    func serverItem(_ dto: ItemDTO) -> MediaServerItem? {
        let type: MediaType
        switch dto.kind {
        case "Movie": type = .movie
        case "Series": type = .show
        default: return nil
        }
        let p = dto.ProviderIds ?? [:]
        let ids = ExternalIDs(tmdb: (p["Tmdb"] ?? p["tmdb"]).flatMap(Int.init), imdb: p["Imdb"] ?? p["imdb"], tvdb: (p["Tvdb"] ?? p["tvdb"]).flatMap(Int.init))
        return MediaServerItem(
            serverID: config.id,
            itemID: dto.Id,
            type: type,
            title: dto.Name ?? "",
            year: dto.ProductionYear,
            ids: ids,
            posterURL: dto.ImageTags?["Primary"].map { imageURL(dto.Id, kind: "Primary", tag: $0, width: 500) },
            backdropURL: dto.BackdropImageTags?.first.map { imageURL(dto.Id, kind: "Backdrop", tag: $0, width: 1280) },
            overview: dto.Overview,
            addedAt: dto.DateCreated.flatMap(FlowDate.parse),
            isFavourite: dto.UserData?.IsFavorite ?? false
        )
    }

    func imageURL(_ id: String, kind: String, tag: String, width: Int) -> URL {
        var c = URLComponents(url: url("Items/\(id)/Images/\(kind)"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "maxWidth", value: String(width)), URLQueryItem(name: "tag", value: tag), URLQueryItem(name: "quality", value: "90")]
        return c.url!
    }

    static let listFields = "ProviderIds,ProductionYear,Overview,DateCreated"

    // MARK: MediaServerClient

    public func libraries() async throws -> [MediaLibrary] {
        let r = try await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Views"))
        return r.Items.compactMap { dto in
            switch dto.CollectionType {
            case "movies": return MediaLibrary(id: dto.Id, name: dto.Name ?? "Movies", type: .movie)
            case "tvshows": return MediaLibrary(id: dto.Id, name: dto.Name ?? "Shows", type: .show)
            case nil, "mixed", "homevideos": return MediaLibrary(id: dto.Id, name: dto.Name ?? "Library", type: nil)
            default: return nil
            }
        }
    }

    public func catalogue() async throws -> [MediaServerItem] {
        var all: [MediaServerItem] = []
        var start = 0
        let pageSize = 2000
        while true {
            let r = try await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Items", query: [
                "Recursive": "true", "IncludeItemTypes": "Movie,Series", "Fields": "ProviderIds,ProductionYear",
                "StartIndex": String(start), "Limit": String(pageSize), "EnableImages": "false",
            ]))
            all += r.Items.compactMap(serverItem)
            start += r.Items.count
            if r.Items.isEmpty || start >= (r.TotalRecordCount ?? 0) { break }
        }
        return all
    }

    public func items(inLibrary id: String, limit: Int) async throws -> [MediaServerItem] {
        let r = try await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Items", query: [
            "ParentId": id, "Recursive": "true", "IncludeItemTypes": "Movie,Series", "Fields": Self.listFields,
            "SortBy": "DateCreated", "SortOrder": "Descending", "Limit": String(limit),
        ]))
        return r.Items.compactMap(serverItem)
    }

    public func recentlyAdded(limit: Int) async throws -> [MediaServerItem] {
        let r = try await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Items", query: [
            "Recursive": "true", "IncludeItemTypes": "Movie,Series", "Fields": Self.listFields,
            "SortBy": "DateCreated", "SortOrder": "Descending", "Limit": String(limit),
        ]))
        return r.Items.compactMap(serverItem)
    }

    public func search(_ text: String) async throws -> [MediaServerItem] {
        let r = try await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Items", query: [
            "Recursive": "true", "IncludeItemTypes": "Movie,Series", "Fields": Self.listFields, "SearchTerm": text, "Limit": "40",
        ]))
        return r.Items.compactMap(serverItem)
    }

    public func favourites() async throws -> [MediaServerItem] {
        let r = try await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Items", query: [
            "Recursive": "true", "IncludeItemTypes": "Movie,Series", "Fields": Self.listFields, "Filters": "IsFavorite",
        ]))
        return r.Items.compactMap(serverItem)
    }

    public func setFavourite(itemID: String, _ favourite: Bool) async throws {
        try await http.send(request(favourite ? .post : .delete, "Users/\(userID)/FavoriteItems/\(itemID)"))
    }

    /// Locates the server item for a TMDb title.
    func findItem(for item: MediaItem) async throws -> ItemDTO? {
        var query: [String: String?] = [
            "Recursive": "true", "IncludeItemTypes": item.type == .movie ? "Movie" : "Series", "Fields": "ProviderIds,ProductionYear", "Limit": "20",
        ]
        if let tmdb = item.ids.tmdb { query["AnyProviderIdEquals"] = "tmdb.\(tmdb)" }
        if let byID = try? await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Items", query: query)),
           let found = byID.Items.first(where: { serverItem($0).map { ServerMatching.best([$0], for: item) != nil } ?? false }) {
            return found
        }
        query["AnyProviderIdEquals"] = nil
        query["SearchTerm"] = item.title
        let r = try await http.json(ItemsResponse.self, request(.get, "Users/\(userID)/Items", query: query))
        let candidates = r.Items.compactMap(serverItem)
        guard let match = ServerMatching.best(candidates, for: item) else { return nil }
        return r.Items.first { $0.Id == match.itemID }
    }

    public func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
        guard let found = try await findItem(for: request.item) else { return [] }
        var targetID = found.Id
        if let episode = request.episode {
            let eps = try await http.json(ItemsResponse.self, self.request(.get, "Shows/\(found.Id)/Episodes", query: [
                "UserId": userID, "Season": String(episode.season), "Fields": "ProviderIds",
            ]))
            guard let ep = eps.Items.first(where: { $0.ParentIndexNumber == episode.season && $0.IndexNumber == episode.number }) else { return [] }
            targetID = ep.Id
        }
        let full = try await http.json(ItemDTO.self, self.request(.get, "Users/\(userID)/Items/\(targetID)"))
        let segments = await mediaSegments(targetID)
        let resume = full.UserData?.PlaybackPositionTicks.map { Double($0) / Self.ticksPerSecond }
        return (full.MediaSources ?? []).enumerated().map { index, ms in
            streamSource(itemID: targetID, mediaSource: ms, index: index, resume: resume, segments: segments)
        }
    }

    func streamSource(itemID: String, mediaSource ms: MediaSourceDTO, index: Int, resume: Double?, segments: [SkipSegment]) -> StreamSource {
        let video = ms.MediaStreams?.first { $0.kind == "Video" }
        let audio = ms.MediaStreams?.first { $0.kind == "Audio" && ($0.IsDefault ?? false) } ?? ms.MediaStreams?.first { $0.kind == "Audio" }
        var traits = StreamParser.parse(ms.Name, ms.Path.map { ($0 as NSString).lastPathComponent })
        if let h = video?.Height {
            traits.resolution = h >= 1600 ? .uhd4k : h >= 1300 ? .uhd1440 : h >= 900 ? .hd1080 : h >= 600 ? .hd720 : .sd
        }
        if let codec = video?.Codec?.lowercased() { traits.videoCodec = codec == "hevc" || codec == "h265" ? "HEVC" : codec == "h264" ? "H264" : codec.uppercased() }
        if let range = video?.VideoRangeType ?? video?.VideoRange, range != "SDR" { traits.hdr = range.contains("DOVI") ? ["DV"] : ["HDR"] }
        if let a = audio?.Codec?.lowercased() { traits.audioCodec = ["eac3": "DD+", "ac3": "DD", "truehd": "TrueHD", "dts": "DTS", "aac": "AAC", "flac": "FLAC"][a] ?? a.uppercased() }
        if let ch = audio?.Channels { traits.audioChannels = ch >= 8 ? "7.1" : ch >= 6 ? "5.1" : "2.0" }
        traits.sizeBytes = ms.Size
        traits.languages = Array(Set((ms.MediaStreams ?? []).filter { $0.kind == "Audio" }.compactMap { $0.Language.map(Self.languageName) }))
        traits.isCached = true

        let directOK = config.kind == .emby || (ms.SupportsDirectPlay ?? true)
        let container = (ms.Container ?? "mp4").components(separatedBy: ",").first ?? "mp4"
        let nativeContainers: Set<String> = ["mp4", "m4v", "mov", "m3u8", "ts"]
        let url: URL
        if directOK && nativeContainers.contains(container.lowercased()) {
            url = streamURL(itemID: itemID, path: "Videos/\(itemID)/stream.\(container)", query: ["static": "true", "MediaSourceId": ms.Id])
        } else {
            // Ask the server to remux/transcode to HLS that AVPlayer can always play.
            url = streamURL(itemID: itemID, path: "Videos/\(itemID)/master.m3u8", query: [
                "MediaSourceId": ms.Id, "VideoCodec": "hevc,h264", "AudioCodec": "aac,ac3,eac3", "TranscodingContainer": "ts",
                "SegmentContainer": "mp4", "BreakOnNonKeyFrames": "true", "PlaySessionId": UUID().uuidString, "DeviceId": deviceID,
                "MaxStreamingBitrate": "140000000", "AllowVideoStreamCopy": "true", "AllowAudioStreamCopy": "true",
            ])
        }
        let label = [ms.Name, video?.DisplayTitle, audio?.DisplayTitle].compactMap { $0 }.joined(separator: "\n")
        return StreamSource(
            id: "\(config.id)#\(itemID)#\(ms.Id)",
            category: .mediaServers,
            providerID: config.id,
            providerName: config.name,
            title: label.isEmpty ? config.name : label,
            detail: ms.Path.map { ($0 as NSString).lastPathComponent },
            filename: ms.Path.map { ($0 as NSString).lastPathComponent },
            location: .url(url, headers: [:]),
            traits: traits,
            serverResumeSeconds: (resume ?? 0) > 0 ? resume : nil,
            segments: segments,
            bingeGroup: "\(config.id)-\(index)"
        )
    }

    func streamURL(itemID: String, path: String, query: [String: String]) -> URL {
        var c = URLComponents(url: url(path), resolvingAgainstBaseURL: false)!
        c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }.sorted { $0.name < $1.name } + [URLQueryItem(name: "api_key", value: token)]
        return c.url!
    }

    /// Jellyfin 10.10+ media segments (intro, outro, recap, preview, commercial).
    func mediaSegments(_ itemID: String) async -> [SkipSegment] {
        struct Response: Decodable { var Items: [Seg]; struct Seg: Decodable { var kind: String; var StartTicks: Int64; var EndTicks: Int64; enum CodingKeys: String, CodingKey { case kind = "Type", StartTicks, EndTicks } } }
        guard config.kind == .jellyfin, let r = try? await http.json(Response.self, request(.get, "MediaSegments/\(itemID)")) else { return [] }
        return r.Items.compactMap { seg in
            let kind: SkipSegmentKind?
            switch seg.kind {
            case "Intro": kind = .intro
            case "Outro": kind = .credits
            case "Recap": kind = .recap
            case "Preview": kind = .preview
            case "Commercial": kind = .commercial
            default: kind = nil
            }
            return kind.map { SkipSegment(kind: $0, start: Double(seg.StartTicks) / Self.ticksPerSecond, end: Double(seg.EndTicks) / Self.ticksPerSecond) }
        }
    }

    public func report(_ report: PlaybackReport) async {
        let parts = report.source.id.components(separatedBy: "#")
        guard parts.count == 3 else { return }
        struct Body: Encodable { var ItemId: String; var MediaSourceId: String; var PositionTicks: Int64; var PlaySessionId: String; var IsPaused: Bool; var CanSeek = true }
        let path: String
        switch report.state {
        case .started: path = "Sessions/Playing"
        case .progress, .paused: path = "Sessions/Playing/Progress"
        case .stopped: path = "Sessions/Playing/Stopped"
        }
        var r = request(.post, path)
        try? r.setJSONBody(Body(ItemId: parts[1], MediaSourceId: parts[2], PositionTicks: Int64(report.positionSeconds * Self.ticksPerSecond), PlaySessionId: report.sessionID, IsPaused: report.state == .paused))
        _ = try? await http.data(r)
    }

    static func languageName(_ code: String) -> String {
        Locale(identifier: "en").localizedString(forLanguageCode: code) ?? code
    }
}
