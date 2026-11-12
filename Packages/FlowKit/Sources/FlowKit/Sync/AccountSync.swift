import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Security)
import Security
#endif

// MARK: - The server

/// Which account server the app talks to (docs/SYNC.md, "The account server"). The build names one in
/// `FLOW_ACCOUNT_SERVER_HOST`, so Log In needs only the number; a build without one asks for an address under Settings.
public enum AccountServer {
    /// `https://` plus a host name (a build setting can't hold `//`, which starts a comment there). A full address typed
    /// by a person works too. Nil for nothing, or for something that isn't an address.
    public static func url(_ input: String?) -> URL? {
        guard let input, !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let origin = try? FlowSyncPairing.normalizedServer(input) else { return nil }
        return URL(string: origin)
    }

    /// The build's own address, or the one typed on this device. The build wins, as on the website.
    public static func resolve(build: String?, typed: String?) -> URL? { url(build) ?? url(typed) }

    public static func normalize(_ input: String) throws -> String {
        do { return try FlowSyncPairing.normalizedServer(input) } catch { throw AccountError.invalidServer }
    }
}

// MARK: - What a device keeps of its account

/// The number and the server it belongs to. The number is the account's one secret: it lives in the keychain, never in a
/// backup, a setup file or a log.
public struct AccountCredentials: Codable, Equatable, Sendable {
    public var number: String
    public var server: String

    public init(number: String, server: String) {
        self.number = number
        self.server = server
    }
}

public protocol AccountCredentialStore: Sendable {
    func load() -> AccountCredentials?
    /// Nil forgets the account.
    func save(_ credentials: AccountCredentials?)
}

public final class InMemoryAccountCredentialStore: AccountCredentialStore, @unchecked Sendable {
    private var credentials: AccountCredentials?
    private let lock = NSLock()
    public init(_ credentials: AccountCredentials? = nil) { self.credentials = credentials }
    public func load() -> AccountCredentials? { lock.lock(); defer { lock.unlock() }; return credentials }
    public func save(_ credentials: AccountCredentials?) { lock.lock(); self.credentials = credentials; lock.unlock() }
}

/// A file in the app's own folder, for platforms without a keychain (tests, Linux).
public struct FileAccountCredentialStore: AccountCredentialStore {
    let store: JSONFileStore
    public init(store: JSONFileStore) { self.store = store }
    public func load() -> AccountCredentials? { store.load(AccountCredentials.self, "account-credentials") }
    public func save(_ credentials: AccountCredentials?) {
        if let credentials { store.save(credentials, "account-credentials") } else { store.remove("account-credentials") }
    }
}

#if canImport(Security)
/// The keychain, never synchronizable (so it stays out of iCloud Keychain) and never restored onto another device.
public struct KeychainAccountCredentialStore: AccountCredentialStore {
    let service: String
    let account = "marquee-account"

    public init(service: String = "app.flow.account") { self.service = service }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }

    public func load() -> AccountCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(AccountCredentials.self, from: data)
    }

    public func save(_ credentials: AccountCredentials?) {
        guard let credentials else {
            SecItemDelete(baseQuery as CFDictionary)
            return
        }
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery
            add.merge(attributes) { _, b in b }
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}
#endif

/// What this device last synced: each value's revision and hash (so only changed values are read and written), the
/// settings' per-section times, the account's settings as last merged, and the library as last merged. With it, a pull can
/// tell the account's changes from its own, and a removal from a title this device never had. If it is lost, everything
/// is read again and merged.
public struct AccountSyncState: Codable, Equatable, Sendable {
    public var revs: [String: Int] = [:]
    public var hashes: [String: String] = [:]
    public var settings = FlowSyncState()
    public var settingsCopy: JSONValue?
    public var base = AccountWire.State()
    public var lastSyncedAt: Date?

    public init() {}
}

// MARK: - The routes

public struct AccountRecord: Equatable, Sendable {
    public var rev: Int
    public var blob: String
    public var updatedAt: String?
}

public struct AccountManifest: Equatable, Sendable {
    public struct Info: Equatable, Sendable {
        public var rev: Int
        public var updatedAt: String?
        public var size: Int?
    }
    public var createdAt: String?
    public var sections: [String: Info]
}

