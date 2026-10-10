import XCTest
@testable import FlowKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Returns canned responses keyed by URL path and records requests.
final class MockTransport: HTTPTransport, @unchecked Sendable {
    var routes: [String: (Int, String)] = [:]
    private(set) var requests: [URLRequest] = []
    private let lock = NSLock()

    private func record(_ request: URLRequest) -> (Int, String) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        let path = request.url?.path ?? ""
        return routes.first { path.hasSuffix($0.key) }?.value ?? (404, "{}")
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let route = record(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: route.0, httpVersion: nil, headerFields: nil)!
        return (Data(route.1.utf8), response)
    }
}

final class TMDBTests: XCTestCase {
    func testTrendingDecodingAndAuthStyle() async throws {
        let mock = MockTransport()
        mock.routes["/trending/movie/week"] = (200, """
        {"page":1,"total_pages":3,"results":[{"id":603,"title":"The Matrix","overview":"Neo","poster_path":"/p.jpg","release_date":"1999-03-31","vote_average":8.2,"genre_ids":[28,878]}]}
        """)
        let client = TMDBClient(credential: "0123456789abcdef0123456789abcdef", http: HTTPClient(transport: mock))
        let page = try await client.trending(.movie)
        XCTAssertEqual(page.items.first?.title, "The Matrix")
        XCTAssertEqual(page.items.first?.year, 1999)
        XCTAssertEqual(page.items.first?.genres.map(\.name), ["Action", "Science Fiction"])
        XCTAssertTrue(page.hasMore)
        XCTAssertTrue(mock.requests[0].url!.query!.contains("api_key=0123456789abcdef0123456789abcdef"))

        let bearer = TMDBClient(credential: String(repeating: "x", count: 200), http: HTTPClient(transport: mock))
        _ = try await bearer.trending(.movie)
        XCTAssertEqual(mock.requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer " + String(repeating: "x", count: 200))
    }

    func testMovieDetailsCertificationLogoAndHomeRelease() async throws {
        let mock = MockTransport()
        mock.routes["/movie/1"] = (200, """
        {"id":1,"title":"Resident Evil","runtime":95,"release_date":"2026-09-18","genres":[{"id":27,"name":"Horror"}],"imdb_id":"tt1",
         "credits":{"cast":[{"id":10,"name":"Austin Abrams","character":"Bryan","order":0}],"crew":[{"id":11,"name":"Zach Cregger","job":"Director"}]},
         "videos":{"results":[{"id":"v1","name":"Teaser","key":"k1","site":"YouTube","type":"Teaser","official":true},{"id":"v2","name":"Official Trailer","key":"k2","site":"YouTube","type":"Trailer","official":true}]},
         "release_dates":{"results":[{"iso_3166_1":"CA","release_dates":[{"certification":"18A","release_date":"2026-09-18T00:00:00.000Z","type":3}]},{"iso_3166_1":"US","release_dates":[{"certification":"R","release_date":"2026-10-07T00:00:00.000Z","type":4}]}]},
         "images":{"logos":[{"file_path":"/fr.png","iso_639_1":"fr","vote_average":9},{"file_path":"/en.png","iso_639_1":"en","vote_average":5}]},
         "recommendations":{"results":[]},"similar":{"results":[]},
         "keywords":{"keywords":[{"id":9663,"name":"sequel"},{"id":179430,"name":"aftercreditsstinger"}]}}
        """)
        let client = TMDBClient(credential: "0123456789abcdef0123456789abcdef", region: "CA", http: HTTPClient(transport: mock))
        let detail = try await client.details(.movie, id: 1)
        XCTAssertEqual(detail.creditsScenes, CreditsScenes(duringCredits: false, afterCredits: true))
        XCTAssertEqual(detail.creditsScenes?.alert, "Stay until the end: there's a scene after the credits.")
        XCTAssertEqual(detail.item.certification, "18A")
        XCTAssertEqual(detail.item.logoPath, "/en.png")
        XCTAssertEqual(detail.item.runtimeMinutes, 95)
        XCTAssertEqual(detail.item.homeReleaseDate, FlowDate.parse("2026-10-07T00:00:00.000Z"))
        XCTAssertEqual(detail.castRow.map(\.name), ["Zach Cregger", "Austin Abrams"])
        XCTAssertEqual(detail.trailers.first?.key, "k2")
    }

    func testDiscoverParametersForFutureWindow() {
        let client = TMDBClient(credential: "k")
        var q = DiscoverQuery(type: .show)
        q.genres = [16, 35]
        q.releasedFromDays = 0
        q.releasedToDays = 30
        q.sort = .newest
        let now = FlowDate.parse("2026-10-09")!
        let p = client.discoverParameters(q, page: 2, now: now)
        XCTAssertEqual(p["with_genres"] ?? nil, "16,35")
        XCTAssertEqual(p["first_air_date.gte"] ?? nil, "2026-10-09")
        XCTAssertEqual(p["first_air_date.lte"] ?? nil, "2026-11-08")
        XCTAssertEqual(p["sort_by"] ?? nil, "first_air_date.desc")
        XCTAssertTrue(q.targetsFuture)
    }
}

final class TrackingTests: XCTestCase {
    func testTraktPlaybackAndWatched() async throws {
        let mock = MockTransport()
        mock.routes["/sync/playback"] = (200, """
        [{"id":13,"progress":55.5,"paused_at":"2026-10-08T21:00:00.000Z","type":"episode","episode":{"season":4,"number":1,"title":"x","ids":{"trakt":1}},"show":{"title":"Only Murders","ids":{"trakt":2,"tmdb":107113}}},
         {"id":14,"progress":40,"paused_at":"2026-10-09T01:00:00.000Z","type":"movie","movie":{"title":"Jurassic World Rebirth","ids":{"tmdb":1234821}}}]
        """)
        mock.routes["/sync/watched/shows"] = (200, """
        [{"last_watched_at":"2026-10-01T00:00:00.000Z","show":{"ids":{"tmdb":107113}},"seasons":[{"number":1,"episodes":[{"number":1},{"number":2}]}]}]
        """)
        let trakt = TraktClient(clientID: "id", clientSecret: "secret", token: OAuthToken(accessToken: "tok"), http: HTTPClient(transport: mock))
        let progress = try await trakt.playbackProgress()
        XCTAssertEqual(progress.count, 2)
        XCTAssertEqual(progress[0].key, MediaKey(type: .movie, tmdbID: 1234821))
        XCTAssertEqual(progress[1].episode, EpisodeRef(season: 4, episode: 1))
        XCTAssertEqual(progress[1].remoteID, "13")
        XCTAssertEqual(mock.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(mock.requests[0].value(forHTTPHeaderField: "trakt-api-key"), "id")

        let shows = try await trakt.watchedShows()
        XCTAssertEqual(shows.first?.watched.count, 2)
    }

    func testTraktSyncBodyGroupsEpisodesBySeason() throws {
        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1), title: "S")
        let body = TraktClient.syncBody(show, episodes: [EpisodeRef(season: 2, episode: 1), EpisodeRef(season: 1, episode: 3), EpisodeRef(season: 1, episode: 1)], at: nil)
        let json = String(decoding: try JSONEncoder.flow.encode(body), as: UTF8.self)
        XCTAssertEqual(json, #"{"movies":[],"shows":[{"ids":{"tmdb":1},"seasons":[{"episodes":[{"number":1},{"number":3}],"number":1},{"episodes":[{"number":1}],"number":2}]}]}"#)
    }

