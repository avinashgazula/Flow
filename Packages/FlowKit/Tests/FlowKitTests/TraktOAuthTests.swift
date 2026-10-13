import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class TraktOAuthTests: XCTestCase {
    /// The worked example from RFC 7636 appendix B.
    func testChallengeMatchesRFCExample() {
        XCTAssertEqual(PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testFallbackSHA256MatchesKnownDigests() {
        func hex(_ s: String) -> String { SHA256Fallback.hash(Data(s.utf8)).map { String(format: "%02x", $0) }.joined() }
        XCTAssertEqual(hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        // 56 bytes pads into a second block, the usual place for a padding bug.
        XCTAssertEqual(hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
    }

    func testFallbackAgreesWithPlatformHash() {
        for length in [0, 1, 55, 56, 63, 64, 65, 200] {
            let data = Data((0..<length).map { UInt8($0 % 251) })
            XCTAssertEqual(SHA256Fallback.hash(data), PKCE.sha256(data), "length \(length)")
        }
    }

    func testGeneratedVerifierIsValidAndUnique() {
        let a = PKCE.generate(), b = PKCE.generate()
        XCTAssertEqual(a.verifier.count, 43)
        XCTAssertTrue(PKCE.isValidVerifier(a.verifier))
        XCTAssertNotEqual(a.verifier, b.verifier)
        XCTAssertEqual(a.challenge, PKCE.challenge(for: a.verifier))
        XCTAssertEqual(a.challenge.count, 43)
        XCTAssertFalse(a.challenge.contains("=") || a.challenge.contains("+") || a.challenge.contains("/"))
    }

    func testVerifierRules() {
        XCTAssertFalse(PKCE.isValidVerifier(String(repeating: "a", count: 42)))
        XCTAssertTrue(PKCE.isValidVerifier(String(repeating: "a", count: 43)))
        XCTAssertTrue(PKCE.isValidVerifier(String(repeating: "a", count: 128)))
        XCTAssertFalse(PKCE.isValidVerifier(String(repeating: "a", count: 129)))
        XCTAssertTrue(PKCE.isValidVerifier(String(repeating: "aZ09-._~", count: 6)))
        XCTAssertFalse(PKCE.isValidVerifier(String(repeating: "a+", count: 30)))
        XCTAssertFalse(PKCE.isValidVerifier(String(repeating: "a=", count: 30)))
    }

    func testAuthorizeURL() throws {
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        let url = TraktOAuth.authorizeURL(clientID: "cid", pkce: pkce, state: "st4te")
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.host, "trakt.tv")
        XCTAssertEqual(components.path, "/oauth/authorize")
        let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items["response_type"], "code")
        XCTAssertEqual(items["client_id"], "cid")
        XCTAssertEqual(items["redirect_uri"], "flow://trakt-callback")
        XCTAssertEqual(items["code_challenge"], "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertEqual(items["code_challenge_method"], "S256")
        XCTAssertEqual(items["state"], "st4te")
        XCTAssertNil(items["client_secret"])
        XCTAssertEqual(URL(string: TraktOAuth.redirectURI)?.scheme, TraktOAuth.callbackScheme)
    }

    func testCallbackParsing() throws {
        XCTAssertEqual(try TraktOAuth.authorizationCode(from: URL(string: "flow://trakt-callback?code=abc&state=s1")!, expectedState: "s1"), "abc")
        XCTAssertThrowsError(try TraktOAuth.authorizationCode(from: URL(string: "flow://trakt-callback?code=abc&state=other")!, expectedState: "s1"))
        XCTAssertThrowsError(try TraktOAuth.authorizationCode(from: URL(string: "flow://trakt-callback?code=abc")!, expectedState: "s1"))
        XCTAssertThrowsError(try TraktOAuth.authorizationCode(from: URL(string: "flow://trakt-callback?state=s1")!, expectedState: "s1"))
        XCTAssertThrowsError(try TraktOAuth.authorizationCode(from: URL(string: "flow://trakt-callback?error=access_denied&state=s1")!, expectedState: "s1")) { error in
            XCTAssertEqual(error as? FlowError, .cancelled)
        }
    }

    // MARK: Request bodies

    private func json(_ value: some Encodable) throws -> [String: String] {
        try JSONDecoder().decode([String: String].self, from: JSONEncoder().encode(value))
    }

    func testCodeExchangeBodyHasVerifierAndNoSecret() throws {
        let body = try json(TraktOAuth.CodeExchangeBody(code: "c", client_id: "cid", client_secret: nil, code_verifier: "v"))
        XCTAssertEqual(body, ["code": "c", "client_id": "cid", "code_verifier": "v", "redirect_uri": "flow://trakt-callback", "grant_type": "authorization_code"])
    }

    func testBodiesCarryASecretOnlyWhenThereIsOne() throws {
        XCTAssertNil(try json(TraktOAuth.RefreshBody(refresh_token: "r", client_id: "cid", client_secret: nil, redirect_uri: "x"))["client_secret"])
        XCTAssertEqual(try json(TraktOAuth.RefreshBody(refresh_token: "r", client_id: "cid", client_secret: "s", redirect_uri: "x"))["client_secret"], "s")
        XCTAssertNil(try json(TraktOAuth.DeviceTokenBody(code: "c", client_id: "cid", client_secret: nil))["client_secret"])
        XCTAssertNil(try json(TraktOAuth.RevokeBody(token: "t", client_id: "cid", client_secret: nil))["client_secret"])
        XCTAssertNil(TraktOAuth.normalized(secret: ""))
        XCTAssertNil(TraktOAuth.normalized(secret: "  "))
        XCTAssertNil(TraktOAuth.normalized(secret: nil))
        XCTAssertEqual(TraktOAuth.normalized(secret: " s "), "s")
    }

    func testRefreshRedirectURIChoice() {
        let plain = OAuthToken(accessToken: "a")
        XCTAssertEqual(TraktOAuth.refreshRedirectURI(for: plain, hasSecret: true), "urn:ietf:wg:oauth:2.0:oob")
        XCTAssertEqual(TraktOAuth.refreshRedirectURI(for: plain, hasSecret: false), "flow://trakt-callback")
        XCTAssertEqual(TraktOAuth.refreshRedirectURI(for: OAuthToken(accessToken: "a", redirectURI: "flow://trakt-callback"), hasSecret: true), "flow://trakt-callback")
    }

    func testTokensSavedBeforeRedirectURIWasRecordedStillDecode() throws {
        let old = #"{"accessToken":"a","refreshToken":"r"}"#
        let token = try JSONDecoder().decode(OAuthToken.self, from: Data(old.utf8))
        XCTAssertEqual(token.accessToken, "a")
        XCTAssertNil(token.redirectURI)
    }

    // MARK: Client

    private func body(_ request: URLRequest) throws -> [String: String] {
        try JSONDecoder().decode([String: String].self, from: XCTUnwrap(request.httpBody))
    }

    func testSignInExchangesCodeWithVerifierAndNoSecret() async throws {
        let mock = MockTransport()
        mock.routes["/oauth/token"] = (200, #"{"access_token":"at","refresh_token":"rt","expires_in":7776000,"created_at":1790000000}"#)
        let saved = TokenBox()
        let client = TraktClient(clientID: "cid", token: nil, http: HTTPClient(transport: mock)) { saved.token = $0 }
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        let token = try await client.signIn(callback: URL(string: "flow://trakt-callback?code=thecode&state=s")!, expectedState: "s", pkce: pkce)
        XCTAssertEqual(token.accessToken, "at")
        XCTAssertEqual(token.refreshToken, "rt")
        XCTAssertEqual(token.redirectURI, "flow://trakt-callback")
        XCTAssertEqual(saved.token, token)
        let sent = try body(mock.requests[0])
        XCTAssertEqual(sent["code"], "thecode")
        XCTAssertEqual(sent["code_verifier"], pkce.verifier)
        XCTAssertEqual(sent["grant_type"], "authorization_code")
        XCTAssertEqual(sent["redirect_uri"], "flow://trakt-callback")
        XCTAssertNil(sent["client_secret"])
        let signedIn = await client.isSignedIn
        XCTAssertTrue(signedIn)
    }

    func testSignInRejectsWrongStateWithoutCallingTrakt() async {
        let mock = MockTransport()
        let client = TraktClient(clientID: "cid", token: nil, http: HTTPClient(transport: mock))
        do {
            _ = try await client.signIn(callback: URL(string: "flow://trakt-callback?code=c&state=evil")!, expectedState: "s", pkce: PKCE.generate())
            XCTFail("should have thrown")
        } catch {}
        XCTAssertTrue(mock.requests.isEmpty)
    }

    func testRefreshWithoutSecretOmitsIt() async throws {
        let mock = MockTransport()
        mock.routes["/oauth/token"] = (200, #"{"access_token":"new","refresh_token":"rt2","expires_in":7776000}"#)
        mock.routes["/users/settings"] = (200, #"{"user":{"username":"u"}}"#)
        let expired = OAuthToken(accessToken: "old", refreshToken: "rt1", expiresAt: Date(timeIntervalSinceNow: -10))
        let saved = TokenBox()
        let client = TraktClient(clientID: "cid", clientSecret: "", token: expired, http: HTTPClient(transport: mock)) { saved.token = $0 }
        _ = try await client.profile()
        let refresh = try body(mock.requests[0])
        XCTAssertEqual(refresh["grant_type"], "refresh_token")
        XCTAssertEqual(refresh["refresh_token"], "rt1")
        XCTAssertEqual(refresh["redirect_uri"], "flow://trakt-callback")
        XCTAssertNil(refresh["client_secret"])
        XCTAssertEqual(mock.requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer new")
        XCTAssertEqual(saved.token?.refreshToken, "rt2")
    }

    func testRefreshStillSendsAStoredSecret() async throws {
        let mock = MockTransport()
        mock.routes["/oauth/token"] = (200, #"{"access_token":"new","refresh_token":"rt2","expires_in":7776000}"#)
        mock.routes["/users/settings"] = (200, #"{"user":{"username":"u"}}"#)
        let expired = OAuthToken(accessToken: "old", refreshToken: "rt1", expiresAt: Date(timeIntervalSinceNow: -10))
        let client = TraktClient(clientID: "cid", clientSecret: "shh", token: expired, http: HTTPClient(transport: mock))
        _ = try await client.profile()
        let refresh = try body(mock.requests[0])
        XCTAssertEqual(refresh["client_secret"], "shh")
        XCTAssertEqual(refresh["redirect_uri"], "urn:ietf:wg:oauth:2.0:oob")
    }

    func testOverlappingRequestsShareOneRefresh() async throws {
        let mock = MockTransport()
        mock.routes["/oauth/token"] = (200, #"{"access_token":"new","refresh_token":"rt2","expires_in":7776000}"#)
        mock.routes["/users/settings"] = (200, #"{"user":{"username":"u"}}"#)
        let expired = OAuthToken(accessToken: "old", refreshToken: "rt1", expiresAt: Date(timeIntervalSinceNow: -10))
        let client = TraktClient(clientID: "cid", token: expired, http: HTTPClient(transport: mock))
        async let a = client.profile()
        async let b = client.profile()
        _ = try await (a, b)
        XCTAssertEqual(mock.requests.filter { $0.url?.path.hasSuffix("/oauth/token") == true }.count, 1)
    }
}

private final class TokenBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: OAuthToken?
    var token: OAuthToken? {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); defer { lock.unlock() }; stored = newValue }
    }
}
