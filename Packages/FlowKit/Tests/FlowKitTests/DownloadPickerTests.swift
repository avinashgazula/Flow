import XCTest
@testable import FlowKit

final class DownloadPickerTests: XCTestCase {
    private func source(_ id: String, _ resolution: VideoResolution, gb: Double?, url: String = "https://x.test/file.mkv") -> StreamSource {
        var traits = StreamTraits()
        traits.resolution = resolution
        traits.sizeBytes = gb.map { Int64($0 * 1_073_741_824) }
        return StreamSource(id: id, category: .addons, providerID: "a", providerName: "A", title: id, location: .url(URL(string: url)!, headers: [:]), traits: traits)
    }

    func testNoLimitsTakesTheFirstDownloadableSource() {
        let list = [source("stream", .uhd4k, gb: nil, url: "https://x.test/master.m3u8"), source("file", .hd1080, gb: nil)]
        XCTAssertEqual(DownloadPicker.pick(from: list, isMovie: true, settings: DownloadSettings())?.id, "file")
    }

    func testSizeLimitSkipsLargeAndUnreportedSizes() {
        var settings = DownloadSettings()
        settings.movieLimitGB = 10
        let list = [source("big", .uhd4k, gb: 40), source("unknown", .hd1080, gb: nil), source("fits", .hd1080, gb: 8), source("smaller", .hd720, gb: 2)]
        XCTAssertEqual(DownloadPicker.pick(from: list, isMovie: true, settings: settings)?.id, "fits", "Keeps the user's order among sources that fit")
    }

    func testMoviesAndEpisodesHaveSeparateLimits() {
        var settings = DownloadSettings()
        settings.movieLimitGB = 40
        settings.episodeLimitGB = 2
        let list = [source("large", .hd1080, gb: 6), source("small", .hd720, gb: 1)]
        XCTAssertEqual(DownloadPicker.pick(from: list, isMovie: true, settings: settings)?.id, "large")
        XCTAssertEqual(DownloadPicker.pick(from: list, isMovie: false, settings: settings)?.id, "small")
    }

    func testResolutionCapSkipsHigherAndUnreportedResolutions() {
        var settings = DownloadSettings()
        settings.resolution = .hd1080
        let list = [source("4k", .uhd4k, gb: 5), source("unknown", .unknown, gb: 5), source("1080", .hd1080, gb: 5), source("720", .hd720, gb: 5)]
        XCTAssertEqual(DownloadPicker.pick(from: list, isMovie: true, settings: settings)?.id, "1080")
    }

    func testNothingFittingReturnsNil() {
        var settings = DownloadSettings()
        settings.movieLimitGB = 2
        XCTAssertNil(DownloadPicker.pick(from: [source("big", .hd1080, gb: 9)], isMovie: true, settings: settings))
        XCTAssertNil(DownloadPicker.pick(from: [], isMovie: true, settings: settings))
    }
}
