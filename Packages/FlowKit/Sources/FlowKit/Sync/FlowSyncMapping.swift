import Foundation

/// The seven sections the apps read and write. `streamProxy` is the website's alone: the apps carry it unchanged.
public enum FlowSyncSectionName {
    public static let keys = "keys"
    public static let accounts = "accounts"
    public static let addons = "addons"
    public static let servers = "servers"
    public static let playback = "playback"
    public static let requests = "requests"
    public static let sports = "sports"

    public static let all = [keys, accounts, addons, servers, playback, requests, sports]
}

/// Between the app's own types and the payload's sections (docs/SYNC.md, "Payload").
public enum FlowSyncMapping {
    // MARK: Reading the app's values

    /// Every section's data as it stands on this device. Sections with nothing in them are still here;
    /// whether to send an empty one is the engine's call.
    public static func sections(credentials: Credentials, settings: AppSettings) -> [String: JSONValue] {
        [
            FlowSyncSectionName.keys: keysData(credentials),
            FlowSyncSectionName.accounts: accountsData(credentials),
            FlowSyncSectionName.addons: addonsData(settings.sources.addons),
            FlowSyncSectionName.servers: serversData(settings.mediaServers.servers),
            FlowSyncSectionName.playback: playbackData(settings),
            FlowSyncSectionName.requests: requestsData(settings.mediaServers.seerr),
            FlowSyncSectionName.sports: sportsData(settings.sports),
        ]
    }

    /// Whether a change to credentials touched anything that syncs, so the app can skip a round for the rest.
    public static func changed(from old: Credentials, to new: Credentials) -> Bool {
        keysData(old) != keysData(new) || accountsData(old) != accountsData(new)
    }

    /// The same for settings, without encoding all of them: the add-ons, servers, languages, subtitle style, Seerr and Sports.
    public static func changed(from old: AppSettings, to new: AppSettings) -> Bool {
        old.sources.addons != new.sources.addons
            || old.mediaServers.servers != new.mediaServers.servers
            || old.mediaServers.seerr != new.mediaServers.seerr
            || old.sports != new.sports
            || old.playback.preferredAudioLanguage != new.playback.preferredAudioLanguage
            || old.playback.audioFallbackLanguage != new.playback.audioFallbackLanguage
            || old.subtitles.preferredLanguages != new.subtitles.preferredLanguages
            || old.subtitles.fontScale != new.subtitles.fontScale
            || old.subtitles.font != new.subtitles.font
            || old.subtitles.weight != new.subtitles.weight
            || old.subtitles.color != new.subtitles.color
            || old.subtitles.edgeStyle != new.subtitles.edgeStyle
            || old.subtitles.background != new.subtitles.background
            || old.subtitles.backgroundOpacity != new.subtitles.backgroundOpacity
            || old.subtitles.verticalPosition != new.subtitles.verticalPosition
    }

    // MARK: keys

    static func keyFields() -> [(String, WritableKeyPath<Credentials, String?>)] {
        [
            ("tmdbAPIKey", \.tmdbAPIKey), ("tvdbAPIKey", \.tvdbAPIKey), ("mdblistAPIKey", \.mdblistAPIKey),
            ("openSubtitlesAPIKey", \.openSubtitlesAPIKey), ("openSubtitlesUsername", \.openSubtitlesUsername),
            ("openSubtitlesPassword", \.openSubtitlesPassword),
            ("subdlAPIKey", \.subdlAPIKey), ("subSourceAPIKey", \.subSourceAPIKey), ("wyzieAPIKey", \.wyzieAPIKey), ("rpdbAPIKey", \.rpdbAPIKey),
            ("introDBAPIKey", \.introDBAPIKey), ("publicMetaDBAPIKey", \.publicMetaDBAPIKey),
            ("traktClientID", \.traktClientID), ("traktClientSecret", \.traktClientSecret), ("simklClientID", \.simklClientID),
        ]
    }

    static func keysData(_ credentials: Credentials) -> JSONValue {
        var object: [String: JSONValue] = [:]
        for (name, path) in keyFields() { object[name] = FlowSyncJSON.optional(credentials[keyPath: path]) }
        return .object(object)
    }

    // MARK: accounts

    static func tokenData(_ token: OAuthToken?) -> JSONValue {
        guard let token else { return .null }
        return FlowSyncJSON.object([
            "accessToken": .string(token.accessToken),
            "refreshToken": FlowSyncJSON.optional(token.refreshToken),
            "expiresAt": token.expiresAt.map { .string(FlowSyncTime.string($0)) } ?? .null,
            "redirectURI": FlowSyncJSON.optional(token.redirectURI),
        ])
    }

