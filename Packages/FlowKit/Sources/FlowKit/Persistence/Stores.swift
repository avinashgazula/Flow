import Foundation
#if canImport(Security)
import Security
#endif

/// Atomic JSON files in Application Support (or a caller-provided directory).
public struct JSONFileStore: Sendable {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public static func applicationSupport(_ folder: String = "Flow") -> JSONFileStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return JSONFileStore(directory: base.appendingPathComponent(folder, isDirectory: true))
    }

    public static func caches(_ folder: String = "Flow") -> JSONFileStore {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return JSONFileStore(directory: base.appendingPathComponent(folder, isDirectory: true))
    }

    func url(_ name: String) -> URL { directory.appendingPathComponent(name + ".json") }

    public func load<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: url(name)) else { return nil }
        return try? JSONDecoder.flow.decode(T.self, from: data)
    }

    public func loadData(_ name: String) -> Data? { try? Data(contentsOf: url(name)) }

    public func save<T: Encodable>(_ value: T, _ name: String) {
        guard let data = try? JSONEncoder.flow.encode(value) else { return }
        try? data.write(to: url(name), options: .atomic)
    }

    public func remove(_ name: String) { try? FileManager.default.removeItem(at: url(name)) }

    public func modificationDate(_ name: String) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url(name).path))?[.modificationDate] as? Date
    }

    public func removeAll() {
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] {
            try? FileManager.default.removeItem(at: file)
        }
    }

    public var sizeInBytes: Int64 {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return files.reduce(0) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }
}

/// A small expiring cache on top of JSONFileStore for API responses.
public actor ResponseCache {
    struct Entry<T: Codable>: Codable { var storedAt: Date; var value: T }
    let store: JSONFileStore
    private var memory: [String: (Date, Any)] = [:]

    public init(store: JSONFileStore) { self.store = store }

    public func value<T: Codable & Sendable>(_ key: String, maxAge: TimeInterval, as type: T.Type = T.self) -> T? {
        if let (date, value) = memory[key], Date().timeIntervalSince(date) < maxAge, let typed = value as? T { return typed }
        guard let entry = store.load(Entry<T>.self, Self.fileName(key)), Date().timeIntervalSince(entry.storedAt) < maxAge else { return nil }
        memory[key] = (entry.storedAt, entry.value)
        return entry.value
    }

    public func set<T: Codable & Sendable>(_ value: T, for key: String) {
        memory[key] = (Date(), value)
        store.save(Entry(storedAt: Date(), value: value), Self.fileName(key))
    }

    /// Returns a cached value or computes and stores a fresh one.
    public func cached<T: Codable & Sendable>(_ key: String, maxAge: TimeInterval, _ produce: @Sendable () async throws -> T) async throws -> T {
        if let hit: T = value(key, maxAge: maxAge) { return hit }
        let fresh = try await produce()
        set(fresh, for: key)
        return fresh
    }

    public func clear() {
        memory = [:]
        store.removeAll()
    }

    static func fileName(_ key: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in key.utf8 { hash = (hash ^ UInt64(byte)) &* 0x100000001b3 }
        return "c_" + String(hash, radix: 16)
    }
}

/// Secrets storage. Keychain on Apple platforms; a file fallback elsewhere (tests, Linux).
public protocol SecretStore: Sendable {
    func load() -> Credentials
    func save(_ credentials: Credentials)
}

public struct FileSecretStore: SecretStore {
    let store: JSONFileStore
    public init(store: JSONFileStore) { self.store = store }
    public func load() -> Credentials { store.load(Credentials.self, "credentials") ?? Credentials() }
    public func save(_ credentials: Credentials) { store.save(credentials, "credentials") }
}

#if canImport(Security)
public struct KeychainSecretStore: SecretStore {
    let service: String
    let account = "credentials"
    /// When true the item syncs through iCloud Keychain to the user's other devices.
    let synchronizable: Bool

    public init(service: String = "app.flow.credentials", synchronizable: Bool = true) {
        self.service = service
        self.synchronizable = synchronizable
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: synchronizable ? kCFBooleanTrue as Any : kCFBooleanFalse as Any]
    }

    public func load() -> Credentials {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data,
              let creds = try? JSONDecoder.flow.decode(Credentials.self, from: data) else { return Credentials() }
        return creds
    }

    public func save(_ credentials: Credentials) {
        guard let data = try? JSONEncoder.flow.encode(credentials) else { return }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery
            add.merge(attributes) { _, b in b }
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}
#endif