    func testNextUpAndContinueWatching() {
        let key = MediaKey(type: .show, tmdbID: 1)
        let state = ShowWatchState(key: key, watched: [EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 1, episode: 2)])
        let aired = [EpisodeRef(season: 0, episode: 1), EpisodeRef(season: 1, episode: 1), EpisodeRef(season: 1, episode: 2), EpisodeRef(season: 1, episode: 3), EpisodeRef(season: 2, episode: 1)]
        XCTAssertEqual(state.nextUp(aired: aired), EpisodeRef(season: 1, episode: 3))
        XCTAssertEqual(ShowWatchState(key: key).nextUp(aired: aired), EpisodeRef(season: 1, episode: 1))

        let movie = MediaKey(type: .movie, tmdbID: 2)
        let entries = ContinueWatchingBuilder.build(
            progress: [PlaybackProgress(key: movie, percent: 50, updatedAt: Date(timeIntervalSince1970: 100)),
                       PlaybackProgress(key: MediaKey(type: .movie, tmdbID: 3), percent: 95, updatedAt: Date(timeIntervalSince1970: 300))],
            nextUp: [(key, EpisodeRef(season: 1, episode: 3), Date(timeIntervalSince1970: 200))]
        )
        XCTAssertEqual(entries.map(\.key), [key, movie])
        XCTAssertTrue(entries[0].isNextUp)
    }

