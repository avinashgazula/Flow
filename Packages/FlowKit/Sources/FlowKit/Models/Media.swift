import Foundation

/// Movie or series. Raw values match the vocabulary used by TMDb, Trakt and Stremio add-ons.
public enum MediaType: String, Codable, Hashable, Sendable, CaseIterable {
    case movie
    case show

    public var tmdbPath: String { self == .movie ? "movie" : "tv" }
    public var traktPath: String { self == .movie ? "movies" : "shows" }
    public var stremioType: String { self == .movie ? "movie" : "series" }
    public var displayName: String { self == .movie ? "Movie" : "TV Show" }

    public init?(tmdb value: String) {
        switch value {
        case "movie": self = .movie
        case "tv": self = .show
        default: return nil
        }
    }
}

/// Every identifier we may know for a title. TMDb is the canonical key inside Flow.
public struct ExternalIDs: Codable, Hashable, Sendable {
    public var tmdb: Int?
    public var imdb: String?
    public var tvdb: Int?
    public var trakt: Int?
    public var simkl: Int?
    public var traktSlug: String?

    public init(tmdb: Int? = nil, imdb: String? = nil, tvdb: Int? = nil, trakt: Int? = nil, simkl: Int? = nil, traktSlug: String? = nil) {
        self.tmdb = tmdb
        self.imdb = imdb
        self.tvdb = tvdb
        self.trakt = trakt
        self.simkl = simkl
        self.traktSlug = traktSlug
    }

    /// Fills any missing identifier from `other`.
    public func merged(with other: ExternalIDs) -> ExternalIDs {
        ExternalIDs(
            tmdb: tmdb ?? other.tmdb,
            imdb: imdb ?? other.imdb,
            tvdb: tvdb ?? other.tvdb,
            trakt: trakt ?? other.trakt,
            simkl: simkl ?? other.simkl,
            traktSlug: traktSlug ?? other.traktSlug
        )
    }
}

public struct Genre: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public init(id: Int, name: String) { self.id = id; self.name = name }
}

/// Stable key for a title across services: "movie:603", "show:1399".
public struct MediaKey: Codable, Hashable, Sendable, CustomStringConvertible {
    public var type: MediaType
    public var tmdbID: Int

    public init(type: MediaType, tmdbID: Int) {
        self.type = type
        self.tmdbID = tmdbID
    }

    public init?(string: String) {
        let parts = string.split(separator: ":")
        guard parts.count == 2, let type = MediaType(rawValue: String(parts[0])), let id = Int(parts[1]) else { return nil }
        self.init(type: type, tmdbID: id)
    }

    public var description: String { "\(type.rawValue):\(tmdbID)" }
}

/// A movie or show as shown on posters, shelves and the detail page.
public struct MediaItem: Codable, Hashable, Sendable, Identifiable {
    public var type: MediaType
    public var ids: ExternalIDs
    public var title: String
    public var originalTitle: String?
    public var overview: String?
    public var posterPath: String?
    public var backdropPath: String?
    public var logoPath: String?
    public var releaseDate: Date?
    public var runtimeMinutes: Int?
    public var genres: [Genre]
    public var voteAverage: Double?
    public var voteCount: Int?
    public var popularity: Double?
    public var certification: String?
    public var originalLanguage: String?
    public var status: String?
    /// Earliest date the title can be played at home (digital/physical/TV), if known.
    public var homeReleaseDate: Date?
    /// Key art without baked-in text, for heroes that overlay their own logo.
    public var textlessPosterPath: String?

    public init(
        type: MediaType,
        ids: ExternalIDs,
        title: String,
        originalTitle: String? = nil,
        overview: String? = nil,
        posterPath: String? = nil,
        backdropPath: String? = nil,
        logoPath: String? = nil,
        releaseDate: Date? = nil,
        runtimeMinutes: Int? = nil,
        genres: [Genre] = [],
        voteAverage: Double? = nil,
        voteCount: Int? = nil,
        popularity: Double? = nil,
        certification: String? = nil,
        originalLanguage: String? = nil,
        status: String? = nil,
        homeReleaseDate: Date? = nil
    ) {
        self.type = type
        self.ids = ids
        self.title = title
        self.originalTitle = originalTitle
        self.overview = overview
        self.posterPath = posterPath
        self.backdropPath = backdropPath
        self.logoPath = logoPath
        self.releaseDate = releaseDate
        self.runtimeMinutes = runtimeMinutes
        self.genres = genres
        self.voteAverage = voteAverage
        self.voteCount = voteCount
        self.popularity = popularity
        self.certification = certification
        self.originalLanguage = originalLanguage
        self.status = status
        self.homeReleaseDate = homeReleaseDate
    }

