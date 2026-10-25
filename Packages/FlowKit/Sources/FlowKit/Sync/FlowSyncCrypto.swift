import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

/// AES-256-GCM for the sync blob. Behind a protocol so the client and the merge logic are tested on Linux,
/// where CryptoKit isn't available and swift-crypto isn't a dependency of FlowKit, with a stand-in that
/// the Apple-only vector test checks the real one against.
public protocol FlowSyncSealer: Sendable {
    /// `nonce || ciphertext || tag`. A nil nonce means a fresh random one (the only thing the app does).
    func seal(_ plaintext: Data, key: Data, aad: Data, nonce: Data?) throws -> Data
    func open(_ combined: Data, key: Data, aad: Data) throws -> Data
}

public enum FlowSyncCrypto {
    /// The sealer the apps use: CryptoKit's AES-GCM on Apple platforms, and one that refuses elsewhere.
    public static var platform: FlowSyncSealer {
        #if canImport(CryptoKit)
        return CryptoKitSealer()
        #else
        return UnavailableSealer()
        #endif
    }

    /// The stored form: base64url without padding of `nonce || ciphertext || tag`, with the record `id` as
    /// the additional authenticated data.
    public static func seal(_ plaintext: Data, derived: FlowSyncDerived, sealer: FlowSyncSealer = platform, nonce: Data? = nil) throws -> String {
        let combined = try sealer.seal(plaintext, key: derived.enc, aad: Data(derived.id.utf8), nonce: nonce)
        return FlowSyncBase64URL.encode(combined)
    }

    public static func open(_ blob: String, derived: FlowSyncDerived, sealer: FlowSyncSealer = platform) throws -> Data {
        guard let combined = FlowSyncBase64URL.decode(blob) else { throw FlowSyncError.unreadable }
        return try sealer.open(combined, key: derived.enc, aad: Data(derived.id.utf8))
    }
}

struct UnavailableSealer: FlowSyncSealer {
    func seal(_ plaintext: Data, key: Data, aad: Data, nonce: Data?) throws -> Data { throw FlowSyncError.cryptoUnavailable }
    func open(_ combined: Data, key: Data, aad: Data) throws -> Data { throw FlowSyncError.cryptoUnavailable }
}

#if canImport(CryptoKit)
/// CryptoKit's `combined` form is nonce, ciphertext and tag in one piece: the bytes WebCrypto returns when the
/// nonce is put in front.
public struct CryptoKitSealer: FlowSyncSealer {
    public init() {}

    public func seal(_ plaintext: Data, key: Data, aad: Data, nonce: Data?) throws -> Data {
        let gcmNonce = try nonce.map { try AES.GCM.Nonce(data: $0) } ?? AES.GCM.Nonce()
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: gcmNonce, authenticating: aad)
        guard let combined = box.combined else { throw FlowSyncError.unreadable }
        return combined
    }

    public func open(_ combined: Data, key: Data, aad: Data) throws -> Data {
        do {
            let box = try AES.GCM.SealedBox(combined: combined)
            return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
        } catch {
            throw FlowSyncError.unreadable
        }
    }
}
#endif