    func testLocalTrackerFlows() async throws {
        let saved = SavedBox()
        let tracker = LocalTracker(library: LocalLibrary()) { saved.value = $0 }
        let movie = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 5), title: "M")
        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 6), title: "S")
        try await tracker.scrobble(.pause, request: PlaybackRequest(item: movie), percent: 40)
        let progressAfterPause = try await tracker.playbackProgress()
        XCTAssertEqual(progressAfterPause.first?.percent, 40)
        try await tracker.scrobble(.stop, request: PlaybackRequest(item: movie), percent: 95)
        let progressAfterStop = try await tracker.playbackProgress()
        XCTAssertTrue(progressAfterStop.isEmpty)
        let watchedMovies = try await tracker.watchedMovies()
        XCTAssertEqual(watchedMovies, [5])

        try await tracker.markWatched(show, episodes: [EpisodeRef(season: 1, episode: 1)], at: Date())
        let shows = try await tracker.watchedShows()
        XCTAssertEqual(shows.first?.watched, [EpisodeRef(season: 1, episode: 1)])

        try await tracker.setWatchlisted(show, true)
        let list = try await tracker.watchlist()
        XCTAssertEqual(list.map(\.key), [show.key!])
        XCTAssertEqual(saved.value?.items[show.key!.description]?.title, "S")

        let pool = (1...4).map { EpisodeRef(season: 1, episode: $0) }
        var picked = Set<EpisodeRef>()
        for _ in 0..<4 { if let p = await tracker.nextShuffle(for: show.key!, from: pool) { picked.insert(p) } }
        XCTAssertEqual(picked.count, 4, "shuffle should not repeat within a cycle")
    }

    func testMDBListRatingsParsing() throws {
        let json = try JSONDecoder().decode(JSONValue.self, from: Data("""
        {"ratings":[{"source":"imdb","value":7.6,"votes":1000},{"source":"tomatoes","value":96},{"source":"popcorn","value":91},{"source":"metacritic","value":79},{"source":"tmdb","value":73},{"source":"letterboxd","value":3.8},{"source":"trakt","value":77},{"source":"rogerebert","value":null}]}
        """.utf8))
        let r = MDBListClient.parseRatings(json)
        XCTAssertEqual(r.imdb, 7.6)
        XCTAssertEqual(r.rottenTomatoes, 96)
        XCTAssertEqual(r.popcorn, 91)
        XCTAssertEqual(r.metacritic, 79)
        XCTAssertEqual(r.tmdb, 7.3)
        XCTAssertEqual(r.letterboxd, 3.8)
        XCTAssertEqual(r.trakt, 77)
    }
}

final class SavedBox: @unchecked Sendable { var value: LocalLibrary? }

