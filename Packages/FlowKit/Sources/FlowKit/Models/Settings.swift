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

    public init() {}
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
        case .explore: return "binoculars.fill"
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
    public init() {}
}

public enum HeroSource: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case trending, popular, watchlist
    public var id: String { rawValue }
    public var title: String { rawValue.capitalized }
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
    public var publicMetaDBBaseURL = "https://api.publicmetadb.com/v1"
    public var introDBBaseURL = "https://api.introdb.app/v1"
    public init() {}
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
    case airingToday
    case anticipatedMovies
    case anticipatedShows
    case recommendedForYou
    case mediaServerRecent
    /// Recommendations seeded by the last title you watched; the row is titled after it.
    case becauseYouWatched

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
        case .upcomingMovies: return "Upcoming"
        case .airingToday: return "Airing Today"
        case .anticipatedMovies: return "Anticipated Movies"
        case .anticipatedShows: return "Anticipated Shows"
        case .recommendedForYou: return "Recommended For You"
        case .mediaServerRecent: return "Recently Added to Your Server"
        case .becauseYouWatched: return "Because You Watched"
        }
    }

    /// Rows whose purpose is to show what's coming: never filtered for unreleased titles.
    public var showsUpcomingByDesign: Bool {
        [.continueWatching, .nextUp, .watchlist, .upcomingMovies, .nowPlaying, .anticipatedMovies, .anticipatedShows].contains(self)
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

public struct MediaServerSettings: Codable, Hashable, Sendable {
    public var servers: [MediaServerConfig] = []
    public var showBadgeOnPosters = true
    public var onlyShowServerContent = false
    public var searchServers = true
    public var useServerArtwork = false
    public var preferDirectPlay = true
    public init() {}
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
    /// Decode DTS and Dolby TrueHD in MKVs (with FFmpeg) instead of skipping them.
    public var decodeLosslessAudio = true
    /// Remember the audio and subtitle languages chosen for a show, so its next episodes start the same way.
    public var rememberTracksPerShow = true
    /// By show ID.
    public var showTracks: [String: ShowTrackChoice] = [:]
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

public struct SubtitleSettings: Codable, Hashable, Sendable {
    public var preferredLanguages: [String] = ["en"]
    public var autoEnable = false
    public var fontScale: Double = 1.0
    public var color: SubtitleColor = .white
    public var background: SubtitleBackground = .shadow
    public var defaultOffsetSeconds: Double = 0
    public var enabledProviders: [String] = ["opensubtitles", "subdl", "wyzie", "subsource"]
    public var hearingImpaired = false
    public init() {}
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
    public var title: String { self == .tmdb ? "TMDb" : "Trakt" }
}

public struct MetadataSettings: Codable, Hashable, Sendable {
    public var episodeSource: EpisodeSource = .tvdb
    public var airDatesInLocalTimeZone = true
    public var showUnreleasedTitles = true
    public var primarySource: PrimaryMetadataSource = .tmdb
    public var language = "en-US"
    public var region = "US"
    public var includeAdult = false
    public init() {}
}

// MARK: - Sync

public struct SyncSettings: Codable, Hashable, Sendable {
    public var iCloudEnabled = true
    public var lastTrackerSync: Date?
    public var lastCloudSync: Date?
    public init() {}
}

// MARK: - Sports

public struct SportsSettings: Codable, Hashable, Sendable {
    public var followedTeams: [SportsTeam] = []
    public var apiKey = "123"
    public init() {}
}
