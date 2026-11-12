import Foundation
#if canImport(CommonCrypto)
import CommonCrypto
#endif

/// What can go wrong with a Marquee Account, in words a viewer can act on (docs/SYNC.md, "Status").
public enum AccountError: Error, LocalizedError, Equatable, Sendable {
    case incompleteNumber
    case noServer
    case invalidServer
    case unreachable
    /// An unknown account and a wrong key look the same on purpose, so the Worker can't be used to look numbers up.
    case noSuchAccount
    case gone
    case limited
    case originNotAllowed
    case needsKV
    case tooLarge
    case unreadable
    case newerVersion
    case busy
    case taken
    case unexpectedResponse
    case server(status: Int)
    case cryptoUnavailable

    public var errorDescription: String? {
        switch self {
        case .incompleteNumber: return AccountNumber.incompleteMessage
        case .noServer: return "This build has no account server set. Enter the address of your Worker under Account Server."
        case .invalidServer: return "That server address doesn’t look right. Use the address of your Worker, like flow-stream-proxy.example.workers.dev."
        case .unreachable: return "Couldn’t reach the account server. Check your connection, then try again."
        case .noSuchAccount: return "No account matches that number. Check it against the one you wrote down."
        case .gone: return "This account no longer exists. If you deleted it on another device, log out here."
        case .limited: return "Too many tries from this network. Wait ten minutes, then try again."
        case .originNotAllowed: return "The account server doesn’t allow this app. Check that the address is your own Worker."
        case .needsKV: return "The account server needs a KV namespace. See web/proxy/README.md."
        case .tooLarge: return "Your library is too big to sync. A value can hold 256 KB."
        case .unreadable: return "Couldn’t read the synced data. Check that the account number here matches your other devices."
        case .newerVersion: return "Your other devices use a newer version of Marquee Accounts. Update Marquee here to keep syncing."
        case .busy: return "Another device kept changing your account while Marquee was syncing. Try Sync Now again."
        case .taken: return "Couldn’t make a new account number. Try again."
        case .unexpectedResponse: return "The account server answered with something Marquee didn’t expect. Check that the address is your Worker."
        case .server(let status): return "The account server had a problem (\(status)). Try again in a moment."
        case .cryptoUnavailable: return "Account encryption isn’t available on this platform."
        }
    }
}

/// The 16-digit account number (docs/SYNC.md, "The account number"): made from random bytes without bias, shown in
/// groups of four, read back ignoring separators.
public enum AccountNumber {
    public static let length = 16
    public static let incompleteMessage = "That account number isn’t complete. It is 16 digits."

    /// Random bytes from the system's secure generator.
    public static func systemBytes(_ count: Int) -> [UInt8] {
        var generator = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    }

    /// 16 digits, each uniform over 0 to 9. A byte below 250 gives a digit by its remainder; the six values above are
    /// thrown away, because keeping them would make 0 to 5 slightly likelier (modulo bias).
    public static func generate(randomBytes: (Int) -> [UInt8] = systemBytes) -> String {
        var digits: [UInt8] = []
        while digits.count < length {
            for byte in randomBytes(32) where byte < 250 && digits.count < length {
                digits.append(UInt8(ascii: "0") + byte % 10)
            }
        }
        return String(decoding: digits, as: UTF8.self)
    }

    /// `1234 5678 9012 3456`: the form shown and copied. Takes any number of digits, for a field that formats as you type.
    public static func group(_ digits: String) -> String {
        var out = ""
        for (index, digit) in digits.enumerated() {
            if index > 0, index % 4 == 0 { out.append(" ") }
            out.append(digit)
        }
        return out
    }

    /// What a field holds while typing: ASCII digits only, at most 16, grouped by four. A paste of
    /// `1234-5678-9012-3456` gives the same text as typing it.
    public static func formatTyped(_ input: String) -> String {
        group(String(input.filter { $0.isASCII && $0.isNumber }.prefix(length)))
    }

    /// The 16 digits of what a person typed or pasted (spaces, dashes and other separators ignored), or nil unless there
    /// are exactly 16.
    public static func parse(_ input: String) -> String? {
        let separators: Set<Character> = [" ", "-", "–", "—", ".", "\n", "\r", "\r\n", "\t", "\u{00A0}"]
        let digits = input.filter { !separators.contains($0) }
        guard digits.count == length, digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return digits
    }