final class SourceProviderTests: XCTestCase {
    func testAddonStreams() async throws {
        let mock = MockTransport()
        mock.routes["/stream/series/tt0944947:1:2.json"] = (200, """
        {"streams":[
          {"name":"AIOStreams\\n1080p","description":"🧿 1080p\\nWEB-DL\\n🔊 AAC\\n📦 3.98 GB\\n🌎 English","url":"https://cdn.example/a.mp4","behaviorHints":{"filename":"Show.S01E02.1080p.WEB-DL.mkv","videoSize":4273492541,"bingeGroup":"aio|1080p"}},
          {"name":"Torrent","title":"4K","infoHash":"abc","fileIdx":1},
          {"name":"Empty"}
        ]}
        """)
        let config = AddonConfig(manifestURL: URL(string: "https://aio.example/u/abc/manifest.json")!, name: "AIOStreams")
        XCTAssertEqual(config.baseURL.absoluteString, "https://aio.example/u/abc")
        let client = AddonClient(config: config, http: HTTPClient(transport: mock))
        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1399, imdb: "tt0944947"), title: "GoT")
        let episode = Episode(showTMDB: 1399, season: 1, number: 2, title: "x")
        let sources = try await client.sources(for: PlaybackRequest(item: show, episode: episode))
        XCTAssertEqual(sources.count, 2)
        XCTAssertEqual(sources[0].traits.resolution, .hd1080)
        XCTAssertEqual(sources[0].traits.sizeBytes, 4273492541)
        XCTAssertEqual(sources[0].bingeGroup, "aio|1080p")
        XCTAssertTrue(sources[0].isPlayable)
        XCTAssertFalse(sources[1].isPlayable)
    }

    func testManifestResourceMatching() throws {
        let manifest = try JSONDecoder().decode(AddonManifest.self, from: Data("""
        {"id":"x","name":"X","types":["movie","series"],"resources":["catalog",{"name":"stream","types":["movie","series"],"idPrefixes":["tt"]}]}
        """.utf8))
        XCTAssertTrue(manifest.servesStreams(type: "movie", id: "tt123"))
        XCTAssertFalse(manifest.servesStreams(type: "movie", id: "kitsu:1"))
        XCTAssertFalse(manifest.servesStreams(type: "tv", id: "tt123"))
    }

    func testAggregatorTimesOutSlowProviders() async {
        struct Fast: SourceProvider {
            var providerID = "fast", providerName = "Fast", category = SourceCategory.addons
            func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
                [StreamSource(id: "f", category: .addons, providerID: "fast", providerName: "Fast", title: "x", location: .url(URL(string: "https://a")!, headers: [:]))]
            }
        }
        struct Slow: SourceProvider {
            var providerID = "slow", providerName = "Slow", category = SourceCategory.addons
            func sources(for request: PlaybackRequest) async throws -> [StreamSource] {
                try await Task.sleep(nanoseconds: 5_000_000_000)
                return []
            }
        }
        let request = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1, imdb: "tt1"), title: "x"))
        var failed: [String] = []
        var loaded: [String] = []
        for await update in SourceAggregator.stream([Fast(), Slow()], request: request, timeout: 0.3) {
            switch update {
            case .loaded(let id, _): loaded.append(id)
            case .failed(let id, _, _): failed.append(id)
            default: break
            }
        }
        XCTAssertEqual(loaded, ["fast"])
        XCTAssertEqual(failed, ["slow"])
    }

    func testIPTVTitleMatching() {
        let item = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 603), title: "The Matrix", releaseDate: FlowDate.parse("1999-03-31"))
        XCTAssertTrue(IPTVVODProvider.matches(name: "EN - The Matrix (1999)", year: nil, tmdb: nil, item: item))
        XCTAssertTrue(IPTVVODProvider.matches(name: "Anything", year: nil, tmdb: 603, item: item))
        XCTAssertFalse(IPTVVODProvider.matches(name: "The Matrix (2021)", year: nil, tmdb: nil, item: item))
    }

    func testSkipSegmentParsing() throws {
        let json = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"segments":[{"type":"intro","start":30,"end":90},{"segment_type":"credits","start_ms":2500000,"end_ms":2600000},{"type":"unknown","start":1,"end":2}]}"#.utf8))
        let segments = KeyedSegmentsClient.parse(json)
        XCTAssertEqual(segments, [SkipSegment(kind: .intro, start: 30, end: 90), SkipSegment(kind: .credits, start: 2500, end: 2600)])
        XCTAssertEqual(SkipSegmentResolver.active(segments, at: 45)?.kind, .intro)
        XCTAssertNil(SkipSegmentResolver.active(segments, at: 95))
    }
}

final class ReleaseFilterTests: XCTestCase {
    let now = FlowDate.parse("2026-10-09")!

