import Foundation
#if canImport(Security)
import Security
#endif

/// Where the sync key, server and token live on this device. Never somewhere that travels: the key is the
/// only secret in Flow Sync, and the whole point is that only the owner's devices hold it.
public protocol FlowSyncPairingStore: Sendable {
    func load() -> FlowSyncPairing?
    /// Nil forgets the pairing.
    func save(_ pairing: FlowSyncPairing?)
}

public final class InMemoryFlowSyncPairingStore: FlowSyncPairingStore, @unchecked Sendable {
    private var pairing: FlowSyncPairing?
    private let lock = NSLock()
    public init(_ pairing: FlowSyncPairing? = nil) { self.pairing = pairing }
    public func load() -> FlowSyncPairing? { lock.lock(); defer { lock.unlock() }; return pairing }
    public func save(_ pairing: FlowSyncPairing?) { lock.lock(); self.pairing = pairing; lock.unlock() }
}

/// A file in the app's own folder, for platforms without a keychain (tests, Linux) and the sandboxed demo.
public struct FileFlowSyncPairingStore: FlowSyncPairingStore {
    let store: JSONFileStore
    public init(store: JSONFileStore) { self.store = store }
    public func load() -> FlowSyncPairing? { store.load(FlowSyncPairing.self, "sync-pairing") }
    public func save(_ pairing: FlowSyncPairing?) {
        if let pairing { store.save(pairing, "sync-pairing") } else { store.remove("sync-pairing") }
    }
}

#if canImport(Security)
/// The keychain, as a sibling of `KeychainSecretStore(synchronizable: false)`: its own item, never synchronizable
/// (so it stays out of iCloud Keychain) and never restored onto another device.
public struct KeychainFlowSyncPairingStore: FlowSyncPairingStore {
    let service: String
    let account = "pairing"

    public init(service: String = "app.flow.sync") { self.service = service }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }

    public func load() -> FlowSyncPairing? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(FlowSyncPairing.self, from: data)
    }

    public func save(_ pairing: FlowSyncPairing?) {
        guard let pairing else {
            SecItemDelete(baseQuery as CFDictionary)
            return
        }
        guard let data = try? JSONEncoder().encode(pairing) else { return }
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
