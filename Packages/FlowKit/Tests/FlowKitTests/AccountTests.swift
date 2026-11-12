import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

private func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

// MARK: - The number

final class AccountNumberTests: XCTestCase {
    func testIsSixteenDigitsLeadingZerosAllowed() {
        for _ in 0..<50 {
            let number = AccountNumber.generate()
            XCTAssertEqual(number.count, 16)
            XCTAssertTrue(number.allSatisfy { $0.isASCII && $0.isNumber })
        }
        // Bytes that map to 0 give leading zeros, and they are kept.
        XCTAssertEqual(AccountNumber.generate { _ in [UInt8](repeating: 10, count: 32) }, "0000000000000000")
    }

    func testBytesOf250AndUpAreThrownAwayNotFoldedIntoTheLowDigits() {
        var calls = 0
        // The first block is all rejected values; the second gives 7s. Nothing from the first may appear.
        let number = AccountNumber.generate { count in
            calls += 1
            return [UInt8](repeating: calls == 1 ? 255 : 7, count: count)
        }
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(number, "7777777777777777")
        // 249 is the last byte kept: 249 % 10 = 9. 250 is the first thrown away.
        XCTAssertEqual(AccountNumber.generate { _ in [UInt8](repeating: 249, count: 32) }, "9999999999999999")
        var edge = 0
        XCTAssertEqual(AccountNumber.generate { count in
            edge += 1
            return [UInt8](repeating: edge == 1 ? 250 : 3, count: count)
        }, "3333333333333333")
    }

    func testEveryDigitIsEquallyLikelyOverTheBytesThatAreKept() {
        var seen = [Int](repeating: 0, count: 10)
        for byte in 0..<250 { seen[byte % 10] += 1 }
        XCTAssertEqual(Set(seen).count, 1)
    }

    func testComesOutEvenlyFromTheRealGenerator() {
        var counts = [Int](repeating: 0, count: 10)
        for _ in 0..<2000 { for digit in AccountNumber.generate() { counts[Int(String(digit))!] += 1 } }
        // 32,000 digits: each near 3,200. A modulo bias would put 0 to 5 about 2.5 percent over.
        for count in counts { XCTAssertLessThan(abs(count - 3200), 250) }
    }

    func testShownInGroupsOfFour() {
        XCTAssertEqual(AccountNumber.group("1234567890123456"), "1234 5678 9012 3456")
        XCTAssertEqual(AccountNumber.group("123456"), "1234 56")
        XCTAssertEqual(AccountNumber.group(""), "")
    }

    func testFormatsAsYouType() {
        XCTAssertEqual(AccountNumber.formatTyped("1"), "1")
        XCTAssertEqual(AccountNumber.formatTyped("12345"), "1234 5")
        XCTAssertEqual(AccountNumber.formatTyped("1234-5678-9012-3456"), "1234 5678 9012 3456")
        XCTAssertEqual(AccountNumber.formatTyped("abc 1234 5678 9012 3456 789"), "1234 5678 9012 3456")
        XCTAssertEqual(AccountNumber.formatTyped(""), "")
    }

    func testParsesIgnoringSeparators() {
        XCTAssertEqual(AccountNumber.parse("1234 5678 9012 3456"), "1234567890123456")
        XCTAssertEqual(AccountNumber.parse("1234-5678-9012-3456"), "1234567890123456")
        XCTAssertEqual(AccountNumber.parse("1234–5678—9012.3456"), "1234567890123456")
        XCTAssertEqual(AccountNumber.parse("  1234567890123456\n"), "1234567890123456")
        XCTAssertEqual(AccountNumber.parse("0000 0000 0000 0001"), "0000000000000001")
    }

    func testRefusesAnythingThatIsNotExactlySixteenDigitsInWords() {
        for text in ["", "1234 5678 9012 345", "1234 5678 9012 34567", "1234 5678 9012 345a", "１２３４５６７８９０１２３４５６"] {
            XCTAssertNil(AccountNumber.parse(text), text)
            XCTAssertThrowsError(try AccountNumber.require(text)) { error in
                XCTAssertEqual(error as? AccountError, .incompleteNumber)
                XCTAssertEqual((error as? AccountError)?.errorDescription, "That account number isn’t complete. It is 16 digits.")
            }
        }
        XCTAssertTrue(AccountNumber.isValid("1234 5678 9012 3456"))
    }
}

// MARK: - Keys and sealing

final class AccountKeysTests: XCTestCase {
    // The test vector in docs/SYNC.md: account number 0123 4567 8901 2345.
    static let digits = "0123456789012345"
    static let master = "6344acd683acbcc2b39499f864630805f207854c02340dce85af69dbc225a1a2"

    func testReproducesTheDocumentsVector() {
        XCTAssertEqual(AccountKeys.iterations, 600_000)
        let master = PBKDF2SHA256.derive(password: Data(Self.digits.utf8), salt: AccountKeys.pbkdf2Salt, iterations: AccountKeys.iterations, length: 32)
        XCTAssertEqual(hex(master), Self.master)
        let keys = AccountKeys(master: master)
        XCTAssertEqual(keys.id, "6b91a0a5eaaedba1be38e16c44719d9d")
        XCTAssertEqual(keys.auth, "krsalCjaziq29vmpL5N-9mFSKKxHw9Gh6kBIXzMtEVs")
        XCTAssertEqual(hex(keys.enc), "6f9e0979236f1e7d4b238729e10b8a035b738a56df8a0c4b77e9094d62a2862f")
        XCTAssertEqual(keys.authHash, "7f8e801ad50486dc6ae701363fceaa06c36f4a2eacb469cecddee05a82bf9a59")
    }

    func testThePortablePBKDF2MatchesKnownAnswers() {
        let password = Data("password".utf8), salt = Data("salt".utf8)
        // RFC 6070 style vectors for HMAC-SHA256, checked against Python's hashlib.
        XCTAssertEqual(hex(PBKDF2SHA256.portable(password: password, salt: salt, iterations: 2, length: 32)), "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43")
        // Forty bytes is two blocks.
        XCTAssertEqual(hex(PBKDF2SHA256.portable(password: password, salt: salt, iterations: 4096, length: 40)),
                       "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134af7ad98c1b458ce3f")
        let number = Data(Self.digits.utf8)
        XCTAssertEqual(hex(PBKDF2SHA256.portable(password: number, salt: AccountKeys.pbkdf2Salt, iterations: 1, length: 32)),
                       "b19b6ea245168ac635a85b0fac566340ac80042893033e3bd73f9fe8adf8cfdc")
        XCTAssertEqual(hex(PBKDF2SHA256.portable(password: number, salt: AccountKeys.pbkdf2Salt, iterations: 1000, length: 32)),
                       "dbea4b96b71d6216f94efe9fed930df181e894a70bf06567e844b6ae3cf87301")
    }

    func testAnotherNumberIsAnotherAccount() {
        let a = AccountKeys(number: Self.digits, iterations: 20), b = AccountKeys(number: "0123456789012346", iterations: 20)
        XCTAssertNotEqual(a.id, b.id)
        XCTAssertNotEqual(a.auth, b.auth)
        XCTAssertNotEqual(a.enc, b.enc)
        XCTAssertEqual(a.id.count, 32)
        XCTAssertEqual(a, AccountKeys(number: Self.digits, iterations: 20))
    }

    func testDerivingOffTheCallersThreadGivesTheSameKeys() async {
        let keys = await AccountKeys.derive(number: Self.digits, iterations: 20)
        XCTAssertEqual(keys, AccountKeys(number: Self.digits, iterations: 20))
    }

    func testSealedValuesAreBoundToTheirSectionAndAccount() throws {
        let keys = AccountKeys(number: Self.digits, iterations: 20)
        let blob = try keys.seal("hello", section: "lists", sealer: FakeSealer())
        XCTAssertEqual(try keys.open(blob, section: "lists", sealer: FakeSealer()), "hello")
        XCTAssertThrowsError(try keys.open(blob, section: "progress", sealer: FakeSealer())) { XCTAssertEqual($0 as? AccountError, .unreadable) }
        let other = AccountKeys(number: "0123456789012346", iterations: 20)
        XCTAssertThrowsError(try other.open(blob, section: "lists", sealer: FakeSealer())) { XCTAssertEqual($0 as? AccountError, .unreadable) }
        XCTAssertThrowsError(try keys.open("AAAA", section: "lists", sealer: FakeSealer())) { XCTAssertEqual($0 as? AccountError, .unreadable) }
        XCTAssertEqual(AccountError.unreadable.errorDescription, "Couldn’t read the synced data. Check that the account number here matches your other devices.")
    }