    public static func isValid(_ input: String) -> Bool { parse(input) != nil }

    /// Parses or throws the sentence for an incomplete number.
    public static func require(_ input: String) throws -> String {
        guard let digits = parse(input) else { throw AccountError.incompleteNumber }
        return digits
    }
}

/// `id`, `auth` and the AES key of an account, derived from its number (docs/SYNC.md, "Key derivation").
public struct AccountKeys: Equatable, Sendable {
    public static let iterations = 600_000
    static let pbkdf2Salt = Data("marquee-account-v1".utf8)
    static let hkdfSalt = Data("marquee-account-hkdf-v1".utf8)

    /// The account's name on the server: 32 lowercase hex characters.
    public let id: String
    /// Proves this device knows the number; sent as the bearer token.
    public let auth: String
    /// The raw AES-256-GCM key.
    public let enc: Data

    /// The slow step: 600,000 rounds, about a tenth of a second on a Mac and a good deal more on a phone or an Apple TV.
    /// Don't call it on the main thread; `derive(number:)` hops off it.
    public init(number: String, iterations: Int = AccountKeys.iterations) {
        self.init(master: PBKDF2SHA256.derive(password: Data(number.utf8), salt: Self.pbkdf2Salt, iterations: iterations, length: 32))
    }

    init(master: Data) {
        id = FlowSyncKDF.hkdf(key: master, salt: Self.hkdfSalt, info: Data("id".utf8), length: 16).map { String(format: "%02x", $0) }.joined()
        auth = FlowSyncBase64URL.encode(FlowSyncKDF.hkdf(key: master, salt: Self.hkdfSalt, info: Data("auth".utf8), length: 32))
        enc = FlowSyncKDF.hkdf(key: master, salt: Self.hkdfSalt, info: Data("enc".utf8), length: 32)
    }

    /// The same, off the caller's thread, so Create and Log In can show a busy state without freezing.
    public static func derive(number: String, iterations: Int = AccountKeys.iterations) async -> AccountKeys {
        await Task.detached(priority: .userInitiated) { AccountKeys(number: number, iterations: iterations) }.value
    }

    /// The server stores this with the account: the sha256 of the `auth` text, in hex.
    public var authHash: String { FlowSyncKDF.sha256Hex(Data(auth.utf8)) }

    /// The additional authenticated data of a section: its account and its name, so a value moved to another section or
    /// account doesn't open.
    func aad(_ section: String) -> Data { Data("\(id)/\(section)".utf8) }

    /// `nonce || ciphertext || tag`, base64url without padding, with a fresh random nonce unless a test passes one.
    public func seal(_ plaintext: String, section: String, sealer: FlowSyncSealer = FlowSyncCrypto.platform, nonce: Data? = nil) throws -> String {
        FlowSyncBase64URL.encode(try sealer.seal(Data(plaintext.utf8), key: enc, aad: aad(section), nonce: nonce))
    }

    /// The plaintext of a value, or `.unreadable` when the key is wrong or the value was changed.
    public func open(_ blob: String, section: String, sealer: FlowSyncSealer = FlowSyncCrypto.platform) throws -> String {
        guard let combined = FlowSyncBase64URL.decode(blob), combined.count >= 12 + 16 else { throw AccountError.unreadable }
        let plain: Data
        do {
            plain = try sealer.open(combined, key: enc, aad: aad(section))
        } catch FlowSyncError.cryptoUnavailable {
            throw AccountError.cryptoUnavailable
        } catch {
            throw AccountError.unreadable
        }
        guard let text = String(data: plain, encoding: .utf8) else { throw AccountError.unreadable }
        return text
    }
}

/// PBKDF2-HMAC-SHA256: CommonCrypto where it exists, and plain Swift elsewhere (Linux, where FlowKit's tests run, has
/// neither CommonCrypto nor swift-crypto here; the same approach as `SHA256Fallback`). The Swift version is compiled
/// everywhere so Apple's tests can check it against CommonCrypto.
enum PBKDF2SHA256 {
    static func derive(password: Data, salt: Data, iterations: Int, length: Int) -> Data {
        #if canImport(CommonCrypto)
        if let derived = commonCrypto(password: password, salt: salt, iterations: iterations, length: length) { return derived }
        #endif
        return portable(password: password, salt: salt, iterations: iterations, length: length)
    }

