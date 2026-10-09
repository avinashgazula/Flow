import Foundation

public struct SportsTeam: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var league: String?
    public var sport: String?
    public var badgeURL: URL?
    public var country: String?

    public init(id: String, name: String, league: String? = nil, sport: String? = nil, badgeURL: URL? = nil, country: String? = nil) {
        self.id = id
        self.name = name
        self.league = league
        self.sport = sport
        self.badgeURL = badgeURL
        self.country = country
    }
}

public struct SportsEvent: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var homeTeam: String?
    public var awayTeam: String?
    public var league: String?
    public var venue: String?
    public var date: Date?
    public var homeScore: Int?
    public var awayScore: Int?
    public var thumbnailURL: URL?

    public var isFinished: Bool { homeScore != nil && awayScore != nil }
}

/// TheSportsDB: team search and fixtures for the Library → Sports page.
public struct SportsClient: Sendable {
    let apiKey: String
    let http: HTTPClient

    public init(apiKey: String = "123", http: HTTPClient = HTTPClient()) {
        self.apiKey = apiKey
        self.http = http
    }

    var base: String { "https://www.thesportsdb.com/api/v1/json/\(apiKey)" }

    public func searchTeams(_ name: String) async throws -> [SportsTeam] {
        let json = try await http.json(JSONValue.self, HTTPRequest(.get, base + "/searchteams.php", query: ["t": name]))
        return (json["teams"]?.array ?? []).compactMap(Self.team)
    }

    public func nextEvents(teamID: String) async throws -> [SportsEvent] {
        let json = try await http.json(JSONValue.self, HTTPRequest(.get, base + "/eventsnext.php", query: ["id": teamID]))
        return (json["events"]?.array ?? []).compactMap(Self.event)
    }

    public func lastEvents(teamID: String) async throws -> [SportsEvent] {
        let json = try await http.json(JSONValue.self, HTTPRequest(.get, base + "/eventslast.php", query: ["id": teamID]))
        return (json["results"]?.array ?? []).compactMap(Self.event)
    }

    static func team(_ t: JSONValue) -> SportsTeam? {
        guard let id = t["idTeam"]?.string, let name = t["strTeam"]?.string else { return nil }
        return SportsTeam(id: id, name: name, league: t["strLeague"]?.string, sport: t["strSport"]?.string,
                          badgeURL: (t["strBadge"] ?? t["strTeamBadge"])?.string.flatMap(URL.init(string:)), country: t["strCountry"]?.string)
    }

    static func event(_ e: JSONValue) -> SportsEvent? {
        guard let id = e["idEvent"]?.string else { return nil }
        let date = e["strTimestamp"]?.string.flatMap { FlowDate.parse($0.hasSuffix("Z") || $0.contains("+") ? $0 : $0 + "Z") }
            ?? e["dateEvent"]?.string.flatMap { d in FlowDate.parse("\(d)T\(e["strTime"]?.string ?? "00:00:00")Z") }
        return SportsEvent(id: id, title: e["strEvent"]?.string ?? "", homeTeam: e["strHomeTeam"]?.string, awayTeam: e["strAwayTeam"]?.string,
                           league: e["strLeague"]?.string, venue: e["strVenue"]?.string, date: date,
                           homeScore: e["intHomeScore"]?.int, awayScore: e["intAwayScore"]?.int, thumbnailURL: e["strThumb"]?.string.flatMap(URL.init(string:)))
    }
}
