import XCTest
@testable import FlowKit

final class RatingsDisplayTests: XCTestCase {
    private let film = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093"), title: "The Matrix")
    private let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1396, imdb: "tt0903747"), title: "Breaking Bad")

    func testReviewLinksPointAtEachSite() {
        func link(_ source: RatingSource, _ item: MediaItem) -> String? { RatingLinks.url(for: source, item: item)?.absoluteString }
        XCTAssertEqual(link(.imdb, film), "https://www.imdb.com/title/tt0133093/reviews")
        XCTAssertEqual(link(.tomatometer, film), "https://www.rottentomatoes.com/search?search=The%20Matrix")
        XCTAssertEqual(link(.popcornmeter, film), link(.tomatometer, film))
        XCTAssertEqual(link(.metacritic, film), "https://www.metacritic.com/search/The%20Matrix/")
        XCTAssertEqual(link(.tmdb, film), "https://www.themoviedb.org/movie/603/reviews")
        XCTAssertEqual(link(.tmdb, show), "https://www.themoviedb.org/tv/1396/reviews")
        XCTAssertEqual(link(.letterboxd, film), "https://letterboxd.com/imdb/tt0133093/")
        XCTAssertEqual(link(.trakt, show), "https://trakt.tv/search/imdb/tt0903747")
    }

    func testLinksNeedTheIDsTheyAreBuiltFrom() {
        let bare = MediaItem(type: .show, ids: ExternalIDs(), title: "Untitled")
        XCTAssertNil(RatingLinks.url(for: .imdb, item: bare))
        XCTAssertNil(RatingLinks.url(for: .trakt, item: bare))
        XCTAssertNil(RatingLinks.url(for: .tmdb, item: bare))
        XCTAssertNil(RatingLinks.url(for: .letterboxd, item: show), "Letterboxd has no shows")
        XCTAssertNotNil(RatingLinks.url(for: .metacritic, item: bare), "Search needs only the title")
    }

    func testSearchTitlesAreEscaped() {
        let item = MediaItem(type: .movie, ids: ExternalIDs(), title: "Fast & Furious: 100% #1")
        XCTAssertEqual(RatingLinks.url(for: .tomatometer, item: item)?.absoluteString,
                       "https://www.rottentomatoes.com/search?search=Fast%20%26%20Furious%3A%20100%25%20%231")
    }

    func testIconPackKeepsKnownNamesAndSkipsTheRest() throws {
        let json = """
        [{"name": "imdb", "url": "https://example.com/imdb.png"},
         {"name": "Tomatometer", "url": "https://example.com/rt.png"},
         {"name": "unknown", "url": "https://example.com/x.png"},
         {"name": "trakt", "url": "javascript:alert(1)"},
         {"name": "mal", "url": ""}]
        """
        let pack = try RatingIconPack.decode(Data(json.utf8))
        XCTAssertEqual(pack[.imdb]?.absoluteString, "https://example.com/imdb.png")
        XCTAssertEqual(pack[.tomatometer]?.absoluteString, "https://example.com/rt.png", "Names match regardless of case")
        XCTAssertNil(pack[.trakt])
        XCTAssertNil(pack[.mal])
        XCTAssertEqual(pack.icons.count, 2)
    }

    func testIconPackRejectsNonArrays() {
        XCTAssertThrowsError(try RatingIconPack.decode(Data(#"{"imdb": "https://example.com/a.png"}"#.utf8)))
    }

    func testPosterURLPrefersIMDbThenTMDbAndNeedsAKey() {
        XCTAssertEqual(RatingPosterDB.posterURL(apiKey: "abc123", item: film)?.absoluteString,
                       "https://api.ratingposterdb.com/abc123/imdb/poster-default/tt0133093.jpg?fallback=true")
        let listed = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1396), title: "Breaking Bad")
        XCTAssertEqual(RatingPosterDB.posterURL(apiKey: "abc123", item: listed)?.absoluteString,
                       "https://api.ratingposterdb.com/abc123/tmdb/poster-default/series-1396.jpg?fallback=true")
        XCTAssertNil(RatingPosterDB.posterURL(apiKey: nil, item: film))
        XCTAssertNil(RatingPosterDB.posterURL(apiKey: "  ", item: film))
        XCTAssertNil(RatingPosterDB.posterURL(apiKey: "abc123", item: MediaItem(type: .movie, ids: ExternalIDs(), title: "Nothing")))
    }

    func testPrefetchedSourcesExpireAndAreKeyedByRequest() {
        let request = PlaybackRequest(item: film)
        let other = PlaybackRequest(item: show, episode: Episode(showTMDB: 1396, season: 1, number: 1, title: "Pilot"))
        let source = StreamSource(id: "s", category: .addons, providerID: "a", providerName: "A", title: "s", location: .url(URL(string: "https://x.test/f.mkv")!, headers: [:]), traits: StreamTraits())
        let start = Date(timeIntervalSince1970: 1_000_000)
        var cache = SourcePrefetchCache(lifetime: 300)
        cache.store([source], for: request, now: start)
        XCTAssertEqual(cache.sources(for: request, now: start.addingTimeInterval(299))?.map(\.id), ["s"])
        XCTAssertNil(cache.sources(for: request, now: start.addingTimeInterval(301)))
        XCTAssertNil(cache.sources(for: other, now: start))
    }
}
