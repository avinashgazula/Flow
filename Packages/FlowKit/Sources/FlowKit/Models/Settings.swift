import Foundation

// MARK: - Root

/// Every user-facing setting. Persisted as JSON; unknown/missing keys fall back to defaults
/// (see `SettingsCodec`) so old exports keep importing after new settings ship.
public struct AppSettings: Codable, Hashable, Sendable {
    public var general = GeneralSettings()
    public var account = AccountSettings()
    public var shelves: [ShelfConfig] = ShelfConfig.defaults
    public var mediaServers = MediaServerSettings()
    public var webDAV: [WebDAVConfig] = []
    public var liveTV = LiveTVSettings()
    public var sources = SourceSettings()
    public var playback = PlaybackSettings()
    public var subtitles = SubtitleSettings()
    public var metadata = MetadataSettings()
    public var sync = SyncSettings()
    public var sports = SportsSettings()
    public var downloads = DownloadSettings()

    public init() {}

    /// Settings saved before a setting changed shape, brought up to date. Run after decoding.
    public func migrated() -> AppSettings {
        var copy = self
        copy.subtitles.migrateLegacy()
        copy.account.migrateSkipBaseURLs()
        return copy
    }
}

// MARK: - General

public enum AppTab: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case home, explore, library, liveTV, search
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .home: return "Home"
        case .explore: return "Explore"
        case .library: return "Library"
        case .liveTV: return "Live TV"
        case .search: return "Search"
        }
    }

    public var systemImage: String {
        switch self {
        case .home: return "house.fill"
        case .explore: return "square.grid.2x2.fill"
        case .library: return "books.vertical.fill"
        case .liveTV: return "tv.and.mediabox.fill"
        case .search: return "magnifyingglass"
        }
    }
}

public enum AccentColorChoice: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case white, blue, red, orange, green, purple, pink, teal
    public var id: String { rawValue }
}

public struct GeneralSettings: Codable, Hashable, Sendable {
    public var accent: AccentColorChoice = .white
    public var startTab: AppTab = .home
    public var showPosterTitles = true
    public var heroAutoAdvance = true
    public var heroSource: HeroSource = .trending
    public var haptics = true
    public var showWatchedBadges = true

    // Navigation and app icon
    /// The tabs in the order they appear (missing tabs are appended, so new ones always show).
    public var tabOrder: [AppTab] = AppTab.allCases
    public var appIcon: AppIconChoice = .dark

    // Notifications (local; scheduled on this device)
    /// When a new episode of a show you're watching airs.
    public var episodeNotifications = false
    /// Ten minutes before a followed team plays.
    public var matchStartNotifications = false
    /// A followed team's final score, while Flow is running.
    public var matchResultNotifications = false

    // Detail pages
    public var showAboutSection = true
    public var showWhereToWatch = true
    public var showReviews = true
    /// Off blurs the stills of aired episodes you haven't watched.
    public var showEpisodeSpoilers = true
    /// Season 0 at the top of a show's season list.
    public var showSpecialsSeason = true
    public var detailTextSize: DetailTextSize = .standard

    // Home shelves
    /// How many titles each content shelf loads.
    public var contentShelfLength = 20
    public var showContinueWatching = true
    /// Most recent kept; nil for all.
    public var continueWatchingLimit: Int?
    public var showContinueWatchingReleaseDate = true
    /// Next episodes (with air dates) of shows you're caught up on.
    public var showUpcoming = false
    /// Upcoming also lists season premieres and unreleased films from your watchlist.
    public var includeWatchlistPremieres = false
    public var filmDates: FilmDateKind = .digital
    public var upcomingWithinDays = 7
    public var heroStyle: HeroStyle = .card
    public var heroSecondarySource: HeroSource?

    // Posters
    public var showReleaseYear = false
    /// "3/10" on series posters and "6 Remaining" on Continue Watching cards.
    public var showEpisodesRemaining = true
    public init() {}
}

public enum HeroSource: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case trending, popular, watchlist
    public var id: String { rawValue }
    public var title: String { rawValue.capitalized }
}

public enum HeroStyle: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    /// A rounded carousel with its neighbours peeking in.
    case card
    /// The backdrop edge to edge.
    case fullscreen
    public var id: String { rawValue }
    public var title: String { self == .card ? "Card" : "Fullscreen" }
}

public enum AppIconChoice: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case dark, light
    public var id: String { rawValue }
    public var title: String { rawValue.capitalized }
}

/// Which release a film's date means on Upcoming and Calendar.
public enum FilmDateKind: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case digital, theatrical
    public var id: String { rawValue }
    public var title: String { self == .digital ? "Digital Release" : "Theatrical Release" }
}

public enum DetailTextSize: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case small, standard, large, extraLarge
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .small: return "Small"
        case .standard: return "Default"
        case .large: return "Large"
        case .extraLarge: return "Extra Large"
        }
    }
}

// MARK: - Account

