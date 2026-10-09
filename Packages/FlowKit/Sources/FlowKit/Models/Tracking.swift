import Foundation

/// A resume point. For shows, `episode` identifies which episode the position belongs to.
public struct PlaybackProgress: Codable, Hashable, Sendable, Identifiable {
    public var key: MediaKey
    public var episode: EpisodeRef?
    /// 0...100, matching Trakt's scrobble progress scale.
    public var percent: Double
    public var positionSeconds: Double?
    public var durationSeconds: Double?
    public var updatedAt: Date
    /// Tracker-specific identifier (Trakt playback id) used to delete the resume point.
    public var remoteID: String?

    public init(key: MediaKey, episode: EpisodeRef? = nil, percent: Double, positionSeconds: Double? = nil, durationSeconds: Double? = nil, updatedAt: Date = Date(), remoteID: String? = nil) {
        self.key = key
        self.episode = episode
        self.percent = percent
        self.positionSeconds = positionSeconds
        self.durationSeconds = durationSeconds
        self.updatedAt = updatedAt
        self.remoteID = remoteID
    }

    public var id: String {
        if let episode { return "\(key):\(episode.code)" }
        return key.description
    }

    /// Seconds remaining, if the duration is known.
    public var remainingSeconds: Double? {
        guard let durationSeconds else { return nil }
        let position = positionSeconds ?? durationSeconds * percent / 100
        return max(0, durationSeconds - position)
    }

    /// Position to resume from given a known runtime.
    public func resumePosition(runtimeSeconds: Double?) -> Double? {
        if let positionSeconds { return positionSeconds }
        guard let total = durationSeconds ?? runtimeSeconds else { return nil }
        return total * percent / 100
    }
}

public struct HistoryEntry: Codable, Hashable, Sendable, Identifiable {
    public var key: MediaKey
    public var episode: EpisodeRef?
    public var watchedAt: Date
    public var remoteID: String?

    public init(key: MediaKey, episode: EpisodeRef? = nil, watchedAt: Date = Date(), remoteID: String? = nil) {
        self.key = key
        self.episode = episode
        self.watchedAt = watchedAt
        self.remoteID = remoteID
    }

    public var id: String { "\(key):\(episode?.code ?? "-"):\(Int(watchedAt.timeIntervalSince1970))" }
}

public struct ListEntry: Codable, Hashable, Sendable, Identifiable {
    public var key: MediaKey
    public var addedAt: Date

    public init(key: MediaKey, addedAt: Date = Date()) {
        self.key = key
        self.addedAt = addedAt
    }

    public var id: String { key.description }
}

/// Aggregated watched state for one show, used to compute Next Up and episode check marks.
public struct ShowWatchState: Codable, Hashable, Sendable {
    public var key: MediaKey
    public var watched: Set<EpisodeRef>
    public var lastWatchedAt: Date?

    public init(key: MediaKey, watched: Set<EpisodeRef> = [], lastWatchedAt: Date? = nil) {
        self.key = key
        self.watched = watched
        self.lastWatchedAt = lastWatchedAt
    }

    /// The first unwatched episode after the furthest watched one, among `aired` episodes.
    public func nextUp(aired: [EpisodeRef]) -> EpisodeRef? {
        let regular = aired.filter { $0.season > 0 }.sorted()
        guard let furthest = watched.filter({ $0.season > 0 }).max() else { return regular.first }
        return regular.first { $0 > furthest && !watched.contains($0) }
    }
}

/// A rewatch in progress: Next Up follows this instead of the tracker history.
public struct Rewatch: Codable, Hashable, Sendable, Identifiable {
    public var key: MediaKey
    public var startedAt: Date
    public var watched: Set<EpisodeRef>

    public init(key: MediaKey, startedAt: Date = Date(), watched: Set<EpisodeRef> = []) {
        self.key = key
        self.startedAt = startedAt
        self.watched = watched
    }

    public var id: String { key.description }
}

public struct ShuffleRecord: Codable, Hashable, Sendable {
    public var key: MediaKey
    public var played: [EpisodeRef]

    public init(key: MediaKey, played: [EpisodeRef] = []) {
        self.key = key
        self.played = played
    }
}

public struct UserProfile: Codable, Hashable, Sendable {
    public var username: String
    public var displayName: String?
    public var avatarURL: URL?

    public init(username: String, displayName: String? = nil, avatarURL: URL? = nil) {
        self.username = username
        self.displayName = displayName
        self.avatarURL = avatarURL
    }
}

/// OAuth device-code handshake shared by Trakt, Simkl and Plex PIN sign-in.
public struct DeviceCode: Codable, Hashable, Sendable {
    public var deviceCode: String
    public var userCode: String
    public var verificationURL: URL
    public var expiresIn: TimeInterval
    public var interval: TimeInterval

    public init(deviceCode: String, userCode: String, verificationURL: URL, expiresIn: TimeInterval, interval: TimeInterval) {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationURL = verificationURL
        self.expiresIn = expiresIn
        self.interval = interval
    }
}

public struct OAuthToken: Codable, Hashable, Sendable {
    public var accessToken: String
    public var refreshToken: String?
    public var expiresAt: Date?

    public init(accessToken: String, refreshToken: String? = nil, expiresAt: Date? = nil) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    public var isExpired: Bool {
        guard let expiresAt else { return false }
        return expiresAt.timeIntervalSinceNow < 60
    }
}

public struct Ratings: Codable, Hashable, Sendable {
    public var imdb: Double?
    public var imdbVotes: Int?
    public var rottenTomatoes: Int?
    public var popcorn: Int?
    public var metacritic: Int?
    public var tmdb: Double?
    public var letterboxd: Double?
    public var trakt: Int?

    public init(imdb: Double? = nil, imdbVotes: Int? = nil, rottenTomatoes: Int? = nil, popcorn: Int? = nil, metacritic: Int? = nil, tmdb: Double? = nil, letterboxd: Double? = nil, trakt: Int? = nil) {
        self.imdb = imdb
        self.imdbVotes = imdbVotes
        self.rottenTomatoes = rottenTomatoes
        self.popcorn = popcorn
        self.metacritic = metacritic
        self.tmdb = tmdb
        self.letterboxd = letterboxd
        self.trakt = trakt
    }

    public var isEmpty: Bool {
        imdb == nil && rottenTomatoes == nil && popcorn == nil && metacritic == nil && tmdb == nil && letterboxd == nil && trakt == nil
    }

    public func merged(with other: Ratings) -> Ratings {
        Ratings(
            imdb: imdb ?? other.imdb,
            imdbVotes: imdbVotes ?? other.imdbVotes,
            rottenTomatoes: rottenTomatoes ?? other.rottenTomatoes,
            popcorn: popcorn ?? other.popcorn,
            metacritic: metacritic ?? other.metacritic,
            tmdb: tmdb ?? other.tmdb,
            letterboxd: letterboxd ?? other.letterboxd,
            trakt: trakt ?? other.trakt
        )
    }
}