    /// Nil when the value isn't a usable token (no access token), so a malformed one never signs a device out.
    static func token(from value: JSONValue) -> OAuthToken? {
        guard case .object(let object) = value, let access = object["accessToken"]?.string, !access.isEmpty else { return nil }
        return OAuthToken(
            accessToken: access,
            refreshToken: object["refreshToken"]?.string.flatMap { $0.isEmpty ? nil : $0 },
            expiresAt: object["expiresAt"]?.string.flatMap(FlowSyncTime.date),
            redirectURI: object["redirectURI"]?.string.flatMap { $0.isEmpty ? nil : $0 }
        )
    }

    static func accountsData(_ credentials: Credentials) -> JSONValue {
        FlowSyncJSON.object(["trakt": tokenData(credentials.traktToken), "simkl": tokenData(credentials.simklToken)])
    }

    // MARK: addons

    static func addonsData(_ addons: [AddonConfig]) -> JSONValue {
        .array(addons.map { FlowSyncJSON.object(["url": .string($0.manifestURL.absoluteString), "name": .string($0.name), "enabled": .bool($0.enabled)]) })
    }

    // MARK: servers

    static func serversData(_ servers: [MediaServerConfig]) -> JSONValue {
        .array(servers.map { server in
            FlowSyncJSON.object([
                "id": .string(server.id),
                "kind": .string(server.kind.rawValue),
                "name": .string(server.name),
                "url": .string(server.baseURL.absoluteString),
                "token": FlowSyncJSON.optional(server.accessToken),
                "userId": FlowSyncJSON.optional(server.userID),
                "username": FlowSyncJSON.optional(server.username),
                "machineId": FlowSyncJSON.optional(server.machineID),
            ])
        })
    }

    // MARK: playback

    /// The style keys the section carries, under SubtitleSettings' own names.
    static let subtitleStyleKeys = ["fontScale", "font", "weight", "color", "edgeStyle", "background", "backgroundOpacity", "verticalPosition"]

    static func playbackData(_ settings: AppSettings) -> JSONValue {
        let audio = [settings.playback.preferredAudioLanguage, settings.playback.audioFallbackLanguage].compactMap { $0?.nonEmptyTrimmed }
        var style: [String: JSONValue] = [:]
        if let encoded = try? JSONEncoder.flow.encode(settings.subtitles), let all = try? JSONDecoder().decode(JSONValue.self, from: encoded).object {
            for key in subtitleStyleKeys { style[key] = all[key] }
        }
        return FlowSyncJSON.object([
            "audioLanguages": .array(audio.map { .string($0) }),
            "subtitleLanguages": .array(settings.subtitles.preferredLanguages.map { .string($0) }),
            "subtitleStyle": .object(style),
        ])
    }

    // MARK: requests

    /// `{"seerr": {"url", "apiKey"} | null}`. `null` is a disconnect, which travels like any other change.
    static func requestsData(_ seerr: SeerrConfig?) -> JSONValue {
        let value: JSONValue = seerr.map { FlowSyncJSON.object(["url": .string($0.baseURL.absoluteString), "apiKey": .string($0.apiKey)]) } ?? .null
        return FlowSyncJSON.object(["seerr": value])
    }

