import Foundation

public enum TMDBImageSize: Sendable {
    case posterSmall, poster, posterLarge, backdrop, backdropLarge, logo, profile, still, original

    public var rawValue: String {
        switch self {
        case .posterSmall, .profile: return "w185"
        case .poster: return "w342"
        case .posterLarge, .logo: return "w500"
        case .backdrop: return "w780"
        case .backdropLarge: return "w1280"
        case .still: return "w300"
        case .original: return "original"
        }
    }
}

public enum TMDBImage {
    public static func url(_ path: String?, size: TMDBImageSize) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: "https://image.tmdb.org/t/p/\(size.rawValue)\(path)")
    }
}

public enum TimeWindow: String, Sendable { case day, week }

public enum TMDBList: String, Sendable {
    case popular, topRated = "top_rated", nowPlaying = "now_playing", upcoming
    case airingToday = "airing_today", onTheAir = "on_the_air"
}

/// TMDb v3 client. Accepts either a v3 API key or a v4 read-access token.
public struct TMDBClient: Sendable {
    public var credential: String
    public var language: String
    public var region: String
    public var includeAdult: Bool
    let http: HTTPClient
    let base = "https://api.themoviedb.org/3"

    public init(credential: String, language: String = "en-US", region: String = "US", includeAdult: Bool = false, http: HTTPClient = HTTPClient()) {
        self.credential = credential
        self.language = language
        self.region = region
        self.includeAdult = includeAdult
        self.http = http
    }

    /// v4 read-access tokens are JWTs; v3 keys are 32 hex characters.
    var usesBearer: Bool { credential.count > 40 }

    func request(_ path: String, _ query: [String: String?] = [:]) throws -> HTTPRequest {
        var q = query
        q["language"] = q["language"] ?? language
        var headers: [String: String] = [:]
        if usesBearer { headers["Authorization"] = "Bearer \(credential)" } else { q["api_key"] = credential }
        return try HTTPRequest(.get, base + path, query: q, headers: headers)
    }

    func get<T: Decodable>(_ type: T.Type, _ path: String, _ query: [String: String?] = [:]) async throws -> T {
        guard !credential.isEmpty else { throw FlowError.missingCredential("TMDb API key") }
        return try await http.json(T.self, request(path, query))
    }

    // MARK: Catalogues

    public func trending(_ type: MediaType?, window: TimeWindow = .week, page: Int = 1) async throws -> Page<MediaItem> {
        let path = "/trending/\(type?.tmdbPath ?? "all")/\(window.rawValue)"
        let dto = try await get(TMDBPageDTO.self, path, ["page": String(page)])
        return dto.page(defaultType: type)
    }

    public func list(_ list: TMDBList, type: MediaType, page: Int = 1) async throws -> Page<MediaItem> {
        let dto = try await get(TMDBPageDTO.self, "/\(type.tmdbPath)/\(list.rawValue)", ["page": String(page), "region": region])
        return dto.page(defaultType: type)
    }

    public func discover(_ query: DiscoverQuery, page: Int = 1, now: Date = Date()) async throws -> Page<MediaItem> {
        let dto = try await get(TMDBPageDTO.self, "/discover/\(query.type.tmdbPath)", discoverParameters(query, page: page, now: now))
        return dto.page(defaultType: query.type)
    }

    public func discoverParameters(_ query: DiscoverQuery, page: Int, now: Date = Date()) -> [String: String?] {
        let isMovie = query.type == .movie
        var p: [String: String?] = [
            "page": String(page),
            "sort_by": query.sort.value(for: query.type),
            "include_adult": includeAdult ? "true" : "false",
        ]
        if !query.genres.isEmpty { p["with_genres"] = query.genres.map(String.init).joined(separator: ",") }
        if !query.excludedGenres.isEmpty { p["without_genres"] = query.excludedGenres.map(String.init).joined(separator: ",") }
        let gte = isMovie ? "primary_release_date.gte" : "first_air_date.gte"
        let lte = isMovie ? "primary_release_date.lte" : "first_air_date.lte"
        if let from = query.yearFrom { p[gte] = "\(from)-01-01" }
        if let to = query.yearTo { p[lte] = "\(to)-12-31" }
        if let days = query.releasedFromDays { p[gte] = FlowDate.day(now.addingTimeInterval(Double(days) * 86400)) }
        if let days = query.releasedToDays { p[lte] = FlowDate.day(now.addingTimeInterval(Double(days) * 86400)) }
        if let minRating = query.minRating { p["vote_average.gte"] = String(minRating) }
        if let minVotes = query.minVotes { p["vote_count.gte"] = String(minVotes) }
        else if query.sort == .rating { p["vote_count.gte"] = "200" }
        if let lang = query.originalLanguage { p["with_original_language"] = lang }
        if !query.watchProviders.isEmpty {
            p["with_watch_providers"] = query.watchProviders.map(String.init).joined(separator: "|")
            p["watch_region"] = query.watchRegion ?? region
        }
        return p
    }

