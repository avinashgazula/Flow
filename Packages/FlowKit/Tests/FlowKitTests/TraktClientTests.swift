import XCTest
@testable import FlowKit

/// Trakt's sync, list and catalogue calls through a scripted transport (sign-in and refresh are in TraktOAuthTests).
final class TraktClientTests: XCTestCase {
    private let movie = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603, imdb: "tt0133093", trakt: 481), title: "The Matrix", releaseDate: FlowDate.parse("1999-03-31"))
    private let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399, tvdb: 121361), title: "Game of Thrones")

    private func client(_ stub: StubTransport, token: OAuthToken? = OAuthToken(accessToken: "AT", expiresAt: Date().addingTimeInterval(3600))) -> TraktClient {
        TraktClient(clientID: "CID", token: token, http: HTTPClient(transport: stub))
    }

    private func everything() -> StubTransport { StubTransport().on(nil, "") }

    func testHeadersCarryTheAPIVersionKeyAndBearerToken() async throws {
        let stub = StubTransport().on("GET", "/users/settings", json: #"{"user":{"username":"alex","name":"Alex","images":{"avatar":{"full":"https://a/x.png"}}}}"#)
        let profile = try await client(stub).profile()
        XCTAssertEqual(profile, UserProfile(username: "alex", displayName: "Alex", avatarURL: URL(string: "https://a/x.png")))
        let r = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(r.value(forHTTPHeaderField: "trakt-api-version"), "2")
        XCTAssertEqual(r.value(forHTTPHeaderField: "trakt-api-key"), "CID")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer AT")
    }

    func testMissingClientIDOrTokenFailsBeforeAnyRequest() async {
        let stub = StubTransport()
        do { _ = try await TraktClient(clientID: "", token: nil, http: HTTPClient(transport: stub)).profile(); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .missingCredential("Trakt client ID"))
        }
        do { _ = try await client(stub, token: nil).profile(); XCTFail("expected an error") } catch { XCTAssertEqual(error as? FlowError, .unauthorized) }
        XCTAssertTrue(stub.requests.isEmpty)
        let signedOut = await client(stub, token: nil).isSignedIn
        XCTAssertFalse(signedOut)
    }

    func testPublicCallsNeedNoToken() async throws {
        let stub = StubTransport().on("GET", "/movies/anticipated", json: #"[{"list_count":5,"movie":{"title":"A","ids":{"tmdb":1}}},{"movie":{"title":"B","ids":{}}}]"#)
        let keys = try await client(stub, token: nil).anticipated(.movie)
        XCTAssertEqual(keys, [MediaKey(type: .movie, tmdbID: 1)])
        XCTAssertNil(stub.requests[0].value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(StubTransport.query(stub.requests[0])["limit"], "40")
    }

    func testPlaybackProgressNewestFirstWithRemoteIDs() async throws {
        let stub = StubTransport().on("GET", "/sync/playback", json: """
        [{"id":11,"progress":12.5,"paused_at":"2026-01-01T10:00:00.000Z","type":"movie","movie":{"title":"M","ids":{"tmdb":603}}},
         {"id":12,"progress":80,"paused_at":"2026-03-01T10:00:00.000Z","type":"episode","show":{"title":"S","ids":{"tmdb":1399}},"episode":{"season":3,"number":9}},
         {"id":13,"progress":5,"paused_at":"2026-02-01T10:00:00.000Z","type":"movie","movie":{"title":"No TMDb","ids":{"imdb":"tt1"}}}]
        """)
        let progress = try await client(stub).playbackProgress()
        XCTAssertEqual(progress.map(\.remoteID), ["12", "11"])
        XCTAssertEqual(progress[0].episode, EpisodeRef(season: 3, episode: 9))
        XCTAssertEqual(progress[0].key, MediaKey(type: .show, tmdbID: 1399))
        XCTAssertEqual(progress[1].percent, 12.5)
        XCTAssertEqual(StubTransport.query(stub.requests[0])["limit"], "100")
    }

    func testRemovingResumePointsAndHistoryRequests() async throws {
        let stub = everything()
        let trakt = client(stub)
        try await trakt.removePlaybackProgress(PlaybackProgress(key: MediaKey(type: .movie, tmdbID: 1), percent: 3))
        XCTAssertTrue(stub.requests.isEmpty)
        try await trakt.removePlaybackProgress(PlaybackProgress(key: MediaKey(type: .movie, tmdbID: 1), percent: 3, remoteID: "11"))
        XCTAssertEqual(stub.requests[0].httpMethod, "DELETE")
        XCTAssertEqual(stub.requests[0].url?.path, "/sync/playback/11")
    }

    func testHistoryAndWatchedDecode() async throws {
        let stub = StubTransport()
        stub.on("GET", "/sync/history", json: """
        [{"id":1,"watched_at":"2026-04-01T20:00:00.000Z","type":"episode","show":{"title":"S","ids":{"tmdb":1399}},"episode":{"season":1,"number":2}},
         {"id":2,"watched_at":"2026-03-01T20:00:00.000Z","type":"movie","movie":{"title":"M","ids":{"tmdb":603}}},
         {"id":3,"watched_at":"2026-02-01T20:00:00.000Z","type":"movie","movie":{"title":"X","ids":{}}}]
        """)
        stub.on("GET", "/sync/watched/movies", json: #"[{"plays":2,"movie":{"ids":{"tmdb":603}}},{"movie":{"ids":{"tmdb":13}}},{"movie":{"ids":{}}}]"#)
        stub.on("GET", "/sync/watched/shows", json: #"[{"last_watched_at":"2026-04-01T20:00:00.000Z","show":{"ids":{"tmdb":1399}},"seasons":[{"number":1,"episodes":[{"number":1},{"number":2}]},{"number":2,"episodes":[{"number":5}]}]},{"show":{"ids":{}}}]"#)
        let trakt = client(stub)
        let history = try await trakt.history(limit: 25)
        XCTAssertEqual(history.map(\.remoteID), ["1", "2"])
        XCTAssertEqual(history[0].episode, EpisodeRef(season: 1, episode: 2))
        XCTAssertEqual(history[0].watchedAt, FlowDate.parse("2026-04-01T20:00:00.000Z"))
        XCTAssertEqual(StubTransport.query(stub.requests[0])["limit"], "25")
        let movies = try await trakt.watchedMovies()
        XCTAssertEqual(movies, [603, 13])
        let shows = try await trakt.watchedShows()
        XCTAssertEqual(shows.count, 1)
        XCTAssertEqual(shows[0].watched, [EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 1, episode: 2), EpisodeRef(season: 2, episode: 5)])
        XCTAssertEqual(shows[0].lastWatchedAt, FlowDate.parse("2026-04-01T20:00:00.000Z"))
    }

    func testMarkingWatchedBodies() async throws {
        let stub = everything()
        let trakt = client(stub)
        let when = Date(timeIntervalSince1970: 1_700_000_000)
        try await trakt.markWatched(movie, episodes: nil, at: when)
        try await trakt.markWatched(show, episodes: [EpisodeRef(season: 2, episode: 1), EpisodeRef(season: 1, episode: 2), EpisodeRef(season: 1, episode: 1)], at: when)
        try await trakt.markWatched(show, episodes: nil, at: when)
        try await trakt.markUnwatched(movie, episodes: nil)

        let m = try XCTUnwrap((StubTransport.body(stub.requests[0])["movies"] as? [[String: Any]])?.first)
        XCTAssertEqual((m["ids"] as? [String: Any])?["tmdb"] as? Int, 603)
        XCTAssertEqual((m["ids"] as? [String: Any])?["trakt"] as? Int, 481)
        XCTAssertNotNil(m["watched_at"])
        let s = try XCTUnwrap((StubTransport.body(stub.requests[1])["shows"] as? [[String: Any]])?.first)
        let seasons = try XCTUnwrap(s["seasons"] as? [[String: Any]])
        XCTAssertEqual(seasons.map { $0["number"] as? Int }, [1, 2])
        XCTAssertEqual((seasons[0]["episodes"] as? [[String: Any]])?.map { $0["number"] as? Int }, [1, 2])
        XCTAssertNil(s["watched_at"], "per-episode times are on the episodes")
        let whole = try XCTUnwrap((StubTransport.body(stub.requests[2])["shows"] as? [[String: Any]])?.first)
        XCTAssertNil(whole["seasons"])
        XCTAssertNotNil(whole["watched_at"])
        XCTAssertEqual(stub.requests[3].url?.path, "/sync/history/remove")
        XCTAssertNil(((StubTransport.body(stub.requests[3])["movies"] as? [[String: Any]])?.first)?["watched_at"])
    }

    func testScrobbleShapesAndClamping() async throws {
        let stub = everything()
        let trakt = client(stub)
        try await trakt.scrobble(.start, request: PlaybackRequest(item: movie), percent: -3)
        try await trakt.scrobble(.stop, request: PlaybackRequest(item: show, episode: Episode(showTMDB: 1399, season: 1, number: 2, title: "x")), percent: 120)
        XCTAssertEqual(stub.requests[0].url?.path, "/scrobble/start")
        XCTAssertEqual(StubTransport.body(stub.requests[0])["progress"] as? Double, 0)
        XCTAssertEqual(((StubTransport.body(stub.requests[0])["movie"] as? [String: Any])?["title"] as? String), "The Matrix")
        XCTAssertEqual(((StubTransport.body(stub.requests[0])["movie"] as? [String: Any])?["year"] as? Int), 1999)
        let b = StubTransport.body(stub.requests[1])
        XCTAssertEqual(b["progress"] as? Double, 100)
        XCTAssertEqual((b["episode"] as? [String: Any])?["number"] as? Int, 2)
        XCTAssertNotNil(b["show"])
    }

    func testListsFavouritesAndTheirEdits() async throws {
        let stub = everything()
        stub.on("GET", "/sync/watchlist", json: #"[{"listed_at":"2026-01-01T00:00:00.000Z","type":"movie","movie":{"ids":{"tmdb":1}}},{"listed_at":"2026-05-01T00:00:00.000Z","type":"show","show":{"ids":{"tmdb":2}}},{"type":"season"}]"#)
        stub.on("GET", "/sync/favorites", json: #"[{"listed_at":"2026-01-01T00:00:00.000Z","type":"movie","movie":{"ids":{"tmdb":7}}}]"#)
        let trakt = client(stub)
        let list = try await trakt.watchlist()
        XCTAssertEqual(list.map(\.key), [MediaKey(type: .show, tmdbID: 2), MediaKey(type: .movie, tmdbID: 1)])
        let faves = try await trakt.favourites()
        XCTAssertEqual(faves.map(\.key), [MediaKey(type: .movie, tmdbID: 7)])
        try await trakt.setWatchlisted(movie, true)
        try await trakt.setWatchlisted(show, false)
        try await trakt.setFavourite(movie, true)
        try await trakt.setFavourite(movie, false)
        let paths = stub.requests.dropFirst(2).map { $0.url?.path }
        XCTAssertEqual(paths, ["/sync/watchlist", "/sync/watchlist/remove", "/sync/favorites", "/sync/favorites/remove"])
        XCTAssertNotNil(StubTransport.body(stub.requests[2])["movies"])
        XCTAssertNotNil(StubTransport.body(stub.requests[3])["shows"])
    }

    func testCatalogueCalls() async throws {
        let stub = StubTransport()
        stub.on("GET", "/users/me/lists", json: #"[{"name":"Faves","ids":{"slug":"faves"},"item_count":3}]"#)
        stub.on("GET", "/users/alex/lists/faves/items", json: #"[{"type":"movie","movie":{"ids":{"tmdb":5}}},{"type":"show","show":{"ids":{"tmdb":6}}},{"type":"person"}]"#)
        stub.on("GET", "/recommendations/shows", json: #"[{"title":"A","ids":{"tmdb":9}},{"title":"B","ids":{}}]"#)
        stub.on("GET", "/movies/481/ratings", json: #"{"rating":8.2467,"votes":1}"#)
        stub.on("GET", "/movies/nothing/ratings", json: "{}")
        let trakt = client(stub)
        let lists = try await trakt.myLists()
        XCTAssertEqual(lists.first?.ids.slug, "faves")
        XCTAssertEqual(lists.first?.item_count, 3)
        let items = try await trakt.listItems(user: "alex", slug: "faves")
        XCTAssertEqual(items, [MediaKey(type: .movie, tmdbID: 5), MediaKey(type: .show, tmdbID: 6)])
        let recs = try await trakt.recommendations(.show)
        XCTAssertEqual(recs, [MediaKey(type: .show, tmdbID: 9)])
        XCTAssertEqual(StubTransport.query(try XCTUnwrap(stub.requests("GET", path: "/recommendations/shows").first))["ignore_collected"], "true")
        let rating = try await trakt.rating(.movie, id: "481")
        XCTAssertEqual(rating, 82)
        let none = try await trakt.rating(.movie, id: "nothing")
        XCTAssertNil(none)
    }

    func testPublicListsReadWithoutSigningIn() async throws {
        let stub = StubTransport().on("GET", "/users/someone/lists/top/items", json: #"[{"type":"movie","movie":{"ids":{"tmdb":5}}}]"#)
        let items = try await client(stub, token: nil).listItems(user: "someone", slug: "top")
        XCTAssertEqual(items.count, 1)
        XCTAssertNil(stub.requests[0].value(forHTTPHeaderField: "Authorization"))
    }

    func testCommentsBecomeReviewsAndDropEmptyOnes() async throws {
        let stub = StubTransport().on("GET", "/shows/game-of-thrones/comments/likes", json: """
        [{"id":1,"comment":"A fine show.","spoiler":true,"created_at":"2026-01-01T00:00:00.000Z","user":{"username":"ann"},"user_stats":{"rating":9}},
         {"id":2,"comment":"   ","user":{"username":"bob"}},
         {"id":3,"comment":"Short.","user_rating":7.6}]
        """)
        let reviews = try await client(stub).comments(.show, id: "game-of-thrones")
        XCTAssertEqual(reviews.map(\.id), ["trakt:1", "trakt:3"])
        XCTAssertEqual(reviews[0].author, "ann")
        XCTAssertEqual(reviews[0].rating, 9)
        XCTAssertTrue(reviews[0].spoiler)
        XCTAssertEqual(reviews[1].author, "Anonymous")
        XCTAssertEqual(reviews[1].rating, 8)
    }

    func testEpisodesFromSeasons() async throws {
        let stub = StubTransport().on("GET", "/shows/121361/seasons", json: """
        [{"number":1,"episodes":[{"season":1,"number":1,"title":"Winter Is Coming","overview":"Ned.","first_aired":"2011-04-18T01:00:00.000Z","runtime":62,"ids":{"tvdb":3254641,"imdb":"tt1480055"}},{"season":1,"number":2}]},{"number":2}]
        """)
        let episodes = try await client(stub, token: nil).episodes(showID: "121361", showTMDB: 1399)
        XCTAssertEqual(episodes.map(\.number), [1, 2])
        XCTAssertEqual(episodes[0].ids.tvdb, 3254641)
        XCTAssertEqual(episodes[0].runtimeMinutes, 62)
        XCTAssertEqual(episodes[1].title, "Episode 2")
        XCTAssertEqual(StubTransport.query(stub.requests[0])["extended"], "episodes,full")
    }

    func testRatingsClampAndRemove() async throws {
        let stub = everything()
        let trakt = client(stub)
        try await trakt.rate(movie, rating: 0)
        try await trakt.rate(show, rating: 12)
        try await trakt.rate(movie, rating: nil)
        XCTAssertEqual(((StubTransport.body(stub.requests[0])["movies"] as? [[String: Any]])?.first)?["rating"] as? Int, 1)
        XCTAssertEqual(((StubTransport.body(stub.requests[1])["shows"] as? [[String: Any]])?.first)?["rating"] as? Int, 10)
        XCTAssertEqual(stub.requests[2].url?.path, "/sync/ratings/remove")
    }

    func testSignOutRevokesTheTokenAndForgetsIt() async {
        final class Box: @unchecked Sendable { var cleared = false }
        let box = Box()
        let stub = everything()
        let trakt = TraktClient(clientID: "CID", clientSecret: "SECRET", token: OAuthToken(accessToken: "AT"), http: HTTPClient(transport: stub), onTokenChange: { box.cleared = $0 == nil })
        await trakt.signOut()
        let signedIn = await trakt.isSignedIn
        XCTAssertFalse(signedIn)
        XCTAssertTrue(box.cleared)
        let revoke = stub.requests("POST", path: "/oauth/revoke").first
        XCTAssertEqual(revoke.map(StubTransport.body)?["token"] as? String, "AT")
        XCTAssertEqual(revoke.map(StubTransport.body)?["client_id"] as? String, "CID")
        XCTAssertEqual(revoke.map(StubTransport.body)?["client_secret"] as? String, "SECRET")
    }

    func testServerErrorsMapToFlowErrors() async {
        for (status, expected) in [(401, FlowError.unauthorized), (404, .notFound), (429, .rateLimited(retryAfter: nil))] {
            let stub = StubTransport().on("GET", "/users/settings", status: status, json: "")
            do { _ = try await client(stub).profile(); XCTFail("expected an error") } catch { XCTAssertEqual(error as? FlowError, expected) }
        }
    }
}