    func testQuickDecisions() {
        let future = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1), title: "F", releaseDate: FlowDate.parse("2026-12-01"))
        let old = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 2), title: "O", releaseDate: FlowDate.parse("2020-01-01"))
        let recent = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 3), title: "R", releaseDate: FlowDate.parse("2026-09-20"))
        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 4), title: "S", releaseDate: FlowDate.parse("2026-10-01"))
        XCTAssertEqual(ReleaseFilter.quickDecision(future, now: now), false)
        XCTAssertEqual(ReleaseFilter.quickDecision(old, now: now), true)
        XCTAssertNil(ReleaseFilter.quickDecision(recent, now: now))
        XCTAssertEqual(ReleaseFilter.quickDecision(show, now: now), true)
    }

    func testCinemaOnlyMovieIsDropped() async {
        let cinemaOnly = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 10), title: "Cinema", releaseDate: FlowDate.parse("2026-09-20"))
        let digital = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 11), title: "Digital", releaseDate: FlowDate.parse("2026-09-01"))
        let filter = ReleaseFilter { id in
            if id == 10 { return [MovieRelease(country: "US", type: .theatrical, date: FlowDate.parse("2026-09-20")!)] }
            return [MovieRelease(country: "US", type: .digital, date: FlowDate.parse("2026-10-01")!)]
        }
        let kept = await filter.filter([cinemaOnly, digital], now: now)
        XCTAssertEqual(kept.map(\.title), ["Digital"])
    }
    func testNextPartOfACollection() {
        func film(_ id: Int, _ date: String?) -> MediaItem {
            MediaItem(type: .movie, ids: ExternalIDs(tmdb: id), title: "\(id)", releaseDate: date.flatMap(FlowDate.parse))
        }
        let one = film(1, "2021-10-22"), two = film(2, "2024-03-01"), three = film(3, "2027-12-18"), undated = film(4, nil)
        // Parts arrive in any order; the next one is the earliest released after this film.
        let collection = MediaCollection(id: 9, name: "Dune", parts: [three, undated, two, one])
        XCTAssertEqual(collection.part(after: one, now: now)?.id, two.id)
        // Part Three isn't out yet, so nothing follows Part Two.
        XCTAssertNil(collection.part(after: two, now: now))
        XCTAssertNil(collection.part(after: undated, now: now))
    }
}

final class SyncTests: XCTestCase {
    func testSettingsDecodeFillsMissingKeys() throws {
        let json = #"{"general":{"accent":"red"},"metadata":{"episodeSource":"tmdb"},"futureKey":true}"#
        let settings = try SettingsCodec.decode(AppSettings.self, from: Data(json.utf8), defaults: AppSettings())
        XCTAssertEqual(settings.general.accent, .red)
        XCTAssertEqual(settings.general.startTab, .home)
        XCTAssertEqual(settings.metadata.episodeSource, .tmdb)
        XCTAssertTrue(settings.metadata.showUnreleasedTitles)
        XCTAssertEqual(settings.shelves, ShelfConfig.defaults)
    }

    func testSettingsRoundTrip() throws {
        var s = AppSettings()
        s.shelves.append(ShelfConfig(title: "Anime", source: .discover({ var q = DiscoverQuery(type: .show); q.genres = [16]; return q }())))
        s.sources.addons = [AddonConfig(manifestURL: URL(string: "https://a/manifest.json")!, name: "A")]
        s.sources.providerOrder["mediaServers"] = ["b", "a"]
        let data = try SettingsCodec.encode(s)
        XCTAssertEqual(try SettingsCodec.decode(AppSettings.self, from: data, defaults: AppSettings()), s)
    }

    func testSetupShareStripsSecretsAndImportsLink() throws {
        var s = AppSettings()
        s.mediaServers.servers = [MediaServerConfig(id: "srv", kind: .jellyfin, name: "J", baseURL: URL(string: "https://j")!, userID: "u", accessToken: "secret")]
        var creds = Credentials()
        creds.tmdbAPIKey = "tmdb"
        let data = try SetupShare.export(settings: s, credentials: creds, includeSecrets: false)
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("secret"))
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("tmdbAPIKey"))

        let link = try SetupShare.exportLink(settings: s, credentials: creds, includeSecrets: true)
        XCTAssertTrue(link.hasPrefix("flow://setup?d="))
        let bundle = try SetupShare.importBundle(Data(link.utf8))
        XCTAssertEqual(bundle.credentials?.tmdbAPIKey, "tmdb")
        XCTAssertEqual(bundle.settings.mediaServers.servers.first?.accessToken, "secret")

        // Importing a secret-less bundle keeps the device's existing tokens and keys.
        let stripped = try SetupShare.importBundle(data)
        let (merged, mergedCreds) = SetupShare.apply(stripped, to: s, credentials: creds)
        XCTAssertEqual(merged.mediaServers.servers.first?.accessToken, "secret")
        XCTAssertEqual(mergedCreds.tmdbAPIKey, "tmdb")
    }

    func testCloudPushPullMerge() throws {
        let store = InMemoryKeyValueStore()
        let cloud = CloudSync(store: store)
        var settings = AppSettings()
        settings.general.accent = .purple
        var library = LocalLibrary()
        let key = MediaKey(type: .movie, tmdbID: 1)
        library.progress = [PlaybackProgress(key: key, percent: 20, updatedAt: Date(timeIntervalSince1970: 10))]
        library.watchlist = [ListEntry(key: key)]
        try cloud.push(settings: settings, library: library, includeLibrary: true)
        XCTAssertGreaterThan(cloud.usedBytes, 0)

        var otherDevice = LocalLibrary()
        otherDevice.progress = [PlaybackProgress(key: key, percent: 60, updatedAt: Date(timeIntervalSince1970: 20))]
        let (pulledSettings, merged) = CloudSync.apply(cloud.pull(), settings: AppSettings(), library: otherDevice)
        XCTAssertEqual(pulledSettings.general.accent, .purple)
        XCTAssertEqual(merged.progress.first?.percent, 60, "newest progress wins")
        XCTAssertEqual(merged.watchlist.map(\.key), [key])

        let status = cloud.status(settings: settings, library: library)
        XCTAssertEqual(status.first { $0.domain == .playbackProgress }?.cloudCount, 1)
    }
}

