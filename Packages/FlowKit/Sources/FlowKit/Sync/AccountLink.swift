import Foundation

/// Why an account link couldn't be used, in words that say what to do next.
public enum AccountLinkError: Error, LocalizedError, Equatable, Sendable {
    /// Not an account link at all.
    case invalidLink
    case incompleteNumber
    case invalidServer

    public var errorDescription: String? {
        switch self {
        case .invalidLink: return "That isn't a Marquee account link. Open it again from Settings → Account on the website."
        case .incompleteNumber: return "That link's account number isn't complete. Open it again from Settings → Account on the website."
        case .invalidServer: return "That link's server address doesn't look right. Open it again from Settings → Account on the website."
        }
    }
}

/// The link that logs an app in to a Marquee Account: `flow://account?n=<16 digits>&s=<server origin>` (docs/SYNC.md,
/// The account link). The website builds it behind a Show step, because the number is the account's key.
public struct AccountLink: Equatable, Sendable {
    public static let scheme = "flow"
    public static let host = "account"

    /// The 16 digits, no spaces.
    public var number: String
    /// The account server's origin, like `https://example.workers.dev`.
    public var server: String

    /// Checks and tidies both values the way a typed number and server are.
    public init(number: String, server: String) throws {
        guard let digits = AccountNumber.parse(number) else { throw AccountLinkError.incompleteNumber }
        guard let origin = try? FlowSyncPairing.normalizedServer(server) else { throw AccountLinkError.invalidServer }
        self.number = digits
        self.server = origin
    }

    /// The host alone, for saying which server a link would use.
    public var serverHost: String { URL(string: server)?.host ?? server }

    /// The last four digits, which are all a confirmation needs to say.
    public var lastFour: String { String(number.suffix(4)) }

    /// Exactly what `encodeURIComponent` leaves alone, so a link made here is the same text as one made on the website.
    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!'()*")

    public var url: String {
        "\(Self.scheme)://\(Self.host)?n=\(number)&s=\(server.addingPercentEncoding(withAllowedCharacters: Self.unreserved) ?? server)"
    }

    /// Reads a link. Throws `invalidLink` for anything that isn't an account link, and `incompleteNumber` or
    /// `invalidServer` when it is the right shape but a value in it is wrong. The first of a repeated parameter counts,
    /// and a plus is a plus, as on the website.
    public static func parse(_ input: String) throws -> AccountLink {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.lowercased().hasPrefix("\(scheme)://\(host)?"), let mark = text.firstIndex(of: "?") else { throw AccountLinkError.invalidLink }
        let rest = text[text.index(after: mark)...]
        let query = rest.firstIndex(of: "#").map { rest[..<$0] } ?? rest
        var values: [String: String] = [:]
        for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else { continue }
            let name = String(parts[0])
            if values[name] == nil { values[name] = String(parts[1]).removingPercentEncoding ?? String(parts[1]) }
        }
        return try AccountLink(number: values["n"] ?? "", server: values["s"] ?? "")
    }
}

/// What opening an account link should do on a device, decided from what the device already has. Pure, so each case is
/// tested; the app only shows the answer.
public struct AccountLinkPlan: Equatable, Sendable {
    public enum Relation: Equatable, Sendable {
        /// Not logged in: confirm, then log in.
        case loggedOut
        /// Logged in to this very account (same number on the same server): say so, change nothing.
        case sameAccount
        /// Logged in to another account (or the same number on another server): ask before switching.
        case otherAccount
    }

    public var relation: Relation
    /// The build names its own account server and the link names a different one: ask which to use.
    public var serverConflict: Bool
    /// The server to keep as the typed Account Server once the login works: only for a build that has none of its own.
    public var serverToSave: String?

    public init(link: AccountLink, current: AccountCredentials?, builtInServer: String?) {
        if let current {
            relation = current.number == link.number && current.server == link.server ? .sameAccount : .otherAccount
        } else {
            relation = .loggedOut
        }
        serverConflict = builtInServer.map { $0 != link.server } ?? false
        serverToSave = builtInServer == nil ? link.server : nil
    }
}
