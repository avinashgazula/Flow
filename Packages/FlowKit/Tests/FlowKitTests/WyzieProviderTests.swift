import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Wyzie moved to sub.wyzie.io and answers 401 without a free key. The answer is the website's fixture
/// (web/src/lib/subtitles/__fixtures__/wyzie-search.json), so both code bases read it alike.
final class WyzieProviderTests: XCTestCase {
    static let answer = """
    [
      {"id":"1962054623","url":"https://sub.wyzie.io/c/6d1f0b4a/id/1962054623?format=srt&encoding=utf-8","format":"srt",
       "media":"Dune: Part Two (2024)","isHearingImpaired":false,"source":"opensubtitles","language":"en","display":"English",
       "release":"Dune.Part.Two.2024.1080p.WEB-DL","fileName":"Dune.Part.Two.2024.1080p.WEB-DL.en.srt","downloadCount":3100},
      {"id":"1962054700","url":"https://sub.wyzie.io/c/6d1f0b4a/id/1962054700?format=srt&encoding=utf-8","format":"srt",
       "media":"Dune: Part Two (2024)","isHearingImpaired":true,"language":"es","display":"Spanish","fileName":"Dune.Part.Two.2024.es.srt"},
      {"id":"x","language":"fr","display":"French"}
    ]
    """

    let film = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 693134, imdb: "tt15239678"), title: "Dune: Part Two"))
    let episode = PlaybackRequest(
        item: MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399, imdb: "tt0944947"), title: "Game of Thrones"),
        episode: Episode(showTMDB: 1399, season: 2, number: 3, title: "What Is Dead May Never Die"))

    func query(_ request: URLRequest?) -> [String: String] {
        let items = request?.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?.queryItems ?? []
        return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    }

    func testAsksSubWyzieIOWithTheKey() async throws {
        let mock = MockTransport()
        mock.routes["/search"] = (200, Self.answer)
        let provider = WyzieProvider(apiKey: " k ", http: HTTPClient(transport: mock))
        _ = try await provider.search(film, languages: ["en", "pt"])
        let sent = try XCTUnwrap(mock.requests.first)
        XCTAssertEqual(sent.url?.host, "sub.wyzie.io")
        XCTAssertEqual(sent.url?.path, "/search")
        XCTAssertEqual(query(sent), ["id": "693134", "language": "en,pt", "format": "srt", "key": "k"])
    }

    func testEpisodeSearchCarriesSeasonAndEpisode() async throws {
        let mock = MockTransport()
        mock.routes["/search"] = (200, Self.answer)
        _ = try await WyzieProvider(apiKey: "k", http: HTTPClient(transport: mock)).search(episode, languages: ["en"])
        XCTAssertEqual(query(mock.requests.first), ["id": "1399", "language": "en", "format": "srt", "season": "2", "episode": "3", "key": "k"])
    }

    func testReadsTheListAndSkipsAResultWithNoLink() async throws {
        let mock = MockTransport()
        mock.routes["/search"] = (200, Self.answer)
        let found = try await WyzieProvider(apiKey: "k", http: HTTPClient(transport: mock)).search(film, languages: ["en", "es"])
        XCTAssertEqual(found.count, 2)
        XCTAssertEqual(found[0], SubtitleTrackInfo(
            id: "wyzie-1962054623", provider: "Wyzie", language: "en", languageName: "English", release: "Dune.Part.Two.2024.1080p.WEB-DL",
            hearingImpaired: false, downloads: 3100, downloadToken: "https://sub.wyzie.io/c/6d1f0b4a/id/1962054623?format=srt&encoding=utf-8"))
        XCTAssertEqual(found[1].language, "es")
        XCTAssertTrue(found[1].hearingImpaired)
        XCTAssertEqual(found[1].release, "Dune: Part Two (2024)")
        XCTAssertTrue(WyzieProvider.parse(.object(["not": .string("a list")])).isEmpty)
    }

    func testWithoutAKeyItDoesNotAsk() async {
        let mock = MockTransport()
        mock.routes["/search"] = (200, Self.answer)
        do {
            _ = try await WyzieProvider(apiKey: "  ", http: HTTPClient(transport: mock)).search(film, languages: ["en"])
            XCTFail("Wyzie needs a key")
        } catch FlowError.missingCredential {
        } catch {
            XCTFail("Unexpected error \(error)")
        }
        XCTAssertTrue(mock.requests.isEmpty)
    }

    func testARefusedKeyTellsYouWhatToDo() async {
        let mock = MockTransport()
        mock.routes["/search"] = (401, #"{"code":401,"message":"API key required"}"#)
        do {
            _ = try await WyzieProvider(apiKey: "wrong", http: HTTPClient(transport: mock)).search(film, languages: ["en"])
            XCTFail("A 401 should throw")
        } catch FlowError.unsupported(let message) {
            XCTAssertTrue(message.contains("store.wyzie.io/redeem"))
        } catch {
            XCTFail("Unexpected error \(error)")
        }
    }

    func testTheKeyDecodesFromOldSavedCredentials() throws {
        let old = try JSONDecoder().decode(Credentials.self, from: Data(#"{"subdlAPIKey":"s"}"#.utf8))
        XCTAssertEqual(old.subdlAPIKey, "s")
        XCTAssertNil(old.wyzieAPIKey)
        var c = Credentials()
        c.wyzieAPIKey = "w"
        let back = try JSONDecoder().decode(Credentials.self, from: JSONEncoder().encode(c))
        XCTAssertEqual(back.wyzieAPIKey, "w")
    }
}