public enum TrackerKind: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case trakt, simkl, publicMetaDB, mdblist, local
    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .trakt: return "Trakt"
        case .simkl: return "Simkl"
        case .publicMetaDB: return "PublicMetaDB"
        case .mdblist: return "MDBList"
        case .local: return "This Device"
        }
    }

    public var blurb: String {
        switch self {
        case .trakt: return "Your Trakt account — history, watchlist, ratings and scrobbling."
        case .simkl: return "Your Simkl account — history and watchlist."
        case .publicMetaDB: return "Tracks against your PublicMetaDB API key. No sign-in."
        case .mdblist: return "Tracks against your own MDBList API key, and unlocks your lists as shelves."
        case .local: return "Kept on this device and synced to your other devices with iCloud. No account needed."
        }
    }
}

public enum ListDestination: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case trakt, simkl, publicMetaDB, mdblist, mediaServer, local
    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .trakt: return "Trakt"
        case .simkl: return "Simkl"
        case .publicMetaDB: return "PublicMetaDB"
        case .mdblist: return "MDBList"
        case .mediaServer: return "Media Server"
        case .local: return "This Device"
        }
    }
}

public enum SyncInterval: Int, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case always = 0
    case fifteenMinutes = 900
    case hour = 3600
    case threeHours = 10800
    case twelveHours = 43200
    case day = 86400
    public var id: Int { rawValue }

    public var title: String {
        switch self {
        case .always: return "Every Launch"
        case .fifteenMinutes: return "15 Minutes"
        case .hour: return "1 Hour"
        case .threeHours: return "3 Hours"
        case .twelveHours: return "12 Hours"
        case .day: return "1 Day"
        }
    }
}

public struct AccountSettings: Codable, Hashable, Sendable {
    public var tracker: TrackerKind = .local
    public var syncInterval: SyncInterval = .threeHours
    public var watchlistDestination: ListDestination = .local
    public var favouritesDestination: ListDestination = .local
    public var scrobble = true
    /// Base URLs for services whose deployments vary. Overridable in Settings.
    public var publicMetaDBBaseURL = AccountSettings.defaultPublicMetaDBBaseURL
    public var introDBBaseURL = AccountSettings.defaultIntroDBBaseURL
    public init() {}

    public static let defaultPublicMetaDBBaseURL = "https://publicmetadb.com"
    public static let defaultIntroDBBaseURL = "https://api.introdb.app"

    /// Earlier versions saved addresses that no longer answer. Those are swapped for the working
    /// ones; an address the person typed is left alone.
    public mutating func migrateSkipBaseURLs() {
        func isLegacy(_ url: String, _ legacy: String) -> Bool {
            var trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            while trimmed.hasSuffix("/") { trimmed.removeLast() }
            return trimmed == legacy
        }
        if isLegacy(publicMetaDBBaseURL, "https://api.publicmetadb.com/v1") { publicMetaDBBaseURL = Self.defaultPublicMetaDBBaseURL }
        if isLegacy(introDBBaseURL, "https://api.introdb.app/v1") { introDBBaseURL = Self.defaultIntroDBBaseURL }
    }
}

/// Secrets. Stored in the Keychain on device and only included in a setup export on request.
public struct Credentials: Codable, Hashable, Sendable {
    public var tmdbAPIKey: String?
    public var tvdbAPIKey: String?
    public var mdblistAPIKey: String?
    public var publicMetaDBAPIKey: String?
    public var introDBAPIKey: String?
    public var openSubtitlesAPIKey: String?
    public var openSubtitlesUsername: String?
    public var openSubtitlesPassword: String?
    public var subdlAPIKey: String?
    public var subSourceAPIKey: String?
    public var rpdbAPIKey: String?
    public var traktClientID: String?
    public var traktClientSecret: String?
    public var traktToken: OAuthToken?
    public var simklClientID: String?
    public var simklToken: OAuthToken?
    public init() {}
}

// MARK: - Shelves

public enum BuiltInShelf: String, Codable, Hashable, Sendable, CaseIterable {
    case continueWatching
    case nextUp
    case watchlist
    case favourites
    case recentlyWatched
    case trendingMovies
    case trendingShows
    case popularMovies
    case popularShows
    case topRatedMovies
    case topRatedShows
    case nowPlaying
    case upcomingMovies
    /// The next episodes (and, optionally, premieres and films) coming within a few days.
    case upcomingEpisodes
    case airingToday
    case anticipatedMovies
    case anticipatedShows
    case recommendedForYou
    case mediaServerRecent
    /// Recommendations seeded by the last title you watched; the row is titled after it.
    case becauseYouWatched
    /// A row of streaming-service tiles, each opening what's popular on that service.
    case streamingServices
    /// A row of genre tiles over artwork from a popular title in each.
    case genres