    // MARK: Search

    public func search(_ text: String, page: Int = 1) async throws -> (results: [SearchResult], totalPages: Int) {
        let dto = try await get(TMDBPageDTO.self, "/search/multi", ["query": text, "page": String(page), "include_adult": includeAdult ? "true" : "false"])
        let results: [SearchResult] = dto.results.compactMap { r in
            if r.mediaType == "person" { return .person(r.person) }
            return r.mediaItem(defaultType: nil).map(SearchResult.media)
        }
        return (results, dto.totalPages ?? 1)
    }

    public func search(_ text: String, type: MediaType, year: Int? = nil) async throws -> [MediaItem] {
        var q: [String: String?] = ["query": text]
        if let year { q[type == .movie ? "year" : "first_air_date_year"] = String(year) }
        let dto = try await get(TMDBPageDTO.self, "/search/\(type.tmdbPath)", q)
        return dto.page(defaultType: type).items
    }

    // MARK: Details

    public func details(_ type: MediaType, id: Int) async throws -> MediaDetail {
        let append = type == .movie
            ? "credits,videos,recommendations,similar,release_dates,external_ids,images,watch/providers"
            : "aggregate_credits,credits,videos,recommendations,similar,content_ratings,external_ids,images,watch/providers"
        let lang = String(language.prefix(2))
        let dto = try await get(TMDBDetailDTO.self, "/\(type.tmdbPath)/\(id)", [
            "append_to_response": append,
            "include_image_language": "\(lang),en,null",
        ])
        return dto.detail(type: type, region: region, language: lang)
    }

    /// Lightweight item lookup (no appended responses) used to hydrate tracker lists.
    public func item(_ type: MediaType, id: Int) async throws -> MediaItem {
        let dto = try await get(TMDBDetailDTO.self, "/\(type.tmdbPath)/\(id)", ["append_to_response": "external_ids"])
        return dto.detail(type: type, region: region, language: String(language.prefix(2))).item
    }

    public func season(showID: Int, season: Int) async throws -> [Episode] {
        let dto = try await get(TMDBSeasonDTO.self, "/tv/\(showID)/season/\(season)")
        return dto.episodes.map { $0.episode(showID: showID) }
    }

    public func person(_ id: Int) async throws -> Person {
        let dto = try await get(TMDBPersonDTO.self, "/person/\(id)", ["append_to_response": "combined_credits"])
        return dto.person
    }

    public func collection(_ id: Int) async throws -> MediaCollection {
        let dto = try await get(TMDBCollectionDTO.self, "/collection/\(id)")
        return MediaCollection(id: dto.id, name: dto.name, posterPath: dto.posterPath, backdropPath: dto.backdropPath,
                               parts: dto.parts.compactMap { $0.mediaItem(defaultType: .movie) }.sorted { ($0.releaseDate ?? .distantFuture) < ($1.releaseDate ?? .distantFuture) })
    }

    public func genres(_ type: MediaType) async throws -> [Genre] {
        struct DTO: Decodable { var genres: [Genre] }
        return try await get(DTO.self, "/genre/\(type.tmdbPath)/list").genres
    }

    public func logoPath(_ type: MediaType, id: Int) async throws -> String? {
        let lang = String(language.prefix(2))
        let dto = try await get(TMDBImagesDTO.self, "/\(type.tmdbPath)/\(id)/images", ["include_image_language": "\(lang),en,null", "language": nil])
        return TMDBImagesDTO.bestLogo(dto.logos ?? [], language: lang)
    }

