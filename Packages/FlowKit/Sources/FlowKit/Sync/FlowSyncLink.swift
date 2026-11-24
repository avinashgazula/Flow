import Foundation

/// Everything a device needs to join a sync: the key, the Worker's origin and its token. This is what the
/// keychain holds, and what the pairing link carries.
public struct FlowSyncPairing: Codable, Equatable, Sendable {
    /// The key's 26-character written form.
    public var keyText: String
    /// The Worker's origin, like `https://flow-stream-proxy.example.workers.dev`.
    public var server: String
    public var token: String

    public init(keyText: String, server: String, token: String) {
        self.keyText = keyText
        self.server = server
        self.token = token
    }

    /// Checks and tidies what someone typed: the key in any of its accepted spellings, the server as an
    /// origin (a path, a trailing slash or a missing `https://` don't matter) and the token without stray spaces.
    public init(key input: String, server: String, token: String) throws {
        let key = try FlowSyncKey.parse(input)
        self.init(keyText: key.text, server: try Self.normalizedServer(server), token: token.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    public init(key: FlowSyncKey, server: String, token: String) throws {
        self.init(keyText: key.text, server: try Self.normalizedServer(server), token: token.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    public var key: FlowSyncKey? { try? FlowSyncKey.parse(keyText) }
    public var serverURL: URL? { URL(string: server) }

    /// The host alone, for saying which server a link would join.
    public var serverHost: String { serverURL?.host ?? server }

    public static func normalizedServer(_ input: String) throws -> String {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw FlowSyncError.invalidServer }
        if !text.contains("://") { text = "https://" + text }
        guard let components = URLComponents(string: text), let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = components.host?.lowercased(), !host.isEmpty else { throw FlowSyncError.invalidServer }
        // Foundation on Apple platforms hands back an IPv6 host without its brackets and swift-corelibs-foundation with them.
        let bare = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        var origin = "\(scheme)://" + (bare.contains(":") ? "[\(bare)]" : bare)
        // The default port is part of the scheme, and an origin leaves it out (as the website's does).
        if let port = components.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) { origin += ":\(port)" }
        return origin
    }
}

/// The pairing link: `flow://sync?k=<key>&s=<server>&t=<token>` in the apps, and the same three values in
/// the fragment of the website's settings page, which never reaches a server log.
public enum FlowSyncLink {
    public static let scheme = "flow"
    public static let host = "sync"

    /// Exactly what `encodeURIComponent` leaves alone, so a link made here is the same text as one made on the website.
    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!'()*")

    private static func parameters(_ pairing: FlowSyncPairing) -> String {
        func encode(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value }
        return "k=\(pairing.keyText)&s=\(encode(pairing.server))&t=\(encode(pairing.token))"
    }

    public static func appLink(_ pairing: FlowSyncPairing) -> String {
        "\(scheme)://\(host)?" + parameters(pairing)
    }

    /// `<site origin>/settings#sync=k=<key>&s=<server>&t=<token>`.
    public static func webLink(_ pairing: FlowSyncPairing, site: String) -> String {
        var origin = site.trimmingCharacters(in: .whitespacesAndNewlines)
        while origin.hasSuffix("/") { origin.removeLast() }
        return origin + "/settings#sync=" + parameters(pairing)
    }

    /// Reads either form, or just the key. Throws `invalidLink` for anything that isn't one, and `incompleteKey` or
    /// `invalidServer` when the link is the right shape but a value in it is wrong. A key with no server in it joins
    /// `defaultServer` (this build's own account server); only when there is none either does it throw `noServer`.
    public static func parse(_ input: String, defaultServer: String? = nil) throws -> FlowSyncPairing {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let query: Substring
        if let marker = text.range(of: "#sync=") {
            query = text[marker.upperBound...]
        } else if let mark = text.firstIndex(of: "?") {
            let lower = text.lowercased()
            if lower.hasPrefix("flow:") {
                guard lower.hasPrefix("flow://sync?") || lower.hasPrefix("flow:sync?") else { throw FlowSyncError.invalidLink }
            }
            let rest = text[text.index(after: mark)...]
            query = rest.firstIndex(of: "#").map { rest[..<$0] } ?? rest
        } else if let key = try? FlowSyncKey.parse(text) {
            // Just the key, as the website takes it.
            return try FlowSyncPairing(key: key, server: fallbackServer(defaultServer), token: "")
        } else {
            throw FlowSyncError.invalidLink
        }
        var values: [String: String] = [:]
        for pair in query.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else { continue }
            // The first of a repeated parameter counts, as on the website.
            if values[String(parts[0])] == nil { values[String(parts[0])] = String(parts[1]).removingPercentEncoding ?? String(parts[1]) }
        }
        guard let key = values["k"] else { throw FlowSyncError.invalidLink }
        let server: String
        if let given = values["s"], !given.isEmpty { server = given } else { server = try fallbackServer(defaultServer) }
        return try FlowSyncPairing(key: key, server: server, token: values["t"] ?? "")
    }

    private static func fallbackServer(_ defaultServer: String?) throws -> String {
        guard let defaultServer, !defaultServer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw FlowSyncError.noServer }
        return defaultServer
    }
}
