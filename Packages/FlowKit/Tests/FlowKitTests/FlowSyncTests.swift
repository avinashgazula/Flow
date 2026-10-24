import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// The key, derivations, links and payload of Flow Sync (docs/SYNC.md).
final class FlowSyncKeyTests: XCTestCase {
    static let vectorBytes = Data(0..<16)

    func testVectorKeyText() throws {
        let key = try XCTUnwrap(FlowSyncKey(bytes: Self.vectorBytes))
        XCTAssertEqual(key.text, "000G40R40M30E209185GR38E1W")
        XCTAssertEqual(key.grouped, "000G-40R4-0M30-E209-185G-R38E-1W")
        XCTAssertEqual(try FlowSyncKey.parse("000G-40R4-0M30-E209-185G-R38E-1W"), key)
    }

    func testVectorDerivedValues() throws {
        let derived = try XCTUnwrap(FlowSyncKey(bytes: Self.vectorBytes)).derived
        XCTAssertEqual(derived.id, "625ee37823f4fad87a1591ef9038d5c6")
        XCTAssertEqual(derived.auth, "MF8YRcz1DFlJqMdCJgMOrexYxSLXV50cYLJsfg2ts50")
        XCTAssertEqual(derived.enc.map { String(format: "%02x", $0) }.joined(), "7216fa3c9cdb9f4f1cd4b5a76c3aa5414ec5d741e8eb1b5f1f8b242fbad13eca")
        XCTAssertEqual(derived.authHash, "4c921fbf5d2aa65f33ff2423208ef4628a74ddb6f96196e2ff212c073cbd02b0")
    }

    #if canImport(CryptoKit)
    /// The vector's blob, made and opened with CryptoKit. Linux has no AES-GCM here, so this runs on Apple platforms.
    func testVectorBlob() throws {
        let derived = try XCTUnwrap(FlowSyncKey(bytes: Self.vectorBytes)).derived
        let plaintext = Data(#"{"v":1,"sections":{}}"#.utf8)
        let nonce = Data(0..<12)
        let blob = try FlowSyncCrypto.seal(plaintext, derived: derived, sealer: CryptoKitSealer(), nonce: nonce)
        XCTAssertEqual(blob, "AAECAwQFBgcICQoLGAP4YCx3YYoDIGnxPMRrrawbsS-rAxRzm-9OU5yZM8MHg9rlLg")
        XCTAssertEqual(try FlowSyncCrypto.open(blob, derived: derived, sealer: CryptoKitSealer()), plaintext)
    }

    func testBlobBoundToItsRecord() throws {
        let derived = try XCTUnwrap(FlowSyncKey(bytes: Self.vectorBytes)).derived
        let blob = try FlowSyncCrypto.seal(Data("hello".utf8), derived: derived, sealer: CryptoKitSealer())
        // Another key can't open it.
        XCTAssertThrowsError(try FlowSyncCrypto.open(blob, derived: FlowSyncKey.generate().derived, sealer: CryptoKitSealer()))
        // The record id is the additional authenticated data: the same bytes under another id don't open.
        let combined = try XCTUnwrap(FlowSyncBase64URL.decode(blob))
        XCTAssertNoThrow(try CryptoKitSealer().open(combined, key: derived.enc, aad: Data(derived.id.utf8)))
        XCTAssertThrowsError(try CryptoKitSealer().open(combined, key: derived.enc, aad: Data("another-record".utf8)))
    }

    func testEveryUploadUsesAFreshNonce() throws {
        let derived = FlowSyncKey.generate().derived
        let a = try FlowSyncCrypto.seal(Data("same".utf8), derived: derived, sealer: CryptoKitSealer())
        let b = try FlowSyncCrypto.seal(Data("same".utf8), derived: derived, sealer: CryptoKitSealer())
        XCTAssertNotEqual(a, b)
    }

    func testHMACAndHKDFAgreeWithCryptoKit() {
        let key = Data((0..<100).map { UInt8($0) }), message = Data("message".utf8), salt = Data("salt".utf8)
        XCTAssertEqual(FlowSyncKDF.hmacSHA256(key: key, message: message), Data(HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: key))))
        XCTAssertEqual(FlowSyncKDF.hmacSHA256(key: salt, message: message), Data(HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: salt))))
        let expected = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: key), salt: salt, info: Data("info".utf8), outputByteCount: 70)
        XCTAssertEqual(FlowSyncKDF.hkdf(key: key, salt: salt, info: Data("info".utf8), length: 70), expected.withUnsafeBytes { Data($0) })
    }
    #endif

    func testGeneratedKeysRoundTripThroughText() throws {
        for _ in 0..<50 {
            let key = FlowSyncKey.generate()
            XCTAssertEqual(key.text.count, 26)
            XCTAssertEqual(key.grouped.count, 32)
            XCTAssertEqual(try FlowSyncKey.parse(key.text), key)
            XCTAssertEqual(try FlowSyncKey.parse(key.grouped.lowercased()), key)
        }
        XCTAssertNotEqual(FlowSyncKey.generate(), FlowSyncKey.generate())
    }

    func testParsingIsForgiving() throws {
        let expected = try XCTUnwrap(FlowSyncKey(bytes: Self.vectorBytes))
        XCTAssertEqual(try FlowSyncKey.parse("  000g 40r4  0m30-e209-185g r38e-1w\n"), expected)
        // O reads as 0, I and L as 1.
        XCTAssertEqual(try FlowSyncKey.parse("OOOG-4OR4-OM3O-E2O9-185G-R38E-1W"), expected)
        let ones = try FlowSyncKey.parse("1111-1111-1111-1111-1111-1111-11")
        XCTAssertEqual(try FlowSyncKey.parse("IIII-LLLL-iiii-llll-1111-1111-11"), ones)
    }

    func testIncompleteKeysAreRefusedInWords() {
        let bad = ["", "000G-40R4", "000G40R40M30E209185GR38E1", "000G40R40M30E209185GR38E1WW", "000G40R40M30E209185GR38E1U", "000G40R40M30E209185GR38E1!",
                   "000G-40R4-0M30-E209-185G-R38E-1W-0000"]
        for text in bad {
            XCTAssertThrowsError(try FlowSyncKey.parse(text), text) { error in
                XCTAssertEqual(error as? FlowSyncError, .incompleteKey)
                XCTAssertEqual((error as? FlowSyncError)?.errorDescription, "That sync key isn't complete. Check it against the one on your other device.")
            }
        }
        XCTAssertFalse(FlowSyncKey.isValid("abc"))
        XCTAssertTrue(FlowSyncKey.isValid("000G-40R4-0M30-E209-185G-R38E-1W"))
        XCTAssertNil(FlowSyncKey(bytes: Data(count: 15)))
    }
}

final class FlowSyncLinkTests: XCTestCase {
    let keyText = "000G40R40M30E209185GR38E1W"