    /// Resolves an IMDb/TVDB id to TMDb.
    public func find(imdb: String) async throws -> MediaItem? {
        let dto = try await get(TMDBFindDTO.self, "/find/\(imdb)", ["external_source": "imdb_id"])
        return dto.movieResults.first?.mediaItem(defaultType: .movie) ?? dto.tvResults.first?.mediaItem(defaultType: .show)
    }

    public func find(tvdb: Int) async throws -> MediaItem? {
        let dto = try await get(TMDBFindDTO.self, "/find/\(tvdb)", ["external_source": "tvdb_id"])
        return dto.tvResults.first?.mediaItem(defaultType: .show)
    }

    public func externalIDs(_ type: MediaType, id: Int) async throws -> ExternalIDs {
        let dto = try await get(TMDBDetailDTO.ExternalIDsDTO.self, "/\(type.tmdbPath)/\(id)/external_ids")
        return ExternalIDs(tmdb: id, imdb: dto.imdbId, tvdb: dto.tvdbId)
    }

    /// Release dates per country for a movie; used by the unreleased-title filter.
    public func releaseDates(movieID: Int) async throws -> [MovieRelease] {
        let dto = try await get(TMDBReleaseDatesDTO.self, "/movie/\(movieID)/release_dates", ["language": nil])
        return dto.results.flatMap { country in
            country.releaseDates.compactMap { rd in
                rd.releaseDate.map { MovieRelease(country: country.iso31661, type: MovieReleaseType(rawValue: rd.type) ?? .theatrical, date: $0, certification: rd.certification) }
            }
        }
    }

    public func watchProviders(_ type: MediaType) async throws -> [WatchProvider] {
        struct DTO: Decodable { var results: [WatchProvider] }
        return try await get(DTO.self, "/watch/providers/\(type.tmdbPath)", ["watch_region": region]).results
            .sorted { ($0.displayPriority ?? 999) < ($1.displayPriority ?? 999) }
    }
}

public enum MovieReleaseType: Int, Codable, Sendable {
    case premiere = 1, theatricalLimited = 2, theatrical = 3, digital = 4, physical = 5, tv = 6
    public var isHome: Bool { self == .digital || self == .physical || self == .tv }
}

public struct MovieRelease: Codable, Hashable, Sendable {
    public var country: String
    public var type: MovieReleaseType
    public var date: Date
    public var certification: String?
}

public struct WatchProvider: Codable, Hashable, Sendable, Identifiable {
    public var providerId: Int
    public var providerName: String
    public var logoPath: String?
    public var displayPriority: Int?
    public var id: Int { providerId }

    enum CodingKeys: String, CodingKey {
        case providerId = "provider_id", providerName = "provider_name", logoPath = "logo_path", displayPriority = "display_priority"
    }
}

/// Where a title can be watched in one country (TMDb's JustWatch data).
public struct Availability: Codable, Hashable, Sendable {
    public var link: URL?
    public var stream: [WatchProvider]
    public var free: [WatchProvider]
    public var rent: [WatchProvider]
    public var buy: [WatchProvider]

    public init(link: URL? = nil, stream: [WatchProvider] = [], free: [WatchProvider] = [], rent: [WatchProvider] = [], buy: [WatchProvider] = []) {
        self.link = link
        self.stream = stream
        self.free = free
        self.rent = rent
        self.buy = buy
    }

    public var isEmpty: Bool { stream.isEmpty && free.isEmpty && rent.isEmpty && buy.isEmpty }

    /// One entry per service, best offer first: included with a subscription, then free, then rent, then buy.
    public var offers: [(provider: WatchProvider, kind: Kind)] {
        var seen = Set<Int>()
        let all = stream.map { ($0, Kind.stream) } + free.map { ($0, Kind.free) } + rent.map { ($0, Kind.rent) } + buy.map { ($0, Kind.buy) }
        return all.filter { seen.insert($0.0.providerId).inserted }.map { (provider: $0.0, kind: $0.1) }
    }

    public enum Kind: String, Codable, Sendable {
        case stream, free, rent, buy
        public var label: String {
            switch self {
            case .stream: return "Subscription"
            case .free: return "Free"
            case .rent: return "Rent"
            case .buy: return "Buy"
            }
        }
    }
}