    public var title: String {
        switch self {
        case .continueWatching: return "Continue Watching"
        case .nextUp: return "Up Next"
        case .watchlist: return "Watchlist"
        case .favourites: return "Favourites"
        case .recentlyWatched: return "Recently Watched"
        case .trendingMovies: return "Trending Movies"
        case .trendingShows: return "Trending Shows"
        case .popularMovies: return "Popular Movies"
        case .popularShows: return "Popular Shows"
        case .topRatedMovies: return "Top Rated Movies"
        case .topRatedShows: return "Top Rated Shows"
        case .nowPlaying: return "Now Playing"
        case .upcomingMovies: return "Upcoming Movies"
        case .upcomingEpisodes: return "Upcoming"
        case .airingToday: return "Airing Today"
        case .anticipatedMovies: return "Anticipated Movies"
        case .anticipatedShows: return "Anticipated Shows"
        case .recommendedForYou: return "Recommended For You"
        case .mediaServerRecent: return "Recently Added to Your Server"
        case .becauseYouWatched: return "Because You Watched"
        case .streamingServices: return "Streaming Services"
        case .genres: return "Genres"
        }
    }

    /// Rows of tiles that open other shelves rather than holding titles themselves.
    public var isFolder: Bool { self == .streamingServices || self == .genres }

    /// Rows whose purpose is to show what's coming: never filtered for unreleased titles.
    public var showsUpcomingByDesign: Bool {
        [.continueWatching, .nextUp, .watchlist, .upcomingMovies, .upcomingEpisodes, .nowPlaying, .anticipatedMovies, .anticipatedShows].contains(self)
    }
}

extension BuiltInShelf {
    /// Catalogue rows the shelf-length setting caps; your own lists and watch state always show in full.
    public var isContentShelf: Bool {
        switch self {
        case .trendingMovies, .trendingShows, .popularMovies, .popularShows, .topRatedMovies, .topRatedShows,
             .nowPlaying, .upcomingMovies, .airingToday, .anticipatedMovies, .anticipatedShows, .recommendedForYou, .becauseYouWatched:
            return true
        default:
            return false
        }
    }
}

public enum DiscoverSort: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case popularity = "popularity.desc"
    case rating = "vote_average.desc"
    case newest = "primary_release_date.desc"
    case oldest = "primary_release_date.asc"
    case revenue = "revenue.desc"
    case votes = "vote_count.desc"
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .popularity: return "Popularity"
        case .rating: return "Rating"
        case .newest: return "Newest"
        case .oldest: return "Oldest"
        case .revenue: return "Box Office"
        case .votes: return "Most Votes"
        }
    }

    /// TMDb uses different date fields for TV.
    public func value(for type: MediaType) -> String {
        guard type == .show else { return rawValue }
        switch self {
        case .newest: return "first_air_date.desc"
        case .oldest: return "first_air_date.asc"
        case .revenue: return "popularity.desc"
        default: return rawValue
        }
    }
}

public struct DiscoverQuery: Codable, Hashable, Sendable {
    public var type: MediaType = .movie
    public var genres: [Int] = []
    public var excludedGenres: [Int] = []
    public var yearFrom: Int?
    public var yearTo: Int?
    public var minRating: Double?
    public var minVotes: Int?
    public var originalLanguage: String?
    public var sort: DiscoverSort = .popularity
    public var watchProviders: [Int] = []
    public var watchRegion: String?
    /// Relative date window in days from today (negative = past). Lets a shelf point at future dates.
    public var releasedFromDays: Int?
    public var releasedToDays: Int?

    public init(type: MediaType = .movie) { self.type = type }

    /// Whether the query is aimed at titles not yet out — exempt from the unreleased filter.
    public var targetsFuture: Bool {
        if let releasedToDays, releasedToDays > 0 { return true }
        if let releasedFromDays, releasedFromDays > 0 { return true }
        if let yearFrom, yearFrom > Calendar(identifier: .gregorian).component(.year, from: Date()) { return true }
        return false
    }

    public var isDefault: Bool { self == DiscoverQuery(type: type) }
}

public enum ShelfSource: Codable, Hashable, Sendable {
    case builtIn(BuiltInShelf)
    case discover(DiscoverQuery)
    case traktList(user: String, slug: String)
    case mdblist(id: Int)
    case mediaServerLibrary(serverID: String, libraryID: String)
}

public enum ShelfStyle: String, Codable, Hashable, Sendable, CaseIterable {
    case poster, landscape, hero
}

