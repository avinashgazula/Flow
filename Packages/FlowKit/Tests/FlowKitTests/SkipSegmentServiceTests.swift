import XCTest
@testable import FlowKit

/// IntroDB and PublicMetaDB as they really answer (checked live, October 2026). The answers are the
/// website's test fixtures (web/src/features/player/segments.test.ts), so both code bases read them alike.
final class SkipSegmentServiceTests: XCTestCase {
    static let introDBAnswer = """
    {"imdb_id":"tt0944947","media_type":"tv","is_movie":false,"season":1,"episode":1,
     "intro":{"start_sec":437,"end_sec":531,"start_ms":437000,"end_ms":531000,"confidence":1},
     "recap":null,
     "outro":{"start_sec":3631.5,"end_sec":3699.5,"start_ms":3631500,"end_ms":3699500},
     "post_credits":null,"no_intro":false}
    """

    static let publicMetaDBAnswer = """
    {"items":[
      {"source":"physical","intro_start_ms":1000,"intro_end_ms":61000,"credits_start_ms":3000000,"credits_end_ms":3100000,"recap_start_ms":null,"recap_end_ms":null},
      {"source":"streaming","intro_start_ms":0,"intro_end_ms":62000,"credits_start_ms":null,"credits_end_ms":null,"preview_start_ms":3100000,"preview_end_ms":3120000}
     ],"total":2}
    """