    #if canImport(CryptoKit)
    func testCommonCryptoAndThePortableCodeAgree() throws {
        #if canImport(CommonCrypto)
        let password = Data(Self.digits.utf8)
        let platform = try XCTUnwrap(PBKDF2SHA256.commonCrypto(password: password, salt: AccountKeys.pbkdf2Salt, iterations: 1000, length: 32))
        XCTAssertEqual(platform, PBKDF2SHA256.portable(password: password, salt: AccountKeys.pbkdf2Salt, iterations: 1000, length: 32))
        #endif
    }

    /// The vector's blob, made and opened with CryptoKit. Linux has no AES-GCM here, so this runs on Apple platforms.
    func testVectorBlob() throws {
        let keys = AccountKeys(number: Self.digits)
        let blob = try keys.seal(#"{"v":1,"sections":{}}"#, section: "settings", sealer: CryptoKitSealer(), nonce: Data(0..<12))
        XCTAssertEqual(blob, "AAECAwQFBgcICQoL-YJfmbY_Yl_9mwPbJ5J_OFZ4fU5zMJZ57StJ4zawwoqNrv-vcg")
        XCTAssertEqual(try keys.open(blob, section: "settings", sealer: CryptoKitSealer()), #"{"v":1,"sections":{}}"#)
        XCTAssertThrowsError(try keys.open(blob, section: "lists", sealer: CryptoKitSealer()))
    }

    func testEveryWriteUsesAFreshNonce() throws {
        let keys = AccountKeys(number: Self.digits, iterations: 20)
        XCTAssertNotEqual(try keys.seal("same", section: "lists", sealer: CryptoKitSealer()), try keys.seal("same", section: "lists", sealer: CryptoKitSealer()))
    }
    #endif
}

// MARK: - Times, canonical JSON, merging

private let now = AccountTime.ms("2026-11-01T12:00:00.000Z")
private let day = 86_400_000
private func t(_ offset: Int) -> JSONValue { .string(AccountTime.string(ms: now + offset)) }
private func s(_ text: String) -> JSONValue { .string(text) }
private func n(_ value: Int) -> JSONValue { .number(Double(value)) }
private func ep(_ season: Int, _ episode: Int) -> JSONValue { AccountWire.episodeObject(season, episode) }
private func state(_ build: (inout AccountWire.State) -> Void = { _ in }) -> AccountWire.State {
    var state = AccountWire.State()
    build(&state)
    return state
}
private func play(_ key: String, _ offset: Int, _ episode: JSONValue? = nil) -> AccountObject {
    var entry: AccountObject = ["key": s(key), "watchedAt": t(offset)]
    if let episode { entry["episode"] = episode }
    return entry
}

final class AccountTimeTests: XCTestCase {
    func testWritesMillisecondsInUTC() {
        XCTAssertEqual(now, 1_793_534_400_000)
        XCTAssertEqual(AccountTime.string(ms: 1_793_534_400_123), "2026-11-01T12:00:00.123Z")
        XCTAssertEqual(AccountTime.string(ms: 0), "1970-01-01T00:00:00.000Z")
        XCTAssertEqual(AccountTime.string(ms: 951_868_799_000), "2000-02-29T23:59:59.000Z")
        XCTAssertEqual(AccountTime.string(Date(timeIntervalSince1970: 1_792_864_800)), "2026-10-24T18:00:00.000Z")
        XCTAssertEqual(AccountTime.month(ms: now), "2026-11")
    }

    func testReadsWithOrWithoutAFraction() {
        XCTAssertEqual(AccountTime.ms("2026-10-24T18:00:00Z"), 1_792_864_800_000)
        XCTAssertEqual(AccountTime.ms("2026-10-24T18:00:00.5Z"), 1_792_864_800_500)
        XCTAssertEqual(AccountTime.ms("2026-10-24T18:00:00.123456Z"), 1_792_864_800_123)
        XCTAssertEqual(AccountTime.ms("2026-10-24T20:00:00+02:00"), 1_792_864_800_000)
        XCTAssertEqual(AccountTime.ms("2000-02-29T23:59:59.000Z"), 951_868_799_000)
        XCTAssertEqual(AccountTime.ms("not a time"), 0)
        XCTAssertEqual(AccountTime.ms(""), 0)
        XCTAssertEqual(AccountTime.ms(JSONValue.number(5)), 0)
    }

    func testEveryWholeSecondRoundTrips() {
        for ms in stride(from: 0, to: 4_000_000_000_000, by: 77_777_777_777) {
            XCTAssertEqual(AccountTime.ms(AccountTime.string(ms: ms)), ms)
        }
    }
}

final class AccountWireTests: XCTestCase {
    func testCanonicalJSONIsSortedCompactAndWrittenLikeJavaScript() {
        let value: JSONValue = .object(["b": n(1), "a": .array([s("x/y"), .number(41.5), .bool(true), .null]), "é": s("ünï \"q\" \\ \n\t\u{01}")])
        XCTAssertEqual(AccountWire.canonical(value), #"{"a":["x/y",41.5,true,null],"b":1,"é":"ünï \"q\" \\ \n\t\u0001"}"#)
        XCTAssertEqual(AccountWire.canonical(.number(6000.25)), "6000.25")
        XCTAssertEqual(AccountWire.canonical(.number(-0.0)), "0")
        XCTAssertEqual(AccountWire.canonical(.number(1_792_864_800)), "1792864800")
    }

    func testIdsFollowTheApps() {
        XCTAssertEqual(AccountWire.historyID(["key": s("show:1396"), "episode": ep(3, 7), "watchedAt": s("2026-10-24T18:00:00.900Z")]), "show:1396:S03E07:1792864800")
        XCTAssertEqual(AccountWire.historyID(["key": s("movie:693134"), "watchedAt": s("2026-10-24T18:00:00Z")]), "movie:693134:-:1792864800")
        XCTAssertEqual(AccountWire.progressID(["key": s("show:1"), "episode": ep(1, 2)]), "show:1:S01E02")
        XCTAssertEqual(AccountWire.progressID(["key": s("movie:1")]), "movie:1")
        // The same ids the apps' own models make.
        let key = MediaKey(type: .show, tmdbID: 1396)
        let entry = HistoryEntry(key: key, episode: EpisodeRef(season: 3, episode: 7), watchedAt: Date(timeIntervalSince1970: 1_792_864_800))
        XCTAssertEqual(entry.id, AccountWire.historyID(AccountBridge.state(library: { var l = LocalLibrary(); l.history = [entry]; return l }(), sources: [:], order: nil).history[0]))
    }

    func testKeysAreCheckedWithoutRegularExpressions() {
        XCTAssertTrue(AccountWire.isKey("movie:693134"))
        XCTAssertTrue(AccountWire.isKey("show:1"))
        for bad in ["", "movie", "movie:", "tv:1", "movie:1a", "movie:1:2", "movie: 1", "show:-1"] { XCTAssertFalse(AccountWire.isKey(bad), bad) }
        XCTAssertTrue(AccountWire.isHistorySection("history-2026-10"))
        XCTAssertTrue(AccountWire.isHistorySection("history-2026-10-12"))
        for bad in ["history-2026", "history-2026-1", "history-2026-10-", "history-2026-10-x", "lists", "history-2026-10-2-3"] { XCTAssertFalse(AccountWire.isHistorySection(bad), bad) }
        XCTAssertTrue(AccountWire.isItemsSection("items-0"))
        XCTAssertTrue(AccountWire.isItemsSection("items-f"))
        for bad in ["items-g", "items-F", "items-", "items-10"] { XCTAssertFalse(AccountWire.isItemsSection(bad), bad) }
        XCTAssertEqual(AccountWire.itemsShard("movie:17"), "items-1")
        XCTAssertEqual(AccountWire.itemsShard("show:30"), "items-e")
    }

    // MARK: Lists

    func testWatchlistsAreUnitedWithTheNewestEntryPerTitle() {
        let a = state { $0.watchlist = [["key": s("movie:1"), "addedAt": t(-1000)]] }
        let b = state { $0.watchlist = [["key": s("movie:1"), "addedAt": t(-5000), "extra": s("old")], ["key": s("movie:2"), "addedAt": t(-2000)]] }
        let merged = AccountWire.merge(a, b, now: now)
        XCTAssertEqual(merged.watchlist.map { $0["key"] }, [s("movie:1"), s("movie:2")])
        XCTAssertNil(merged.watchlist[0]["extra"])
    }

    func testTheSameWhicheverSideIsLocal() {
        let a = state {
            $0.watchlist = [["key": s("movie:1"), "addedAt": t(-1000), "tag": s("a")]]
            $0.ratings = ["movie:1": ["value": n(8), "ratedAt": t(-100)]]
            $0.order = ["keys": .array([s("movie:1")]), "updatedAt": t(-50)]
        }
        let b = state {
            $0.watchlist = [["key": s("movie:1"), "addedAt": t(-1000), "tag": s("b")]]
            $0.ratings = ["movie:1": ["value": n(6), "ratedAt": t(-100)]]
            $0.order = ["keys": .array([s("movie:1")]), "updatedAt": t(-50)]
        }
        XCTAssertEqual(AccountWire.merge(a, b, now: now), AccountWire.merge(b, a, now: now))
    }

    func testARemovalWinsUntilTheTitleIsAddedAgainLater() {
        let had: AccountObject = ["key": s("movie:1"), "addedAt": t(-10_000)]
        let removed = state { $0.removed = ["watchlist:movie:1": AccountTime.string(ms: now - 5000)] }
        XCTAssertEqual(AccountWire.merge(state { $0.watchlist = [had] }, removed, now: now).watchlist, [])
        let again: AccountObject = ["key": s("movie:1"), "addedAt": t(-1000)]
        XCTAssertEqual(AccountWire.merge(state { $0.watchlist = [again] }, removed, now: now).watchlist, [again])
        // A removal at the very moment of adding is a removal.
        let at = AccountTime.string(ms: now - 1000)
        XCTAssertEqual(AccountWire.merge(state { $0.watchlist = [["key": s("movie:1"), "addedAt": s(at)]] }, state { $0.removed = ["watchlist:movie:1": at] }, now: now).watchlist, [])
    }

    func testRemovalsAreForgottenAfterNinetyDays() {
        let removed = ["watchlist:movie:1": AccountTime.string(ms: now - 91 * day), "watchlist:movie:2": AccountTime.string(ms: now - 89 * day)]
        XCTAssertEqual(Set(AccountWire.pruneRemoved(removed, now: now).keys), ["watchlist:movie:2"])
        XCTAssertEqual(Set(AccountWire.merge(state(), state { $0.removed = removed }, now: now).removed.keys), ["watchlist:movie:2"])
    }

    func testTheNewerRatingWinsAndARatingRemovedLaterStaysRemoved() {
        let a = state { $0.ratings = ["movie:1": ["value": n(9), "ratedAt": t(-1000)]] }
        let b = state { $0.ratings = ["movie:1": ["value": n(4), "ratedAt": t(-2000)]] }
        XCTAssertEqual(AccountWire.merge(a, b, now: now).ratings["movie:1"]?["value"], n(9))
        XCTAssertEqual(AccountWire.merge(a, state { $0.removed = ["ratings:movie:1": AccountTime.string(ms: now - 500)] }, now: now).ratings, [:])
    }

    func testTheLaterCustomOrderWinsWhole() {
        let a = state { $0.order = ["keys": .array([s("movie:1"), s("movie:2")]), "updatedAt": t(-1000)] }
        let b = state { $0.order = ["keys": .array([s("movie:2"), s("movie:1")]), "updatedAt": t(-100)] }
        XCTAssertEqual(AccountWire.merge(a, b, now: now).order?["keys"], .array([s("movie:2"), s("movie:1")]))
        XCTAssertEqual(AccountWire.merge(a, state(), now: now).order?["keys"], .array([s("movie:1"), s("movie:2")]))
    }

    func testRewatchesUnionTheEpisodesOfOneRoundAndALaterRoundReplacesAnEarlierOne() {
        let s1: AccountObject = ["key": s("show:1"), "startedAt": t(-9000), "updatedAt": t(-4000), "watched": .array([ep(1, 1)])]
        let s2: AccountObject = ["key": s("show:1"), "startedAt": t(-9000), "updatedAt": t(-2000), "watched": .array([ep(1, 2)])]
        let merged = AccountWire.merge(state { $0.rewatches = [s1] }, state { $0.rewatches = [s2] }, now: now)
        XCTAssertEqual(merged.rewatches[0]["watched"], .array([ep(1, 1), ep(1, 2)]))
        XCTAssertEqual(merged.rewatches[0]["updatedAt"], t(-2000))
        let fresh: AccountObject = ["key": s("show:1"), "startedAt": t(-1000), "watched": .array([])]
        XCTAssertEqual(AccountWire.merge(state { $0.rewatches = [s1] }, state { $0.rewatches = [fresh] }, now: now).rewatches[0]["startedAt"], t(-1000))
    }

    func testShuffleUnionsWhatHasBeenPlayed() {
        let a = state { $0.shuffle = [["key": s("show:1"), "played": .array([ep(1, 1)])]] }
        let b = state { $0.shuffle = [["key": s("show:1"), "played": .array([ep(1, 2)])]] }
        XCTAssertEqual(AccountWire.merge(a, b, now: now).shuffle[0]["played"], .array([ep(1, 1), ep(1, 2)]))
    }

    // MARK: Progress, sources, cards

    func testOneResumePointPerEpisodeTheNewest() {
        func point(_ offset: Int, _ position: Int) -> AccountObject {
            ["key": s("show:1"), "episode": ep(1, 2), "percent": n(10), "positionSeconds": n(position), "durationSeconds": n(3000), "updatedAt": t(offset)]
        }
        XCTAssertEqual(AccountWire.merge(state { $0.progress = [point(-1000, 600)] }, state { $0.progress = [point(-2000, 100)] }, now: now).progress[0]["positionSeconds"], n(600))
        let done = state { $0.removed = ["progress:show:1:S01E02": AccountTime.string(ms: now - 500)] }
        XCTAssertEqual(AccountWire.merge(state { $0.progress = [point(-1000, 600)] }, done, now: now).progress, [])
    }

    func testKeepsTheFiveHundredNewestResumePoints() {
        let many: [AccountObject] = (0..<520).map { ["key": s("movie:\($0 + 1)"), "percent": n(5), "positionSeconds": n(60), "durationSeconds": n(6000), "updatedAt": t(-$0 * 1000)] }
        let merged = AccountWire.merge(state { $0.progress = many }, state(), now: now)
        XCTAssertEqual(merged.progress.count, 500)
        XCTAssertEqual(merged.progress[0]["key"], s("movie:1"))
    }

    func testKeepsTheNewerRememberedSourcePerTitle() {
        func source(_ offset: Int, _ provider: String) -> AccountObject { ["providerID": s(provider), "resolution": n(2160), "quality": s("WEB-DL"), "hdr": .array([]), "date": t(offset)] }
        let merged = AccountWire.merge(state { $0.sources = ["movie:1": source(-1000, "a")] },
                                       state { $0.sources = ["movie:1": source(-500, "b"), "movie:2": source(-900, "c")] }, now: now)
        XCTAssertEqual(merged.sources["movie:1"]?["providerID"], s("b"))
        XCTAssertEqual(merged.sources.count, 2)
        XCTAssertNil(merged.sources["movie:1"]?["key"])
    }

    func testDropsCardsNothingMentionsAndKeepsTheLocalOneOfAPairOfCards() {
        let merged = AccountWire.merge(
            state { $0.watchlist = [["key": s("movie:1"), "addedAt": t(-1)]]; $0.items = ["movie:1": ["title": s("One")], "movie:9": ["title": s("Nine")]] },
            state { $0.items = ["movie:1": ["title": s("Remote One")]] }, now: now)
        XCTAssertEqual(Set(merged.items.keys), ["movie:1"])
        XCTAssertEqual(merged.items["movie:1"]?["title"], s("One"))
    }

    // MARK: History

    func testHistoryIsAppendOnlyByIdAndListedNewestFirst() {
        let a = state { $0.history = [play("show:1", -3000, ep(1, 1)), play("movie:2", -1000)] }
        let b = state { $0.history = [play("show:1", -3000, ep(1, 1)), play("show:1", -2000, ep(1, 2))] }
        let merged = AccountWire.merge(a, b, now: now)
        XCTAssertEqual(merged.history.count, 3)
        XCTAssertEqual(merged.history.map { $0["key"] }, [s("movie:2"), s("show:1"), s("show:1")])
        XCTAssertEqual(merged.history[1]["episode"], ep(1, 2))
    }

    func testAPlayTakenOutOnAnotherDeviceIsGoneByItsTombstone() {
        let entry = play("show:1", -3000, ep(1, 1))
        let merged = AccountWire.merge(state { $0.history = [entry] }, state { $0.removed = ["history:" + AccountWire.historyID(entry): AccountTime.string(ms: now - 1000)] }, now: now)
        XCTAssertEqual(merged.history, [])
    }

    func testSplitsABusyMonthIntoPagesByTheDocumentsRule() throws {
        let entries: [AccountObject] = (0..<1500).map { play("show:1", -$0 * 1000, ep(1 + $0 / 100, $0 % 100 + 1)) }
        let pages = AccountWire.splitHistory(entries, removed: [:], limit: 20_000)
        let names = ["history-2026-11"] + (2...7).map { "history-2026-11-\($0)" }
        XCTAssertEqual(Set(pages.keys), Set(names))
        for text in pages.values { XCTAssertLessThanOrEqual(text.utf16.count, 20_000) }
        // The vector in docs/SYNC.md: every device must split the same way.
        let counts = try names.map { name -> Int in
            guard case .object(let page)? = AccountWire.parse(try XCTUnwrap(pages[name])), case .array(let list)? = page["entries"] else { throw AccountError.unreadable }
            return list.count
        }
        XCTAssertEqual(counts, [217, 217, 217, 217, 215, 214, 203])
        XCTAssertEqual(pages["history-2026-11"]?.utf16.count, 19_990)
        XCTAssertEqual(AccountWire.splitHistory(Array(entries.reversed()), removed: [:], limit: 20_000), pages)
        XCTAssertEqual(AccountWire.read(pages).state.history.count, 1500)
    }

    func testARemovalLivesWithTheMonthOfThePlayItRemoved() {
        let out = AccountWire.splitHistory([], removed: ["history:movie:1:-:1790000000": AccountTime.string(ms: now - 1000)])
        XCTAssertEqual(Set(out.keys), ["history-2026-09"])
        guard case .object(let page)? = AccountWire.parse(out["history-2026-09"] ?? ""), case .object(let removed)? = page["removed"] else { return XCTFail("no page") }
        XCTAssertEqual(removed, ["history:movie:1:-:1790000000": t(-1000)])
        XCTAssertLessThan(Double(AccountWire.pageLimit), 256 * 1024 * 0.75)
    }

    // MARK: Documents

    func testWritesNothingForAnEmptyLibrary() {
        XCTAssertEqual(AccountWire.write(AccountWire.State(), now: now), [:])
    }

    func testPutsHistoryInAValuePerMonthAndCardsInShardsByTMDBID() {
        let library = state {
            $0.watchlist = [["key": s("movie:17"), "addedAt": t(-1)]]
            $0.history = [play("movie:17", -1000), play("show:30", -40 * day, ep(1, 1))]
            $0.items = ["movie:17": ["title": s("Seventeen")], "show:30": ["title": s("Thirty")]]
        }
        let out = AccountWire.write(library, now: now)
        XCTAssertEqual(Set(out.keys), ["history-2026-09", "history-2026-11", "items-1", "items-e", "lists"])
    }

    func testReadsWhatItWritesAndAMergeLeavesItUnchanged() {
        let library = state {
            $0.watchlist = [["key": s("movie:1"), "addedAt": t(-5000)]]
            $0.favourites = [["key": s("show:2"), "addedAt": t(-4000)]]
            $0.ratings = ["movie:1": ["value": n(9), "ratedAt": t(-3000)]]
            $0.rewatches = [["key": s("show:2"), "startedAt": t(-2000), "updatedAt": t(-1000), "watched": .array([ep(1, 1)])]]
            $0.progress = [["key": s("movie:1"), "percent": .number(12.5), "positionSeconds": n(750), "durationSeconds": n(6000), "updatedAt": t(-900)]]
            $0.sources = ["movie:1": ["providerID": s("p"), "resolution": n(1080), "quality": s("WEB-DL"), "hdr": .array([s("HDR10")]), "date": t(-800)]]
            $0.history = [play("movie:1", -700)]
            $0.removed = ["watchlist:movie:3": AccountTime.string(ms: now - 600), "history:movie:9:-:1": AccountTime.string(ms: now - 500)]
            $0.order = ["keys": .array([s("movie:1")]), "updatedAt": t(-400)]
            $0.items = ["movie:1": ["title": s("One")], "show:2": ["title": s("Two")]]
        }
        let written = AccountWire.write(library, now: now)
        let back = AccountWire.read(written)
        XCTAssertEqual(back.unreadable, [])
        XCTAssertEqual(AccountWire.merge(back.state, AccountWire.State(), now: now), AccountWire.merge(library, AccountWire.State(), now: now))
        XCTAssertTrue(AccountWire.sameValues(written, AccountWire.write(back.state, now: now)))
    }

    func testKeepsFieldsItDoesNotKnowInADocumentAndInItsEntries() throws {
        let text = #"{"v":1,"watchlist":[{"key":"movie:1","addedAt":"2026-11-01T11:59:59.000Z","note":"keep"}],"futureField":{"a":1}}"#
        let out = AccountWire.write(AccountWire.read(["lists": text]).state, now: now)
        guard case .object(let doc)? = AccountWire.parse(try XCTUnwrap(out["lists"])), case .array(let list)? = doc["watchlist"], case .object(let first)? = list.first else { return XCTFail("no lists") }
        XCTAssertEqual(doc["futureField"], .object(["a": n(1)]))
        XCTAssertEqual(first["note"], s("keep"))
    }

    func testReportsANewerFormatInsteadOfReadingItAndSkipsUnreadableValues() {
        let read = AccountWire.read(["lists": #"{"v":2}"#, "progress": "{nope", "sources": #"{"v":1,"entries":{}}"#, "unknown": "{}"])
        XCTAssertEqual(read.newer, ["lists"])
        XCTAssertEqual(read.unreadable, ["progress"])
    }

    func testIgnoresEntriesItCannotUse() {
        let text = #"{"v":1,"watchlist":[{"key":"bad","addedAt":"2026-11-01T11:59:59Z"},{"key":"movie:1"},{"key":"movie:2","addedAt":"2026-11-01T11:59:59Z"}]}"#
        XCTAssertEqual(AccountWire.read(["lists": text]).state.watchlist.map { $0["key"] }, [s("movie:2")])
    }

    func testComparesValuesByMeaningNotKeyOrder() {
        XCTAssertTrue(AccountWire.sameValues(["lists": #"{"a":1,"b":2}"#], ["lists": #"{"b":2,"a":1}"#]))
        XCTAssertFalse(AccountWire.sameValues(["lists": #"{"a":1}"#], ["lists": #"{"a":2}"#]))
        XCTAssertFalse(AccountWire.sameValues(["lists": "{}"], [:]))
    }

    /// Values the website wrote: read here and written back, they are the same text. Both sides sort keys, escape strings,
    /// write numbers and split months the same way, or this fails.
    func testTheWebsitesValuesRoundTripToTheSameText() {
        let read = AccountWire.read(AccountFixtures.webValues)
        XCTAssertEqual(read.unreadable, [])
        XCTAssertEqual(read.newer, [])
        XCTAssertEqual(read.state.watchlist.count, 2)
        XCTAssertEqual(read.state.history.count, 2)
        XCTAssertEqual(AccountWire.write(read.state, now: AccountTime.ms("2026-11-01T12:00:00.000Z")), AccountFixtures.webValues)
        // Merged with nothing, as the website does it: the same, with resume points newest first.
        let merged = AccountWire.merge(read.state, AccountWire.State(), now: AccountTime.ms("2026-11-01T12:00:00.000Z"))
        XCTAssertEqual(AccountWire.write(merged, now: AccountTime.ms("2026-11-01T12:00:00.000Z")), AccountFixtures.webMergedValues)
    }
}

// MARK: - Between the apps' library and the wire

final class AccountBridgeTests: XCTestCase {
    let dune = MediaKey(type: .movie, tmdbID: 693134)
    let show = MediaKey(type: .show, tmdbID: 1396)

    func library() -> LocalLibrary {
        var library = LocalLibrary()
        let date = Date(timeIntervalSince1970: 1_792_864_800)
        library.watchlist = [ListEntry(key: dune, addedAt: date)]
        library.favourites = [ListEntry(key: show, addedAt: date.addingTimeInterval(-60))]
        library.ratings = [dune.description: LocalLibrary.Rating(value: 9, ratedAt: date)]
        library.rewatches = [Rewatch(key: show, startedAt: date, watched: [EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 1, episode: 2)], updatedAt: date.addingTimeInterval(30))]
        library.shuffle = [ShuffleRecord(key: show, played: [EpisodeRef(season: 2, episode: 4)])]
        library.progress = [PlaybackProgress(key: show, episode: EpisodeRef(season: 3, episode: 7), percent: 41.5, positionSeconds: 1180, durationSeconds: 2840, updatedAt: date)]
        library.history = [HistoryEntry(key: show, episode: EpisodeRef(season: 3, episode: 6), watchedAt: date), HistoryEntry(key: dune, watchedAt: date.addingTimeInterval(-100))]
        library.removed = ["watchlist:movie:603": date]
        library.items[dune.description] = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 693134), title: "Dune: Part Two", posterPath: "/p.jpg", backdropPath: "/b.jpg",
                                                      releaseDate: FlowDate.parse("2024-03-01"), genres: [Genre(id: 878, name: "Science Fiction")], voteAverage: 8.1, originalLanguage: "en")
        library.items[show.description] = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1396), title: "Breaking Bad")
        return library
    }

    func testAnAppsLibraryTravelsAsTheWireShapesAndComesBack() throws {
        let original = library()
        let sources = [dune.description: LastSource(providerID: "https://addon.example/manifest.json", filename: "Dune.mkv", bingeGroup: "torrentio|2160p", releaseGroup: "FLUX",
                                                  resolution: .uhd4k, quality: .webdl, hdr: ["DV"], date: Date(timeIntervalSince1970: 1_792_864_700))]
        let order = AccountOrder(keys: [show, dune], updatedAt: Date(timeIntervalSince1970: 1_792_864_000))
        let wire = AccountBridge.state(library: original, sources: sources, order: order)

        // The wire is a string key and ISO times.
        XCTAssertEqual(wire.watchlist, [["key": s("movie:693134"), "addedAt": s("2026-10-24T18:00:00.000Z")]])
        XCTAssertEqual(wire.ratings["movie:693134"]?["value"], n(9))
        XCTAssertEqual(wire.rewatches[0]["updatedAt"], s("2026-10-24T18:00:30.000Z"))
        XCTAssertEqual(wire.progress[0]["percent"], .number(41.5))
        XCTAssertEqual(wire.sources["movie:693134"]?["resolution"], n(2160))
        XCTAssertEqual(wire.sources["movie:693134"]?["quality"], s("WEB-DL"))
        XCTAssertNil(wire.sources["movie:693134"]?["url"])
        XCTAssertEqual(wire.items["movie:693134"]?["title"], s("Dune: Part Two"))
        XCTAssertEqual(wire.items["movie:693134"]?["year"], n(2024))
        XCTAssertEqual(wire.items["movie:693134"]?["date"], s("2024-03-01"))
        XCTAssertEqual(wire.items["movie:693134"]?["genres"], .array([n(878)]))
        XCTAssertEqual(wire.removed["watchlist:movie:603"], "2026-10-24T18:00:00.000Z")

        let back = AccountBridge.apply(wire, to: LocalLibrary())
        XCTAssertEqual(back.library.watchlist, original.watchlist)
        XCTAssertEqual(back.library.favourites, original.favourites)
        XCTAssertEqual(back.library.ratings, original.ratings)
        XCTAssertEqual(back.library.rewatches, original.rewatches)
        XCTAssertEqual(back.library.shuffle, original.shuffle)
        XCTAssertEqual(back.library.progress, original.progress)
        XCTAssertEqual(back.library.history, original.history)
        XCTAssertEqual(back.library.removed, original.removed)
        XCTAssertEqual(back.library.items[dune.description]?.title, "Dune: Part Two")
        XCTAssertEqual(back.library.items[dune.description]?.posterPath, "/p.jpg")
        XCTAssertEqual(back.library.items[dune.description]?.genres.first?.name, "Science Fiction")
        XCTAssertEqual(back.sources, sources)
        XCTAssertEqual(back.order, order)
    }

    func testWhatADeviceAlreadyHoldsIsKeptAsItIs() {
        var held = library()
        // A tracker's own id for a resume point stays on the device that has it.
        held.progress[0].remoteID = "trakt-123"
        held.items[dune.description]?.overview = "Details only this device has."
        let wire = AccountBridge.state(library: held, sources: [:], order: nil)
        let back = AccountBridge.apply(wire, to: held)
        XCTAssertEqual(back.library.progress[0].remoteID, "trakt-123")
        XCTAssertEqual(back.library.items[dune.description]?.overview, "Details only this device has.")
        XCTAssertEqual(back.library, held)
    }

    func testAWireLibraryWithoutCardsKeepsAPlaceholderPerTitle() {
        var wire = AccountWire.State()
        wire.watchlist = [["key": s("movie:5"), "addedAt": t(-1)], ["key": s("nonsense"), "addedAt": t(-1)]]
        wire.items = ["movie:5": ["title": s("Five"), "year": n(1999), "genres": .array([n(28)])]]
        let library = AccountBridge.apply(wire, to: LocalLibrary()).library
        XCTAssertEqual(library.watchlist.count, 1)
        XCTAssertEqual(library.items["movie:5"]?.title, "Five")
        XCTAssertEqual(library.items["movie:5"]?.genres, [Genre(id: 28, name: "Action")])
        XCTAssertNotNil(library.items["movie:5"]?.releaseDate)
    }

    func testRewatchesSavedBeforeUpdatedAtExistedReadItAsTheStart() throws {
        let json = #"{"key":{"type":"show","tmdbID":1},"startedAt":"2026-10-01T10:00:00Z","watched":[{"season":1,"episode":1}]}"#
        let rewatch = try JSONDecoder.flow.decode(Rewatch.self, from: Data(json.utf8))
        XCTAssertEqual(rewatch.updatedAt, rewatch.startedAt)
        XCTAssertEqual(rewatch.watched, [EpisodeRef(season: 1, episode: 1)])
        let again = try JSONDecoder.flow.decode(Rewatch.self, from: JSONEncoder.flow.encode(Rewatch(key: MediaKey(type: .show, tmdbID: 2), startedAt: Date(timeIntervalSince1970: 100), updatedAt: Date(timeIntervalSince1970: 500))))
        XCTAssertEqual(again.updatedAt, Date(timeIntervalSince1970: 500))
    }

    func testAdvancingARewatchMovesItsTime() async {
        let saved = SavedLibrary()
        let tracker = LocalTracker(library: LocalLibrary(), save: { saved.value = $0 })
        await tracker.startRewatch(show)
        let started = await tracker.library.rewatches[0]
        await tracker.advanceRewatch(show, episode: EpisodeRef(season: 1, episode: 1))
        let advanced = await tracker.library.rewatches[0]
        XCTAssertEqual(advanced.watched.count, 1)
        XCTAssertGreaterThanOrEqual(advanced.updatedAt, started.updatedAt)
    }

    func testOnlyAResumePointTickIsSlowToGoUp() {
        let base = library()
        var ticked = base
        ticked.progress[0].positionSeconds = 1300
        ticked.progress[0].updatedAt = base.progress[0].updatedAt.addingTimeInterval(10)
        XCTAssertTrue(ticked.onlyResumePointsDiffer(from: base))
        var rated = ticked
        rated.ratings[matrixKey.description] = LocalLibrary.Rating(value: 5)
        XCTAssertFalse(rated.onlyResumePointsDiffer(from: base))
        var watched = base
        watched.history.append(HistoryEntry(key: dune, watchedAt: Date()))
        XCTAssertFalse(watched.onlyResumePointsDiffer(from: base))
    }

    let matrixKey = MediaKey(type: .movie, tmdbID: 603)

    func testAMergedLibraryIsOnlyPutInWhenNothingChangedMeanwhile() async {
        let base = library()
        let tracker = LocalTracker(library: base, save: { _ in })
        var merged = base
        merged.watchlist = []
        let put = await tracker.replace(with: merged, unlessChangedSince: base)
        XCTAssertTrue(put)
        let current = await tracker.library
        XCTAssertEqual(current.watchlist, [])
        // The person changed something while the sync was out: their change stands, and goes up next round.
        await tracker.setRating(3, for: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1), title: "One"))
        let refused = await tracker.replace(with: base, unlessChangedSince: merged)
        XCTAssertFalse(refused)
    }
}

private final class SavedLibrary: @unchecked Sendable {
    var value: LocalLibrary?
}

// MARK: - The Worker

/// The Worker's account rules from docs/SYNC.md, in memory.
final class FakeAccountWorker: HTTPTransport, @unchecked Sendable {
    struct Value { var rev: Int; var blob: String; var updatedAt: String }
    struct Account { var authHash: String; var values: [String: Value] }
    private let lock = NSRecursiveLock()
    var accounts: [String: Account] = [:]
    var requests: [URLRequest] = []
    var forcedStatus: Int?
    /// Runs once, just before the next PUT is compared: another device getting in first.
    var beforeNextPut: (() -> Void)?
    var puts = 0

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { handle(request) }

    var putCount: Int { lock.lock(); defer { lock.unlock() }; return puts }

    func inject(id: String, section: String, blob: String) {
        lock.lock(); defer { lock.unlock() }
        let rev = (accounts[id]?.values[section]?.rev ?? 0) + 1
        accounts[id]?.values[section] = Value(rev: rev, blob: blob, updatedAt: "2026-11-01T12:00:00.000Z")
    }

    private func handle(_ request: URLRequest) -> (Data, HTTPURLResponse) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        func reply(_ status: Int, _ body: String = "") -> (Data, HTTPURLResponse) {
            (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
        if let forcedStatus { return reply(forcedStatus, "no") }
        let parts = (request.url?.path ?? "").split(separator: "/").map(String.init)
        guard parts.count >= 2, parts[0] == "account", parts[1].count == 32 else { return reply(404) }
        let id = parts[1]
        let section = parts.count > 2 ? parts[2] : nil
        let auth = (request.value(forHTTPHeaderField: "Authorization") ?? "").replacingOccurrences(of: "Bearer ", with: "")
        let hash = FlowSyncKDF.sha256Hex(Data(auth.utf8))

        if request.httpMethod == "POST", section == nil {
            if accounts[id] != nil { return reply(409, "That account already exists.") }
            accounts[id] = Account(authHash: hash, values: [:])
            return reply(201, #"{"createdAt":"2026-11-01T12:00:00.000Z"}"#)
        }
        guard let account = accounts[id], account.authHash == hash else { return reply(404, "No account matches that number.") }
        func body(_ v: Value?) -> String {
            guard let v else { return #"{"rev":0,"blob":null,"updatedAt":null}"# }
            return #"{"rev":\#(v.rev),"blob":"\#(v.blob)","updatedAt":"\#(v.updatedAt)"}"#
        }
        switch (request.httpMethod, section) {
        case ("GET", nil):
            let list = account.values.sorted { $0.key < $1.key }.map { #""\#($0.key)":{"rev":\#($0.value.rev),"updatedAt":"\#($0.value.updatedAt)","size":\#($0.value.blob.count)}"# }.joined(separator: ",")
            return reply(200, #"{"createdAt":"2026-11-01T12:00:00.000Z","sections":{\#(list)}}"#)
        case ("DELETE", nil):
            accounts[id] = nil
            return reply(204)
        case ("GET", let name?):
            guard let value = account.values[name] else { return reply(204) }
            return reply(200, body(value))
        case ("PUT", let name?):
            puts += 1
            if let hook = beforeNextPut { beforeNextPut = nil; hook() }
            let sent = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            guard let rev = sent?["rev"] as? Int, let blob = sent?["blob"] as? String else { return reply(400) }
            if blob.count > 262_144 { return reply(413) }
            let current = accounts[id]?.values[name]
            if (current?.rev ?? 0) != rev { return reply(409, body(current)) }
            accounts[id]?.values[name] = Value(rev: rev + 1, blob: blob, updatedAt: "2026-11-01T12:00:00.000Z")
            return reply(200, #"{"rev":\#(rev + 1)}"#)
        case ("DELETE", let name?):
            accounts[id]?.values[name] = nil
            return reply(204)
        default:
            return reply(405)
        }
    }
}

final class AccountClientTests: XCTestCase {
    let server = URL(string: "https://accounts.example.workers.dev")!
    let keys = AccountKeys(number: "0123456789012345", iterations: 20)

    func client(_ worker: FakeAccountWorker, keys: AccountKeys? = nil) -> AccountClient {
        AccountClient(server: server, keys: keys ?? self.keys, http: HTTPClient(transport: worker), sealer: FakeSealer())
    }

    func testRoutesAndHeadersAreTheDocumentedOnes() async throws {
        let worker = FakeAccountWorker()
        let c = client(worker)
        let created = try await c.create()
        XCTAssertTrue(created)
        let post = try XCTUnwrap(worker.requests.first)
        XCTAssertEqual(post.httpMethod, "POST")
        XCTAssertEqual(post.url?.absoluteString, "https://accounts.example.workers.dev/account/" + keys.id)
        XCTAssertEqual(post.value(forHTTPHeaderField: "Authorization"), "Bearer " + keys.auth)
        // No token header: the account routes take `auth` alone.
        XCTAssertNil(post.value(forHTTPHeaderField: "X-Flow-Token"))
        XCTAssertEqual(worker.accounts[keys.id]?.authHash, keys.authHash)

        let none = try await c.read("lists")
        XCTAssertNil(none)
        let written = try await c.write("lists", rev: 0, blob: "abc")
        XCTAssertEqual(written, .written(rev: 1))
        let put = try XCTUnwrap(worker.requests.last)
        XCTAssertEqual(put.url?.path, "/account/" + keys.id + "/lists")
        XCTAssertEqual(put.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual((try JSONSerialization.jsonObject(with: put.httpBody!) as? [String: Any])?["rev"] as? Int, 0)
        let read = try await c.read("lists")
        XCTAssertEqual(read, AccountRecord(rev: 1, blob: "abc", updatedAt: "2026-11-01T12:00:00.000Z"))
        let manifest = try await c.manifest()
        XCTAssertEqual(manifest.sections["lists"]?.rev, 1)
        try await c.delete()
        XCTAssertNil(worker.accounts[keys.id])
    }

    func testANumberThatIsTakenIsReportedNotThrown() async throws {
        let worker = FakeAccountWorker()
        let first = try await client(worker).create()
        let again = try await client(worker).create()
        XCTAssertTrue(first)
        XCTAssertFalse(again)
    }

    func testAStaleWriteComesBackAsAConflictWithTheLatestValue() async throws {
        let worker = FakeAccountWorker()
        let c = client(worker)
        _ = try await c.create()
        _ = try await c.write("lists", rev: 0, blob: "one")
        _ = try await c.write("lists", rev: 1, blob: "two")
        let late = try await c.write("lists", rev: 1, blob: "late")
        XCTAssertEqual(late, .conflict(rev: 2, blob: "two"))
        let fresh = try await c.write("progress", rev: 4, blob: "x")
        XCTAssertEqual(fresh, .conflict(rev: 0, blob: nil))
    }

    func testStatusesBecomeSentencesToActOn() async throws {
        let worker = FakeAccountWorker()
        let c = client(worker)
        // An unknown account and a wrong key answer the same.
        do { _ = try await c.manifest(); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .noSuchAccount) }
        _ = try await c.create()
        do { _ = try await client(worker, keys: AccountKeys(number: "0000000000000001", iterations: 20)).manifest(); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .noSuchAccount) }
        XCTAssertEqual(AccountError.noSuchAccount.errorDescription, "No account matches that number. Check it against the one you wrote down.")
        let cases: [(Int, AccountError)] = [(403, .originNotAllowed), (413, .tooLarge), (429, .limited), (501, .needsKV), (503, .server(status: 503)), (418, .unexpectedResponse)]
        for (status, expected) in cases {
            worker.forcedStatus = status
            do { _ = try await c.manifest(); XCTFail("\(status)") } catch { XCTAssertEqual(error as? AccountError, expected, "\(status)") }
        }
        XCTAssertEqual(AccountError.limited.errorDescription, "Too many tries from this network. Wait ten minutes, then try again.")
        XCTAssertEqual(AccountError.gone.errorDescription, "This account no longer exists. If you deleted it on another device, log out here.")
    }

    func testAnUnreachableServerIsSaidInWords() async throws {
        struct Down: HTTPTransport {
            func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { throw URLError(.notConnectedToInternet) }
        }
        let c = AccountClient(server: server, keys: keys, http: HTTPClient(transport: Down()), sealer: FakeSealer())
        do { _ = try await c.manifest(); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .unreachable) }
    }

    func testCreatingDrawsAnotherNumberWhenOneIsTakenAndLoggingInChecksTheNumber() async throws {
        let worker = FakeAccountWorker()
        let http = HTTPClient(transport: worker)
        // Two draws give the same number, then a different one: the first is taken, so the second draw is used.
        let taken = AccountNumber.generate { count in [UInt8](repeating: 1, count: count) }
        let existing = AccountKeys(number: taken, iterations: 20)
        worker.accounts[existing.id] = FakeAccountWorker.Account(authHash: existing.authHash, values: [:])
        var calls = 0
        let made = try await AccountLifecycle.create(server: server, http: http, sealer: FakeSealer(), iterations: 20, randomBytes: { count in
            calls += 1
            return [UInt8](repeating: calls == 1 ? 1 : 2, count: count)
        })
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(made.number, "2222222222222222")
        XCTAssertNotNil(worker.accounts[made.client.keys.id])

        let login = try await AccountLifecycle.login(number: "2222 2222 2222 2222", server: server, http: http, sealer: FakeSealer(), iterations: 20)
        XCTAssertEqual(login.number, "2222222222222222")
        do { _ = try await AccountLifecycle.login(number: "1234 5678", server: server, http: http, sealer: FakeSealer(), iterations: 20); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .incompleteNumber) }
        do { _ = try await AccountLifecycle.login(number: "3333 3333 3333 3333", server: server, http: http, sealer: FakeSealer(), iterations: 20); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .noSuchAccount) }
    }

    func testTheServerAddressComesFromTheBuildOrTheOneTyped() {
        XCTAssertEqual(AccountServer.url("flow-stream-proxy.example.workers.dev")?.absoluteString, "https://flow-stream-proxy.example.workers.dev")
        XCTAssertEqual(AccountServer.url(" https://Accounts.Example.dev/extra/path ")?.absoluteString, "https://accounts.example.dev")
        XCTAssertNil(AccountServer.url(""))
        XCTAssertNil(AccountServer.url("   "))
        XCTAssertNil(AccountServer.url(nil))
        XCTAssertEqual(AccountServer.resolve(build: "built.example.dev", typed: "typed.example.dev")?.host, "built.example.dev")
        XCTAssertEqual(AccountServer.resolve(build: "", typed: "typed.example.dev")?.host, "typed.example.dev")
        XCTAssertNil(AccountServer.resolve(build: nil, typed: nil))
        XCTAssertThrowsError(try AccountServer.normalize("")) { XCTAssertEqual($0 as? AccountError, .invalidServer) }
    }

    func testTheNumberIsKeptAndForgottenByTheStore() {
        let store = InMemoryAccountCredentialStore()
        XCTAssertNil(store.load())
        store.save(AccountCredentials(number: "0123456789012345", server: "https://a.example.dev"))
        XCTAssertEqual(store.load()?.number, "0123456789012345")
        store.save(nil)
        XCTAssertNil(store.load())
    }
}

// MARK: - A round of syncing

final class AccountEngineTests: XCTestCase {
    let server = URL(string: "https://accounts.example.workers.dev")!
    let dune = MediaKey(type: .movie, tmdbID: 693134)
    let matrix = MediaKey(type: .movie, tmdbID: 603)
    let show = MediaKey(type: .show, tmdbID: 1396)
    let date = Date(timeIntervalSince1970: 1_792_864_800)

    func item(_ key: MediaKey, _ title: String) -> MediaItem { MediaItem(type: key.type, ids: ExternalIDs(tmdb: key.tmdbID), title: title) }

    func local(_ build: (inout LocalLibrary) -> Void = { _ in }, sources: [String: LastSource] = [:], order: AccountOrder? = nil) -> AccountLocal {
        var library = LocalLibrary()
        build(&library)
        return AccountLocal(settings: FlowSyncMapping.sections(credentials: Credentials(), settings: AppSettings()), library: library, sources: sources, order: order)
    }

    func engine(_ client: AccountClient, device: String = "iPhone") -> AccountSyncEngine { AccountSyncEngine(client: client, device: device) }

    func newAccount(_ worker: FakeAccountWorker) async throws -> AccountClient {
        let made = try await AccountLifecycle.create(server: server, http: HTTPClient(transport: worker), sealer: FakeSealer(), iterations: 20)
        return made.client
    }

    func another(_ client: AccountClient, _ worker: FakeAccountWorker) -> AccountClient {
        AccountClient(server: server, keys: client.keys, http: HTTPClient(transport: worker), sealer: FakeSealer())
    }

    func testCreatingUploadsWhatTheDeviceHoldsAndNothingTwice() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        let mine = local({
            $0.watchlist = [ListEntry(key: dune, addedAt: date)]
            $0.ratings[dune.description] = LocalLibrary.Rating(value: 9, ratedAt: date)
            $0.history = [HistoryEntry(key: show, episode: EpisodeRef(season: 1, episode: 1), watchedAt: date)]
            $0.items[dune.description] = item(dune, "Dune: Part Two")
            $0.items[show.description] = item(show, "Breaking Bad")
        })
        let first = try await engine(client).sync(local: mine, state: AccountSyncState(), now: date)
        XCTAssertTrue(first.pushed)
        let held = try XCTUnwrap(worker.accounts[client.keys.id]).values
        // 693134 mod 16 is 14 (e) and 1396 mod 16 is 4.
        XCTAssertEqual(Set(held.keys), ["settings", "lists", "history-2026-10", "items-e", "items-4"])
        XCTAssertNotNil(held["settings"])
        XCTAssertNotNil(held["lists"])
        XCTAssertNotNil(held["history-2026-10"])
        XCTAssertNil(held["progress"])
        XCTAssertNil(held["sources"])
        // Nothing the server holds is readable without the key: the blob is the fake sealer's, bound to account and section.
        XCTAssertEqual(try client.open(AccountRecord(rev: 1, blob: try XCTUnwrap(held["lists"]).blob, updatedAt: nil), section: "lists").contains("movie:693134"), true)
        XCTAssertEqual(first.state.lastSyncedAt, date)

        // Again, with nothing changed: no writes at all.
        let puts = worker.putCount
        let second = try await engine(client).sync(local: mine, state: first.state, now: date.addingTimeInterval(300))
        XCTAssertFalse(second.pushed)
        XCTAssertEqual(worker.putCount, puts)
        XCTAssertEqual(second.library, first.library)
    }

    func testALoginKeepsTheDevicesDataAndMergesTheAccountsIn() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        let phone = local({
            $0.watchlist = [ListEntry(key: dune, addedAt: date)]
            $0.items[dune.description] = item(dune, "Dune: Part Two")
        })
        let uploaded = try await engine(client).sync(local: phone, state: AccountSyncState(), now: date)

        // Another device, with data of its own, logs in with nothing synced yet.
        let mac = local({
            $0.watchlist = [ListEntry(key: matrix, addedAt: date.addingTimeInterval(10))]
            $0.history = [HistoryEntry(key: matrix, watchedAt: date)]
            $0.items[matrix.description] = item(matrix, "The Matrix")
        })
        let joined = try await engine(another(client, worker), device: "Mac").sync(local: mac, state: AccountSyncState(), now: date.addingTimeInterval(60))
        XCTAssertEqual(Set(joined.library.watchlist.map(\.key)), [dune, matrix])
        XCTAssertEqual(joined.library.history.map(\.key), [matrix])
        XCTAssertEqual(joined.library.items[dune.description]?.title, "Dune: Part Two")
        XCTAssertTrue(joined.pushed)

        // The phone picks the Mac's data up at its next pull, and keeps its own.
        let pulled = try await engine(client).sync(local: AccountLocal(settings: phone.settings, library: uploaded.library, sources: [:], order: nil), state: uploaded.state, now: date.addingTimeInterval(120))
        XCTAssertEqual(Set(pulled.library.watchlist.map(\.key)), [dune, matrix])
        XCTAssertEqual(pulled.library.history.map(\.key), [matrix])
        XCTAssertFalse(pulled.pushed)
    }

    func testARemovalOnOneDeviceReachesTheOther() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        let both = local({
            $0.watchlist = [ListEntry(key: dune, addedAt: date), ListEntry(key: matrix, addedAt: date)]
            $0.items[dune.description] = item(dune, "Dune")
            $0.items[matrix.description] = item(matrix, "Matrix")
        })
        let first = try await engine(client).sync(local: both, state: AccountSyncState(), now: date)
        let second = try await engine(another(client, worker), device: "Mac").sync(local: AccountLocal(settings: both.settings, library: both.library, sources: [:], order: nil), state: AccountSyncState(), now: date.addingTimeInterval(10))

        // The phone takes Dune off the watchlist, which the tracker records as a removal.
        var trimmed = first.library
        trimmed.watchlist = trimmed.watchlist.filter { $0.key != dune }
        trimmed.removed["watchlist:" + dune.description] = date.addingTimeInterval(100)
        let pushed = try await engine(client).sync(local: AccountLocal(settings: both.settings, library: trimmed, sources: [:], order: nil), state: first.state, now: date.addingTimeInterval(101))
        XCTAssertTrue(pushed.pushed)
        XCTAssertEqual(pushed.library.watchlist.map(\.key), [matrix])

        let pulled = try await engine(another(client, worker), device: "Mac").sync(local: AccountLocal(settings: both.settings, library: second.library, sources: [:], order: nil), state: second.state, now: date.addingTimeInterval(200))
        XCTAssertEqual(pulled.library.watchlist.map(\.key), [matrix])
    }

    func testAWriteAnotherDeviceGotInFirstWithIsMergedAndWrittenAgain() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        let phone = local({
            $0.watchlist = [ListEntry(key: dune, addedAt: date)]
            $0.items[dune.description] = item(dune, "Dune")
        })
        let first = try await engine(client).sync(local: phone, state: AccountSyncState(), now: date)

        // While the phone syncs a new favourite, the Mac writes a new watchlist entry to `lists`.
        let macWire = AccountWire.State.with(watchlist: [["key": s("movie:603"), "addedAt": .string(AccountTime.string(date.addingTimeInterval(5)))]])
        worker.beforeNextPut = { [keys = client.keys, id = client.keys.id] in
            let text = AccountWire.write(macWire, now: AccountTime.ms(self.date))["lists"]!
            worker.inject(id: id, section: "lists", blob: try! keys.seal(text, section: "lists", sealer: FakeSealer()))
        }
        var changed = first.library
        changed.favourites = [ListEntry(key: show, addedAt: date.addingTimeInterval(20))]
        changed.items[show.description] = item(show, "Breaking Bad")
        let outcome = try await engine(client).sync(local: AccountLocal(settings: phone.settings, library: changed, sources: [:], order: nil), state: first.state, now: date.addingTimeInterval(30))
        XCTAssertEqual(Set(outcome.library.watchlist.map(\.key)), [dune, matrix])
        XCTAssertEqual(outcome.library.favourites.map(\.key), [show])
        let stored = try client.open(AccountRecord(rev: 0, blob: try XCTUnwrap(worker.accounts[client.keys.id]?.values["lists"]).blob, updatedAt: nil), section: "lists")
        XCTAssertTrue(stored.contains("movie:603") && stored.contains("movie:693134") && stored.contains("show:1396"))
    }

    func testAnAccountThatIsGoneIsSaidInWords() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        let first = try await engine(client).sync(local: local(), state: AccountSyncState(), now: date)
        worker.accounts[client.keys.id] = nil
        do { _ = try await engine(client).sync(local: local(), state: first.state, now: date); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .gone) }
    }