    /// Nil when the value isn't a usable connection (an address that isn't http or https, or no key), so junk never disconnects a device.
    static func seerr(from value: JSONValue) -> SeerrConfig? {
        guard case .object(let object) = value,
              case .string(let text)? = object["url"], case .string(let key)? = object["apiKey"],
              let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), url.scheme.map({ ["http", "https"].contains($0.lowercased()) }) == true, url.host != nil,
              let apiKey = key.nonEmptyTrimmed else { return nil }
        return SeerrConfig(baseURL: url, apiKey: apiKey)
    }

    // MARK: sports

    static func sportsData(_ sports: SportsSettings) -> JSONValue {
        let teams = sports.followedTeams.map { team -> JSONValue in
            var object: [String: JSONValue] = ["id": .string(team.id), "name": .string(team.name)]
            if let league = team.league { object["league"] = .string(league) }
            if let sport = team.sport { object["sport"] = .string(sport) }
            if let badge = team.badgeURL { object["badgeURL"] = .string(badge.absoluteString) }
            if let country = team.country { object["country"] = .string(country) }
            return .object(object)
        }
        return FlowSyncJSON.object([
            "followedTeams": .array(teams),
            "apiKey": .string(sports.apiKey),
            "showScoreSpoilers": .bool(sports.showScoreSpoilers),
            "chooseChannelOnTap": .bool(sports.chooseChannelOnTap),
        ])
    }

    /// A team needs an id and a name; the rest are text, and a null or a value of another type is left out.
    static func teams(from list: [JSONValue]) -> [SportsTeam] {
        func text(_ object: [String: JSONValue], _ key: String) -> String? {
            if case .string(let s)? = object[key], !s.isEmpty { return s }
            return nil
        }
        return list.compactMap { value in
            guard let object = value.object, let id = text(object, "id"), let name = text(object, "name") else { return nil }
            return SportsTeam(id: id, name: name, league: text(object, "league"), sport: text(object, "sport"),
                              badgeURL: text(object, "badgeURL").flatMap { URL(string: $0) }, country: text(object, "country"))
        }
    }

    /// One field at a time, so a shape this version can't read costs that field and not the rest. A blank or null
    /// key reads as unset, which is TheSportsDB's free test key.
    static func applySports(_ data: JSONValue, to sports: inout SportsSettings) {
        guard let object = data.object else { return }
        if let list = object["followedTeams"]?.array { sports.followedTeams = teams(from: list) }
        switch object["apiKey"] {
        case .string(let key)?: sports.apiKey = key.nonEmptyTrimmed ?? SportsSettings().apiKey
        case .null?: sports.apiKey = SportsSettings().apiKey
        default: break
        }
        if case .bool(let on)? = object["showScoreSpoilers"] { sports.showScoreSpoilers = on }
        if case .bool(let on)? = object["chooseChannelOnTap"] { sports.chooseChannelOnTap = on }
    }

    // MARK: Applying a section

    /// Puts a section's data into the app's values. Fields the section doesn't carry, or carries in a shape
    /// this version can't read, are left as they are.
    public static func apply(_ data: JSONValue, to section: String, credentials: inout Credentials, settings: inout AppSettings) {
        switch section {
        case FlowSyncSectionName.keys: applyKeys(data, to: &credentials)
        case FlowSyncSectionName.accounts: applyAccounts(data, to: &credentials)
        case FlowSyncSectionName.addons:
            if let list = data.array { settings.sources.addons = addons(from: list) }
        case FlowSyncSectionName.servers:
            if let list = data.array { settings.mediaServers.servers = servers(from: list, existing: settings.mediaServers.servers) }
        case FlowSyncSectionName.playback: applyPlayback(data, to: &settings)
        case FlowSyncSectionName.requests: applyRequests(data, to: &settings)
        case FlowSyncSectionName.sports: applySports(data, to: &settings.sports)
        default: break
        }
    }

    static func applyKeys(_ data: JSONValue, to credentials: inout Credentials) {
        guard let object = data.object else { return }
        for (name, path) in keyFields() {
            guard let value = object[name] else { continue }
            switch value {
            case .string(let s): credentials[keyPath: path] = s.isEmpty ? nil : s
            case .null: credentials[keyPath: path] = nil
            default: break
            }
        }
    }

    static func applyAccounts(_ data: JSONValue, to credentials: inout Credentials) {
        guard let object = data.object else { return }
        if let value = object["trakt"] {
            if case .null = value { credentials.traktToken = nil } else if let token = token(from: value) { credentials.traktToken = token }
        }
        if let value = object["simkl"] {
            if case .null = value { credentials.simklToken = nil } else if let token = token(from: value) { credentials.simklToken = token }
        }
    }

    static func applyRequests(_ data: JSONValue, to settings: inout AppSettings) {
        guard let value = data.object?["seerr"] else { return }
        if case .null = value { settings.mediaServers.seerr = nil } else if let config = seerr(from: value) { settings.mediaServers.seerr = config }
    }

    static func addons(from list: [JSONValue]) -> [AddonConfig] {
        list.compactMap { value in
            guard let object = value.object, let text = object["url"]?.string, let url = URL(string: text), url.scheme != nil else { return nil }
            return AddonConfig(manifestURL: url, name: object["name"]?.string ?? url.host ?? "Add-on", enabled: object["enabled"]?.bool ?? true)
        }
    }

    /// Servers keep what is local to this device (whether one is switched on here, whether it's remote, the
    /// Home row choice) when the synced list still has them.
    static func servers(from list: [JSONValue], existing: [MediaServerConfig]) -> [MediaServerConfig] {
        let local = Dictionary(existing.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return list.compactMap { value in
            guard let object = value.object, let id = object["id"]?.string, !id.isEmpty,
                  let kind = object["kind"]?.string.flatMap(MediaServerKind.init(rawValue:)),
                  let text = object["url"]?.string, let url = URL(string: text), url.scheme != nil else { return nil }
            var server = local[id] ?? MediaServerConfig(id: id, kind: kind, name: "", baseURL: url)
            server.kind = kind
            server.name = object["name"]?.string ?? server.name
            server.baseURL = url
            server.accessToken = object["token"]?.string.flatMap { $0.isEmpty ? nil : $0 }
            server.userID = object["userId"]?.string.flatMap { $0.isEmpty ? nil : $0 }
            server.username = object["username"]?.string.flatMap { $0.isEmpty ? nil : $0 }
            server.machineID = object["machineId"]?.string.flatMap { $0.isEmpty ? nil : $0 }
            return server
        }
    }

    static func applyPlayback(_ data: JSONValue, to settings: inout AppSettings) {
        guard let object = data.object else { return }
        if let list = object["audioLanguages"]?.array {
            let languages = list.compactMap { $0.string?.nonEmptyTrimmed }
            settings.playback.preferredAudioLanguage = languages.first
            settings.playback.audioFallbackLanguage = languages.count > 1 ? languages[1] : nil
        }
        if let list = object["subtitleLanguages"]?.array {
            settings.subtitles.preferredLanguages = list.compactMap { $0.string?.nonEmptyTrimmed }
        }
        if let style = object["subtitleStyle"]?.object { applySubtitleStyle(style, to: &settings.subtitles) }
    }

    /// One key at a time, so a value from a newer app that this one can't read (a font it doesn't have)
    /// costs that key and not the rest.
    static func applySubtitleStyle(_ style: [String: JSONValue], to subtitles: inout SubtitleSettings) {
        for key in subtitleStyleKeys {
            guard let value = style[key],
                  let encoded = try? JSONEncoder.flow.encode(subtitles),
                  var current = (try? JSONDecoder().decode(JSONValue.self, from: encoded))?.object else { continue }
            current[key] = value
            guard let data = try? JSONEncoder.flow.encode(JSONValue.object(current)),
                  let decoded = try? JSONDecoder.flow.decode(SubtitleSettings.self, from: data) else { continue }
            subtitles = decoded
        }
    }

    /// Signing in once should sign in everywhere: when a Trakt or Simkl sign-in arrives through Sync on a device
    /// that still tracks only on itself, tracking and the watchlist move to that service, as the sign-in sheet would.
    /// A device that already chose a tracker keeps it, and so does one whose sign-in was there before.
    public static func adoptTracker(_ account: inout AccountSettings, before: Credentials, after: Credentials) {
        guard account.tracker == .local else { return }
        if before.traktToken == nil, after.traktToken != nil {
            account.tracker = .trakt
            account.watchlistDestination = .trakt
        } else if before.simklToken == nil, after.simklToken != nil {
            account.tracker = .simkl
            account.watchlistDestination = .simkl
        }
    }

    // MARK: Comparing

    /// What a section reads back as once this version has applied it: the shape the local mapping produces.
    /// Two devices that agree on a section agree on this, whatever extra fields the data carries. `base` is how the
    /// device had the section before, for data that only carries some of its fields (the website writes one key).
    public static func normalized(_ data: JSONValue, section: String, over base: JSONValue? = nil) -> JSONValue {
        var credentials = Credentials()
        var settings = AppSettings()
        if let base { apply(base, to: section, credentials: &credentials, settings: &settings) }
        apply(data, to: section, credentials: &credentials, settings: &settings)
        return sections(credentials: credentials, settings: settings)[section] ?? data
    }

    /// Nothing in it yet: a device that has never filled in keys, accounts, add-ons, servers, Seerr or Sports.
    /// Playback always has defaults, so it never counts as empty.
    public static func isBlank(_ data: JSONValue, section: String) -> Bool {
        switch section {
        case FlowSyncSectionName.keys:
            return (data.object ?? [:]).values.allSatisfy { value in
                if case .null = value { return true }
                return value.string?.isEmpty ?? false
            }
        case FlowSyncSectionName.accounts:
            return (data.object ?? [:]).values.allSatisfy { if case .null = $0 { return true } else { return false } }
        case FlowSyncSectionName.addons, FlowSyncSectionName.servers:
            return data.array?.isEmpty ?? true
        case FlowSyncSectionName.requests:
            guard let value = data.object?["seerr"] else { return true }
            if case .null = value { return true }
            return seerr(from: value) == nil
        case FlowSyncSectionName.sports:
            // Still the defaults: nothing to say, so a device that never followed a team doesn't write one.
            var sports = SportsSettings()
            applySports(data, to: &sports)
            return sports == SportsSettings()
        default:
            return false
        }
    }
}

extension String {
    var nonEmptyTrimmed: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
