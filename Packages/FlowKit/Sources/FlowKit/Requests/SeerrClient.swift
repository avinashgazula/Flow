import Foundation

/// Where a title stands with a Seerr instance, collapsed from Seerr's media and request states.
public enum SeerrMediaStatus: String, Codable, Hashable, Sendable {
    case notRequested, pending, processing, partiallyAvailable, available

    /// A request would still change something: nothing has been asked for, or only some seasons arrived.
    public var canRequest: Bool { self == .notRequested || self == .partiallyAvailable }
}

/// Which seasons of a show to ask for.
public enum SeerrSeasons: Hashable, Sendable {
    case all
    case only([Int])
}

/// Overseerr, Jellyseerr and Seerr share the same v1 API, authenticated with the instance's API key.
public struct SeerrClient: Sendable {
    public let config: SeerrConfig
    let http: HTTPClient

    public init(config: SeerrConfig, http: HTTPClient = HTTPClient()) {
        self.config = config
        self.http = http
    }

    public struct ServerStatus: Decodable, Hashable, Sendable {
        public var version: String
    }

    func request(_ method: HTTPMethod = .get, _ path: String) -> HTTPRequest {
        HTTPRequest(method, url: config.baseURL.appendingPathComponent("api/v1/" + path), headers: ["X-Api-Key": config.apiKey], timeout: 15)
    }

    /// Proves the address is a Seerr instance; the version is shown after connecting.
    public func status() async throws -> ServerStatus {
        try await http.json(ServerStatus.self, request(.get, "status"))
    }

    public func mediaStatus(type: MediaType, tmdbID: Int) async throws -> SeerrMediaStatus {
        struct Request: Decodable { var status: Int? }
        struct MediaInfo: Decodable { var status: Int?; var requests: [Request]? }
        struct Response: Decodable { var mediaInfo: MediaInfo? }
        do {
            let response = try await http.json(Response.self, request(.get, "\(type.tmdbPath)/\(tmdbID)"))
            return Self.status(code: response.mediaInfo?.status, requestCodes: (response.mediaInfo?.requests ?? []).compactMap(\.status))
        } catch FlowError.notFound {
            // Seerr 404s titles TMDb doesn't know; there is nothing to request either.
            return .notRequested
        }
    }

    /// `code` is Seerr's media status (1 unknown ... 5 available); request codes are 1 pending, 2 approved, 3 declined.
    static func status(code: Int?, requestCodes: [Int]) -> SeerrMediaStatus {
        switch code {
        case 5: return .available
        case 4: return .partiallyAvailable
        case 3: return .processing
        case 2: return .pending
        default:
            // A request can exist before the media row catches up; declined ones don't count.
            if requestCodes.contains(2) { return .processing }
            if requestCodes.contains(1) { return .pending }
            return .notRequested
        }
    }

    struct RequestBody: Encodable {
        var mediaType: String
        var mediaId: Int
        var seasons: SeerrSeasons?

        enum CodingKeys: String, CodingKey { case mediaType, mediaId, seasons }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(mediaType, forKey: .mediaType)
            try c.encode(mediaId, forKey: .mediaId)
            switch seasons {
            case .all?: try c.encode("all", forKey: .seasons)
            case .only(let numbers)?: try c.encode(numbers, forKey: .seasons)
            case nil: break
            }
        }
    }

    /// Movies ignore `seasons`; shows default to every season.
    public func request(type: MediaType, tmdbID: Int, seasons: SeerrSeasons = .all) async throws {
        var r = request(.post, "request")
        try r.setJSONBody(RequestBody(mediaType: type.tmdbPath, mediaId: tmdbID, seasons: type == .show ? seasons : nil))
        try await http.send(r)
    }
}
