import Foundation

/// TheTVDB v4. Used as the default episode source because its ordering matches what
/// most stream sources and media servers use (multi-part premieres, specials, anime).
public actor TVDBClient {
    private let apiKey: String
    private let http: HTTPClient
    private var token: String?
    private let base = "https://api4.thetvdb.com/v4"

    public init(apiKey: String, http: HTTPClient = HTTPClient()) {
        self.apiKey = apiKey
        self.http = http
    }

    private func authToken() async throws -> String {
        if let token { return token }
        guard !apiKey.isEmpty else { throw FlowError.missingCredential("TVDB API key") }
        struct Login: Encodable { var apikey: String }
        struct Response: Decodable { struct D: Decodable { var token: String }; var data: D }
        var request = try HTTPRequest(.post, base + "/login")
        try request.setJSONBody(Login(apikey: apiKey))
        let response = try await http.json(Response.self, request)
        token = response.data.token
        return response.data.token
    }

    private func get<T: Decodable>(_ type: T.Type, _ path: String, query: [String: String?] = [:]) async throws -> T {
        let token = try await authToken()
        do {
            return try await http.json(T.self, HTTPRequest(.get, base + path, query: query, headers: ["Authorization": "Bearer \(token)"]))
        } catch FlowError.unauthorized {
            self.token = nil
            let fresh = try await authToken()
            return try await http.json(T.self, HTTPRequest(.get, base + path, query: query, headers: ["Authorization": "Bearer \(fresh)"]))
        }
    }

    struct EpisodesResponse: Decodable {
        struct D: Decodable { var episodes: [EpisodeDTO] }
        struct Links: Decodable { var next: String? }
        var data: D
        var links: Links?
    }

    struct EpisodeDTO: Decodable {
        var id: Int
        var seasonNumber: Int?
        var number: Int?
        var absoluteNumber: Int?
        var name: String?
        var overview: String?
        var aired: String?
        var runtime: Int?
        var image: String?
    }

    /// All episodes in the default (aired) order. `language` is a 3-letter TVDB code, e.g. "eng".
    public func episodes(seriesID: Int, showTMDB: Int, language: String = "eng") async throws -> [Episode] {
        var page = 0
        var all: [EpisodeDTO] = []
        while page < 50 {
            let response = try await get(EpisodesResponse.self, "/series/\(seriesID)/episodes/default/\(language)", query: ["page": String(page)])
            all += response.data.episodes
            guard response.links?.next != nil, !response.data.episodes.isEmpty else { break }
            page += 1
        }
        return all.compactMap { dto in
            guard let season = dto.seasonNumber, let number = dto.number else { return nil }
            return Episode(
                showTMDB: showTMDB,
                season: season,
                number: number,
                title: dto.name ?? "Episode \(number)",
                overview: dto.overview,
                stillPath: dto.image,
                airDate: dto.aired.flatMap(FlowDate.parse),
                runtimeMinutes: dto.runtime,
                ids: ExternalIDs(tvdb: dto.id),
                absoluteNumber: dto.absoluteNumber
            )
        }
    }

    /// Maps ISO-639-1 codes to TVDB's ISO-639-2 codes for the languages TVDB translates most.
    public static func tvdbLanguage(from iso: String) -> String {
        let map = ["en": "eng", "es": "spa", "fr": "fra", "de": "deu", "it": "ita", "pt": "por", "ja": "jpn", "ko": "kor",
                   "zh": "zho", "ru": "rus", "nl": "nld", "sv": "swe", "da": "dan", "no": "nor", "fi": "fin", "pl": "pol",
                   "tr": "tur", "hi": "hin", "ar": "ara", "he": "heb", "cs": "ces", "hu": "hun", "el": "ell", "th": "tha"]
        return map[String(iso.prefix(2))] ?? "eng"
    }
}

/// Picks episodes from the configured episode source, falling back to TMDb when the
/// preferred source is unavailable (no key, no TVDB id, network error).
public struct EpisodeProvider: Sendable {
    public var source: EpisodeSource
    public var tmdb: TMDBClient
    public var tvdb: TVDBClient?
    public var trakt: TraktClient?

    public init(source: EpisodeSource, tmdb: TMDBClient, tvdb: TVDBClient?, trakt: TraktClient?) {
        self.source = source
        self.tmdb = tmdb
        self.tvdb = tvdb
        self.trakt = trakt
    }

    /// Episodes grouped by season number. Stills from TMDb are merged in when available,
    /// since posters and stills always come from TMDb.
    public func episodes(for show: MediaItem, seasons: [Season]) async throws -> [Int: [Episode]] {
        guard let tmdbID = show.ids.tmdb else { return [:] }
        var episodes: [Episode] = []
        switch source {
        case .tvdb:
            if let tvdb, let tvdbID = show.ids.tvdb {
                episodes = (try? await tvdb.episodes(seriesID: tvdbID, showTMDB: tmdbID, language: TVDBClient.tvdbLanguage(from: tmdb.language))) ?? []
            }
        case .trakt:
            if let trakt {
                let id = show.ids.traktSlug ?? show.ids.trakt.map(String.init) ?? show.ids.imdb
                if let id { episodes = (try? await trakt.episodes(showID: id, showTMDB: tmdbID)) ?? [] }
            }
        case .tmdb:
            break
        }
        let tmdbEpisodes = try await tmdbSeasons(tmdbID: tmdbID, seasons: seasons)
        if episodes.isEmpty { return Dictionary(grouping: tmdbEpisodes, by: \.season) }
        // Fill stills/ratings from TMDb where the numbering lines up.
        let index = Dictionary(tmdbEpisodes.map { ($0.ref, $0) }, uniquingKeysWith: { a, _ in a })
        let merged = episodes.map { episode -> Episode in
            var e = episode
            if let match = index[e.ref] {
                if e.stillPath == nil || e.stillPath?.hasPrefix("http") == true { e.stillPath = match.stillPath ?? e.stillPath }
                e.voteAverage = e.voteAverage ?? match.voteAverage
                e.ids = e.ids.merged(with: match.ids)
                e.runtimeMinutes = e.runtimeMinutes ?? match.runtimeMinutes
                if e.overview?.isEmpty ?? true { e.overview = match.overview }
            }
            return e
        }
        return Dictionary(grouping: merged, by: \.season)
    }

    private func tmdbSeasons(tmdbID: Int, seasons: [Season]) async throws -> [Episode] {
        try await withThrowingTaskGroup(of: [Episode].self) { group in
            for season in seasons {
                group.addTask { (try? await tmdb.season(showID: tmdbID, season: season.number)) ?? [] }
            }
            var all: [Episode] = []
            for try await chunk in group { all += chunk }
            return all.sorted { $0.ref < $1.ref }
        }
    }
}

public enum AirDateFormatting {
    /// Formats an air date either in the viewer's time zone or in UTC (the source's day).
    public static func string(for date: Date, localTimeZone: Bool, includeTime: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = includeTime ? .short : .none
        formatter.timeZone = localTimeZone ? .current : TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}
