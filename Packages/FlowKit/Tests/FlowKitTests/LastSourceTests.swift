import XCTest
@testable import FlowKit

final class LastSourceTests: XCTestCase {
    private func source(_ id: String, provider: String = "aio", file: String? = nil, binge: String? = nil, group: String? = nil,
                        resolution: VideoResolution = .hd1080, quality: ReleaseQuality = .webdl, hdr: [String] = [], playable: Bool = true) -> StreamSource {
        var traits = StreamTraits()
        traits.releaseGroup = group
        traits.resolution = resolution
        traits.quality = quality
        traits.hdr = hdr
        let location: StreamLocation = playable ? .url(URL(string: "https://debrid.test/\(id)")!, headers: [:]) : .external(URL(string: "magnet:?xt=\(id)")!)
        return StreamSource(id: id, category: .addons, providerID: provider, providerName: provider, title: id, filename: file,
                            location: location, traits: traits, bingeGroup: binge)
    }

    func testTheSameFileWinsEvenWhenItMovedDownTheList() {
        let last = LastSource(source("old", file: "Dune.2160p.DV.mkv", resolution: .uhd4k))
        let list = [source("a", file: "Dune.1080p.mkv"), source("b", file: "Dune.2160p.DV.mkv", resolution: .uhd4k)]
        XCTAssertEqual(last.match(in: list)?.id, "b")
    }

    func testTheNextEpisodeComesFromTheSameBingeGroup() {
        let last = LastSource(source("e1", file: "Show.S01E01.mkv", binge: "aio|2160p|DV"))
        let list = [source("x", file: "Show.S01E02.1080p.mkv", binge: "aio|1080p"), source("y", file: "Show.S01E02.2160p.mkv", binge: "aio|2160p|DV")]
        XCTAssertEqual(last.match(in: list)?.id, "y")
    }

    func testOrElseTheSameRelease() {
        let last = LastSource(source("e1", file: "Show.S01E01.mkv", group: "NTb", resolution: .uhd4k, hdr: ["DV"]))
        let list = [source("x", group: "NTb", resolution: .hd1080), source("y", group: "ntb", resolution: .uhd4k, hdr: ["DV"])]
        XCTAssertEqual(last.match(in: list)?.id, "y")
    }

    func testNothingCloseEnoughLeavesTheProvidersOrder() {
        let last = LastSource(source("old", file: "a.mkv", group: "NTb"))
        XCTAssertNil(last.match(in: [source("x", file: "b.mkv", group: "FLUX")]))
        // Another provider's copy of the same file isn't the same source.
        XCTAssertNil(last.match(in: [source("y", provider: "torrentio", file: "a.mkv")]))
    }

    func testOnlyPlayableSourcesAreOffered() {
        let last = LastSource(source("old", file: "a.mkv"))
        XCTAssertNil(last.match(in: [source("x", file: "a.mkv", playable: false)]))
    }

    func testPruningKeepsTheMostRecent() {
        var all: [String: LastSource] = [:]
        for i in 0..<5 { all["movie:\(i)"] = LastSource(source("s\(i)"), date: Date(timeIntervalSince1970: Double(i))) }
        XCTAssertEqual(Set(LastSource.pruned(all, limit: 2).keys), ["movie:4", "movie:3"])
    }

    func testSharedSetupsCarryNoViewingHistory() throws {
        var settings = AppSettings()
        settings.sources.lastSources = ["movie:603": LastSource(source("s", file: "Matrix.mkv"))]
        let data = try SetupShare.export(settings: settings, credentials: Credentials(), includeSecrets: true)
        let bundle = try SetupShare.importBundle(data)
        XCTAssertTrue(bundle.settings.sources.lastSources.isEmpty)
        // Importing keeps what this device remembers.
        var mine = AppSettings()
        mine.sources.lastSources = ["show:1399": LastSource(source("t"))]
        let (applied, _) = SetupShare.apply(bundle, to: mine, credentials: Credentials())
        XCTAssertEqual(Array(applied.sources.lastSources.keys), ["show:1399"])
    }

    func testOlderSettingsDecodeWithTheDefault() throws {
        let data = try SettingsCodec.encode(AppSettings())
        var object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        var sources = object["sources"] as! [String: Any]
        sources.removeValue(forKey: "rememberLastSource"); sources.removeValue(forKey: "lastSources")
        object["sources"] = sources
        let decoded = try SettingsCodec.decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: object), defaults: AppSettings())
        XCTAssertTrue(decoded.sources.rememberLastSource)
    }
}