public struct ShelfConfig: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var source: ShelfSource
    public var enabled: Bool
    public var style: ShelfStyle

    public init(id: String = UUID().uuidString, title: String, source: ShelfSource, enabled: Bool = true, style: ShelfStyle = .poster) {
        self.id = id
        self.title = title
        self.source = source
        self.enabled = enabled
        self.style = style
    }

    public static func builtIn(_ shelf: BuiltInShelf, enabled: Bool = true, style: ShelfStyle = .poster) -> ShelfConfig {
        ShelfConfig(id: shelf.rawValue, title: shelf.title, source: .builtIn(shelf), enabled: enabled, style: style)
    }

    public static let defaults: [ShelfConfig] = [
        .builtIn(.continueWatching, style: .landscape),
        .builtIn(.upcomingEpisodes),
        .builtIn(.watchlist),
        .builtIn(.trendingMovies),
        .builtIn(.trendingShows),
        .builtIn(.becauseYouWatched),
        .builtIn(.popularMovies),
        .builtIn(.nextUp, enabled: false, style: .landscape),
        .builtIn(.popularShows, enabled: false),
        .builtIn(.topRatedMovies, enabled: false),
        .builtIn(.nowPlaying, enabled: false),
        .builtIn(.upcomingMovies, enabled: false),
        .builtIn(.airingToday, enabled: false),
        .builtIn(.mediaServerRecent, enabled: false),
        .builtIn(.favourites, enabled: false),
        .builtIn(.recentlyWatched, enabled: false),
        .builtIn(.streamingServices),
        .builtIn(.genres),
    ]
}

// MARK: - Media servers

public enum MediaServerKind: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case jellyfin, emby, plex
    public var id: String { rawValue }
    public var displayName: String {
        switch self {
        case .jellyfin: return "Jellyfin"
        case .emby: return "Emby"
        case .plex: return "Plex"
        }
    }
}

public struct MediaServerConfig: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var kind: MediaServerKind
    public var name: String
    public var baseURL: URL
    public var userID: String?
    public var accessToken: String?
    public var username: String?
    public var enabled: Bool
    public var isRemote: Bool
    /// Plex machine identifier.
    public var machineID: String?

    public init(id: String = UUID().uuidString, kind: MediaServerKind, name: String, baseURL: URL, userID: String? = nil, accessToken: String? = nil, username: String? = nil, enabled: Bool = true, isRemote: Bool = true, machineID: String? = nil) {
        self.id = id
        self.kind = kind
        self.name = name
        self.baseURL = baseURL
        self.userID = userID
        self.accessToken = accessToken
        self.username = username
        self.enabled = enabled
        self.isRemote = isRemote
        self.machineID = machineID
    }
}

public struct SeerrConfig: Codable, Hashable, Sendable {
    public var baseURL: URL
    public var apiKey: String
    public init(baseURL: URL, apiKey: String) {
        self.baseURL = baseURL
        self.apiKey = apiKey
    }
}

public struct MediaServerSettings: Codable, Hashable, Sendable {
    public var servers: [MediaServerConfig] = []
    public var showBadgeOnPosters = true
    public var onlyShowServerContent = false
    public var useServerArtwork = false
    /// Ignore the servers' own watched state, resume points and Continue Watching, and stop reporting
    /// playback to them: progress comes only from the tracking service.
    public var trackOnlyWithTracker = false
    /// Older all-servers switch; `migrateHomeRows()` turns it into `serverHomeRowIDs`.
    public var serverHomeRows = false
    /// Servers that get a row of their own libraries and collections on Home.
    public var serverHomeRowIDs: [String] = []
    /// A Seerr, Overseerr or Jellyseerr instance for requesting titles you don't have.
    public var seerr: SeerrConfig?
    public var preferDirectPlay = true
    public init() {}

    /// Carries the old all-servers switch over to the per-server list once, so saved settings keep their Home rows.
    public mutating func migrateHomeRows() {
        guard serverHomeRows, !servers.isEmpty else { return }
        if serverHomeRowIDs.isEmpty { serverHomeRowIDs = servers.map(\.id) }
        serverHomeRows = false
    }

    /// Servers with a Home row switched on, in server order.
    public var homeRowServers: [MediaServerConfig] {
        servers.filter { serverHomeRowIDs.contains($0.id) }
    }

    public func showsHomeRow(for serverID: String) -> Bool { serverHomeRowIDs.contains(serverID) }

    public mutating func setHomeRow(_ on: Bool, for serverID: String) {
        serverHomeRowIDs.removeAll { $0 == serverID }
        if on { serverHomeRowIDs.append(serverID) }
    }
}

// MARK: - WebDAV

public struct WebDAVConfig: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var baseURL: URL
    public var username: String?
    public var password: String?
    public var moviesPath: String
    public var showsPath: String
    public var enabled: Bool

    public init(id: String = UUID().uuidString, name: String, baseURL: URL, username: String? = nil, password: String? = nil, moviesPath: String = "/Movies", showsPath: String = "/TV Shows", enabled: Bool = true) {
        self.id = id
        self.name = name
        self.baseURL = baseURL
        self.username = username
        self.password = password
        self.moviesPath = moviesPath
        self.showsPath = showsPath
        self.enabled = enabled
    }
}

// MARK: - Live TV

public enum IPTVProviderKind: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case m3u, xtream
    public var id: String { rawValue }
    public var displayName: String { self == .m3u ? "M3U Playlist" : "Xtream Codes" }
}