struct TMDBWatchProvidersDTO: Decodable {
    struct Region: Decodable {
        var link: String?
        var flatrate: [WatchProvider]?
        var free: [WatchProvider]?
        var ads: [WatchProvider]?
        var rent: [WatchProvider]?
        var buy: [WatchProvider]?
    }
    var results: [String: Region]

    func availability(region: String) -> Availability? {
        guard let r = results[region] else { return nil }
        let sort: ([WatchProvider]?) -> [WatchProvider] = { ($0 ?? []).sorted { ($0.displayPriority ?? 999) < ($1.displayPriority ?? 999) } }
        let availability = Availability(link: r.link.flatMap(URL.init(string:)), stream: sort(r.flatrate), free: sort((r.free ?? []) + (r.ads ?? [])), rent: sort(r.rent), buy: sort(r.buy))
        return availability.isEmpty ? nil : availability
    }
}

// MARK: - DTOs

struct TMDBPageDTO: Decodable {
    var page: Int?
    var totalPages: Int?
    var results: [TMDBResultDTO]

    enum CodingKeys: String, CodingKey { case page, totalPages = "total_pages", results }

    func page(defaultType: MediaType?) -> Page<MediaItem> {
        Page(items: results.compactMap { $0.mediaItem(defaultType: defaultType) }, page: page ?? 1, totalPages: totalPages ?? 1)
    }
}

struct TMDBResultDTO: Decodable {
    var id: Int
    var mediaType: String?
    var title: String?
    var name: String?
    var originalTitle: String?
    var originalName: String?
    var overview: String?
    var posterPath: String?
    var backdropPath: String?
    var profilePath: String?
    var releaseDate: String?
    var firstAirDate: String?
    var voteAverage: Double?
    var voteCount: Int?
    var popularity: Double?
    var genreIds: [Int]?
    var originalLanguage: String?
    var knownForDepartment: String?
    var character: String?
    var job: String?

    enum CodingKeys: String, CodingKey {
        case id, title, name, overview, popularity, character, job
        case mediaType = "media_type", originalTitle = "original_title", originalName = "original_name"
        case posterPath = "poster_path", backdropPath = "backdrop_path", profilePath = "profile_path"
        case releaseDate = "release_date", firstAirDate = "first_air_date"
        case voteAverage = "vote_average", voteCount = "vote_count", genreIds = "genre_ids"
        case originalLanguage = "original_language", knownForDepartment = "known_for_department"
    }

    func mediaItem(defaultType: MediaType?) -> MediaItem? {
        let type = mediaType.flatMap(MediaType.init(tmdb:)) ?? defaultType ?? (title != nil ? .movie : (name != nil ? .show : nil))
        guard let type, let displayTitle = title ?? name else { return nil }
        return MediaItem(
            type: type,
            ids: ExternalIDs(tmdb: id),
            title: displayTitle,
            originalTitle: originalTitle ?? originalName,
            overview: overview,
            posterPath: posterPath,
            backdropPath: backdropPath,
            releaseDate: (releaseDate ?? firstAirDate).flatMap(FlowDate.parse),
            genres: (genreIds ?? []).map { Genre(id: $0, name: TMDBGenres.name(for: $0, type: type)) },
            voteAverage: voteAverage,
            voteCount: voteCount,
            popularity: popularity,
            originalLanguage: originalLanguage
        )
    }

    var person: Person {
        Person(id: id, name: name ?? title ?? "", profilePath: profilePath, knownFor: knownForDepartment)
    }
}