    /// The best artwork to put a logo over: textless key art when TMDb has it.
    public var heroPosterPath: String? { textlessPosterPath ?? posterPath }

    public var id: String { key?.description ?? "\(type.rawValue):\(ids.imdb ?? title)" }

    public var key: MediaKey? {
        guard let tmdb = ids.tmdb else { return nil }
        return MediaKey(type: type, tmdbID: tmdb)
    }

    public var year: Int? {
        guard let releaseDate else { return nil }
        return Calendar(identifier: .gregorian).component(.year, from: releaseDate)
    }

    public var genreLine: String { genres.prefix(2).map(\.name).joined(separator: ", ") }
}

public struct Season: Codable, Hashable, Sendable, Identifiable {
    public var number: Int
    public var name: String
    public var overview: String?
    public var posterPath: String?
    public var episodeCount: Int
    public var airDate: Date?

    public var id: Int { number }
    public var isSpecials: Bool { number == 0 }

    public init(number: Int, name: String, overview: String? = nil, posterPath: String? = nil, episodeCount: Int = 0, airDate: Date? = nil) {
        self.number = number
        self.name = name
        self.overview = overview
        self.posterPath = posterPath
        self.episodeCount = episodeCount
        self.airDate = airDate
    }
}

public struct Episode: Codable, Hashable, Sendable, Identifiable {
    public var showTMDB: Int
    public var season: Int
    public var number: Int
    public var title: String
    public var overview: String?
    public var stillPath: String?
    public var airDate: Date?
    public var runtimeMinutes: Int?
    public var voteAverage: Double?
    public var ids: ExternalIDs
    /// Absolute number for anime orderings when the episode source supplies it.
    public var absoluteNumber: Int?

    public init(showTMDB: Int, season: Int, number: Int, title: String, overview: String? = nil, stillPath: String? = nil, airDate: Date? = nil, runtimeMinutes: Int? = nil, voteAverage: Double? = nil, ids: ExternalIDs = ExternalIDs(), absoluteNumber: Int? = nil) {
        self.showTMDB = showTMDB
        self.season = season
        self.number = number
        self.title = title
        self.overview = overview
        self.stillPath = stillPath
        self.airDate = airDate
        self.runtimeMinutes = runtimeMinutes
        self.voteAverage = voteAverage
        self.ids = ids
        self.absoluteNumber = absoluteNumber
    }

    public var id: String { "\(showTMDB):\(season):\(number)" }
    public var code: String { EpisodeRef(season: season, episode: number).code }
    public var ref: EpisodeRef { EpisodeRef(season: season, episode: number) }
}

/// Season/episode pair. Ordered by season then episode.
public struct EpisodeRef: Codable, Hashable, Sendable, Comparable {
    public var season: Int
    public var episode: Int

    public init(season: Int, episode: Int) {
        self.season = season
        self.episode = episode
    }

    public var code: String { String(format: "S%02dE%02d", season, episode) }

    public static func < (lhs: EpisodeRef, rhs: EpisodeRef) -> Bool {
        (lhs.season, lhs.episode) < (rhs.season, rhs.episode)
    }
}

public struct CastMember: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var role: String
    public var profilePath: String?
    public var order: Int

    public init(id: Int, name: String, role: String, profilePath: String? = nil, order: Int = 0) {
        self.id = id
        self.name = name
        self.role = role
        self.profilePath = profilePath
        self.order = order
    }
}

public struct Person: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var biography: String?
    public var profilePath: String?
    public var knownFor: String?
    public var birthday: Date?
    public var deathday: Date?
    public var placeOfBirth: String?
    public var credits: [MediaItem]

    public init(id: Int, name: String, biography: String? = nil, profilePath: String? = nil, knownFor: String? = nil, birthday: Date? = nil, deathday: Date? = nil, placeOfBirth: String? = nil, credits: [MediaItem] = []) {
        self.id = id
        self.name = name
        self.biography = biography
        self.profilePath = profilePath
        self.knownFor = knownFor
        self.birthday = birthday
        self.deathday = deathday
        self.placeOfBirth = placeOfBirth
        self.credits = credits
    }
}