public struct IPTVProviderConfig: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var kind: IPTVProviderKind
    public var url: URL
    public var epgURL: URL?
    public var username: String?
    public var password: String?
    public var enabled: Bool
    /// Offer this provider's VOD catalogue in the source picker.
    public var useForVOD: Bool
    public var userAgent: String?

    public init(id: String = UUID().uuidString, name: String, kind: IPTVProviderKind, url: URL, epgURL: URL? = nil, username: String? = nil, password: String? = nil, enabled: Bool = true, useForVOD: Bool = true, userAgent: String? = nil) {
        self.id = id
        self.name = name
        self.kind = kind
        self.url = url
        self.epgURL = epgURL
        self.username = username
        self.password = password
        self.enabled = enabled
        self.useForVOD = useForVOD
        self.userAgent = userAgent
    }
}

public struct LiveTVSettings: Codable, Hashable, Sendable {
    public var providers: [IPTVProviderConfig] = []
    public var epgRefreshHours = 12
    public var favouriteChannelIDs: [String] = []
    public var recentChannelIDs: [String] = []
    public var hideEmptyGroups = true
    public init() {}
}

// MARK: - Sources

public struct AddonConfig: Codable, Hashable, Sendable, Identifiable {
    /// Manifest URL, e.g. https://aiostreams.example/…/manifest.json
    public var manifestURL: URL
    public var name: String
    public var enabled: Bool

    public init(manifestURL: URL, name: String, enabled: Bool = true) {
        self.manifestURL = manifestURL
        self.name = name
        self.enabled = enabled
    }

    public var id: String { manifestURL.absoluteString }

    /// Base URL that resource paths are appended to.
    public var baseURL: URL {
        var string = manifestURL.absoluteString
        if string.hasSuffix("/manifest.json") { string.removeLast("/manifest.json".count) }
        return URL(string: string) ?? manifestURL
    }
}

public enum SourceSortKey: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case resolution, quality, size, cached, seeders, hdr, language
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .resolution: return "Resolution"
        case .quality: return "Release Quality"
        case .size: return "File Size"
        case .cached: return "Cached First"
        case .seeders: return "Seeders"
        case .hdr: return "HDR / Dolby Vision"
        case .language: return "Preferred Language"
        }
    }
}

public struct SourceSortRule: Codable, Hashable, Sendable, Identifiable {
    public var key: SourceSortKey
    public var descending: Bool
    public init(key: SourceSortKey, descending: Bool = true) {
        self.key = key
        self.descending = descending
    }
    public var id: String { key.rawValue }
}

public struct SourceFilters: Codable, Hashable, Sendable {
    public var excludeCinemaCaptures = true
    public var excludeUncached = false
    public var minSizeGB: Double?
    public var maxSizeGB: Double?
    public var minResolution: VideoResolution = .unknown
    public var requiredKeywords: [String] = []
    public var excludedKeywords: [String] = []
    public var preferredLanguages: [String] = []
    public var excludedCodecs: [String] = []
    public init() {}
}

public enum SourceTitleDisplay: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case provider, filename, addonName
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .provider: return "Provider Name"
        case .filename: return "File Name"
        case .addonName: return "Add-on Text"
        }
    }
}

public enum BadgePack: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case colored, monochrome, minimal, none
    public var id: String { rawValue }
}

public struct SourceAppearance: Codable, Hashable, Sendable {
    /// Show the add-on's own multi-line text (emoji formatting and all).
    public var showRawText = false
    public var titleDisplay: SourceTitleDisplay = .provider
    public var badgePack: BadgePack = .colored
    public var showSize = true
    public var compact = false
    public init() {}
}

public struct SourceSettings: Codable, Hashable, Sendable {
    public var useCustomOrdering = false
    public var categoryOrder: [SourceCategory] = [.mediaServers, .webDAV, .iptv, .addons]
    /// Provider ids per category raw value, in display order.
    public var providerOrder: [String: [String]] = [:]
    public var addons: [AddonConfig] = []
    public var sortRules: [SourceSortRule] = [SourceSortRule(key: .cached), SourceSortRule(key: .resolution), SourceSortRule(key: .quality), SourceSortRule(key: .size)]
    public var filters = SourceFilters()
    public var resultCap: Int?
    public var appearance = SourceAppearance()
    public var autoPlayFirstSource = false
    public var timeoutSeconds: Double = 15
    /// Rank sources whose main audio Apple devices can't decode (DTS, TrueHD) after the rest.
    public var preferPlayableAudio = true
    /// A title opened from a library in the Library tab lists only that library's sources.
    public var playFromLibraryOnly = false
    /// The picker offers the source a title was last played from first (Best Match, and auto-play).
    public var rememberLastSource = true
    /// By title key ("movie:603", "show:1399").
    public var lastSources: [String: LastSource] = [:]
    public init() {}
}

// MARK: - Playback

public enum SkipBehaviour: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case off, button, automatic
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .off: return "Off"
        case .button: return "Show Button"
        case .automatic: return "Skip Automatically"
        }
    }
}