/// Talks to `/account/<id>` on the Worker (docs/SYNC.md, "Worker API"). Everything it sends is already encrypted, and the
/// number never leaves the device: only `auth`, the proof derived from it, does.
public struct AccountClient: Sendable {
    public enum WriteResult: Equatable, Sendable {
        case written(rev: Int)
        /// The stored revision wasn't the one this write was based on. `blob` is nil when nothing is stored.
        case conflict(rev: Int, blob: String?)
    }

    public let server: URL
    public let keys: AccountKeys
    let http: HTTPClient
    let sealer: FlowSyncSealer

    public init(server: URL, keys: AccountKeys, http: HTTPClient = HTTPClient(), sealer: FlowSyncSealer = FlowSyncCrypto.platform) {
        self.server = server
        self.keys = keys
        self.http = http
        self.sealer = sealer
    }

    private func request(_ method: HTTPMethod, section: String? = nil, body: (rev: Int, blob: String)? = nil) throws -> HTTPRequest {
        let path = "/account/" + keys.id + (section.map { "/" + $0 } ?? "")
        guard let url = URL(string: server.absoluteString + path) else { throw AccountError.invalidServer }
        var request = HTTPRequest(method, url: url, headers: ["Authorization": "Bearer " + keys.auth])
        if let body {
            struct Body: Encodable { var rev: Int; var blob: String }
            try request.setJSONBody(Body(rev: body.rev, blob: body.blob))
        }
        return request
    }

    /// Sends the request and hands every status back, so each route can say what its statuses mean.
    private func send(_ request: HTTPRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await http.data(request, acceptStatus: 200..<600)
            return (data, response.statusCode)
        } catch is CancellationError {
            throw CancellationError()
        } catch FlowError.cancelled {
            throw CancellationError()
        } catch {
            throw AccountError.unreachable
        }
    }

    static func failure(status: Int) -> AccountError {
        switch status {
        case 401, 404: return .noSuchAccount
        case 403: return .originNotAllowed
        case 413: return .tooLarge
        case 429: return .limited
        case 501: return .needsKV
        case 500...: return .server(status: status)
        default: return .unexpectedResponse
        }
    }

    /// Creates the account. False when the number is taken (`409`): draw another.
    public func create() async throws -> Bool {
        let (_, status) = try await send(request(.post))
        switch status {
        case 201: return true
        case 409: return false
        default: throw Self.failure(status: status)
        }
    }

    /// Every value the account holds, by name, with its revision. A read of the account, not of its values.
    public func manifest() async throws -> AccountManifest {
        let (data, status) = try await send(request(.get))
        guard status == 200 else { throw Self.failure(status: status) }
        struct Body: Decodable {
            struct Info: Decodable { var rev: Int; var updatedAt: String?; var size: Int? }
            var createdAt: String?
            var sections: [String: Info]?
        }
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw AccountError.unexpectedResponse }
        return AccountManifest(createdAt: body.createdAt, sections: (body.sections ?? [:]).mapValues { AccountManifest.Info(rev: $0.rev, updatedAt: $0.updatedAt, size: $0.size) })
    }

    /// One value, or nil when the account has none by that name yet.
    public func read(_ section: String) async throws -> AccountRecord? {
        let (data, status) = try await send(request(.get, section: section))
        switch status {
        case 200:
            struct Body: Decodable { var rev: Int; var blob: String; var updatedAt: String? }
            guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw AccountError.unreadable }
            return AccountRecord(rev: body.rev, blob: body.blob, updatedAt: body.updatedAt)
        case 204: return nil
        default: throw Self.failure(status: status)
        }
    }

    /// `rev` is the revision this write is based on, 0 for a new value.
    public func write(_ section: String, rev: Int, blob: String) async throws -> WriteResult {
        let (data, status) = try await send(request(.put, section: section, body: (rev, blob)))
        switch status {
        case 200:
            struct Written: Decodable { var rev: Int }
            guard let written = try? JSONDecoder().decode(Written.self, from: data) else { throw AccountError.unexpectedResponse }
            return .written(rev: written.rev)
        case 409:
            struct Body: Decodable { var rev: Int?; var blob: String? }
            guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw AccountError.unexpectedResponse }
            return .conflict(rev: body.rev ?? 0, blob: body.blob)
        default: throw Self.failure(status: status)
        }
    }

    /// Deletes the account and every value in it.
    public func delete() async throws {
        let (_, status) = try await send(request(.delete))
        switch status {
        case 200..<300, 404: return
        default: throw Self.failure(status: status)
        }
    }

    public func open(_ record: AccountRecord, section: String) throws -> String { try keys.open(record.blob, section: section, sealer: sealer) }
    public func seal(_ plaintext: String, section: String) throws -> String { try keys.seal(plaintext, section: section, sealer: sealer) }
}

