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
        let availability = try XCTUnwrap(movie.availability)
        XCTAssertEqual(availability.stream.count, 1)
        XCTAssertEqual(availability.offers.first?.kind, .stream)
        XCTAssertEqual(availability.offers.count, 3, "Apple TV and Google Play appear once each, though they both rent and sell")
        XCTAssertNotNil(movie.item.homeReleaseDate)

        let results = try await tmdb.search("dune").results
        XCTAssertEqual(results.count, 2)
    }

    func testAiringShowsHaveACalendar() async throws {
        let tmdb = TMDBClient(credential: "demo", http: http)
        let detail = try await tmdb.details(.show, id: 100088)
        let next = try XCTUnwrap(detail.nextEpisode)
        let last = try XCTUnwrap(detail.lastEpisode)
        XCTAssertGreaterThan(try XCTUnwrap(next.airDate), Date())
        XCTAssertLessThan(try XCTUnwrap(last.airDate), Date())
        XCTAssertEqual(last.number + 1, next.number)

        // The airing season agrees with next/last: weekly episodes either side of today.
        let season = try await tmdb.season(showID: 100088, season: next.season)
        let upcoming = season.filter { ($0.airDate ?? .distantPast) > Date() }
        XCTAssertEqual(upcoming.first?.number, next.number)
        XCTAssertTrue(season.first { $0.number == 3 }.map { ($0.airDate ?? .distantFuture) < Date() } ?? false, "S2E3 is in Continue Watching, so it must have aired")
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