public enum ExternalPlayer: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case none, infuse, vlc, outplayer, senPlayer, vidHub, cineUltra, moonPlayer, iina, mpv
    public var id: String { rawValue }

    public enum Platform: Sendable { case iOS, macOS }

    public var title: String {
        switch self {
        case .none: return "Built-in Player"
        case .infuse: return "Infuse"
        case .vlc: return "VLC"
        case .outplayer: return "Outplayer"
        case .senPlayer: return "SenPlayer"
        case .vidHub: return "VidHub"
        case .cineUltra: return "CineUltra"
        case .moonPlayer: return "Moon Player"
        case .iina: return "IINA"
        case .mpv: return "mpv"
        }
    }

    /// Where the app exists and takes a link.
    public var platforms: Set<Platform> {
        switch self {
        case .none, .infuse, .vidHub: return [.iOS, .macOS]
        case .vlc, .outplayer, .senPlayer, .cineUltra, .moonPlayer: return [.iOS]
        case .iina, .mpv: return [.macOS]
        }
    }

    public static func available(on platform: Platform) -> [ExternalPlayer] {
        allCases.filter { $0.platforms.contains(platform) }
    }

    /// The link that hands `stream` to the app, in the forms Stremio uses. Infuse also takes the
    /// resume position and the file name (which helps it identify the title).
    public func launchURL(for stream: URL, position: Double? = nil, filename: String? = nil) -> URL? {
        let raw = stream.absoluteString
        let encoded = raw.addingPercentEncoding(withAllowedCharacters: .urlComponentAllowed) ?? raw
        func withoutScheme(_ scheme: String) -> URL? {
            URL(string: raw.replacingOccurrences(of: #"^https?://"#, with: scheme + "://", options: .regularExpression))
        }
        switch self {
        case .none:
            return nil
        case .infuse:
            var link = "infuse://x-callback-url/play?url=\(encoded)"
            if let position, position > 0 { link += "&position=\(Int(position))" }
            if let filename, !filename.isEmpty, let name = filename.addingPercentEncoding(withAllowedCharacters: .urlComponentAllowed) {
                link += "&filename=\(name)"
            }
            return URL(string: link)
        case .vlc: return URL(string: "vlc-x-callback://x-callback-url/stream?url=\(encoded)")
        case .outplayer: return withoutScheme("outplayer")
        case .senPlayer: return URL(string: "SenPlayer://x-callback-url/play?url=\(encoded)")
        case .vidHub: return URL(string: "open-vidhub://x-callback-url/open?url=\(encoded)")
        case .cineUltra: return URL(string: "cineultra://playback?url=\(encoded)")
        case .moonPlayer: return URL(string: "moonplayer://open?url=\(raw)")
        case .iina: return URL(string: "iina://weblink?url=\(encoded)")
        case .mpv: return URL(string: "mpv://\(raw)")
        }
    }
}

extension CharacterSet {
    /// encodeURIComponent's set: everything but letters, digits and -_.!~*'().
    static let urlComponentAllowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()")
}

/// What to do with Matroska (MKV/WebM) files, which AVPlayer can't open by itself.
public enum MatroskaPlayback: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    /// Repackage on the fly for Apple's player: HDR, Dolby Vision, AirPlay audio and PiP keep working.
    case remux
    /// Send MKV files to the external player chosen below.
    case external
    public var id: String { rawValue }
    public var title: String { self == .remux ? "Play in Flow" : "External Player" }
}

public struct PlaybackSettings: Codable, Hashable, Sendable {
    public var preferredResolutionCap: VideoResolution = .uhd4k
    public var autoPlayNextEpisode = true
    public var nextEpisodeCountdownSeconds = 10
    public var skipIntro: SkipBehaviour = .button
    public var skipRecap: SkipBehaviour = .button
    public var skipCredits: SkipBehaviour = .button
    public var askToResume = true
    public var preferredAudioLanguage: String?
    public var externalPlayer: ExternalPlayer = .none
    public var seekForwardSeconds = 10
    public var seekBackwardSeconds = 10
    public var watchedThresholdPercent: Double = 90
    public var pictureInPicture = true
    public var rememberLastSourcePerShow = true
    public var matroskaPlayback: MatroskaPlayback = .remux
    /// When a source fails to start, quietly move on to the next one.
    public var tryNextSourceOnFailure = true
    /// Say so when a film has a scene during or after its credits.
    public var postCreditsAlert = true
    /// As a film's credits roll, suggest films like it ("Because You Watched").
    public var becauseYouWatched = true
    /// Play the next episode only when this one ends, rather than counting down as its credits start.
    public var upNextWaitsForEnd = false
    /// Extra loudness for quiet Dolby Digital (Plus) soundtracks in MKVs, in dB (see DolbyLoudness).
    public var volumeBoostDB = 0
    /// Tried when no track is in `preferredAudioLanguage`.
    public var audioFallbackLanguage: String?
    public var animeAudio: AnimeAudio = .noPreference
    /// Decode DTS and Dolby TrueHD in MKVs (with FFmpeg) instead of skipping them.
    public var decodeLosslessAudio = true
    /// Remember the audio and subtitle languages chosen for a show, so its next episodes start the same way.
    public var rememberTracksPerShow = true
    /// By show ID.
    public var showTracks: [String: ShowTrackChoice] = [:]
    /// Turn the player to landscape when it opens (iPhone).
    public var autoRotate = true
    /// Tapping a Continue Watching card plays straight away instead of opening the title.
    public var skipDetailsOnContinueWatching = true
    /// Applied instead of `preferredResolutionCap` on cellular and other metered connections.
    public var cellularResolutionCap: VideoResolution = .uhd4k
    /// Prefer HDR sources when the screen shows HDR; off prefers SDR.
    public var preferHDR = true
    /// Play Dolby Vision files as their HDR10 base layer.
    public var neverUseDolbyVision = false
    /// Play single-layer Dolby Vision profile 7 as profile 8.1 (HDR10 base plus the Dolby Vision metadata).
    public var convertDolbyVisionProfile7 = true
    /// A progress bar on the loading screen.
    public var showLoadingProgress = true
    /// X-Ray (cast, who's in the scene, scenes) opens beside the picture whenever playback is paused.
    public var xrayWhenPaused = true
    /// After this many episodes play one after another with nobody touching anything, Flow asks
    /// before starting the next. Zero never asks.
    public var stillWatchingAfterEpisodes = 3
    public init() {}
}

