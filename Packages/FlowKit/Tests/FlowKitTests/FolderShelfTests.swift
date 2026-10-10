import XCTest
@testable import FlowKit

final class FolderShelfTests: XCTestCase {
    private func provider(_ id: Int, _ name: String, logo: String? = "/logo.jpg") -> WatchProvider {
        WatchProvider(providerId: id, providerName: name, logoPath: logo, displayPriority: id)
    }

    func testResolveKeepsFeaturedOrderWithRegionLogosAndDropsMissingServices() {
        let available = [provider(15, "Hulu", logo: "/hulu.jpg"), provider(8, "Netflix", logo: "/nf.jpg"), provider(2, "Apple TV")]
        let services = StreamingServices.resolve(available: available)
        XCTAssertEqual(services.map(\.name), ["Netflix", "Hulu"])
        XCTAssertEqual(services.map(\.logoPath), ["/nf.jpg", "/hulu.jpg"])
    }

    func testResolveFollowsAnAliasAndKeepsTheFriendlyName() {
        let services = StreamingServices.resolve(available: [provider(119, "Amazon Prime Video")])
        XCTAssertEqual(services, [StreamingService(id: 119, name: "Prime Video", logoPath: "/logo.jpg")])
    }

    func testResolveFallsBackToNamesWhenTheRegionListIsEmpty() {
        let services = StreamingServices.resolve(available: [])
        XCTAssertEqual(services.count, 8)
        XCTAssertTrue(services.allSatisfy { $0.logoPath == nil })
        XCTAssertEqual(services.first?.id, 8)
    }

    func testQueriesTargetTheProviderAndGenre() {
        let query = StreamingService(id: 337, name: "Disney+").query(region: "GB", type: .show)
        XCTAssertEqual(query.watchProviders, [337])
        XCTAssertEqual(query.watchRegion, "GB")
        XCTAssertEqual(query.type, .show)
        XCTAssertEqual(GenreTile.featured[0].query.genres, [28])
        XCTAssertEqual(GenreTile.featured[0].query.type, .movie)
    }

    func testFolderShelvesAreBuiltInAndOnByDefault() {
        XCTAssertEqual(BuiltInShelf.streamingServices.title, "Streaming Services")
        XCTAssertEqual(BuiltInShelf.genres.title, "Genres")
        XCTAssertTrue(BuiltInShelf.genres.isFolder)
        XCTAssertFalse(BuiltInShelf.popularMovies.isFolder)
        let last = ShelfConfig.defaults.suffix(2)
        XCTAssertEqual(last.map(\.source), [.builtIn(.streamingServices), .builtIn(.genres)])
        XCTAssertTrue(last.allSatisfy(\.enabled))
    }

    func testDemoAnswersTheProviderListAndFiltersDiscoverByProviderAndGenre() async throws {
        let tmdb = TMDBClient(credential: "demo", http: HTTPClient(transport: DemoTransport(fallback: MockTransport())))
        let available = try await tmdb.watchProviders(.movie)
        let services = StreamingServices.resolve(available: available)
        XCTAssertEqual(services.map(\.name), StreamingServices.fallback.map(\.name))
        XCTAssertTrue(services.allSatisfy { $0.logoPath != nil })
        for service in services {
            let page = try await tmdb.discover(service.query(region: "US"))
            XCTAssertFalse(page.items.isEmpty, service.name)
        }
        // The small demo catalogue has no horror, documentary, fantasy or mystery films; the shelf skips those tiles.
        var covered: [String] = []
        for genre in GenreTile.featured {
            let page = try await tmdb.discover(genre.query)
            guard let first = page.items.first else { continue }
            XCTAssertNotNil(first.backdropPath, genre.name)
            covered.append(genre.name)
        }
        XCTAssertTrue(covered.count >= 6, "\(covered)")
    }
}