    func testAnotherDeviceThatKeepsGettingInFirstEndsInAnApology() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        _ = try await engine(client).sync(local: local({ $0.watchlist = [ListEntry(key: dune, addedAt: date)]; $0.items[dune.description] = item(dune, "Dune") }), state: AccountSyncState(), now: date)
        // Every PUT finds the value changed again.
        let keys = client.keys
        let churn = Churn(keys: keys)
        let wiggle = FakeAccountWorker.ChurnTransport(worker: worker, churn: churn)
        let busyClient = AccountClient(server: server, keys: keys, http: HTTPClient(transport: wiggle), sealer: FakeSealer())
        do {
            _ = try await engine(busyClient).sync(local: local({ $0.watchlist = [ListEntry(key: matrix, addedAt: date)]; $0.items[matrix.description] = item(matrix, "Matrix") }), state: AccountSyncState(), now: date)
            XCTFail("should give up")
        } catch {
            XCTAssertEqual(error as? AccountError, .busy)
            XCTAssertEqual((error as? AccountError)?.errorDescription, "Another device kept changing your account while Marquee was syncing. Try Sync Now again.")
        }
    }

    func testAValueFromAnotherAccountOrANewerVersionIsNotReadAsOurs() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        _ = try await engine(client).sync(local: local({ $0.watchlist = [ListEntry(key: dune, addedAt: date)]; $0.items[dune.description] = item(dune, "Dune") }), state: AccountSyncState(), now: date)
        // A value sealed for another section doesn't open here.
        let other = AccountKeys(number: "9999999999999999", iterations: 20)
        worker.inject(id: client.keys.id, section: "progress", blob: try other.seal("{}", section: "progress", sealer: FakeSealer()))
        do { _ = try await engine(client).sync(local: local(), state: AccountSyncState(), now: date); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .unreadable) }
        // A newer format is left alone and said so.
        worker.inject(id: client.keys.id, section: "progress", blob: try client.keys.seal(#"{"v":2}"#, section: "progress", sealer: FakeSealer()))
        do { _ = try await engine(client).sync(local: local(), state: AccountSyncState(), now: date); XCTFail() } catch { XCTAssertEqual(error as? AccountError, .newerVersion) }
    }

    func testSettingsTravelTheSameWayAsMarqueeSync() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        var credentials = Credentials()
        credentials.tmdbAPIKey = "tmdb-key"
        let phone = AccountLocal(settings: FlowSyncMapping.sections(credentials: credentials, settings: AppSettings()), library: LocalLibrary(), sources: [:], order: nil)
        _ = try await engine(client).sync(local: phone, state: AccountSyncState(), now: date)

        let tv = AccountLocal(settings: FlowSyncMapping.sections(credentials: Credentials(), settings: AppSettings()), library: LocalLibrary(), sources: [:], order: nil)
        let joined = try await engine(another(client, worker), device: "Apple TV").sync(local: tv, state: AccountSyncState(), now: date.addingTimeInterval(60))
        var applied = Credentials()
        var settings = AppSettings()
        for (name, data) in joined.settingsApply { FlowSyncMapping.apply(data, to: name, credentials: &applied, settings: &settings) }
        XCTAssertEqual(applied.tmdbAPIKey, "tmdb-key")
    }

    func testRememberedSourcesAndTheWatchlistOrderTravel() async throws {
        let worker = FakeAccountWorker()
        let client = try await newAccount(worker)
        let source = LastSource(providerID: "https://addon.example/manifest.json", filename: "Dune.mkv", resolution: .hd1080, quality: .bluray, hdr: [], date: date)
        let order = AccountOrder(keys: [matrix, dune], updatedAt: date)
        let phone = local({
            $0.watchlist = [ListEntry(key: dune, addedAt: date), ListEntry(key: matrix, addedAt: date)]
            $0.items[dune.description] = item(dune, "Dune")
            $0.items[matrix.description] = item(matrix, "Matrix")
        }, sources: [dune.description: source], order: order)
        _ = try await engine(client).sync(local: phone, state: AccountSyncState(), now: date)
        let joined = try await engine(another(client, worker), device: "Mac").sync(local: local(), state: AccountSyncState(), now: date.addingTimeInterval(60))
        XCTAssertEqual(joined.sources[dune.description], source)
        XCTAssertEqual(joined.order, order)
        // The release is described, never linked: no URL of a stream is in what was stored.
        let stored = try client.open(AccountRecord(rev: 1, blob: try XCTUnwrap(worker.accounts[client.keys.id]?.values["sources"]).blob, updatedAt: nil), section: "sources")
        XCTAssertFalse(stored.contains("http://") || stored.contains("token"))
    }
}

