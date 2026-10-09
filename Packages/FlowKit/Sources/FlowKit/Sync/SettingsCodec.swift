import Foundation

/// Decodes settings JSON leniently: any key missing from the stored JSON takes its
/// default value, so adding a setting never invalidates saved data or old exports.
public enum SettingsCodec {
    public static func decode<T: Codable>(_ type: T.Type, from data: Data, defaults: T) throws -> T {
        let encoder = JSONEncoder.flow
        let defaultObject = try JSONSerialization.jsonObject(with: encoder.encode(defaults))
        let stored = try JSONSerialization.jsonObject(with: data)
        let merged = deepMerge(base: defaultObject, overlay: stored)
        let mergedData = try JSONSerialization.data(withJSONObject: merged)
        return try JSONDecoder.flow.decode(T.self, from: mergedData)
    }

    public static func encode<T: Encodable>(_ value: T, pretty: Bool = false) throws -> Data {
        let encoder = JSONEncoder.flow
        if pretty { encoder.outputFormatting = [.sortedKeys, .prettyPrinted] }
        return try encoder.encode(value)
    }

    /// Objects merge key by key; anything else (arrays, scalars) is replaced by the overlay.
    /// Enum-with-payload values encode as single-key objects; when the overlay picks a
    /// different case the base's keys must not leak in, so overlay objects whose keys are
    /// disjoint from the base replace it wholesale.
    static func deepMerge(base: Any, overlay: Any) -> Any {
        guard let b = base as? [String: Any], let o = overlay as? [String: Any] else { return overlay }
        if !b.isEmpty, !o.isEmpty, Set(b.keys).isDisjoint(with: o.keys) { return o }
        var result = b
        for (key, value) in o {
            if value is NSNull { continue }
            result[key] = result[key].map { deepMerge(base: $0, overlay: value) } ?? value
        }
        return result
    }
}

// MARK: - Share / Import Setup

/// What "Share Setup" exports: every setting, optionally with secrets.
public struct SetupBundle: Codable, Sendable {
    public var format = "flow-setup"
    public var version = 1
    public var exportedAt = Date()
    public var settings: AppSettings
    public var credentials: Credentials?

    public init(settings: AppSettings, credentials: Credentials?) {
        self.settings = settings
        self.credentials = credentials
    }
}

public enum SetupShare {
    public static let urlScheme = "flow"

    /// Strips device-specific and secret fields when the user exports without secrets.
    public static func sanitized(_ settings: AppSettings, includeSecrets: Bool) -> AppSettings {
        var s = settings
        s.sync.lastCloudSync = nil
        s.sync.lastTrackerSync = nil
        guard !includeSecrets else { return s }
        s.mediaServers.servers = s.mediaServers.servers.map { var c = $0; c.accessToken = nil; c.userID = nil; return c }
        s.webDAV = s.webDAV.map { var c = $0; c.password = nil; return c }
        s.liveTV.providers = s.liveTV.providers.map { var c = $0; c.password = nil; return c }
        return s
    }

    public static func export(settings: AppSettings, credentials: Credentials, includeSecrets: Bool) throws -> Data {
        var creds = credentials
        creds.traktToken = nil
        creds.simklToken = nil
        let bundle = SetupBundle(settings: sanitized(settings, includeSecrets: includeSecrets), credentials: includeSecrets ? creds : nil)
        return try SettingsCodec.encode(bundle, pretty: true)
    }

    /// Compact text form for pasting or QR codes: flow://setup?d=<base64url>
    public static func exportLink(settings: AppSettings, credentials: Credentials, includeSecrets: Bool) throws -> String {
        let data = try SettingsCodec.encode(SetupBundle(settings: sanitized(settings, includeSecrets: includeSecrets), credentials: includeSecrets ? credentials : nil))
        return "\(urlScheme)://setup?d=" + base64URL(data)
    }

    /// Accepts the JSON file, the flow:// link, or bare base64.
    public static func importBundle(_ input: Data) throws -> SetupBundle {
        var data = input
        if let text = String(data: input, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.hasPrefix("{") {
            var payload = text
            if let components = URLComponents(string: text), let d = components.queryItems?.first(where: { $0.name == "d" })?.value { payload = d }
            guard let decoded = decodeBase64URL(payload) else { throw FlowError.decoding("Not a Flow setup") }
            data = decoded
        }
        let defaults = SetupBundle(settings: AppSettings(), credentials: nil)
        let bundle = try SettingsCodec.decode(SetupBundle.self, from: data, defaults: defaults)
        guard bundle.format == "flow-setup" else { throw FlowError.decoding("Not a Flow setup") }
        return bundle
    }

    /// Applies an import on top of the current setup, keeping secrets the import doesn't carry.
    public static func apply(_ bundle: SetupBundle, to settings: AppSettings, credentials: Credentials) -> (AppSettings, Credentials) {
        var s = bundle.settings
        let existingServers = Dictionary(settings.mediaServers.servers.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        s.mediaServers.servers = s.mediaServers.servers.map { server in
            var c = server
            if c.accessToken == nil, let old = existingServers[c.id] { c.accessToken = old.accessToken; c.userID = old.userID }
            return c
        }
        s.sync = settings.sync
        var creds = credentials
        if let incoming = bundle.credentials {
            // Only overwrite a secret when the import actually carries one.
            func pick(_ new: String?, _ old: String?) -> String? { (new?.isEmpty == false) ? new : old }
            creds.tmdbAPIKey = pick(incoming.tmdbAPIKey, creds.tmdbAPIKey)
            creds.tvdbAPIKey = pick(incoming.tvdbAPIKey, creds.tvdbAPIKey)
            creds.mdblistAPIKey = pick(incoming.mdblistAPIKey, creds.mdblistAPIKey)
            creds.publicMetaDBAPIKey = pick(incoming.publicMetaDBAPIKey, creds.publicMetaDBAPIKey)
            creds.introDBAPIKey = pick(incoming.introDBAPIKey, creds.introDBAPIKey)
            creds.openSubtitlesAPIKey = pick(incoming.openSubtitlesAPIKey, creds.openSubtitlesAPIKey)
            creds.openSubtitlesUsername = pick(incoming.openSubtitlesUsername, creds.openSubtitlesUsername)
            creds.openSubtitlesPassword = pick(incoming.openSubtitlesPassword, creds.openSubtitlesPassword)
            creds.subdlAPIKey = pick(incoming.subdlAPIKey, creds.subdlAPIKey)
            creds.subSourceAPIKey = pick(incoming.subSourceAPIKey, creds.subSourceAPIKey)
            creds.traktClientID = pick(incoming.traktClientID, creds.traktClientID)
            creds.traktClientSecret = pick(incoming.traktClientSecret, creds.traktClientSecret)
            creds.simklClientID = pick(incoming.simklClientID, creds.simklClientID)
        }
        return (s, creds)
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func decodeBase64URL(_ string: String) -> Data? {
        var s = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
}