struct TMDBDetailDTO: Decodable {
    struct Credits: Decodable { var cast: [CastDTO]?; var crew: [CastDTO]? }
    struct CastDTO: Decodable {
        var id: Int
        var name: String
        var character: String?
        var job: String?
        var profilePath: String?
        var order: Int?
        var roles: [Role]?
        var jobs: [Job]?
        struct Role: Decodable { var character: String? }
        struct Job: Decodable { var job: String? }
        enum CodingKeys: String, CodingKey { case id, name, character, job, order, roles, jobs, profilePath = "profile_path" }
    }
    struct Videos: Decodable { var results: [VideoDTO] }
    struct VideoDTO: Decodable { var id: String; var name: String; var key: String; var site: String; var type: String; var official: Bool? }
    struct ExternalIDsDTO: Decodable {
        var imdbId: String?; var tvdbId: Int?
        enum CodingKeys: String, CodingKey { case imdbId = "imdb_id", tvdbId = "tvdb_id" }
    }
    struct SeasonDTO: Decodable {
        var seasonNumber: Int; var name: String?; var overview: String?; var posterPath: String?; var episodeCount: Int?; var airDate: String?
        enum CodingKeys: String, CodingKey { case name, overview, seasonNumber = "season_number", posterPath = "poster_path", episodeCount = "episode_count", airDate = "air_date" }
    }
    struct ContentRatings: Decodable {
        var results: [Entry]
        struct Entry: Decodable { var iso31661: String; var rating: String; enum CodingKeys: String, CodingKey { case rating, iso31661 = "iso_3166_1" } }
    }
    struct Collection: Decodable {
        var id: Int; var name: String; var posterPath: String?; var backdropPath: String?
        enum CodingKeys: String, CodingKey { case id, name, posterPath = "poster_path", backdropPath = "backdrop_path" }
    }
    struct Network: Decodable { var name: String }

    var id: Int
    var title: String?
    var name: String?
    var originalTitle: String?
    var originalName: String?
    var tagline: String?
    var overview: String?
    var posterPath: String?
    var backdropPath: String?
    var releaseDate: String?
    var firstAirDate: String?
    var runtime: Int?
    var episodeRunTime: [Int]?
    var genres: [Genre]?
    var voteAverage: Double?
    var voteCount: Int?
    var popularity: Double?
    var status: String?
    var originalLanguage: String?
    var imdbId: String?
    var credits: Credits?
    var aggregateCredits: Credits?
    var videos: Videos?
    var recommendations: TMDBPageDTO?
    var similar: TMDBPageDTO?
    var releaseDates: TMDBReleaseDatesDTO?
    var contentRatings: ContentRatings?
    var externalIds: ExternalIDsDTO?
    var images: TMDBImagesDTO?
    var seasons: [SeasonDTO]?
    var belongsToCollection: Collection?
    var networks: [Network]?
    var numberOfSeasons: Int?
    var nextEpisodeToAir: TMDBEpisodeDTO?
    var lastEpisodeToAir: TMDBEpisodeDTO?
    var watchProviders: TMDBWatchProvidersDTO?

    enum CodingKeys: String, CodingKey {
        case id, title, name, tagline, overview, runtime, genres, popularity, status, credits, videos, recommendations, similar, images, seasons, networks
        case originalTitle = "original_title", originalName = "original_name"
        case posterPath = "poster_path", backdropPath = "backdrop_path"
        case releaseDate = "release_date", firstAirDate = "first_air_date"
        case episodeRunTime = "episode_run_time", voteAverage = "vote_average", voteCount = "vote_count"
        case originalLanguage = "original_language", imdbId = "imdb_id"
        case aggregateCredits = "aggregate_credits", releaseDates = "release_dates", contentRatings = "content_ratings"
        case externalIds = "external_ids", belongsToCollection = "belongs_to_collection", numberOfSeasons = "number_of_seasons"
        case nextEpisodeToAir = "next_episode_to_air", lastEpisodeToAir = "last_episode_to_air"
        case watchProviders = "watch/providers"
    }