final class SourceSafetyTests: XCTestCase {
    func testRejectsExecutablesAndArchives() {
        XCTAssertTrue(SourceSafety.isUnsafeFileName("Primetime 2026.1080p.HQ Pre.Multi.AAC 2.0.x264.exe"))
        XCTAssertTrue(SourceSafety.isUnsafeFileName("Movie.2026.2160p.mkv.scr"))
        XCTAssertTrue(SourceSafety.isUnsafeFileName("Movie.2026.1080p.WEB-DL.rar"))
        XCTAssertFalse(SourceSafety.isUnsafeFileName("Lanterns.2026.S01E08.1080p.x265-ELiTE.mkv"))
        XCTAssertFalse(SourceSafety.isUnsafeFileName("The Shawshank Redemption"))
        XCTAssertFalse(SourceSafety.isUnsafeFileName("Mr. Robot"))
    }
}

/// Runs only when FLOW_JF_URL, FLOW_JF_USER and FLOW_JF_PASS are set: exercises the Jellyfin client against a real server.
final class LiveJellyfinTests: XCTestCase {
    func testAgainstServer() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let raw = env["FLOW_JF_URL"], let base = URL(string: raw), let user = env["FLOW_JF_USER"], let pass = env["FLOW_JF_PASS"] else {
            throw XCTSkip("no live server")
        }
        let config = try await JellyfinClient.signIn(kind: .jellyfin, baseURL: base, username: user, password: pass, deviceID: "flow-live-test", deviceName: "Flow Tests")
        let client = JellyfinClient(config: config, deviceID: "flow-live-test")
        print("server:", config.name, "remote:", config.isRemote)
        let libraries = try await client.libraries()
        print("libraries:", libraries.map { "\($0.name) (\($0.type.map { "\($0)" } ?? "mixed"))" })
        let catalogue = try await client.catalogue()
        print("catalogue:", catalogue.count, "movies:", catalogue.filter { $0.type == .movie }.count, "shows:", catalogue.filter { $0.type == .show }.count)
        XCTAssertFalse(catalogue.isEmpty, "library-wide listing falls back to per-library queries")
        XCTAssertFalse(catalogue.contains { SourceSafety.isUnsafeFileName($0.title) })
        let recent = try await client.recentlyAdded(limit: 10)
        print("recently added:", recent.map(\.title))
        let found = try await client.search("shawshank")
        print("search:", found.map { "\($0.title) \($0.year.map(String.init) ?? "") \($0.ids.imdb ?? "")" })

        let movie = MediaItem(type: .movie, ids: ExternalIDs(tmdb: 278, imdb: "tt0111161"), title: "The Shawshank Redemption", releaseDate: FlowDate.parse("1994-09-23"))
        let sources = try await client.sources(for: PlaybackRequest(item: movie))
        print("movie sources:", sources.count)
        for s in sources.prefix(9) {
            let host = s.location.playableURL?.host ?? "-"
            print("  ", s.traits.resolution.label, s.traits.hdr, s.traits.audioCodec ?? "-", s.traits.sizeBytes.map { String(format: "%.1f GB", Double($0) / 1e9) } ?? "-", "→", host)
        }
        XCTAssertFalse(sources.isEmpty)

        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 1396, imdb: "tt0903747"), title: "Breaking Bad", releaseDate: FlowDate.parse("2008-01-20"))
        let episode = Episode(showTMDB: 1396, season: 1, number: 1, title: "Pilot")
        let episodeSources = try await client.sources(for: PlaybackRequest(item: show, episode: episode))
        print("episode sources:", episodeSources.count, episodeSources.prefix(3).map { "\($0.traits.resolution.label) → \($0.location.playableURL?.host ?? "-")" })
    }
}

