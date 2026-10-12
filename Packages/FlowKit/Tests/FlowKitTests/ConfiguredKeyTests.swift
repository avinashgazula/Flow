import XCTest
@testable import FlowKit

final class ConfiguredKeyTests: XCTestCase {
    func testPlaceholdersAreNotKeys() {
        XCTAssertNil(ConfiguredKey.usable(nil))
        XCTAssertNil(ConfiguredKey.usable("  "))
        XCTAssertNil(ConfiguredKey.usable("$(FLOW_TRAKT_CLIENT_ID)"))
        XCTAssertNil(ConfiguredKey.usable("your-trakt-client-id"))
        XCTAssertNil(ConfiguredKey.usable("YOUR_TMDB_KEY"))
    }

    func testRealKeysPassThroughTrimmed() {
        XCTAssertEqual(ConfiguredKey.usable(" 0123abcd "), "0123abcd")
    }
}