    func detail(type: MediaType, region: String, language: String) -> MediaDetail {
        let releases = releaseDates?.releases ?? []
        let certification: String? = {
            if type == .movie {
                let regional = releases.filter { $0.country == region }.compactMap(\.certification).first { !$0.isEmpty }
                return regional ?? releases.filter { $0.country == "US" }.compactMap(\.certification).first { !$0.isEmpty }
            }
            let ratings = contentRatings?.results ?? []
            return (ratings.first { $0.iso31661 == region } ?? ratings.first { $0.iso31661 == "US" })?.rating
        }()
        let homeRelease = releases.filter { $0.type.isHome }.map(\.date).min()
        var item = MediaItem(
            type: type,
            ids: ExternalIDs(tmdb: id, imdb: imdbId ?? externalIds?.imdbId, tvdb: externalIds?.tvdbId),
            title: title ?? name ?? "",
            originalTitle: originalTitle ?? originalName,
            overview: overview,
            posterPath: posterPath,
            backdropPath: backdropPath,
            logoPath: TMDBImagesDTO.bestLogo(images?.logos ?? [], language: language),
            releaseDate: (releaseDate ?? firstAirDate).flatMap(FlowDate.parse),
            runtimeMinutes: runtime ?? episodeRunTime?.first,
            genres: genres ?? [],
            voteAverage: voteAverage,
            voteCount: voteCount,
            popularity: popularity,
            certification: certification?.isEmpty == true ? nil : certification,
            originalLanguage: originalLanguage,
            status: status,
            homeReleaseDate: homeRelease
        )
        item.textlessPosterPath = TMDBImagesDTO.bestTextless(images?.posters ?? [])
        let creditSource = aggregateCredits ?? credits
        let cast = (creditSource?.cast ?? []).prefix(40).map {
            CastMember(id: $0.id, name: $0.name, role: $0.character ?? $0.roles?.first?.character ?? "", profilePath: $0.profilePath, order: $0.order ?? 999)
        }
        let crew = (credits?.crew ?? creditSource?.crew ?? []).filter {
            let job = $0.job ?? $0.jobs?.first?.job ?? ""
            return ["Director", "Creator", "Writer", "Screenplay", "Executive Producer"].contains(job)
        }.map { CastMember(id: $0.id, name: $0.name, role: $0.job ?? $0.jobs?.first?.job ?? "", profilePath: $0.profilePath) }
        return MediaDetail(
            item: item,
            tagline: tagline?.isEmpty == true ? nil : tagline,
            cast: Array(cast),
            crew: crew,
            videos: (videos?.results ?? []).map { Video(id: $0.id, name: $0.name, key: $0.key, site: $0.site, type: $0.type, official: $0.official ?? false) },
            seasons: (seasons ?? []).map { Season(number: $0.seasonNumber, name: $0.name ?? "Season \($0.seasonNumber)", overview: $0.overview, posterPath: $0.posterPath, episodeCount: $0.episodeCount ?? 0, airDate: $0.airDate.flatMap(FlowDate.parse)) },
            recommendations: recommendations?.page(defaultType: type).items ?? [],
            similar: similar?.page(defaultType: type).items ?? [],
            collection: belongsToCollection.map { MediaCollection(id: $0.id, name: $0.name, posterPath: $0.posterPath, backdropPath: $0.backdropPath) },
            networks: (networks ?? []).map(\.name),
            numberOfSeasons: numberOfSeasons,
            nextEpisode: nextEpisodeToAir?.episode(showID: id),
            lastEpisode: lastEpisodeToAir?.episode(showID: id),
            availability: watchProviders?.availability(region: region)
        )
    }
}

struct TMDBEpisodeDTO: Decodable {
    var id: Int?
    var name: String?
    var overview: String?
    var stillPath: String?
    var airDate: String?
    var episodeNumber: Int
    var seasonNumber: Int
    var runtime: Int?
    var voteAverage: Double?

    enum CodingKeys: String, CodingKey {
        case id, name, overview, runtime
        case stillPath = "still_path", airDate = "air_date", episodeNumber = "episode_number", seasonNumber = "season_number", voteAverage = "vote_average"
    }

    func episode(showID: Int) -> Episode {
        Episode(showTMDB: showID, season: seasonNumber, number: episodeNumber, title: name ?? "Episode \(episodeNumber)", overview: overview, stillPath: stillPath, airDate: airDate.flatMap(FlowDate.parse), runtimeMinutes: runtime, voteAverage: voteAverage, ids: ExternalIDs(tmdb: id))
    }
}

struct TMDBSeasonDTO: Decodable { var episodes: [TMDBEpisodeDTO] }

struct TMDBImagesDTO: Decodable {
    struct Image: Decodable {
        var filePath: String; var iso6391: String?; var voteAverage: Double?; var aspectRatio: Double?
        enum CodingKeys: String, CodingKey { case filePath = "file_path", iso6391 = "iso_639_1", voteAverage = "vote_average", aspectRatio = "aspect_ratio" }
    }
    var logos: [Image]?
    var backdrops: [Image]?
    var posters: [Image]?