final class JellyfinNamingTests: XCTestCase {
    func testFileNamedItemsGetCleanTitles() {
        let config = MediaServerConfig(kind: .jellyfin, name: "Test", baseURL: URL(string: "https://jf.example")!, userID: "u", accessToken: "t")
        let client = JellyfinClient(config: config, deviceID: "d")
        let named = JellyfinClient.ItemDTO(Id: "1", Name: "Resident Evil (2026) WEBDL-1080p.mp4", kind: "Movie")
        let item = client.serverItem(named)
        XCTAssertEqual(item?.title, "Resident Evil")
        XCTAssertEqual(item?.year, 2026)
        XCTAssertNil(client.serverItem(JellyfinClient.ItemDTO(Id: "2", Name: "Primetime 2026.1080p.HQ Pre.Multi.AAC 2.0.x264.exe", kind: "Movie")))
    }
}

final class PlayableAudioRankingTests: XCTestCase {
    func testSourcesLedByDTSComeLast() {
        func source(_ id: String, _ text: String) -> StreamSource {
            StreamSource(id: id, category: .addons, providerID: "a", providerName: "A", title: text, location: .url(URL(string: "https://x.test/\(id)")!, headers: [:]),
                         traits: StreamParser.parse(text, nil))
        }
        let sources = [
            source("remux", "1080p BLURAY REMUX\nDTS-HD MA • DD\n12.6 GB"),
            source("truehd", "2160p REMUX\nTrueHD Atmos 7.1\n60 GB"),
            source("web", "1080p WEB-DL\nDD+\n6.5 GB"),
            source("aac", "720p WEBRip\nAAC 2.0\n1.2 GB"),
        ]
        var settings = SourceSettings()
        XCTAssertEqual(SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k).map(\.id), ["web", "aac", "remux", "truehd"])
        XCTAssertEqual(SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k, decodesLosslessAudio: true).map(\.id),
                       ["remux", "truehd", "web", "aac"], "Flow decodes DTS and TrueHD itself: no reason to demote them")
        settings.preferPlayableAudio = false
        XCTAssertEqual(SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k).map(\.id), ["remux", "truehd", "web", "aac"])
    }

    func testAV1LastWhereItCantBeDecoded() {
        func source(_ id: String, _ text: String) -> StreamSource {
            StreamSource(id: id, category: .addons, providerID: "a", providerName: "A", title: text, location: .url(URL(string: "https://x.test/\(id)")!, headers: [:]),
                         traits: StreamParser.parse(text, nil))
        }
        let sources = [source("av1", "2160p WEB-DL AV1\nOpus"), source("hevc", "2160p WEB-DL HEVC\nDD+"), source("h264", "1080p WEB-DL x264\nAAC")]
        let settings = SourceSettings()
        XCTAssertEqual(SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k).map(\.id), ["av1", "hevc", "h264"])
        XCTAssertEqual(SourceRanker.rank(sources, settings: settings, resolutionCap: .uhd4k, decodesAV1: false).map(\.id), ["hevc", "h264", "av1"])
    }
}

final class ChapterSkipTests: XCTestCase {
    func testAnimeChapters() {
        let chapters: [(title: String, start: Double)] = [("Prologue", 0), ("Opening", 95), ("Part A", 185), ("Part B", 800), ("Ending", 1290), ("Preview", 1380)]
        let segments = SkipSegmentResolver.fromChapters(chapters, duration: 1420)
        XCTAssertEqual(segments.map(\.kind), [.intro, .credits, .preview])
        XCTAssertEqual(segments.first?.start, 95)
        XCTAssertEqual(segments.first?.end, 185)
        XCTAssertEqual(segments.last?.end, 1420)
    }

