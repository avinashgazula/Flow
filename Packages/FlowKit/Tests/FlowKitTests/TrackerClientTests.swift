import XCTest
@testable import FlowKit

/// Simkl, MDBList and PublicMetaDB through a scripted transport.
final class SimklClientTests: XCTestCase {
    private let movie = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093"), title: "The Matrix", releaseDate: FlowDate.parse("1999-03-31"))
    private let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399, tvdb: 121361), title: "Game of Thrones")

    private func client(_ stub: StubTransport, token: OAuthToken? = OAuthToken(accessToken: "AT"), clientID: String = "CID",
                        onToken: @escaping @Sendable (OAuthToken?) -> Void = { _ in }) -> SimklClient {
        SimklClient(clientID: clientID, token: token, http: HTTPClient(transport: stub), onTokenChange: onToken)
    }

    func testRequestsCarryTheClientIDAndBearerToken() async throws {
        let stub = StubTransport().on("GET", "/users/settings", json: #"{"user":{"name":"alex","avatar":"https://a.example.com/x.png"}}"#)
        let profile = try await client(stub).profile()
        XCTAssertEqual(profile?.username, "alex")
        XCTAssertEqual(profile?.avatarURL?.absoluteString, "https://a.example.com/x.png")
        let r = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer AT")
        XCTAssertEqual(r.value(forHTTPHeaderField: "simkl-api-key"), "CID")
        XCTAssertEqual(StubTransport.query(r)["client_id"], "CID")
        XCTAssertEqual(r.url?.host, "api.simkl.com")
    }

    func testMissingCredentialsFailBeforeAnythingIsSent() async {
        let stub = StubTransport()
        do { _ = try await client(stub, clientID: "").profile(); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .missingCredential("Simkl client ID"))
        }
        do { _ = try await client(stub, token: nil).profile(); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .unauthorized)
        }
        XCTAssertTrue(stub.requests.isEmpty)
    }

    func testPinSignInStoresAndReportsTheToken() async throws {
        let stub = StubTransport()
        stub.on("GET", "/oauth/pin", json: #"{"user_code":"AB12C","verification_url":"https://simkl.com/pin/","expires_in":900,"interval":5}"#)
        stub.on("GET", "/oauth/pin/AB12C", json: #"{"result":"OK","access_token":"new-token"}"#)
        final class Box: @unchecked Sendable { var token: OAuthToken? }
        let box = Box()
        let simkl = client(stub, token: nil) { box.token = $0 }
        let code = try await simkl.startDeviceAuth()
        XCTAssertEqual(code.userCode, "AB12C")
        XCTAssertEqual(code.verificationURL.absoluteString, "https://simkl.com/pin/")
        XCTAssertEqual(code.interval, 5)
        XCTAssertNil(stub.requests[0].value(forHTTPHeaderField: "Authorization"), "the PIN request is made before there is a token")
        let token = try await simkl.pollDeviceToken(code)
        XCTAssertEqual(token.accessToken, "new-token")
        XCTAssertEqual(box.token?.accessToken, "new-token")
        await simkl.signOut()
        XCTAssertNil(box.token)
    }

    func testExpiredPinTimesOutWithoutPolling() async {
        let stub = StubTransport()
        let code = DeviceCode(deviceCode: "X", userCode: "X", verificationURL: URL(string: "https://simkl.com/pin")!, expiresIn: 0, interval: 5)
        do { _ = try await client(stub, token: nil).pollDeviceToken(code); XCTFail("expected a timeout") } catch {
            XCTAssertEqual(error as? FlowError, .timedOut)
        }
        XCTAssertTrue(stub.requests.isEmpty)
    }

    func testPlaybackProgressSortsNewestFirstAndSkipsEntriesWithoutTMDb() async throws {
        let stub = StubTransport().on("GET", "/sync/playback", json: """
        [{"id":"1","type":"movie","progress":42.5,"paused_at":"2026-01-01T10:00:00Z","movie":{"ids":{"tmdb":603}}},
         {"id":"2","type":"episode","progress":10,"paused_at":"2026-02-01T10:00:00Z","show":{"ids":{"tmdb":1399}},"episode":{"season":2,"number":3}},
         {"id":"3","type":"movie","progress":5,"movie":{"ids":{"imdb":"tt1"}}}]
        """)
        let progress = try await client(stub).playbackProgress()
        XCTAssertEqual(progress.map(\.remoteID), ["2", "1"])
        XCTAssertEqual(progress[0].key, MediaKey(type: .show, tmdbID: 1399))
        XCTAssertEqual(progress[0].episode, EpisodeRef(season: 2, episode: 3))
        XCTAssertEqual(progress[1].percent, 42.5)
        XCTAssertEqual(progress[1].updatedAt, FlowDate.parse("2026-01-01T10:00:00Z"))
    }

    func testRemovingAResumePointNeedsItsRemoteID() async throws {
        let stub = StubTransport().on("DELETE", "/sync/playback/77")
        let simkl = client(stub)
        try await simkl.removePlaybackProgress(PlaybackProgress(key: MediaKey(type: .movie, tmdbID: 1), percent: 5))
        XCTAssertTrue(stub.requests.isEmpty, "no remote id, nothing to delete")
        try await simkl.removePlaybackProgress(PlaybackProgress(key: MediaKey(type: .movie, tmdbID: 1), percent: 5, remoteID: "77"))
        XCTAssertEqual(stub.requests.first?.httpMethod, "DELETE")
    }

    func testHistoryMergesMoviesAndEpisodesNewestFirstWithinTheLimit() async throws {
        let stub = StubTransport()
        stub.on("GET", "/sync/all-items/movies/completed", json: #"{"movies":[{"movie":{"ids":{"tmdb":603}},"last_watched_at":"2026-03-01T00:00:00Z"},{"movie":{"ids":{"tmdb":1}}}]}"#)
        stub.on("GET", "/sync/all-items/shows", json: #"{"shows":[{"show":{"ids":{"tmdb":1399}},"seasons":[{"number":1,"episodes":[{"number":1,"watched_at":"2026-04-01T00:00:00Z"},{"number":2,"watched_at":"2026-02-01T00:00:00Z"}]}]}]}"#)
        let history = try await client(stub).history(limit: 2)
        XCTAssertEqual(history.map(\.watchedAt), [FlowDate.parse("2026-04-01T00:00:00Z")!, FlowDate.parse("2026-03-01T00:00:00Z")!])
        XCTAssertEqual(history[0].episode, EpisodeRef(season: 1, episode: 1))
        XCTAssertNil(history[1].episode)
    }

    func testWatchedMoviesAndShows() async throws {
        let stub = StubTransport()
        stub.on("GET", "/sync/all-items/movies/completed", json: #"{"movies":[{"movie":{"ids":{"tmdb":603}}},{"movie":{"ids":{"tmdb":13}}},{"movie":{"ids":{}}}]}"#)
        stub.on("GET", "/sync/all-items/shows", json: #"{"shows":[{"show":{"ids":{"tmdb":1399}},"last_watched_at":"2026-04-01T00:00:00Z","seasons":[{"number":1,"episodes":[{"number":1},{"number":2}]},{"number":2,"episodes":[{"number":1}]}]}]}"#)
        let simkl = client(stub)
        let movies = try await simkl.watchedMovies()
        XCTAssertEqual(movies, [603, 13])
        let shows = try await simkl.watchedShows()
        XCTAssertEqual(shows.count, 1)
        XCTAssertEqual(shows[0].watched, [EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 1, episode: 2), EpisodeRef(season: 2, episode: 1)])
        XCTAssertEqual(shows[0].lastWatchedAt, FlowDate.parse("2026-04-01T00:00:00Z"))
    }

    func testMarkingWatchedPostsIDsEpisodesAndTime() async throws {
        let stub = StubTransport().on("POST", "/sync/history").on("POST", "/sync/history/remove")
        let simkl = client(stub)
        let when = Date(timeIntervalSince1970: 1_700_000_000)
        try await simkl.markWatched(movie, episodes: nil, at: when)
        try await simkl.markWatched(show, episodes: [EpisodeRef(season: 1, episode: 2), EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 2, episode: 5)], at: when)
        try await simkl.markUnwatched(movie, episodes: nil)

        let movieBody = StubTransport.body(stub.requests[0])
        let entry = try XCTUnwrap((movieBody["movies"] as? [[String: Any]])?.first)
        XCTAssertEqual((entry["ids"] as? [String: Any])?["tmdb"] as? Int, 603)
        XCTAssertEqual((entry["ids"] as? [String: Any])?["imdb"] as? String, "tt0133093")
        XCTAssertEqual(entry["title"] as? String, "The Matrix")
        XCTAssertEqual(entry["year"] as? Int, 1999)
        XCTAssertNotNil(entry["watched_at"])

        let showEntry = try XCTUnwrap((StubTransport.body(stub.requests[1])["shows"] as? [[String: Any]])?.first)
        let seasons = try XCTUnwrap(showEntry["seasons"] as? [[String: Any]])
        XCTAssertEqual(seasons.map { $0["number"] as? Int }, [1, 2])
        XCTAssertEqual((seasons[0]["episodes"] as? [[String: Any]])?.map { $0["number"] as? Int }, [1, 2], "episodes within a season are sorted")
        XCTAssertEqual(stub.requests[2].url?.path, "/sync/history/remove")
        XCTAssertNil((try XCTUnwrap((StubTransport.body(stub.requests[2])["movies"] as? [[String: Any]])?.first))["watched_at"])
    }

    func testScrobbleClampsProgressAndShapesMovieAndEpisodeBodies() async throws {
        let stub = StubTransport().on(nil, "")
        let simkl = client(stub)
        try await simkl.scrobble(.start, request: PlaybackRequest(item: movie), percent: 140)
        try await simkl.scrobble(.stop, request: PlaybackRequest(item: show, episode: Episode(showTMDB: 1399, season: 3, number: 9, title: "x")), percent: -5)
        XCTAssertEqual(stub.requests[0].url?.path, "/scrobble/start")
        XCTAssertEqual(StubTransport.body(stub.requests[0])["progress"] as? Double, 100)
        XCTAssertNotNil(StubTransport.body(stub.requests[0])["movie"])
        XCTAssertEqual(stub.requests[1].url?.path, "/scrobble/stop")
        let b = StubTransport.body(stub.requests[1])
        XCTAssertEqual(b["progress"] as? Double, 0)
        XCTAssertEqual((b["episode"] as? [String: Any])?["season"] as? Int, 3)
        XCTAssertEqual((b["episode"] as? [String: Any])?["number"] as? Int, 9)
        XCTAssertNotNil(b["show"])
    }

    func testWatchlistAndRatings() async throws {
        let stub = StubTransport().on(nil, "")
        stub.on("GET", "/sync/all-items/movies/plantowatch", json: #"{"movies":[{"movie":{"ids":{"tmdb":1}},"added_to_watchlist_at":"2026-01-01T00:00:00Z"}]}"#)
        stub.on("GET", "/sync/all-items/shows/plantowatch", json: #"{"shows":[{"show":{"ids":{"tmdb":2}},"added_to_watchlist_at":"2026-05-01T00:00:00Z"}]}"#)
        let simkl = client(stub)
        let list = try await simkl.watchlist()
        XCTAssertEqual(list.map(\.key), [MediaKey(type: .show, tmdbID: 2), MediaKey(type: .movie, tmdbID: 1)])
        try await simkl.setWatchlisted(movie, true)
        try await simkl.setWatchlisted(movie, false)
        XCTAssertEqual(stub.requests[2].url?.path, "/sync/add-to-list")
        XCTAssertEqual(StubTransport.body(stub.requests[2]).keys.sorted(), ["movies"])
        XCTAssertEqual(((StubTransport.body(stub.requests[2])["movies"] as? [[String: Any]])?.first)?["to"] as? String, "plantowatch")
        XCTAssertEqual(stub.requests[3].url?.path, "/sync/history/remove")
        try await simkl.rate(movie, rating: 15)
        try await simkl.rate(movie, rating: nil)
        XCTAssertEqual(stub.requests[4].url?.path, "/sync/ratings")
        XCTAssertEqual(((StubTransport.body(stub.requests[4])["movies"] as? [[String: Any]])?.first)?["rating"] as? Int, 10, "scores are capped at 10")
        XCTAssertEqual(stub.requests[5].url?.path, "/sync/ratings/remove")
    }

    func testFavouritesAreNotSupported() async {
        do { _ = try await client(StubTransport()).favourites(); XCTFail("expected an error") } catch {
            XCTAssertTrue((error as? FlowError)?.errorDescription?.contains("does not support favourites") == true)
        }
    }

    func testAnEmptyReplyIsNoData() async throws {
        let stub = StubTransport().on("GET", "/sync/playback", json: "null")
        let progress = try await client(stub).playbackProgress()
        XCTAssertTrue(progress.isEmpty)
    }
}

final class KeyedSyncClientTests: XCTestCase {
    private let movie = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093"), title: "The Matrix")

    func testMDBListSendsTheKeyInTheQueryAndPublicMetaDBAsABearer() async throws {
        let stub = StubTransport().on("GET", "/user", json: #"{"username":"alex"}"#)
        let mdb = KeyedSyncClient.mdblist(apiKey: "K1", http: HTTPClient(transport: stub))
        let profile = try await mdb.profile()
        XCTAssertEqual(profile?.username, "alex")
        XCTAssertEqual(StubTransport.query(stub.requests[0])["apikey"], "K1")
        XCTAssertNil(stub.requests[0].value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(stub.requests[0].url?.host, "api.mdblist.com")

        let pmdb = KeyedSyncClient.publicMetaDB(baseURL: "https://pm.example.com/", apiKey: "K2", http: HTTPClient(transport: stub))
        _ = try await pmdb.profile()
        XCTAssertEqual(stub.requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer K2")
        XCTAssertEqual(stub.requests[1].url?.absoluteString, "https://pm.example.com/user")
    }

    func testProfileFallsBackToTheServiceNameWhenTheServerIsUnhappy() async throws {
        let stub = StubTransport().on("GET", "/user", status: 500, json: "")
        let profile = try await KeyedSyncClient.mdblist(apiKey: "K", http: HTTPClient(transport: stub)).profile()
        XCTAssertEqual(profile?.username, TrackerKind.mdblist.displayName)
    }

    func testBlankKeyFailsBeforeAnyRequest() async {
        let stub = StubTransport()
        do { _ = try await KeyedSyncClient.mdblist(apiKey: "", http: HTTPClient(transport: stub)).watchedMovies(); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .missingCredential("MDBList API key"))
        }
        XCTAssertTrue(stub.requests.isEmpty)
    }

    func testWatchedAndHistoryUnderEveryShapeTheseAPIsUse() async throws {
        let stub = StubTransport()
        stub.on("GET", "/sync/watched", json: """
        {"movies":[{"movie":{"ids":{"tmdb":603}}},{"movie":{"tmdb":13}},{"id":99}],
         "shows":[{"show":{"ids":{"tmdb":1399}},"last_watched_at":"2026-04-01T00:00:00Z","seasons":[{"number":1,"episodes":[{"number":1}]}]}],
         "episodes":[{"show":{"ids":{"tmdb":1399}},"episode":{"season":1,"number":2}},{"show":{"ids":{"tmdb":7}},"season":4,"number":4},{"show":{"ids":{}}}]}
        """)
        stub.on("GET", "/sync/history", json: """
        [{"type":"movie","movie":{"ids":{"tmdb":603}},"watched_at":"2026-01-01T00:00:00Z"},
         {"type":"episode","show":{"ids":{"tmdb":1399}},"episode":{"season":1,"number":1},"watched_at":"2026-02-01T00:00:00Z"},
         {"type":"movie","movie":{}}]
        """)
        let client = KeyedSyncClient.mdblist(apiKey: "K", http: HTTPClient(transport: stub))
        let movies = try await client.watchedMovies()
        XCTAssertEqual(movies, [603, 13, 99])
        let shows = try await client.watchedShows().sorted { $0.key.tmdbID < $1.key.tmdbID }
        XCTAssertEqual(shows.map(\.key.tmdbID), [7, 1399])
        XCTAssertEqual(shows[1].watched, [EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 1, episode: 2)])
        XCTAssertEqual(shows[0].watched, [EpisodeRef(season: 4, episode: 4)])
        let history = try await client.history(limit: 50)
        XCTAssertEqual(history.count, 2)
        XCTAssertEqual(StubTransport.query(try XCTUnwrap(stub.requests("GET", path: "/sync/history").first))["limit"], "50")
        XCTAssertEqual(history[1].episode, EpisodeRef(season: 1, episode: 1))
    }

    func testWatchlistShapesAndDates() {
        let flat = AccountWire.parse(#"[{"mediatype":"show","id":5,"added_at":"2026-01-01T00:00:00Z"},{"mediatype":"movie","movie":{"ids":{"tmdb":6}},"listed_at":"2026-02-01T00:00:00Z"},{"type":"tv","show":{"ids":{"tmdb":8}}},{"nothing":1}]"#)
        let entries = KeyedSyncClient.entries(try! XCTUnwrap(flat), dateKeys: ["watchlist_at", "listed_at", "added_at"])
        XCTAssertEqual(entries.map { $0.key }, [MediaKey(type: .show, tmdbID: 5), MediaKey(type: .movie, tmdbID: 6), MediaKey(type: .show, tmdbID: 8)])
        XCTAssertEqual(entries[0].addedAt, FlowDate.parse("2026-01-01T00:00:00Z"))
        XCTAssertEqual(entries[2].addedAt, Date.distantPast)
        let grouped = AccountWire.parse(#"{"movies":[{"movie":{"ids":{"tmdb":1}}}],"shows":[{"show":{"ids":{"tmdb":2}}}]}"#)
        XCTAssertEqual(KeyedSyncClient.entries(try! XCTUnwrap(grouped), dateKeys: []).map(\.key), [MediaKey(type: .movie, tmdbID: 1), MediaKey(type: .show, tmdbID: 2)])
    }

    func testWatchlistAddNeedsATMDbIDAndPostsIt() async throws {
        let stub = StubTransport().on(nil, "")
        let client = KeyedSyncClient.mdblist(apiKey: "K", http: HTTPClient(transport: stub))
        try await client.setWatchlisted(MediaItem(type: .movie, ids: ExternalIDs(imdb: "tt1"), title: "x"), true)
        XCTAssertTrue(stub.requests.isEmpty, "without a TMDb id there is nothing to send")
        try await client.setWatchlisted(movie, true)
        try await client.setWatchlisted(movie, false)
        XCTAssertEqual(stub.requests.map { $0.url?.path }, ["/watchlist/items/add", "/watchlist/items/remove"])
        XCTAssertEqual(((StubTransport.body(stub.requests[0])["movies"] as? [[String: Any]])?.first)?["tmdb"] as? Int, 603)
    }

    func testMarkWatchedAndScrobble() async throws {
        let stub = StubTransport().on(nil, "")
        let client = KeyedSyncClient.mdblist(apiKey: "K", http: HTTPClient(transport: stub))
        try await client.markWatched(movie, episodes: nil, at: Date(timeIntervalSince1970: 0))
        try await client.markUnwatched(movie, episodes: nil)
        try await client.scrobble(.pause, request: PlaybackRequest(item: movie), percent: 250)
        XCTAssertEqual(stub.requests.map { $0.url?.path }, ["/sync/watched", "/sync/watched/remove", "/scrobble/pause"])
        XCTAssertEqual(StubTransport.body(stub.requests[2])["progress"] as? Double, 100)
        let ids = (StubTransport.body(stub.requests[2])["movie"] as? [String: Any])?["ids"] as? [String: Any]
        XCTAssertEqual(ids?["tmdb"] as? Int, 603)
        XCTAssertEqual(ids?["imdb"] as? String, "tt0133093")
    }

    func testMDBListRatingsListsAndItems() async throws {
        let stub = StubTransport()
        stub.on("GET", "/tmdb/movie/603", json: """
        {"ratings":[{"source":"imdb","value":8.7,"votes":2000000},{"source":"tomatoes","value":83.0},{"source":"popcorn","score":85},{"source":"metacritic","score":73},
                    {"source":"tmdb","value":82},{"source":"letterboxd","value":4.1},{"source":"trakt","score":87},{"source":"other","value":1},{"source":"imdb"}]}
        """)
        stub.on("GET", "/lists/user", json: #"[{"id":5,"name":"Faves","items":12},{"name":"no id"}]"#)
        stub.on("GET", "/lists/5/items", json: #"{"movies":[{"movie":{"ids":{"tmdb":603}}}],"shows":[]}"#)
        let mdb = MDBListClient(apiKey: "K", http: HTTPClient(transport: stub))
        let r = try await mdb.ratings(.movie, tmdbID: 603)
        XCTAssertEqual(r.imdb, 8.7)
        XCTAssertEqual(r.imdbVotes, 2_000_000)
        XCTAssertEqual(r.rottenTomatoes, 83)
        XCTAssertEqual(r.popcorn, 85)
        XCTAssertEqual(r.metacritic, 73)
        XCTAssertEqual(r.tmdb, 8.2, "a 0-100 score becomes 0-10")
        XCTAssertEqual(r.letterboxd, 4.1)
        XCTAssertEqual(r.trakt, 87)
        let lists = try await mdb.myLists()
        XCTAssertEqual(lists, [MDBListClient.UserList(id: 5, name: "Faves", itemCount: 12)])
        let items = try await mdb.listItems(5)
        XCTAssertEqual(items, [MediaKey(type: .movie, tmdbID: 603)])
        XCTAssertEqual(StubTransport.query(try XCTUnwrap(stub.requests("GET", path: "/lists/5/items").first))["limit"], "200")
    }
}
