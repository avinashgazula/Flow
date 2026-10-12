import XCTest
@testable import FlowKit

final class RecentSearchesTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    func testTypingBuildsOneEntry() {
        var list = RecentSearches.adding("the dark", to: [], lastAdded: nil, now: t0)
        list = RecentSearches.adding("the dark knight", to: list, lastAdded: t0, now: t0.addingTimeInterval(1))
        XCTAssertEqual(list, ["the dark knight"])
        // Trimmed back while typing, too.
        list = RecentSearches.adding("the dark", to: list, lastAdded: t0.addingTimeInterval(1), now: t0.addingTimeInterval(2))
        XCTAssertEqual(list, ["the dark"])
    }

    func testSeparateSearchesStaySeparate() {
        let list = RecentSearches.adding("the office", to: ["the"], lastAdded: t0, now: t0.addingTimeInterval(3600))
        XCTAssertEqual(list, ["the office", "the"])
        XCTAssertEqual(RecentSearches.adding("dune", to: ["the"], lastAdded: nil, now: t0), ["dune", "the"])
    }

    func testRepeatsMoveToTheTopAndTheListIsCapped() {
        XCTAssertEqual(RecentSearches.adding("Dune", to: ["alien", "dune"], lastAdded: nil, now: t0), ["Dune", "alien"])
        let many = (0..<20).map { "term \($0)" }
        XCTAssertEqual(RecentSearches.adding("new", to: many, lastAdded: nil, now: t0).count, RecentSearches.limit)
        XCTAssertEqual(RecentSearches.adding("  ", to: ["a"], lastAdded: nil, now: t0), ["a"])
    }
}
