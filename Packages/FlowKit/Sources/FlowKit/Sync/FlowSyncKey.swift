import Foundation

/// What can go wrong with Flow Sync, in words a viewer can act on (docs/SYNC.md lists the wording).
public enum FlowSyncError: Error, LocalizedError, Equatable, Sendable {
    case incompleteKey
    case invalidLink
    case invalidServer
    case unreachable
    case keyMismatch
    case tooLarge
    case needsKV
    case tooManyConflicts
    case unreadable
    case erased
    case noSuchSync
    case unexpectedResponse
    case server(status: Int)
    case cryptoUnavailable

    public var errorDescription: String? {
        switch self {
        case .incompleteKey: return "That sync key isn't complete. Check it against the one on your other device."
        case .invalidLink: return "That isn't a Flow sync link. Copy it again from your other device."
        case .invalidServer: return "That server address doesn't look right. Use the address of your Worker, like https://flow-stream-proxy.example.workers.dev."
        case .unreachable: return "Couldn't reach your sync server. Check its address and token."
        case .keyMismatch: return "This sync key doesn't match."
        case .tooLarge: return "Your synced settings are too large for the sync server. Remove some add-ons or servers and try again."
        case .needsKV: return "Sync needs a KV namespace bound as SYNC. See web/proxy/README.md."
        case .tooManyConflicts: return "Another device kept changing the synced settings. Flow will try again in a moment."
        case .unreadable: return "Couldn't read the synced settings. Update Flow on this device, or turn sync off and on again."
        case .erased: return "This sync was erased from another device. Turn sync on again to start a new one."
        case .noSuchSync: return "No sync was found for that key. Check the key against your other device, and the server address and token."
        case .unexpectedResponse: return "The sync server answered with something Flow didn't expect. Check that the address is your Worker."
        case .server(let status): return "The sync server answered with status \(status). Try again in a moment."
        case .cryptoUnavailable: return "Sync encryption isn't available on this platform."
        }
    }
}

/// The 16-byte sync key and everything derived from it (docs/SYNC.md, "Pairing" and "Derived values").
public struct FlowSyncKey: Equatable, Hashable, Sendable {
    public static let byteCount = 16
    /// Crockford base32.
    static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    public static let textLength = 26

    public let bytes: Data

    public init?(bytes: Data) {
        guard bytes.count == Self.byteCount else { return nil }
        self.bytes = bytes
    }

    public static func generate() -> FlowSyncKey {
        var generator = SystemRandomNumberGenerator()
        return FlowSyncKey(bytes: Data((0..<byteCount).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))!
    }

    /// The written form: the bytes as one big-endian bit string, zero-padded to a multiple of 5, 26 characters.
    public var text: String {
        var out = ""
        var buffer = 0, bits = 0
        for byte in bytes {
            buffer = (buffer << 8) | Int(byte)
            bits += 8
            while bits >= 5 {
                out.append(Self.alphabet[(buffer >> (bits - 5)) & 31])
                bits -= 5
            }
            buffer &= (1 << bits) - 1
        }
        if bits > 0 { out.append(Self.alphabet[(buffer << (5 - bits)) & 31]) }
        return out
    }

    /// Groups of four joined by `-`, for reading aloud or typing: `000G-40R4-0M30-E209-185G-R38E-1W`.
    public var grouped: String { Self.group(text) }

    static func group(_ text: String) -> String {
        stride(from: 0, to: text.count, by: 4).map { start in
            let from = text.index(text.startIndex, offsetBy: start)
            let to = text.index(from, offsetBy: min(4, text.count - start))
            return String(text[from..<to])
        }.joined(separator: "-")
    }

    /// Uppercases, drops `-` and whitespace, reads `O` as `0` and `I` and `L` as `1`. Anything that isn't
    /// 26 valid characters after that is refused.
    public static func parse(_ input: String) throws -> FlowSyncKey {
        var values: [Int] = []
        for scalar in input.uppercased() {
            if scalar == "-" || scalar.isWhitespace { continue }
            let c: Character = scalar == "O" ? "0" : (scalar == "I" || scalar == "L" ? "1" : scalar)
            guard let value = alphabet.firstIndex(of: c) else { throw FlowSyncError.incompleteKey }
            values.append(value)
        }
        guard values.count == textLength else { throw FlowSyncError.incompleteKey }
        var bytes: [UInt8] = []
        var buffer = 0, bits = 0
        for value in values {
            buffer = (buffer << 5) | value
            bits += 5
            if bits >= 8 {
                bytes.append(UInt8((buffer >> (bits - 8)) & 0xff))
                bits -= 8
            }
            buffer &= (1 << bits) - 1
        }
        // 26 characters carry 130 bits: 128 of key and 2 of padding.
        guard let key = FlowSyncKey(bytes: Data(bytes)) else { throw FlowSyncError.incompleteKey }
        return key
    }

    /// True for text that parses, for enabling a button while someone types.
    public static func isValid(_ input: String) -> Bool { (try? parse(input)) != nil }

    public var derived: FlowSyncDerived { FlowSyncDerived(key: self) }
}

/// `id`, `auth` and `enc`, all from the key through HKDF-SHA256 with salt `flow-sync-v1`.
public struct FlowSyncDerived: Equatable, Sendable {
    static let salt = Data("flow-sync-v1".utf8)

    /// Lowercase hex, 32 characters: the record's name on the server.
    public let id: String
    /// Base64url without padding: proves this device holds the key.
    public let auth: String
    /// The raw AES-256-GCM key.
    public let enc: Data

    init(key: FlowSyncKey) {
        let id = FlowSyncKDF.hkdf(key: key.bytes, salt: Self.salt, info: Data("id".utf8), length: 16)
        self.id = id.map { String(format: "%02x", $0) }.joined()
        self.auth = FlowSyncBase64URL.encode(FlowSyncKDF.hkdf(key: key.bytes, salt: Self.salt, info: Data("auth".utf8), length: 32))
        self.enc = FlowSyncKDF.hkdf(key: key.bytes, salt: Self.salt, info: Data("enc".utf8), length: 32)
    }

    /// The server stores this with the record: the sha256 of the `auth` text, in hex.
    public var authHash: String { FlowSyncKDF.sha256Hex(Data(auth.utf8)) }
}

/// HMAC and HKDF over SHA-256, written out so they run the same on Linux (where CryptoKit isn't there)
/// as on Apple platforms; the digest underneath is CryptoKit's where it exists.
enum FlowSyncKDF {
    static func sha256(_ data: Data) -> Data { PKCE.sha256(data) }

    static func sha256Hex(_ data: Data) -> String { sha256(data).map { String(format: "%02x", $0) }.joined() }

    static func hmacSHA256(key: Data, message: Data) -> Data {
        var block = key.count > 64 ? sha256(key) : key
        block.append(Data(repeating: 0, count: 64 - block.count))
        let inner = Data(block.map { $0 ^ 0x36 }) + message
        let outer = Data(block.map { $0 ^ 0x5c }) + sha256(inner)
        return sha256(outer)
    }

    /// RFC 5869.
    static func hkdf(key: Data, salt: Data, info: Data, length: Int) -> Data {
        let prk = hmacSHA256(key: salt, message: key)
        var output = Data()
        var previous = Data()
        var counter: UInt8 = 1
        while output.count < length {
            previous = hmacSHA256(key: prk, message: previous + info + Data([counter]))
            output.append(previous)
            counter += 1
        }
        return output.prefix(length)
    }
}

/// Base64url without padding, the form blobs and `auth` travel in.
public enum FlowSyncBase64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ string: String) -> Data? {
        var s = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
}