/// The languages a viewer picked while watching a show (e.g. Japanese audio with English subtitles).
public struct ShowTrackChoice: Codable, Hashable, Sendable {
    public var audioLanguage: String?
    /// Nil with `subtitlesOff` false means "no choice made".
    public var subtitleLanguage: String?
    public var subtitlesOff = false
    public init(audioLanguage: String? = nil, subtitleLanguage: String? = nil, subtitlesOff: Bool = false) {
        self.audioLanguage = audioLanguage
        self.subtitleLanguage = subtitleLanguage
        self.subtitlesOff = subtitlesOff
    }
}

// MARK: - Subtitles

public enum SubtitleColor: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case white, yellow, cyan, green
    public var id: String { rawValue }
}

public enum SubtitleBackground: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case none, shadow, translucent, solid
    public var id: String { rawValue }
}

public enum SubtitleFont: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case system, rounded, serif, monospaced, condensed
    public var id: String { rawValue }
    public var title: String { self == .system ? "System" : rawValue.capitalized }
}

public enum SubtitleWeight: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case regular, medium, semibold, bold, heavy
    public var id: String { rawValue }
    public var title: String { rawValue.capitalized }
}

/// How the edge of subtitle text is drawn, as in the system's caption settings.
public enum SubtitleEdgeStyle: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case none, dropShadow, raised, depressed, outline
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .none: return "None"
        case .dropShadow: return "Drop Shadow"
        case .raised: return "Raised"
        case .depressed: return "Depressed"
        case .outline: return "Outline"
        }
    }
}

/// When subtitles turn on by themselves.
public enum AutoSubtitleMode: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    /// Only when the audio isn't in your first subtitle language; otherwise forced subtitles only.
    case automatic
    case always
    case forcedOnly
    case never
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .automatic: return "Automatic"
        case .always: return "Always"
        case .forcedOnly: return "Forced Only"
        case .never: return "Never"
        }
    }
}

public enum SubtitleTypePreference: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case standard, sdh
    public var id: String { rawValue }
    public var title: String { self == .standard ? "Standard" : "SDH" }
}

public enum AnimeAudio: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case noPreference
    /// Japanese audio with subtitles.
    case sub
    /// Your preferred-language audio, subtitles off.
    case dub
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .noPreference: return "No Preference"
        case .sub: return "Sub"
        case .dub: return "Dub"
        }
    }
}

public struct SubtitleSettings: Codable, Hashable, Sendable {
    public var preferredLanguages: [String] = ["en"]
    /// Superseded by `autoSelect`.
    public var autoEnable = false
    public var fontScale: Double = 1.0
    public var color: SubtitleColor = .white
    public var background: SubtitleBackground = .shadow
    public var defaultOffsetSeconds: Double = 0
    /// How far Flow's own subtitles are raised from their usual spot, as a fraction of the picture
    /// height: 0 leaves them at the bottom, 0.4 lifts them by 40%.
    public var verticalPosition: Double = 0
    public var enabledProviders: [String] = ["opensubtitles", "subdl", "wyzie", "subsource"]
    /// Superseded by `subtitleType`.
    public var hearingImpaired = false
    public var font: SubtitleFont = .system
    public var weight: SubtitleWeight = .semibold
    public var edgeStyle: SubtitleEdgeStyle = .dropShadow
    /// 0...1, for the translucent and solid backgrounds.
    public var backgroundOpacity: Double = 0.6
    /// Draw ASS/SSA subtitles with their own colours, weights, sizes and placement.
    public var keepASSStyling = false
    /// Offer to align out-of-sync subtitles to the dialogue (remuxed MKVs).
    public var autoSync = false
    /// When subtitles turn on by themselves; replaces `autoEnable` (see `migrateLegacy`).
    public var autoSelect: AutoSubtitleMode = .automatic
    public var subtitleType: SubtitleTypePreference = .standard
    public init() {}

