import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

/// A PKCE pair (RFC 7636): the verifier stays on the device and the challenge goes to Trakt up front,
/// so an intercepted authorization code can't be turned into tokens without it.
public struct PKCE: Equatable, Sendable {
    public let verifier: String
    public let challenge: String

    public init(verifier: String) {
        self.verifier = verifier
        self.challenge = Self.challenge(for: verifier)
    }

    /// 32 random bytes make a 43-character verifier, the shortest RFC 7636 allows and plenty of entropy.
    public static func generate() -> PKCE {
        var generator = SystemRandomNumberGenerator()
        return PKCE(verifier: randomToken(byteCount: 32, using: &generator))
    }

    /// `BASE64URL(SHA256(verifier))` without padding: the S256 method.
    public static func challenge(for verifier: String) -> String {
        base64URL(sha256(Data(verifier.utf8)))
    }

    /// 43 to 128 characters from the unreserved set, as the RFC requires.
    public static func isValidVerifier(_ verifier: String) -> Bool {
        guard (43...128).contains(verifier.utf8.count) else { return false }
        return verifier.utf8.allSatisfy { byte in
            switch byte {
            case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"), UInt8(ascii: "~"): return true
            default: return false
            }
        }
    }

    /// Random URL-safe text for a verifier or a `state` value.
    static func randomToken<G: RandomNumberGenerator>(byteCount: Int, using generator: inout G) -> String {
        base64URL(Data((0..<byteCount).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func sha256(_ data: Data) -> Data {
        #if canImport(CryptoKit)
        Data(SHA256.hash(data: data))
        #else
        SHA256Fallback.hash(data)
        #endif
    }
}

/// CryptoKit isn't on Linux, where FlowKit's tests run, so this stands in there. It's compiled everywhere
/// so the tests can check it against CryptoKit on Apple platforms.
enum SHA256Fallback {
    private static let k: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    static func hash(_ data: Data) -> Data {
        var h: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
        var message = [UInt8](data)
        let bitLength = UInt64(message.count) * 8
        message.append(0x80)
        while message.count % 64 != 56 { message.append(0) }
        for shift in stride(from: 56, through: 0, by: -8) { message.append(UInt8((bitLength >> UInt64(shift)) & 0xff)) }

        func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }
        for chunk in stride(from: 0, to: message.count, by: 64) {
            var w = [UInt32](repeating: 0, count: 64)
            for i in 0..<16 {
                let j = chunk + i * 4
                w[i] = UInt32(message[j]) << 24 | UInt32(message[j + 1]) << 16 | UInt32(message[j + 2]) << 8 | UInt32(message[j + 3])
            }
            for i in 16..<64 {
                let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
                let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
                w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
            for i in 0..<64 {
                let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
                let ch = (e & f) ^ (~e & g)
                let t1 = hh &+ s1 &+ ch &+ k[i] &+ w[i]
                let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let t2 = s0 &+ maj
                hh = g; g = f; f = e; e = d &+ t1; d = c; c = b; b = a; a = t1 &+ t2
            }
            h[0] = h[0] &+ a; h[1] = h[1] &+ b; h[2] = h[2] &+ c; h[3] = h[3] &+ d
            h[4] = h[4] &+ e; h[5] = h[5] &+ f; h[6] = h[6] &+ g; h[7] = h[7] &+ hh
        }
        return Data(h.flatMap { word in [UInt8(word >> 24), UInt8((word >> 16) & 0xff), UInt8((word >> 8) & 0xff), UInt8(word & 0xff)] })
    }
}

/// Trakt sign-in without a client secret. Trakt now issues only a client ID to new apps and proves the
/// client with PKCE instead, so everything here works from the ID alone. Apps that still have a secret
/// keep working: it is sent when present and left out when not.
public enum TraktOAuth {
    /// Must be added to the Trakt app's Redirect URIs exactly as written.
    public static let redirectURI = "flow://trakt-callback"
    /// What the app has to listen for: `ASWebAuthenticationSession` hands the callback back by scheme.
    public static let callbackScheme = "flow"
    /// What the device-code sign-in on Apple TV used before, and still what older tokens were issued against.
    public static let legacyRedirectURI = "urn:ietf:wg:oauth:2.0:oob"

    public static func authorizeURL(clientID: String, pkce: PKCE, state: String) -> URL {
        var components = URLComponents(string: "https://trakt.tv/oauth/authorize")!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        return components.url!
    }

    public static func makeState() -> String {
        var generator = SystemRandomNumberGenerator()
        return PKCE.randomToken(byteCount: 16, using: &generator)
    }

    /// The authorization code from the callback, once `state` has been checked. A mismatch means the
    /// callback didn't come from the request we made, so the code is not trusted.
    public static func authorizationCode(from callback: URL, expectedState: String) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if let error = value("error") {
            if error == "access_denied" { throw FlowError.cancelled }
            throw FlowError.unsupported(value("error_description") ?? "Trakt sign-in failed (\(error)).")
        }
        guard value("state") == expectedState else { throw FlowError.unsupported("Trakt sign-in didn't match the request that started it. Try again.") }
        guard let code = value("code"), !code.isEmpty else { throw FlowError.unsupported("Trakt didn't return a sign-in code. Try again.") }
        return code
    }

    // MARK: Request bodies

    struct CodeExchangeBody: Encodable, Equatable {
        var code: String
        var client_id: String
        var client_secret: String?
        var code_verifier: String
        var redirect_uri = TraktOAuth.redirectURI
        var grant_type = "authorization_code"
    }

    struct RefreshBody: Encodable, Equatable {
        var refresh_token: String
        var client_id: String
        var client_secret: String?
        var redirect_uri: String
        var grant_type = "refresh_token"
    }

    struct DeviceTokenBody: Encodable, Equatable {
        var code: String
        var client_id: String
        var client_secret: String?
    }

    struct RevokeBody: Encodable, Equatable {
        var token: String
        var client_id: String
        var client_secret: String?
    }

    /// The redirect URI a refresh should quote. A token remembers the one it was issued against. Older
    /// tokens don't, and with no secret the app is a PKCE one whose registered URI is ours.
    static func refreshRedirectURI(for token: OAuthToken, hasSecret: Bool) -> String {
        token.redirectURI ?? (hasSecret ? legacyRedirectURI : redirectURI)
    }

    /// A blank secret is no secret: the settings field and the build setting both default to empty.
    static func normalized(secret: String?) -> String? {
        guard let secret = secret?.trimmingCharacters(in: .whitespacesAndNewlines), !secret.isEmpty else { return nil }
        return secret
    }
}