    /// Highest-rated poster with no language, i.e. without a printed title.
    static func bestTextless(_ posters: [Image]) -> String? {
        posters.filter { $0.iso6391 == nil }.max { ($0.voteAverage ?? 0) < ($1.voteAverage ?? 0) }?.filePath
    }

    static func bestLogo(_ logos: [Image], language: String) -> String? {
        func score(_ image: Image) -> Double {
            let langScore: Double = image.iso6391 == language ? 2 : image.iso6391 == "en" ? 1 : image.iso6391 == nil ? 0.5 : 0
            return langScore * 10 + (image.voteAverage ?? 0)
        }
        return logos.filter { !$0.filePath.hasSuffix(".svg") }.max { score($0) < score($1) }?.filePath
    }
}

struct TMDBReleaseDatesDTO: Decodable {
    struct Country: Decodable {
        var iso31661: String
        var releaseDates: [Entry]
        enum CodingKeys: String, CodingKey { case iso31661 = "iso_3166_1", releaseDates = "release_dates" }
    }
    struct Entry: Decodable {
        var certification: String?
        var releaseDateString: String?
        var type: Int
        var releaseDate: Date? { releaseDateString.flatMap(FlowDate.parse) }
        enum CodingKeys: String, CodingKey { case certification, type, releaseDateString = "release_date" }
    }
    var results: [Country]

    var releases: [MovieRelease] {
        results.flatMap { c in
            c.releaseDates.compactMap { e in
                e.releaseDate.map { MovieRelease(country: c.iso31661, type: MovieReleaseType(rawValue: e.type) ?? .theatrical, date: $0, certification: e.certification) }
            }
        }
    }
}

struct TMDBPersonDTO: Decodable {
    var id: Int
    var name: String
    var biography: String?
    var profilePath: String?
    var knownForDepartment: String?
    var birthday: String?
    var deathday: String?
    var placeOfBirth: String?
    var combinedCredits: Credits?
    struct Credits: Decodable { var cast: [TMDBResultDTO]?; var crew: [TMDBResultDTO]? }

    enum CodingKeys: String, CodingKey {
        case id, name, biography, birthday, deathday
        case profilePath = "profile_path", knownForDepartment = "known_for_department", placeOfBirth = "place_of_birth", combinedCredits = "combined_credits"
    }

    var person: Person {
        var seen = Set<String>()
        let all = (combinedCredits?.cast ?? []) + (combinedCredits?.crew ?? [])
        let credits = all.compactMap { $0.mediaItem(defaultType: nil) }
            .filter { seen.insert($0.id).inserted }
            .sorted { ($0.popularity ?? 0) > ($1.popularity ?? 0) }
        return Person(id: id, name: name, biography: biography, profilePath: profilePath, knownFor: knownForDepartment,
                      birthday: birthday.flatMap(FlowDate.parse), deathday: deathday.flatMap(FlowDate.parse), placeOfBirth: placeOfBirth, credits: credits)
    }
}

struct TMDBCollectionDTO: Decodable {
    var id: Int
    var name: String
    var posterPath: String?
    var backdropPath: String?
    var parts: [TMDBResultDTO]
    enum CodingKeys: String, CodingKey { case id, name, parts, posterPath = "poster_path", backdropPath = "backdrop_path" }
}

struct TMDBFindDTO: Decodable {
    var movieResults: [TMDBResultDTO]
    var tvResults: [TMDBResultDTO]
    enum CodingKeys: String, CodingKey { case movieResults = "movie_results", tvResults = "tv_results" }
}

/// Static genre table so list results can show names without an extra request.
public enum TMDBGenres {
    public static let movie: [Int: String] = [
        28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama",
        10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
        878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
    ]
    public static let tv: [Int: String] = [
        10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama",
        10751: "Family", 10762: "Kids", 9648: "Mystery", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy",
        10766: "Soap", 10767: "Talk", 10768: "War & Politics", 37: "Western",
    ]

    public static func name(for id: Int, type: MediaType) -> String {
        (type == .movie ? movie[id] : tv[id]) ?? movie[id] ?? tv[id] ?? "Genre"
    }

    public static func all(_ type: MediaType) -> [Genre] {
        (type == .movie ? movie : tv).map { Genre(id: $0.key, name: $0.value) }.sorted { $0.name < $1.name }
    }
}