// MARK: - Create and log in

public enum AccountLifecycle {
    /// Creating retries with a new number when one is taken (it almost never is: 10^16 numbers).
    public static let maxCreateTries = 5

    /// Draws a number, derives its keys and registers it. The number comes back for the "write this down" step.
    public static func create(server: URL, http: HTTPClient = HTTPClient(), sealer: FlowSyncSealer = FlowSyncCrypto.platform,
                              iterations: Int = AccountKeys.iterations, randomBytes: (Int) -> [UInt8] = AccountNumber.systemBytes) async throws -> (number: String, client: AccountClient) {
        for _ in 0..<maxCreateTries {
            let number = AccountNumber.generate(randomBytes: randomBytes)
            let client = AccountClient(server: server, keys: await AccountKeys.derive(number: number, iterations: iterations), http: http, sealer: sealer)
            if try await client.create() { return (number, client) }
        }
        throw AccountError.taken
    }

    /// Checks a typed number against the account server: nothing is kept unless an account answers to it.
    public static func login(number input: String, server: URL, http: HTTPClient = HTTPClient(), sealer: FlowSyncSealer = FlowSyncCrypto.platform,
                             iterations: Int = AccountKeys.iterations) async throws -> (number: String, client: AccountClient) {
        let number = try AccountNumber.require(input)
        let client = AccountClient(server: server, keys: await AccountKeys.derive(number: number, iterations: iterations), http: http, sealer: sealer)
        _ = try await client.manifest()
        return (number, client)
    }
}

// MARK: - One sync

/// What this device holds, for a round of syncing.
public struct AccountLocal: Sendable {
    /// `FlowSyncMapping.sections`: every settings section as this device has it.
    public var settings: [String: JSONValue]
    public var library: LocalLibrary
    public var sources: [String: LastSource]
    public var order: AccountOrder?

    public init(settings: [String: JSONValue], library: LocalLibrary, sources: [String: LastSource], order: AccountOrder?) {
        self.settings = settings
        self.library = library
        self.sources = sources
        self.order = order
    }
}

public struct AccountOutcome: Sendable {
    public var state: AccountSyncState
    /// Settings sections the account's copy won, with that data, for the app to put into its own settings.
    public var settingsApply: [String: JSONValue]
    /// The merged library, remembered sources and order, for the app to put in place of its own.
    public var library: LocalLibrary
    public var sources: [String: LastSource]
    public var order: AccountOrder?
    public var pushed: Bool
}

/// Reads the account, merges it with this device, and writes what is newer here (docs/SYNC.md, "When devices talk").
public struct AccountSyncEngine: Sendable {
    /// Passes made when another device keeps getting in first.
    public static let maxPasses = 4
    /// A value's plaintext past this would be over the Worker's 256 KB once encrypted and encoded.
    static let valueLimit = 190_000

    public let client: AccountClient
    /// What this device is called in the settings sections it writes.
    public let device: String

    public init(client: AccountClient, device: String) {
        self.client = client
        self.device = device
    }

    private static func short(_ text: String) -> String { String(FlowSyncKDF.sha256Hex(Data(AccountWire.canonicalText(text).utf8)).prefix(16)) }

    public func sync(local: AccountLocal, state start: AccountSyncState, now: Date = Date()) async throws -> AccountOutcome {
        do {
            return try await run(local: local, start: start, now: now)
        } catch AccountError.noSuchAccount {
            // Reading an account that answered a minute ago and now doesn't know the number: deleted elsewhere.
            throw AccountError.gone
        }
    }

