import XCTest
@testable import FlowKit

final class SourceQuickFilterTests: XCTestCase {
    private func source(_ id: String, _ resolution: VideoResolution, provider: String = "a", name: String = "A") -> StreamSource {
        var traits = StreamTraits()
        traits.resolution = resolution
        return StreamSource(id: id, category: .addons, providerID: provider, providerName: name, title: id,
                            location: .url(URL(string: "https://x.test/\(id).mkv")!, headers: [:]), traits: traits)
    }

    private var list: [StreamSource] {
        [source("1", .uhd4k), source("2", .hd1080), source("3", .hd1080, provider: "b", name: "B"), source("4", .unknown, provider: "b", name: "B"), source("5", .sd)]
    }

    func testResolutionChipsAreHighestFirstWithoutUnknown() {
        XCTAssertEqual(SourceQuickFilter.resolutions(in: list), [.uhd4k, .hd1080, .sd])
    }

    func testProviderChipsFollowTheListOrder() {
        XCTAssertEqual(SourceQuickFilter.providers(in: list).map(\.id), ["a", "b"])
        XCTAssertEqual(SourceQuickFilter.providers(in: list).map(\.name), ["A", "B"])
    }

    func testFiltersNarrowTheList() {
        XCTAssertEqual(SourceQuickFilter.all.apply(to: list).count, 5)
        XCTAssertEqual(SourceQuickFilter.resolution(.hd1080).apply(to: list).map(\.id), ["2", "3"])
        XCTAssertEqual(SourceQuickFilter.provider("b").apply(to: list).map(\.id), ["3", "4"])
    }

    func testChipsShowOnlyWhenThereIsAChoice() {
        XCTAssertTrue(SourceQuickFilter.hasChoices(in: list))
        XCTAssertFalse(SourceQuickFilter.hasChoices(in: [source("1", .hd1080), source("2", .hd1080)]))
        XCTAssertFalse(SourceQuickFilter.hasChoices(in: []))
    }

    func testHiddenCountIsWhatSettingsLeftOut() {
        XCTAssertEqual(SourceQuickFilter.hiddenCount(found: list, shown: Array(list.prefix(3))), 2)
        XCTAssertEqual(SourceQuickFilter.hiddenCount(found: [], shown: list), 0)
    }
}