    func testNamesAndLimits() {
        XCTAssertEqual(SkipSegmentResolver.kind(ofChapter: "Opening Credits"), .intro)
        XCTAssertEqual(SkipSegmentResolver.kind(ofChapter: "End Credits"), .credits)
        XCTAssertEqual(SkipSegmentResolver.kind(ofChapter: "Previously on..."), .recap)
        XCTAssertEqual(SkipSegmentResolver.kind(ofChapter: "OP"), .intro)
        XCTAssertNil(SkipSegmentResolver.kind(ofChapter: "Introduction"))
        XCTAssertNil(SkipSegmentResolver.kind(ofChapter: "Chapter 02"))
        // An "intro" chapter half an hour long is a mislabelled chapter, not an intro.
        XCTAssertTrue(SkipSegmentResolver.fromChapters([("Intro", 0), ("Main", 1800)], duration: 3600).isEmpty)
    }
}

final class LiveStreamURLTests: XCTestCase {
    func testCandidates() {
        let ts = URL(string: "http://panel.test:8080/live/user/pass/1234.ts?token=x")!
        XCTAssertEqual(LiveStreamURL.candidates(for: ts).map(\.absoluteString),
                       ["http://panel.test:8080/live/user/pass/1234.m3u8?token=x", ts.absoluteString])
        let bare = URL(string: "http://panel.test:8080/user/pass/1234")!
        XCTAssertEqual(LiveStreamURL.candidates(for: bare).map(\.absoluteString), [bare.absoluteString, bare.absoluteString + ".m3u8"])
        let hls = URL(string: "https://cdn.test/channel/index.m3u8")!
        XCTAssertEqual(LiveStreamURL.candidates(for: hls), [hls])
        let page = URL(string: "https://cdn.test/watch")!
        XCTAssertEqual(LiveStreamURL.candidates(for: page), [page])
    }
}

final class ExternalPlayerTests: XCTestCase {
    let stream = URL(string: "https://cdn.test/play/Movie (2024).mkv?token=a&b=1")!

    func testLinksMatchWhatEachAppExpects() {
        // The stream URL already has %20 for the space; as a query value that becomes %2520.
        let encoded = "https%3A%2F%2Fcdn.test%2Fplay%2FMovie%2520(2024).mkv%3Ftoken%3Da%26b%3D1"
        XCTAssertEqual(ExternalPlayer.infuse.launchURL(for: stream)?.absoluteString, "infuse://x-callback-url/play?url=\(encoded)")
        XCTAssertEqual(ExternalPlayer.infuse.launchURL(for: stream, position: 754.6, filename: "Movie (2024).mkv")?.absoluteString,
                       "infuse://x-callback-url/play?url=\(encoded)&position=754&filename=Movie%20(2024).mkv")
        XCTAssertEqual(ExternalPlayer.vlc.launchURL(for: stream)?.absoluteString, "vlc-x-callback://x-callback-url/stream?url=\(encoded)")
        XCTAssertEqual(ExternalPlayer.outplayer.launchURL(for: URL(string: "https://cdn.test/a.mkv")!)?.absoluteString, "outplayer://cdn.test/a.mkv")
        XCTAssertEqual(ExternalPlayer.vidHub.launchURL(for: stream)?.absoluteString, "open-vidhub://x-callback-url/open?url=\(encoded)")
        XCTAssertEqual(ExternalPlayer.cineUltra.launchURL(for: stream)?.absoluteString, "cineultra://playback?url=\(encoded)")
        XCTAssertEqual(ExternalPlayer.moonPlayer.launchURL(for: URL(string: "https://cdn.test/a.mkv")!)?.absoluteString, "moonplayer://open?url=https://cdn.test/a.mkv")
        XCTAssertEqual(ExternalPlayer.iina.launchURL(for: stream)?.absoluteString, "iina://weblink?url=\(encoded)")
        XCTAssertNil(ExternalPlayer.none.launchURL(for: stream))
    }

    func testPlayersPerPlatform() {
        XCTAssertEqual(ExternalPlayer.available(on: .iOS).map(\.title),
                       ["Built-in Player", "Infuse", "VLC", "Outplayer", "SenPlayer", "VidHub", "CineUltra", "Moon Player"])
        XCTAssertEqual(ExternalPlayer.available(on: .macOS).map(\.title), ["Built-in Player", "Infuse", "VidHub", "IINA", "mpv"])
    }
}
