import XCTest
@testable import FlowKit

final class DemoTests: XCTestCase {
    let http = HTTPClient(transport: DemoTransport(fallback: MockTransport()))

    func testCatalogueDetailsAndSeasons() async throws {
        let tmdb = TMDBClient(credential: "demo", http: http)
        let trending = try await tmdb.trending(.show)
        XCTAssertFalse(trending.items.isEmpty)
        XCTAssertTrue(trending.items.allSatisfy { $0.type == .show })

        let detail = try await tmdb.details(.show, id: 1396)
        XCTAssertEqual(detail.item.title, "Breaking Bad")
        XCTAssertEqual(detail.item.certification, "TV-MA")
        XCTAssertEqual(detail.seasons.count, 5)
        XCTAssertFalse(detail.castRow.isEmpty)
        XCTAssertNotNil(detail.lastEpisode)

        let episodes = try await tmdb.season(showID: 1396, season: 1)
        XCTAssertGreaterThanOrEqual(episodes.count, 8)

        let movie = try await tmdb.details(.movie, id: 693134)
        XCTAssertEqual(movie.item.runtimeMinutes, 167)
        XCTAssertNotNil(movie.item.homeReleaseDate)

        let results = try await tmdb.search("dune").results
        XCTAssertEqual(results.count, 2)
    }

    func testRatingsAndLiveTV() async throws {
        let ratings = try await MDBListClient(apiKey: "demo", http: http).ratings(.movie, tmdbID: 155)
        XCTAssertNotNil(ratings.rottenTomatoes)
        XCTAssertNotNil(ratings.letterboxd)

        let config = IPTVProviderConfig(name: "Demo", kind: .m3u, url: DemoTransport.iptvPlaylistURL)
        let provider = M3UProvider(config: config, http: http)
        let channels = try await provider.channels()
        XCTAssertEqual(channels.count, DemoTransport.channels.count)
        let epg = try await provider.epg(window: Date().addingTimeInterval(-7200)...Date().addingTimeInterval(86400))
        XCTAssertNotNil(epg.nowAndNext(for: channels[0].epgID).now)
    }

    func testDemoSources() async throws {
        let item = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 155, imdb: "tt0468569"), title: "The Dark Knight")
        let sources = try await DemoSourceProvider().sources(for: PlaybackRequest(item: item))
        XCTAssertEqual(sources.count, 4)
        XCTAssertTrue(sources.allSatisfy(\.isPlayable))
        XCTAssertEqual(sources[1].traits.resolution, .uhd4k)
    }
}
