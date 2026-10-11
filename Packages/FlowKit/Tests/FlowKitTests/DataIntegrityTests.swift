import XCTest
@testable import FlowKit

/// Fixes from the settings, sync and cache review.
final class DataIntegrityTests: XCTestCase {
    private func tempStore() -> JSONFileStore {
        JSONFileStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("di-\(UUID().uuidString)"))
    }

    // MARK: ResponseCache

    func testConcurrentCallersShareTheFailureInsteadOfEachRetrying() async throws {
        let cache = ResponseCache(store: tempStore())
        let calls = ResponseCacheTests.Counter()
        struct Offline: Error {}
        let failures = await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<6 {
                group.addTask {
                    do {
                        _ = try await cache.cached("k", maxAge: 60) { () async throws -> Int in
                            _ = calls.next()
                            try await Task.sleep(nanoseconds: 80_000_000)
                            throw Offline()
                        }
                        return false
                    } catch { return true }
                }
            }
            return await group.reduce(0) { $0 + ($1 ? 1 : 0) }
        }
        XCTAssertEqual(failures, 6)
        XCTAssertEqual(calls.count, 1, "waiters join the running request and its failure")
        // The failed request is forgotten: the next call tries again.
        let value = try await cache.cached("k", maxAge: 60) { 7 }
        XCTAssertEqual(value, 7)
    }

    func testRejectedCredentialIsNotHiddenBehindOldData() async throws {
        let cache = ResponseCache(store: tempStore())
        await cache.set("old", for: "k")
        do {
            _ = try await cache.cached("k", maxAge: 0) { () async throws -> String in throw FlowError.unauthorized }
            XCTFail("an expired copy must not hide a rejected key")
        } catch {
            XCTAssertEqual(error as? FlowError, .unauthorized)
        }
        // Waiting on a running request that is rejected gets the same answer.
        let rejected = try await withThrowingTaskGroup(of: Bool.self) { group in
            for _ in 0..<2 {
                group.addTask {
                    do {
                        _ = try await cache.cached("k", maxAge: 0) { () async throws -> String in
                            try await Task.sleep(nanoseconds: 50_000_000)
                            throw FlowError.unauthorized
                        }
                        return false
                    } catch { return (error as? FlowError) == .unauthorized }
                }
            }
            return try await group.reduce(true) { $0 && $1 }
        }
        XCTAssertTrue(rejected)
    }

    func testClearIsNotUndoneByEarlierWrites() async throws {
        let store = tempStore()
        let cache = ResponseCache(store: store)
        for i in 0..<20 { await cache.set(i, for: "k\(i)") }
        await cache.clear()
        XCTAssertEqual(store.sizeInBytes, 0)
        let again = ResponseCache(store: store)
        let found = await again.value("k3", maxAge: 60, as: Int.self)
        XCTAssertNil(found)
    }

    func testLatestWriteWinsOnDisk() async throws {
        let store = tempStore()
        let cache = ResponseCache(store: store)
        for i in 0..<30 { await cache.set(i, for: "k") }
        // clear() waits for queued writes, so wait the same way: write a marker and clear nothing, then reload.
        let deadline = Date().addingTimeInterval(3)
        var onDisk: Int?
        while Date() < deadline {
            onDisk = await ResponseCache(store: store).value("k", maxAge: 60, as: Int.self)
            if onDisk == 29 { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(onDisk, 29)
    }

    func testCatalogCacheIsPerRegion() async throws {
        let body = #"{"page":1,"total_pages":1,"results":[{"id":603,"title":"The Matrix","release_date":"1999-03-31","genre_ids":[]}]}"#
        let mock = MockTransport()
        mock.routes["/trending/movie/week"] = (200, body)
        let cache = ResponseCache(store: tempStore())
        let key = "0123456789abcdef0123456789abcdef"
        let us = CatalogService(tmdb: TMDBClient(credential: key, region: "US", http: HTTPClient(transport: mock)), cache: cache)
        _ = try await us.trending(.movie)
        _ = try await us.trending(.movie)
        XCTAssertEqual(mock.requests.count, 1)
        let gb = CatalogService(tmdb: TMDBClient(credential: key, region: "GB", http: HTTPClient(transport: mock)), cache: cache)
        _ = try await gb.trending(.movie)
        XCTAssertEqual(mock.requests.count, 2, "a region change isn't answered from the other region's copy")
    }

    // MARK: Library merge

    private func key(_ id: Int) -> MediaKey { MediaKey(type: .show, tmdbID: id) }

    func testMergeOrderIsStableSoDevicesSettleInsteadOfPingPonging() {
        var a = LocalLibrary()
        var b = LocalLibrary()
        for id in 1...12 {
            a.shuffle.append(ShuffleRecord(key: key(id), played: [EpisodeRef(season: 1, episode: id)]))
            b.shuffle.append(ShuffleRecord(key: key(id + 6), played: [EpisodeRef(season: 2, episode: id)]))
        }
        let at = Date(timeIntervalSince1970: 1_700_000_000)
        for id in 1...6 {
            a.history.append(HistoryEntry(key: key(1), episode: EpisodeRef(season: 1, episode: id), watchedAt: at))
            b.history.append(HistoryEntry(key: key(2), episode: EpisodeRef(season: 1, episode: id), watchedAt: at))
        }
        let first = a.merged(with: b)
        for _ in 0..<5 { XCTAssertEqual(a.merged(with: b), first) }
        // Merging the result again changes nothing, so the pulling device has nothing to save and push back.
        XCTAssertEqual(first.merged(with: b), first)
        XCTAssertEqual(first.merged(with: a), first)
        XCTAssertEqual(first.shuffle.map(\.key.description), first.shuffle.map(\.key.description).sorted())
    }

    func testTrackerMergeFoldsInCloudCopyWithoutSavingWhenNothingChanged() async {
        final class Saves: @unchecked Sendable {
            private let lock = NSLock()
            private var n = 0
            func bump() { lock.lock(); n += 1; lock.unlock() }
            var count: Int { lock.lock(); defer { lock.unlock() }; return n }
        }
        let saves = Saves()
        var start = LocalLibrary()
        start.watchlist = [ListEntry(key: key(1), addedAt: Date(timeIntervalSince1970: 100))]
        let tracker = LocalTracker(library: start) { _ in saves.bump() }
        var cloud = LocalLibrary()
        cloud.watchlist = [ListEntry(key: key(2), addedAt: Date(timeIntervalSince1970: 200))]
        await tracker.merge(cloud)
        let merged = await tracker.library
        XCTAssertEqual(Set(merged.watchlist.map(\.key)), [key(1), key(2)])
        XCTAssertEqual(saves.count, 1)
        await tracker.merge(cloud)
        XCTAssertEqual(saves.count, 1, "already merged: no save, so no push")
    }

    // MARK: Import keeps secrets the file doesn't carry

    func testImportKeepsWebDAVAndIPTVPasswordsFromTheSameAddress() throws {
        let share = WebDAVConfig(id: "w", name: "NAS", baseURL: URL(string: "https://nas.example/dav")!, username: "me", password: "secret")
        let provider = IPTVProviderConfig(id: "p", name: "TV", kind: .xtream, url: URL(string: "https://iptv.example")!, username: "u", password: "hunter2")
        var local = AppSettings()
        local.webDAV = [share]
        local.liveTV.providers = [provider]
        // Someone's secret-free export of the same setup.
        let exported = try SetupShare.export(settings: local, credentials: Credentials(), includeSecrets: false)
        let bundle = try SetupShare.importBundle(exported)
        XCTAssertNil(bundle.settings.webDAV.first?.password)
        let (applied, _) = SetupShare.apply(bundle, to: local, credentials: Credentials())
        XCTAssertEqual(applied.webDAV.first?.password, "secret")
        XCTAssertEqual(applied.liveTV.providers.first?.password, "hunter2")

        // A different address doesn't inherit the password.
        var moved = bundle
        moved.settings.webDAV[0].baseURL = URL(string: "https://elsewhere.example/dav")!
        moved.settings.liveTV.providers[0].url = URL(string: "https://elsewhere.example")!
        let (other, _) = SetupShare.apply(moved, to: local, credentials: Credentials())
        XCTAssertNil(other.webDAV.first?.password)
        XCTAssertNil(other.liveTV.providers.first?.password)
    }

    // MARK: Seerr

    func testConnectingChecksTheKeyNotJustTheAddress() async throws {
        let mock = MockTransport()
        mock.routes["/api/v1/status"] = (200, #"{"version":"2.1.0"}"#)
        mock.routes["/api/v1/auth/me"] = (403, #"{"message":"nope"}"#)
        let client = SeerrClient(config: SeerrConfig(baseURL: URL(string: "https://seerr.example.com")!, apiKey: "BAD"), http: HTTPClient(transport: mock))
        _ = try await client.status()
        do {
            try await client.verifyKey()
            XCTFail("a rejected key must fail")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Seerr rejected that API key.")
        }
        mock.routes["/api/v1/auth/me"] = (200, #"{"id":1}"#)
        try await client.verifyKey()
        XCTAssertEqual(mock.requests.last?.value(forHTTPHeaderField: "X-Api-Key"), "BAD")
    }
}
