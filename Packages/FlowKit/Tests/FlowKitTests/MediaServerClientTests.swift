import XCTest
@testable import FlowKit

/// Jellyfin, Emby and Plex through a scripted transport: what is asked of the server (paths, query,
/// headers, auth), and what the replies become. The JSON bodies are written by hand in the shapes the servers send.
final class JellyfinClientTests: XCTestCase {
    private let base = URL(string: "https://jf.example.com/")!

    private func client(_ stub: StubTransport, kind: MediaServerKind = .jellyfin, token: String? = "TOKEN") -> JellyfinClient {
        let config = MediaServerConfig(id: "srv", kind: kind, name: "Home", baseURL: base, userID: "u1", accessToken: token)
        return JellyfinClient(config: config, deviceID: "dev-1", http: HTTPClient(transport: stub))
    }

    private func dune() -> MediaItem { MediaItem(type: .movie, ids: ExternalIDs(tmdb: 693134, imdb: "tt15239678"), title: "Dune: Part Two", releaseDate: FlowDate.parse("2024-02-27")) }

    // MARK: Signing in

    func testSignInPostsCredentialsAndBuildsAConfig() async throws {
        let stub = StubTransport()
        stub.on("POST", "/Users/AuthenticateByName", json: #"{"User":{"Id":"user-9","Name":"alex"},"AccessToken":"tok-1"}"#)
        stub.on("GET", "/System/Info/Public", json: #"{"ServerName":"Den","Version":"10.10.3","Id":"abc"}"#)
        let config = try await JellyfinClient.signIn(kind: .jellyfin, baseURL: URL(string: "http://192.168.1.20:8096")!, username: "alex", password: "p@ss", deviceID: "dev-1", deviceName: "iPhone", http: HTTPClient(transport: stub))
        XCTAssertEqual(config.name, "Den")
        XCTAssertEqual(config.userID, "user-9")
        XCTAssertEqual(config.accessToken, "tok-1")
        XCTAssertEqual(config.username, "alex")
        XCTAssertFalse(config.isRemote, "a 192.168 address is on the home network")
        let sent = try XCTUnwrap(stub.requests("POST", path: "/Users/AuthenticateByName").first)
        XCTAssertEqual(StubTransport.body(sent)["Username"] as? String, "alex")
        XCTAssertEqual(StubTransport.body(sent)["Pw"] as? String, "p@ss")
        let auth = try XCTUnwrap(sent.value(forHTTPHeaderField: "X-Emby-Authorization"))
        XCTAssertTrue(auth.contains(#"DeviceId="dev-1""#) && auth.contains(#"Device="iPhone""#), auth)
        XCTAssertFalse(auth.contains("Token="), "no token before signing in")

        let remote = try await JellyfinClient.signIn(kind: .emby, baseURL: URL(string: "https://media.example.org")!, username: "a", password: "b", deviceID: "d", deviceName: "n", http: HTTPClient(transport: stub))
        XCTAssertTrue(remote.isRemote)
        XCTAssertEqual(remote.kind, .emby)
    }

    func testWrongPasswordIsUnauthorized() async {
        let stub = StubTransport()
        stub.on("POST", "/Users/AuthenticateByName", status: 401, json: "")
        do {
            _ = try await JellyfinClient.signIn(kind: .jellyfin, baseURL: base, username: "a", password: "x", deviceID: "d", deviceName: "n", http: HTTPClient(transport: stub))
            XCTFail("expected an error")
        } catch { XCTAssertEqual(error as? FlowError, .unauthorized) }
    }

    // MARK: Browsing

    func testRequestsCarryTheTokenInBothHeaders() async throws {
        let stub = StubTransport().on("GET", "/Users/u1/Views", json: #"{"Items":[]}"#)
        _ = try await client(stub).libraries()
        let r = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(r.value(forHTTPHeaderField: "X-Emby-Token"), "TOKEN")
        XCTAssertTrue(r.value(forHTTPHeaderField: "X-Emby-Authorization")?.contains(#"Token="TOKEN""#) == true)
    }

    func testLibrariesKeepMoviesShowsAndMixedAndDropTheRest() async throws {
        let stub = StubTransport().on("GET", "/Users/u1/Views", json: """
        {"Items":[
         {"Id":"m","Name":"Films","CollectionType":"movies","ImageTags":{"Primary":"t1"}},
         {"Id":"s","Name":"Series","CollectionType":"tvshows","BackdropImageTags":["b1"]},
         {"Id":"x","Name":"Mixed bag"},
         {"Id":"mu","Name":"Music","CollectionType":"music"},
         {"Id":"p","Name":"Playlists","CollectionType":"playlists"}]}
        """)
        let libraries = try await client(stub).libraries()
        XCTAssertEqual(libraries.map(\.name), ["Films", "Series", "Mixed bag"])
        XCTAssertEqual(libraries.map(\.type), [.movie, .show, nil])
        XCTAssertEqual(libraries[0].imageURL?.absoluteString, "https://jf.example.com/Items/m/Images/Primary?maxWidth=640&tag=t1&quality=90")
        XCTAssertTrue(libraries[1].imageURL?.path.hasSuffix("/Images/Backdrop") == true, "falls back to the backdrop when there is no primary image")
        XCTAssertNil(libraries[2].imageURL)
    }

    func testItemsBecomeServerItemsWithIDsArtAndTitles() async throws {
        let stub = StubTransport().on("GET", "/Users/u1/Items", json: """
        {"Items":[
         {"Id":"a1","Name":"Dune: Part Two","Type":"Movie","ProductionYear":2024,"ProviderIds":{"Tmdb":"693134","Imdb":"tt15239678"},"ImageTags":{"Primary":"p1"},"BackdropImageTags":["bd"],"Overview":"Paul.","DateCreated":"2024-05-01T10:00:00.0000000Z","UserData":{"IsFavorite":true}},
         {"Id":"a2","Name":"Severance","Type":"Series","ProviderIds":{"Tvdb":"371980"}},
         {"Id":"a3","Name":"Some Episode","Type":"Episode"},
         {"Id":"a4","Name":"Resident.Evil.2026.WEBDL-1080p.mp4","Type":"Movie","ProviderIds":{}},
         {"Id":"a5","Name":"setup.exe","Type":"Movie"}]}
        """)
        let items = try await client(stub).recentlyAdded(limit: 10)
        XCTAssertEqual(items.map(\.itemID), ["a1", "a2", "a4"], "episodes and executables are dropped")
        let dune = items[0]
        XCTAssertEqual(dune.id, "srv:a1")
        XCTAssertEqual(dune.type, .movie)
        XCTAssertEqual(dune.year, 2024)
        XCTAssertEqual(dune.ids, ExternalIDs(tmdb: 693134, imdb: "tt15239678"))
        XCTAssertTrue(dune.isFavourite)
        XCTAssertEqual(dune.posterURL?.query, "maxWidth=500&tag=p1&quality=90")
        XCTAssertEqual(dune.backdropURL?.query, "maxWidth=1280&tag=bd&quality=90")
        XCTAssertNotNil(dune.addedAt)
        XCTAssertEqual(items[1].type, .show)
        XCTAssertEqual(items[1].ids.tvdb, 371980)
        XCTAssertEqual(items[2].title, "Resident Evil", "a file name becomes a clean title")
        XCTAssertEqual(items[2].year, 2026)

        let query = StubTransport.query(try XCTUnwrap(stub.requests.first))
        XCTAssertEqual(query["IncludeItemTypes"], "Movie,Series")
        XCTAssertEqual(query["SortBy"], "DateCreated")
        XCTAssertEqual(query["SortOrder"], "Descending")
        XCTAssertEqual(query["Limit"], "10")
        XCTAssertEqual(query["Recursive"], "true")
    }

    func testSearchAndFavouritesSendTheirFilters() async throws {
        let stub = StubTransport().on("GET", "/Users/u1/Items", json: #"{"Items":[]}"#).on("GET", "/Users/u1/Views", json: #"{"Items":[]}"#)
        let jf = client(stub)
        _ = try await jf.search("dune")
        _ = try await jf.favourites()
        let searches = stub.requests("GET", path: "/Users/u1/Items").map(StubTransport.query)
        XCTAssertEqual(searches[0]["SearchTerm"], "dune")
        XCTAssertEqual(searches[0]["Limit"], "40")
        XCTAssertEqual(searches.last?["Filters"], "IsFavorite")
    }

    /// Some servers answer a library-wide recursive query with nothing; the query then runs per library.
    func testEmptyLibraryWideAnswerFallsBackToEachLibrary() async throws {
        let stub = StubTransport()
        stub.on("GET", "/Users/u1/Views", json: #"{"Items":[{"Id":"lib1","Name":"Films","CollectionType":"movies"},{"Id":"lib2","Name":"Shows","CollectionType":"tvshows"}]}"#)
        stub.on("GET", "/Users/u1/Items", json: #"{"Items":[],"TotalRecordCount":0}"#)
        stub.on("GET", "/Users/u1/Items", query: ["ParentId=lib1"], json: #"{"Items":[{"Id":"m1","Name":"A","Type":"Movie"},{"Id":"m2","Name":"B","Type":"Movie"}]}"#)
        stub.on("GET", "/Users/u1/Items", query: ["ParentId=lib2"], json: #"{"Items":[{"Id":"s1","Name":"C","Type":"Series"}]}"#)
        let items = try await client(stub).recentlyAdded(limit: 2)
        XCTAssertEqual(items.map(\.itemID), ["m1", "m2"], "merged across libraries, then cut to the limit")
    }

    func testCataloguePagesUntilTheServerRunsOut() async throws {
        let stub = StubTransport()
        let page = (0..<2000).map { #"{"Id":"i\#($0)","Name":"T\#($0)","Type":"Movie"}"# }.joined(separator: ",")
        stub.on("GET", "/Users/u1/Items", query: ["StartIndex=0"], json: #"{"Items":[\#(page)],"TotalRecordCount":2003}"#)
        stub.on("GET", "/Users/u1/Items", query: ["StartIndex=2000"], json: #"{"Items":[{"Id":"z1","Name":"Z","Type":"Movie"},{"Id":"z2","Name":"Z2","Type":"Series"},{"Id":"z3","Name":"Z3","Type":"Movie"}],"TotalRecordCount":2003}"#)
        let all = try await client(stub).catalogue()
        XCTAssertEqual(all.count, 2003)
        XCTAssertEqual(stub.requests("GET", path: "/Users/u1/Items").count, 2, "two pages, no third request")
    }

    func testSetFavouriteUsesPostToAddAndDeleteToRemove() async throws {
        let stub = StubTransport().on(nil, "/Users/u1/FavoriteItems/abc", json: "{}")
        let jf = client(stub)
        try await jf.setFavourite(itemID: "abc", true)
        try await jf.setFavourite(itemID: "abc", false)
        XCTAssertEqual(stub.requests.map(\.httpMethod), ["POST", "DELETE"])
    }

    func testServerErrorsSurface() async {
        let stub = StubTransport().on("GET", "/Users/u1/Views", status: 500, json: "boom")
        do { _ = try await client(stub).libraries(); XCTFail("expected an error") } catch {
            XCTAssertEqual(error as? FlowError, .http(status: 500, body: "boom"))
        }
        let down = StubTransport()
        down.fail("/Users/u1/Views")
        do { _ = try await client(down).libraries(); XCTFail("expected an error") } catch {
            guard case .offline = error as? FlowError else { return XCTFail("expected offline, got \(error)") }
        }
    }

    // MARK: Finding and playing a title

    private func stubWithDune(mediaSource: String, extra: (StubTransport) -> Void = { _ in }) -> StubTransport {
        let stub = StubTransport()
        stub.on("GET", "/Users/u1/Items", query: ["AnyProviderIdEquals=tmdb.693134"], json: #"{"Items":[{"Id":"dune-id","Name":"Dune: Part Two","Type":"Movie","ProductionYear":2024,"ProviderIds":{"Tmdb":"693134"}}]}"#)
        stub.on("GET", "/Users/u1/Items/dune-id", json: """
        {"Id":"dune-id","Name":"Dune: Part Two","Type":"Movie","UserData":{"PlaybackPositionTicks":6000000000},"MediaSources":[\(mediaSource)]}
        """)
        stub.on("POST", "/Items/dune-id/PlaybackInfo", json: #"{"MediaSources":[]}"#)
        stub.on("GET", "/MediaSegments/dune-id", json: #"{"Items":[{"Type":"Intro","StartTicks":300000000,"EndTicks":900000000},{"Type":"Outro","StartTicks":70000000000,"EndTicks":72000000000},{"Type":"Unknown","StartTicks":0,"EndTicks":1}]}"#)
        extra(stub)
        return stub
    }

    func testSourcesForAnMP4DirectPlayWithResumeAndSkipSegments() async throws {
        let ms = #"{"Id":"ms1","Name":"Dune 4K","Container":"mp4","Size":9000000000,"Path":"/media/Dune.Part.Two.2024.2160p.mp4","SupportsDirectPlay":true,"SupportsTranscoding":true,"MediaStreams":[{"Type":"Video","Codec":"hevc","Height":2160,"Width":3840,"VideoRangeType":"DOVIWithHDR10","DisplayTitle":"4K HEVC"},{"Type":"Audio","Codec":"eac3","Channels":6,"Language":"eng","IsDefault":true,"DisplayTitle":"English EAC3 5.1"}]}"#
        let stub = stubWithDune(mediaSource: ms)
        let sources = try await client(stub).sources(for: PlaybackRequest(item: dune()))
        let source = try XCTUnwrap(sources.first)
        XCTAssertEqual(sources.count, 1)
        XCTAssertEqual(source.id, "srv#dune-id#ms1")
        XCTAssertEqual(source.category, .mediaServers)
        XCTAssertEqual(source.traits.resolution, .uhd4k)
        XCTAssertEqual(source.traits.videoCodec, "HEVC")
        XCTAssertEqual(source.traits.hdr, ["DV"])
        XCTAssertEqual(source.traits.audioCodec, "DD+")
        XCTAssertEqual(source.traits.audioChannels, "5.1")
        XCTAssertEqual(source.traits.sizeBytes, 9_000_000_000)
        XCTAssertEqual(source.serverResumeSeconds, 600, "6,000,000,000 ticks of 100 ns is ten minutes")
        XCTAssertEqual(source.filename, "Dune.Part.Two.2024.2160p.mp4")
        XCTAssertEqual(source.segments.map(\.kind), [.intro, .credits])
        XCTAssertEqual(source.segments[0].start, 30, accuracy: 0.001)
        XCTAssertEqual(source.segments[0].end, 90, accuracy: 0.001)
        let url = try XCTUnwrap(source.location.playableURL)
        XCTAssertEqual(url.path, "/Videos/dune-id/stream.mp4")
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.reduce(into: [String: String]()) { $0[$1.name] = $1.value }
        XCTAssertEqual(query["static"], "true")
        XCTAssertEqual(query["MediaSourceId"], "ms1")
        XCTAssertEqual(query["api_key"], "TOKEN")
        // The provider-id lookup is how the title was found, not a title search.
        XCTAssertNil(stub.requests.compactMap { StubTransport.query($0)["SearchTerm"] }.first)
    }

    func testMKVWithPlayableCodecsIsStreamedAsIsAndOthersGoThroughTheServersTranscoder() async throws {
        let remuxable = #"{"Id":"ms1","Container":"mkv","SupportsDirectPlay":true,"SupportsTranscoding":true,"MediaStreams":[{"Type":"Video","Codec":"h264","Height":1080},{"Type":"Audio","Codec":"aac","Channels":2}]}"#
        var sources = try await client(stubWithDune(mediaSource: remuxable)).sources(for: PlaybackRequest(item: dune()))
        XCTAssertEqual(sources.first?.location.playableURL?.path, "/Videos/dune-id/stream.mkv")

        let vc1 = #"{"Id":"ms2","Container":"mkv","SupportsDirectPlay":true,"SupportsTranscoding":true,"MediaStreams":[{"Type":"Video","Codec":"vc1","Height":1080},{"Type":"Audio","Codec":"aac","Channels":2}]}"#
        sources = try await client(stubWithDune(mediaSource: vc1)).sources(for: PlaybackRequest(item: dune()))
        let url = try XCTUnwrap(sources.first?.location.playableURL)
        XCTAssertEqual(url.path, "/Videos/dune-id/master.m3u8", "a codec Apple can't decode asks the server for HLS")
        XCTAssertTrue(url.query?.contains("VideoCodec=hevc,h264") == true || url.query?.contains("VideoCodec=hevc%2Ch264") == true, url.query ?? "")
    }

    func testRemoteDebridLinksPlayFromTheirOrigin() async throws {
        let ms = #"{"Id":"ms1","Container":"mkv","IsRemote":true,"Protocol":"Http","Path":"https://cdn.example.com/abc/file.mkv"}"#
        let sources = try await client(stubWithDune(mediaSource: ms)).sources(for: PlaybackRequest(item: dune()))
        XCTAssertEqual(sources.first?.location.playableURL?.absoluteString, "https://cdn.example.com/abc/file.mkv")
    }

    func testPlaybackInfoSourcesWinOverTheItemsOwn() async throws {
        let stub = stubWithDune(mediaSource: #"{"Id":"old","Container":"mp4"}"#) { stub in
            stub.on("POST", "/Items/dune-id/PlaybackInfo", json: #"{"MediaSources":[{"Id":"fresh","Container":"mp4"}],"PlaySessionId":"s"}"#)
        }
        let sources = try await client(stub).sources(for: PlaybackRequest(item: dune()))
        XCTAssertEqual(sources.map(\.id), ["srv#dune-id#fresh"])
        XCTAssertEqual(StubTransport.body(try XCTUnwrap(stub.requests("POST", path: "/PlaybackInfo").first))["UserId"] as? String, "u1")
    }

    func testUnsafeFilesAreNeverOffered() async throws {
        let ms = #"{"Id":"ms1","Container":"mp4","Path":"/media/installer.exe"}"#
        let sources = try await client(stubWithDune(mediaSource: ms)).sources(for: PlaybackRequest(item: dune()))
        XCTAssertTrue(sources.isEmpty)
    }

    func testEmbyHasNoMediaSegmentsAndAlwaysDirectPlaysNativeContainers() async throws {
        let ms = #"{"Id":"ms1","Container":"mp4","SupportsDirectPlay":false}"#
        let stub = stubWithDune(mediaSource: ms)
        let sources = try await client(stub, kind: .emby).sources(for: PlaybackRequest(item: dune()))
        XCTAssertTrue(sources[0].segments.isEmpty)
        XCTAssertTrue(stub.requests("GET", path: "/MediaSegments/dune-id").isEmpty, "Emby has no media segments endpoint")
        XCTAssertEqual(sources[0].location.playableURL?.path, "/Videos/dune-id/stream.mp4")
    }

    func testEpisodeLookupPicksTheRightEpisodeOfTheSeason() async throws {
        let stub = StubTransport()
        stub.on("GET", "/Users/u1/Items", query: ["AnyProviderIdEquals=tmdb.95396"], json: #"{"Items":[{"Id":"show-id","Name":"Severance","Type":"Series","ProviderIds":{"Tmdb":"95396"}}]}"#)
        stub.on("GET", "/Shows/show-id/Episodes", json: #"{"Items":[{"Id":"e1","ParentIndexNumber":2,"IndexNumber":1},{"Id":"e2","ParentIndexNumber":2,"IndexNumber":2},{"Id":"e3","ParentIndexNumber":2,"IndexNumber":3}]}"#)
        stub.on("GET", "/Users/u1/Items/e2", json: #"{"Id":"e2","MediaSources":[{"Id":"msE","Container":"mp4"}]}"#)
        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 95396), title: "Severance")
        let episode = Episode(showTMDB: 95396, season: 2, number: 2, title: "Goodbye, Mrs. Selvig")
        let sources = try await client(stub).sources(for: PlaybackRequest(item: show, episode: episode))
        XCTAssertEqual(sources.map(\.id), ["srv#e2#msE"])
        let episodes = try XCTUnwrap(stub.requests("GET", path: "/Shows/show-id/Episodes").first)
        XCTAssertEqual(StubTransport.query(episodes)["Season"], "2")
        XCTAssertEqual(StubTransport.query(episodes)["UserId"], "u1")

        let missing = Episode(showTMDB: 95396, season: 2, number: 9, title: "Nope")
        let none = try await client(stub).sources(for: PlaybackRequest(item: show, episode: missing))
        XCTAssertTrue(none.isEmpty)
    }

    func testTitleSearchFallbackMatchesByNameAndYear() async throws {
        let stub = StubTransport()
        stub.on("GET", "/Users/u1/Items", query: ["SearchTerm="], json: #"{"Items":[{"Id":"other","Name":"Dune","Type":"Movie","ProductionYear":1984},{"Id":"dune-id","Name":"Dune: Part Two","Type":"Movie","ProductionYear":2024}]}"#)
        stub.on("GET", "/Users/u1/Items/dune-id", json: #"{"Id":"dune-id","MediaSources":[{"Id":"ms","Container":"mp4"}]}"#)
        let bare = MediaItem(type: .movie, ids: ExternalIDs(), title: "Dune: Part Two", releaseDate: FlowDate.parse("2024-03-01"))
        let sources = try await client(stub).sources(for: PlaybackRequest(item: bare))
        XCTAssertEqual(sources.map(\.id), ["srv#dune-id#ms"])
        let noMatch = MediaItem(type: .movie, ids: ExternalIDs(), title: "Not On This Server")
        let none = try await client(stub).sources(for: PlaybackRequest(item: noMatch))
        XCTAssertTrue(none.isEmpty)
    }

    // MARK: Reporting

    func testPlaybackReportsGoToTheRightEndpoints() async throws {
        let stub = StubTransport()
        let jf = client(stub)
        var source = StreamSource(id: "srv#item#ms", category: .mediaServers, providerID: "srv", providerName: "Home", title: "x", location: .url(base, headers: [:]))
        source.id = "srv#item#ms"
        for (state, path) in [(PlaybackReport.State.started, "/Sessions/Playing"), (.progress, "/Sessions/Playing/Progress"), (.paused, "/Sessions/Playing/Progress"), (.stopped, "/Sessions/Playing/Stopped")] {
            await jf.report(PlaybackReport(state: state, source: source, positionSeconds: 90.5, durationSeconds: 7200, sessionID: "sess"))
            let sent = try XCTUnwrap(stub.requests.last)
            XCTAssertEqual(sent.url?.path, path)
            XCTAssertEqual(sent.httpMethod, "POST")
            let body = StubTransport.body(sent)
            XCTAssertEqual(body["ItemId"] as? String, "item")
            XCTAssertEqual(body["MediaSourceId"] as? String, "ms")
            XCTAssertEqual(body["PositionTicks"] as? Int, 905_000_000)
            XCTAssertEqual(body["IsPaused"] as? Bool, state == .paused)
            XCTAssertEqual(body["PlaySessionId"] as? String, "sess")
        }
        // A source from somewhere else is ignored rather than reported to the wrong server.
        source.id = "not-ours"
        let before = stub.requests.count
        await jf.report(PlaybackReport(state: .started, source: source, positionSeconds: 0, durationSeconds: nil, sessionID: "s"))
        XCTAssertEqual(stub.requests.count, before)
    }
}

final class PlexClientTests: XCTestCase {
    private let base = URL(string: "https://plex.example.com:32400/")!

    private func client(_ stub: StubTransport) -> PlexClient {
        PlexClient(config: MediaServerConfig(id: "plex1", kind: .plex, name: "Plex", baseURL: base, accessToken: "PT"), clientIdentifier: "cid", http: HTTPClient(transport: stub))
    }

    func testPinLinkingAndPolling() async throws {
        let stub = StubTransport()
        stub.on("POST", "/api/v2/pins", json: #"{"id":4242,"code":"ABCD","expiresIn":1800}"#)
        let (pin, code) = try await PlexClient.createPin(clientIdentifier: "cid", http: HTTPClient(transport: stub))
        XCTAssertEqual(pin.id, 4242)
        XCTAssertEqual(code.userCode, "ABCD")
        XCTAssertEqual(code.verificationURL.absoluteString, "https://plex.tv/link")
        XCTAssertEqual(code.expiresIn, 1800)
        let created = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(created.value(forHTTPHeaderField: "X-Plex-Client-Identifier"), "cid")
        XCTAssertEqual(created.value(forHTTPHeaderField: "X-Plex-Product"), "Marquee")

        stub.on("GET", "/api/v2/pins/4242", json: #"{"id":4242,"authToken":"user-token"}"#)
        let token = try await PlexClient.pollPin(pin, clientIdentifier: "cid", http: HTTPClient(transport: stub))
        XCTAssertEqual(token, "user-token")
    }

    func testPollingGivesUpWhenThePinExpires() async {
        let stub = StubTransport().on("GET", "/api/v2/pins/1", json: #"{"id":1,"authToken":null}"#)
        do {
            _ = try await PlexClient.pollPin(PlexClient.Pin(id: 1, code: "X"), clientIdentifier: "cid", expiresIn: 0, http: HTTPClient(transport: stub))
            XCTFail("expected a timeout")
        } catch { XCTAssertEqual(error as? FlowError, .timedOut) }
        XCTAssertTrue(stub.requests.isEmpty, "an expired pin isn't polled")
    }

    func testDiscoveryKeepsServersAndOrdersConnectionsLocalFirstRelayLast() async throws {
        let stub = StubTransport().on("GET", "/api/v2/resources", json: """
        [{"name":"Den","clientIdentifier":"m1","provides":"server","accessToken":"srv-token","connections":[
           {"uri":"https://relay.plex.direct:8443","local":false,"relay":true},
           {"uri":"https://remote.example.com:32400","local":false,"relay":false},
           {"uri":"http://192.168.1.5:32400","local":true,"relay":false}]},
         {"name":"Phone","clientIdentifier":"c1","provides":"client,player","connections":[]},
         {"name":"Shared","clientIdentifier":"m2","provides":"server","connections":[{"uri":"http://10.0.0.2:32400"}]}]
        """)
        let found = try await PlexClient.discoverServers(userToken: "UT", clientIdentifier: "cid", http: HTTPClient(transport: stub))
        XCTAssertEqual(found.map(\.name), ["Den", "Shared"], "players aren't servers")
        XCTAssertEqual(found[0].accessToken, "srv-token")
        XCTAssertEqual(found[1].accessToken, "UT", "no server token means the user's own")
        XCTAssertEqual(found[0].preferredConnections.map { $0.uri.host }, ["192.168.1.5", "remote.example.com", "relay.plex.direct"])
        let sent = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "X-Plex-Token"), "UT")
        XCTAssertEqual(StubTransport.query(sent)["includeRelay"], "1")
    }

    func testConfigUsesTheFirstConnectionThatAnswers() async throws {
        let stub = StubTransport()
        stub.on("GET", "/identity", json: "{}")
        // The local address is unreachable; the remote one answers.
        stub.fail("/identity", with: URLError(.cannotConnectToHost))
        let server = PlexClient.DiscoveredServer(name: "Den", machineID: "m1", accessToken: "T", connections: [
            .init(uri: URL(string: "http://192.168.1.5:32400")!, local: true, relay: false),
            .init(uri: URL(string: "https://remote.example.com:32400")!, local: false, relay: false),
        ])
        do {
            _ = try await PlexClient.config(for: server, clientIdentifier: "cid", http: HTTPClient(transport: stub))
            XCTFail("no connection answers")
        } catch {
            XCTAssertEqual((error as? FlowError)?.errorDescription, "Couldn't reach Den on any of its addresses.")
        }
        XCTAssertEqual(stub.requests.count, 2, "each address was tried once")

        let working = StubTransport().on("GET", "/identity", json: "{}")
        let config = try await PlexClient.config(for: server, clientIdentifier: "cid", http: HTTPClient(transport: working))
        XCTAssertEqual(config.baseURL.host, "192.168.1.5")
        XCTAssertFalse(config.isRemote)
        XCTAssertEqual(config.machineID, "m1")
        XCTAssertEqual(config.kind, .plex)
    }

    func testLibrariesAndItemsDecode() async throws {
        let stub = StubTransport()
        stub.on("GET", "/library/sections", json: #"{"MediaContainer":{"Directory":[{"key":"1","title":"Movies","type":"movie","art":"/a/1"},{"key":"2","title":"TV","type":"show","thumb":"/t/2"},{"key":"3","title":"Music","type":"artist"}]}}"#)
        stub.on("GET", "/library/sections/1/all", json: """
        {"MediaContainer":{"Metadata":[
          {"ratingKey":"10","title":"Dune: Part Two","type":"movie","year":2024,"summary":"Paul.","thumb":"/library/metadata/10/thumb","art":"/library/metadata/10/art","addedAt":1714557600,"Guid":[{"id":"tmdb://693134"},{"id":"imdb://tt15239678"},{"id":"tvdb://1"}]},
          {"ratingKey":"11","title":"A Season","type":"season"}]}}
        """)
        let plex = client(stub)
        let libraries = try await plex.libraries()
        XCTAssertEqual(libraries.map(\.name), ["Movies", "TV"])
        XCTAssertEqual(libraries.map(\.type), [.movie, .show])
        XCTAssertEqual(libraries[0].imageURL.map { URLComponents(url: $0, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "url" }!.value }, "/a/1")

        let items = try await plex.items(inLibrary: "1", limit: 25)
        XCTAssertEqual(items.count, 1, "seasons aren't titles")
        XCTAssertEqual(items[0].ids, ExternalIDs(tmdb: 693134, imdb: "tt15239678", tvdb: 1))
        XCTAssertEqual(items[0].addedAt, Date(timeIntervalSince1970: 1714557600))
        XCTAssertTrue(items[0].posterURL?.absoluteString.contains("X-Plex-Token=PT") == true)
        stub.on("GET", "/library/sections/2/all", json: #"{"MediaContainer":{"Metadata":[{"ratingKey":"30","title":"Severance","type":"show"}]}}"#)
        let query = StubTransport.query(try XCTUnwrap(stub.requests("GET", path: "/library/sections/1/all").first))
        XCTAssertEqual(query["sort"], "addedAt:desc")
        XCTAssertEqual(query["X-Plex-Container-Size"], "25")
        XCTAssertEqual(query["includeGuids"], "1")
        XCTAssertEqual(stub.requests.last?.value(forHTTPHeaderField: "X-Plex-Token"), "PT")

        let catalogue = try await plex.catalogue()
        XCTAssertEqual(catalogue.map(\.itemID), ["10", "30"], "every library, in order")
    }

    func testRecentlyAddedKeepsMoviesAndShowsUpToTheLimit() async throws {
        let stub = StubTransport().on("GET", "/library/recentlyAdded", json: """
        {"MediaContainer":{"Metadata":[{"ratingKey":"1","title":"E","type":"episode"},{"ratingKey":"2","title":"A","type":"movie"},{"ratingKey":"3","title":"B","type":"show"},{"ratingKey":"4","title":"C","type":"movie"}]}}
        """)
        let items = try await client(stub).recentlyAdded(limit: 2)
        XCTAssertEqual(items.map(\.title), ["A", "B"])
        XCTAssertEqual(StubTransport.query(stub.requests[0])["X-Plex-Container-Size"], "4", "asks for twice the limit to leave room for the episodes it drops")
    }

    func testSearchFlattensEveryHub() async throws {
        let stub = StubTransport().on("GET", "/hubs/search", json: """
        {"MediaContainer":{"Hub":[{"type":"movie","Metadata":[{"ratingKey":"1","title":"M","type":"movie"}]},{"type":"show","Metadata":[{"ratingKey":"2","title":"S","type":"show"}]},{"type":"actor"}]}}
        """)
        let found = try await client(stub).search("dune")
        XCTAssertEqual(found.map(\.title), ["M", "S"])
        XCTAssertEqual(StubTransport.query(stub.requests[0])["query"], "dune")
    }

    func testFavouritesAreNotSupportedAndSayWhy() async {
        let plex = client(StubTransport())
        let none = try? await plex.favourites()
        XCTAssertEqual(none?.count, 0)
        do { try await plex.setFavourite(itemID: "1", true); XCTFail("expected an error") } catch {
            XCTAssertTrue((error as? FlowError)?.errorDescription?.contains("doesn't support favourites") == true)
        }
    }

    private func plexStub(media: String, extra: (StubTransport) -> Void = { _ in }) -> StubTransport {
        let stub = StubTransport()
        stub.on("GET", "/library/all", query: ["guid=tmdb"], json: #"{"MediaContainer":{"Metadata":[{"ratingKey":"10","title":"Dune: Part Two","type":"movie","year":2024,"Guid":[{"id":"tmdb://693134"}]}]}}"#)
        stub.on("GET", "/library/metadata/10", json: """
        {"MediaContainer":{"Metadata":[{"ratingKey":"10","title":"Dune: Part Two","type":"movie","viewOffset":120000,
          "Marker":[{"type":"intro","startTimeOffset":5000,"endTimeOffset":65000},{"type":"credits","startTimeOffset":7000000,"endTimeOffset":7100000},{"type":"commercial","startTimeOffset":1,"endTimeOffset":2}],
          "Media":[\(media)]}]}}
        """)
        extra(stub)
        return stub
    }

    func testSourcesDirectPlayMP4WithMarkersAndResume() async throws {
        let stub = plexStub(media: #"{"id":77,"videoResolution":"1080","videoCodec":"h264","audioCodec":"eac3","audioChannels":6,"container":"mp4","Part":[{"key":"/library/parts/55/file.mp4","size":4000000000,"file":"/data/Dune.Part.Two.2024.mp4","container":"mp4"}]}"#)
        let request = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 693134), title: "Dune: Part Two", releaseDate: FlowDate.parse("2024-02-27")))
        let sources = try await client(stub).sources(for: request)
        let source = try XCTUnwrap(sources.first)
        XCTAssertEqual(source.id, "plex1#10#77")
        XCTAssertEqual(source.traits.resolution, .hd1080)
        XCTAssertEqual(source.traits.videoCodec, "H264")
        XCTAssertEqual(source.traits.audioCodec, "DD+")
        XCTAssertEqual(source.traits.audioChannels, "5.1")
        XCTAssertEqual(source.serverResumeSeconds, 120)
        XCTAssertEqual(source.segments.map(\.kind), [.intro, .credits], "commercials aren't skippable here")
        XCTAssertEqual(source.segments[0].start, 5)
        XCTAssertEqual(source.segments[0].end, 65)
        XCTAssertEqual(source.filename, "Dune.Part.Two.2024.mp4")
        let url = try XCTUnwrap(source.location.playableURL)
        XCTAssertEqual(url.path, "/library/parts/55/file.mp4")
        XCTAssertEqual(url.query, "X-Plex-Token=PT")
        XCTAssertEqual(StubTransport.query(try XCTUnwrap(stub.requests("GET", path: "/library/metadata/10").first))["includeMarkers"], "1")
    }

    func testSourcesForAnMKVAskForHLSDirectStream() async throws {
        let stub = plexStub(media: #"{"id":78,"videoResolution":"4k","container":"mkv","Part":[{"key":"/library/parts/56/file.mkv","file":"/data/x.mkv","container":"mkv"}]}"#)
        let request = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 693134), title: "Dune: Part Two"))
        let found = try await client(stub).sources(for: request)
        let url = try XCTUnwrap(found.first?.location.playableURL)
        XCTAssertEqual(url.path, "/video/:/transcode/universal/start.m3u8")
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.reduce(into: [String: String]()) { $0[$1.name] = $1.value }
        XCTAssertEqual(q["path"], "/library/metadata/10")
        XCTAssertEqual(q["protocol"], "hls")
        XCTAssertEqual(q["directStream"], "1")
        XCTAssertEqual(q["directPlay"], "0")
        XCTAssertEqual(q["X-Plex-Token"], "PT")
        XCTAssertEqual(q["X-Plex-Client-Identifier"], "cid")
    }

    func testEpisodesAreFoundThroughAllLeaves() async throws {
        let stub = StubTransport()
        stub.on("GET", "/library/all", json: #"{"MediaContainer":{"Metadata":[{"ratingKey":"20","title":"Severance","type":"show","Guid":[{"id":"tmdb://95396"}]}]}}"#)
        stub.on("GET", "/library/metadata/20/allLeaves", json: #"{"MediaContainer":{"Metadata":[{"ratingKey":"201","parentIndex":1,"index":1},{"ratingKey":"202","parentIndex":2,"index":2}]}}"#)
        stub.on("GET", "/library/metadata/202", json: #"{"MediaContainer":{"Metadata":[{"ratingKey":"202","Media":[{"id":1,"container":"mp4","Part":[{"key":"/p/202.mp4"}]}]}]}}"#)
        let show = MediaItem(type: .show, ids: ExternalIDs(tmdb: 95396), title: "Severance")
        let sources = try await client(stub).sources(for: PlaybackRequest(item: show, episode: Episode(showTMDB: 95396, season: 2, number: 2, title: "x")))
        XCTAssertEqual(sources.map(\.id), ["plex1#202#1"])
        let none = try await client(stub).sources(for: PlaybackRequest(item: show, episode: Episode(showTMDB: 95396, season: 5, number: 5, title: "x")))
        XCTAssertTrue(none.isEmpty)
    }

    func testTitleSearchIsTheFallbackWhenTheGuidFindsNothing() async throws {
        let stub = StubTransport()
        stub.on("GET", "/library/all", json: #"{"MediaContainer":{}}"#)
        stub.on("GET", "/library/search", json: #"{"MediaContainer":{"Metadata":[{"ratingKey":"10","title":"Dune: Part Two","type":"movie","year":2024}]}}"#)
        stub.on("GET", "/library/metadata/10", json: #"{"MediaContainer":{"Metadata":[{"ratingKey":"10","Media":[{"id":1,"container":"mp4","Part":[{"key":"/p/10.mp4"}]}]}]}}"#)
        let request = PlaybackRequest(item: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1), title: "Dune: Part Two", releaseDate: FlowDate.parse("2024-02-27")))
        let sources = try await client(stub).sources(for: request)
        XCTAssertEqual(sources.count, 1)
        let search = StubTransport.query(try XCTUnwrap(stub.requests("GET", path: "/library/search").first))
        XCTAssertEqual(search["query"], "Dune: Part Two")
        XCTAssertEqual(search["searchTypes"], "movies")
    }

    func testTimelineReports() async throws {
        let stub = StubTransport().on("GET", "/:/timeline", json: "{}")
        let source = StreamSource(id: "plex1#10#77", category: .mediaServers, providerID: "plex1", providerName: "Plex", title: "x", location: .url(base, headers: [:]))
        let plex = client(stub)
        await plex.report(PlaybackReport(state: .paused, source: source, positionSeconds: 61.5, durationSeconds: 7200, sessionID: "s"))
        let q = StubTransport.query(try XCTUnwrap(stub.requests.first))
        XCTAssertEqual(q["state"], "paused")
        XCTAssertEqual(q["time"], "61500")
        XCTAssertEqual(q["duration"], "7200000")
        XCTAssertEqual(q["ratingKey"], "10")
        XCTAssertEqual(q["key"], "/library/metadata/10")
        await plex.report(PlaybackReport(state: .started, source: source, positionSeconds: 0, durationSeconds: nil, sessionID: "s"))
        XCTAssertEqual(StubTransport.query(try XCTUnwrap(stub.requests.last))["state"], "playing")
        XCTAssertNil(StubTransport.query(try XCTUnwrap(stub.requests.last))["duration"])
    }
}

final class MediaServerIndexTests: XCTestCase {
    private func item(_ id: String, _ title: String, year: Int? = nil, tmdb: Int? = nil, imdb: String? = nil, type: MediaType = .movie) -> MediaServerItem {
        MediaServerItem(serverID: "s", itemID: id, type: type, title: title, year: year, ids: ExternalIDs(tmdb: tmdb, imdb: imdb))
    }

    func testMatchingPrefersTMDbThenIMDbThenTitleAndYear() async {
        let index = MediaServerIndex()
        await index.replace(with: [item("1", "Dune", year: 2021, tmdb: 438631), item("2", "Other Name", imdb: "tt9"), item("3", "The Matrix", year: 1999)])
        let byTMDb = await index.matches(for: MediaItem(type: .movie, ids: ExternalIDs(tmdb: 438631), title: "Different Title"))
        XCTAssertEqual(byTMDb.map(\.itemID), ["1"])
        let byIMDb = await index.matches(for: MediaItem(type: .movie, ids: ExternalIDs(imdb: "tt9"), title: "x"))
        XCTAssertEqual(byIMDb.map(\.itemID), ["2"])
        let byTitle = await index.matches(for: MediaItem(type: .movie, ids: ExternalIDs(), title: "the matrix", releaseDate: FlowDate.parse("1999-03-31")))
        XCTAssertEqual(byTitle.map(\.itemID), ["3"], "title matching ignores case and punctuation")
        let wrongType = await index.matches(for: MediaItem(type: .show, ids: ExternalIDs(), title: "The Matrix", releaseDate: FlowDate.parse("1999-03-31")))
        XCTAssertTrue(wrongType.isEmpty, "a show isn't the movie of the same name")
        let contains = await index.contains(MediaItem(type: .movie, ids: ExternalIDs(tmdb: 1), title: "Nope"))
        XCTAssertFalse(contains)
    }

    func testReplaceDropsWhatWasThereBefore() async {
        let index = MediaServerIndex()
        await index.replace(with: [item("1", "A", tmdb: 1)])
        await index.replace(with: [item("2", "B", tmdb: 2)])
        let keys = await index.keys
        XCTAssertEqual(keys, [MediaKey(type: .movie, tmdbID: 2)])
        let count = await index.count
        XCTAssertEqual(count, 1)
        let refreshed = await index.lastRefresh
        XCTAssertNotNil(refreshed)
    }

    func testBestMatchAllowsOneYearOfSlackButNotTwo() {
        let candidates = [item("1", "Dune", year: 2021)]
        let near = MediaItem(type: .movie, ids: ExternalIDs(), title: "Dune", releaseDate: FlowDate.parse("2022-01-01"))
        XCTAssertEqual(ServerMatching.best(candidates, for: near)?.itemID, "1")
        let far = MediaItem(type: .movie, ids: ExternalIDs(), title: "Dune", releaseDate: FlowDate.parse("2023-06-01"))
        XCTAssertNil(ServerMatching.best(candidates, for: far))
    }
}
