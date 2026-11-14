import XCTest
@testable import FlowKit

/// TMDb, TheTVDB and the episode-source choice, through a scripted transport with hand-written replies
/// in the shapes those APIs send.
final class TMDBClientTests: XCTestCase {
    private func client(_ stub: StubTransport, language: String = "en-US") -> TMDBClient {
        TMDBClient(credential: "0123456789abcdef0123456789abcdef", language: language, region: "GB", http: HTTPClient(transport: stub))
    }

    func testBlankKeyFailsBeforeAnyRequest() async {
        let stub = StubTransport()
        do { _ = try await TMDBClient(credential: "", http: HTTPClient(transport: stub)).genres(.movie); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .missingCredential("TMDB API key"))
        }
        XCTAssertTrue(stub.requests.isEmpty)
    }

    func testMultiSearchMixesTitlesAndPeopleAndSendsAdultFlag() async throws {
        let stub = StubTransport().on("GET", "/search/multi", json: """
        {"page":1,"total_pages":4,"results":[
         {"id":603,"media_type":"movie","title":"The Matrix","release_date":"1999-03-31","poster_path":"/m.jpg"},
         {"id":1399,"media_type":"tv","name":"Game of Thrones","first_air_date":"2011-04-17"},
         {"id":6384,"media_type":"person","name":"Keanu Reeves","profile_path":"/k.jpg","known_for_department":"Acting"}]}
        """)
        let (results, pages) = try await client(stub).search("matrix", page: 2)
        XCTAssertEqual(pages, 4)
        XCTAssertEqual(results.count, 3)
        guard case .media(let first) = results[0], case .media(let second) = results[1], case .person(let third) = results[2] else { return XCTFail("wrong kinds: \(results)") }
        XCTAssertEqual(first.title, "The Matrix")
        XCTAssertEqual(first.year, 1999)
        XCTAssertEqual(second.type, .show)
        XCTAssertEqual(second.title, "Game of Thrones")
        XCTAssertEqual(third.name, "Keanu Reeves")
        let q = StubTransport.query(stub.requests[0])
        XCTAssertEqual(q["query"], "matrix")
        XCTAssertEqual(q["page"], "2")
        XCTAssertEqual(q["include_adult"], "false")
        XCTAssertEqual(q["language"], "en-US")
    }

    func testTypedSearchUsesTheRightYearParameterPerType() async throws {
        let stub = StubTransport().on("GET", "/search/movie", json: #"{"results":[{"id":1,"title":"A"}]}"#).on("GET", "/search/tv", json: #"{"results":[{"id":2,"name":"B"}]}"#)
        let tmdb = client(stub)
        let movies = try await tmdb.search("a", type: .movie, year: 1999)
        let shows = try await tmdb.search("b", type: .show, year: 2011)
        XCTAssertEqual(movies.map(\.title), ["A"])
        XCTAssertEqual(shows.map(\.type), [.show])
        XCTAssertEqual(StubTransport.query(stub.requests[0])["year"], "1999")
        XCTAssertEqual(StubTransport.query(stub.requests[1])["first_air_date_year"], "2011")
        XCTAssertNil(StubTransport.query(stub.requests[1])["year"])
    }

    func testSeasonDecodesEpisodes() async throws {
        let stub = StubTransport().on("GET", "/tv/1399/season/1", json: """
        {"episodes":[{"id":63056,"episode_number":1,"season_number":1,"name":"Winter Is Coming","overview":"Eddard.","air_date":"2011-04-17","runtime":62,"still_path":"/s1.jpg","vote_average":8.1},
                     {"id":63057,"episode_number":2,"season_number":1,"name":"The Kingsroad","air_date":null}]}
        """)
        let episodes = try await client(stub).season(showID: 1399, season: 1)
        XCTAssertEqual(episodes.map(\.number), [1, 2])
        XCTAssertEqual(episodes[0].title, "Winter Is Coming")
        XCTAssertEqual(episodes[0].runtimeMinutes, 62)
        XCTAssertEqual(episodes[0].stillPath, "/s1.jpg")
        XCTAssertEqual(episodes[0].airDate, FlowDate.parse("2011-04-17"))
        XCTAssertNil(episodes[1].airDate)
        XCTAssertEqual(episodes[0].showTMDB, 1399)
    }

    func testEpisodeCreditsPutRegularsBeforeGuestsAndDropDuplicates() async throws {
        let stub = StubTransport().on("GET", "/tv/1/season/2/episode/3/credits", json: """
        {"cast":[{"id":2,"name":"B","character":"Bee","order":1},{"id":1,"name":"A","character":"Ay","order":0}],
         "guest_stars":[{"id":3,"name":"G","character":"Guest","order":0},{"id":1,"name":"A","character":"Ay again","order":1}]}
        """)
        let cast = try await client(stub).episodeCredits(showID: 1, season: 2, episode: 3)
        XCTAssertEqual(cast.map(\.name), ["A", "B", "G"])
        XCTAssertEqual(cast.map(\.order), [0, 1, 2])
    }

    func testCollectionPartsComeOutInReleaseOrder() async throws {
        let stub = StubTransport().on("GET", "/collection/10", json: """
        {"id":10,"name":"Star Wars Collection","poster_path":"/p.jpg","backdrop_path":"/b.jpg","parts":[
          {"id":2,"title":"Empire","release_date":"1980-05-17"},{"id":1,"title":"Hope","release_date":"1977-05-25"},{"id":9,"title":"Undated"}]}
        """)
        let collection = try await client(stub).collection(10)
        XCTAssertEqual(collection.parts.map(\.title), ["Hope", "Empire", "Undated"], "undated parts go last")
        XCTAssertEqual(collection.name, "Star Wars Collection")
    }

    func testPersonWithCredits() async throws {
        let stub = StubTransport().on("GET", "/person/6384", json: """
        {"id":6384,"name":"Keanu Reeves","biography":"Actor.","profile_path":"/k.jpg","birthday":"1964-09-02","place_of_birth":"Beirut",
         "combined_credits":{"cast":[{"id":603,"media_type":"movie","title":"The Matrix","release_date":"1999-03-31","popularity":90}]}}
        """)
        let person = try await client(stub).person(6384)
        XCTAssertEqual(person.name, "Keanu Reeves")
        XCTAssertEqual(person.birthday, FlowDate.parse("1964-09-02"))
        XCTAssertEqual(person.placeOfBirth, "Beirut")
        XCTAssertEqual(person.credits.map(\.title), ["The Matrix"])
        XCTAssertEqual(StubTransport.query(stub.requests[0])["append_to_response"], "combined_credits")
    }

    func testFindResolvesIMDbAndTVDBIDs() async throws {
        let stub = StubTransport()
        stub.on("GET", "/find/tt0133093", json: #"{"movie_results":[{"id":603,"title":"The Matrix"}],"tv_results":[]}"#)
        stub.on("GET", "/find/tt0944947", json: #"{"movie_results":[],"tv_results":[{"id":1399,"name":"Game of Thrones"}]}"#)
        stub.on("GET", "/find/121361", json: #"{"movie_results":[],"tv_results":[{"id":1399,"name":"Game of Thrones"}]}"#)
        stub.on("GET", "/find/tt0", json: #"{"movie_results":[],"tv_results":[]}"#)
        let tmdb = client(stub)
        let movie = try await tmdb.find(imdb: "tt0133093")
        XCTAssertEqual(movie?.type, .movie)
        let show = try await tmdb.find(imdb: "tt0944947")
        XCTAssertEqual(show?.type, .show)
        let byTVDB = try await tmdb.find(tvdb: 121361)
        XCTAssertEqual(byTVDB?.ids.tmdb, 1399)
        let nothing = try await tmdb.find(imdb: "tt0")
        XCTAssertNil(nothing)
        XCTAssertEqual(StubTransport.query(stub.requests[0])["external_source"], "imdb_id")
        XCTAssertEqual(StubTransport.query(stub.requests[2])["external_source"], "tvdb_id")
    }

    func testExternalIDsGenresAndReleaseDates() async throws {
        let stub = StubTransport()
        stub.on("GET", "/movie/603/external_ids", json: #"{"imdb_id":"tt0133093","tvdb_id":null}"#)
        stub.on("GET", "/genre/movie/list", json: #"{"genres":[{"id":28,"name":"Action"},{"id":878,"name":"Science Fiction"}]}"#)
        stub.on("GET", "/movie/603/release_dates", json: """
        {"results":[{"iso_3166_1":"US","release_dates":[{"type":3,"release_date":"1999-03-31T00:00:00.000Z","certification":"R"},{"type":4,"release_date":"1999-09-21T00:00:00.000Z","certification":""},{"type":3,"release_date":null}]}]}
        """)
        let tmdb = client(stub)
        let ids = try await tmdb.externalIDs(.movie, id: 603)
        XCTAssertEqual(ids, ExternalIDs(tmdb: 603, imdb: "tt0133093"))
        let genres = try await tmdb.genres(.movie)
        XCTAssertEqual(genres.map(\.name), ["Action", "Science Fiction"])
        let releases = try await tmdb.releaseDates(movieID: 603)
        XCTAssertEqual(releases.count, 2, "an entry without a date is dropped")
        XCTAssertEqual(releases[0].type, .theatrical)
        XCTAssertEqual(releases[1].type, .digital)
        XCTAssertEqual(releases[0].certification, "R")
        XCTAssertEqual(releases[0].country, "US")
    }

    func testWatchProvidersSortByDisplayPriorityAndAskForTheRegion() async throws {
        let stub = StubTransport().on("GET", "/watch/providers/movie", json: #"{"results":[{"provider_id":2,"provider_name":"Late","display_priority":9},{"provider_id":8,"provider_name":"Netflix","display_priority":0},{"provider_id":3,"provider_name":"None"}]}"#)
        let providers = try await client(stub).watchProviders(.movie)
        XCTAssertEqual(providers.map(\.providerName), ["Netflix", "Late", "None"])
        XCTAssertEqual(StubTransport.query(stub.requests[0])["watch_region"], "GB")
    }

    func testLogoPathPicksTheViewersLanguageThenEnglish() async throws {
        let stub = StubTransport().on("GET", "/movie/603/images", json: """
        {"logos":[{"file_path":"/en-small.png","iso_639_1":"en","width":200,"height":100,"vote_average":5},
                  {"file_path":"/fr.png","iso_639_1":"fr","width":400,"height":200,"vote_average":5},
                  {"file_path":"/en-big.png","iso_639_1":"en","width":800,"height":400,"vote_average":6}]}
        """)
        let tmdb = client(stub, language: "fr-FR")
        let logo = try await tmdb.logoPath(.movie, id: 603)
        XCTAssertEqual(logo, "/fr.png")
        XCTAssertEqual(StubTransport.query(stub.requests[0])["include_image_language"], "fr,en,null")
    }

    func testUnauthorizedKeyIsReported() async {
        let stub = StubTransport().on("GET", "/genre/movie/list", status: 401, json: #"{"status_message":"Invalid API key"}"#)
        do { _ = try await client(stub).genres(.movie); XCTFail("expected an error") } catch { XCTAssertEqual(error as? FlowError, .unauthorized) }
    }
}

final class TVDBClientTests: XCTestCase {
    private func login(_ stub: StubTransport, token: String = "T1") {
        stub.on("POST", "/login", json: #"{"data":{"token":"\#(token)"}}"#)
    }

    func testLoginHappensOnceAndEpisodesPageUntilThereIsNoNextLink() async throws {
        let stub = StubTransport()
        login(stub)
        stub.on("GET", "/series/121361/episodes/default/eng", query: ["page=0"], json: """
        {"data":{"episodes":[{"id":1,"seasonNumber":1,"number":1,"name":"Winter Is Coming","aired":"2011-04-17","runtime":62,"image":"https://i/1.jpg","absoluteNumber":1},
                             {"id":2,"seasonNumber":null,"number":2}]},"links":{"next":"https://api4.thetvdb.com/v4/series/121361/episodes/default/eng?page=1"}}
        """)
        stub.on("GET", "/series/121361/episodes/default/eng", query: ["page=1"], json: #"{"data":{"episodes":[{"id":3,"seasonNumber":0,"number":1}]},"links":{"next":null}}"#)
        let tvdb = TVDBClient(apiKey: "KEY", http: HTTPClient(transport: stub))
        let episodes = try await tvdb.episodes(seriesID: 121361, showTMDB: 1399)
        XCTAssertEqual(episodes.map(\.ref), [EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 0, episode: 1)], "an episode with no season is dropped")
        XCTAssertEqual(episodes[0].title, "Winter Is Coming")
        XCTAssertEqual(episodes[0].ids.tvdb, 1)
        XCTAssertEqual(episodes[0].absoluteNumber, 1)
        XCTAssertEqual(episodes[0].showTMDB, 1399)
        XCTAssertEqual(episodes[1].title, "Episode 1", "an untitled episode gets a placeholder")
        XCTAssertEqual(stub.requests("POST", path: "/login").count, 1)
        XCTAssertEqual(StubTransport.body(stub.requests[0])["apikey"] as? String, "KEY")
        XCTAssertEqual(stub.requests("GET", path: "/series/121361/episodes/default/eng").first?.value(forHTTPHeaderField: "Authorization"), "Bearer T1")
    }

    func testAnExpiredTokenIsRefreshedOnceAndTheRequestRetried() async throws {
        let stub = StubTransport()
        let logins = Counter()
        stub.on("POST", "/login") { _ in
            let n = logins.next()
            return (200, Data(#"{"data":{"token":"T\#(n)"}}"#.utf8), [:])
        }
        stub.on("GET", "/series/5/episodes/default/eng") { request in
            request.value(forHTTPHeaderField: "Authorization") == "Bearer T2"
                ? (200, Data(#"{"data":{"episodes":[{"id":1,"seasonNumber":1,"number":1,"name":"x"}]}}"#.utf8), [:])
                : (401, Data(), [:])
        }
        let episodes = try await TVDBClient(apiKey: "K", http: HTTPClient(transport: stub)).episodes(seriesID: 5, showTMDB: 1)
        XCTAssertEqual(episodes.count, 1)
        XCTAssertEqual(logins.value, 2)
    }

    func testMissingKeyFailsWithoutLoggingIn() async {
        let stub = StubTransport()
        do { _ = try await TVDBClient(apiKey: "", http: HTTPClient(transport: stub)).episodes(seriesID: 1, showTMDB: 1); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .missingCredential("TVDB API key"))
        }
        XCTAssertTrue(stub.requests.isEmpty)
    }

    func testLanguageCodesMapToTVDBsThreeLetterOnes() {
        XCTAssertEqual(TVDBClient.tvdbLanguage(from: "en-US"), "eng")
        XCTAssertEqual(TVDBClient.tvdbLanguage(from: "fr"), "fra")
        XCTAssertEqual(TVDBClient.tvdbLanguage(from: "ja-JP"), "jpn")
        XCTAssertEqual(TVDBClient.tvdbLanguage(from: "xx"), "eng", "an unknown language falls back to English")
    }

    final class Counter: @unchecked Sendable {
        private let lock = NSLock(); private var n = 0
        func next() -> Int { lock.lock(); defer { lock.unlock() }; n += 1; return n }
        var value: Int { lock.lock(); defer { lock.unlock() }; return n }
    }
}

final class EpisodeProviderTests: XCTestCase {
    private let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399, tvdb: 121361), title: "GoT")
    private let seasons = [Season(number: 1, name: "S1", episodeCount: 2)]

    private func tmdbStub() -> StubTransport {
        StubTransport().on("GET", "/tv/1399/season/1", json: """
        {"episodes":[{"id":1,"episode_number":1,"season_number":1,"name":"TMDB One","overview":"From TMDb.","still_path":"/tmdb1.jpg","runtime":60,"vote_average":8.0},
                     {"id":2,"episode_number":2,"season_number":1,"name":"TMDB Two","still_path":"/tmdb2.jpg"}]}
        """)
    }

    func testTVDBOrderingWinsAndTMDbFillsInStillsAndOverviews() async throws {
        let tmdbTransport = tmdbStub()
        let tvdbTransport = StubTransport()
        tvdbTransport.on("POST", "/login", json: #"{"data":{"token":"T"}}"#)
        tvdbTransport.on("GET", "/episodes/default/eng", json: #"{"data":{"episodes":[{"id":9,"seasonNumber":1,"number":1,"name":"TVDB One","overview":"","image":"https://tvdb/1.jpg"},{"id":10,"seasonNumber":1,"number":3,"name":"TVDB Three"}]}}"#)
        let provider = EpisodeProvider(source: .tvdb, tmdb: TMDBClient(credential: String(repeating: "a", count: 32), http: HTTPClient(transport: tmdbTransport)),
                                       tvdb: TVDBClient(apiKey: "K", http: HTTPClient(transport: tvdbTransport)), trakt: nil)
        let grouped = try await provider.episodes(for: show, seasons: seasons)
        let one = try XCTUnwrap(grouped[1]?.first { $0.number == 1 })
        XCTAssertEqual(one.title, "TVDB One", "the TVDB title wins")
        XCTAssertEqual(one.stillPath, "/tmdb1.jpg", "a remote TVDB image gives way to TMDb's still")
        XCTAssertEqual(one.overview, "From TMDb.", "an empty overview is filled from TMDb")
        XCTAssertEqual(one.runtimeMinutes, 60)
        XCTAssertEqual(one.voteAverage, 8.0)
        XCTAssertEqual(one.ids.tvdb, 9)
        XCTAssertEqual(grouped[1]?.map(\.number), [1, 3], "episode 3 exists only on TVDB, and TMDb's episode 2 isn't invented")
    }

    func testFallsBackToTMDbWhenTVDBFailsHasNoIDOrTheSourceIsTMDb() async throws {
        let failing = StubTransport()
        failing.on("POST", "/login", status: 500, json: "")
        let tmdb = TMDBClient(credential: String(repeating: "a", count: 32), http: HTTPClient(transport: tmdbStub()))
        let viaFailure = EpisodeProvider(source: .tvdb, tmdb: tmdb, tvdb: TVDBClient(apiKey: "K", http: HTTPClient(transport: failing)), trakt: nil)
        let a = try await viaFailure.episodes(for: show, seasons: seasons)
        XCTAssertEqual(a[1]?.map(\.title), ["TMDB One", "TMDB Two"])
        let noTVDBID = EpisodeProvider(source: .tvdb, tmdb: tmdb, tvdb: TVDBClient(apiKey: "K", http: HTTPClient(transport: failing)), trakt: nil)
        let b = try await noTVDBID.episodes(for: MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399), title: "GoT"), seasons: seasons)
        XCTAssertEqual(b[1]?.count, 2)
        XCTAssertTrue(failing.requests.count == 1, "the show without a TVDB id never asks TVDB")
        let plain = EpisodeProvider(source: .tmdb, tmdb: tmdb, tvdb: nil, trakt: nil)
        let c = try await plain.episodes(for: show, seasons: seasons)
        XCTAssertEqual(c[1]?.count, 2)
        let noTMDb = try await plain.episodes(for: MediaItem(type: .show, ids: ExternalIDs(), title: "x"), seasons: seasons)
        XCTAssertTrue(noTMDb.isEmpty)
    }
}

final class AirDateFormattingExtraTests: XCTestCase {
    func testBareDaysNeverSlipToTheEveningBefore() {
        let day = FlowDate.parse("2026-10-21")!
        XCTAssertTrue(AirDateFormatting.isBareDay(day))
        let la = TimeZone(identifier: "America/Los_Angeles")!
        XCTAssertEqual(AirDateFormatting.string(for: day, localTimeZone: true, viewerTimeZone: la), AirDateFormatting.string(for: day, localTimeZone: false, viewerTimeZone: la))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = la
        let local = AirDateFormatting.localDay(fromBareDay: day, in: calendar)
        XCTAssertEqual(calendar.dateComponents([.year, .month, .day, .hour], from: try! XCTUnwrap(local)), DateComponents(year: 2026, month: 10, day: 21, hour: 0))
        XCTAssertNil(AirDateFormatting.localDay(fromBareDay: Date(timeIntervalSince1970: 3600), in: calendar), "a date with a time isn't a bare day")
    }
}
