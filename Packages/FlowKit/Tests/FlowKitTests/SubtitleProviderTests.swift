import XCTest
@testable import FlowKit

/// OpenSubtitles, SubDL, SubSource and the merged search, through a scripted transport.
final class SubtitleProviderTests: XCTestCase {
    private let movie = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093"), title: "The Matrix"))
    private let episode = PlaybackRequest(item: MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399, imdb: "tt0944947"), title: "GoT"),
                                          episode: Episode(showTMDB: 1399, season: 2, number: 3, title: "x"))
    private let srt = "1\n00:00:01,000 --> 00:00:02,000\nHello\n"

    // MARK: OpenSubtitles

    func testOpenSubtitlesSearchesByTMDbIDAndDecodesResults() async throws {
        let stub = StubTransport().on("GET", "/subtitles", json: """
        {"data":[{"attributes":{"language":"en","release":"The.Matrix.1999.BluRay","hearing_impaired":true,"download_count":900,"files":[{"file_id":111}]}},
                 {"attributes":{"language":"fr","files":[{"file_id":222}]}},
                 {"attributes":{"language":"de","files":[]}}]}
        """)
        let provider = OpenSubtitlesProvider(apiKey: "KEY", http: HTTPClient(transport: stub))
        let found = try await provider.search(movie, languages: ["EN", "fr"])
        XCTAssertEqual(found.map(\.id), ["os-111", "os-222"], "an entry without a file is dropped")
        XCTAssertEqual(found[0].release, "The.Matrix.1999.BluRay")
        XCTAssertTrue(found[0].hearingImpaired)
        XCTAssertEqual(found[0].downloads, 900)
        XCTAssertEqual(found[0].languageName, "English")
        XCTAssertEqual(found[1].downloadToken, "222")
        let r = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(r.value(forHTTPHeaderField: "Api-Key"), "KEY")
        XCTAssertNil(r.value(forHTTPHeaderField: "Authorization"), "no login without a username")
        let q = StubTransport.query(r)
        XCTAssertEqual(q["tmdb_id"], "603")
        XCTAssertEqual(q["type"], "movie")
        XCTAssertEqual(q["languages"], "en,fr")
    }

    func testOpenSubtitlesEpisodesUseTheParentIDAndSeasonNumbers() async throws {
        let stub = StubTransport().on("GET", "/subtitles", json: #"{"data":[]}"#)
        _ = try await OpenSubtitlesProvider(apiKey: "KEY", http: HTTPClient(transport: stub)).search(episode, languages: ["en"])
        let q = StubTransport.query(stub.requests[0])
        XCTAssertEqual(q["parent_tmdb_id"], "1399")
        XCTAssertEqual(q["season_number"], "2")
        XCTAssertEqual(q["episode_number"], "3")
        XCTAssertEqual(q["type"], "episode")
        XCTAssertNil(q["tmdb_id"])
    }

    func testOpenSubtitlesLogsInOnceAndSendsTheBearerToken() async throws {
        let stub = StubTransport()
        stub.on("POST", "/login", json: #"{"token":"SESSION"}"#)
        stub.on("GET", "/subtitles", json: #"{"data":[]}"#)
        let provider = OpenSubtitlesProvider(apiKey: "KEY", username: "alex", password: "pw", http: HTTPClient(transport: stub))
        _ = try await provider.search(movie, languages: ["en"])
        _ = try await provider.search(movie, languages: ["en"])
        XCTAssertEqual(stub.requests("POST", path: "/login").count, 1)
        XCTAssertEqual(StubTransport.body(stub.requests[0])["username"] as? String, "alex")
        XCTAssertEqual(stub.requests("GET", path: "/subtitles").map { $0.value(forHTTPHeaderField: "Authorization") }, ["Bearer SESSION", "Bearer SESSION"])
    }

    func testOpenSubtitlesCarriesOnWhenLoginFails() async throws {
        let stub = StubTransport().on("POST", "/login", status: 401, json: "").on("GET", "/subtitles", json: #"{"data":[]}"#)
        let provider = OpenSubtitlesProvider(apiKey: "KEY", username: "alex", password: "bad", http: HTTPClient(transport: stub))
        let found = try await provider.search(movie, languages: ["en"])
        XCTAssertTrue(found.isEmpty)
        XCTAssertNil(stub.requests("GET", path: "/subtitles").first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testOpenSubtitlesDownloadFollowsTheLinkAndUnzips() async throws {
        let stub = StubTransport()
        stub.on("POST", "/download", json: #"{"link":"https://dl.example.com/file.zip"}"#)
        stub.on("GET", "/file.zip") { _ in (200, Data(base64Encoded: Fixtures.subtitleZip)!, [:]) }
        let provider = OpenSubtitlesProvider(apiKey: "KEY", http: HTTPClient(transport: stub))
        let track = SubtitleTrackInfo(id: "os-111", provider: "OpenSubtitles", language: "en", languageName: "English", release: "", downloadToken: "111")
        let document = try await provider.download(track)
        XCTAssertEqual(StubTransport.body(stub.requests[0])["file_id"] as? Int, 111)
        XCTAssertEqual(document.cues.first?.text, "Hello there", "the .srt inside the archive is chosen over readme.txt")

        let noLink = StubTransport().on("POST", "/download", json: "{}")
        do { _ = try await OpenSubtitlesProvider(apiKey: "KEY", http: HTTPClient(transport: noLink)).download(track); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .decoding("OpenSubtitles download link"))
        }
    }

    func testBlankKeysAreRefusedBeforeAnyRequest() async {
        let stub = StubTransport()
        let http = HTTPClient(transport: stub)
        for provider in [OpenSubtitlesProvider(apiKey: "", http: http), SubDLProvider(apiKey: "", http: http), SubSourceProvider(apiKey: "", http: http)] as [SubtitleProvider] {
            do { _ = try await provider.search(movie, languages: ["en"]); XCTFail("\(provider.name) should refuse") } catch {
                XCTAssertEqual(error as? FlowError, .missingCredential("\(provider.name) API key"))
            }
        }
        XCTAssertTrue(stub.requests.isEmpty)
    }

    // MARK: SubDL

    func testSubDLSearchAndDownload() async throws {
        let stub = StubTransport()
        stub.on("GET", "/api/v1/subtitles", json: #"{"subtitles":[{"url":"/subtitle/1-2.zip","lang":"EN","language":"English","release_name":"Matrix.1080p","hi":true},{"name":"no url"}]}"#)
        stub.on("GET", "/subtitle/1-2.zip") { _ in (200, Data(base64Encoded: Fixtures.subtitleZip)!, [:]) }
        let provider = SubDLProvider(apiKey: "K", http: HTTPClient(transport: stub))
        let found = try await provider.search(episode, languages: ["en", "es"])
        XCTAssertEqual(found.count, 1)
        XCTAssertEqual(found[0].language, "en")
        XCTAssertEqual(found[0].languageName, "English")
        XCTAssertEqual(found[0].release, "Matrix.1080p")
        XCTAssertTrue(found[0].hearingImpaired)
        let q = StubTransport.query(stub.requests[0])
        XCTAssertEqual(q["type"], "tv")
        XCTAssertEqual(q["languages"], "EN,ES")
        XCTAssertEqual(q["season_number"], "2")
        XCTAssertEqual(q["api_key"], "K")
        let document = try await provider.download(found[0])
        XCTAssertFalse(document.cues.isEmpty)
        XCTAssertEqual(stub.requests.last?.url?.host, "dl.subdl.com")
    }

    // MARK: SubSource

    func testSubSourceLooksUpTheTitleThenEachLanguageAndFiltersOtherEpisodes() async throws {
        let stub = StubTransport()
        stub.on("GET", "/movies/search", json: #"{"data":[{"movieId":"77"}]}"#)
        stub.on("GET", "/subtitles", query: ["language=english"], json: #"{"data":[{"subtitleId":"1","releaseInfo":"GoT.S02E03.720p","hearingImpaired":false,"downloads":5},{"subtitleId":"2","releaseInfo":"GoT.S02E04.720p"},{"subtitleId":"3","release_info":"GoT.Complete"},{"releaseInfo":"no id"}]}"#)
        stub.on("GET", "/subtitles", query: ["language=french"], json: #"{"data":[{"subtitleId":"9","releaseInfo":"GoT.S02E03.FR"}]}"#)
        let provider = SubSourceProvider(apiKey: "K", http: HTTPClient(transport: stub))
        let found = try await provider.search(episode, languages: ["en", "fr"])
        XCTAssertEqual(found.map(\.id), ["subsource-1", "subsource-3", "subsource-9"], "another episode's file is dropped; an unmarked release stays")
        XCTAssertEqual(found[0].downloads, 5)
        XCTAssertEqual(found[2].language, "fr")
        let search = StubTransport.query(try XCTUnwrap(stub.requests("GET", path: "/movies/search").first))
        XCTAssertEqual(search["imdb"], "tt0944947")
        XCTAssertEqual(search["searchType"], "imdb")
        XCTAssertEqual(search["season"], "2")
        XCTAssertEqual(stub.requests[0].value(forHTTPHeaderField: "X-API-Key"), "K")
    }

    func testSubSourceWithoutAnIMDbIDOrMatchReturnsNothing() async throws {
        let stub = StubTransport().on("GET", "/movies/search", json: #"{"data":[]}"#)
        let provider = SubSourceProvider(apiKey: "K", http: HTTPClient(transport: stub))
        let none = try await provider.search(PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1), title: "x")), languages: ["en"])
        XCTAssertTrue(none.isEmpty)
        XCTAssertTrue(stub.requests.isEmpty, "no IMDb id, nothing to look up")
        let unmatched = try await provider.search(movie, languages: ["en"])
        XCTAssertTrue(unmatched.isEmpty)
        XCTAssertEqual(stub.requests.count, 1, "no language search after a miss")
    }

    func testSubSourceDownloadSendsTheKey() async throws {
        let stub = StubTransport().on("GET", "/subtitles/55/download") { _ in (200, Data("1\n00:00:01,000 --> 00:00:02,000\nHi\n".utf8), [:]) }
        let provider = SubSourceProvider(apiKey: "K", http: HTTPClient(transport: stub))
        let document = try await provider.download(SubtitleTrackInfo(id: "x", provider: "SubSource", language: "en", languageName: "English", release: "", downloadToken: "55"))
        XCTAssertEqual(document.cues.map(\.text), ["Hi"])
        XCTAssertEqual(stub.requests[0].value(forHTTPHeaderField: "X-API-Key"), "K")
    }

    // MARK: Downloads and merged search

    func testGzippedSubtitlesAreDecompressed() async throws {
        let srtGzip = try gzipped(srt)
        let stub = StubTransport().on("GET", "/s.srt.gz") { _ in (200, srtGzip, [:]) }
        let provider = WyzieProvider(apiKey: "K", http: HTTPClient(transport: stub))
        let document = try await provider.download(SubtitleTrackInfo(id: "w", provider: "Wyzie", language: "en", languageName: "English", release: "", downloadToken: "https://x.example.com/s.srt.gz"))
        XCTAssertEqual(document.cues.map(\.text), ["Hello"])
    }

    /// Stored-method gzip is enough to prove the path (no compressor in Foundation).
    private func gzipped(_ text: String) throws -> Data {
        let raw = Array(text.utf8)
        var out: [UInt8] = [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]
        out += [0x01, UInt8(raw.count & 0xff), UInt8(raw.count >> 8), UInt8(~raw.count & 0xff), UInt8((~raw.count >> 8) & 0xff)] + raw
        out += [UInt8](repeating: 0, count: 8)
        return Data(out)
    }

    func testAnEmptyArchiveIsAnError() async {
        // End-of-central-directory only: a valid, empty ZIP.
        let empty = Data([0x50, 0x4B, 0x05, 0x06] + [UInt8](repeating: 0, count: 18))
        let stub = StubTransport().on("GET", "/e.zip") { _ in (200, Data([0x50, 0x4B, 0x03, 0x04]) + empty, [:]) }
        let provider = WyzieProvider(apiKey: "K", http: HTTPClient(transport: stub))
        do {
            _ = try await provider.download(SubtitleTrackInfo(id: "w", provider: "Wyzie", language: "en", languageName: "English", release: "", downloadToken: "https://x.example.com/e.zip"))
            XCTFail("expected an error")
        } catch {
            XCTAssertNotNil(error)
        }
    }

    private struct FakeProvider: SubtitleProvider {
        var id = "fake"
        var name = "Fake"
        var tracks: [SubtitleTrackInfo] = []
        var fails = false
        func search(_ request: PlaybackRequest, languages: [String]) async throws -> [SubtitleTrackInfo] {
            if fails { throw FlowError.notFound }
            return tracks
        }
        func download(_ track: SubtitleTrackInfo) async throws -> SubtitleDocument { SubtitleDocument(cues: []) }
    }

    private func track(_ id: String, _ language: String, hi: Bool = false, downloads: Int? = nil) -> SubtitleTrackInfo {
        SubtitleTrackInfo(id: id, provider: "Fake", language: language, languageName: language, release: "", hearingImpaired: hi, downloads: downloads, downloadToken: id)
    }

    func testMergedSearchRanksLanguageOrderThenHearingPreferenceThenPopularity() async {
        let a = FakeProvider(tracks: [track("fr-1", "fr", downloads: 1000), track("en-pop", "en-US", downloads: 500), track("en-hi", "en", hi: true, downloads: 900)])
        let b = FakeProvider(tracks: [track("en-few", "en", downloads: 5), track("xx", "xx", downloads: 99999)], fails: false)
        let broken = FakeProvider(fails: true)
        let plain = await SubtitleSearch.search([a, b, broken], request: movie, languages: ["en", "fr"], hearingImpaired: false)
        XCTAssertEqual(plain.map(\.id), ["en-pop", "en-few", "en-hi", "fr-1", "xx"], "preferred languages first in the viewer's order; hearing-impaired last unless wanted; a failing provider is skipped")
        let wanted = await SubtitleSearch.search([a, b], request: movie, languages: ["en", "fr"], hearingImpaired: true)
        XCTAssertEqual(wanted.first?.id, "en-hi")
    }
}

final class SubtitleParserExtraTests: XCTestCase {
    func testCuesAtATimeIncludeLongRunningOverlapsAndHonourTheOffset() {
        let doc = SubtitleParser.parse("1\n00:00:00,000 --> 00:00:30,000\nSign\n\n2\n00:00:10,000 --> 00:00:12,000\nLine\n\n3\n00:00:20,000 --> 00:00:21,000\nLater\n")
        XCTAssertEqual(doc.cues(at: 11).map(\.text), ["Sign", "Line"])
        XCTAssertEqual(doc.cues(at: 25).map(\.text), ["Sign"], "a sign that stays up is still found after later cues started")
        XCTAssertEqual(doc.cues(at: 20.5).map(\.text), ["Sign", "Later"])
        XCTAssertEqual(doc.cues(at: 35).map(\.text), [])
        XCTAssertEqual(doc.cues(at: 11, offset: 10).map(\.text), ["Sign"], "a +10 s offset shows what was due 10 s earlier... of the file's own time")
        XCTAssertEqual(doc.text(at: 11), "Sign\nLine")
        XCTAssertNil(doc.text(at: 100))
    }

    func testWebVTTShortTimestampsAndHeadersAreRead() {
        let doc = SubtitleParser.parse("WEBVTT - title\n\nNOTE comment\n\nintro\n00:01.500 --> 00:03.000 align:start\n<c.yellow>Hi</c> <i>there</i>\n")
        XCTAssertEqual(doc.cues.count, 1)
        XCTAssertEqual(doc.cues[0].start, 1.5, accuracy: 0.001)
        XCTAssertEqual(doc.cues[0].end, 3, accuracy: 0.001)
        XCTAssertEqual(doc.cues[0].text, "Hi there")
    }

    func testEncodingsDecode() {
        XCTAssertEqual(SubtitleParser.decode(Data([0xEF, 0xBB, 0xBF, 0x41])), "A", "UTF-8 byte-order mark is dropped")
        XCTAssertEqual(SubtitleParser.decode(Data([0xFF, 0xFE, 0x41, 0x00])), "A", "UTF-16 little-endian")
        XCTAssertEqual(SubtitleParser.decode(Data([0x63, 0x61, 0x66, 0xE9])), "café", "Windows-1252 when it isn't UTF-8")
        XCTAssertEqual(SubtitleParser.decode(Data([0x93, 0x68, 0x69, 0x94, 0x20, 0x80])), "\u{201C}hi\u{201D} \u{20AC}", "its curly quotes and euro sign, which Latin-1 lacks")
    }

    func testTimestampsAndTags() {
        XCTAssertEqual(SubtitleParser.timestamp("01:02:03,500"), 3723.5)
        XCTAssertEqual(SubtitleParser.timestamp("02:03.250"), 123.25)
        XCTAssertNil(SubtitleParser.timestamp("soon"))
        XCTAssertEqual(SubtitleParser.stripTags("<i>a</i> {\\an8}b <font color=red>c</font>"), "a b c")
    }

    func testLanguageNames() {
        XCTAssertEqual(SubtitleLanguages.name("fr"), "French")
        XCTAssertEqual(SubtitleLanguages.name("zzzz"), "ZZZZ", "an unknown code is shown as typed")
    }
}