    func json(_ text: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    let film = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 693134, imdb: "tt15239678"), title: "Dune: Part Two"))
    let episode = PlaybackRequest(
        item: MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399, imdb: "tt0944947"), title: "Game of Thrones"),
        episode: Episode(showTMDB: 1399, season: 1, number: 1, title: "Winter Is Coming"))

    // MARK: Parsing

    func testIntroDBAnswer() throws {
        XCTAssertEqual(KeyedSegmentsClient.parse(try json(Self.introDBAnswer)), [
            SkipSegment(kind: .intro, start: 437, end: 531),
            SkipSegment(kind: .credits, start: 3631.5, end: 3699.5),
        ])
    }

    func testIntroDBPostCreditsIsNotSkippable() throws {
        let answer = try json(#"{"outro":{"start_sec":3600,"end_sec":3650},"post_credits":{"start_sec":3660,"end_sec":3700}}"#)
        XCTAssertEqual(KeyedSegmentsClient.parse(answer), [SkipSegment(kind: .credits, start: 3600, end: 3650)])
    }

    func testIntroDBRecapAndNullsAndBackwardsRanges() throws {
        let answer = try json(#"{"intro":null,"recap":{"start_sec":2,"end_sec":40},"outro":{"start_sec":900,"end_sec":800}}"#)
        XCTAssertEqual(KeyedSegmentsClient.parse(answer), [SkipSegment(kind: .recap, start: 2, end: 40)])
    }

    func testPublicMetaDBFlatRecordsStreamingCutFirst() throws {
        XCTAssertEqual(KeyedSegmentsClient.parse(try json(Self.publicMetaDBAnswer)), [
            SkipSegment(kind: .intro, start: 0, end: 62),
            SkipSegment(kind: .credits, start: 3000, end: 3100),
            SkipSegment(kind: .preview, start: 3100, end: 3120),
        ])
    }

    func testOlderShapesStillParse() throws {
        XCTAssertEqual(KeyedSegmentsClient.parse(try json(#"[{"type":"Opening","start":10,"end":70},{"kind":"ending","startMs":2400000,"endMs":2500000}]"#)), [
            SkipSegment(kind: .intro, start: 10, end: 70),
            SkipSegment(kind: .credits, start: 2400, end: 2500),
        ])
        XCTAssertEqual(KeyedSegmentsClient.parse(try json(#"{"data":{"intro":{"start":10,"end":70},"recap":{"start":5,"end":3}}}"#)), [
            SkipSegment(kind: .intro, start: 10, end: 70),
        ])
    }

    func testAnswersThatAreNotSegmentsGiveNothing() throws {
        for text in ["null", "\"no\"", "3", "{}", "[]", #"{"error":"Invalid query params."}"#, #"{"message":"File not found.","status":404,"data":{}}"#] {
            XCTAssertEqual(KeyedSegmentsClient.parse(try json(text)), [], text)
        }
    }

    // MARK: Requests

    private func items(_ request: HTTPRequest) -> [String: String] {
        Dictionary(request.query.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    }

    func testIntroDBRequestForAnEpisode() throws {
        let client = KeyedSegmentsClient.introDB(baseURL: "https://api.introdb.app/", apiKey: "")
        let request = try XCTUnwrap(client.lookup(for: episode))
        XCTAssertEqual(request.url.absoluteString, "https://api.introdb.app/segments")
        XCTAssertEqual(items(request), ["imdb_id": "tt0944947", "season": "1", "episode": "1"])
        XCTAssertNil(request.headers["X-API-Key"], "reading needs no key")
    }

    func testIntroDBRequestForAFilmSendsTheKeyWhenThereIsOne() throws {
        let client = KeyedSegmentsClient.introDB(baseURL: "https://api.introdb.app", apiKey: "k")
        let request = try XCTUnwrap(client.lookup(for: film))
        XCTAssertEqual(items(request), ["imdb_id": "tt15239678", "is_movie": "true"])
        XCTAssertEqual(request.headers["X-API-Key"], "k")
    }

    func testIntroDBNeedsAnIMDbIdAndAnEpisodeNumber() throws {
        let client = KeyedSegmentsClient.introDB(baseURL: "https://api.introdb.app")
        let noIMDb = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1), title: "x"))
        XCTAssertNil(try client.lookup(for: noIMDb))
        XCTAssertNil(try client.lookup(for: PlaybackRequest(item: episode.item)))
    }

    func testPublicMetaDBRequests() throws {
        let client = KeyedSegmentsClient.publicMetaDB(baseURL: "https://publicmetadb.com", apiKey: "secret")
        let show = try XCTUnwrap(client.lookup(for: episode))
        XCTAssertEqual(show.url.absoluteString, "https://publicmetadb.com/api/external/skips")
        XCTAssertEqual(items(show), ["tmdb_id": "1399", "media_type": "tv", "season": "1", "episode": "1"])
        XCTAssertEqual(show.headers["Authorization"], "Bearer secret")
        let movie = try XCTUnwrap(client.lookup(for: film))
        XCTAssertEqual(items(movie), ["tmdb_id": "693134", "media_type": "movie"])
    }

    func testIntroDBEndToEndWithoutAKey() async throws {
        let mock = MockTransport()
        mock.routes["/segments"] = (200, Self.introDBAnswer)
        let client = KeyedSegmentsClient.introDB(baseURL: "https://api.introdb.app", http: HTTPClient(transport: mock))
        let segments = try await client.segments(for: episode)
        XCTAssertEqual(segments.map(\.kind), [.intro, .credits])
        XCTAssertEqual(mock.requests.first?.url?.path, "/segments")
    }

    func testPublicMetaDBEndToEndAndItsKeyIsRequired() async throws {
        let mock = MockTransport()
        mock.routes["/api/external/skips"] = (200, Self.publicMetaDBAnswer)
        let client = KeyedSegmentsClient.publicMetaDB(baseURL: "https://publicmetadb.com", apiKey: "k", http: HTTPClient(transport: mock))
        let segments = try await client.segments(for: episode)
        XCTAssertEqual(segments.map(\.kind), [.intro, .credits, .preview])
        XCTAssertEqual(mock.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer k")

        let keyless = KeyedSegmentsClient.publicMetaDB(baseURL: "https://publicmetadb.com", apiKey: "", http: HTTPClient(transport: mock))
        do {
            _ = try await keyless.segments(for: episode)
            XCTFail("PublicMetaDB needs a key")
        } catch {}
    }

    // MARK: Base URLs

    func testNewDefaultBaseURLs() {
        let account = AccountSettings()
        XCTAssertEqual(account.introDBBaseURL, "https://api.introdb.app")
        XCTAssertEqual(account.publicMetaDBBaseURL, "https://publicmetadb.com")
    }

    func testSavedOldDefaultsMigrateThroughTheCodec() throws {
        let saved = #"{"account":{"publicMetaDBBaseURL":"https://api.publicmetadb.com/v1","introDBBaseURL":"https://api.introdb.app/v1/","scrobble":false}}"#
        let decoded = try SettingsCodec.decode(AppSettings.self, from: Data(saved.utf8), defaults: AppSettings()).migrated()
        XCTAssertEqual(decoded.account.publicMetaDBBaseURL, "https://publicmetadb.com")
        XCTAssertEqual(decoded.account.introDBBaseURL, "https://api.introdb.app")
        XCTAssertFalse(decoded.account.scrobble)
    }

    func testACustomBaseURLIsLeftAlone() throws {
        var settings = AppSettings()
        settings.account.introDBBaseURL = "https://introdb.example.net/v1"
        settings.account.publicMetaDBBaseURL = "https://pmdb.example.net"
        XCTAssertEqual(settings.migrated(), settings)
    }

    func testSettingsSavedBeforeTheseFieldsExistedGetTheNewDefaults() throws {
        let decoded = try SettingsCodec.decode(AppSettings.self, from: Data(#"{"account":{}}"#.utf8), defaults: AppSettings()).migrated()
        XCTAssertEqual(decoded.account.introDBBaseURL, "https://api.introdb.app")
    }
}