public struct Video: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var key: String
    public var site: String
    public var type: String
    public var official: Bool

    public init(id: String, name: String, key: String, site: String, type: String, official: Bool) {
        self.id = id
        self.name = name
        self.key = key
        self.site = site
        self.type = type
        self.official = official
    }

    public var youtubeURL: URL? {
        site.lowercased() == "youtube" ? URL(string: "https://www.youtube.com/watch?v=\(key)") : nil
    }

    public var thumbnailURL: URL? {
        site.lowercased() == "youtube" ? URL(string: "https://img.youtube.com/vi/\(key)/hqdefault.jpg") : nil
    }
}

/// Everything the detail page needs.
public struct MediaDetail: Codable, Hashable, Sendable {
    public var item: MediaItem
    public var tagline: String?
    public var cast: [CastMember]
    public var crew: [CastMember]
    public var videos: [Video]
    public var seasons: [Season]
    public var recommendations: [MediaItem]
    public var similar: [MediaItem]
    public var collection: MediaCollection?
    public var networks: [String]
    public var numberOfSeasons: Int?
    public var nextEpisode: Episode?
    public var lastEpisode: Episode?
    /// Streaming, rental and purchase options in the viewer's region.
    public var availability: Availability?

    public init(item: MediaItem, tagline: String? = nil, cast: [CastMember] = [], crew: [CastMember] = [], videos: [Video] = [], seasons: [Season] = [], recommendations: [MediaItem] = [], similar: [MediaItem] = [], collection: MediaCollection? = nil, networks: [String] = [], numberOfSeasons: Int? = nil, nextEpisode: Episode? = nil, lastEpisode: Episode? = nil, availability: Availability? = nil) {
        self.item = item
        self.tagline = tagline
        self.cast = cast
        self.crew = crew
        self.videos = videos
        self.seasons = seasons
        self.recommendations = recommendations
        self.similar = similar
        self.collection = collection
        self.networks = networks
        self.numberOfSeasons = numberOfSeasons
        self.nextEpisode = nextEpisode
        self.lastEpisode = lastEpisode
        self.availability = availability
    }

    /// Director(s) first, then top-billed cast — the order shown in the Cast row.
    public var castRow: [CastMember] {
        let directors = crew.filter { $0.role.localizedCaseInsensitiveContains("Director") && !$0.role.localizedCaseInsensitiveContains("Photography") }
        var seen = Set<Int>()
        return (directors + cast.sorted { $0.order < $1.order }).filter { seen.insert($0.id).inserted }
    }

    public var trailers: [Video] {
        let youtube = videos.filter { $0.site.lowercased() == "youtube" }
        let ranked = youtube.sorted { a, b in
            let rank: (Video) -> Int = { v in
                (v.type == "Trailer" ? 0 : v.type == "Teaser" ? 1 : 2) * 2 + (v.official ? 0 : 1)
            }
            return rank(a) < rank(b)
        }
        return ranked
    }
}

public struct MediaCollection: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var posterPath: String?
    public var backdropPath: String?
    public var parts: [MediaItem]

    public init(id: Int, name: String, posterPath: String? = nil, backdropPath: String? = nil, parts: [MediaItem] = []) {
        self.id = id
        self.name = name
        self.posterPath = posterPath
        self.backdropPath = backdropPath
        self.parts = parts
    }
}

/// A page of results from any paginated catalogue.
public struct Page<Element: Sendable>: Sendable {
    public var items: [Element]
    public var page: Int
    public var totalPages: Int

    public init(items: [Element], page: Int, totalPages: Int) {
        self.items = items
        self.page = page
        self.totalPages = totalPages
    }

    public var hasMore: Bool { page < totalPages }
}

public enum SearchResult: Hashable, Sendable, Identifiable {
    case media(MediaItem)
    case person(Person)

    public var id: String {
        switch self {
        case .media(let item): return item.id
        case .person(let person): return "person:\(person.id)"
        }
    }
}