    func testAppLinkRoundTrip() throws {
        let pairing = try FlowSyncPairing(key: keyText, server: "https://flow-stream-proxy.example.workers.dev", token: "to ken&=/+é")
        let link = FlowSyncLink.appLink(pairing)
        XCTAssertTrue(link.hasPrefix("flow://sync?k=000G40R40M30E209185GR38E1W&s=https%3A%2F%2Fflow-stream-proxy.example.workers.dev&t="))
        XCTAssertFalse(link.contains(" "))
        XCTAssertEqual(try FlowSyncLink.parse(link), pairing)
        // As a URL, the way the system hands it to the app.
        XCTAssertEqual(FlowLink(url: URL(string: link)!), .sync(link))
    }

    func testWebLinkRoundTrip() throws {
        let pairing = try FlowSyncPairing(key: keyText, server: "https://p.example.workers.dev", token: "s3cret")
        let link = FlowSyncLink.webLink(pairing, site: "https://flow.example.com/")
        XCTAssertEqual(link, "https://flow.example.com/settings#sync=k=000G40R40M30E209185GR38E1W&s=https%3A%2F%2Fp.example.workers.dev&t=s3cret")
        XCTAssertEqual(try FlowSyncLink.parse(link), pairing)
        XCTAssertEqual(try FlowSyncLink.parse("  " + link + "\n"), pairing)
    }

    func testParseTidiesWhatItReads() throws {
        let parsed = try FlowSyncLink.parse("flow://sync?k=000g-40r4-0m30-e209-185g-r38e-1w&s=Flow.Example.workers.dev%2Fsomething%2F&t=abc")
        XCTAssertEqual(parsed.keyText, keyText)
        XCTAssertEqual(parsed.server, "https://flow.example.workers.dev")
        XCTAssertEqual(parsed.token, "abc")
        // No token is allowed in the link: the Worker may not ask for one.
        XCTAssertEqual(try FlowSyncLink.parse("flow://sync?k=\(keyText)&s=http%3A%2F%2Flocalhost%3A8787").server, "http://localhost:8787")
    }

    func testBadLinksSayWhatIsWrong() {
        XCTAssertThrowsError(try FlowSyncLink.parse("hello")) { XCTAssertEqual($0 as? FlowSyncError, .invalidLink) }
        XCTAssertThrowsError(try FlowSyncLink.parse("flow://setup?d=abc")) { XCTAssertEqual($0 as? FlowSyncError, .invalidLink) }
        XCTAssertThrowsError(try FlowSyncLink.parse("flow://sync?s=https%3A%2F%2Fa.dev&t=x")) { XCTAssertEqual($0 as? FlowSyncError, .invalidLink) }
        XCTAssertThrowsError(try FlowSyncLink.parse("flow://sync?k=000G&s=https%3A%2F%2Fa.dev&t=x")) { XCTAssertEqual($0 as? FlowSyncError, .incompleteKey) }
        XCTAssertThrowsError(try FlowSyncLink.parse("flow://sync?k=\(keyText)&s=ftp%3A%2F%2Fa.dev&t=x")) { XCTAssertEqual($0 as? FlowSyncError, .invalidServer) }
        XCTAssertThrowsError(try FlowSyncPairing(key: keyText, server: "  ", token: "")) { XCTAssertEqual($0 as? FlowSyncError, .invalidServer) }
    }

    func testServerAddressesAreReducedToTheirOrigin() throws {
        XCTAssertEqual(try FlowSyncPairing.normalizedServer("flow.example.workers.dev"), "https://flow.example.workers.dev")
        XCTAssertEqual(try FlowSyncPairing.normalizedServer("https://Flow.Example.workers.dev/?url=x#y"), "https://flow.example.workers.dev")
        XCTAssertEqual(try FlowSyncPairing.normalizedServer(" http://192.168.1.5:8787/sync "), "http://192.168.1.5:8787")
    }
}

final class FlowSyncPayloadTests: XCTestCase {
    func testUnknownSectionsAndFieldsSurviveARoundTrip() throws {
        let text = #"{"v":1,"future":{"a":[1,2.5,true,null]},"sections":{"keys":{"updatedAt":"2026-10-24T18:00:00Z","device":"iPhone","data":{"tmdbAPIKey":"abc","newField":{"x":1}},"note":"hi"},"streamProxy":{"updatedAt":"2026-10-23T10:00:00Z","device":"Web","data":{"template":"https://p/?url={url}"}},"brandNew":{"updatedAt":"2026-10-24T18:00:00Z","data":[1,0,false]}}}"#
        let payload = try FlowSyncPayload(plaintext: Data(text.utf8))
        XCTAssertEqual(payload.sections.keys.sorted(), ["brandNew", "keys", "streamProxy"])
        XCTAssertEqual(payload.sections["keys"]?.device, "iPhone")
        XCTAssertEqual(payload.sections["keys"]?.fields["note"], .string("hi"))
        let again = try FlowSyncPayload(plaintext: payload.plaintext())
        XCTAssertEqual(again, payload)
        // Numbers stay numbers and booleans stay booleans, so 1 and 0 don't turn into true and false.
        XCTAssertEqual(again.sections["brandNew"]?.data, .array([.number(1), .number(0), .bool(false)]))
        XCTAssertEqual(again.extra["future"]?["a"], .array([.number(1), .number(2.5), .bool(true), .null]))
    }

