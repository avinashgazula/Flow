import Foundation

/// One local notification the app wants delivered, independent of `UserNotifications` so the
/// planning can be tested anywhere.
public struct PlannedNotification: Hashable, Sendable, Identifiable {
    public enum Kind: String, Sendable, CaseIterable {
        case episode, matchStart, matchResult

        /// Identifier prefix; lets the scheduler clear one kind without touching the others.
        public var prefix: String { "flow.\(rawValue)." }
    }

    public var id: String
    public var kind: Kind
    public var title: String
    public var body: String
    /// When to deliver; nil means right away.
    public var fireDate: Date?

    public init(id: String, kind: Kind, title: String, body: String, fireDate: Date?) {
        self.id = id
        self.kind = kind
        self.title = title
        self.body = body
        self.fireDate = fireDate
    }
}

/// A show's next episode, as the notification planner needs it.
public struct EpisodeAlertSource: Hashable, Sendable {
    public var showName: String
    public var episode: Episode

    public init(showName: String, episode: Episode) {
        self.showName = showName
        self.episode = episode
    }
}

/// Decides which notifications to send and when. Delivery itself lives in the app.
public enum NotificationPlanner {
    /// iOS keeps 64 pending requests and drops the rest; leave a few spare.
    public static let pendingLimit = 60
    /// How long before kick-off a match alert arrives.
    public static let matchLeadTime: TimeInterval = 10 * 60
    /// Results older than this aren't announced, so turning the setting on doesn't replay last week.
    public static let resultFreshness: TimeInterval = 24 * 3600
    /// Local hour for episodes whose air time isn't known.
    public static let defaultAirHour = 9

    // MARK: Episodes

    /// One alert per show, when its next episode airs.
    public static func episodes(_ sources: [EpisodeAlertSource], now: Date = Date(), calendar: Calendar = .current) -> [PlannedNotification] {
        var seen = Set<String>()
        var out: [PlannedNotification] = []
        for source in sources {
            let episode = source.episode
            guard let airDate = episode.airDate else { continue }
            let fire = episodeFireDate(airDate: airDate, calendar: calendar)
            guard fire > now else { continue }
            let id = "\(PlannedNotification.Kind.episode.prefix)\(episode.showTMDB).\(episode.code)"
            guard seen.insert(id).inserted else { continue }
            out.append(PlannedNotification(
                id: id, kind: .episode,
                title: "New episode of \(source.showName)",
                body: "\(episode.code) · \(episode.title) is out now.",
                fireDate: fire))
        }
        return out
    }

    /// Air dates from TMDb are a bare day (midnight UTC): that day at 9:00 local. A date with a
    /// time in it (Trakt's first_aired) is used as given.
    public static func episodeFireDate(airDate: Date, calendar: Calendar = .current) -> Date {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .current
        let parts = utc.dateComponents([.year, .month, .day, .hour, .minute, .second], from: airDate)
        guard parts.hour == 0, parts.minute == 0, parts.second == 0 else { return airDate }
        var local = DateComponents()
        local.year = parts.year
        local.month = parts.month
        local.day = parts.day
        local.hour = defaultAirHour
        return calendar.date(from: local) ?? airDate
    }

    // MARK: Matches

    /// A heads-up ten minutes before each fixture. Fixtures listed under two followed teams count once.
    public static func matchStarts(_ events: [SportsEvent], now: Date = Date()) -> [PlannedNotification] {
        var seen = Set<String>()
        var out: [PlannedNotification] = []
        for event in events where !event.isFinished {
            guard let date = event.date else { continue }
            let fire = date.addingTimeInterval(-matchLeadTime)
            guard fire > now, seen.insert(event.id).inserted else { continue }
            out.append(PlannedNotification(
                id: "\(PlannedNotification.Kind.matchStart.prefix)\(event.id)", kind: .matchStart,
                title: fixtureTitle(event),
                body: ["Starts in 10 minutes", event.league].compactMap { $0 }.joined(separator: " · "),
                fireDate: fire))
        }
        return out
    }

    /// Final scores of recently finished matches that haven't been announced. `newIDs` are the
    /// events to remember so they aren't announced twice.
    public static func results(_ events: [SportsEvent], alreadyNotified: Set<String>, now: Date = Date()) -> (notifications: [PlannedNotification], newIDs: [String]) {
        var seen = alreadyNotified
        var out: [PlannedNotification] = []
        var ids: [String] = []
        for event in events {
            guard let home = event.homeScore, let away = event.awayScore, let date = event.date,
                  now.timeIntervalSince(date) <= resultFreshness, !seen.contains(event.id) else { continue }
            seen.insert(event.id)
            ids.append(event.id)
            let homeName = event.homeTeam ?? "Home"
            let awayName = event.awayTeam ?? "Away"
            out.append(PlannedNotification(
                id: "\(PlannedNotification.Kind.matchResult.prefix)\(event.id)", kind: .matchResult,
                title: "\(homeName) \(home)–\(away) \(awayName)",
                body: ["Full time", event.league].compactMap { $0 }.joined(separator: " · "),
                fireDate: nil))
        }
        return (out, ids)
    }

    private static func fixtureTitle(_ event: SportsEvent) -> String {
        if let home = event.homeTeam, let away = event.awayTeam { return "\(home) vs \(away)" }
        return event.title
    }

    // MARK: Limits

    /// The soonest `limit` dated notifications; ones without a date aren't pending, so aren't counted.
    public static func capped(_ notifications: [PlannedNotification], limit: Int = pendingLimit) -> [PlannedNotification] {
        let dated = notifications.filter { $0.fireDate != nil }.sorted { ($0.fireDate ?? .distantFuture, $0.id) < ($1.fireDate ?? .distantFuture, $1.id) }
        return Array(dated.prefix(max(0, limit)))
    }

    /// Remembered result ids, oldest dropped first.
    public static func trimmed(_ ids: [String], keeping limit: Int = 200) -> [String] {
        ids.count > limit ? Array(ids.suffix(limit)) : ids
    }
}