/// Another device that writes `lists` again before each of this one's writes.
final class Churn: @unchecked Sendable {
    let keys: AccountKeys
    var count = 0
    init(keys: AccountKeys) { self.keys = keys }

    func bump(_ worker: FakeAccountWorker) {
        count += 1
        var wire = AccountWire.State()
        wire.watchlist = [["key": .string("movie:\(1000 + count)"), "addedAt": .string(AccountTime.string(ms: AccountTime.ms("2026-10-24T18:00:00.000Z") + count))]]
        let text = AccountWire.write(wire, now: AccountTime.ms("2026-10-24T18:00:10.000Z"))["lists"]!
        worker.inject(id: keys.id, section: "lists", blob: try! keys.seal(text, section: "lists", sealer: FakeSealer()))
    }
}

extension FakeAccountWorker {
    /// Forwards to the worker, rearming the interference before every PUT.
    struct ChurnTransport: HTTPTransport {
        let worker: FakeAccountWorker
        let churn: Churn
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            if request.httpMethod == "PUT" { worker.beforeNextPut = { churn.bump(worker) } }
            return try await worker.send(request)
        }
    }
}

extension AccountWire.State {
    static func with(watchlist: [AccountObject]) -> AccountWire.State {
        var state = AccountWire.State()
        state.watchlist = watchlist
        return state
    }
}