    func testPlaintextIsStable() throws {
        let a = FlowSyncPayload(sections: ["a": FlowSyncSection(updatedAt: Date(timeIntervalSince1970: 1_700_000_000), device: "Mac", data: .object(["z": .number(1), "b": .string("x/y")]))])
        XCTAssertEqual(String(data: try a.plaintext(), encoding: .utf8)?.contains(#""b":"x/y""#), true)
        XCTAssertEqual(try a.plaintext(), try FlowSyncPayload(plaintext: a.plaintext()).plaintext())
        let empty = String(data: try FlowSyncPayload().plaintext(), encoding: .utf8) ?? ""
        XCTAssertTrue(empty.hasPrefix(#"{"sections":{},"v":1"#), empty)
    }

    func testTimesAreWholeSecondsInUTC() {
        XCTAssertEqual(FlowSyncTime.string(Date(timeIntervalSince1970: 1_761_328_800)), "2025-10-24T18:00:00Z")
        XCTAssertEqual(FlowSyncTime.date("2025-10-24T18:00:00Z"), Date(timeIntervalSince1970: 1_761_328_800))
        XCTAssertEqual(FlowSyncTime.date("2025-10-24T18:00:00.500Z"), Date(timeIntervalSince1970: 1_761_328_800.5))
        XCTAssertNil(FlowSyncSection(fields: ["updatedAt": .string("nonsense")]).updatedAtText.flatMap(FlowSyncTime.date))
        XCTAssertEqual(FlowSyncSection(fields: [:]).updatedAt, .distantPast)
    }

    func testUnreadablePlaintextIsRefused() {
        XCTAssertThrowsError(try FlowSyncPayload(plaintext: Data("not json".utf8))) { XCTAssertEqual($0 as? FlowSyncError, .unreadable) }
        XCTAssertThrowsError(try FlowSyncPayload(plaintext: Data("[1]".utf8))) { XCTAssertEqual($0 as? FlowSyncError, .unreadable) }
    }
}

final class FlowSyncMappingTests: XCTestCase {
    func fullCredentials() -> Credentials {
        var c = Credentials()
        c.tmdbAPIKey = "tmdb"; c.tvdbAPIKey = "tvdb"; c.mdblistAPIKey = "mdb"
        c.openSubtitlesAPIKey = "os"; c.openSubtitlesUsername = "user"; c.openSubtitlesPassword = "pw"
        c.subdlAPIKey = "subdl"; c.subSourceAPIKey = "subsource"; c.rpdbAPIKey = "rpdb"
        c.traktClientID = "tid"; c.traktClientSecret = "tsecret"; c.simklClientID = "sid"
        c.traktToken = OAuthToken(accessToken: "ta", refreshToken: "tr", expiresAt: Date(timeIntervalSince1970: 1_800_000_000), redirectURI: "flow://trakt-callback")
        c.simklToken = OAuthToken(accessToken: "sa")
        return c
    }

    func testKeysAndAccountsRoundTrip() {
        let credentials = fullCredentials()
        let sections = FlowSyncMapping.sections(credentials: credentials, settings: AppSettings())
        var restored = Credentials()
        var settings = AppSettings()
        for name in [FlowSyncSectionName.keys, FlowSyncSectionName.accounts] {
            FlowSyncMapping.apply(sections[name]!, to: name, credentials: &restored, settings: &settings)
        }
        XCTAssertEqual(restored, credentials)
        XCTAssertEqual(sections["keys"]?.object?.keys.sorted(), ["mdblistAPIKey", "openSubtitlesAPIKey", "openSubtitlesPassword", "openSubtitlesUsername", "rpdbAPIKey", "simklClientID", "subSourceAPIKey", "subdlAPIKey", "traktClientID", "traktClientSecret", "tmdbAPIKey", "tvdbAPIKey"].sorted())
        XCTAssertEqual(sections["accounts"]?["trakt"]?["accessToken"], .string("ta"))
        XCTAssertEqual(sections["accounts"]?["trakt"]?["expiresAt"], .string("2027-01-15T08:00:00Z"))
        XCTAssertEqual(sections["accounts"]?["simkl"]?["refreshToken"], .null)
    }

    func testKeysThatAreNotSyncedStayLocal() {
        var local = Credentials()
        local.publicMetaDBAPIKey = "pmdb"
        local.introDBAPIKey = "intro"
        local.tmdbAPIKey = "old"
        var settings = AppSettings()
        FlowSyncMapping.apply(FlowSyncJSON.object(["tmdbAPIKey": .string("new")]), to: "keys", credentials: &local, settings: &settings)
        XCTAssertEqual(local.tmdbAPIKey, "new")
        XCTAssertEqual(local.publicMetaDBAPIKey, "pmdb")
        XCTAssertEqual(local.introDBAPIKey, "intro")
        XCTAssertNil(FlowSyncMapping.keysData(local).object?["publicMetaDBAPIKey"])
    }

    func testClearingAKeyIsAChangeButAbsenceIsNot() {
        var credentials = fullCredentials()
        var settings = AppSettings()
        FlowSyncMapping.apply(FlowSyncJSON.object(["tmdbAPIKey": .null, "tvdbAPIKey": .string(""), "mdblistAPIKey": .number(3)]), to: "keys", credentials: &credentials, settings: &settings)
        XCTAssertNil(credentials.tmdbAPIKey)
        XCTAssertNil(credentials.tvdbAPIKey)
        XCTAssertEqual(credentials.mdblistAPIKey, "mdb")
        XCTAssertEqual(credentials.openSubtitlesAPIKey, "os")
    }

    func testSigningOutElsewhereClearsATokenButJunkDoesNot() {
        var credentials = fullCredentials()
        var settings = AppSettings()
        FlowSyncMapping.apply(FlowSyncJSON.object(["trakt": .null, "simkl": .object(["refreshToken": .string("x")])]), to: "accounts", credentials: &credentials, settings: &settings)
        XCTAssertNil(credentials.traktToken)
        XCTAssertEqual(credentials.simklToken?.accessToken, "sa")
    }

    func testAddonsRoundTripInOrder() throws {
        var settings = AppSettings()
        settings.sources.addons = [
            AddonConfig(manifestURL: URL(string: "https://a.example/x/manifest.json")!, name: "A", enabled: true),
            AddonConfig(manifestURL: URL(string: "https://b.example/manifest.json")!, name: "B", enabled: false),
        ]
        let data = FlowSyncMapping.sections(credentials: Credentials(), settings: settings)["addons"]!
        XCTAssertEqual(data.array?.first?["url"], .string("https://a.example/x/manifest.json"))
        XCTAssertEqual(data.array?.last?["enabled"], .bool(false))
        var restored = AppSettings()
        var credentials = Credentials()
        FlowSyncMapping.apply(data, to: "addons", credentials: &credentials, settings: &restored)
        XCTAssertEqual(restored.sources.addons, settings.sources.addons)
        FlowSyncMapping.apply(.array([]), to: "addons", credentials: &credentials, settings: &restored)
        XCTAssertEqual(restored.sources.addons, [])
    }

    func testServersMapTheirFieldsAndKeepTheRestLocal() throws {
        var jellyfin = MediaServerConfig(id: "j1", kind: .jellyfin, name: "Home", baseURL: URL(string: "http://nas.local:8096")!, userID: "u1", accessToken: "tok", username: "me", enabled: true, isRemote: true)
        let plex = MediaServerConfig(id: "p1", kind: .plex, name: "Plex", baseURL: URL(string: "https://plex.example")!, accessToken: "ptok", machineID: "machine")
        var settings = AppSettings()
        settings.mediaServers.servers = [jellyfin, plex]
        let data = FlowSyncMapping.sections(credentials: Credentials(), settings: settings)["servers"]!
        let first = try XCTUnwrap(data.array?.first)
        XCTAssertEqual(first["url"], .string("http://nas.local:8096"))
        XCTAssertEqual(first["token"], .string("tok"))
        XCTAssertEqual(first["userId"], .string("u1"))
        XCTAssertEqual(data.array?.last?["machineId"], .string("machine"))
        XCTAssertNil(first["baseURL"])
        XCTAssertNil(first["enabled"])

        // On another device, the same server is switched off and on the local network; a token change arrives, those stay.
        jellyfin.enabled = false
        jellyfin.isRemote = false
        jellyfin.accessToken = "stale"
        var other = AppSettings()
        other.mediaServers.servers = [jellyfin]
        var credentials = Credentials()
        FlowSyncMapping.apply(data, to: "servers", credentials: &credentials, settings: &other)
        XCTAssertEqual(other.mediaServers.servers.map(\.id), ["j1", "p1"])
        XCTAssertEqual(other.mediaServers.servers[0].accessToken, "tok")
        XCTAssertFalse(other.mediaServers.servers[0].enabled)
        XCTAssertFalse(other.mediaServers.servers[0].isRemote)
        XCTAssertEqual(other.mediaServers.servers[1].machineID, "machine")
        // Servers the synced list no longer has are gone.
        FlowSyncMapping.apply(.array([]), to: "servers", credentials: &credentials, settings: &other)
        XCTAssertTrue(other.mediaServers.servers.isEmpty)
    }

    func testPlaybackMapsLanguagesAndSubtitleStyle() throws {
        var settings = AppSettings()
        settings.playback.preferredAudioLanguage = "ja"
        settings.playback.audioFallbackLanguage = "en"
        settings.subtitles.preferredLanguages = ["en", "fr"]
        settings.subtitles.fontScale = 1.4
        settings.subtitles.font = .serif
        settings.subtitles.weight = .bold
        settings.subtitles.color = .yellow
        settings.subtitles.edgeStyle = .outline
        settings.subtitles.background = .translucent
        settings.subtitles.backgroundOpacity = 0.3
        settings.subtitles.verticalPosition = 0.2
        let data = FlowSyncMapping.sections(credentials: Credentials(), settings: settings)["playback"]!
        XCTAssertEqual(data["audioLanguages"], .array([.string("ja"), .string("en")]))
        XCTAssertEqual(data["subtitleLanguages"], .array([.string("en"), .string("fr")]))
        XCTAssertEqual(data["subtitleStyle"]?.object?.keys.sorted(), ["background", "backgroundOpacity", "color", "edgeStyle", "font", "fontScale", "verticalPosition", "weight"])
        XCTAssertEqual(data["subtitleStyle"]?["edgeStyle"], .string("outline"))
        XCTAssertEqual(data["subtitleStyle"]?["fontScale"], .number(1.4))

        var restored = AppSettings()
        restored.subtitles.autoSelect = .never
        restored.subtitles.defaultOffsetSeconds = 2
        var credentials = Credentials()
        FlowSyncMapping.apply(data, to: "playback", credentials: &credentials, settings: &restored)
        XCTAssertEqual(restored.playback.preferredAudioLanguage, "ja")
        XCTAssertEqual(restored.playback.audioFallbackLanguage, "en")
        XCTAssertEqual(restored.subtitles.preferredLanguages, ["en", "fr"])
        XCTAssertEqual(restored.subtitles.font, .serif)
        XCTAssertEqual(restored.subtitles.backgroundOpacity, 0.3)
        // Not part of the section: left alone.
        XCTAssertEqual(restored.subtitles.autoSelect, .never)
        XCTAssertEqual(restored.subtitles.defaultOffsetSeconds, 2)
    }

    func testAStyleValueThisVersionCannotReadCostsOnlyThatValue() {
        var settings = AppSettings()
        var credentials = Credentials()
        FlowSyncMapping.apply(FlowSyncJSON.object(["subtitleStyle": FlowSyncJSON.object(["font": .string("comicSansFromTheFuture"), "color": .string("cyan"), "fontScale": .string("big")])]),
                              to: "playback", credentials: &credentials, settings: &settings)
        XCTAssertEqual(settings.subtitles.font, .system)
        XCTAssertEqual(settings.subtitles.color, .cyan)
        XCTAssertEqual(settings.subtitles.fontScale, 1.0)
    }

    func testChangeDetectionSeesOnlySyncedValues() {
        var settings = AppSettings()
        var changed = settings
        changed.playback.autoPlayNextEpisode.toggle()
        changed.general.haptics.toggle()
        XCTAssertFalse(FlowSyncMapping.changed(from: settings, to: changed))
        changed.subtitles.verticalPosition = 0.3
        XCTAssertTrue(FlowSyncMapping.changed(from: settings, to: changed))
        settings.sources.addons = [AddonConfig(manifestURL: URL(string: "https://a.example/manifest.json")!, name: "A")]
        XCTAssertTrue(FlowSyncMapping.changed(from: AppSettings(), to: settings))

        var credentials = Credentials()
        var other = credentials
        other.introDBAPIKey = "not synced"
        XCTAssertFalse(FlowSyncMapping.changed(from: credentials, to: other))
        credentials.traktToken = OAuthToken(accessToken: "a")
        XCTAssertTrue(FlowSyncMapping.changed(from: other, to: credentials))
    }

    func testNormalizedIgnoresWhatThisVersionDoesNotKnow() {
        let local = FlowSyncMapping.sections(credentials: fullCredentials(), settings: AppSettings())["keys"]!
        var withExtra = local.object!
        withExtra["somethingNew"] = .string("x")
        XCTAssertEqual(FlowSyncMapping.normalized(.object(withExtra), section: "keys"), local)
        XCTAssertTrue(FlowSyncMapping.isBlank(FlowSyncMapping.keysData(Credentials()), section: "keys"))
        XCTAssertFalse(FlowSyncMapping.isBlank(local, section: "keys"))
        XCTAssertTrue(FlowSyncMapping.isBlank(.array([]), section: "servers"))
        XCTAssertFalse(FlowSyncMapping.isBlank(FlowSyncMapping.playbackData(AppSettings()), section: "playback"))
    }
}

final class FlowSyncMergeTests: XCTestCase {
    let t1 = Date(timeIntervalSince1970: 1_761_000_000)
    let t2 = Date(timeIntervalSince1970: 1_761_000_100)
    let t3 = Date(timeIntervalSince1970: 1_761_000_200)

    func keys(_ tmdb: String?) -> JSONValue {
        var c = Credentials()
        c.tmdbAPIKey = tmdb
        return FlowSyncMapping.keysData(c)
    }

    func local(tmdb: String?, settings: AppSettings = AppSettings()) -> [String: JSONValue] {
        var c = Credentials()
        c.tmdbAPIKey = tmdb
        return FlowSyncMapping.sections(credentials: c, settings: settings)
    }

    func state(_ sections: [String: JSONValue], at time: Date, device: String = "iPad") -> FlowSyncState {
        var s = FlowSyncState()
        for (name, data) in sections { s.sections[name] = .init(updatedAt: time, dataHash: FlowSyncJSON.hash(data), device: device) }
        return s
    }

    func remote(_ sections: [String: (Date, JSONValue)], device: String = "Web") -> FlowSyncPayload {
        FlowSyncPayload(sections: sections.mapValues { FlowSyncSection(updatedAt: $0.0, device: device, data: $0.1) })
    }

    func testNewerSectionWins() {
        let mine = local(tmdb: "old")
        let result = FlowSyncMerge.merge(local: mine, state: state(mine, at: t1), remote: remote(["keys": (t2, keys("new"))]), device: "iPhone", now: t3)
        XCTAssertEqual(result.apply["keys"], keys("new"))
        XCTAssertEqual(result.payload.sections["keys"]?.data, keys("new"))
        XCTAssertEqual(result.payload.sections["keys"]?.device, "Web")
        XCTAssertEqual(result.stamps["keys"]?.updatedAt, t2)
    }

    func testALocalChangeIsStampedNowAndWinsOverAnOlderServerCopy() {
        let before = local(tmdb: "old")
        let now = local(tmdb: "typed")
        let result = FlowSyncMerge.merge(local: now, state: state(before, at: t1), remote: remote(["keys": (t2, keys("old"))]), device: "iPhone", now: t3)
        XCTAssertNil(result.apply["keys"])
        XCTAssertEqual(result.payload.sections["keys"]?.data, keys("typed"))
        XCTAssertEqual(result.payload.sections["keys"]?.updatedAtText, FlowSyncTime.string(t3))
        XCTAssertEqual(result.payload.sections["keys"]?.device, "iPhone")
    }

    func testALocalChangeLosesToANewerServerCopy() {
        let before = local(tmdb: "old")
        let now = local(tmdb: "typed")
        let result = FlowSyncMerge.merge(local: now, state: state(before, at: t1), remote: remote(["keys": (t3, keys("elsewhere"))]), device: "iPhone", now: t2)
        XCTAssertEqual(result.apply["keys"], keys("elsewhere"))
        XCTAssertEqual(result.payload.sections["keys"]?.data, keys("elsewhere"))
    }

    func testPullingDoesNotBumpASection() {
        let mine = local(tmdb: "same")
        let theirs = remote(["keys": (t2, keys("same"))])
        // Applying and not changing: this device's stamp takes the server's time, and the payload stays as it was.
        let result = FlowSyncMerge.merge(local: mine, state: state(mine, at: t1), remote: theirs, device: "iPhone", now: t3)
        XCTAssertEqual(result.payload.sections["keys"], theirs.sections["keys"])
        XCTAssertEqual(result.stamps["keys"]?.updatedAt, t2)
        XCTAssertNil(result.apply["keys"])
        // And a section nobody touched keeps the time it had, however late the sync runs.
        let again = FlowSyncMerge.merge(local: mine, state: state(mine, at: t2), remote: theirs, device: "iPhone", now: t3)
        XCTAssertEqual(again.payload.sections["keys"], theirs.sections["keys"])
    }

    func testUnknownSectionsAreKeptExactlyAndStreamProxyIsUntouched() throws {
        let proxy = FlowSyncSection(fields: ["updatedAt": .string("2026-10-20T09:00:00Z"), "device": .string("Web"), "data": FlowSyncJSON.object(["template": .string("https://p/?url={url}&token=t"), "extra": .number(1)]), "why": .string("kept")])
        var theirs = FlowSyncPayload(version: 1, sections: ["streamProxy": proxy, "tomorrow": FlowSyncSection(fields: ["updatedAt": .string("2030-01-01T00:00:00Z"), "data": .array([.number(1)])])], extra: ["hint": .bool(true)])
        theirs.sections["keys"] = FlowSyncSection(updatedAt: t1, device: "Web", data: keys("old"))
        let before = local(tmdb: "old")
        let result = FlowSyncMerge.merge(local: local(tmdb: "typed"), state: state(before, at: t1), remote: theirs, device: "iPhone", now: t2)
        XCTAssertEqual(result.payload.sections["streamProxy"], proxy)
        XCTAssertEqual(result.payload.sections["tomorrow"], theirs.sections["tomorrow"])
        XCTAssertEqual(result.payload.extra, ["hint": .bool(true)])
        XCTAssertTrue(result.apply.isEmpty)
        XCTAssertNil(result.stamps["streamProxy"])
        // Through the wire format too.
        XCTAssertEqual(try FlowSyncPayload(plaintext: result.payload.plaintext()).sections["streamProxy"], proxy)
    }

    func testUnknownFieldsInKnownSectionsSurviveALocalWin() {
        let serverRow: JSONValue = FlowSyncJSON.object(["id": .string("j1"), "kind": .string("jellyfin"), "name": .string("Home"), "url": .string("http://nas"), "token": .string("a"), "userId": .null, "username": .null, "machineId": .null, "flavor": .string("vanilla")])
        let theirs = remote(["servers": (t1, .array([serverRow]))])
        var settings = AppSettings()
        settings.mediaServers.servers = [MediaServerConfig(id: "j1", kind: .jellyfin, name: "Home", baseURL: URL(string: "http://nas")!, accessToken: "b")]
        let mine = local(tmdb: nil, settings: settings)
        var old = AppSettings()
        old.mediaServers.servers = [MediaServerConfig(id: "j1", kind: .jellyfin, name: "Home", baseURL: URL(string: "http://nas")!, accessToken: "a")]
        let result = FlowSyncMerge.merge(local: mine, state: state(local(tmdb: nil, settings: old), at: t1), remote: theirs, device: "Mac", now: t2)
        let row = result.payload.sections["servers"]?.data.array?.first
        XCTAssertEqual(row?["token"], .string("b"))
        XCTAssertEqual(row?["flavor"], .string("vanilla"))
        XCTAssertEqual(result.payload.sections["servers"]?.device, "Mac")
    }

    func testClearingIsAChange() {
        let before = local(tmdb: "key")
        let cleared = local(tmdb: nil)
        let result = FlowSyncMerge.merge(local: cleared, state: state(before, at: t1), remote: remote(["keys": (t1, keys("key"))]), device: "Mac", now: t2)
        XCTAssertEqual(result.payload.sections["keys"]?.data, keys(nil))
        XCTAssertEqual(result.payload.sections["keys"]?.data["tmdbAPIKey"], .null)
        // And a clear that arrives is applied.
        let there = FlowSyncMerge.merge(local: before, state: state(before, at: t1), remote: remote(["keys": (t2, keys(nil))]), device: "Mac", now: t3)
        XCTAssertEqual(there.apply["keys"], keys(nil))
    }

    func testANewDeviceJoiningDoesNotWipeTheSyncWithItsEmptySettings() {
        let theirs = remote(["keys": (t1, keys("real")), "servers": (t1, FlowSyncMapping.serversData([MediaServerConfig(id: "s", kind: .emby, name: "E", baseURL: URL(string: "http://e")!)])), "playback": (t1, FlowSyncMapping.playbackData(AppSettings()))])
        let result = FlowSyncMerge.merge(local: local(tmdb: nil), state: FlowSyncState(), remote: theirs, device: "Apple TV", now: t3)
        XCTAssertEqual(result.apply["keys"], keys("real"))
        XCTAssertEqual(result.apply["servers"]?.array?.count, 1)
        XCTAssertEqual(result.payload.sections["keys"]?.updatedAt, t1)
        XCTAssertEqual(result.stamps["keys"]?.updatedAt, t1)
    }

    func testAFirstDevicePushesWhatItHasAndSkipsWhatIsEmpty() {
        let result = FlowSyncMerge.merge(local: local(tmdb: "mine"), state: FlowSyncState(), remote: nil, device: "iPhone", now: t1)
        XCTAssertEqual(result.payload.sections.keys.sorted(), ["keys", "playback"])
        XCTAssertEqual(result.payload.sections["keys"]?.device, "iPhone")
        XCTAssertEqual(result.payload.sections["keys"]?.updatedAt, t1)
        XCTAssertTrue(result.apply.isEmpty)
    }

    func testADeviceWithKeysFillsSectionsTheServerHasEmpty() {
        let theirs = remote(["keys": (t1, keys(nil))])
        let result = FlowSyncMerge.merge(local: local(tmdb: "mine"), state: FlowSyncState(), remote: theirs, device: "Mac", now: t2)
        XCTAssertEqual(result.payload.sections["keys"]?.data, keys("mine"))
        XCTAssertEqual(result.payload.sections["keys"]?.updatedAt, t2)
    }

    func testSameMomentDifferentDataSettlesTheSameOnBothDevices() {
        let a = local(tmdb: "aaa"), b = local(tmdb: "bbb")
        let blank = local(tmdb: nil)
        // Both devices changed their keys in the same second.
        let onA = FlowSyncMerge.merge(local: a, state: state(blank, at: t1), remote: remote(["keys": (t2, keys("bbb"))]), device: "A", now: t2)
        let onB = FlowSyncMerge.merge(local: b, state: state(blank, at: t1), remote: remote(["keys": (t2, keys("aaa"))]), device: "B", now: t2)
        XCTAssertEqual(onA.payload.sections["keys"]?.data, onB.payload.sections["keys"]?.data)
    }

    func testMergeIsIdempotent() {
        let mine = local(tmdb: "x")
        let first = FlowSyncMerge.merge(local: mine, state: FlowSyncState(), remote: nil, device: "Mac", now: t1)
        var next = FlowSyncState()
        next.sections = first.stamps
        let second = FlowSyncMerge.merge(local: mine, state: next, remote: first.payload, device: "Mac", now: t3)
        XCTAssertEqual(second.payload, first.payload)
        XCTAssertTrue(second.apply.isEmpty)
    }
}

// MARK: - Client

/// A stand-in for AES-GCM that is reversible and checks the additional data, so the client and engine are
/// tested the same on Linux as on Apple platforms.
struct FakeSealer: FlowSyncSealer {
    func seal(_ plaintext: Data, key: Data, aad: Data, nonce: Data?) throws -> Data { Data([0x53]) + key.prefix(4) + aad + plaintext }
    func open(_ combined: Data, key: Data, aad: Data) throws -> Data {
        let head = Data([0x53]) + key.prefix(4) + aad
        guard combined.starts(with: head) else { throw FlowSyncError.unreadable }
        return combined.dropFirst(head.count)
    }
}

extension FakeSyncWorker.Record {
    var asRecord: FlowSyncRecord { FlowSyncRecord(rev: rev, blob: blob) }
}

/// The Worker's rules from docs/SYNC.md, in memory.
final class FakeSyncWorker: HTTPTransport, @unchecked Sendable {
    struct Record { var authHash: String; var rev: Int; var blob: String }
    private let lock = NSLock()
    var token = "tok"
    var record: Record?
    var requests: [URLRequest] = []
    /// When set, the next PUT first finds another device's write in place.
    var interferences: [String] = []
    var forcedStatus: Int?
    var puts = 0

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { handle(request) }

    private func handle(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        func reply(_ status: Int, _ body: String = "") -> (Data, HTTPURLResponse) {
            (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
        if let forcedStatus { return reply(forcedStatus, "no") }
        guard request.url?.path.hasPrefix("/sync/") == true, let id = request.url?.lastPathComponent, id.count == 32 else { return reply(404) }
        guard request.value(forHTTPHeaderField: "X-Flow-Token") == token else { return reply(401, "The token is missing or wrong.") }
        let auth = (request.value(forHTTPHeaderField: "Authorization") ?? "").replacingOccurrences(of: "Bearer ", with: "")
        let hash = FlowSyncKDF.sha256Hex(Data(auth.utf8))
        func body(_ r: Record) -> String { #"{"rev":\#(r.rev),"blob":"\#(r.blob)","updatedAt":"2026-10-24T18:00:00Z"}"# }
        switch request.httpMethod {
        case "GET":
            guard let record else { return reply(404) }
            return record.authHash == hash ? reply(200, body(record)) : reply(403, "This sync key doesn't match.")
        case "PUT":
            puts += 1
            if let existing = record, existing.authHash != hash { return reply(403, "This sync key doesn't match.") }
            let sent = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            guard let rev = sent?["rev"] as? Int, let blob = sent?["blob"] as? String else { return reply(400) }
            if blob.count > 200_000 { return reply(413) }
            if !interferences.isEmpty {
                let other = interferences.removeFirst()
                record = Record(authHash: hash, rev: (record?.rev ?? 0) + 1, blob: other)
            }
            if (record?.rev ?? 0) != rev { return reply(409, body(record!)) }
            record = Record(authHash: hash, rev: rev + 1, blob: blob)
            return reply(200, #"{"rev":\#(rev + 1)}"#)
        case "DELETE":
            guard let record else { return reply(204) }
            if record.authHash != hash { return reply(403) }
            self.record = nil
            return reply(204)
        default:
            return reply(405)
        }
    }
}

final class FlowSyncClientTests: XCTestCase {
    let pairing = try! FlowSyncPairing(key: "000G40R40M30E209185GR38E1W", server: "https://sync.example.workers.dev", token: "tok")

    func client(_ worker: FakeSyncWorker, pairing: FlowSyncPairing? = nil) throws -> FlowSyncClient {
        try FlowSyncClient(pairing: pairing ?? self.pairing, http: HTTPClient(transport: worker), sealer: FakeSealer())
    }

    func testRequestsCarryTheDocumentedHeadersAndPath() async throws {
        let worker = FakeSyncWorker()
        let c = try client(worker)
        XCTAssertNil(try await c.get())
        let request = try XCTUnwrap(worker.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://sync.example.workers.dev/sync/625ee37823f4fad87a1591ef9038d5c6")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Flow-Token"), "tok")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer MF8YRcz1DFlJqMdCJgMOrexYxSLXV50cYLJsfg2ts50")
        XCTAssertEqual(try await c.put(rev: 0, blob: "abc"), .written(rev: 1))
        let put = try XCTUnwrap(worker.requests.last)
        XCTAssertEqual(put.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual((try JSONSerialization.jsonObject(with: put.httpBody!) as? [String: Any])?["rev"] as? Int, 0)
        XCTAssertEqual(try await c.get(), FlowSyncRecord(rev: 1, blob: "abc", updatedAt: "2026-10-24T18:00:00Z"))
        XCTAssertEqual(worker.record?.authHash, "4c921fbf5d2aa65f33ff2423208ef4628a74ddb6f96196e2ff212c073cbd02b0")
    }

    func testAStaleWriteComesBackAsAConflict() async throws {
        let worker = FakeSyncWorker()
        let c = try client(worker)
        _ = try await c.put(rev: 0, blob: "one")
        _ = try await c.put(rev: 1, blob: "two")
        guard case .conflict(let latest) = try await c.put(rev: 1, blob: "late") else { return XCTFail("expected a conflict") }
        XCTAssertEqual(latest.rev, 2)
        XCTAssertEqual(latest.blob, "two")
    }

    func testStatusesBecomeSentencesToActOn() async throws {
        let worker = FakeSyncWorker()
        let c = try client(worker)
        _ = try await c.put(rev: 0, blob: "x")

        // Another key is another record, so the 403 is met by changing who the record says owns it.
        worker.record?.authHash = "somebody else"
        do { _ = try await c.get(); XCTFail() } catch { XCTAssertEqual(error as? FlowSyncError, .keyMismatch) }
        XCTAssertEqual(FlowSyncError.keyMismatch.errorDescription, "This sync key doesn't match.")

        let badToken = try FlowSyncPairing(key: pairing.keyText, server: pairing.server, token: "nope")
        do { _ = try await client(worker, pairing: badToken).get(); XCTFail() } catch { XCTAssertEqual(error as? FlowSyncError, .unreachable) }
        XCTAssertEqual(FlowSyncError.unreachable.errorDescription, "Couldn't reach your sync server. Check its address and token.")

        worker.forcedStatus = 413
        do { _ = try await c.put(rev: 1, blob: "big"); XCTFail() } catch { XCTAssertEqual(error as? FlowSyncError, .tooLarge) }
        worker.forcedStatus = 501
        do { _ = try await c.get(); XCTFail() } catch { XCTAssertEqual(error as? FlowSyncError, .needsKV) }
        XCTAssertEqual(FlowSyncError.needsKV.errorDescription, "Sync needs a KV namespace bound as SYNC. See web/proxy/README.md.")
        worker.forcedStatus = 503
        do { _ = try await c.get(); XCTFail() } catch { XCTAssertEqual(error as? FlowSyncError, .server(status: 503)) }
    }

    func testAnUnreachableServerIsSaidInWords() async throws {
        struct Down: HTTPTransport {
            func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { throw FlowError.decoding("boom") }
        }
        let c = try FlowSyncClient(pairing: pairing, http: HTTPClient(transport: Down()), sealer: FakeSealer())
        do { _ = try await c.get(); XCTFail() } catch { XCTAssertEqual(error as? FlowSyncError, .unreachable) }
        let offline = try FlowSyncClient(pairing: pairing, http: HTTPClient(transport: OfflineTransport()), sealer: FakeSealer())
        do { _ = try await offline.get(); XCTFail() } catch { XCTAssertEqual((error as? FlowError)?.errorDescription, "You're offline. Check your connection and try again.") }
    }

    func testDeleteRemovesTheRecord() async throws {
        let worker = FakeSyncWorker()
        let c = try client(worker)
        _ = try await c.put(rev: 0, blob: "x")
        try await c.delete()
        XCTAssertNil(worker.record)
        try await c.delete()
    }
}

final class FlowSyncEngineTests: XCTestCase {
    let pairing = try! FlowSyncPairing(key: "000G40R40M30E209185GR38E1W", server: "https://sync.example.workers.dev", token: "tok")
    let t1 = Date(timeIntervalSince1970: 1_761_000_000)
    let t2 = Date(timeIntervalSince1970: 1_761_000_100)
    let t3 = Date(timeIntervalSince1970: 1_761_000_200)

    func engine(_ worker: FakeSyncWorker, device: String) throws -> FlowSyncEngine {
        FlowSyncEngine(client: try FlowSyncClient(pairing: pairing, http: HTTPClient(transport: worker), sealer: FakeSealer()), device: device)
    }

    func sections(tmdb: String?) -> [String: JSONValue] {
        var c = Credentials()
        c.tmdbAPIKey = tmdb
        return FlowSyncMapping.sections(credentials: c, settings: AppSettings())
    }

    func testTwoDevicesConverge() async throws {
        let worker = FakeSyncWorker()
        let phone = try engine(worker, device: "iPhone"), tv = try engine(worker, device: "Apple TV")

        let first = try await phone.sync(local: sections(tmdb: "key-1"), state: FlowSyncState(), now: t1)
        XCTAssertTrue(first.pushed)
        XCTAssertEqual(first.state.rev, 1)

        let joined = try await tv.sync(local: sections(tmdb: nil), state: FlowSyncState(), now: t2)
        XCTAssertFalse(joined.pushed)
        XCTAssertEqual(joined.apply["keys"]?["tmdbAPIKey"], .string("key-1"))
        XCTAssertEqual(joined.state.rev, 1)

        // The phone changes its key; the next sync on the TV applies it.
        let second = try await phone.sync(local: sections(tmdb: "key-2"), state: first.state, now: t2)
        XCTAssertTrue(second.pushed)
        let pulled = try await tv.sync(local: sections(tmdb: "key-1"), state: joined.state, now: t3)
        XCTAssertEqual(pulled.apply["keys"]?["tmdbAPIKey"], .string("key-2"))
        XCTAssertFalse(pulled.pushed)
    }

    func testNothingIsSentWhenNothingDiffers() async throws {
        let worker = FakeSyncWorker()
        let phone = try engine(worker, device: "iPhone")
        let first = try await phone.sync(local: sections(tmdb: "k"), state: FlowSyncState(), now: t1)
        XCTAssertEqual(worker.puts, 1)
        let again = try await phone.sync(local: sections(tmdb: "k"), state: first.state, now: t2)
        XCTAssertFalse(again.pushed)
        XCTAssertEqual(worker.puts, 1)
        // Even from a device that lost its stamps: the merge comes out as the server's copy, so no write.
        let reinstalled = try await phone.sync(local: sections(tmdb: "k"), state: FlowSyncState(), now: t3)
        XCTAssertFalse(reinstalled.pushed)
        XCTAssertEqual(worker.puts, 1)
    }

    func testAConflictIsMergedAndWrittenAgain() async throws {
        let worker = FakeSyncWorker()
        let phone = try engine(worker, device: "iPhone")
        let first = try await phone.sync(local: sections(tmdb: nil), state: FlowSyncState(), now: t1)

        // Another device's write lands between the phone's read and its write.
        let client = try FlowSyncClient(pairing: pairing, http: HTTPClient(transport: worker), sealer: FakeSealer())
        var theirs = try client.open(try XCTUnwrap(worker.record).asRecord)
        var settings = AppSettings()
        settings.sources.addons = [AddonConfig(manifestURL: URL(string: "https://a.example/manifest.json")!, name: "A")]
        theirs.sections["addons"] = FlowSyncSection(updatedAt: t2, device: "Mac", data: FlowSyncMapping.addonsData(settings.sources.addons))
        worker.interferences = [try client.seal(theirs.plaintext())]

        let result = try await phone.sync(local: sections(tmdb: "typed"), state: first.state, now: t3)
        XCTAssertTrue(result.pushed)
        // The first write, the one that met a conflict, and the merged one.
        XCTAssertEqual(worker.puts, 3)
        XCTAssertEqual(result.apply["addons"]?.array?.count, 1)
        let final = try client.open(try XCTUnwrap(worker.record).asRecord)
        XCTAssertEqual(final.sections["keys"]?.data["tmdbAPIKey"], .string("typed"))
        XCTAssertEqual(final.sections["addons"]?.data.array?.count, 1)
    }

    func testGivesUpAfterThreeTriesAndSaysSo() async throws {
        let worker = FakeSyncWorker()
        let phone = try engine(worker, device: "iPhone")
        _ = try await phone.sync(local: sections(tmdb: nil), state: FlowSyncState(), now: t1)
        let state = try await phone.sync(local: sections(tmdb: nil), state: FlowSyncState(), now: t1).state
        // Someone else writes before every one of this device's tries.
        let blob = worker.record!.blob
        worker.interferences = [blob, blob, blob, blob, blob]
        do {
            _ = try await phone.sync(local: sections(tmdb: "typed"), state: state, now: t2)
            XCTFail("expected it to give up")
        } catch {
            XCTAssertEqual(error as? FlowSyncError, .tooManyConflicts)
        }
        XCTAssertEqual(worker.puts, 1 + FlowSyncEngine.maxAttempts)
    }

    func testARecordErasedElsewhereIsNotWrittenBack() async throws {
        let worker = FakeSyncWorker()
        let phone = try engine(worker, device: "iPhone")
        let first = try await phone.sync(local: sections(tmdb: "k"), state: FlowSyncState(), now: t1)
        worker.record = nil
        do {
            _ = try await phone.sync(local: sections(tmdb: "k"), state: first.state, now: t2)
            XCTFail("expected it to refuse")
        } catch {
            XCTAssertEqual(error as? FlowSyncError, .erased)
        }
        XCTAssertNil(worker.record)
    }

    func testJoiningAKeyWithNoRecordIsRefusedInsteadOfStartingAnotherSync() async throws {
        let worker = FakeSyncWorker()
        let tv = try engine(worker, device: "Apple TV")
        do {
            _ = try await tv.sync(local: sections(tmdb: "mine"), state: FlowSyncState(), createIfMissing: false, now: t1)
            XCTFail("expected it to refuse")
        } catch {
            XCTAssertEqual(error as? FlowSyncError, .noSuchSync)
        }
        XCTAssertNil(worker.record)
        XCTAssertEqual(worker.puts, 0)
    }

    #if canImport(CryptoKit)
    func testTheServerNeverSeesPlaintext() async throws {
        let worker = FakeSyncWorker()
        let real = FlowSyncEngine(client: try FlowSyncClient(pairing: pairing, http: HTTPClient(transport: worker), sealer: CryptoKitSealer()), device: "iPhone")
        _ = try await real.sync(local: sections(tmdb: "super-secret-key"), state: FlowSyncState(), now: t1)
        let body = String(data: worker.requests.last?.httpBody ?? Data(), encoding: .utf8) ?? ""
        XCTAssertFalse(body.isEmpty)
        XCTAssertFalse(body.contains("super-secret-key"))
        XCTAssertFalse(worker.record?.blob.contains("super") ?? true)
        // And it opens again with the key.
        let again = try await real.sync(local: sections(tmdb: nil), state: FlowSyncState(), now: t2)
        XCTAssertEqual(again.apply["keys"]?["tmdbAPIKey"], .string("super-secret-key"))
    }
    #endif
}

final class FlowSyncStoreTests: XCTestCase {
    func testPairingSurvivesTheStores() throws {
        let pairing = try FlowSyncPairing(key: "000G40R40M30E209185GR38E1W", server: "https://x.example", token: "t")
        let memory = InMemoryFlowSyncPairingStore()
        XCTAssertNil(memory.load())
        memory.save(pairing)
        XCTAssertEqual(memory.load(), pairing)
        memory.save(nil)
        XCTAssertNil(memory.load())

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flow-sync-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = FileFlowSyncPairingStore(store: JSONFileStore(directory: directory))
        file.save(pairing)
        XCTAssertEqual(file.load(), pairing)
        file.save(nil)
        XCTAssertNil(file.load())
        XCTAssertEqual(pairing.key, FlowSyncKey(bytes: Data(0..<16)))
    }

    func testStateRoundTripsThroughJSON() throws {
        var state = FlowSyncState()
        state.rev = 4
        state.lastPushedHash = "abc"
        state.sections["keys"] = .init(updatedAt: Date(timeIntervalSince1970: 1_761_000_000), dataHash: "h", device: "Mac")
        let data = try JSONEncoder.flow.encode(state)
        XCTAssertEqual(try JSONDecoder.flow.decode(FlowSyncState.self, from: data), state)
    }
}

final class TraktTokenBeforeRefreshTests: XCTestCase {
    func testANewerTokenFromSyncSpendsNoRefreshToken() async throws {
        let mock = MockTransport()
        mock.routes["/sync/playback"] = (200, "[]")
        mock.routes["/oauth/token"] = (200, #"{"access_token":"fresh","refresh_token":"r2","expires_in":7200}"#)
        let expired = OAuthToken(accessToken: "old", refreshToken: "r1", expiresAt: Date().addingTimeInterval(-100))
        let newer = OAuthToken(accessToken: "elsewhere", refreshToken: "r9", expiresAt: Date().addingTimeInterval(7000))
        let changes = TokenLog()
        let trakt = TraktClient(clientID: "id", token: expired, http: HTTPClient(transport: mock), onTokenChange: { changes.add($0) }, tokenBeforeRefresh: { current in
            XCTAssertEqual(current, expired)
            return newer
        })
        _ = try await trakt.playbackProgress()
        XCTAssertFalse(mock.requests.contains { $0.url?.path.hasSuffix("/oauth/token") == true })
        XCTAssertEqual(mock.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer elsewhere")
        XCTAssertEqual(changes.values.last.flatMap { $0 }?.accessToken, "elsewhere")
    }

    func testWithNothingNewerTheTokenIsRefreshedAsBefore() async throws {
        let mock = MockTransport()
        mock.routes["/sync/playback"] = (200, "[]")
        mock.routes["/oauth/token"] = (200, #"{"access_token":"fresh","refresh_token":"r2","expires_in":7200}"#)
        let expired = OAuthToken(accessToken: "old", refreshToken: "r1", expiresAt: Date().addingTimeInterval(-100))
        let trakt = TraktClient(clientID: "id", token: expired, http: HTTPClient(transport: mock), tokenBeforeRefresh: { _ in nil })
        _ = try await trakt.playbackProgress()
        XCTAssertTrue(mock.requests.contains { $0.url?.path.hasSuffix("/oauth/token") == true })
        XCTAssertEqual(mock.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer fresh")
    }

    func testTheAppleTVRefusalIsFriendly() {
        XCTAssertEqual(TraktOAuth.deviceSignInRefused, "Trakt didn't finish the Apple TV sign-in. Sign in on your iPhone, iPad, Mac or the website and turn on Sync to bring it here.")
    }
}

final class TokenLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [OAuthToken?] = []
    func add(_ token: OAuthToken?) { lock.lock(); storage.append(token); lock.unlock() }
    var values: [OAuthToken?] { lock.lock(); defer { lock.unlock() }; return storage }
}