    #if canImport(CommonCrypto)
    static func commonCrypto(password: Data, salt: Data, iterations: Int, length: Int) -> Data? {
        var derived = [UInt8](repeating: 0, count: length)
        let passwordBytes = [UInt8](password), saltBytes = [UInt8](salt)
        let status = passwordBytes.withUnsafeBufferPointer { pw in
            saltBytes.withUnsafeBufferPointer { s in
                derived.withUnsafeMutableBufferPointer { out in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        UnsafeRawPointer(pw.baseAddress)?.assumingMemoryBound(to: Int8.self), passwordBytes.count,
                        s.baseAddress, saltBytes.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
                        out.baseAddress, length
                    )
                }
            }
        }
        return status == Int32(kCCSuccess) ? Data(derived) : nil
    }
    #endif

    static let initialState: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

    @inline(__always) private static func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }

    /// One SHA-256 block into `state`. `w` holds the block's 16 words on the way in and is used as the message schedule.
    private static func compress(_ state: inout [UInt32], _ w: inout [UInt32], _ k: [UInt32]) {
        for i in 16..<64 {
            let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
            let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
            w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
        }
        var a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7]
        for i in 0..<64 {
            let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
            let ch = (e & f) ^ (~e & g)
            let t1 = h &+ s1 &+ ch &+ k[i] &+ w[i]
            let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
            let maj = (a & b) ^ (a & c) ^ (b & c)
            let t2 = s0 &+ maj
            h = g; g = f; f = e; e = d &+ t1; d = c; c = b; b = a; a = t1 &+ t2
        }
        state[0] = state[0] &+ a; state[1] = state[1] &+ b; state[2] = state[2] &+ c; state[3] = state[3] &+ d
        state[4] = state[4] &+ e; state[5] = state[5] &+ f; state[6] = state[6] &+ g; state[7] = state[7] &+ h
    }

    private static func words(_ bytes: [UInt8]) -> [UInt32] {
        (0..<(bytes.count / 4)).map { i in
            UInt32(bytes[i * 4]) << 24 | UInt32(bytes[i * 4 + 1]) << 16 | UInt32(bytes[i * 4 + 2]) << 8 | UInt32(bytes[i * 4 + 3])
        }
    }

    static func portable(password: Data, salt: Data, iterations: Int, length: Int) -> Data {
        let k = SHA256Fallback.k
        var key = password.count > 64 ? SHA256Fallback.hash(password) : password
        key.append(Data(repeating: 0, count: 64 - key.count))

        // HMAC's two keyed blocks are the same for every round, so their states are worked out once.
        var schedule = [UInt32](repeating: 0, count: 64)
        var inner = initialState, outer = initialState
        schedule.replaceSubrange(0..<16, with: words(key.map { $0 ^ 0x36 }))
        compress(&inner, &schedule, k)
        schedule.replaceSubrange(0..<16, with: words(key.map { $0 ^ 0x5c }))
        compress(&outer, &schedule, k)

        // HMAC of a 32-byte message (the previous round's output as eight words), which is all a round after the first hashes.
        func round(_ message: [UInt32]) -> [UInt32] {
            var state = inner
            for i in 0..<8 { schedule[i] = message[i] }
            schedule[8] = 0x8000_0000
            for i in 9..<15 { schedule[i] = 0 }
            schedule[15] = (64 + 32) * 8
            compress(&state, &schedule, k)
            var finish = outer
            for i in 0..<8 { schedule[i] = state[i] }
            schedule[8] = 0x8000_0000
            for i in 9..<15 { schedule[i] = 0 }
            schedule[15] = (64 + 32) * 8
            compress(&finish, &schedule, k)
            return finish
        }

        var output = Data()
        var blockIndex: UInt32 = 1
        while output.count < length {
            var index = Data()
            for shift in stride(from: 24, through: 0, by: -8) { index.append(UInt8((blockIndex >> UInt32(shift)) & 0xff)) }
            // The first round hashes the salt and the block number, which isn't 32 bytes.
            var u = words([UInt8](FlowSyncKDF.hmacSHA256(key: password, message: salt + index)))
            var t = u
            if iterations > 1 {
                for _ in 1..<iterations {
                    u = round(u)
                    for i in 0..<8 { t[i] ^= u[i] }
                }
            }
            for word in t { for shift in stride(from: 24, through: 0, by: -8) { output.append(UInt8((word >> UInt32(shift)) & 0xff)) } }
            blockIndex += 1
        }
        return output.prefix(length)
    }
}
