import XCTest
@testable import FlowKit

/// The catalogue the screens use: what it asks TMDb for, what it caches, and how it behaves when a source fails.
final class CatalogServiceTests: XCTestCase {
    private func makeCache() -> ResponseCache {
        ResponseCache(store: JSONFileStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("catalog-\(UUID().uuidString)")))
    }

    private func service(_ stub: StubTransport, region: String = "US", mdblist: MDBListClient? = nil, trakt: TraktClient? = nil, cache: ResponseCache? = nil) -> CatalogService {
        let tmdb = TMDBClient(credential: String(repeating: "a", count: 32), language: "en-US", region: region, http: HTTPClient(transport: stub))
        return CatalogService(tmdb: tmdb, cache: cache ?? makeCache(), mdblist: mdblist, trakt: trakt)
    }

    private let page = #"{"page":1,"total_pages":5,"results":[{"id":603,"title":"The Matrix","release_date":"1999-03-31"}]}"#

    func testShelvesAreCachedPerRegionAndKind() async throws {
        let stub = StubTransport().on("GET", "/trending/movie/week", json: page).on("GET", "/movie/popular", json: page)
        let cache = makeCache()
        let us = service(stub, cache: cache)
        let first = try await us.trending(.movie)
        _ = try await us.trending(.movie)
        XCTAssertEqual(first.items.map(\.title), ["The Matrix"])
        XCTAssertEqual(first.totalPages, 5)
        XCTAssertEqual(stub.requests("GET", path: "/trending/movie/week").count, 1, "the second ask is answered from the cache")
        _ = try await us.list(.popular, type: .movie)
        XCTAssertEqual(stub.requests("GET", path: "/movie/popular").count, 1)
        _ = try await us.trending(.movie, page: 2)
        XCTAssertEqual(stub.requests("GET", path: "/trending/movie/week").count, 2, "another page is another request")
        // A different region changes certifications and regional lists, so it must not read the US copy.
        _ = try await service(stub, region: "GB", cache: cache).trending(.movie)
        XCTAssertEqual(stub.requests("GET", path: "/trending/movie/week").count, 3)
    }

    func testDiscoverCachesPerQuery() async throws {
        let stub = StubTransport().on("GET", "/discover/movie", json: page)
        let catalog = service(stub)
        var a = DiscoverQuery()
        a.type = .movie
        var b = a
        b.sort = .rating
        _ = try await catalog.discover(a)
        _ = try await catalog.discover(a)
        _ = try await catalog.discover(b)
        XCTAssertEqual(stub.requests("GET", path: "/discover/movie").count, 2)
    }

    func testItemsHydrateInOrderAndSkipFailures() async throws {
        let stub = StubTransport()
        stub.on("GET", "/movie/1", json: #"{"id":1,"title":"One"}"#)
        stub.on("GET", "/tv/2", json: #"{"id":2,"name":"Two"}"#)
        stub.on("GET", "/movie/3", status: 500, json: "")
        stub.on("GET", "/movie/4", json: #"{"id":4,"title":"Four"}"#)
        let catalog = service(stub)
        let keys = [MediaKey(type: .movie, tmdbID: 4), MediaKey(type: .movie, tmdbID: 3), MediaKey(type: .show, tmdbID: 2), MediaKey(type: .movie, tmdbID: 1)]
        let items = await catalog.items(keys)
        XCTAssertEqual(items.map(\.title), ["Four", "Two", "One"], "order follows the keys; the failed one is skipped")
        let limited = await catalog.items(keys, limit: 1)
        XCTAssertEqual(limited.map(\.title), ["Four"])
    }

    func testUnavailableSourcesLeaveTheOthersStanding() async {
        let stub = StubTransport()
        stub.on("GET", "/movie/603/reviews", json: #"{"results":[{"id":"r1","author":"ann","content":"Great &amp; fun.","created_at":"2026-01-01T00:00:00.000Z","author_details":{"rating":9}}]}"#)
        let trakt = TraktClient(clientID: "CID", token: nil, http: HTTPClient(transport: StubTransport().on("GET", "/movies/tt0133093/comments/likes", status: 500, json: "")))
        let catalog = service(stub, trakt: trakt)
        let item = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093"), title: "The Matrix")
        let reviews = await catalog.reviews(for: item)
        XCTAssertEqual(reviews.map(\.author), ["ann"], "Trakt failing doesn't lose TMDb's reviews")
        XCTAssertFalse(reviews[0].text.contains("&amp;"), "text is cleaned on the way out")
    }

    func testRatingsFillInFromMDBListTMDbAndTrakt() async throws {
        let mdb = StubTransport().on("GET", "/tmdb/movie/603", json: #"{"ratings":[{"source":"imdb","value":8.7},{"source":"tomatoes","score":83}]}"#)
        let tr = StubTransport().on("GET", "/movies/tt0133093/ratings", json: #"{"rating":8.2}"#)
        let trakt = TraktClient(clientID: "CID", token: nil, http: HTTPClient(transport: tr))
        let catalog = service(StubTransport(), mdblist: MDBListClient(apiKey: "K", http: HTTPClient(transport: mdb)), trakt: trakt)
        var item = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093"), title: "The Matrix")
        item.voteAverage = 8.1
        let ratings = await catalog.ratings(for: item)
        XCTAssertEqual(ratings.imdb, 8.7)
        XCTAssertEqual(ratings.rottenTomatoes, 83)
        XCTAssertEqual(ratings.tmdb, 8.1, "TMDb's own score is kept when MDBList has none")
        XCTAssertEqual(ratings.trakt, 82)
        _ = await catalog.ratings(for: item)
        XCTAssertEqual(mdb.requests.count, 1, "MDBList is asked once a day, not on every screen")

        let bare = await service(StubTransport()).ratings(for: MediaItem(type: .movie, ids: ExternalIDs(), title: "x", voteAverage: 7))
        XCTAssertEqual(bare.tmdb, 7)
    }

    func testLogoUsesTheItemsOwnThenFetchesAndCaches() async {
        let stub = StubTransport().on("GET", "/movie/603/images", json: #"{"logos":[{"file_path":"/l.png","iso_639_1":"en","width":100,"height":50,"vote_average":1}]}"#)
        let catalog = service(stub)
        var item = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603), title: "x")
        let fetched = await catalog.logo(for: item)
        XCTAssertEqual(fetched, "/l.png")
        _ = await catalog.logo(for: item)
        XCTAssertEqual(stub.requests.count, 1)
        item.logoPath = "/own.png"
        let own = await catalog.logo(for: item)
        XCTAssertEqual(own, "/own.png")
        let none = await catalog.logo(for: MediaItem(type: .movie, ids: ExternalIDs(), title: "x"))
        XCTAssertNil(none)
        let empty = StubTransport().on("GET", "/movie/9/images", json: #"{"logos":[]}"#)
        let missing = await service(empty).logo(for: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 9), title: "x"))
        XCTAssertNil(missing, "a title with no logo is none, not an empty string")
    }

    func testDetailsPersonCollectionAndCreditsAreCached() async throws {
        let stub = StubTransport()
        stub.on("GET", "/movie/603", json: #"{"id":603,"title":"The Matrix","release_date":"1999-03-31"}"#)
        stub.on("GET", "/person/6384", json: #"{"id":6384,"name":"Keanu Reeves"}"#)
        stub.on("GET", "/collection/10", json: #"{"id":10,"name":"C","parts":[]}"#)
        stub.on("GET", "/tv/1/season/1/episode/2/credits", json: #"{"cast":[{"id":5,"name":"A","order":0}]}"#)
        stub.on("GET", "/movie/603/release_dates", json: #"{"results":[]}"#)
        let catalog = service(stub)
        for _ in 0..<2 {
            let detail = try await catalog.details(.movie, id: 603)
            XCTAssertEqual(detail.item.title, "The Matrix")
            let person = try await catalog.person(6384)
            XCTAssertEqual(person.name, "Keanu Reeves")
            let collection = try await catalog.collection(10)
            XCTAssertEqual(collection.name, "C")
            let cast = try await catalog.episodeCredits(showID: 1, season: 1, episode: 2)
            XCTAssertEqual(cast.map(\.name), ["A"])
            _ = await catalog.releaseDates(movieID: 603)
        }
        XCTAssertEqual(stub.requests.count, 5, "each thing was fetched once")
        await catalog.clearCache()
        _ = try await catalog.person(6384)
        XCTAssertEqual(stub.requests.count, 6, "clearing the cache forces a fresh fetch")
    }

    func testSearchPassesTheTextThrough() async throws {
        let stub = StubTransport().on("GET", "/search/multi", json: #"{"results":[{"id":1,"media_type":"movie","title":"A"}],"total_pages":1}"#)
        let results = try await service(stub).search("a")
        XCTAssertEqual(results.count, 1)
    }

    func testFiltersKeepOnlyServerContentAndDropUnreleasedTitles() async {
        let index = MediaServerIndex()
        await index.replace(with: [MediaServerItem(serverID: "s", itemID: "1", type: .movie, title: "Mine", ids: ExternalIDs(tmdb: 1))])
        let catalog = service(StubTransport())
        let now = Date()
        let old = Calendar.current.date(byAdding: .year, value: -3, to: now)!
        let future = Calendar.current.date(byAdding: .year, value: 2, to: now)!
        let mine = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1), title: "Mine", releaseDate: old)
        let other = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 2), title: "Other", releaseDate: old)
        let unreleased = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 3), title: "Soon", releaseDate: future)
        let onlyMine = await catalog.apply(.init(showUnreleased: true, onlyServerContent: true, serverIndex: index), to: [mine, other, unreleased], exemptFromRelease: false)
        XCTAssertEqual(onlyMine.map(\.title), ["Mine"])
        let hidden = await catalog.apply(.init(showUnreleased: false, onlyServerContent: false, serverIndex: nil), to: [mine, other, unreleased], exemptFromRelease: false)
        XCTAssertEqual(hidden.map(\.title), ["Mine", "Other"], "the unreleased title is hidden")
        let exempt = await catalog.apply(.init(showUnreleased: false, onlyServerContent: false, serverIndex: nil), to: [mine, unreleased], exemptFromRelease: true)
        XCTAssertEqual(exempt.count, 2, "lists of the viewer's own picks aren't filtered")
        let shown = await catalog.apply(.init(showUnreleased: true, onlyServerContent: false, serverIndex: nil), to: [unreleased], exemptFromRelease: false)
        XCTAssertEqual(shown.count, 1)
    }
}