    private func fetch(_ names: [String]) async throws -> [(name: String, record: AccountRecord)] {
        var found: [(name: String, record: AccountRecord)] = []
        var index = 0
        while index < names.count {
            let batch = Array(names[index..<min(index + 4, names.count)])
            index += 4
            let client = self.client
            try await withThrowingTaskGroup(of: (String, AccountRecord?).self) { group in
                for name in batch { group.addTask { (name, try await client.read(name)) } }
                for try await (name, record) in group { if let record { found.append((name, record)) } }
            }
        }
        return found
    }

    private func run(local: AccountLocal, start: AccountSyncState, now: Date) async throws -> AccountOutcome {
        let nowMs = AccountTime.ms(now)
        var revs = start.revs, hashes = start.hashes
        var plain: [String: String] = [:]

        func take(_ name: String, _ record: AccountRecord) throws {
            let text = try client.open(record, section: name)
            plain[name] = text
            revs[name] = record.rev
            hashes[name] = Self.short(text)
        }

        // Only values whose revision differs from the one last seen are read.
        let manifest = try await client.manifest()
        let wanted = manifest.sections
            .filter { ($0.key == AccountWire.settingsSection || AccountWire.isLibrarySection($0.key)) && $0.value.rev != revs[$0.key] }
            .keys.sorted()
        for (name, record) in try await fetch(wanted) { try take(name, record) }

        var settingsRemote: FlowSyncPayload? = start.settingsCopy.flatMap { try? FlowSyncPayload(json: $0) }
        var pushed = false

        for pass in 1... {
            if let text = plain[AccountWire.settingsSection] {
                guard let payload = try? FlowSyncPayload(plaintext: Data(text.utf8)) else { throw AccountError.unreadable }
                if payload.version > 1 { throw AccountError.newerVersion }
                settingsRemote = payload
            }
            let read = AccountWire.read(plain.filter { $0.key != AccountWire.settingsSection })
            if !read.newer.isEmpty { throw AccountError.newerVersion }
            if !read.unreadable.isEmpty { throw AccountError.unreadable }

            // Settings: the same rules as Marquee Sync, against what this device last synced.
            let settings = FlowSyncMerge.merge(local: local.settings, state: start.settings, remote: settingsRemote, device: device, now: now)

            // The library: what this device holds, merged with what it last synced laid under what the account says now.
            let remoteLibrary = AccountWire.merge(start.base, read.state, now: nowMs)
            var mine = AccountBridge.state(library: local.library, sources: local.sources, order: local.order)
            // A card the account already has stays as it is: two devices that each insisted on their own would rewrite it for ever.
            mine.items = mine.items.filter { remoteLibrary.items[$0.key] == nil }
            let merged = AccountWire.merge(mine, remoteLibrary, now: nowMs)

            var out = AccountWire.write(merged, now: nowMs)
            if !settings.payload.sections.isEmpty { out[AccountWire.settingsSection] = AccountWire.canonical(settings.payload.json) }

            var conflict = false
            for name in out.keys.sorted() {
                guard let text = out[name] else { continue }
                let hash = Self.short(text)
                if hashes[name] == hash { continue }
                if text.utf16.count > Self.valueLimit { throw AccountError.tooLarge }
                switch try await client.write(name, rev: revs[name] ?? 0, blob: client.seal(text, section: name)) {
                case .written(let rev):
                    revs[name] = rev
                    hashes[name] = hash
                    pushed = true
                case .conflict(let rev, let blob):
                    // Another device wrote this value first: take its version and go round again.
                    if let blob { try take(name, AccountRecord(rev: rev, blob: blob, updatedAt: nil)) } else { revs[name] = 0; hashes[name] = nil; plain[name] = nil }
                    conflict = true
                }
                if conflict { break }
            }

            if !conflict {
                var next = start
                next.revs = revs
                next.hashes = hashes
                next.settings.sections = settings.stamps
                next.settingsCopy = settings.payload.json
                next.base = merged
                next.lastSyncedAt = now
                let applied = AccountBridge.apply(merged, to: local.library, sources: local.sources)
                return AccountOutcome(state: next, settingsApply: settings.apply, library: applied.library, sources: applied.sources, order: applied.order, pushed: pushed)
            }
            if pass >= Self.maxPasses { throw AccountError.busy }
        }
        throw AccountError.busy
    }
}