    /// Carries the old "Load Automatically" and "Prefer Hearing Impaired" switches over to
    /// `autoSelect` and `subtitleType`, then clears them so a later change isn't undone on the next launch.
    public mutating func migrateLegacy() {
        if autoEnable {
            autoSelect = .always
            autoEnable = false
        }
        if hearingImpaired {
            subtitleType = .sdh
            hearingImpaired = false
        }
    }
}

// MARK: - Metadata

public enum EpisodeSource: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case tvdb, tmdb, trakt
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .tvdb: return "TVDB (recommended)"
        case .tmdb: return "TMDB"
        case .trakt: return "Trakt"
        }
    }
}

public enum PrimaryMetadataSource: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case tmdb, trakt
    public var id: String { rawValue }
    public var title: String { self == .tmdb ? "TMDB" : "Trakt" }
}

/// Ratings shown on detail pages, in order.
public enum RatingSource: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case imdb, tomatometer, popcornmeter, metacritic, tmdb, letterboxd, trakt, mal
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .imdb: return "IMDb"
        case .tomatometer: return "Rotten Tomatoes"
        case .popcornmeter: return "Popcornmeter"
        case .metacritic: return "Metacritic"
        case .tmdb: return "TMDB"
        case .letterboxd: return "Letterboxd"
        case .trakt: return "Trakt"
        case .mal: return "MyAnimeList"
        }
    }

    /// What VoiceOver says for a score shown as `value` ("8.4", "90%"): the site and its scale, so
    /// "MC 78" is heard as "Metacritic, 78 out of 100".
    public func spokenScore(_ value: String) -> String {
        let number = value.replacingOccurrences(of: "%", with: "")
        switch self {
        case .imdb, .tmdb: return "\(title), \(number) out of 10"
        case .letterboxd: return "\(title), \(number) out of 5"
        case .metacritic: return "\(title), \(number) out of 100"
        case .tomatometer: return "Rotten Tomatoes critics, \(number) percent"
        case .popcornmeter: return "Rotten Tomatoes audience, \(number) percent"
        case .trakt, .mal: return "\(title), \(number) percent"
        }
    }
}

/// Posters with ratings drawn on them.
public enum PosterEnhancement: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case off
    /// RatingPosterDB (needs its API key).
    case rpdb
    public var id: String { rawValue }
    public var title: String { self == .off ? "Off" : "RPDB" }
}

public struct MetadataSettings: Codable, Hashable, Sendable {
    public var episodeSource: EpisodeSource = .tvdb
    public var airDatesInLocalTimeZone = true
    public var showUnreleasedTitles = true
    public var primarySource: PrimaryMetadataSource = .tmdb
    public var language = "en-US"
    public var region = "US"
    public var includeAdult = false
    /// Look for sources (and load the trailer) as soon as a detail page opens, so Play is instant.
    public var prefetchOnDetail = true
    public var posterEnhancement: PosterEnhancement = .off
    public var ratingsShown: [RatingSource] = RatingSource.allCases
    /// Tapping a score opens that site's page for the title.
    public var tapRatingOpensReviews = false
    /// A JSON array of {"name", "url"} icons for the ratings row.
    public var ratingIconPackURL: URL?
    public init() {}
}

// MARK: - Sync

public struct SyncSettings: Codable, Hashable, Sendable {
    public var iCloudEnabled = true
    public var lastTrackerSync: Date?
    public var lastCloudSync: Date?
    public init() {}
}

// MARK: - Downloads

public enum DownloadLocation: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    /// Inside the app (not backed up).
    case appStorage
    /// The app's folder in the Files app, so downloads can be copied off the device.
    case files
    public var id: String { rawValue }
    public var title: String { self == .appStorage ? "App Storage" : "Files App" }
}

public struct DownloadSettings: Codable, Hashable, Sendable {
    public var location: DownloadLocation = .appStorage
    /// Largest film to pick automatically, in GB; nil for no limit.
    public var movieLimitGB: Double?
    public var episodeLimitGB: Double?
    /// Highest resolution to pick automatically; `.unknown` for the highest available.
    public var resolution: VideoResolution = .unknown
    /// Download takes the best source within the limits instead of opening the source list.
    public var downloadAutomatically = false
    /// Removes a downloaded episode once it has been watched to the end.
    public var deleteWatchedDownloads = false
    /// Downloads the next aired episode when a downloaded one has been watched.
    public var downloadNextEpisode = false
    public init() {}
}

// MARK: - Sports

public struct SportsSettings: Codable, Hashable, Sendable {
    public var followedTeams: [SportsTeam] = []
    public var apiKey = "123"
    /// Off blurs live and final scores until tapped.
    public var showScoreSpoilers = true
    /// Tapping a game opens its channel list (press and hold plays the best match); off is the reverse.
    public var chooseChannelOnTap = false
    public init() {}
}
