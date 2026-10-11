import XCTest
@testable import FlowKit

final class ResponseCacheTests: XCTestCase {
    final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        func next() -> Int { lock.withLock { value += 1; return value } }
        var count: Int { lock.withLock { value } }
    }

    func makeCache() -> ResponseCache {
        ResponseCache(store: JSONFileStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("rc-\(UUID().uuidString)")))
    }

    /// Shelves asking for the same thing at once share one fetch.
    func testConcurrentRequestsShareOneFetch() async throws {
        let cache = makeCache()
        let calls = Counter()
        let results = try await withThrowingTaskGroup(of: Int.self) { group in
            for _ in 0..<8 {
                group.addTask {
                    try await cache.cached("k", maxAge: 60) {
                        try await Task.sleep(nanoseconds: 50_000_000)
                        return calls.next()
                    }
                }
            }
            return try await group.reduce(into: [Int]()) { $0.append($1) }
        }
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(Set(results), [1])
    }

    /// An expired copy beats an error.
    func testExpiredValueReturnedWhenRefreshFails() async throws {
        let cache = makeCache()
        await cache.set("old", for: "k")
        struct Offline: Error {}
        let value = try await cache.cached("k", maxAge: 0) { () -> String in throw Offline() }
        XCTAssertEqual(value, "old")
        do {
            _ = try await cache.cached("missing", maxAge: 0) { () -> String in throw Offline() }
            XCTFail("expected the error with nothing cached")
        } catch {}
    }
}
