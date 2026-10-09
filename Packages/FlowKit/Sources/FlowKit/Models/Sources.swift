import Foundation

/// The groups shown in Settings → Sources → Category Order.
public enum SourceCategory: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case mediaServers
    case webDAV
    case iptv
    case addons

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .mediaServers: return "Media Servers"
        case .webDAV: return "WebDAV"
        case .iptv: return "IPTV / VOD"
        case .addons: return "Add-ons"
        }
    }

    public var systemImage: String {
        switch self {
        case .mediaServers: return "server.rack"
        case .webDAV: return "externaldrive.connected.to.line.below"
        case .iptv: return "tv.and.mediabox"
        case .addons: return "puzzlepiece.extension"
        }
    }
}

public enum VideoResolution: Int, Codable, Hashable, Sendable, CaseIterable, Comparable, Identifiable {
    case unknown = 0
    case sd = 480
    case hd720 = 720
    case hd1080 = 1080
    case uhd1440 = 1440
    case uhd4k = 2160

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .unknown: return "Unknown"
        case .sd: return "SD"
        case .hd720: return "720p"
        case .hd1080: return "1080p"
        case .uhd1440: return "1440p"
        case .uhd4k: return "4K"
        }
    }

    public static func < (lhs: VideoResolution, rhs: VideoResolution) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// Where the release came from. Ordered roughly by quality, worst first.
public enum ReleaseQuality: String, Codable, Hashable, Sendable, CaseIterable, Comparable {
    case cam = "CAM"
    case telesync = "TS"
    case telecine = "TC"
    case screener = "SCR"
    case unknown = "Unknown"
    case hdtv = "HDTV"
    case webrip = "WEBRip"
    case webdl = "WEB-DL"
    case bluray = "BluRay"
    case remux = "REMUX"

    private var rank: Int { Self.allCases.firstIndex(of: self) ?? 0 }
    public static func < (lhs: ReleaseQuality, rhs: ReleaseQuality) -> Bool { lhs.rank < rhs.rank }

    /// Pre-release cinema captures that most people want filtered out.
    public var isCinemaCapture: Bool { [.cam, .telesync, .telecine, .screener].contains(self) }
}

/// Information parsed out of a stream title / filename.
public struct StreamTraits: Codable, Hashable, Sendable {
    public var resolution: VideoResolution = .unknown
    public var quality: ReleaseQuality = .unknown
    public var videoCodec: String?
    public var hdr: [String] = []
    public var audioCodec: String?
    public var audioChannels: String?
    public var sizeBytes: Int64?
    public var languages: [String] = []
    public var releaseGroup: String?
    public var isCached: Bool?
    public var seeders: Int?
    public var bitDepth: Int?

    public init() {}

    /// Badges shown under a source row, e.g. ["1080p", "H264", "AAC", "2.0"].
    public var badges: [String] {
        var out: [String] = []
        if resolution != .unknown { out.append(resolution.label) }
        out.append(contentsOf: hdr)
        if let videoCodec { out.append(videoCodec) }
        if let audioCodec { out.append(audioCodec) }
        if let audioChannels { out.append(audioChannels) }
        return out
    }
}

/// How a source is played back.
public enum StreamLocation: Codable, Hashable, Sendable {
    /// Direct HTTP(S) URL, optionally with headers the player must send.
    case url(URL, headers: [String: String])
    /// Torrent info-hash. Needs a debrid-enabled add-on to become playable; kept so we can show it.
    case torrent(infoHash: String, fileIndex: Int?)
    /// Opens an external app/website.
    case external(URL)

    public var playableURL: URL? {
        if case .url(let url, _) = self { return url }
        return nil
    }

    public var headers: [String: String] {
        if case .url(_, let headers) = self { return headers }
        return [:]
    }
}

/// One playable option in the source picker.
public struct StreamSource: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var category: SourceCategory
    /// Provider identifier (add-on id, server id, provider id) used for provider ordering.
    public var providerID: String
    /// What the picker shows as the row title, e.g. "AIOStreams" or "Jellyfin".
    public var providerName: String
    /// Raw multi-line text from the add-on or server (name + title/description).
    public var title: String
    public var detail: String?
    public var filename: String?
    public var location: StreamLocation
    public var traits: StreamTraits
    /// Resume offset reported by a media server for this exact item.
    public var serverResumeSeconds: Double?
    /// Skip segments known by the source itself (e.g. Jellyfin media segments).
    public var segments: [SkipSegment]
    public var bingeGroup: String?

    public init(id: String, category: SourceCategory, providerID: String, providerName: String, title: String, detail: String? = nil, filename: String? = nil, location: StreamLocation, traits: StreamTraits = StreamTraits(), serverResumeSeconds: Double? = nil, segments: [SkipSegment] = [], bingeGroup: String? = nil) {
        self.id = id
        self.category = category
        self.providerID = providerID
        self.providerName = providerName
        self.title = title
        self.detail = detail
        self.filename = filename
        self.location = location
        self.traits = traits
        self.serverResumeSeconds = serverResumeSeconds
        self.segments = segments
        self.bingeGroup = bingeGroup
    }

    public var isPlayable: Bool { location.playableURL != nil }
}

/// The thing the user wants to watch: a movie, or an episode of a show.
public struct PlaybackRequest: Codable, Hashable, Sendable {
    public var item: MediaItem
    public var episode: Episode?

    public init(item: MediaItem, episode: Episode? = nil) {
        self.item = item
        self.episode = episode
    }

    public var episodeRef: EpisodeRef? { episode?.ref }

    /// Stremio-style id: "tt0111161" for movies, "tt0944947:1:1" for episodes.
    public var stremioID: String? {
        guard let imdb = item.ids.imdb else { return nil }
        if let episode { return "\(imdb):\(episode.season):\(episode.number)" }
        return imdb
    }

    public var displayTitle: String {
        if let episode { return "\(item.title) · \(episode.code)" }
        return item.title
    }
}

public enum SkipSegmentKind: String, Codable, Hashable, Sendable, CaseIterable {
    case intro
    case recap
    case credits
    case preview
    case commercial

    public var buttonTitle: String {
        switch self {
        case .intro: return "Skip Intro"
        case .recap: return "Skip Recap"
        case .credits: return "Skip Credits"
        case .preview: return "Skip Preview"
        case .commercial: return "Skip Ad"
        }
    }
}

public struct SkipSegment: Codable, Hashable, Sendable {
    public var kind: SkipSegmentKind
    public var start: Double
    public var end: Double

    public init(kind: SkipSegmentKind, start: Double, end: Double) {
        self.kind = kind
        self.start = start
        self.end = end
    }

    public func contains(_ time: Double) -> Bool { time >= start && time < end - 0.5 }
}
